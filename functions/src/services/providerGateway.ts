import {randomUUID} from "node:crypto";
import {logger} from "firebase-functions";
import {
  FieldValue,
  Timestamp,
  type DocumentReference,
} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {db, positiveIntegerSetting} from "../config.js";
import {normalizedGameSchema} from "../schemas.js";
import type {
  NormalizedGame,
  ProviderQuery,
  SportsDataProvider,
} from "../types.js";
import {commitWritesInChunks, sha256} from "../utils.js";

export type CachedGamesResult = {
  games: NormalizedGame[];
  cacheHit: boolean;
  stale: boolean;
  delayed: boolean;
  cachedAt: Date;
  expiresAt: Date;
  contentHash: string;
};

function cacheKey(provider: SportsDataProvider, query: ProviderQuery): string {
  return sha256({
    provider: provider.name,
    requestType: "games",
    sportCode: query.sportCode,
    leagueCode: query.leagueCode,
    season: query.season,
    from: query.from,
    to: query.to,
  });
}

function serializeGame(game: NormalizedGame): Record<string, unknown> {
  return {
    ...game,
    scheduledAtUtc: game.scheduledAtUtc.toISOString(),
    publishedScheduledAtUtc: game.publishedScheduledAtUtc.toISOString(),
    effectiveLockAtUtc: game.effectiveLockAtUtc.toISOString(),
    providerLastUpdatedAt: game.providerLastUpdatedAt.toISOString(),
    lastSyncedAt: game.lastSyncedAt.toISOString(),
  };
}

function materialGame(game: NormalizedGame): Record<string, unknown> {
  const serialized = serializeGame(game);
  const {
    lastSyncedAt: _lastSyncedAt,
    providerLastUpdatedAt: _providerLastUpdatedAt,
    sourcePayloadHash: _sourcePayloadHash,
    ...material
  } = serialized;
  return material;
}

function cacheDurationMs(games: NormalizedGame[], now = new Date()): number {
  if (games.length === 0) return 2 * 60 * 60 * 1000;
  if (games.every((game) => ["final", "void", "cancelled"].includes(game.status))) {
    return 10 * 365 * 24 * 60 * 60 * 1000;
  }
  if (games.some((game) => game.status === "live")) {
    return 15 * 60 * 1000;
  }
  if (
    games.some((game) =>
      ["postponed", "suspended", "reviewRequired"].includes(game.status),
    )
  ) {
    return 60 * 60 * 1000;
  }
  const futureTimes = games
    .map((game) => game.scheduledAtUtc.valueOf() - now.valueOf())
    .filter((difference) => difference > 0);
  if (futureTimes.length === 0) return 30 * 60 * 1000;
  const nearest = Math.min(...futureTimes);
  if (nearest > 24 * 60 * 60 * 1000) return 12 * 60 * 60 * 1000;
  if (nearest > 2 * 60 * 60 * 1000) return 2 * 60 * 60 * 1000;
  return 15 * 60 * 1000;
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
  const games = items.docs.map((document) =>
    normalizedGameSchema.parse(document.data()),
  );
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
      // Three provider attempts may each consume the full 15-second timeout,
      // plus exponential backoff. Keep the lease beyond that retry envelope.
      expiresAt: Timestamp.fromMillis(Date.now() + 90_000),
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

function usageReference(provider: string): DocumentReference {
  const day = new Date().toISOString().slice(0, 10);
  return db.collection("providerUsage").doc(`${provider}_${day}`);
}

async function reserveQuota(provider: SportsDataProvider): Promise<void> {
  if (provider.name !== "apiSports") return;
  const reference = usageReference(provider.name);
  const softLimit = positiveIntegerSetting(
    "API_SPORTS_SOFT_DAILY_LIMIT",
    80,
    10_000,
  );
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.data() ?? {};
    const openUntil = data.circuitOpenUntil;
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
    if (count >= softLimit || (reportedRemaining !== null && reportedRemaining <= 5)) {
      throw new HttpsError(
        "resource-exhausted",
        "Sports data refresh is temporarily delayed.",
      );
    }
    transaction.set(
      reference,
      {
        provider: provider.name,
        day: new Date().toISOString().slice(0, 10),
        requestCount: count + 1,
        softLimit,
        providerReportedRemaining: reportedRemaining,
        lastAttempt: FieldValue.serverTimestamp(),
        circuitState: "closed",
      },
      {merge: true},
    );
  });
}

async function recordProviderSuccess(
  provider: SportsDataProvider,
): Promise<void> {
  if (provider.name !== "apiSports") return;
  const health = await provider.getHealth();
  await usageReference(provider.name).set(
    {
      lastSuccessfulRequest: FieldValue.serverTimestamp(),
      consecutiveFailures: 0,
      circuitState: "closed",
      circuitOpenUntil: FieldValue.delete(),
      providerReportedRemaining: health.quotaRemaining,
    },
    {merge: true},
  );
}

async function recordProviderFailure(
  provider: SportsDataProvider,
  error: unknown,
): Promise<void> {
  if (provider.name !== "apiSports") return;
  const reference = usageReference(provider.name);
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

async function writeCache(
  reference: DocumentReference,
  provider: SportsDataProvider,
  query: ProviderQuery,
  games: NormalizedGame[],
  existingHash: string | null,
): Promise<CachedGamesResult> {
  const now = new Date();
  const expiresAt = new Date(now.valueOf() + cacheDurationMs(games, now));
  const contentHash = sha256(games.map((game) => materialGame(game)));
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
  // Refresh the trust window even when normalized content is unchanged. This
  // intentionally costs one catalog write per game per provider refresh:
  // a cached game may only be selected while backed by a recent server fetch.
  await commitWritesInChunks(db, games, (batch, game) => {
    batch.set(
      db.collection("sportsCatalogGames").doc(game.id),
      {
        ...serializeGame(game),
        cacheKey: reference.id,
        catalogUpdatedAt: FieldValue.serverTimestamp(),
        catalogEligibleUntil: Timestamp.fromDate(expiresAt),
      },
      {merge: true},
    );
  });
  await reference.set(
    {
      provider: provider.name,
      requestType: "games",
      query: {
        sportCode: query.sportCode,
        leagueCode: query.leagueCode,
        leagueId: query.leagueId,
        season: query.season,
        from: query.from,
        to: query.to,
      },
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

export async function listGamesWithCache(
  provider: SportsDataProvider,
  query: ProviderQuery,
): Promise<CachedGamesResult> {
  const startedAt = Date.now();
  const key = cacheKey(provider, query);
  const reference = db.collection("sportsCache").doc(key);
  const cached = await readCache(reference);
  if (cached !== null && !cached.stale && query.forceRefresh !== true) {
    logger.info("Provider cache hit", {
      provider: provider.name,
      cacheKey: key,
      cacheHit: true,
      durationMs: Date.now() - startedAt,
    });
    return cached;
  }

  const lock = await acquireLock(key);
  if (!lock.acquired) {
    if (cached !== null) return {...cached, delayed: true};
    throw new HttpsError(
      "aborted",
      "Sports data is already refreshing. Try again shortly.",
    );
  }

  try {
    await reserveQuota(provider);
    const games = await provider.listGames(query);
    await recordProviderSuccess(provider);
    const result = await writeCache(
      reference,
      provider,
      query,
      games,
      cached?.contentHash ?? null,
    );
    logger.info("Provider refresh completed", {
      provider: provider.name,
      cacheKey: key,
      cacheHit: false,
      gameCount: games.length,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error: unknown) {
    await recordProviderFailure(provider, error);
    if (cached !== null) {
      logger.warn("Serving stale provider cache", {
        provider: provider.name,
        cacheKey: key,
        safeErrorCode: error instanceof Error ? error.name : "UnknownError",
      });
      return {...cached, stale: true, delayed: true};
    }
    if (error instanceof HttpsError) throw error;
    throw new HttpsError(
      "unavailable",
      "Sports data refresh is temporarily delayed.",
    );
  } finally {
    await releaseLock(key, lock.owner);
  }
}

export async function providerUsageSummary(
  providerName: string,
): Promise<Record<string, unknown>> {
  const snapshot = await usageReference(providerName).get();
  const data = snapshot.data() ?? {};
  return {
    provider: providerName,
    day: data.day ?? new Date().toISOString().slice(0, 10),
    requestCount: data.requestCount ?? 0,
    softLimit: data.softLimit ?? null,
    providerReportedRemaining: data.providerReportedRemaining ?? null,
    lastSuccessfulRequest: data.lastSuccessfulRequest ?? null,
    lastFailure: data.lastFailure ?? null,
    circuitState: data.circuitState ?? "closed",
    circuitOpenUntil: data.circuitOpenUntil ?? null,
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
