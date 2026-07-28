import {
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
import {normalizedGameSchema} from "../schemas.js";
import type {
  LeagueSettings,
  NormalizedGame,
  ProviderQuery,
} from "../types.js";
import {
  asDate,
  commitWritesInChunks,
  sha256,
  toStoredGame,
} from "../utils.js";
import {
  advanceRotationOnce,
  gradeWeek,
  rebuildLeagueStandings,
} from "./scoring.js";
import {
  enforceManualRefreshRateLimit,
  listGamesWithCache,
  providerUsageSummary,
  type CachedGamesResult,
} from "./providerGateway.js";

function weekReference(leagueId: string, weekId: string) {
  return db
    .collection("leagues")
    .doc(leagueId)
    .collection("weeks")
    .doc(weekId);
}

function gameForClient(game: NormalizedGame): Record<string, unknown> {
  return {
    ...game,
    scheduledAtUtc: game.scheduledAtUtc.toISOString(),
    publishedScheduledAtUtc: game.publishedScheduledAtUtc.toISOString(),
    effectiveLockAtUtc: game.effectiveLockAtUtc.toISOString(),
    providerLastUpdatedAt: game.providerLastUpdatedAt.toISOString(),
    lastSyncedAt: game.lastSyncedAt.toISOString(),
  };
}

const OPERATION_CLAIM_TTL_MS = 5 * 60_000;
const SELECTABLE_CATALOG_STATUSES = new Set([
  "scheduled",
  "delayed",
  "postponed",
]);

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
  requestId: string,
): Promise<void> {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (snapshot.data()?.publishRequestId === requestId) {
      transaction.update(reference, {
        publishRequestId: FieldValue.delete(),
        publishStartedAt: FieldValue.delete(),
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
    }
    const pickerUid =
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
      hasActiveClaim(weekData, "publishRequestId", "publishStartedAt") ||
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
    for (const snapshot of snapshots) {
      const data = snapshot.data();
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
    if (hasActiveClaim(data, "publishRequestId", "publishStartedAt")) {
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
      publishStartedAt: FieldValue.delete(),
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

export async function publishSlate(input: {
  leagueId: string;
  weekId: string;
  actorUid: string;
  requestId: string;
}): Promise<{
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
  if (week.status === "open" || week.status === "inProgress") {
    return {
      published: true,
      eligibleMemberCount: Number(week.eligibleMemberCount ?? 0),
      selectedGameCount: Number(week.selectedGameCount ?? 0),
    };
  }
  const claim = await db.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    const data = current.data();
    if (data === undefined) {
      throw new HttpsError("not-found", "Week not found.");
    }
    if (["open", "inProgress"].includes(String(data.status))) {
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
    if (
      hasActiveClaim(data, "publishRequestId", "publishStartedAt") &&
      data.publishRequestId !== input.requestId
    ) {
      throw new HttpsError(
        "aborted",
        "This slate is already being published.",
      );
    }
    transaction.update(reference, {
      publishRequestId: input.requestId,
      publishStartedAt: FieldValue.serverTimestamp(),
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
    const [games, members, existingEntries] = await Promise.all([
      reference.collection("games").get(),
      db
        .collection("leagues")
        .doc(input.leagueId)
        .collection("members")
        .where("status", "==", "active")
        .get(),
      reference.collection("entries").get(),
    ]);
    if (games.empty) {
      throw new HttpsError(
        "failed-precondition",
        "Select at least one game before publishing.",
      );
    }
    const now = Date.now();
    if (
      games.docs.some((game) => {
        const data = game.data();
        return (
          !SELECTABLE_CATALOG_STATUSES.has(String(data.status)) ||
          !(data.effectiveLockAtUtc instanceof Timestamp) ||
          data.effectiveLockAtUtc.toMillis() <= now
        );
      })
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Every slate game must still be upcoming and open for picks.",
      );
    }
    const earliestLock = Math.min(
      ...games.docs.map((game) =>
        asDate(game.data().scheduledAtUtc, "scheduledAtUtc").valueOf(),
      ),
    );
    if (claim.week.lockPolicySnapshot === "firstGame") {
      await commitWritesInChunks(db, games.docs, (batch, game) => {
        batch.update(game.ref, {
          effectiveLockAtUtc: Timestamp.fromMillis(earliestLock),
        });
      });
    }
    const eligibleMembers = members.docs.filter((member) =>
      memberEligible(
        member,
        input.weekId,
        Number(claim.week.sequentialNumber ?? 0),
      ),
    );
    const eligibleIds = new Set(eligibleMembers.map((member) => member.id));
    await commitWritesInChunks(db, eligibleMembers, (batch, member) => {
      const pickerExcluded =
        member.id === claim.week.pickerUid &&
        claim.week.pickerParticipatesSnapshot !== true;
      batch.set(reference.collection("entries").doc(member.id), {
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
    });
    await commitWritesInChunks(
      db,
      existingEntries.docs.filter((entry) => !eligibleIds.has(entry.id)),
      (batch, entry) => {
        batch.delete(entry.ref);
      },
    );
    const eligibleMemberCount = eligibleMembers.filter(
      (member) =>
        member.id !== claim.week.pickerUid ||
        claim.week.pickerParticipatesSnapshot === true,
    ).length;
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(reference);
      const data = current.data();
      if (
        data?.status === "open" &&
        data.publishedRequestId === input.requestId
      ) {
        return;
      }
      if (
        data?.status !== "draft" ||
        data.publishRequestId !== input.requestId
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
        updatedAt: FieldValue.serverTimestamp(),
        publishRequestId: FieldValue.delete(),
        publishStartedAt: FieldValue.delete(),
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
    });
    return {
      published: true,
      eligibleMemberCount,
      selectedGameCount: games.size,
    };
  } finally {
    await releasePublishClaim(reference, input.requestId);
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
    });
  }
  const [saved, required] = await Promise.all([
    entryReference.collection("picks").count().get(),
    reference.collection("games").count().get(),
  ]);
  const savedPickCount = saved.data().count;
  const totalRequiredPickCount = required.data().count;
  const completionState =
    savedPickCount >= totalRequiredPickCount ? "complete" : "inProgress";
  const currentEntry = await entryReference.get();
  await entryReference.set(
    {
      savedPickCount,
      totalRequiredPickCount,
      completionState,
      submittedAt:
        completionState === "complete"
          ? FieldValue.serverTimestamp()
          : currentEntry.data()?.submittedAt ?? null,
      lastSyncedAt: FieldValue.serverTimestamp(),
    },
    {merge: true},
  );
  return {savedPickCount, totalRequiredPickCount, completionState};
}

export async function listCatalog(input: {
  leagueId: string;
  actorUid: string;
  query: ProviderQuery;
}): Promise<Record<string, unknown>> {
  await requireMembership(input.leagueId, input.actorUid);
  if (input.query.forceRefresh === true) {
    await requireAdmin(input.leagueId, input.actorUid);
    await enforceManualRefreshRateLimit({
      leagueId: input.leagueId,
      actorUid: input.actorUid,
    });
  }
  const league = await db.collection("leagues").doc(input.leagueId).get();
  const settings =
    (league.data()?.settings as Partial<LeagueSettings> | undefined) ?? {};
  if (
    (settings.enabledSports?.length ?? 0) > 0 &&
    !settings.enabledSports?.includes(input.query.sportCode)
  ) {
    throw new HttpsError(
      "failed-precondition",
      "This sport is not enabled for the arena.",
    );
  }
  if (
    (settings.enabledLeagues?.length ?? 0) > 0 &&
    !settings.enabledLeagues?.includes(input.query.leagueCode)
  ) {
    throw new HttpsError(
      "failed-precondition",
      "This league is not enabled for the arena.",
    );
  }
  const providerName =
    settings.providerName === "apiSports"
      ? "apiSports"
      : settings.providerName === "manual"
        ? "manual"
        : "mock";
  const provider = await getProvider(providerName);
  const [sports, leagues, cached] = await Promise.all([
    provider.listSupportedSports(),
    provider.listLeagues(input.query.sportCode),
    listGamesWithCache(provider, input.query),
  ]);
  return {
    provider: provider.name,
    sports,
    leagues,
    games:
      cached.stale || cached.expiresAt.valueOf() <= Date.now()
        ? []
        : cached.games
            .filter((game) =>
              isCatalogGameSelectable(game, {
                now: new Date(),
                enabledSports: settings.enabledSports ?? [],
                enabledLeagues: settings.enabledLeagues ?? [],
              }),
            )
            .map(gameForClient),
    cache: {
      hit: cached.cacheHit,
      stale: cached.stale,
      delayed: cached.delayed,
      cachedAt: cached.cachedAt.toISOString(),
      expiresAt: cached.expiresAt.toISOString(),
    },
    usage: await providerUsageSummary(provider.name),
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

function selectedGameToQuery(
  game: QueryDocumentSnapshot,
  forceRefresh: boolean,
): ProviderQuery {
  const data = game.data();
  const scheduled = asDate(data.scheduledAtUtc, "scheduledAtUtc");
  const date = scheduled.toISOString().slice(0, 10);
  return {
    sportCode: String(data.sportCode),
    leagueCode: String(data.leagueCode),
    leagueId: String(data.providerLeagueId ?? data.leagueCode),
    season: String(data.season),
    from: date,
    to: date,
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
  const [week, selected] = await Promise.all([
    reference.get(),
    reference.collection("games").get(),
  ]);
  if (!week.exists) throw new HttpsError("not-found", "Week not found.");
  if (typeof week.data()?.finalizationRequestId === "string") {
    throw new HttpsError(
      "aborted",
      "Week finalization is in progress.",
    );
  }
  if (week.data()?.status === "finalized") {
    throw new HttpsError(
      "failed-precondition",
      "Reopen the week before applying provider corrections.",
    );
  }
  const groups = new Map<
    string,
    {query: ProviderQuery; documents: QueryDocumentSnapshot[]}
  >();
  for (const game of selected.docs) {
    const provider = String(game.data().provider);
    if (provider === "manual") continue;
    const query = selectedGameToQuery(game, input.forceRefresh);
    const key = sha256({provider, ...query});
    const group = groups.get(key) ?? {query, documents: []};
    group.documents.push(game);
    groups.set(key, group);
  }
  let delayed = false;
  let updatedGameCount = 0;
  for (const group of groups.values()) {
    const providerName = String(group.documents[0]?.data().provider);
    const provider = await getProvider(
      providerName === "apiSports" ? "apiSports" : "mock",
    );
    let refreshed: CachedGamesResult;
    try {
      refreshed = await listGamesWithCache(provider, group.query);
    } catch (_error: unknown) {
      delayed = true;
      continue;
    }
    delayed ||= refreshed.delayed;
    const byProviderId = new Map(
      refreshed.games.map((game) => [game.providerGameId, game]),
    );
    const updates: Array<{
      document: QueryDocumentSnapshot;
      game: NormalizedGame;
    }> = [];
    for (const document of group.documents) {
      const current = document.data();
      if (current.manualOverride === true) continue;
      const next = byProviderId.get(String(current.providerGameId));
      if (next === undefined) continue;
      const lockPassed =
        current.effectiveLockAtUtc instanceof Timestamp &&
        current.effectiveLockAtUtc.toMillis() <= Date.now();
      if (lockPassed || current.pickRevealCompletedAt instanceof Timestamp) {
        next.effectiveLockAtUtc = asDate(
          current.effectiveLockAtUtc,
          "effectiveLockAtUtc",
        );
      }
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
    await commitWritesInChunks(db, updates, (batch, update) => {
      batch.set(update.document.ref, toStoredGame(update.game), {merge: true});
    });
    updatedGameCount += updates.length;
  }
  const freshGames = await reference.collection("games").get();
  const statuses = freshGames.docs.map((game) => String(game.data().status));
  let status = week.data()?.status;
  if (statuses.some((gameStatus) => gameStatus === "live")) {
    status = "inProgress";
  } else if (
    statuses.length > 0 &&
    statuses.every((gameStatus) => ["final", "void"].includes(gameStatus))
  ) {
    status = "review";
  }
  if (status !== week.data()?.status) {
    await reference.update({status, updatedAt: FieldValue.serverTimestamp()});
  }
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
}

export async function revealLockedPicks(input: {
  leagueId: string;
  weekId: string;
  actorUid: string;
  requestId: string;
  skipAuthorization?: boolean;
}): Promise<{revealedGameCount: number}> {
  if (input.skipAuthorization !== true) {
    await requireAdmin(input.leagueId, input.actorUid);
  }
  const reference = weekReference(input.leagueId, input.weekId);
  const [games, entries, members] = await Promise.all([
    reference.collection("games").get(),
    reference.collection("entries").get(),
    db
      .collection("leagues")
      .doc(input.leagueId)
      .collection("members")
      .get(),
  ]);
  const membersByUid = new Map(
    members.docs.map((member) => [member.id, member.data()]),
  );
  let revealedGameCount = 0;
  for (const game of games.docs) {
    const lockAt = game.data().effectiveLockAtUtc;
    if (
      !(lockAt instanceof Timestamp) ||
      lockAt.toMillis() > Date.now() ||
      game.data().pickRevealCompletedAt instanceof Timestamp
    ) {
      continue;
    }
    const reveals: Array<{
      uid: string;
      pick: DocumentData;
      member: DocumentData;
    }> = [];
    for (const entry of entries.docs) {
      const pick = await entry.ref.collection("picks").doc(game.id).get();
      if (pick.exists) {
        reveals.push({
          uid: entry.id,
          pick: pick.data() ?? {},
          member: membersByUid.get(entry.id) ?? {},
        });
      }
    }
    await commitWritesInChunks(db, reveals, (batch, reveal) => {
      batch.set(
        reference
          .collection("reveals")
          .doc(game.id)
          .collection("picks")
          .doc(reveal.uid),
        {
          uid: reveal.uid,
          selectedTeamId: reveal.pick.selectedTeamId,
          displayName: reveal.member.displayName ?? "Member",
          photoUrl: reveal.member.photoUrl ?? null,
          revealedAt: FieldValue.serverTimestamp(),
          outcome: reveal.pick.outcome ?? "pending",
          points: reveal.pick.points ?? 0,
        },
        {merge: true},
      );
    });
    await game.ref.update({
      pickRevealCompletedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    revealedGameCount += 1;
  }
  return {revealedGameCount};
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
  const [week, game] = await Promise.all([reference.get(), gameReference.get()]);
  if (typeof week.data()?.finalizationRequestId === "string") {
    throw new HttpsError(
      "aborted",
      "Week finalization is in progress.",
    );
  }
  if (week.data()?.status === "finalized") {
    throw new HttpsError(
      "failed-precondition",
      "Reopen the week before changing a finalized result.",
    );
  }
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
  await gameReference.update({
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
  await writeAudit({
    leagueId: input.leagueId,
    eventType: input.status === "void" ? "game_voided" : "game_overridden",
    actorUid: input.actorUid,
    target: `weeks/${input.weekId}/games/${input.gameId}`,
    requestId: input.requestId,
    reason: input.reason,
    before: {
      status: current.status,
      homeScore: current.homeScore,
      awayScore: current.awayScore,
      winnerTeamId: current.winnerTeamId,
      resultVersion: current.resultVersion,
    },
    after: {
      status: input.status,
      homeScore: input.homeScore,
      awayScore: input.awayScore,
      winnerTeamId: input.winnerTeamId,
      resultVersion,
    },
  });
  await gradeWeek(input.leagueId, input.weekId);
  return {resultVersion};
}

export async function reopenWeekRecord(input: {
  leagueId: string;
  weekId: string;
  actorUid: string;
  requestId: string;
  reason: string;
}): Promise<void> {
  await requireAdmin(input.leagueId, input.actorUid);
  const reference = weekReference(input.leagueId, input.weekId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new HttpsError("not-found", "Week not found.");
    if (snapshot.data()?.status === "reopened") return;
    if (snapshot.data()?.status !== "finalized") {
      throw new HttpsError(
        "failed-precondition",
        "Only a finalized week can be reopened.",
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
      updatedAt: FieldValue.serverTimestamp(),
      resultVersion: FieldValue.increment(1),
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
      hasActiveClaim(data, "publishRequestId", "publishStartedAt") ||
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
