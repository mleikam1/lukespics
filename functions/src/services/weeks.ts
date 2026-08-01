import {randomUUID} from "node:crypto";
import {
  FieldPath,
  FieldValue,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import {logger} from "firebase-functions";
import {HttpsError} from "firebase-functions/v2/https";
import {writeAudit, writeAuditInTransaction} from "../audit.js";
import {
  requireAdmin,
  requireMembership,
  requirePickerOrAdmin,
} from "../authz.js";
import {db} from "../config.js";
import {getProvider} from "../providers/factory.js";
import {resultVersionFor, withSourceHash} from "../providers/normalization.js";
import {neutralCatalogPresentation} from "../providers/presentation.js";
import {
  assertProviderAllowedForRuntime,
  providerRuntime,
  type ProviderRuntime,
} from "../providers/policy.js";
import {normalizedGameSchema} from "../schemas.js";
import type {
  CatalogQueryRequest,
  CatalogPresentation,
  LeagueSettings,
  NormalizedGame,
  ProviderLeague,
  ProviderName,
  ProviderQuery,
} from "../types.js";
import {PROVIDER_NAMES} from "../types.js";
import {
  asDate,
  commitWritesInChunks,
  sha256,
  toStoredGame,
} from "../utils.js";
import {
  advanceRotationOnce,
  finalizationFollowUpClaimIsActive,
  gradeWeek,
  rebuildLeagueStandings,
  repairFinalizedWeekFollowUps,
} from "./scoring.js";
import {
  enforceManualRefreshRateLimit,
  fetchGamesByIdsWithCache,
  listGamesWithCache,
  type CachedGamesResult,
} from "./providerGateway.js";

function weekReference(leagueId: string, weekId: string) {
  return db
    .collection("leagues")
    .doc(leagueId)
    .collection("weeks")
    .doc(weekId);
}

type CatalogSelectionState = {
  selectable: boolean;
  reason: string | null;
};

function gameForClient(
  game: NormalizedGame,
  selection: CatalogSelectionState,
): Record<string, unknown> {
  return {
    ...game,
    scheduledAtUtc: game.scheduledAtUtc.toISOString(),
    publishedScheduledAtUtc: game.publishedScheduledAtUtc.toISOString(),
    effectiveLockAtUtc: game.effectiveLockAtUtc.toISOString(),
    providerLastUpdatedAt: game.providerLastUpdatedAt.toISOString(),
    lastSyncedAt: game.lastSyncedAt.toISOString(),
    selectable: selection.selectable,
    selectionReason: selection.reason,
  };
}

function displayNameForCode(code: string): string {
  return code
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

export function calendarDateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function addCalendarDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function boundedRemainingWeekRange(input: {
  now: Date;
  timezone: string;
  weekStartAt: Date;
  weekEndAt: Date;
}): {from: string; to: string} {
  const start = calendarDateInTimezone(input.weekStartAt, input.timezone);
  const end = calendarDateInTimezone(input.weekEndAt, input.timezone);
  const today = calendarDateInTimezone(input.now, input.timezone);
  const from = today < start ? start : today > end ? end : today;
  const maximumEnd = addCalendarDays(from, 6);
  return {from, to: maximumEnd < end ? maximumEnd : end};
}

export function assertCatalogQueryWithinWeek(input: {
  query: ProviderQuery;
  arenaTimezone: string;
  weekStartAt: Date;
  weekEndAt: Date;
}): void {
  if (input.query.timezone !== input.arenaTimezone) {
    throw new HttpsError(
      "invalid-argument",
      "The catalog timezone must match the arena timezone.",
    );
  }
  const startDate = calendarDateInTimezone(
    input.weekStartAt,
    input.arenaTimezone,
  );
  const endDate = calendarDateInTimezone(
    input.weekEndAt,
    input.arenaTimezone,
  );
  if (input.query.from < startDate || input.query.to > endDate) {
    throw new HttpsError(
      "failed-precondition",
      "The sports-catalog query must stay within the active week.",
    );
  }
}

export function resolveCatalogLeague(
  request: CatalogQueryRequest,
  leagues: ProviderLeague[],
): ProviderLeague | null {
  const candidates = leagues
    .filter(
      (league) =>
        (request.sportCode === undefined ||
          league.sportCode === request.sportCode) &&
        (request.leagueCode === undefined ||
          league.code === request.leagueCode) &&
        (request.providerLeagueId === undefined ||
          league.providerLeagueId === request.providerLeagueId) &&
        (request.season === undefined || league.season === request.season),
    )
    .sort((left, right) =>
      [
        left.sportCode,
        left.code,
        left.season,
        left.providerLeagueId,
      ].join(":").localeCompare(
        [
          right.sportCode,
          right.code,
          right.season,
          right.providerLeagueId,
        ].join(":"),
      ),
    );
  return candidates[0] ?? null;
}

export function emptyCatalogAvailabilityState(input: {
  discovery: boolean;
  dateMode: CatalogQueryRequest["dateMode"];
  from: string;
  to: string;
}): "noGamesScheduled" | "offSeason" {
  // A provider's successful empty response does not carry an authoritative
  // season-state flag. Keep exact-day queries precise, and use the broader
  // range state only when the picker searched more than one calendar day (or
  // the initial remaining-week discovery range).
  return input.discovery || input.from !== input.to
    ? "offSeason"
    : "noGamesScheduled";
}

const OPERATION_CLAIM_TTL_MS = 5 * 60_000;
export const MAX_REVEAL_PAGE_SIZE = 200;
const DEFAULT_REVEAL_PAGE_SIZE = MAX_REVEAL_PAGE_SIZE;
const MAX_REVEAL_GAMES_PER_PAGE = 25;
const REVEAL_WRITE_CHUNK_SIZE = 350;
const REVEAL_PICK_READ_CONCURRENCY = 50;
const SELECTABLE_CATALOG_STATUSES = new Set([
  "scheduled",
  "delayed",
]);

function catalogSelectionState(
  game: NormalizedGame,
  input: {
    now: Date;
    weekStartAt: Date;
    weekEndAt: Date;
    stale: boolean;
  },
): CatalogSelectionState {
  if (input.stale) {
    return {
      selectable: false,
      reason: "Schedule data is stale. Refresh before adding this game.",
    };
  }
  if (!SELECTABLE_CATALOG_STATUSES.has(game.status)) {
    return {
      selectable: false,
      reason: `Games with status ${game.status} cannot be added.`,
    };
  }
  if (
    game.scheduledAtUtc <= input.now ||
    game.effectiveLockAtUtc <= input.now
  ) {
    return {selectable: false, reason: "This game has started or is locked."};
  }
  if (
    game.scheduledAtUtc < input.weekStartAt ||
    game.scheduledAtUtc > input.weekEndAt
  ) {
    return {selectable: false, reason: "This game is outside the active week."};
  }
  return {selectable: true, reason: null};
}

type GameResultUpdate = {
  document: QueryDocumentSnapshot;
  game: NormalizedGame;
};

function hasActiveClaim(
  data: DocumentData,
  requestField: string,
  startedField: string,
  now = Date.now(),
): boolean {
  return (
    typeof data[requestField] === "string" &&
    data[startedField] instanceof Timestamp &&
    (data[startedField] as Timestamp).toMillis() >
      now - OPERATION_CLAIM_TTL_MS
  );
}

function publishClaimIsActive(
  data: DocumentData,
  now = Date.now(),
): boolean {
  const heartbeat =
    data.publishHeartbeatAt instanceof Timestamp
      ? data.publishHeartbeatAt
      : data.publishStartedAt;
  return (
    typeof data.publishRequestId === "string" &&
    heartbeat instanceof Timestamp &&
    heartbeat.toMillis() > now - OPERATION_CLAIM_TTL_MS
  );
}

function resultMutationClaimIsActive(
  data: DocumentData,
  now = Date.now(),
): boolean {
  const heartbeat =
    data.resultMutationHeartbeatAt instanceof Timestamp
      ? data.resultMutationHeartbeatAt
      : data.resultMutationStartedAt;
  return (
    typeof data.resultMutationRequestId === "string" &&
    heartbeat instanceof Timestamp &&
    heartbeat.toMillis() > now - OPERATION_CLAIM_TTL_MS
  );
}

async function claimResultMutation(
  reference: FirebaseFirestore.DocumentReference,
  requestId: string,
  claimId: string,
): Promise<DocumentData> {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.data();
    if (data === undefined) {
      throw new HttpsError("not-found", "Week not found.");
    }
    if (data.status === "finalized") {
      throw new HttpsError(
        "failed-precondition",
        "Reopen the week before changing game results.",
      );
    }
    if (typeof data.finalizationRequestId === "string") {
      throw new HttpsError(
        "aborted",
        "Week finalization is in progress.",
      );
    }
    if (resultMutationClaimIsActive(data)) {
      throw new HttpsError(
        "aborted",
        "Game results are currently being updated.",
      );
    }
    transaction.update(reference, {
      resultMutationRequestId: requestId,
      resultMutationClaimId: claimId,
      resultMutationStartedAt: FieldValue.serverTimestamp(),
      resultMutationHeartbeatAt: FieldValue.serverTimestamp(),
    });
    return data;
  });
}

function assertResultMutationClaim(
  data: DocumentData | undefined,
  claimId: string,
): asserts data is DocumentData {
  if (
    data === undefined ||
    data.status === "finalized" ||
    typeof data.finalizationRequestId === "string" ||
    data.resultMutationClaimId !== claimId
  ) {
    throw new HttpsError(
      "aborted",
      "Week state changed while game results were updating.",
    );
  }
}

async function releaseResultMutationClaim(
  reference: FirebaseFirestore.DocumentReference,
  claimId: string,
): Promise<void> {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (snapshot.data()?.resultMutationClaimId !== claimId) return;
    transaction.update(reference, {
      resultMutationRequestId: FieldValue.delete(),
      resultMutationClaimId: FieldValue.delete(),
      resultMutationStartedAt: FieldValue.delete(),
      resultMutationHeartbeatAt: FieldValue.delete(),
    });
  });
}

async function heartbeatResultMutationClaim(
  reference: FirebaseFirestore.DocumentReference,
  claimId: string,
): Promise<void> {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    assertResultMutationClaim(snapshot.data(), claimId);
    transaction.update(reference, {
      resultMutationHeartbeatAt: FieldValue.serverTimestamp(),
    });
  });
}

async function commitGameResultUpdates(
  reference: FirebaseFirestore.DocumentReference,
  claimId: string,
  updates: GameResultUpdate[],
): Promise<void> {
  for (let index = 0; index < updates.length; index += 350) {
    const chunk = updates.slice(index, index + 350);
    await db.runTransaction(async (transaction) => {
      const week = await transaction.get(reference);
      assertResultMutationClaim(week.data(), claimId);
      for (const update of chunk) {
        transaction.set(update.document.ref, toStoredGame(update.game), {
          merge: true,
        });
      }
      transaction.update(reference, {
        gameResultsVersion: FieldValue.increment(1),
        resultMutationHeartbeatAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }
}

export async function gradeWeekWithResultClaim(input: {
  leagueId: string;
  weekId: string;
  requestId: string;
}): ReturnType<typeof gradeWeek> {
  const reference = weekReference(input.leagueId, input.weekId);
  const claimId = randomUUID();
  await claimResultMutation(reference, input.requestId, claimId);
  try {
    return await gradeWeek(input.leagueId, input.weekId);
  } finally {
    await releaseResultMutationClaim(reference, claimId);
  }
}

export function validateCatalogProviderForLeague(
  catalogProvider: ProviderName,
  configuredProvider: unknown,
  runtime: ProviderRuntime = providerRuntime(),
): ProviderName {
  const configured = configuredProvider ?? "manual";
  if (!PROVIDER_NAMES.includes(configured as ProviderName)) {
    throw new HttpsError(
      "failed-precondition",
      "The arena sports provider configuration is invalid.",
    );
  }
  const provider = configured as ProviderName;
  assertProviderAllowedForRuntime(provider, runtime);
  if (catalogProvider !== provider) {
    throw new HttpsError(
      "failed-precondition",
      "The catalog game does not match the arena sports provider.",
    );
  }
  return provider;
}

export function isCatalogGameSelectable(
  game: NormalizedGame,
  input: {
    now: Date;
    weekStartAt?: Date;
    weekEndAt?: Date;
    enabledSports?: string[];
    enabledLeagues?: string[];
  },
): boolean {
  const scheduledAt = game.scheduledAtUtc.valueOf();
  if (
    !SELECTABLE_CATALOG_STATUSES.has(game.status) ||
    scheduledAt <= input.now.valueOf() ||
    game.effectiveLockAtUtc.valueOf() <= input.now.valueOf()
  ) {
    return false;
  }
  if (
    input.weekStartAt !== undefined &&
    scheduledAt < input.weekStartAt.valueOf()
  ) {
    return false;
  }
  if (
    input.weekEndAt !== undefined &&
    scheduledAt > input.weekEndAt.valueOf()
  ) {
    return false;
  }
  if (
    input.enabledSports !== undefined &&
    input.enabledSports.length > 0 &&
    !input.enabledSports.includes(game.sportCode)
  ) {
    return false;
  }
  return !(
    input.enabledLeagues !== undefined &&
    input.enabledLeagues.length > 0 &&
    !input.enabledLeagues.includes(game.leagueCode)
  );
}

async function releaseDraftMutationClaim(
  reference: FirebaseFirestore.DocumentReference,
  requestId: string,
): Promise<void> {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (snapshot.data()?.draftMutationRequestId === requestId) {
      transaction.update(reference, {
        draftMutationRequestId: FieldValue.delete(),
        draftMutationStartedAt: FieldValue.delete(),
      });
    }
  });
}

async function releasePublishClaim(
  reference: FirebaseFirestore.DocumentReference,
  claimId: string,
): Promise<void> {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (snapshot.data()?.publishClaimId === claimId) {
      transaction.update(reference, {
        publishRequestId: FieldValue.delete(),
        publishClaimId: FieldValue.delete(),
        publishStartedAt: FieldValue.delete(),
        publishHeartbeatAt: FieldValue.delete(),
      });
    }
  });
}

export async function createDraftWeekRecord(input: {
  leagueId: string;
  actorUid: string;
  requestId: string;
  sequentialNumber: number;
  label: string;
  startAt: Date;
  endAt: Date;
  pickerUid?: string;
}): Promise<{weekId: string; pickerUid: string}> {
  await requireAdmin(input.leagueId, input.actorUid);
  const leagueReference = db.collection("leagues").doc(input.leagueId);
  const weekId = `week-${String(input.sequentialNumber).padStart(4, "0")}`;
  const reference = leagueReference.collection("weeks").doc(weekId);

  const leagueBeforeCreate = await leagueReference.get();
  const currentWeekId = leagueBeforeCreate.data()?.currentWeekId;
  if (typeof currentWeekId === "string" && currentWeekId !== weekId) {
    const currentWeek = await leagueReference
      .collection("weeks")
      .doc(currentWeekId)
      .get();
    const currentWeekData = currentWeek.data();
    if (currentWeekData?.status === "finalized") {
      await repairFinalizedWeekFollowUps({
        leagueId: input.leagueId,
        weekId: currentWeekId,
        actorUid: input.actorUid,
        requestId: input.requestId,
      });
    }
  }

  return db.runTransaction(async (transaction) => {
    const [leagueSnapshot, existing] = await Promise.all([
      transaction.get(leagueReference),
      transaction.get(reference),
    ]);
    const league = leagueSnapshot.data();
    if (league === undefined) {
      throw new HttpsError("not-found", "Arena not found.");
    }
    if (existing.exists) {
      const existingPicker = existing.data()?.pickerUid;
      return {
        weekId,
        pickerUid:
          typeof existingPicker === "string" ? existingPicker : input.actorUid,
      };
    }
    const currentWeekId = league.currentWeekId;
    let finalizedNextPickerUid: string | undefined;
    if (typeof currentWeekId === "string") {
      const currentWeek = await transaction.get(
        leagueReference.collection("weeks").doc(currentWeekId),
      );
      if (
        currentWeek.exists &&
        currentWeek.id !== weekId &&
        currentWeek.data()?.status !== "finalized"
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Finalize the current week before creating the next one.",
        );
      }
      if (currentWeek.exists && currentWeek.id !== weekId) {
        const currentWeekData = currentWeek.data();
        const nextPickerUid = currentWeekData?.nextPickerUid;
        if (
          !(currentWeekData?.rotationAdvancedAt instanceof Timestamp) ||
          typeof nextPickerUid !== "string" ||
          nextPickerUid.length === 0
        ) {
          throw new HttpsError(
            "failed-precondition",
            "Weekly picker rotation is still finalizing. Try again shortly.",
          );
        }
        if (
          input.pickerUid !== undefined &&
          input.pickerUid !== nextPickerUid
        ) {
          throw new HttpsError(
            "failed-precondition",
            "The next weekly picker must match the finalized rotation.",
          );
        }
        finalizedNextPickerUid = nextPickerUid;
      }
    }
    const pickerUid =
      finalizedNextPickerUid ??
      input.pickerUid ??
      (typeof league.currentPickerUid === "string"
        ? league.currentPickerUid
        : input.actorUid);
    const picker = await transaction.get(
      leagueReference.collection("members").doc(pickerUid),
    );
    if (!picker.exists || picker.data()?.status !== "active") {
      throw new HttpsError(
        "failed-precondition",
        "The weekly picker must be an active member.",
      );
    }
    const settings = league.settings as Partial<LeagueSettings> | undefined;
    transaction.create(reference, {
      sequentialNumber: input.sequentialNumber,
      label: input.label,
      startAt: Timestamp.fromDate(input.startAt),
      endAt: Timestamp.fromDate(input.endAt),
      pickerUid,
      pickerDisplayNameSnapshot: String(
        picker.data()?.displayName ?? "Member",
      ),
      status: "draft",
      pickerParticipatesSnapshot:
        settings?.pickerParticipatesInPicks ?? false,
      lockPolicySnapshot: settings?.pickLockPolicy ?? "perGame",
      publishedAt: null,
      finalizedAt: null,
      selectedGameCount: 0,
      eligibleMemberCount: 0,
      winnerUids: [],
      highScore: null,
      gameResultsVersion: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      resultVersion: 0,
    });
    transaction.update(leagueReference, {
      currentWeekId: weekId,
      currentPickerUid: pickerUid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAuditInTransaction(transaction, {
      leagueId: input.leagueId,
      eventType: "draft_week_created",
      actorUid: input.actorUid,
      target: `weeks/${weekId}`,
      requestId: input.requestId,
      after: {
        sequentialNumber: input.sequentialNumber,
        pickerUid,
        startAt: input.startAt.toISOString(),
        endAt: input.endAt.toISOString(),
      },
    });
    return {weekId, pickerUid};
  });
}

export async function assignPicker(input: {
  leagueId: string;
  weekId: string;
  pickerUid: string;
  actorUid: string;
  requestId: string;
}): Promise<void> {
  await requireAdmin(input.leagueId, input.actorUid);
  const leagueReference = db.collection("leagues").doc(input.leagueId);
  const reference = weekReference(input.leagueId, input.weekId);
  await db.runTransaction(async (transaction) => {
    const [week, picker] = await Promise.all([
      transaction.get(reference),
      transaction.get(
        leagueReference.collection("members").doc(input.pickerUid),
      ),
    ]);
    const weekData = week.data();
    if (weekData?.status !== "draft") {
      throw new HttpsError(
        "failed-precondition",
        "The picker can only change while the week is a draft.",
      );
    }
    if (
      publishClaimIsActive(weekData) ||
      hasActiveClaim(
        weekData,
        "draftMutationRequestId",
        "draftMutationStartedAt",
      )
    ) {
      throw new HttpsError(
        "aborted",
        "The draft is currently being updated.",
      );
    }
    if (!picker.exists || picker.data()?.status !== "active") {
      throw new HttpsError(
        "failed-precondition",
        "The picker must be an active member.",
      );
    }
    transaction.update(reference, {
      pickerUid: input.pickerUid,
      pickerDisplayNameSnapshot: picker.data()?.displayName ?? "Member",
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(leagueReference, {
      currentPickerUid: input.pickerUid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAuditInTransaction(transaction, {
      leagueId: input.leagueId,
      eventType: "weekly_picker_assigned",
      actorUid: input.actorUid,
      target: `weeks/${input.weekId}`,
      requestId: input.requestId,
      after: {pickerUid: input.pickerUid},
    });
  });
}

async function canonicalCatalogGames(
  games: NormalizedGame[],
  week: DocumentData,
  settings: Partial<LeagueSettings>,
): Promise<NormalizedGame[]> {
  if (games.some((game) => game.provider === "manual")) {
    throw new HttpsError(
      "invalid-argument",
      "Manual games must be created with the manual-game action.",
    );
  }
  if (new Set(games.map((game) => game.id)).size !== games.length) {
    throw new HttpsError(
      "invalid-argument",
      "Each catalog game may be selected once per request.",
    );
  }
  const now = new Date();
  const weekStartAt = asDate(week.startAt, "week startAt");
  const weekEndAt = asDate(week.endAt, "week endAt");
  const result: NormalizedGame[] = [];
  for (let index = 0; index < games.length; index += 30) {
    const chunk = games.slice(index, index + 30);
    const snapshots = await db.getAll(
      ...chunk.map((game) => db.collection("sportsCatalogGames").doc(game.id)),
    );
    for (const [chunkIndex, snapshot] of snapshots.entries()) {
      const data = snapshot.data();
      const submitted = chunk[chunkIndex];
      const eligibleUntil = data?.catalogEligibleUntil;
      if (
        !snapshot.exists ||
        data === undefined ||
        !(data.catalogUpdatedAt instanceof Timestamp) ||
        !(eligibleUntil instanceof Timestamp) ||
        eligibleUntil.toMillis() <= now.valueOf() ||
        typeof data.cacheKey !== "string"
      ) {
        throw new HttpsError(
          "failed-precondition",
          "One or more games require a fresh sports-catalog lookup.",
        );
      }
      const game = normalizedGameSchema.parse(data);
      if (
        submitted === undefined ||
        submitted.id !== game.id ||
        submitted.provider !== game.provider ||
        submitted.providerGameId !== game.providerGameId ||
        submitted.resultVersion !== game.resultVersion ||
        submitted.sourcePayloadHash !== game.sourcePayloadHash
      ) {
        throw new HttpsError(
          "failed-precondition",
          "One or more games changed and must be reviewed from a fresh sports catalog.",
        );
      }
      validateCatalogProviderForLeague(
        game.provider,
        settings.providerName,
      );
      if (
        game.id !== snapshot.id ||
        game.provider === "manual" ||
        !isCatalogGameSelectable(game, {
          now,
          weekStartAt,
          weekEndAt,
          enabledSports: settings.enabledSports ?? [],
          enabledLeagues: settings.enabledLeagues ?? [],
        })
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Only upcoming eligible games may be added to this week.",
        );
      }
      result.push(game);
    }
  }
  return result;
}

export async function saveDraftSlateRecord(input: {
  leagueId: string;
  weekId: string;
  actorUid: string;
  requestId: string;
  chunkKey: string;
  games: NormalizedGame[];
  removeGameIds: string[];
}): Promise<{selectedGameCount: number}> {
  const {week} = await requirePickerOrAdmin(
    input.leagueId,
    input.weekId,
    input.actorUid,
  );
  if (week.status !== "draft") {
    throw new HttpsError(
      "failed-precondition",
      "The slate cannot change after publication.",
    );
  }
  const reference = weekReference(input.leagueId, input.weekId);
  const claimedWeek = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.data();
    if (data?.status !== "draft") {
      throw new HttpsError(
        "failed-precondition",
        "The slate cannot change after publication.",
      );
    }
    if (publishClaimIsActive(data)) {
      throw new HttpsError(
        "aborted",
        "This slate is currently being published.",
      );
    }
    if (
      hasActiveClaim(
        data,
        "draftMutationRequestId",
        "draftMutationStartedAt",
      ) &&
      data.draftMutationRequestId !== input.requestId
    ) {
      throw new HttpsError(
        "aborted",
        "This draft is currently being updated.",
      );
    }
    transaction.update(reference, {
      draftMutationRequestId: input.requestId,
      draftMutationStartedAt: FieldValue.serverTimestamp(),
      publishRequestId: FieldValue.delete(),
      publishClaimId: FieldValue.delete(),
      publishStartedAt: FieldValue.delete(),
      publishHeartbeatAt: FieldValue.delete(),
    });
    return data;
  });
  try {
    const league = await db.collection("leagues").doc(input.leagueId).get();
    const settings =
      (league.data()?.settings as Partial<LeagueSettings> | undefined) ?? {};
    const canonicalGames = await canonicalCatalogGames(
      input.games,
      claimedWeek,
      settings,
    );
    await commitWritesInChunks(db, canonicalGames, (batch, game) => {
      batch.set(reference.collection("games").doc(game.id), {
        ...toStoredGame(game),
        selectedByPickerUid: input.actorUid,
        selectedAt: FieldValue.serverTimestamp(),
        pickRevealCompletedAt: null,
        gradingStatus: "pending",
        draftChunkKey: input.chunkKey,
      });
    });
    await commitWritesInChunks(db, input.removeGameIds, (batch, gameId) => {
      batch.delete(reference.collection("games").doc(gameId));
    });
    const count = await reference.collection("games").count().get();
    const selectedGameCount = count.data().count;
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(reference);
      if (
        current.data()?.status !== "draft" ||
        current.data()?.draftMutationRequestId !== input.requestId
      ) {
        throw new HttpsError(
          "aborted",
          "Week state changed while saving the draft.",
        );
      }
      transaction.update(reference, {
        selectedGameCount,
        updatedAt: FieldValue.serverTimestamp(),
        lastDraftChunkKey: input.chunkKey,
      });
    });
    await writeAudit({
      leagueId: input.leagueId,
      eventType: "slate_draft_saved",
      actorUid: input.actorUid,
      target: `weeks/${input.weekId}/games`,
      requestId: input.requestId,
      after: {
        addedCount: canonicalGames.length,
        removedCount: input.removeGameIds.length,
        selectedGameCount,
        chunkKey: input.chunkKey,
      },
    });
    return {selectedGameCount};
  } finally {
    await releaseDraftMutationClaim(reference, input.requestId);
  }
}

function memberEligible(
  member: QueryDocumentSnapshot,
  weekId: string,
  sequentialNumber: number,
): boolean {
  const data = member.data();
  if (data.status !== "active") return false;
  if (data.eligibleFromWeekId === weekId) return true;
  const fromNumber = data.eligibleFromSequentialNumber;
  return typeof fromNumber !== "number" || fromNumber <= sequentialNumber;
}

async function validateGamesForPublish(input: {
  games: QueryDocumentSnapshot[];
  week: DocumentData;
  settings: Partial<LeagueSettings>;
}): Promise<void> {
  const now = new Date();
  const weekStartAt = asDate(input.week.startAt, "week startAt");
  const weekEndAt = asDate(input.week.endAt, "week endAt");
  const providerGames = input.games.filter(
    (game) => String(game.data().provider) !== "manual",
  );
  const catalogById = new Map<string, DocumentData>();
  for (let index = 0; index < providerGames.length; index += 30) {
    const chunk = providerGames.slice(index, index + 30);
    const snapshots = await db.getAll(
      ...chunk.map((game) => db.collection("sportsCatalogGames").doc(game.id)),
    );
    for (const snapshot of snapshots) {
      const data = snapshot.data();
      if (snapshot.exists && data !== undefined) {
        catalogById.set(snapshot.id, data);
      }
    }
  }

  for (const game of input.games) {
    const selected = game.data();
    const providerName = String(selected.provider);
    if (!PROVIDER_NAMES.includes(providerName as ProviderName)) {
      throw new HttpsError(
        "failed-precondition",
        "A slate game has an unsupported sports provider.",
      );
    }
    if (providerName !== "manual") {
      validateCatalogProviderForLeague(
        providerName as ProviderName,
        input.settings.providerName,
      );
    }
    const selectedScheduledAt = asDate(
      selected.scheduledAtUtc,
      "scheduledAtUtc",
    );
    const selectedLockAt = asDate(
      selected.effectiveLockAtUtc,
      "effectiveLockAtUtc",
    );
    if (
      !SELECTABLE_CATALOG_STATUSES.has(String(selected.status)) ||
      selectedScheduledAt <= now ||
      selectedLockAt <= now ||
      selectedScheduledAt < weekStartAt ||
      selectedScheduledAt > weekEndAt
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Every slate game must still be upcoming and open for picks.",
      );
    }
    if (providerName === "manual") continue;

    const catalogData = catalogById.get(game.id);
    const eligibleUntil = catalogData?.catalogEligibleUntil;
    if (
      catalogData === undefined ||
      !(eligibleUntil instanceof Timestamp) ||
      eligibleUntil.toMillis() <= now.valueOf()
    ) {
      throw new HttpsError(
        "failed-precondition",
        "One or more slate games require a fresh sports-catalog lookup before publishing.",
      );
    }
    const canonical = normalizedGameSchema.parse(catalogData);
    if (
      canonical.id !== game.id ||
      canonical.provider !== providerName ||
      canonical.providerGameId !== String(selected.providerGameId) ||
      canonical.providerLeagueId !==
        String(selected.providerLeagueId ?? selected.leagueCode) ||
      canonical.resultVersion !== String(selected.resultVersion) ||
      canonical.sourcePayloadHash !== String(selected.sourcePayloadHash) ||
      !isCatalogGameSelectable(canonical, {
        now,
        weekStartAt,
        weekEndAt,
        enabledSports: input.settings.enabledSports ?? [],
        enabledLeagues: input.settings.enabledLeagues ?? [],
      })
    ) {
      throw new HttpsError(
        "failed-precondition",
        "One or more slate games changed and must be reviewed before publishing.",
      );
    }
  }
}

type PublishedCatalogPresentation = {
  catalogProviderSnapshot: ProviderName;
  catalogPresentationSnapshot: CatalogPresentation;
};

const PUBLISHED_WEEK_STATUSES = new Set([
  "open",
  "inProgress",
  "review",
  "finalized",
  "reopened",
]);

export function isPublishedRequestReplay(
  week: Record<string, unknown> | undefined,
  requestId: string,
): boolean {
  return (
    week !== undefined &&
    PUBLISHED_WEEK_STATUSES.has(String(week.status)) &&
    week.publishedRequestId === requestId
  );
}

type PublishSlateTestHooks = {
  afterClaim?: (claimId: string) => Promise<void>;
  beforeSettlement?: (claimId: string) => Promise<void>;
};

function assertPublishClaim(
  data: DocumentData | undefined,
  requestId: string,
  claimId: string,
): asserts data is DocumentData {
  if (
    data === undefined ||
    data.status !== "draft" ||
    data.publishRequestId !== requestId ||
    data.publishClaimId !== claimId
  ) {
    throw new HttpsError(
      "aborted",
      "Week state changed while publishing the slate.",
    );
  }
}

async function commitPublishWritesInChunks<T>(
  reference: FirebaseFirestore.DocumentReference,
  requestId: string,
  claimId: string,
  values: T[],
  apply: (transaction: FirebaseFirestore.Transaction, value: T) => void,
): Promise<void> {
  for (let index = 0; index < values.length; index += 350) {
    const chunk = values.slice(index, index + 350);
    await db.runTransaction(async (transaction) => {
      const week = await transaction.get(reference);
      assertPublishClaim(week.data(), requestId, claimId);
      for (const value of chunk) apply(transaction, value);
      transaction.update(reference, {
        publishHeartbeatAt: FieldValue.serverTimestamp(),
      });
    });
  }
}

async function publishedCatalogPresentation(
  games: QueryDocumentSnapshot[],
): Promise<PublishedCatalogPresentation> {
  const providerNames = new Set(
    games
      .map((game) => String(game.data().provider))
      .filter((provider) => provider !== "manual"),
  );
  if (providerNames.size === 0) {
    return {
      catalogProviderSnapshot: "manual",
      catalogPresentationSnapshot: neutralCatalogPresentation("manual"),
    };
  }
  if (providerNames.size !== 1) {
    throw new HttpsError(
      "failed-precondition",
      "A published slate must use one connected sports provider.",
    );
  }
  const [providerName] = providerNames;
  if (!PROVIDER_NAMES.includes(providerName as ProviderName)) {
    throw new HttpsError(
      "failed-precondition",
      "A slate game has an unsupported sports provider.",
    );
  }
  const provider = await getProvider(providerName as ProviderName);
  return {
    catalogProviderSnapshot: providerName as ProviderName,
    catalogPresentationSnapshot: {
      provider: provider.presentation.provider,
      attributionText: provider.presentation.attributionText,
      allowRemoteLogos: provider.presentation.allowRemoteLogos,
      allowedLogoHosts: [...provider.presentation.allowedLogoHosts],
      allowedLogoQueryParameters: [
        ...provider.presentation.allowedLogoQueryParameters,
      ],
      logoRightsReviewDate: provider.presentation.logoRightsReviewDate,
    },
  };
}

export async function publishSlate(input: {
  leagueId: string;
  weekId: string;
  actorUid: string;
  requestId: string;
}, hooks: PublishSlateTestHooks = {}): Promise<{
  published: boolean;
  eligibleMemberCount: number;
  selectedGameCount: number;
}> {
  const {week} = await requirePickerOrAdmin(
    input.leagueId,
    input.weekId,
    input.actorUid,
  );
  const reference = weekReference(input.leagueId, input.weekId);
  if (PUBLISHED_WEEK_STATUSES.has(String(week.status))) {
    return {
      published: true,
      eligibleMemberCount: Number(week.eligibleMemberCount ?? 0),
      selectedGameCount: Number(week.selectedGameCount ?? 0),
    };
  }
  const claimId = randomUUID();
  const claim = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    const data = current.data();
    if (data === undefined) {
      throw new HttpsError("not-found", "Week not found.");
    }
    if (PUBLISHED_WEEK_STATUSES.has(String(data.status))) {
      return {alreadyPublished: true, week: data};
    }
    if (data.status !== "draft") {
      throw new HttpsError(
        "failed-precondition",
        "Only a draft slate can be published.",
      );
    }
    if (
      hasActiveClaim(
        data,
        "draftMutationRequestId",
        "draftMutationStartedAt",
      )
    ) {
      throw new HttpsError(
        "aborted",
        "The draft is currently being updated.",
      );
    }
    if (publishClaimIsActive(data)) {
      throw new HttpsError(
        "aborted",
        "This slate is already being published.",
      );
    }
    transaction.update(reference, {
      publishRequestId: input.requestId,
      publishClaimId: claimId,
      publishStartedAt: FieldValue.serverTimestamp(),
      publishHeartbeatAt: FieldValue.serverTimestamp(),
      draftMutationRequestId: FieldValue.delete(),
      draftMutationStartedAt: FieldValue.delete(),
    });
    return {alreadyPublished: false, week: data};
  });
  if (claim.alreadyPublished) {
    return {
      published: true,
      eligibleMemberCount: Number(claim.week.eligibleMemberCount ?? 0),
      selectedGameCount: Number(claim.week.selectedGameCount ?? 0),
    };
  }
  try {
    await hooks.afterClaim?.(claimId);
    const [games, members, existingEntries, league] = await Promise.all([
      reference.collection("games").get(),
      db
        .collection("leagues")
        .doc(input.leagueId)
        .collection("members")
        .where("status", "==", "active")
        .get(),
      reference.collection("entries").get(),
      db.collection("leagues").doc(input.leagueId).get(),
    ]);
    if (games.empty) {
      throw new HttpsError(
        "failed-precondition",
        "Select at least one game before publishing.",
      );
    }
    const settings =
      (league.data()?.settings as Partial<LeagueSettings> | undefined) ?? {};
    await validateGamesForPublish({
      games: games.docs,
      week: claim.week,
      settings,
    });
    const presentation = await publishedCatalogPresentation(games.docs);
    const earliestLock = Math.min(
      ...games.docs.map((game) =>
        asDate(game.data().scheduledAtUtc, "scheduledAtUtc").valueOf(),
      ),
    );
    if (claim.week.lockPolicySnapshot === "firstGame") {
      await commitPublishWritesInChunks(
        reference,
        input.requestId,
        claimId,
        games.docs,
        (transaction, game) => {
          transaction.update(game.ref, {
            effectiveLockAtUtc: Timestamp.fromMillis(earliestLock),
          });
        },
      );
    }
    const eligibleMembers = members.docs.filter((member) =>
      memberEligible(
        member,
        input.weekId,
        Number(claim.week.sequentialNumber ?? 0),
      ),
    );
    const eligibleIds = new Set(eligibleMembers.map((member) => member.id));
    await commitPublishWritesInChunks(
      reference,
      input.requestId,
      claimId,
      eligibleMembers,
      (transaction, member) => {
        const pickerExcluded =
          member.id === claim.week.pickerUid &&
          claim.week.pickerParticipatesSnapshot !== true;
        transaction.set(reference.collection("entries").doc(member.id), {
          uid: member.id,
          eligible: !pickerExcluded,
          ineligibilityReason: pickerExcluded ? "weeklyPicker" : null,
          savedPickCount: 0,
          totalRequiredPickCount: games.size,
          completionState: pickerExcluded ? "ineligible" : "notStarted",
          submittedAt: null,
          gradedCount: 0,
          correctCount: 0,
          incorrectCount: 0,
          voidCount: 0,
          points: 0,
          accuracy: null,
          weeklyRank: null,
          isWeeklyWinner: false,
          lastSyncedAt: FieldValue.serverTimestamp(),
        });
      },
    );
    await commitPublishWritesInChunks(
      reference,
      input.requestId,
      claimId,
      existingEntries.docs.filter((entry) => !eligibleIds.has(entry.id)),
      (transaction, entry) => {
        transaction.delete(entry.ref);
      },
    );
    const eligibleMemberCount = eligibleMembers.filter(
      (member) =>
        member.id !== claim.week.pickerUid ||
        claim.week.pickerParticipatesSnapshot === true,
    ).length;
    await hooks.beforeSettlement?.(claimId);
    const settlement = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(reference);
      const data = current.data();
      if (isPublishedRequestReplay(data, input.requestId)) {
        return {
          eligibleMemberCount: Number(data?.eligibleMemberCount ?? 0),
          selectedGameCount: Number(data?.selectedGameCount ?? 0),
        };
      }
      if (
        data?.status !== "draft" ||
        data.publishRequestId !== input.requestId ||
        data.publishClaimId !== claimId
      ) {
        throw new HttpsError(
          "aborted",
          "Week state changed while publishing the slate.",
        );
      }
      transaction.update(reference, {
        status: "open",
        publishedAt: FieldValue.serverTimestamp(),
        publishedRequestId: input.requestId,
        selectedGameCount: games.size,
        eligibleMemberCount,
        ...presentation,
        updatedAt: FieldValue.serverTimestamp(),
        publishRequestId: FieldValue.delete(),
        publishClaimId: FieldValue.delete(),
        publishStartedAt: FieldValue.delete(),
        publishHeartbeatAt: FieldValue.delete(),
      });
      writeAuditInTransaction(transaction, {
        leagueId: input.leagueId,
        eventType: "slate_published",
        actorUid: input.actorUid,
        target: `weeks/${input.weekId}`,
        requestId: input.requestId,
        after: {
          selectedGameCount: games.size,
          lockPolicy: claim.week.lockPolicySnapshot,
        },
      });
      return {
        eligibleMemberCount,
        selectedGameCount: games.size,
      };
    });
    return {
      published: true,
      ...settlement,
    };
  } finally {
    await releasePublishClaim(reference, claimId);
  }
}

export async function submitEntry(input: {
  leagueId: string;
  weekId: string;
  actorUid: string;
  picks: Array<{gameId: string; selectedTeamId: string}>;
}): Promise<{
  savedPickCount: number;
  totalRequiredPickCount: number;
  completionState: string;
}> {
  await requireMembership(input.leagueId, input.actorUid);
  const reference = weekReference(input.leagueId, input.weekId);
  const entryReference = reference.collection("entries").doc(input.actorUid);
  const uniqueGames = new Set(input.picks.map((pick) => pick.gameId));
  if (uniqueGames.size !== input.picks.length) {
    throw new HttpsError("invalid-argument", "Each game may be picked once.");
  }
  for (const pick of input.picks) {
    await db.runTransaction(async (transaction) => {
      const gameReference = reference.collection("games").doc(pick.gameId);
      const pickReference = entryReference.collection("picks").doc(pick.gameId);
      const [currentWeek, currentEntry, game, previous] = await Promise.all([
        transaction.get(reference),
        transaction.get(entryReference),
        transaction.get(gameReference),
        transaction.get(pickReference),
      ]);
      if (
        !["open", "inProgress"].includes(
          String(currentWeek.data()?.status),
        )
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Picks are not open for this week.",
        );
      }
      if (!currentEntry.exists || currentEntry.data()?.eligible !== true) {
        throw new HttpsError(
          "permission-denied",
          "You are not eligible to make picks this week.",
        );
      }
      const data = game.data();
      if (data === undefined) {
        throw new HttpsError("not-found", "Selected game not found.");
      }
      const now = Timestamp.now();
      const lockAt = data.effectiveLockAtUtc;
      if (!(lockAt instanceof Timestamp) || now.toMillis() >= lockAt.toMillis()) {
        throw new HttpsError(
          "failed-precondition",
          "This game is already locked.",
        );
      }
      if (data.pickRevealCompletedAt instanceof Timestamp) {
        throw new HttpsError(
          "failed-precondition",
          "Picks for this game have already been revealed.",
        );
      }
      const validTeams = [data.homeTeam?.id, data.awayTeam?.id];
      if (!validTeams.includes(pick.selectedTeamId)) {
        throw new HttpsError(
          "invalid-argument",
          "The selected team is not in this game.",
        );
      }
      transaction.set(
        pickReference,
        {
          gameId: pick.gameId,
          selectedTeamId: pick.selectedTeamId,
          selectedAt:
            previous.data()?.selectedAt ?? FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          serverConfirmedAt: FieldValue.serverTimestamp(),
          lockAtSnapshot: lockAt,
          lockedAt: null,
          outcome: previous.data()?.outcome ?? "pending",
          points: previous.data()?.points ?? 0,
          outcomeVersion: previous.data()?.outcomeVersion ?? null,
        },
        {merge: true},
      );
      const entryData = currentEntry.data() ?? {};
      const totalRequiredPickCount = Math.max(
        0,
        Number(entryData.totalRequiredPickCount ?? 0),
      );
      const currentSavedPickCount = Math.max(
        0,
        Number(entryData.savedPickCount ?? 0),
      );
      const savedPickCount = previous.exists
        ? currentSavedPickCount
        : Math.min(
            totalRequiredPickCount,
            currentSavedPickCount + 1,
          );
      const completionState =
        totalRequiredPickCount > 0 &&
        savedPickCount >= totalRequiredPickCount
          ? "complete"
          : "inProgress";
      transaction.set(
        entryReference,
        {
          savedPickCount,
          totalRequiredPickCount,
          completionState,
          submittedAt:
            completionState === "complete"
              ? entryData.submittedAt ?? FieldValue.serverTimestamp()
              : entryData.submittedAt ?? null,
          lastSyncedAt: FieldValue.serverTimestamp(),
        },
        {merge: true},
      );
    });
  }
  const entry = await entryReference.get();
  return {
    savedPickCount: Number(entry.data()?.savedPickCount ?? 0),
    totalRequiredPickCount: Number(
      entry.data()?.totalRequiredPickCount ?? 0,
    ),
    completionState: String(
      entry.data()?.completionState ?? "inProgress",
    ),
  };
}

export async function listCatalog(input: {
  leagueId: string;
  weekId: string;
  actorUid: string;
  query: CatalogQueryRequest;
}): Promise<Record<string, unknown>> {
  const {week} = await requirePickerOrAdmin(
    input.leagueId,
    input.weekId,
    input.actorUid,
  );
  if (week.status !== "draft") {
    throw new HttpsError(
      "failed-precondition",
      "Sports catalog access is limited to a draft week.",
    );
  }
  const league = await db.collection("leagues").doc(input.leagueId).get();
  const leagueData = league.data();
  if (leagueData === undefined) {
    throw new HttpsError("not-found", "Arena not found.");
  }
  const settings =
    (leagueData.settings as Partial<LeagueSettings> | undefined) ?? {};
  if (
    input.query.sportCode !== undefined &&
    (settings.enabledSports?.length ?? 0) > 0 &&
    !settings.enabledSports?.includes(input.query.sportCode)
  ) {
    throw new HttpsError(
      "failed-precondition",
      "This sport is not enabled for the arena.",
    );
  }
  if (
    input.query.leagueCode !== undefined &&
    (settings.enabledLeagues?.length ?? 0) > 0 &&
    !settings.enabledLeagues?.includes(input.query.leagueCode)
  ) {
    throw new HttpsError(
      "failed-precondition",
      "This league is not enabled for the arena.",
    );
  }
  const arenaTimezone = String(leagueData.timezone ?? "").trim();
  try {
    new Intl.DateTimeFormat("en-US", {timeZone: arenaTimezone}).format();
  } catch {
    throw new HttpsError(
      "failed-precondition",
      "The arena timezone configuration is invalid.",
    );
  }
  if (arenaTimezone.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      "The arena timezone configuration is missing.",
    );
  }
  const weekStartAt = asDate(week.startAt, "week startAt");
  const weekEndAt = asDate(week.endAt, "week endAt");
  const discovery = input.query.from === undefined;
  const derivedRange = boundedRemainingWeekRange({
    now: new Date(),
    timezone: arenaTimezone,
    weekStartAt,
    weekEndAt,
  });
  const configuredProvider = settings.providerName ?? "manual";
  if (!PROVIDER_NAMES.includes(configuredProvider as ProviderName)) {
    throw new HttpsError(
      "failed-precondition",
      "The arena sports provider configuration is invalid.",
    );
  }
  const providerName = configuredProvider as ProviderName;
  const provider = await getProvider(providerName);
  const [providerSports, providerLeagues] = await Promise.all([
    provider.listSupportedSports(),
    provider.listLeagues(),
  ]);
  const enabledLeagues = providerLeagues.filter(
    (item) =>
      ((settings.enabledSports?.length ?? 0) === 0 ||
        settings.enabledSports?.includes(item.sportCode)) &&
      ((settings.enabledLeagues?.length ?? 0) === 0 ||
        settings.enabledLeagues?.includes(item.code)),
  );
  const resolvedLeague = resolveCatalogLeague(input.query, enabledLeagues);
  if (providerName !== "manual" && resolvedLeague === null) {
    throw new HttpsError(
      "failed-precondition",
      "Live sports data has not been configured for this league and season.",
    );
  }
  const effectiveQuery: ProviderQuery = {
    sportCode:
      resolvedLeague?.sportCode ?? input.query.sportCode ?? "manual",
    leagueCode:
      resolvedLeague?.code ?? input.query.leagueCode ?? "manual",
    providerLeagueId:
      resolvedLeague?.providerLeagueId ??
      input.query.providerLeagueId ??
      "manual",
    season: resolvedLeague?.season ?? input.query.season ?? "manual",
    from: input.query.from ?? derivedRange.from,
    to: input.query.to ?? derivedRange.to,
    // Arena configuration is authoritative; client timezone is context only.
    timezone: arenaTimezone,
    forceRefresh: input.query.forceRefresh ?? false,
  };
  assertCatalogQueryWithinWeek({
    query: effectiveQuery,
    arenaTimezone,
    weekStartAt,
    weekEndAt,
  });
  if (providerName === "manual") {
    return {
      provider: provider.name,
      sports: [],
      leagues: [],
      games: [],
      cache: {
        hit: false,
        stale: false,
        delayed: false,
        cachedAt: null,
        expiresAt: null,
      },
      presentation: provider.presentation,
      effectiveQuery: {
        sportCode: effectiveQuery.sportCode,
        leagueCode: effectiveQuery.leagueCode,
        providerLeagueId: effectiveQuery.providerLeagueId,
        season: effectiveQuery.season,
        from: effectiveQuery.from,
        to: effectiveQuery.to,
        timezone: effectiveQuery.timezone,
        ...(discovery
          ? {dateMode: "allDates"}
          : input.query.dateMode === undefined
            ? {}
            : {dateMode: input.query.dateMode}),
      },
      availability: {
        state: "providerNotConfigured",
        message: "Live sports data has not been configured.",
      },
      week: {
        startAt: weekStartAt.toISOString(),
        endAt: weekEndAt.toISOString(),
      },
    };
  }
  if (input.query.forceRefresh === true) {
    await enforceManualRefreshRateLimit({
      leagueId: input.leagueId,
      actorUid: input.actorUid,
    });
  }
  const cached = await listGamesWithCache(provider, effectiveQuery);
  const now = new Date();
  const visibleGames = cached.games.filter((game) => {
    const localDate = calendarDateInTimezone(
      game.scheduledAtUtc,
      arenaTimezone,
    );
    return (
      game.sportCode === effectiveQuery.sportCode &&
      game.leagueCode === effectiveQuery.leagueCode &&
      localDate >= effectiveQuery.from &&
      localDate <= effectiveQuery.to &&
      game.scheduledAtUtc >= weekStartAt &&
      game.scheduledAtUtc <= weekEndAt &&
      ((settings.enabledSports?.length ?? 0) === 0 ||
        settings.enabledSports?.includes(game.sportCode)) &&
      ((settings.enabledLeagues?.length ?? 0) === 0 ||
        settings.enabledLeagues?.includes(game.leagueCode))
    );
  });
  const emptyAvailabilityState = emptyCatalogAvailabilityState({
    discovery,
    dateMode: input.query.dateMode,
    from: effectiveQuery.from,
    to: effectiveQuery.to,
  });
  const availability = cached.stale
    ? {
        state: "stale",
        message: "The cached schedule is stale. Refresh before selecting games.",
      }
    : cached.delayed
      ? {
          state: "quotaDelayed",
          message: "Schedule refresh is delayed; cached data is shown.",
        }
      : visibleGames.length === 0
        ? {
            state: emptyAvailabilityState,
            message:
              emptyAvailabilityState === "offSeason"
                ? `${resolvedLeague?.name ?? "This league"} does not have games scheduled in this selected range.`
                : "No games are scheduled for this selected date.",
          }
        : {state: "available", message: null};
  const supportedSportCodes = new Set(
    enabledLeagues.map((item) => item.sportCode),
  );
  const sports = providerSports
    .filter((code) => supportedSportCodes.has(code))
    .map((code) => ({code, displayName: displayNameForCode(code)}));
  return {
    provider: provider.name,
    sports,
    leagues: enabledLeagues.map((item) => ({
      code: item.code,
      displayName: item.name,
      sportCode: item.sportCode,
      providerLeagueId: item.providerLeagueId,
      season: item.season,
    })),
    games: visibleGames.map((game) =>
      gameForClient(
        game,
        catalogSelectionState(game, {
          now,
          weekStartAt,
          weekEndAt,
          stale: cached.stale || cached.expiresAt <= now,
        }),
      ),
    ),
    cache: {
      hit: cached.cacheHit,
      stale: cached.stale,
      delayed: cached.delayed,
      cachedAt: cached.cachedAt.toISOString(),
      expiresAt: cached.expiresAt.toISOString(),
    },
    presentation: provider.presentation,
    effectiveQuery: {
      sportCode: effectiveQuery.sportCode,
      leagueCode: effectiveQuery.leagueCode,
      providerLeagueId: effectiveQuery.providerLeagueId,
      season: effectiveQuery.season,
      from: effectiveQuery.from,
      to: effectiveQuery.to,
      timezone: effectiveQuery.timezone,
      ...(discovery
        ? {dateMode: "allDates"}
        : input.query.dateMode === undefined
          ? {}
          : {dateMode: input.query.dateMode}),
    },
    availability,
    week: {
      startAt: weekStartAt.toISOString(),
      endAt: weekEndAt.toISOString(),
    },
  };
}

type RefreshResult = {
  updatedGameCount: number;
  delayed: boolean;
};

function materialSyncHash(value: DocumentData | NormalizedGame): string {
  return sha256({
    scheduledAtUtc: asDate(value.scheduledAtUtc, "scheduledAtUtc"),
    effectiveLockAtUtc: asDate(
      value.effectiveLockAtUtc,
      "effectiveLockAtUtc",
    ),
    venueName: value.venueName ?? null,
    neutralSite: value.neutralSite === true,
    homeTeam: value.homeTeam,
    awayTeam: value.awayTeam,
    status: value.status,
    homeScore: value.homeScore ?? null,
    awayScore: value.awayScore ?? null,
    winnerTeamId: value.winnerTeamId ?? null,
    resultVersion: value.resultVersion,
  });
}

export function preserveSelectedGameParticipants(
  current: NormalizedGame,
  refreshed: NormalizedGame,
): NormalizedGame {
  if (
    current.homeTeam.id === refreshed.homeTeam.id &&
    current.awayTeam.id === refreshed.awayTeam.id
  ) {
    return refreshed;
  }
  // A published provider ID may receive a malformed reassignment or a real
  // participant correction. Neither can silently rewrite the immutable slate
  // after members have picked against its original teams. Preserve those team
  // identities and route the provider change to commissioner review.
  const quarantined: NormalizedGame = {
    ...refreshed,
    homeTeam: current.homeTeam,
    awayTeam: current.awayTeam,
    status: "reviewRequired",
    homeScore: null,
    awayScore: null,
    winnerTeamId: null,
  };
  quarantined.resultVersion = resultVersionFor(quarantined);
  return quarantined;
}

export function protectedSelectedGameLock(input: {
  currentLockAt: Date;
  refreshedLockAt: Date;
  alreadyExposed: boolean;
}): Date {
  // Result refresh may tighten an unexposed lock after an earlier reschedule,
  // but it must never widen the published lock. In particular, every game in
  // a first-game-lock slate shares the earliest start even though the provider
  // continues to return each event's individual start.
  return input.alreadyExposed ||
    input.refreshedLockAt > input.currentLockAt
    ? input.currentLockAt
    : input.refreshedLockAt;
}

function selectedGameToQuery(
  game: QueryDocumentSnapshot,
  forceRefresh: boolean,
  timezone: string,
): ProviderQuery {
  const data = game.data();
  const scheduled = asDate(data.scheduledAtUtc, "scheduledAtUtc");
  const date = calendarDateInTimezone(scheduled, timezone);
  return {
    sportCode: String(data.sportCode),
    leagueCode: String(data.leagueCode),
    providerLeagueId: String(data.providerLeagueId ?? data.leagueCode),
    season: String(data.season),
    from: date,
    to: date,
    timezone,
    forceRefresh,
  };
}

export async function refreshWeekGames(input: {
  leagueId: string;
  weekId: string;
  actorUid: string;
  requestId: string;
  forceRefresh: boolean;
  skipAuthorization?: boolean;
}): Promise<RefreshResult> {
  if (input.skipAuthorization !== true) {
    await requireAdmin(input.leagueId, input.actorUid);
  }
  if (input.forceRefresh && input.skipAuthorization !== true) {
    await enforceManualRefreshRateLimit({
      leagueId: input.leagueId,
      actorUid: input.actorUid,
    });
  }
  const reference = weekReference(input.leagueId, input.weekId);
  const claimId = randomUUID();
  const claimedWeek = await claimResultMutation(
    reference,
    input.requestId,
    claimId,
  );
  try {
    const [selected, league] = await Promise.all([
      reference.collection("games").get(),
      db.collection("leagues").doc(input.leagueId).get(),
    ]);
    const timezone = String(league.data()?.timezone ?? "").trim();
    try {
      new Intl.DateTimeFormat("en-US", {timeZone: timezone}).format();
    } catch {
      throw new HttpsError(
        "failed-precondition",
        "The arena timezone configuration is invalid.",
      );
    }
    const groups = new Map<
      string,
      {query: ProviderQuery; documents: QueryDocumentSnapshot[]}
    >();
    for (const game of selected.docs) {
      const provider = String(game.data().provider);
      if (provider === "manual") continue;
      const query = selectedGameToQuery(game, input.forceRefresh, timezone);
      const key = sha256({
        provider,
        sportCode: query.sportCode,
        leagueCode: query.leagueCode,
        providerLeagueId: query.providerLeagueId,
        season: query.season,
        timezone: query.timezone,
        forceRefresh: query.forceRefresh === true,
      });
      const group = groups.get(key) ?? {query, documents: []};
      group.documents.push(game);
      groups.set(key, group);
    }
    let delayed = false;
    let updatedGameCount = 0;
    for (const group of groups.values()) {
      const providerName = String(group.documents[0]?.data().provider);
      if (!PROVIDER_NAMES.includes(providerName as ProviderName)) {
        throw new HttpsError(
          "failed-precondition",
          "A selected game has an unsupported sports provider.",
        );
      }
      const provider = await getProvider(providerName as ProviderName);
      for (let offset = 0; offset < group.documents.length; offset += 20) {
        const documents = group.documents.slice(offset, offset + 20);
        let refreshed: CachedGamesResult;
        try {
          refreshed = await fetchGamesByIdsWithCache(
            provider,
            documents.map((document) =>
              String(document.data().providerGameId),
            ),
            group.query,
          );
        } catch (_error: unknown) {
          delayed = true;
          continue;
        }
        delayed ||= refreshed.delayed;
        const byProviderId = new Map(
          refreshed.games.map((game) => [game.providerGameId, game]),
        );
        const updates: GameResultUpdate[] = [];
        for (const document of documents) {
          const current = document.data();
          if (current.manualOverride === true) continue;
          const providerUpdate = byProviderId.get(
            String(current.providerGameId),
          );
          if (providerUpdate === undefined) continue;
          const currentGame = normalizedGameSchema.parse(current);
          const next = preserveSelectedGameParticipants(
            currentGame,
            providerUpdate,
          );
          const currentLockAt = asDate(
            current.effectiveLockAtUtc,
            "effectiveLockAtUtc",
          );
          next.effectiveLockAtUtc = protectedSelectedGameLock({
            currentLockAt,
            refreshedLockAt: next.effectiveLockAtUtc,
            alreadyExposed:
              currentLockAt.valueOf() <= Date.now() ||
              current.pickRevealCompletedAt instanceof Timestamp,
          });
          next.publishedScheduledAtUtc = asDate(
            current.publishedScheduledAtUtc,
            "publishedScheduledAtUtc",
          );
          if (next.status === "cancelled") {
            next.status = "void";
            next.winnerTeamId = null;
            next.resultVersion = resultVersionFor(next);
          }
          if (materialSyncHash(next) !== materialSyncHash(current)) {
            updates.push({document, game: next});
          }
        }
        await commitGameResultUpdates(reference, claimId, updates);
        // Keep the lease live even when the provider returned no material
        // changes and commitGameResultUpdates therefore had no write batch.
        await heartbeatResultMutationClaim(reference, claimId);
        updatedGameCount += updates.length;
      }
    }
    const freshGames = await reference.collection("games").get();
    const statuses = freshGames.docs.map((game) => String(game.data().status));
    let status = claimedWeek.status;
    if (statuses.some((gameStatus) => gameStatus === "live")) {
      status = "inProgress";
    } else if (
      statuses.length > 0 &&
      statuses.every((gameStatus) => ["final", "void"].includes(gameStatus))
    ) {
      status = "review";
    }
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(reference);
      const data = current.data();
      assertResultMutationClaim(data, claimId);
      const update: Record<string, unknown> = {
        resultMutationHeartbeatAt: FieldValue.serverTimestamp(),
      };
      if (status !== data.status) {
        update.status = status;
        update.updatedAt = FieldValue.serverTimestamp();
      }
      transaction.update(reference, update);
    });
    await gradeWeek(input.leagueId, input.weekId);
    await writeAudit({
      leagueId: input.leagueId,
      eventType: "provider_results_synced",
      actorUid: input.actorUid,
      target: `weeks/${input.weekId}/games`,
      requestId: input.requestId,
      after: {updatedGameCount, delayed},
    });
    return {updatedGameCount, delayed};
  } finally {
    await releaseResultMutationClaim(reference, claimId);
  }
}

type RevealCursor = {
  gameId: string;
  afterUid: string | null;
};

type RevealPayloadPick = {
  uid: string;
  displayName: string;
  selectedTeamId: string;
  outcome: string;
  points: number;
};

type RevealPageMetadata = {
  included: boolean;
  truncated: boolean;
  nextCursor: RevealCursor | null;
  pageSize: number;
  returnedGameCount: number;
  returnedPickCount: number;
};

type RevealLockedPicksResult = {
  revealedGameCount: number;
  processingGameCount: number;
  revealsByGame: Record<string, RevealPayloadPick[]>;
  revealPage: RevealPageMetadata;
};

type RevealSource = {
  uid: string;
  pick: DocumentData;
  member: DocumentData;
};

type RevealClaimResult =
  | "claimed"
  | "completed"
  | "busy"
  | "not-locked";

export function isRevealClaimActive(
  data: DocumentData,
  now = Date.now(),
): boolean {
  const heartbeat =
    data.pickRevealHeartbeatAt instanceof Timestamp
      ? data.pickRevealHeartbeatAt
      : data.pickRevealStartedAt;
  return (
    typeof data.pickRevealClaimId === "string" &&
    heartbeat instanceof Timestamp &&
    heartbeat.toMillis() > now - OPERATION_CLAIM_TTL_MS
  );
}

export function revealPayloadReadsEnabled(
  includeRevealPayload: boolean | undefined,
): boolean {
  return includeRevealPayload !== false;
}

async function claimGameForReveal(input: {
  gameReference: FirebaseFirestore.DocumentReference;
  claimId: string;
  requestId: string;
  now: number;
}): Promise<RevealClaimResult> {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(input.gameReference);
    const data = snapshot.data();
    if (data === undefined) {
      return "not-locked";
    }
    const lockAt = data.effectiveLockAtUtc;
    if (!(lockAt instanceof Timestamp) || lockAt.toMillis() > input.now) {
      return "not-locked";
    }
    if (data.pickRevealCompletedAt instanceof Timestamp) {
      return "completed";
    }
    if (isRevealClaimActive(data, input.now)) {
      return "busy";
    }
    const claimedAt = Timestamp.fromMillis(input.now);
    transaction.update(input.gameReference, {
      pickRevealClaimId: input.claimId,
      pickRevealRequestId: input.requestId,
      pickRevealStartedAt: claimedAt,
      pickRevealHeartbeatAt: claimedAt,
    });
    return "claimed";
  });
}

async function renewRevealClaim(
  gameReference: FirebaseFirestore.DocumentReference,
  claimId: string,
): Promise<void> {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(gameReference);
    if (
      snapshot.data()?.pickRevealClaimId !== claimId ||
      snapshot.data()?.pickRevealCompletedAt instanceof Timestamp
    ) {
      throw new HttpsError(
        "aborted",
        "The reveal claim changed while picks were being processed.",
      );
    }
    transaction.update(gameReference, {
      pickRevealHeartbeatAt: Timestamp.now(),
    });
  });
}

async function releaseRevealClaim(
  gameReference: FirebaseFirestore.DocumentReference,
  claimId: string,
): Promise<void> {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(gameReference);
    if (snapshot.data()?.pickRevealClaimId !== claimId) return;
    transaction.update(gameReference, {
      pickRevealClaimId: FieldValue.delete(),
      pickRevealRequestId: FieldValue.delete(),
      pickRevealStartedAt: FieldValue.delete(),
      pickRevealHeartbeatAt: FieldValue.delete(),
    });
  });
}

async function revealSourcesForGame(input: {
  entries: QueryDocumentSnapshot[];
  gameId: string;
  membersByUid: Map<string, DocumentData>;
  gameReference: FirebaseFirestore.DocumentReference;
  claimId: string;
}): Promise<RevealSource[]> {
  const reveals: RevealSource[] = [];
  for (
    let index = 0;
    index < input.entries.length;
    index += REVEAL_PICK_READ_CONCURRENCY
  ) {
    const entryChunk = input.entries.slice(
      index,
      index + REVEAL_PICK_READ_CONCURRENCY,
    );
    const picks = await Promise.all(
      entryChunk.map((entry) =>
        entry.ref.collection("picks").doc(input.gameId).get(),
      ),
    );
    picks.forEach((pick, pickIndex) => {
      const entry = entryChunk[pickIndex];
      if (!pick.exists || entry === undefined) return;
      reveals.push({
        uid: entry.id,
        pick: pick.data() ?? {},
        member: input.membersByUid.get(entry.id) ?? {},
      });
    });
    await renewRevealClaim(input.gameReference, input.claimId);
  }
  return reveals;
}

async function writeRevealSources(input: {
  gameReference: FirebaseFirestore.DocumentReference;
  revealPicksReference: FirebaseFirestore.CollectionReference;
  claimId: string;
  reveals: RevealSource[];
}): Promise<void> {
  for (
    let index = 0;
    index < input.reveals.length;
    index += REVEAL_WRITE_CHUNK_SIZE
  ) {
    const revealChunk = input.reveals.slice(
      index,
      index + REVEAL_WRITE_CHUNK_SIZE,
    );
    await db.runTransaction(async (transaction) => {
      const game = await transaction.get(input.gameReference);
      if (
        game.data()?.pickRevealClaimId !== input.claimId ||
        game.data()?.pickRevealCompletedAt instanceof Timestamp
      ) {
        throw new HttpsError(
          "aborted",
          "The reveal claim changed before picks were committed.",
        );
      }
      for (const reveal of revealChunk) {
        transaction.set(
          input.revealPicksReference.doc(reveal.uid),
          {
            uid: reveal.uid,
            selectedTeamId:
              typeof reveal.pick.selectedTeamId === "string"
                ? reveal.pick.selectedTeamId.slice(0, 128)
                : "",
            displayName:
              typeof reveal.member.displayName === "string"
                ? reveal.member.displayName.slice(0, 80)
                : "Member",
            photoUrl:
              typeof reveal.member.photoUrl === "string"
                ? reveal.member.photoUrl.slice(0, 2048)
                : null,
            revealedAt: FieldValue.serverTimestamp(),
          },
          {merge: true},
        );
      }
      transaction.update(input.gameReference, {
        pickRevealHeartbeatAt: Timestamp.now(),
      });
    });
  }
}

async function finalizeRevealClaim(
  gameReference: FirebaseFirestore.DocumentReference,
  claimId: string,
): Promise<boolean> {
  return db.runTransaction(async (transaction) => {
    const game = await transaction.get(gameReference);
    if (game.data()?.pickRevealCompletedAt instanceof Timestamp) {
      return false;
    }
    if (game.data()?.pickRevealClaimId !== claimId) {
      throw new HttpsError(
        "aborted",
        "The reveal claim changed before processing completed.",
      );
    }
    transaction.update(gameReference, {
      pickRevealCompletedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      pickRevealClaimId: FieldValue.delete(),
      pickRevealRequestId: FieldValue.delete(),
      pickRevealStartedAt: FieldValue.delete(),
      pickRevealHeartbeatAt: FieldValue.delete(),
    });
    return true;
  });
}

function revealPayload(document: QueryDocumentSnapshot): RevealPayloadPick {
  const data = document.data();
  const rawOutcome =
    typeof data.outcome === "string" ? data.outcome : "pending";
  return {
    uid: document.id.slice(0, 128),
    displayName:
      typeof data.displayName === "string"
        ? data.displayName.slice(0, 80)
        : "Member",
    selectedTeamId:
      typeof data.selectedTeamId === "string"
        ? data.selectedTeamId.slice(0, 128)
        : "",
    outcome: ["pending", "correct", "incorrect", "void"].includes(rawOutcome)
      ? rawOutcome
      : "pending",
    points:
      typeof data.points === "number" && Number.isFinite(data.points)
        ? data.points
        : 0,
  };
}

function firstGameAtOrAfter(
  gameIds: string[],
  requestedGameId: string,
): number {
  const exact = gameIds.indexOf(requestedGameId);
  if (exact >= 0) return exact;
  const following = gameIds.findIndex((gameId) => gameId > requestedGameId);
  return following >= 0 ? following : gameIds.length;
}

async function readRevealPage(input: {
  weekReference: FirebaseFirestore.DocumentReference;
  completedGameIds: string[];
  cursor: RevealCursor | null;
  pageSize: number;
}): Promise<{
  revealsByGame: Record<string, RevealPayloadPick[]>;
  metadata: RevealPageMetadata;
}> {
  const gameIds = [...new Set(input.completedGameIds)].sort();
  const revealsByGame: Record<string, RevealPayloadPick[]> = {};
  let gameIndex =
    input.cursor === null
      ? 0
      : firstGameAtOrAfter(gameIds, input.cursor.gameId);
  let afterUid =
    input.cursor !== null && gameIds[gameIndex] === input.cursor.gameId
      ? input.cursor.afterUid
      : null;
  let returnedPickCount = 0;
  let visitedGameCount = 0;
  let nextCursor: RevealCursor | null = null;

  while (
    gameIndex < gameIds.length &&
    returnedPickCount < input.pageSize &&
    visitedGameCount < MAX_REVEAL_GAMES_PER_PAGE
  ) {
    const gameId = gameIds[gameIndex];
    if (gameId === undefined) break;
    const remaining = input.pageSize - returnedPickCount;
    let query: FirebaseFirestore.Query = input.weekReference
      .collection("reveals")
      .doc(gameId)
      .collection("picks")
      .orderBy(FieldPath.documentId());
    if (afterUid !== null) {
      query = query.startAfter(afterUid);
    }
    const committedReveals = await query.limit(remaining + 1).get();
    const pageDocuments = committedReveals.docs.slice(0, remaining);
    revealsByGame[gameId] = pageDocuments.map(revealPayload);
    returnedPickCount += pageDocuments.length;
    visitedGameCount += 1;

    if (committedReveals.size > remaining) {
      const lastDocument = pageDocuments.at(-1);
      nextCursor =
        lastDocument === undefined
          ? {gameId, afterUid}
          : {gameId, afterUid: lastDocument.id};
      break;
    }

    gameIndex += 1;
    afterUid = null;
    if (
      gameIndex < gameIds.length &&
      (returnedPickCount >= input.pageSize ||
        visitedGameCount >= MAX_REVEAL_GAMES_PER_PAGE)
    ) {
      const nextGameId = gameIds[gameIndex];
      if (nextGameId !== undefined) {
        nextCursor = {gameId: nextGameId, afterUid: null};
      }
      break;
    }
  }

  return {
    revealsByGame,
    metadata: {
      included: true,
      truncated: nextCursor !== null,
      nextCursor,
      pageSize: input.pageSize,
      returnedGameCount: Object.keys(revealsByGame).length,
      returnedPickCount,
    },
  };
}

export async function revealLockedPicks(input: {
  leagueId: string;
  weekId: string;
  actorUid: string;
  requestId: string;
  skipAuthorization?: boolean;
  includeRevealPayload?: boolean;
  revealCursor?: RevealCursor | null;
  revealPageSize?: number;
}): Promise<RevealLockedPicksResult> {
  if (input.skipAuthorization !== true) {
    await requireAdmin(input.leagueId, input.actorUid);
  }
  const reference = weekReference(input.leagueId, input.weekId);
  const games = await reference.collection("games").get();
  const completedGameIds = new Set<string>();
  let revealContext:
    | Promise<{
        entries: QueryDocumentSnapshot[];
        membersByUid: Map<string, DocumentData>;
      }>
    | undefined;
  let revealedGameCount = 0;
  let processingGameCount = 0;
  const processLockedGames = input.revealCursor == null;
  const now = Date.now();

  for (const game of games.docs) {
    const data = game.data();
    const lockAt = data.effectiveLockAtUtc;
    if (!(lockAt instanceof Timestamp) || lockAt.toMillis() > now) {
      continue;
    }
    if (data.pickRevealCompletedAt instanceof Timestamp) {
      completedGameIds.add(game.id);
      continue;
    }
    if (!processLockedGames) continue;

    const claimId = randomUUID();
    const claim = await claimGameForReveal({
      gameReference: game.ref,
      claimId,
      requestId: input.requestId,
      now: Date.now(),
    });
    if (claim === "completed") {
      completedGameIds.add(game.id);
      continue;
    }
    if (claim === "busy") {
      processingGameCount += 1;
      continue;
    }
    if (claim !== "claimed") continue;

    try {
      revealContext ??= Promise.all([
        reference.collection("entries").get(),
        db
          .collection("leagues")
          .doc(input.leagueId)
          .collection("members")
          .get(),
      ]).then(([entries, members]) => ({
        entries: entries.docs,
        membersByUid: new Map(
          members.docs.map((member) => [member.id, member.data()]),
        ),
      }));
      const context = await revealContext;
      const revealPicksReference = reference
        .collection("reveals")
        .doc(game.id)
        .collection("picks");
      const reveals = await revealSourcesForGame({
        entries: context.entries,
        gameId: game.id,
        membersByUid: context.membersByUid,
        gameReference: game.ref,
        claimId,
      });
      await writeRevealSources({
        gameReference: game.ref,
        revealPicksReference,
        claimId,
        reveals,
      });
      if (await finalizeRevealClaim(game.ref, claimId)) {
        revealedGameCount += 1;
      }
      completedGameIds.add(game.id);
    } catch (error: unknown) {
      try {
        await releaseRevealClaim(game.ref, claimId);
      } catch (releaseError: unknown) {
        logger.warn("Reveal claim release failed", {
          leagueId: input.leagueId,
          weekId: input.weekId,
          gameId: game.id,
          requestId: input.requestId,
          safeErrorCode:
            releaseError instanceof Error
              ? releaseError.name
              : "UnknownError",
        });
      }
      throw error;
    }
  }

  const pageSize = Math.min(
    MAX_REVEAL_PAGE_SIZE,
    Math.max(1, Math.floor(input.revealPageSize ?? DEFAULT_REVEAL_PAGE_SIZE)),
  );
  const includeRevealPayload = revealPayloadReadsEnabled(
    input.includeRevealPayload,
  );
  if (
    processLockedGames &&
    completedGameIds.size > 0 &&
    input.skipAuthorization !== true &&
    includeRevealPayload
  ) {
    try {
      await gradeWeekWithResultClaim({
        leagueId: input.leagueId,
        weekId: input.weekId,
        requestId: input.requestId,
      });
    } catch (error: unknown) {
      // A concurrent reveal/result operation may own the short-lived result
      // lease. Reveals are already durable, so return them and let the winning
      // operation, an explicit retry, or the scheduler finish grading.
      if (!(error instanceof HttpsError) || error.code !== "aborted") {
        throw error;
      }
      logger.info("Reveal grading deferred behind an active result lease", {
        leagueId: input.leagueId,
        weekId: input.weekId,
        requestId: input.requestId,
      });
    }
  }
  if (!includeRevealPayload) {
    return {
      revealedGameCount,
      processingGameCount,
      revealsByGame: {},
      revealPage: {
        included: false,
        truncated: false,
        nextCursor: null,
        pageSize,
        returnedGameCount: 0,
        returnedPickCount: 0,
      },
    };
  }
  const page = await readRevealPage({
    weekReference: reference,
    completedGameIds: [...completedGameIds],
    cursor: input.revealCursor ?? null,
    pageSize,
  });
  return {
    revealedGameCount,
    processingGameCount,
    revealsByGame: page.revealsByGame,
    revealPage: page.metadata,
  };
}

export async function overrideResult(input: {
  leagueId: string;
  weekId: string;
  gameId: string;
  actorUid: string;
  requestId: string;
  status: "final" | "void" | "reviewRequired";
  homeScore: number | null;
  awayScore: number | null;
  winnerTeamId: string | null;
  reason: string;
}): Promise<{resultVersion: string}> {
  await requireAdmin(input.leagueId, input.actorUid);
  const reference = weekReference(input.leagueId, input.weekId);
  const gameReference = reference.collection("games").doc(input.gameId);
  const claimId = randomUUID();
  await claimResultMutation(reference, input.requestId, claimId);
  try {
    const mutation = await db.runTransaction(async (transaction) => {
      const [week, game] = await Promise.all([
        transaction.get(reference),
        transaction.get(gameReference),
      ]);
      assertResultMutationClaim(week.data(), claimId);
      const current = game.data();
      if (current === undefined) {
        throw new HttpsError("not-found", "Game not found.");
      }
      const validTeamIds = [current.homeTeam?.id, current.awayTeam?.id];
      if (input.status === "final") {
        const expectedWinnerTeamId =
          input.homeScore !== null &&
          input.awayScore !== null &&
          input.homeScore !== input.awayScore
            ? input.homeScore > input.awayScore
              ? current.homeTeam?.id
              : current.awayTeam?.id
            : null;
        if (
          input.homeScore === null ||
          input.awayScore === null ||
          input.homeScore === input.awayScore ||
          input.winnerTeamId === null ||
          !validTeamIds.includes(input.winnerTeamId) ||
          input.winnerTeamId !== expectedWinnerTeamId
        ) {
          throw new HttpsError(
            "invalid-argument",
            "A final result needs non-tied scores and the matching winning team.",
          );
        }
      } else if (input.winnerTeamId !== null) {
        throw new HttpsError(
          "invalid-argument",
          "Void or review-required games cannot have a winner.",
        );
      }
      const resultVersion = resultVersionFor({
        status: input.status,
        homeScore: input.homeScore,
        awayScore: input.awayScore,
        winnerTeamId: input.winnerTeamId,
        manualOverride: true,
      });
      transaction.update(gameReference, {
        status: input.status,
        homeScore: input.homeScore,
        awayScore: input.awayScore,
        winnerTeamId: input.winnerTeamId,
        manualOverride: true,
        manualOverrideReason: input.reason,
        manualOverrideBy: input.actorUid,
        resultVersion,
        providerLastUpdatedAt: FieldValue.serverTimestamp(),
        lastSyncedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(reference, {
        gameResultsVersion: FieldValue.increment(1),
        resultMutationHeartbeatAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {current, resultVersion};
    });
    await writeAudit({
      leagueId: input.leagueId,
      eventType: input.status === "void" ? "game_voided" : "game_overridden",
      actorUid: input.actorUid,
      target: `weeks/${input.weekId}/games/${input.gameId}`,
      requestId: input.requestId,
      reason: input.reason,
      before: {
        status: mutation.current.status,
        homeScore: mutation.current.homeScore,
        awayScore: mutation.current.awayScore,
        winnerTeamId: mutation.current.winnerTeamId,
        resultVersion: mutation.current.resultVersion,
      },
      after: {
        status: input.status,
        homeScore: input.homeScore,
        awayScore: input.awayScore,
        winnerTeamId: input.winnerTeamId,
        resultVersion: mutation.resultVersion,
      },
    });
    await gradeWeek(input.leagueId, input.weekId);
    return {resultVersion: mutation.resultVersion};
  } finally {
    await releaseResultMutationClaim(reference, claimId);
  }
}

export async function reopenWeekRecord(input: {
  leagueId: string;
  weekId: string;
  actorUid: string;
  requestId: string;
  reason: string;
}): Promise<void> {
  await requireAdmin(input.leagueId, input.actorUid);
  const leagueReference = db.collection("leagues").doc(input.leagueId);
  const reference = leagueReference.collection("weeks").doc(input.weekId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new HttpsError("not-found", "Week not found.");
    const data = snapshot.data() ?? {};
    if (data.status === "reopened") return;
    if (data.status !== "finalized") {
      throw new HttpsError(
        "failed-precondition",
        "Only a finalized week can be reopened.",
      );
    }
    if (finalizationFollowUpClaimIsActive(data)) {
      throw new HttpsError(
        "aborted",
        "Finalization follow-ups are still running. Try again shortly.",
      );
    }
    transaction.update(reference, {
      status: "reopened",
      finalizedAt: null,
      reopenedAt: FieldValue.serverTimestamp(),
      reopenedBy: input.actorUid,
      reopenReason: input.reason,
      finalizationFollowUpsCompletedAt: FieldValue.delete(),
      finalizationFollowUpsResultVersion: FieldValue.delete(),
      finalizationFollowUpsRequestId: FieldValue.delete(),
      finalizationFollowUpsClaimId: FieldValue.delete(),
      finalizationFollowUpsStartedAt: FieldValue.delete(),
      finalizationFollowUpsHeartbeatAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
      resultVersion: FieldValue.increment(1),
    });
    transaction.update(leagueReference, {
      standingsEpoch: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAuditInTransaction(transaction, {
      leagueId: input.leagueId,
      eventType: "week_reopened",
      actorUid: input.actorUid,
      target: `weeks/${input.weekId}`,
      requestId: input.requestId,
      reason: input.reason,
      before: {status: "finalized"},
      after: {status: "reopened"},
    });
  });
  await rebuildLeagueStandings(input.leagueId);
}

export async function manualGame(input: {
  leagueId: string;
  weekId: string;
  actorUid: string;
  requestId: string;
  sportCode: string;
  leagueCode: string;
  leagueName: string;
  season: string;
  scheduledAtUtc: Date;
  venueName: string | null;
  neutralSite: boolean;
  homeTeam: {id: string; name: string; shortName: string; abbreviation: string};
  awayTeam: {id: string; name: string; shortName: string; abbreviation: string};
}): Promise<{gameId: string}> {
  await requirePickerOrAdmin(
    input.leagueId,
    input.weekId,
    input.actorUid,
  );
  const now = new Date();
  const providerGameId = `manual-${sha256({
    leagueId: input.leagueId,
    weekId: input.weekId,
    requestId: input.requestId,
  }).slice(0, 20)}`;
  const game = withSourceHash(
    {
      id: `manual:${input.sportCode}:${providerGameId}`,
      provider: "manual",
      providerGameId,
      providerLeagueId: input.leagueCode,
      sportCode: input.sportCode,
      leagueCode: input.leagueCode,
      leagueName: input.leagueName,
      season: input.season,
      weekOrRound: null,
      scheduledAtUtc: input.scheduledAtUtc,
      publishedScheduledAtUtc: input.scheduledAtUtc,
      effectiveLockAtUtc: input.scheduledAtUtc,
      venueName: input.venueName,
      neutralSite: input.neutralSite,
      homeTeam: {...input.homeTeam, logoUrl: null},
      awayTeam: {...input.awayTeam, logoUrl: null},
      status: "scheduled",
      homeScore: null,
      awayScore: null,
      winnerTeamId: null,
      providerLastUpdatedAt: now,
      lastSyncedAt: now,
      manualOverride: false,
      manualOverrideReason: null,
      manualOverrideBy: null,
    },
    {
      providerGameId,
      scheduledAtUtc: input.scheduledAtUtc.toISOString(),
      homeTeam: input.homeTeam,
      awayTeam: input.awayTeam,
    },
  );
  const reference = weekReference(input.leagueId, input.weekId);
  const gameReference = reference.collection("games").doc(game.id);
  await db.runTransaction(async (transaction) => {
    const [currentWeek, existingGame] = await Promise.all([
      transaction.get(reference),
      transaction.get(gameReference),
    ]);
    const data = currentWeek.data();
    if (data === undefined) {
      throw new HttpsError("not-found", "Week not found.");
    }
    if (existingGame.exists) {
      return;
    }
    if (data.status !== "draft") {
      throw new HttpsError(
        "failed-precondition",
        "Manual games can only be added to a draft week.",
      );
    }
    if (input.scheduledAtUtc.valueOf() <= Date.now()) {
      throw new HttpsError(
        "invalid-argument",
        "Manual games must be scheduled in the future.",
      );
    }
    if (
      publishClaimIsActive(data) ||
      hasActiveClaim(
        data,
        "draftMutationRequestId",
        "draftMutationStartedAt",
      )
    ) {
      throw new HttpsError(
        "aborted",
        "The draft is currently being updated.",
      );
    }
    const weekStartAt = asDate(data.startAt, "week startAt");
    const weekEndAt = asDate(data.endAt, "week endAt");
    if (
      input.scheduledAtUtc.valueOf() < weekStartAt.valueOf() ||
      input.scheduledAtUtc.valueOf() > weekEndAt.valueOf()
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Manual games must be scheduled within the week.",
      );
    }
    transaction.create(gameReference, {
      ...toStoredGame(game),
      selectedByPickerUid: input.actorUid,
      selectedAt: FieldValue.serverTimestamp(),
      pickRevealCompletedAt: null,
      gradingStatus: "pending",
    });
    transaction.update(reference, {
      selectedGameCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeAuditInTransaction(transaction, {
      leagueId: input.leagueId,
      eventType: "manual_game_created",
      actorUid: input.actorUid,
      target: `weeks/${input.weekId}/games/${game.id}`,
      requestId: input.requestId,
      after: {
        gameId: game.id,
        scheduledAtUtc: input.scheduledAtUtc.toISOString(),
      },
    });
  });
  return {gameId: game.id};
}

export async function advanceRotation(input: {
  leagueId: string;
  weekId: string;
  actorUid: string;
}): Promise<{nextPickerUid: string | null}> {
  await requireAdmin(input.leagueId, input.actorUid);
  const week = await weekReference(input.leagueId, input.weekId).get();
  if (week.data()?.status !== "finalized") {
    throw new HttpsError(
      "failed-precondition",
      "Rotation advances only after finalization.",
    );
  }
  return {
    nextPickerUid: await advanceRotationOnce(input.leagueId, input.weekId),
  };
}

export async function syncActiveWeeks(): Promise<void> {
  const leagues = await db.collection("leagues").where("status", "==", "active").get();
  let failures = 0;
  let processed = 0;
  for (const league of leagues.docs) {
    const weeks = await league.ref
      .collection("weeks")
      .where("status", "in", ["open", "inProgress", "review"])
      .get();
    for (const week of weeks.docs) {
      processed += 1;
      const requestId = `scheduled-${Date.now()}-${league.id}-${week.id}`;
      try {
        await revealLockedPicks({
          leagueId: league.id,
          weekId: week.id,
          actorUid: "system",
          requestId,
          skipAuthorization: true,
          includeRevealPayload: false,
        });
        await refreshWeekGames({
          leagueId: league.id,
          weekId: week.id,
          actorUid: "system",
          requestId,
          forceRefresh: false,
          skipAuthorization: true,
        });
      } catch (error: unknown) {
        failures += 1;
        logger.error("Scheduled week sync failed", {
          functionName: "scheduledResultSync",
          leagueId: league.id,
          weekId: week.id,
          safeErrorCode: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }
  }
  if (failures > 0) {
    throw new Error(
      `Scheduled sync failed for ${failures} of ${processed} active weeks.`,
    );
  }
}
