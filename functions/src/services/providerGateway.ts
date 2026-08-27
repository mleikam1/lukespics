import {randomUUID} from "node:crypto";
import {logger} from "firebase-functions";
import {
  FieldValue,
  Timestamp,
  type DocumentReference,
} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {db, positiveIntegerSetting} from "../config.js";
import {ProviderRetryAuthorizationError} from "../providers/retry.js";
import {
  isSportsDataIoConfigurationReason,
} from "../providers/sportsDataIoClient.js";
import {normalizedGameSchema} from "../schemas.js";
import type {
  NormalizedGame,
  ProviderCachedGamesResult,
  ProviderQuery,
  ProviderRequestOperation,
  SportsDataProvider,
} from "../types.js";
import {commitWritesInChunks, sha256} from "../utils.js";

export const PROVIDER_CACHE_LOCK_LEASE_MS = 660_000;
export const SELECTED_GAMES_TERMINAL_CACHE_DURATION_MS =
  12 * 60 * 60 * 1000;
export const SPORTSDATAIO_FUTURE_CACHE_DURATION_MS = 60 * 60 * 1000;
export const SPORTSDATAIO_UPCOMING_CACHE_DURATION_MS = 30 * 60 * 1000;
export const SPORTSDATAIO_LIVE_CACHE_DURATION_MS = 10 * 60 * 1000;
export const SPORTSDATAIO_EMPTY_CACHE_DURATION_MS = 30 * 60 * 1000;
const DEFAULT_SELECTED_GAME_MAXIMUM_IDS = 20;
const ABSOLUTE_SELECTED_GAME_MAXIMUM_IDS = 500;

export type CachedGamesResult = ProviderCachedGamesResult;

export class CanonicalTrustConflictError extends Error {}

export function cacheFallbackAfterRefreshError(
  cached: CachedGamesResult | null,
  _error: unknown,
): CachedGamesResult | null {
  return cached === null ? null : {...cached, stale: true};
}

export function providerCacheKey(
  provider: SportsDataProvider,
  query: ProviderQuery,
): string {
  return sha256({
    provider: provider.cacheNamespace ?? provider.name,
    requestType: "games",
    ...providerQueryCacheIdentity(provider.name, query),
  });
}

export function providerQueryCacheIdentity(
  providerName: string,
  query: ProviderQuery,
): Record<string, unknown> {
  if (providerName === "cbsSports") {
    return {
      sportCode: "NCAAF",
      leagueCode: "ncaaf",
      providerLeagueId: "FBS",
      division: query.division ?? "FBS",
      season: query.season,
      seasonType: query.seasonType ?? "regular",
      week: query.week,
    };
  }
  const upstreamIdentity = {
    sportCode: query.sportCode,
    leagueCode: query.leagueCode,
    providerLeagueId: query.providerLeagueId,
    from: query.from,
    to: query.to,
  };
  return {
    ...upstreamIdentity,
    season: query.season,
    timezone: query.timezone,
  };
}

export function selectedGamesCacheKey(
  provider: SportsDataProvider,
  providerGameIds: string[],
  context: ProviderQuery,
): string {
  return sha256({
    provider: provider.cacheNamespace ?? provider.name,
    requestType: "selectedGames",
    providerGameIds: [...new Set(providerGameIds)].sort(),
    ...providerQueryCacheIdentity(provider.name, context),
  });
}

function serializeGame(game: NormalizedGame): Record<string, unknown> {
  return {
    ...game,
    scheduledAtUtc: game.scheduledAtUtc?.toISOString() ?? null,
    publishedScheduledAtUtc:
      game.publishedScheduledAtUtc?.toISOString() ?? null,
    effectiveLockAtUtc: game.effectiveLockAtUtc?.toISOString() ?? null,
    providerLastUpdatedAt: game.providerLastUpdatedAt.toISOString(),
    lastSyncedAt: game.lastSyncedAt.toISOString(),
  };
}

function materialGame(game: NormalizedGame): Record<string, unknown> {
  const serialized = serializeGame(game);
  const {
    lastSyncedAt: _lastSyncedAt,
    providerLastUpdatedAt: _providerLastUpdatedAt,
    ...material
  } = serialized;
  return material;
}

export function providerGamesContentHash(games: NormalizedGame[]): string {
  return sha256(
    [...games]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((game) => materialGame(game)),
  );
}

export function providerCacheSnapshotMatchesMetadata(
  games: NormalizedGame[],
  metadata: {contentHash?: unknown; itemCount?: unknown},
): boolean {
  return (
    typeof metadata.contentHash === "string" &&
    Number.isSafeInteger(metadata.itemCount) &&
    metadata.itemCount === games.length &&
    metadata.contentHash === providerGamesContentHash(games)
  );
}

export function validateAndDeduplicateProviderGames(
  values: unknown[],
): NormalizedGame[] {
  const gamesByProviderId = new Map<string, NormalizedGame>();
  const documentIds = new Map<string, string>();
  for (const value of values) {
    const game = normalizedGameSchema.parse(value) as NormalizedGame;
    const providerKey = `${game.provider}:${game.providerGameId}`;
    const existingProviderKey = documentIds.get(game.id);
    if (
      existingProviderKey !== undefined &&
      existingProviderKey !== providerKey
    ) {
      throw new Error("Provider returned conflicting games with one document ID.");
    }
    documentIds.set(game.id, providerKey);
    const existing = gamesByProviderId.get(providerKey);
    if (
      existing === undefined ||
      game.providerLastUpdatedAt > existing.providerLastUpdatedAt
    ) {
      gamesByProviderId.set(providerKey, game);
    }
  }
  return [...gamesByProviderId.values()];
}

export function assertCompleteSelectedGamesResponse(
  providerName: string,
  requestedIds: ReadonlySet<string>,
  games: NormalizedGame[],
  allowPartial = false,
): void {
  const returnedIds = new Set<string>();
  for (const game of games) {
    if (
      game.provider !== providerName ||
      !requestedIds.has(game.providerGameId)
    ) {
      throw new Error(
        "Provider returned an unexpected game during selected-game refresh.",
      );
    }
    returnedIds.add(game.providerGameId);
  }
  const missingRequestedGame = [...requestedIds].some(
    (id) => !returnedIds.has(id),
  );
  if (returnedIds.size === 0 || (!allowPartial && missingRequestedGame)) {
    throw new Error(
      "Provider returned an incomplete selected-game refresh.",
    );
  }
}

export function providerCacheDurationMs(
  games: NormalizedGame[],
  requestType: "games" | "selectedGames",
  now = new Date(),
  providerName?: string,
): number {
  if (games.length === 0) {
    return providerName === "sportsDataIo"
      ? SPORTSDATAIO_EMPTY_CACHE_DURATION_MS
      : 2 * 60 * 60 * 1000;
  }
  if (games.every((game) => ["final", "void"].includes(game.status))) {
    // Terminal result feeds can be corrected or reinstate a game. Selected
    // games therefore remain discoverable by the scheduled result sync.
    if (requestType === "selectedGames") {
      return SELECTED_GAMES_TERMINAL_CACHE_DURATION_MS;
    }
    return 10 * 365 * 24 * 60 * 60 * 1000;
  }
  if (games.some((game) => game.status === "live")) {
    return providerName === "sportsDataIo"
      ? SPORTSDATAIO_LIVE_CACHE_DURATION_MS
      : 15 * 60 * 1000;
  }
  if (
    games.some((game) =>
      ["postponed", "suspended", "reviewRequired"].includes(game.status),
    )
  ) {
    return 60 * 60 * 1000;
  }
  const futureTimes = games
    .flatMap((game) =>
      game.scheduledAtUtc === null
        ? []
        : [game.scheduledAtUtc.valueOf() - now.valueOf()],
    )
    .filter((difference) => difference > 0);
  if (futureTimes.length === 0) return 30 * 60 * 1000;
  const nearest = Math.min(...futureTimes);
  if (providerName === "sportsDataIo") {
    if (nearest > 24 * 60 * 60 * 1000) {
      return SPORTSDATAIO_FUTURE_CACHE_DURATION_MS;
    }
    if (nearest > 2 * 60 * 60 * 1000) {
      return SPORTSDATAIO_UPCOMING_CACHE_DURATION_MS;
    }
    return 15 * 60 * 1000;
  }
  if (nearest > 24 * 60 * 60 * 1000) return 12 * 60 * 60 * 1000;
  if (nearest > 2 * 60 * 60 * 1000) return 2 * 60 * 60 * 1000;
  return 15 * 60 * 1000;
}

export function selectedGameRefreshMaximumIds(
  provider: SportsDataProvider,
): number {
  const maximum =
    provider.selectedGameRefreshMaximumIds ??
    DEFAULT_SELECTED_GAME_MAXIMUM_IDS;
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    maximum > ABSOLUTE_SELECTED_GAME_MAXIMUM_IDS
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Sports provider selected-game batching is invalid.",
    );
  }
  return maximum;
}

export type CatalogTrustDecision = {
  action: "replace" | "extend" | "keep";
  eligibleUntil: Date;
  incomingIsCanonical: boolean;
  observationUpdate: {
    providerLastUpdatedAt: Date;
    lastSyncedAt: Date;
  } | null;
};

export function catalogTrustDecision(input: {
  existingGame: NormalizedGame | null;
  existingEligibleUntil: Date | null;
  incomingGame: NormalizedGame;
  incomingEligibleUntil: Date;
}): CatalogTrustDecision {
  if (input.existingGame === null) {
    return {
      action: "replace",
      eligibleUntil: input.incomingEligibleUntil,
      incomingIsCanonical: true,
      observationUpdate: null,
    };
  }
  const existingHash = providerGamesContentHash([input.existingGame]);
  const incomingHash = providerGamesContentHash([input.incomingGame]);
  if (existingHash === incomingHash) {
    const providerLastUpdatedAt = new Date(
      Math.max(
        input.existingGame.providerLastUpdatedAt.valueOf(),
        input.incomingGame.providerLastUpdatedAt.valueOf(),
      ),
    );
    const lastSyncedAt = new Date(
      Math.max(
        input.existingGame.lastSyncedAt.valueOf(),
        input.incomingGame.lastSyncedAt.valueOf(),
      ),
    );
    const observationAdvanced =
      providerLastUpdatedAt > input.existingGame.providerLastUpdatedAt ||
      lastSyncedAt > input.existingGame.lastSyncedAt;
    const eligibilityExtended =
      input.existingEligibleUntil === null ||
      input.incomingEligibleUntil > input.existingEligibleUntil;
    if (!observationAdvanced && !eligibilityExtended) {
      return {
        action: "keep",
        eligibleUntil:
          input.existingEligibleUntil ?? input.incomingEligibleUntil,
        incomingIsCanonical: true,
        observationUpdate: null,
      };
    }
    return {
      action: "extend",
      eligibleUntil:
        input.existingEligibleUntil === null ||
        input.incomingEligibleUntil > input.existingEligibleUntil
          ? input.incomingEligibleUntil
          : input.existingEligibleUntil,
      incomingIsCanonical: true,
      observationUpdate: observationAdvanced
        ? {providerLastUpdatedAt, lastSyncedAt}
        : null,
    };
  }
  const existingObservedAt = input.existingGame.providerLastUpdatedAt.valueOf();
  const incomingObservedAt = input.incomingGame.providerLastUpdatedAt.valueOf();
  if (
    incomingObservedAt > existingObservedAt ||
    (incomingObservedAt === existingObservedAt && incomingHash > existingHash)
  ) {
    return {
      action: "replace",
      eligibleUntil: input.incomingEligibleUntil,
      incomingIsCanonical: true,
      observationUpdate: null,
    };
  }
  return {
    action: "keep",
    eligibleUntil:
      input.existingEligibleUntil ?? input.incomingEligibleUntil,
    incomingIsCanonical: false,
    observationUpdate: null,
  };
}

async function readCache(
  reference: DocumentReference,
): Promise<CachedGamesResult | null> {
  const [metadata, items] = await Promise.all([
    reference.get(),
    reference.collection("items").get(),
  ]);
  const data = metadata.data();
  if (!metadata.exists || data === undefined) return null;
  const cachedAt =
    data.cachedAt instanceof Timestamp ? data.cachedAt.toDate() : new Date(0);
  const expiresAt =
    data.expiresAt instanceof Timestamp ? data.expiresAt.toDate() : new Date(0);
  let games: NormalizedGame[];
  try {
    games = items.docs.map((document) =>
      normalizedGameSchema.parse(document.data()),
    );
  } catch {
    return null;
  }
  if (!providerCacheSnapshotMatchesMetadata(games, data)) return null;
  return {
    games,
    cacheHit: true,
    stale: expiresAt <= new Date(),
    delayed: false,
    cachedAt,
    expiresAt,
    contentHash: String(data.contentHash ?? ""),
  };
}

async function acquireLock(
  key: string,
): Promise<{acquired: boolean; owner: string}> {
  const owner = randomUUID();
  const reference = db.collection("providerLocks").doc(key);
  const acquired = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const expiresAt = snapshot.data()?.expiresAt;
    if (
      expiresAt instanceof Timestamp &&
      expiresAt.toMillis() > Date.now() &&
      snapshot.data()?.owner !== owner
    ) {
      return false;
    }
    transaction.set(reference, {
      owner,
      acquiredAt: FieldValue.serverTimestamp(),
      // Outlive the provider endpoints' 540-second execution window with a
      // two-minute margin so a live holder cannot overlap a replacement.
      expiresAt: Timestamp.fromMillis(
        Date.now() + PROVIDER_CACHE_LOCK_LEASE_MS,
      ),
    });
    return true;
  });
  return {acquired, owner};
}

async function releaseLock(key: string, owner: string): Promise<void> {
  const reference = db.collection("providerLocks").doc(key);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (snapshot.data()?.owner === owner) {
      transaction.delete(reference);
    }
  });
}

export function providerUsageDocumentId(
  provider: string,
  now = new Date(),
): string {
  return `${provider}_${now.toISOString().slice(0, 10)}`;
}

export function providerCircuitDocumentId(provider: string): string {
  return provider;
}

function usageReference(
  provider: string,
  now = new Date(),
): DocumentReference {
  return db
    .collection("providerUsage")
    .doc(providerUsageDocumentId(provider, now));
}

function circuitReference(provider: string): DocumentReference {
  return db
    .collection("providerCircuitStates")
    .doc(providerCircuitDocumentId(provider));
}

type QuotaReservation = {
  reference: DocumentReference;
  circuitReference: DocumentReference;
  providerName: string;
  day: string;
  baseRequestCount: number;
  maximumRetryRequestCount: number;
  authorizedRetryRequestCount: number;
  pendingRetryAuthorizationCount: number;
  softLimit: number;
  remainingInternalBudget: number;
};

export type QuotaReservationSettlement = {
  actualRequestCount: number;
  actualBaseRequestCount: number;
  authorizedRetryRequestCount: number;
  refundBaseRequestCount: number;
};

export function quotaReservationSettlement(
  baseReservation: number,
  authorizedRetryRequestCount: number,
  attemptCountBefore: number | null,
  attemptCountAfter: number | null,
): QuotaReservationSettlement {
  const boundedBaseReservation = Math.max(1, Math.floor(baseReservation));
  const boundedRetryCount = Math.max(
    0,
    Math.floor(authorizedRetryRequestCount),
  );
  const totalReservation = boundedBaseReservation + boundedRetryCount;
  const hasReliableCounter =
    attemptCountBefore !== null &&
    attemptCountAfter !== null &&
    Number.isSafeInteger(attemptCountBefore) &&
    Number.isSafeInteger(attemptCountAfter) &&
    attemptCountBefore >= 0 &&
    attemptCountAfter >= attemptCountBefore &&
    attemptCountAfter - attemptCountBefore >= boundedRetryCount &&
    attemptCountAfter - attemptCountBefore <= totalReservation;
  const actualRequestCount = hasReliableCounter
    ? attemptCountAfter - attemptCountBefore
    : totalReservation;
  const actualBaseRequestCount = hasReliableCounter
    ? actualRequestCount - boundedRetryCount
    : boundedBaseReservation;
  return {
    actualRequestCount,
    actualBaseRequestCount,
    authorizedRetryRequestCount: boundedRetryCount,
    refundBaseRequestCount:
      boundedBaseReservation - actualBaseRequestCount,
  };
}

export function providerQuotaReservationAllowed(input: {
  requestCount: number;
  requestedCount: number;
  softLimit: number;
  providerReportedRemaining: number | null;
  unreportedRequestCount: number;
}): boolean {
  if (input.requestCount + input.requestedCount > input.softLimit) {
    return false;
  }
  return (
    input.providerReportedRemaining === null ||
    input.providerReportedRemaining -
      input.unreportedRequestCount -
      input.requestedCount >=
      5
  );
}

export function minimumProviderQuotaRemaining(
  previousRemaining: number | null,
  observedRemaining: number | null,
): number | null {
  if (observedRemaining === null) return previousRemaining;
  return previousRemaining === null
    ? observedRemaining
    : Math.min(previousRemaining, observedRemaining);
}

function providerRequestAttemptCount(
  provider: SportsDataProvider,
): number | null {
  if (typeof provider.getRequestAttemptCount !== "function") return null;
  try {
    const count = provider.getRequestAttemptCount();
    return Number.isSafeInteger(count) && count >= 0 ? count : null;
  } catch {
    return null;
  }
}

export function providerRequestEstimate(
  provider: SportsDataProvider,
  operation: ProviderRequestOperation,
  itemCount: number,
  context: Partial<ProviderQuery>,
): {baseRequestCount: number; maximumRequestCount: number} {
  const estimate = provider.requestEstimate?.(
    operation,
    itemCount,
    context,
  ) ?? {
    baseRequestCount: 1,
    maximumRequestCount: 1,
  };
  if (
    !Number.isSafeInteger(estimate.baseRequestCount) ||
    estimate.baseRequestCount < 1 ||
    !Number.isSafeInteger(estimate.maximumRequestCount) ||
    estimate.maximumRequestCount < estimate.baseRequestCount
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Sports provider request accounting is invalid.",
    );
  }
  return estimate;
}

async function reserveQuotaAmount(input: {
  reference: DocumentReference;
  circuitReference: DocumentReference;
  providerName: string;
  day: string;
  requestCount: number;
  kind: "base" | "retry";
  softLimit: number;
}): Promise<number> {
  return db.runTransaction(async (transaction) => {
    const [snapshot, circuitSnapshot] = await Promise.all([
      transaction.get(input.reference),
      transaction.get(input.circuitReference),
    ]);
    const data = snapshot.data() ?? {};
    const openUntil = circuitSnapshot.data()?.circuitOpenUntil;
    if (
      openUntil instanceof Timestamp &&
      openUntil.toMillis() > Date.now()
    ) {
      throw new HttpsError(
        "unavailable",
        "Sports data refresh is temporarily delayed.",
      );
    }
    const count =
      typeof data.requestCount === "number" ? data.requestCount : 0;
    const reportedRemaining =
      typeof data.providerReportedRemaining === "number"
        ? data.providerReportedRemaining
        : null;
    const unreported =
      typeof data.unreportedRequestCount === "number"
        ? data.unreportedRequestCount
        : 0;
    if (
      !providerQuotaReservationAllowed({
        requestCount: count,
        requestedCount: input.requestCount,
        softLimit: input.softLimit,
        providerReportedRemaining: reportedRemaining,
        unreportedRequestCount: unreported,
      })
    ) {
      throw new HttpsError(
        "resource-exhausted",
        "Sports data refresh is temporarily delayed.",
      );
    }
    const outstandingBase =
      typeof data.outstandingBaseRequestCount === "number"
        ? data.outstandingBaseRequestCount
        : 0;
    const retryCount =
      typeof data.retryRequestCount === "number"
        ? data.retryRequestCount
        : 0;
    const nextRequestCount = count + input.requestCount;
    transaction.set(
      input.reference,
      {
        provider: input.providerName,
        day: input.day,
        requestCount: nextRequestCount,
        unreportedRequestCount: unreported + input.requestCount,
        outstandingBaseRequestCount:
          outstandingBase +
          (input.kind === "base" ? input.requestCount : 0),
        retryRequestCount:
          retryCount +
          (input.kind === "retry" ? input.requestCount : 0),
        lastReservedRequestCount: input.requestCount,
        lastReservationKind: input.kind,
        ...(input.kind === "base"
          ? {lastBaseReservedRequestCount: input.requestCount}
          : {lastRetryReservedRequestCount: input.requestCount}),
        softLimit: input.softLimit,
        providerReportedRemaining: reportedRemaining,
        lastAttempt: FieldValue.serverTimestamp(),
      },
      {merge: true},
    );
    return Math.max(0, input.softLimit - nextRequestCount);
  });
}

async function reserveQuota(
  provider: SportsDataProvider,
  baseRequestCount: number,
  maximumRequestCount: number,
): Promise<QuotaReservation | null> {
  const policy = provider.usagePolicy;
  if (policy === undefined) return null;
  const softLimit = positiveIntegerSetting(
    policy.softDailyLimitSetting,
    policy.defaultSoftDailyLimit,
    policy.maximumSoftDailyLimit,
  );
  const baseReservation = Math.max(1, Math.floor(baseRequestCount));
  const maximumReservation = Math.max(
    baseReservation,
    Math.floor(maximumRequestCount),
  );
  const reservedAt = new Date();
  const day = reservedAt.toISOString().slice(0, 10);
  const reference = usageReference(provider.name, reservedAt);
  const providerCircuitReference = circuitReference(provider.name);
  const remainingInternalBudget = await reserveQuotaAmount({
    reference,
    circuitReference: providerCircuitReference,
    providerName: provider.name,
    day,
    requestCount: baseReservation,
    kind: "base",
    softLimit,
  });
  return {
    reference,
    circuitReference: providerCircuitReference,
    providerName: provider.name,
    day,
    baseRequestCount: baseReservation,
    maximumRetryRequestCount: maximumReservation - baseReservation,
    authorizedRetryRequestCount: 0,
    pendingRetryAuthorizationCount: 0,
    softLimit,
    remainingInternalBudget,
  };
}

async function authorizeRetryQuota(
  reservation: QuotaReservation,
): Promise<void> {
  if (
    reservation.authorizedRetryRequestCount +
      reservation.pendingRetryAuthorizationCount >=
    reservation.maximumRetryRequestCount
  ) {
    throw new HttpsError(
      "resource-exhausted",
      "Sports data retry limit is exhausted.",
    );
  }
  reservation.pendingRetryAuthorizationCount += 1;
  try {
    reservation.remainingInternalBudget = await reserveQuotaAmount({
      reference: reservation.reference,
      circuitReference: reservation.circuitReference,
      providerName: reservation.providerName,
      day: reservation.day,
      requestCount: 1,
      kind: "retry",
      softLimit: reservation.softLimit,
    });
    reservation.authorizedRetryRequestCount += 1;
  } finally {
    reservation.pendingRetryAuthorizationCount -= 1;
  }
}

async function settleQuotaReservation(
  reservation: QuotaReservation | null,
  settlement: QuotaReservationSettlement,
): Promise<void> {
  if (reservation === null) return;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reservation.reference);
    const count =
      typeof snapshot.data()?.requestCount === "number"
        ? Number(snapshot.data()?.requestCount)
        : reservation.baseRequestCount +
          reservation.authorizedRetryRequestCount;
    const unreported =
      typeof snapshot.data()?.unreportedRequestCount === "number"
        ? Number(snapshot.data()?.unreportedRequestCount)
        : count;
    const outstandingBase =
      typeof snapshot.data()?.outstandingBaseRequestCount === "number"
        ? Number(snapshot.data()?.outstandingBaseRequestCount)
        : reservation.baseRequestCount;
    transaction.set(
      reservation.reference,
      {
        requestCount: Math.max(
          0,
          count - settlement.refundBaseRequestCount,
        ),
        unreportedRequestCount: Math.max(
          0,
          unreported - settlement.refundBaseRequestCount,
        ),
        outstandingBaseRequestCount: Math.max(
          0,
          outstandingBase - reservation.baseRequestCount,
        ),
        lastActualRequestCount: settlement.actualRequestCount,
        lastActualBaseRequestCount: settlement.actualBaseRequestCount,
        lastAuthorizedRetryRequestCount:
          settlement.authorizedRetryRequestCount,
        lastRefundedRequestCount: settlement.refundBaseRequestCount,
        lastSettledAt: FieldValue.serverTimestamp(),
      },
      {merge: true},
    );
  });
}

async function recordProviderSuccess(
  provider: SportsDataProvider,
  reservation: QuotaReservation | null,
  actualRequestCount: number,
): Promise<void> {
  if (provider.usagePolicy === undefined || reservation === null) return;
  const health = await provider.getHealth();
  await db.runTransaction(async (transaction) => {
    const [snapshot] = await Promise.all([
      transaction.get(reservation.reference),
      transaction.get(reservation.circuitReference),
    ]);
    const data = snapshot.data() ?? {};
    const unreported =
      typeof data.unreportedRequestCount === "number"
        ? data.unreportedRequestCount
        : actualRequestCount;
    const previousRemaining =
      typeof data.providerReportedRemaining === "number"
        ? data.providerReportedRemaining
        : null;
    const reportedRemaining = minimumProviderQuotaRemaining(
      previousRemaining,
      health.quotaRemaining,
    );
    transaction.set(
      reservation.reference,
      {
        providerReportedRemaining: reportedRemaining,
        unreportedRequestCount:
          health.quotaRemaining === null
            ? unreported
            : Math.max(0, unreported - actualRequestCount),
      },
      {merge: true},
    );
    transaction.set(
      reservation.circuitReference,
      {
        provider: provider.name,
        lastSuccessfulRequest: FieldValue.serverTimestamp(),
        consecutiveFailures: 0,
        circuitState: "closed",
        circuitOpenUntil: FieldValue.delete(),
      },
      {merge: true},
    );
  });
}

async function recordProviderFailure(
  provider: SportsDataProvider,
  error: unknown,
): Promise<void> {
  if (provider.usagePolicy === undefined) return;
  const reference = circuitReference(provider.name);
  const threshold = positiveIntegerSetting(
    "PROVIDER_CIRCUIT_FAILURE_THRESHOLD",
    3,
    10,
  );
  const openMinutes = positiveIntegerSetting(
    "PROVIDER_CIRCUIT_OPEN_MINUTES",
    15,
    60,
  );
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const previous =
      typeof snapshot.data()?.consecutiveFailures === "number"
        ? snapshot.data()?.consecutiveFailures as number
        : 0;
    const failures = previous + 1;
    transaction.set(
      reference,
      {
        provider: provider.name,
        consecutiveFailures: failures,
        lastFailure: FieldValue.serverTimestamp(),
        lastFailureCode:
          error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
        circuitState: failures >= threshold ? "open" : "closed",
        circuitOpenUntil:
          failures >= threshold
            ? Timestamp.fromMillis(Date.now() + openMinutes * 60_000)
            : FieldValue.delete(),
      },
      {merge: true},
    );
  });
}

async function writeCatalogTrust(input: {
  games: NormalizedGame[];
  cacheKey: string;
  eligibleUntil: Date;
}): Promise<boolean> {
  let allIncomingGamesCanonical = true;
  for (let index = 0; index < input.games.length; index += 100) {
    const games = input.games.slice(index, index + 100);
    const references = games.map((game) =>
      db.collection("sportsCatalogGames").doc(game.id),
    );
    const chunkIncomingGamesCanonical = await db.runTransaction(
      async (transaction) => {
        const snapshots = await transaction.getAll(...references);
        let allCanonical = true;
        for (const [gameIndex, game] of games.entries()) {
          const reference = references[gameIndex];
          const snapshot = snapshots[gameIndex];
          if (reference === undefined || snapshot === undefined) continue;
          const data = snapshot.data();
          const parsed = normalizedGameSchema.safeParse(data);
          const eligibleUntil = data?.catalogEligibleUntil;
          const hasValidTrustMetadata =
            data?.catalogUpdatedAt instanceof Timestamp &&
            eligibleUntil instanceof Timestamp &&
            typeof data.cacheKey === "string";
          const existingEligibleUntil =
            eligibleUntil instanceof Timestamp
              ? eligibleUntil.toDate()
              : null;
          const decision = catalogTrustDecision({
            existingGame: parsed.success ? parsed.data : null,
            existingEligibleUntil:
              hasValidTrustMetadata ? existingEligibleUntil : null,
            incomingGame: game,
            incomingEligibleUntil: input.eligibleUntil,
          });
          allCanonical &&= decision.incomingIsCanonical;
          if (decision.action === "keep") continue;
          if (decision.action === "extend") {
            transaction.set(
              reference,
              {
                ...(input.eligibleUntil >= decision.eligibleUntil
                  ? {cacheKey: input.cacheKey}
                  : {}),
                ...(decision.observationUpdate === null
                  ? {}
                  : {
                      providerLastUpdatedAt:
                        decision.observationUpdate.providerLastUpdatedAt
                          .toISOString(),
                      lastSyncedAt:
                        decision.observationUpdate.lastSyncedAt.toISOString(),
                    }),
                catalogUpdatedAt: FieldValue.serverTimestamp(),
                catalogEligibleUntil: Timestamp.fromDate(
                  decision.eligibleUntil,
                ),
              },
              {merge: true},
            );
            continue;
          }
          transaction.set(
            reference,
            {
              ...serializeGame(game),
              cacheKey: input.cacheKey,
              catalogUpdatedAt: FieldValue.serverTimestamp(),
              catalogEligibleUntil: Timestamp.fromDate(
                decision.eligibleUntil,
              ),
            },
            {merge: true},
          );
        }
        return allCanonical;
      },
    );
    allIncomingGamesCanonical &&= chunkIncomingGamesCanonical;
  }
  return allIncomingGamesCanonical;
}

async function writeCache(
  reference: DocumentReference,
  provider: SportsDataProvider,
  games: NormalizedGame[],
  existingHash: string | null,
  requestType: "games" | "selectedGames",
  query: Record<string, unknown>,
): Promise<CachedGamesResult> {
  const now = new Date();
  const expiresAt = new Date(
    now.valueOf() +
      providerCacheDurationMs(games, requestType, now, provider.name),
  );
  const contentHash = providerGamesContentHash(games);
  if (contentHash !== existingHash) {
    const oldItems = await reference.collection("items").get();
    const newIds = new Set(games.map((game) => game.id));
    await commitWritesInChunks(db, games, (batch, game) => {
      batch.set(reference.collection("items").doc(game.id), serializeGame(game));
    });
    const obsolete = oldItems.docs.filter((item) => !newIds.has(item.id));
    await commitWritesInChunks(db, obsolete, (batch, item) => {
      batch.delete(item.ref);
    });
  }
  const incomingGamesCanonical = await writeCatalogTrust({
    games,
    cacheKey: reference.id,
    eligibleUntil: expiresAt,
  });
  if (!incomingGamesCanonical) {
    throw new CanonicalTrustConflictError(
      "Provider refresh lost a race with newer canonical sports data.",
    );
  }
  await reference.set(
    {
      provider: provider.name,
      requestType,
      query,
      cachedAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromDate(expiresAt),
      contentHash,
      itemCount: games.length,
    },
    {merge: true},
  );
  return {
    games,
    cacheHit: false,
    stale: false,
    delayed: false,
    cachedAt: now,
    expiresAt,
    contentHash,
  };
}

function installRetryAuthorizer(
  provider: SportsDataProvider,
  reservation: QuotaReservation | null,
): () => void {
  if (reservation === null || reservation.maximumRetryRequestCount === 0) {
    return () => undefined;
  }
  if (
    typeof provider.setRetryAuthorizer !== "function"
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Sports data retry accounting is unavailable.",
    );
  }
  provider.setRetryAuthorizer(
    async () => authorizeRetryQuota(reservation),
  );
  return () => provider.setRetryAuthorizer?.(null);
}

export function shouldRecordProviderFailure(
  error: unknown,
  actualRequestCount: number,
): boolean {
  return (
    actualRequestCount > 0 &&
    !(error instanceof ProviderRetryAuthorizationError)
  );
}

function publicProviderError(error: unknown): unknown {
  return error instanceof ProviderRetryAuthorizationError
    ? error.authorizationCause
    : error;
}

export function shouldServeCachedProviderDataAfterError(
  error: unknown,
): boolean {
  const publicError = publicProviderError(error);
  if (
    !(publicError instanceof HttpsError) ||
    publicError.code !== "failed-precondition"
  ) {
    return true;
  }
  const details = publicError.details;
  const reason =
    details !== null && typeof details === "object" && "reason" in details
      ? details.reason
      : null;
  return !isSportsDataIoConfigurationReason(reason);
}

export function providerCacheFallbackAfterLoadError(
  cached: CachedGamesResult | null,
  error: unknown,
): CachedGamesResult | null {
  const publicError = publicProviderError(error);
  if (!shouldServeCachedProviderDataAfterError(error)) {
    if (publicError instanceof HttpsError) throw publicError;
    throw new HttpsError(
      "failed-precondition",
      "Sports provider configuration needs administrator attention.",
    );
  }
  return cached === null ? null : {...cached, delayed: true};
}

function safeProviderQueryTelemetry(
  query: Record<string, unknown>,
): {sportCode: string | null; leagueCode: string | null} {
  return {
    sportCode:
      typeof query.sportCode === "string"
        ? query.sportCode.slice(0, 80)
        : null,
    leagueCode:
      typeof query.leagueCode === "string"
        ? query.leagueCode.slice(0, 80)
        : null,
  };
}

function delayedCacheOrThrow(input: {
  cached: CachedGamesResult | null;
  error: unknown;
  provider: SportsDataProvider;
  requestType: "games" | "selectedGames";
  cacheKey: string;
  query: Record<string, unknown>;
}): CachedGamesResult {
  const publicError = publicProviderError(input.error);
  const cachedFallback = providerCacheFallbackAfterLoadError(
    input.cached,
    input.error,
  );
  if (cachedFallback !== null) {
    logger.warn("Serving cached provider data after a refresh delay", {
      provider: input.provider.name,
      requestType: input.requestType,
      endpointCategory: input.requestType,
      ...safeProviderQueryTelemetry(input.query),
      cacheKey: input.cacheKey,
      cacheHit: true,
      stale: true,
      safeErrorCode:
        publicError instanceof Error ? publicError.name : "UnknownError",
    });
    return cachedFallback;
  }
  if (publicError instanceof HttpsError) throw publicError;
  throw new HttpsError(
    "unavailable",
    "Sports data refresh is temporarily delayed.",
  );
}

async function loadProviderGamesWithCache(input: {
  provider: SportsDataProvider;
  key: string;
  requestType: "games" | "selectedGames";
  query: Record<string, unknown>;
  forceRefresh: boolean;
  baseRequestCount: number;
  maximumRequestCount: number;
  expectedItemCount?: number;
  load: () => Promise<NormalizedGame[]>;
}): Promise<CachedGamesResult> {
  const startedAt = Date.now();
  const reference = db.collection("sportsCache").doc(input.key);
  let cached = await readCache(reference);
  if (
    cached !== null &&
    input.expectedItemCount !== undefined &&
    cached.games.length < input.expectedItemCount
  ) {
    // A partial provider response is useful, but its missing games must remain
    // eligible for retry on the next selected-game refresh.
    cached = {...cached, stale: true};
  }
  if (cached !== null && !cached.stale && !input.forceRefresh) {
    try {
      const cacheRemainsCanonical = await writeCatalogTrust({
        games: cached.games,
        cacheKey: input.key,
        eligibleUntil: cached.expiresAt,
      });
      if (cacheRemainsCanonical) {
        logger.info("Provider cache hit", {
          provider: input.provider.name,
          requestType: input.requestType,
          endpointCategory: input.requestType,
          ...safeProviderQueryTelemetry(input.query),
          cacheKey: input.key,
          cacheHit: true,
          stale: false,
          durationMs: Date.now() - startedAt,
        });
        return cached;
      }
      logger.warn("Provider cache diverged from newer canonical data", {
        provider: input.provider.name,
        requestType: input.requestType,
        cacheKey: input.key,
      });
    } catch (error: unknown) {
      logger.warn("Provider cache trust validation failed", {
        provider: input.provider.name,
        requestType: input.requestType,
        cacheKey: input.key,
        safeErrorCode: error instanceof Error ? error.name : "UnknownError",
      });
    }
    cached = {...cached, stale: true};
  }

  const lock = await acquireLock(input.key);
  if (!lock.acquired) {
    if (cached !== null) return {...cached, delayed: true};
    throw new HttpsError(
      "aborted",
      "Sports data is already refreshing. Try again shortly.",
    );
  }

  try {
    let reservation: QuotaReservation | null;
    try {
      reservation = await reserveQuota(
        input.provider,
        input.baseRequestCount,
        input.maximumRequestCount,
      );
    } catch (error: unknown) {
      return delayedCacheOrThrow({
        cached,
        error,
        provider: input.provider,
        requestType: input.requestType,
        cacheKey: input.key,
        query: input.query,
      });
    }

    const attemptCountBefore = providerRequestAttemptCount(input.provider);
    let games: NormalizedGame[];
    let clearRetryAuthorizer: () => void = () => undefined;
    try {
      clearRetryAuthorizer = installRetryAuthorizer(
        input.provider,
        reservation,
      );
      games = validateAndDeduplicateProviderGames(await input.load());
    } catch (error: unknown) {
      const settlement = quotaReservationSettlement(
        input.baseRequestCount,
        reservation?.authorizedRetryRequestCount ?? 0,
        attemptCountBefore,
        providerRequestAttemptCount(input.provider),
      );
      try {
        await settleQuotaReservation(reservation, settlement);
      } catch (settlementError: unknown) {
        logger.warn("Provider quota reservation settlement failed", {
          provider: input.provider.name,
          requestType: input.requestType,
          cacheKey: input.key,
          safeErrorCode:
            settlementError instanceof Error
              ? settlementError.name
              : "UnknownError",
        });
      }
      if (shouldRecordProviderFailure(error, settlement.actualRequestCount)) {
        try {
          await recordProviderFailure(input.provider, error);
        } catch (recordError: unknown) {
          logger.warn("Provider failure metadata write failed", {
            provider: input.provider.name,
            requestType: input.requestType,
            cacheKey: input.key,
            safeErrorCode:
              recordError instanceof Error
                ? recordError.name
                : "UnknownError",
          });
        }
      }
      return delayedCacheOrThrow({
        cached,
        error,
        provider: input.provider,
        requestType: input.requestType,
        cacheKey: input.key,
        query: input.query,
      });
    } finally {
      // Providers finish all launched requests before returning, so no retry
      // can race after this hook is cleared and quota is settled.
      clearRetryAuthorizer();
    }

    const settlement = quotaReservationSettlement(
      input.baseRequestCount,
      reservation?.authorizedRetryRequestCount ?? 0,
      attemptCountBefore,
      providerRequestAttemptCount(input.provider),
    );
    try {
      await settleQuotaReservation(reservation, settlement);
    } catch (error: unknown) {
      // The original full reservation remains charged, which is fail-closed.
      logger.warn("Provider quota reservation settlement failed", {
        provider: input.provider.name,
        requestType: input.requestType,
        cacheKey: input.key,
        safeErrorCode: error instanceof Error ? error.name : "UnknownError",
      });
    }
    try {
      await recordProviderSuccess(
        input.provider,
        reservation,
        settlement.actualRequestCount,
      );
    } catch (error: unknown) {
      logger.warn("Provider success metadata write failed", {
        provider: input.provider.name,
        requestType: input.requestType,
        cacheKey: input.key,
        safeErrorCode: error instanceof Error ? error.name : "UnknownError",
      });
    }

    try {
      const result = await writeCache(
        reference,
        input.provider,
        games,
        cached?.contentHash ?? null,
        input.requestType,
        input.query,
      );
      logger.info("Provider refresh completed", {
        provider: input.provider.name,
        requestType: input.requestType,
        endpointCategory: input.requestType,
        ...safeProviderQueryTelemetry(input.query),
        cacheKey: input.key,
        cacheHit: false,
        stale: false,
        gameCount: games.length,
        actualRequestCount: settlement.actualRequestCount,
        retryCount: settlement.authorizedRetryRequestCount,
        remainingInternalQuotaBudget:
          reservation?.remainingInternalBudget ?? null,
        durationMs: Date.now() - startedAt,
      });
      return input.expectedItemCount !== undefined &&
        games.length < input.expectedItemCount
        ? {...result, delayed: true}
        : result;
    } catch (error: unknown) {
      return delayedCacheOrThrow({
        cached: cacheFallbackAfterRefreshError(cached, error),
        error,
        provider: input.provider,
        requestType: input.requestType,
        cacheKey: input.key,
        query: input.query,
      });
    }
  } finally {
    await releaseLock(input.key, lock.owner);
  }
}

export async function listGamesWithCache(
  provider: SportsDataProvider,
  query: ProviderQuery,
): Promise<CachedGamesResult> {
  if (provider.listGamesCached !== undefined) {
    const result = await provider.listGamesCached(query);
    if (!result.stale && !result.delayed) {
      const canonical = await writeCatalogTrust({
        games: result.games,
        cacheKey: providerCacheKey(provider, query),
        eligibleUntil: result.expiresAt,
      });
      if (!canonical) {
        throw new CanonicalTrustConflictError(
          "Provider refresh lost a race with newer canonical sports data.",
        );
      }
    }
    return result;
  }
  const estimate = providerRequestEstimate(
    provider,
    "listGames",
    1,
    query,
  );
  const cacheQuery = {
    sportCode: query.sportCode,
    leagueCode: query.leagueCode,
    providerLeagueId: query.providerLeagueId,
    season: query.season,
    from: query.from,
    to: query.to,
    timezone: query.timezone,
  };
  return loadProviderGamesWithCache({
    provider,
    key: providerCacheKey(provider, query),
    requestType: "games",
    query: cacheQuery,
    forceRefresh: query.forceRefresh === true,
    baseRequestCount: estimate.baseRequestCount,
    maximumRequestCount: estimate.maximumRequestCount,
    load: () => provider.listGames(query),
  });
}

export async function fetchGamesByIdsWithCache(
  provider: SportsDataProvider,
  providerGameIds: string[],
  context: ProviderQuery,
): Promise<CachedGamesResult> {
  const uniqueIds = [...new Set(providerGameIds)].sort();
  const maximumIds = selectedGameRefreshMaximumIds(provider);
  if (uniqueIds.length === 0 || uniqueIds.length > maximumIds) {
    throw new HttpsError(
      "invalid-argument",
      `Selected-game refreshes require between one and ${maximumIds} provider game IDs.`,
    );
  }
  if (provider.fetchGamesCached !== undefined) {
    const result = await provider.fetchGamesCached(uniqueIds, context);
    const requestedIds = new Set(uniqueIds);
    assertCompleteSelectedGamesResponse(
      provider.name,
      requestedIds,
      result.games,
      provider.selectedGameRefreshMode === "partial",
    );
    const returnedIds = new Set(
      result.games.map((game) => game.providerGameId),
    );
    const missingRequestedGame = [...requestedIds].some(
      (id) => !returnedIds.has(id),
    );
    return missingRequestedGame ? {...result, delayed: true} : result;
  }
  const estimate = providerRequestEstimate(
    provider,
    "fetchGames",
    uniqueIds.length,
    context,
  );
  const cacheQuery = {
    providerGameIds: uniqueIds,
    sportCode: context.sportCode,
    leagueCode: context.leagueCode,
    providerLeagueId: context.providerLeagueId,
    season: context.season,
    from: context.from,
    to: context.to,
    timezone: context.timezone,
  };
  const key = selectedGamesCacheKey(provider, uniqueIds, context);
  const requestedIds = new Set(uniqueIds);
  return loadProviderGamesWithCache({
    provider,
    key,
    requestType: "selectedGames",
    query: cacheQuery,
    forceRefresh: context.forceRefresh === true,
    baseRequestCount: estimate.baseRequestCount,
    maximumRequestCount: estimate.maximumRequestCount,
    ...(provider.selectedGameRefreshMode === "partial"
      ? {expectedItemCount: uniqueIds.length}
      : {}),
    load: async () => {
      const games = await provider.fetchGames(uniqueIds, context);
      const allowPartial = provider.selectedGameRefreshMode === "partial";
      assertCompleteSelectedGamesResponse(
        provider.name,
        requestedIds,
        games,
        allowPartial,
      );
      if (allowPartial && games.length < uniqueIds.length) {
        const returnedIds = new Set(
          games.map((game) => game.providerGameId),
        );
        logger.warn("Provider selected-game refresh was partial", {
          provider: provider.name,
          requestedGameCount: uniqueIds.length,
          returnedGameCount: games.length,
          missingProviderGameIds: uniqueIds.filter(
            (id) => !returnedIds.has(id),
          ),
        });
      }
      return games;
    },
  });
}

export async function providerUsageSummary(
  providerName: string,
): Promise<Record<string, unknown>> {
  const [usageSnapshot, circuitSnapshot] = await Promise.all([
    usageReference(providerName).get(),
    circuitReference(providerName).get(),
  ]);
  const data = usageSnapshot.data() ?? {};
  const circuit = circuitSnapshot.data() ?? {};
  return {
    provider: providerName,
    day: data.day ?? new Date().toISOString().slice(0, 10),
    requestCount: data.requestCount ?? 0,
    retryRequestCount: data.retryRequestCount ?? 0,
    outstandingBaseRequestCount:
      data.outstandingBaseRequestCount ?? 0,
    softLimit: data.softLimit ?? null,
    providerReportedRemaining: data.providerReportedRemaining ?? null,
    lastSuccessfulRequest: circuit.lastSuccessfulRequest ?? null,
    lastFailure: circuit.lastFailure ?? null,
    circuitState: circuit.circuitState ?? "closed",
    circuitOpenUntil: circuit.circuitOpenUntil ?? null,
  };
}

export async function enforceManualRefreshRateLimit(input: {
  leagueId: string;
  actorUid: string;
}): Promise<void> {
  const reference = db
    .collection("providerManualRefreshLimits")
    .doc(sha256(input));
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const nextAllowedAt = snapshot.data()?.nextAllowedAt;
    if (
      nextAllowedAt instanceof Timestamp &&
      nextAllowedAt.toMillis() > Date.now()
    ) {
      throw new HttpsError(
        "resource-exhausted",
        "A manual sports refresh was requested recently. Try again later.",
      );
    }
    transaction.set(reference, {
      leagueId: input.leagueId,
      actorUid: input.actorUid,
      requestedAt: FieldValue.serverTimestamp(),
      nextAllowedAt: Timestamp.fromMillis(Date.now() + 5 * 60_000),
    });
  });
}
