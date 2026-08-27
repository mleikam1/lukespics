import {randomUUID} from "node:crypto";
import {
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";
import {logger} from "firebase-functions";
import {HttpsError} from "firebase-functions/v2/https";
import {db, isEmulator} from "../config.js";
import {
  buildCbsCollegeFootballScoreboardUrl,
  parseCbsCollegeFootballScoreboardHtml,
  type CbsCollegeFootballSeasonType,
} from "../providers/cbsCollegeFootball.js";
import {normalizedGameSchema} from "../schemas.js";
import type {
  NormalizedGame,
  ProviderCachedGamesResult,
} from "../types.js";
import {sha256} from "../utils.js";

export const CBS_CONFIG_DOCUMENT_PATH =
  "systemConfig/cbsCollegeFootball";
export const CBS_USAGE_DOCUMENT_PATH =
  "providerUsage/cbsSports_rolling24h";
export const CBS_CACHE_COLLECTION = "sportsProviderCache";
export const CBS_CACHE_DOCUMENT_PREFIX = "cbs_ncaaf_FBS";
export const CBS_REFRESH_LEASE_MS = 90_000;
export const CBS_REQUEST_WINDOW_MS = 24 * 60 * 60 * 1000;
export const CBS_CIRCUIT_DURATION_MS = 6 * 60 * 60 * 1000;
export const CBS_HTTP_TIMEOUT_MS = 10_000;
export const CBS_MAXIMUM_RESPONSE_BYTES = 5_000_000;
export const CBS_MAXIMUM_REDIRECTS = 2;
export const CBS_MAXIMUM_REQUEST_ATTEMPTS = 2;
export const CBS_USER_AGENT =
  "LukesPicks/1.0 private-noncommercial-schedule-fetcher";
export const CBS_MINIMUM_REFRESH_MINUTES = 120;
export const CBS_DEFAULT_REFRESH_MINUTES = 180;
export const CBS_MAXIMUM_REFRESH_MINUTES = 240;
export const CBS_DEFAULT_DAILY_REQUEST_LIMIT = 12;
export const CBS_MAXIMUM_DAILY_REQUEST_LIMIT = 12;
export const CBS_SELECTED_GAME_MAXIMUM_IDS = 500;

const CBS_SCOREBOARD_HOST = "www.cbssports.com";
const CBS_SCOREBOARD_PATH_PREFIX = "/college-football/scoreboard/";
const CBS_TERMINAL_CACHE_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const CBS_MAXIMUM_CACHED_GAMES = 250;
const CBS_MAXIMUM_CACHE_GAME_BYTES = 750_000;
const CBS_RETRY_DELAY_BASE_MS = 250;
const CBS_MAXIMUM_RETRY_DELAY_MS = 2_000;
const CBS_MAXIMUM_FIRESTORE_DATE_MS =
  Date.UTC(9999, 11, 31, 23, 59, 59, 999);

export type CbsCollegeFootballScheduleInput = {
  season: number;
  seasonType: CbsCollegeFootballSeasonType;
  week: number;
  division: "FBS";
};

export type CbsCollegeFootballConfig = {
  enabled: boolean;
  autoRefreshEnabled: boolean;
  activeSeason: number | null;
  activeSeasonType: CbsCollegeFootballSeasonType | null;
  activeWeek: number | null;
  activeWeekStartsAtUtc: Date | null;
  division: "FBS";
  minimumRefreshMinutes: number;
  defaultRefreshMinutes: number;
  maximumRefreshMinutes: number;
  parserVersion: string;
  globalDailyRequestLimit: number;
};

export type CbsCacheRecord = {
  source: "cbsSports";
  sourceUrl: string;
  sport: "NCAAF";
  division: "FBS";
  season: number;
  seasonType: CbsCollegeFootballSeasonType;
  week: number;
  games: NormalizedGame[];
  etag: string | null;
  lastModified: string | null;
  contentHash: string;
  cachedAt: Date;
  lastAttemptAt: Date | null;
  lastSuccessfulFetchAt: Date | null;
  nextRefreshAt: Date | null;
  hardExpiresAt: Date | null;
  refreshState: "idle" | "refreshing";
  refreshLeaseOwner: string | null;
  refreshLeaseUntil: Date | null;
  lastHttpStatus: number | null;
  consecutiveFailures: number;
  lastErrorCode: string | null;
  lastErrorAt: Date | null;
  circuitOpenUntil: Date | null;
  parserVersion: string;
};

export type CbsRefreshBlockReason =
  | "fresh"
  | "cooldown"
  | "circuit"
  | "lease";

export type CbsLeaseResult =
  | {acquired: true; cache: CbsCacheRecord | null}
  | {
      acquired: false;
      cache: CbsCacheRecord | null;
      reason: CbsRefreshBlockReason;
      retryAt: Date | null;
    };

export type CbsUsageReservation = {
  allowed: boolean;
  reason: "limit" | "circuit" | null;
  retryAt: Date | null;
  remaining: number;
};

export type CbsRecordSuccessInput = {
  cacheId: string;
  leaseOwner: string;
  identity: CbsCollegeFootballScheduleInput;
  sourceUrl: string;
  now: Date;
  nextRefreshAt: Date | null;
  hardExpiresAt: Date;
  etag: string | null;
  lastModified: string | null;
  contentHash: string;
  games: NormalizedGame[] | null;
  httpStatus: number;
  parserVersion: string;
};

export type CbsRecordFailureInput = {
  cacheId: string;
  leaseOwner: string;
  now: Date;
  errorCode: string;
  httpStatus: number | null;
  nextRefreshAt: Date;
  circuitOpenUntil: Date | null;
  countsTowardCircuit: boolean;
};

export type CbsCollegeFootballStore = {
  readConfiguration(): Promise<unknown>;
  readCache(cacheId: string): Promise<CbsCacheRecord | null>;
  acquireRefreshLease(input: {
    cacheId: string;
    owner: string;
    now: Date;
    leaseUntil: Date;
    minimumRefreshMinutes: number;
    forceRefresh: boolean;
    bypassCooldown: boolean;
  }): Promise<CbsLeaseResult>;
  reserveRequestAttempt(input: {
    now: Date;
    limit: number;
    reservationId: string;
    cacheId: string;
  }): Promise<CbsUsageReservation>;
  recordRefreshSuccess(
    input: CbsRecordSuccessInput,
  ): Promise<CbsCacheRecord>;
  recordRefreshFailure(
    input: CbsRecordFailureInput,
  ): Promise<CbsCacheRecord | null>;
  releaseRefreshLease(cacheId: string, owner: string): Promise<void>;
};

export type CbsScheduleCacheStatus =
  | "fresh"
  | "refreshed"
  | "notModified"
  | "stale"
  | "refreshing";

export type CbsCollegeFootballScheduleResult =
  ProviderCachedGamesResult & {
    source: "cbsSports";
    season: number;
    seasonType: CbsCollegeFootballSeasonType;
    week: number;
    division: "FBS";
    cacheStatus: CbsScheduleCacheStatus;
    fetchedAt: Date | null;
    nextRefreshAt: Date | null;
    lastErrorCode: string | null;
  };

export type CbsCollegeFootballLoadOptions = {
  forceRefresh?: boolean;
  refreshReason?: "load" | "scheduled" | "admin";
};

export type CbsSafeLogger = {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
};

export type CbsCollegeFootballDependencies = {
  store?: CbsCollegeFootballStore;
  fetchImpl?: typeof fetch;
  clock?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  emulator?: boolean;
  logger?: CbsSafeLogger;
  configuration?: CbsCollegeFootballConfig;
  leaseOwner?: () => string;
  timeoutMs?: number;
  maximumResponseBytes?: number;
};

type CbsHttpResponse = {
  kind: "modified" | "notModified";
  status: number;
  html: string | null;
  etag: string | null;
  lastModified: string | null;
  requestCount: number;
};

type CbsHttpFailureCode =
  | "CBS_ACCESS_RESTRICTED"
  | "CBS_CHALLENGE_PAGE"
  | "CBS_DAILY_REQUEST_LIMIT_REACHED"
  | "CBS_HTTP_NOT_FOUND"
  | "CBS_HTTP_REJECTED"
  | "CBS_HTTP_TOO_LARGE"
  | "CBS_HTTP_UPSTREAM"
  | "CBS_NETWORK_ERROR"
  | "CBS_PROVIDER_CIRCUIT_OPEN"
  | "CBS_REDIRECT_REJECTED"
  | "CBS_REQUEST_TIMEOUT";

export class CbsCollegeFootballRequestError extends Error {
  constructor(
    readonly safeCode: CbsHttpFailureCode,
    message: string,
    readonly httpStatus: number | null = null,
    readonly circuitOpenUntil: Date | null = null,
    readonly retryAfterUntil: Date | null = null,
  ) {
    super(message);
    this.name = "CbsCollegeFootballRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function configuredMinutes(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return validInteger(value, minimum, maximum) ? value : fallback;
}

/**
 * Invalid or missing fields never enable network access. Refresh values are
 * constrained to the reviewed two-to-four-hour envelope, and the request cap
 * can only be lowered from twelve.
 */
export function parseCbsCollegeFootballConfig(
  value: unknown,
): CbsCollegeFootballConfig {
  const data = isRecord(value) ? value : {};
  const minimumRefreshMinutes = configuredMinutes(
    data.minimumRefreshMinutes,
    CBS_MINIMUM_REFRESH_MINUTES,
    CBS_MINIMUM_REFRESH_MINUTES,
    CBS_MAXIMUM_REFRESH_MINUTES,
  );
  const maximumRefreshMinutes = configuredMinutes(
    data.maximumRefreshMinutes,
    CBS_MAXIMUM_REFRESH_MINUTES,
    minimumRefreshMinutes,
    CBS_MAXIMUM_REFRESH_MINUTES,
  );
  const safeDefaultRefreshMinutes = Math.min(
    maximumRefreshMinutes,
    Math.max(minimumRefreshMinutes, CBS_DEFAULT_REFRESH_MINUTES),
  );
  const defaultRefreshMinutes = configuredMinutes(
    data.defaultRefreshMinutes,
    safeDefaultRefreshMinutes,
    minimumRefreshMinutes,
    maximumRefreshMinutes,
  );
  const activeSeason = validInteger(data.activeSeason, 2000, 2100)
    ? data.activeSeason
    : null;
  const activeSeasonType =
    data.activeSeasonType === "regular" ||
    data.activeSeasonType === "postseason"
      ? data.activeSeasonType
      : null;
  const activeWeek = validInteger(data.activeWeek, 0, 25)
    ? data.activeWeek
    : null;
  const activeIdentityComplete =
    activeSeason !== null &&
    activeSeasonType !== null &&
    activeWeek !== null &&
    (data.division === undefined || data.division === "FBS");
  const parserVersion =
    typeof data.parserVersion === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(data.parserVersion)
      ? data.parserVersion
      : "1.0.0";
  const enabled =
    data.enabled === true &&
    (data.division === undefined || data.division === "FBS");
  return {
    enabled,
    autoRefreshEnabled:
      enabled && data.autoRefreshEnabled === true && activeIdentityComplete,
    activeSeason,
    activeSeasonType,
    activeWeek,
    activeWeekStartsAtUtc: dateFromUnknown(data.activeWeekStartsAtUtc),
    division: "FBS",
    minimumRefreshMinutes,
    defaultRefreshMinutes,
    maximumRefreshMinutes,
    parserVersion,
    globalDailyRequestLimit: configuredMinutes(
      data.globalDailyRequestLimit,
      CBS_DEFAULT_DAILY_REQUEST_LIMIT,
      1,
      CBS_MAXIMUM_DAILY_REQUEST_LIMIT,
    ),
  };
}

export function validateCbsCollegeFootballScheduleInput(
  value: unknown,
): CbsCollegeFootballScheduleInput {
  const data = isRecord(value) ? value : {};
  if (!validInteger(data.season, 2000, 2100)) {
    throw new HttpsError(
      "invalid-argument",
      "College-football season must be from 2000 through 2100.",
    );
  }
  if (data.seasonType !== "regular" && data.seasonType !== "postseason") {
    throw new HttpsError(
      "invalid-argument",
      "College-football season type must be regular or postseason.",
    );
  }
  if (!validInteger(data.week, 0, 25)) {
    throw new HttpsError(
      "invalid-argument",
      "College-football week must be from 0 through 25.",
    );
  }
  if (data.division !== "FBS") {
    throw new HttpsError(
      "invalid-argument",
      "Only the FBS college-football scoreboard is supported.",
    );
  }
  return {
    season: data.season,
    seasonType: data.seasonType,
    week: data.week,
    division: "FBS",
  };
}

/**
 * Binds every caller-supplied schedule identity to the single Admin-configured
 * active week. This prevents authenticated callers from turning the bounded
 * endpoint into an arbitrary historical-week crawler.
 */
export function assertCbsCollegeFootballActiveIdentity(
  config: CbsCollegeFootballConfig,
  value: unknown,
): CbsCollegeFootballScheduleInput {
  const input = validateCbsCollegeFootballScheduleInput(value);
  if (
    config.activeSeason === null ||
    config.activeSeasonType === null ||
    config.activeWeek === null ||
    input.season !== config.activeSeason ||
    input.seasonType !== config.activeSeasonType ||
    input.week !== config.activeWeek
  ) {
    throw new HttpsError(
      "failed-precondition",
      "The requested college-football schedule is not the configured active week.",
    );
  }
  return input;
}

export function cbsCollegeFootballCacheDocumentId(
  input: CbsCollegeFootballScheduleInput,
): string {
  const valid = validateCbsCollegeFootballScheduleInput(input);
  return `${CBS_CACHE_DOCUMENT_PREFIX}_${valid.season}_${valid.seasonType}_${valid.week}`;
}

export function validateCbsCollegeFootballRequestUrl(value: URL | string): URL {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value) : new URL(value);
  } catch {
    throw new CbsCollegeFootballRequestError(
      "CBS_REDIRECT_REJECTED",
      "CBS scoreboard URL was invalid.",
    );
  }
  const route =
    /^\/college-football\/scoreboard\/FBS\/(\d{4})\/(regular|postseason)\/(\d{1,2})\/$/
      .exec(url.pathname);
  const routeSeason = route === null ? null : Number(route[1]);
  const routeWeek = route === null ? null : Number(route[3]);
  if (
    url.protocol !== "https:" ||
    url.hostname !== CBS_SCOREBOARD_HOST ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    !url.pathname.startsWith(CBS_SCOREBOARD_PATH_PREFIX) ||
    url.search !== "" ||
    url.hash !== "" ||
    route === null ||
    routeSeason === null ||
    !validInteger(routeSeason, 2000, 2100) ||
    routeWeek === null ||
    !validInteger(routeWeek, 0, 25)
  ) {
    throw new CbsCollegeFootballRequestError(
      "CBS_REDIRECT_REJECTED",
      "CBS scoreboard URL did not match the strict allowlist.",
    );
  }
  return url;
}

function dateFromUnknown(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return new Date(value);
  }
  if (value instanceof Timestamp) return value.toDate();
  if (
    isRecord(value) &&
    typeof value.toDate === "function"
  ) {
    try {
      const converted = (value.toDate as () => unknown)();
      return converted instanceof Date && Number.isFinite(converted.valueOf())
        ? converted
        : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.valueOf()) ? date : null;
  }
  return null;
}

function normalizedCachedGame(value: unknown): NormalizedGame {
  if (!isRecord(value)) {
    throw new Error("CBS cached game was not an object.");
  }
  const dateField = (name: string): Date | null => {
    const raw = value[name];
    return raw === null ? null : dateFromUnknown(raw);
  };
  const providerLastUpdatedAt = dateField("providerLastUpdatedAt");
  const lastSyncedAt = dateField("lastSyncedAt");
  if (providerLastUpdatedAt === null || lastSyncedAt === null) {
    throw new Error("CBS cached game observation dates were invalid.");
  }
  return normalizedGameSchema.parse({
    ...value,
    scheduledAtUtc: dateField("scheduledAtUtc"),
    publishedScheduledAtUtc: dateField("publishedScheduledAtUtc"),
    effectiveLockAtUtc: dateField("effectiveLockAtUtc"),
    providerLastUpdatedAt,
    lastSyncedAt,
  });
}

function cachedGameForStorage(game: NormalizedGame): Record<string, unknown> {
  const normalized = normalizedGameSchema.parse(game);
  return {
    ...normalized,
    scheduledAtUtc: normalized.scheduledAtUtc?.toISOString() ?? null,
    publishedScheduledAtUtc:
      normalized.publishedScheduledAtUtc?.toISOString() ?? null,
    effectiveLockAtUtc:
      normalized.effectiveLockAtUtc?.toISOString() ?? null,
    providerLastUpdatedAt: normalized.providerLastUpdatedAt.toISOString(),
    lastSyncedAt: normalized.lastSyncedAt.toISOString(),
  };
}

function materialCachedGame(game: NormalizedGame): Record<string, unknown> {
  const serialized = cachedGameForStorage(game);
  const {
    lastSyncedAt: _lastSyncedAt,
    providerLastUpdatedAt: _providerLastUpdatedAt,
    ...material
  } = serialized;
  return material;
}

export function cbsCollegeFootballGamesContentHash(
  games: NormalizedGame[],
): string {
  return sha256(
    [...games]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((game) => materialCachedGame(game)),
  );
}

export function isCbsTerminalSchedule(games: NormalizedGame[]): boolean {
  return (
    games.length > 0 &&
    games.every((game) =>
      ["final", "cancelled", "void"].includes(game.status),
    )
  );
}

function matchesActiveIdentity(
  input: CbsCollegeFootballScheduleInput,
  config: CbsCollegeFootballConfig,
): boolean {
  return (
    input.season === config.activeSeason &&
    input.seasonType === config.activeSeasonType &&
    input.week === config.activeWeek
  );
}

export function cbsCollegeFootballRefreshMinutes(input: {
  games: NormalizedGame[];
  schedule: CbsCollegeFootballScheduleInput;
  config: CbsCollegeFootballConfig;
  now: Date;
}): number | null {
  if (isCbsTerminalSchedule(input.games)) return null;
  const withinTwentyFourHours = input.games.some((game) => {
    if (game.status === "live") return true;
    if (game.scheduledAtUtc === null) return false;
    const difference = game.scheduledAtUtc.valueOf() - input.now.valueOf();
    return (
      difference >= -24 * 60 * 60 * 1000 &&
      difference <= 24 * 60 * 60 * 1000
    );
  });
  if (withinTwentyFourHours) {
    return input.config.minimumRefreshMinutes;
  }
  const activeIdentity = matchesActiveIdentity(input.schedule, input.config);
  const configuredWeekIsFuture =
    activeIdentity &&
    input.config.activeWeekStartsAtUtc !== null &&
    input.now < input.config.activeWeekStartsAtUtc;
  return !activeIdentity || configuredWeekIsFuture
    ? input.config.maximumRefreshMinutes
    : input.config.defaultRefreshMinutes;
}

export function cbsCollegeFootballNextRefreshAt(input: {
  games: NormalizedGame[];
  schedule: CbsCollegeFootballScheduleInput;
  config: CbsCollegeFootballConfig;
  now: Date;
}): Date | null {
  const minutes = cbsCollegeFootballRefreshMinutes(input);
  return minutes === null
    ? null
    : new Date(input.now.valueOf() + minutes * 60_000);
}

function cacheRecordFromData(data: DocumentData | undefined): CbsCacheRecord | null {
  if (data === undefined || !Array.isArray(data.games)) return null;
  try {
    if (
      data.source !== "cbsSports" ||
      data.sport !== "NCAAF" ||
      data.division !== "FBS" ||
      !validInteger(data.season, 2000, 2100) ||
      (data.seasonType !== "regular" && data.seasonType !== "postseason") ||
      !validInteger(data.week, 0, 25) ||
      typeof data.sourceUrl !== "string"
    ) {
      return null;
    }
    const games = data.games.map((game: unknown) => normalizedCachedGame(game));
    const contentHash = cbsCollegeFootballGamesContentHash(games);
    if (typeof data.contentHash !== "string" || data.contentHash !== contentHash) {
      return null;
    }
    const cachedAt = dateFromUnknown(data.cachedAt);
    if (cachedAt === null) return null;
    const identity = {
      season: data.season,
      seasonType: data.seasonType,
      week: data.week,
      division: "FBS" as const,
    };
    const sourceUrl = validateCbsCollegeFootballRequestUrl(
      data.sourceUrl,
    ).toString();
    if (
      sourceUrl !==
      buildCbsCollegeFootballScoreboardUrl(identity).toString()
    ) {
      return null;
    }
    return {
      source: "cbsSports",
      sourceUrl,
      sport: "NCAAF",
      division: "FBS",
      season: data.season,
      seasonType: data.seasonType,
      week: data.week,
      games,
      etag: safeValidator(data.etag, 1_024),
      lastModified: safeValidator(data.lastModified, 256),
      contentHash,
      cachedAt,
      lastAttemptAt: dateFromUnknown(data.lastAttemptAt),
      lastSuccessfulFetchAt: dateFromUnknown(data.lastSuccessfulFetchAt),
      nextRefreshAt: dateFromUnknown(data.nextRefreshAt),
      hardExpiresAt: dateFromUnknown(data.hardExpiresAt),
      refreshState: data.refreshState === "refreshing" ? "refreshing" : "idle",
      refreshLeaseOwner:
        typeof data.refreshLeaseOwner === "string"
          ? data.refreshLeaseOwner
          : null,
      refreshLeaseUntil: dateFromUnknown(data.refreshLeaseUntil),
      lastHttpStatus:
        validInteger(data.lastHttpStatus, 100, 599)
          ? data.lastHttpStatus
          : null,
      consecutiveFailures:
        validInteger(data.consecutiveFailures, 0, 1_000)
          ? data.consecutiveFailures
          : 0,
      lastErrorCode:
        typeof data.lastErrorCode === "string"
          ? data.lastErrorCode.slice(0, 80)
          : null,
      lastErrorAt: dateFromUnknown(data.lastErrorAt),
      circuitOpenUntil: dateFromUnknown(data.circuitOpenUntil),
      parserVersion:
        typeof data.parserVersion === "string"
          ? data.parserVersion.slice(0, 40)
          : "unknown",
    };
  } catch {
    return null;
  }
}

function safeValidator(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > maximumLength ||
    /[\r\n]/.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function timestampOrNull(value: Date | null): Timestamp | null {
  return value === null ? null : Timestamp.fromDate(value);
}

export class FirestoreCbsCollegeFootballStore
implements CbsCollegeFootballStore {
  constructor(private readonly firestore: Firestore = db) {}

  async readConfiguration(): Promise<unknown> {
    const snapshot = await this.firestore
      .collection("systemConfig")
      .doc("cbsCollegeFootball")
      .get();
    return snapshot.data() ?? {};
  }

  async readCache(cacheId: string): Promise<CbsCacheRecord | null> {
    const snapshot = await this.firestore
      .collection(CBS_CACHE_COLLECTION)
      .doc(cacheId)
      .get();
    return cacheRecordFromData(snapshot.data());
  }

  async acquireRefreshLease(input: {
    cacheId: string;
    owner: string;
    now: Date;
    leaseUntil: Date;
    minimumRefreshMinutes: number;
    forceRefresh: boolean;
    bypassCooldown: boolean;
  }): Promise<CbsLeaseResult> {
    const reference = this.firestore
      .collection(CBS_CACHE_COLLECTION)
      .doc(input.cacheId);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const cache = cacheRecordFromData(snapshot.data());
      const data = snapshot.data() ?? {};
      const leaseUntil = dateFromUnknown(data.refreshLeaseUntil);
      if (
        data.refreshState === "refreshing" &&
        leaseUntil !== null &&
        leaseUntil > input.now &&
        data.refreshLeaseOwner !== input.owner
      ) {
        return {acquired: false, cache, reason: "lease", retryAt: leaseUntil};
      }
      const circuitOpenUntil = dateFromUnknown(data.circuitOpenUntil);
      if (circuitOpenUntil !== null && circuitOpenUntil > input.now) {
        return {
          acquired: false,
          cache,
          reason: "circuit",
          retryAt: circuitOpenUntil,
        };
      }
      const nextRefreshAt = dateFromUnknown(data.nextRefreshAt);
      if (
        !input.forceRefresh &&
        nextRefreshAt !== null &&
        nextRefreshAt > input.now
      ) {
        return {
          acquired: false,
          cache,
          reason: "fresh",
          retryAt: nextRefreshAt,
        };
      }
      const lastSuccessfulFetchAt = dateFromUnknown(
        data.lastSuccessfulFetchAt,
      );
      const lastAttemptAt = dateFromUnknown(data.lastAttemptAt);
      const cooldownAnchor = latestDate(
        lastSuccessfulFetchAt,
        lastAttemptAt,
      );
      const cooldownUntil =
        cooldownAnchor === null
          ? null
          : new Date(
              cooldownAnchor.valueOf() +
              input.minimumRefreshMinutes * 60_000,
            );
      if (
        !input.bypassCooldown &&
        cooldownUntil !== null &&
        cooldownUntil > input.now
      ) {
        return {
          acquired: false,
          cache,
          reason: "cooldown",
          retryAt: cooldownUntil,
        };
      }
      transaction.set(reference, {
        refreshState: "refreshing",
        refreshLeaseOwner: input.owner,
        refreshLeaseUntil: Timestamp.fromDate(input.leaseUntil),
        lastAttemptAt: Timestamp.fromDate(input.now),
      }, {merge: true});
      return {acquired: true, cache};
    });
  }

  async reserveRequestAttempt(input: {
    now: Date;
    limit: number;
    reservationId: string;
    cacheId: string;
  }): Promise<CbsUsageReservation> {
    const reference = this.firestore
      .collection("providerUsage")
      .doc("cbsSports_rolling24h");
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const providerCircuitOpenUntil = dateFromUnknown(
        snapshot.data()?.circuitOpenUntil,
      );
      if (
        providerCircuitOpenUntil !== null &&
        providerCircuitOpenUntil > input.now
      ) {
        return {
          allowed: false,
          reason: "circuit",
          retryAt: providerCircuitOpenUntil,
          remaining: 0,
        };
      }
      const cutoff = input.now.valueOf() - CBS_REQUEST_WINDOW_MS;
      const rawReservations = snapshot.data()?.reservations;
      const active = Array.isArray(rawReservations)
        ? rawReservations.flatMap((reservation: unknown) => {
            if (!isRecord(reservation)) return [];
            const reservedAt = dateFromUnknown(reservation.reservedAt);
            if (reservedAt === null || reservedAt.valueOf() <= cutoff) return [];
            return [{
              reservationId:
                typeof reservation.reservationId === "string"
                  ? reservation.reservationId.slice(0, 80)
                  : "retained",
              cacheId:
                typeof reservation.cacheId === "string"
                  ? reservation.cacheId.slice(0, 128)
                  : "unknown",
              reservedAt,
            }];
          })
        : [];
      if (active.length >= input.limit) {
        const oldest = active
          .map((reservation) => reservation.reservedAt.valueOf())
          .sort((left, right) => left - right)[0];
        const retryAt = oldest === undefined
          ? new Date(input.now.valueOf() + CBS_REQUEST_WINDOW_MS)
          : new Date(oldest + CBS_REQUEST_WINDOW_MS);
        transaction.set(reference, {
          provider: "cbsSports",
          windowHours: 24,
          configuredLimit: input.limit,
          reservations: active.map((reservation) => ({
            ...reservation,
            reservedAt: Timestamp.fromDate(reservation.reservedAt),
          })),
          circuitOpenUntil: Timestamp.fromDate(retryAt),
          updatedAt: Timestamp.fromDate(input.now),
        }, {merge: true});
        return {
          allowed: false,
          reason: "limit",
          retryAt,
          remaining: 0,
        };
      }
      const updated = [...active, {
        reservationId: input.reservationId,
        cacheId: input.cacheId,
        reservedAt: input.now,
      }];
      transaction.set(reference, {
        provider: "cbsSports",
        windowHours: 24,
        configuredLimit: input.limit,
        reservations: updated.map((reservation) => ({
          ...reservation,
          reservedAt: Timestamp.fromDate(reservation.reservedAt),
        })),
        lastReservedAt: Timestamp.fromDate(input.now),
        circuitOpenUntil: null,
        updatedAt: Timestamp.fromDate(input.now),
      }, {merge: true});
      return {
        allowed: true,
        reason: null,
        retryAt: null,
        remaining: Math.max(0, input.limit - updated.length),
      };
    });
  }

  async recordRefreshSuccess(
    input: CbsRecordSuccessInput,
  ): Promise<CbsCacheRecord> {
    const reference = this.firestore
      .collection(CBS_CACHE_COLLECTION)
      .doc(input.cacheId);
    const usageReference = this.firestore
      .collection("providerUsage")
      .doc("cbsSports_rolling24h");
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const existing = cacheRecordFromData(snapshot.data());
      if (snapshot.data()?.refreshLeaseOwner !== input.leaseOwner) {
        throw new Error("CBS refresh lease ownership changed before success.");
      }
      const games = input.games ?? existing?.games ?? null;
      if (games === null) {
        throw new Error("CBS 304 response did not have a cached schedule.");
      }
      await transaction.get(usageReference);
      const update: Record<string, unknown> = {
        source: "cbsSports",
        sourceUrl: input.sourceUrl,
        sport: "NCAAF",
        division: input.identity.division,
        season: input.identity.season,
        seasonType: input.identity.seasonType,
        week: input.identity.week,
        etag: input.etag,
        lastModified: input.lastModified,
        contentHash: input.contentHash,
        cachedAt: Timestamp.fromDate(input.now),
        lastAttemptAt: Timestamp.fromDate(input.now),
        lastSuccessfulFetchAt: Timestamp.fromDate(input.now),
        nextRefreshAt: timestampOrNull(input.nextRefreshAt),
        hardExpiresAt: Timestamp.fromDate(input.hardExpiresAt),
        lastHttpStatus: input.httpStatus,
        consecutiveFailures: 0,
        lastErrorCode: null,
        lastErrorAt: null,
        circuitOpenUntil: null,
        parserVersion: input.parserVersion,
      };
      if (input.games !== null) {
        update.games = input.games.map((game) => cachedGameForStorage(game));
      }
      transaction.set(reference, update, {merge: true});
      transaction.set(usageReference, {
        provider: "cbsSports",
        consecutiveFailures: 0,
        lastSuccessfulFetchAt: Timestamp.fromDate(input.now),
        updatedAt: Timestamp.fromDate(input.now),
      }, {merge: true});
      return {
        source: "cbsSports",
        sourceUrl: input.sourceUrl,
        sport: "NCAAF",
        division: input.identity.division,
        season: input.identity.season,
        seasonType: input.identity.seasonType,
        week: input.identity.week,
        games,
        etag: input.etag,
        lastModified: input.lastModified,
        contentHash: input.contentHash,
        cachedAt: input.now,
        lastAttemptAt: input.now,
        lastSuccessfulFetchAt: input.now,
        nextRefreshAt: input.nextRefreshAt,
        hardExpiresAt: input.hardExpiresAt,
        refreshState: "refreshing",
        refreshLeaseOwner: input.leaseOwner,
        refreshLeaseUntil: dateFromUnknown(snapshot.data()?.refreshLeaseUntil),
        lastHttpStatus: input.httpStatus,
        consecutiveFailures: 0,
        lastErrorCode: null,
        lastErrorAt: null,
        circuitOpenUntil: null,
        parserVersion: input.parserVersion,
      };
    });
  }

  async recordRefreshFailure(
    input: CbsRecordFailureInput,
  ): Promise<CbsCacheRecord | null> {
    const reference = this.firestore
      .collection(CBS_CACHE_COLLECTION)
      .doc(input.cacheId);
    const usageReference = this.firestore
      .collection("providerUsage")
      .doc("cbsSports_rolling24h");
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.data()?.refreshLeaseOwner !== input.leaseOwner) {
        return cacheRecordFromData(snapshot.data());
      }
      const storedFailures = snapshot.data()?.consecutiveFailures;
      const previousFailures = validInteger(storedFailures, 0, 1_000)
        ? storedFailures
        : 0;
      const failures = input.countsTowardCircuit
        ? Math.min(1_000, previousFailures + 1)
        : previousFailures;
      const automaticCircuit = failures >= 3
        ? new Date(input.now.valueOf() + CBS_CIRCUIT_DURATION_MS)
        : null;
      const localCircuitOpenUntil = latestDate(
        input.circuitOpenUntil,
        automaticCircuit,
      );
      const usageSnapshot = await transaction.get(usageReference);
      const storedProviderFailures =
        usageSnapshot.data()?.consecutiveFailures;
      const previousProviderFailures = validInteger(
        storedProviderFailures,
        0,
        1_000,
      )
        ? storedProviderFailures
        : 0;
      const providerFailures = input.countsTowardCircuit
        ? Math.min(1_000, previousProviderFailures + 1)
        : previousProviderFailures;
      const providerAutomaticCircuit = providerFailures >= 3
        ? new Date(input.now.valueOf() + CBS_CIRCUIT_DURATION_MS)
        : null;
      const storedProviderCircuit = dateFromUnknown(
        usageSnapshot.data()?.circuitOpenUntil,
      );
      const providerCircuitOpenUntil = latestDate(
        storedProviderCircuit !== null && storedProviderCircuit > input.now
          ? storedProviderCircuit
          : null,
        latestDate(localCircuitOpenUntil, providerAutomaticCircuit),
      );
      const circuitOpenUntil = latestDate(
        localCircuitOpenUntil,
        providerCircuitOpenUntil,
      );
      const nextRefreshAt = latestDate(
        input.nextRefreshAt,
        circuitOpenUntil,
      ) ?? input.nextRefreshAt;
      transaction.set(reference, {
        lastAttemptAt: Timestamp.fromDate(input.now),
        nextRefreshAt: Timestamp.fromDate(nextRefreshAt),
        lastHttpStatus: input.httpStatus,
        consecutiveFailures: failures,
        lastErrorCode: input.errorCode.slice(0, 80),
        lastErrorAt: Timestamp.fromDate(input.now),
        circuitOpenUntil: timestampOrNull(circuitOpenUntil),
      }, {merge: true});
      transaction.set(usageReference, {
        provider: "cbsSports",
        consecutiveFailures: providerFailures,
        circuitOpenUntil: timestampOrNull(providerCircuitOpenUntil),
        lastFailureCode: input.errorCode.slice(0, 80),
        lastFailureAt: Timestamp.fromDate(input.now),
        ...(providerCircuitOpenUntil === null
          ? {}
          : {
              lastRestrictionCode: input.errorCode.slice(0, 80),
              lastRestrictionAt: Timestamp.fromDate(input.now),
            }),
        updatedAt: Timestamp.fromDate(input.now),
      }, {merge: true});
      const existing = cacheRecordFromData(snapshot.data());
      return existing === null
        ? null
        : {
            ...existing,
            lastAttemptAt: input.now,
            nextRefreshAt,
            lastHttpStatus: input.httpStatus,
            consecutiveFailures: failures,
            lastErrorCode: input.errorCode,
            lastErrorAt: input.now,
            circuitOpenUntil,
          };
    });
  }

  async releaseRefreshLease(cacheId: string, owner: string): Promise<void> {
    const reference = this.firestore
      .collection(CBS_CACHE_COLLECTION)
      .doc(cacheId);
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.data()?.refreshLeaseOwner === owner) {
        transaction.set(reference, {
          refreshState: "idle",
          refreshLeaseOwner: null,
          refreshLeaseUntil: null,
        }, {merge: true});
      }
    });
  }
}

function latestDate(left: Date | null, right: Date | null): Date | null {
  if (left === null) return right;
  if (right === null) return left;
  return left > right ? left : right;
}

function retryAfterDate(value: string | null, now: Date): Date | null {
  if (value === null) return null;
  const nowMilliseconds = now.valueOf();
  if (!Number.isFinite(nowMilliseconds)) return null;
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized);
    if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
    const milliseconds = nowMilliseconds + seconds * 1000;
    return Number.isFinite(milliseconds) &&
      milliseconds <= CBS_MAXIMUM_FIRESTORE_DATE_MS
      ? new Date(milliseconds)
      : null;
  }
  const parsed = Date.parse(normalized);
  const milliseconds = Math.max(nowMilliseconds, parsed);
  return Number.isFinite(milliseconds) &&
    milliseconds <= CBS_MAXIMUM_FIRESTORE_DATE_MS
    ? new Date(milliseconds)
    : null;
}

function circuitForRestrictedResponse(response: Response, now: Date): Date {
  const minimum = new Date(now.valueOf() + CBS_CIRCUIT_DURATION_MS);
  return latestDate(
    minimum,
    retryAfterDate(response.headers.get("retry-after"), now),
  ) ?? minimum;
}

function timeoutLike(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function challengePage(html: string): boolean {
  const sample = html.slice(0, 250_000).toLowerCase();
  if ([
    "cf-chl-",
    "challenge-platform",
    "access denied",
    "verify you are human",
    "unusual traffic",
  ].some((marker) => sample.includes(marker))) {
    return true;
  }
  // CBS's valid scoreboard currently embeds a generic CAPTCHA-related asset
  // string alongside the real game cards. Treat CAPTCHA as a challenge only
  // when the page also contains a human-verification prompt; a bare asset or
  // analytics marker is not evidence that the response body is a challenge.
  return sample.includes("captcha") && [
    "complete the captcha",
    "solve the captcha",
    "are you a robot",
    "are you human",
    "human verification",
  ].some((marker) => sample.includes(marker));
}

async function boundedResponseText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new CbsCollegeFootballRequestError(
      "CBS_HTTP_TOO_LARGE",
      "CBS scoreboard response exceeded the safe size limit.",
      response.status,
    );
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      byteCount += next.value.byteLength;
      if (byteCount > maximumBytes) {
        await reader.cancel();
        throw new CbsCollegeFootballRequestError(
          "CBS_HTTP_TOO_LARGE",
          "CBS scoreboard response exceeded the safe size limit.",
          response.status,
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
    "utf8",
  );
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;
}

export async function fetchCbsCollegeFootballScoreboard(input: {
  url: URL | string;
  etag: string | null;
  lastModified: string | null;
  authorizeRequest: () => Promise<void>;
  fetchImpl?: typeof fetch;
  clock?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
  maximumResponseBytes?: number;
}): Promise<CbsHttpResponse> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const clock = input.clock ?? (() => new Date());
  const sleep = input.sleep ?? defaultSleep;
  const random = input.random ?? Math.random;
  const timeoutMs = boundedPositiveInteger(
    input.timeoutMs,
    CBS_HTTP_TIMEOUT_MS,
    CBS_HTTP_TIMEOUT_MS,
  );
  const maximumBytes = boundedPositiveInteger(
    input.maximumResponseBytes,
    CBS_MAXIMUM_RESPONSE_BYTES,
    CBS_MAXIMUM_RESPONSE_BYTES,
  );
  const initialUrl = validateCbsCollegeFootballRequestUrl(input.url);
  let requestCount = 0;

  for (let attempt = 0; attempt < CBS_MAXIMUM_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      let currentUrl = initialUrl;
      for (
        let redirects = 0;
        redirects <= CBS_MAXIMUM_REDIRECTS;
        redirects += 1
      ) {
        await input.authorizeRequest();
        requestCount += 1;
        let response: Response;
        try {
          response = await fetchImpl(currentUrl, {
            method: "GET",
            headers: {
              accept: "text/html,application/xhtml+xml",
              "user-agent": CBS_USER_AGENT,
              ...(input.etag === null
                ? {}
                : {"if-none-match": input.etag}),
              ...(input.lastModified === null
                ? {}
                : {"if-modified-since": input.lastModified}),
            },
            redirect: "manual",
            credentials: "omit",
            referrerPolicy: "no-referrer",
            cache: "no-store",
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (error: unknown) {
          if (timeoutLike(error)) {
            throw new CbsCollegeFootballRequestError(
              "CBS_REQUEST_TIMEOUT",
              "CBS scoreboard request timed out.",
            );
          }
          throw new CbsCollegeFootballRequestError(
            "CBS_NETWORK_ERROR",
            "CBS scoreboard request failed before a response was received.",
          );
        }

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (redirects >= CBS_MAXIMUM_REDIRECTS) {
            throw new CbsCollegeFootballRequestError(
              "CBS_REDIRECT_REJECTED",
              "CBS scoreboard exceeded the redirect limit.",
              response.status,
            );
          }
          const location = response.headers.get("location");
          if (location === null) {
            throw new CbsCollegeFootballRequestError(
              "CBS_REDIRECT_REJECTED",
              "CBS scoreboard returned an invalid redirect.",
              response.status,
            );
          }
          let redirectUrl: URL;
          try {
            redirectUrl = new URL(location, currentUrl);
          } catch {
            throw new CbsCollegeFootballRequestError(
              "CBS_REDIRECT_REJECTED",
              "CBS scoreboard returned an invalid redirect location.",
              response.status,
            );
          }
          const validatedRedirect = validateCbsCollegeFootballRequestUrl(
            redirectUrl,
          );
          if (validatedRedirect.toString() !== initialUrl.toString()) {
            throw new CbsCollegeFootballRequestError(
              "CBS_REDIRECT_REJECTED",
              "CBS scoreboard redirect changed the requested week identity.",
              response.status,
            );
          }
          currentUrl = validatedRedirect;
          continue;
        }
        if (response.status === 304) {
          return {
            kind: "notModified",
            status: 304,
            html: null,
            etag: safeValidator(response.headers.get("etag"), 1_024) ??
              input.etag,
            lastModified:
              safeValidator(response.headers.get("last-modified"), 256) ??
              input.lastModified,
            requestCount,
          };
        }
        if (response.status === 403 || response.status === 429) {
          throw new CbsCollegeFootballRequestError(
            "CBS_ACCESS_RESTRICTED",
            "CBS scoreboard access is temporarily restricted.",
            response.status,
            circuitForRestrictedResponse(response, clock()),
          );
        }
        if (response.status === 404) {
          throw new CbsCollegeFootballRequestError(
            "CBS_HTTP_NOT_FOUND",
            "CBS scoreboard page was not found.",
            404,
          );
        }
        if (response.status >= 500) {
          const responseNow = clock();
          const retryAfterUntil = retryAfterDate(
            response.headers.get("retry-after"),
            responseNow,
          );
          throw new CbsCollegeFootballRequestError(
            "CBS_HTTP_UPSTREAM",
            "CBS scoreboard is temporarily unavailable.",
            response.status,
            retryAfterUntil,
            retryAfterUntil,
          );
        }
        if (!response.ok || response.status !== 200) {
          throw new CbsCollegeFootballRequestError(
            "CBS_HTTP_REJECTED",
            "CBS scoreboard rejected the allowlisted request.",
            response.status,
          );
        }
        const html = await boundedResponseText(response, maximumBytes);
        if (challengePage(html)) {
          throw new CbsCollegeFootballRequestError(
            "CBS_CHALLENGE_PAGE",
            "CBS scoreboard returned an access challenge.",
            response.status,
            new Date(clock().valueOf() + CBS_CIRCUIT_DURATION_MS),
          );
        }
        return {
          kind: "modified",
          status: response.status,
          html,
          etag: safeValidator(response.headers.get("etag"), 1_024),
          lastModified: safeValidator(
            response.headers.get("last-modified"),
            256,
          ),
          requestCount,
        };
      }
    } catch (error: unknown) {
      const retryable =
        error instanceof CbsCollegeFootballRequestError &&
        (error.safeCode === "CBS_REQUEST_TIMEOUT" ||
          error.safeCode === "CBS_HTTP_UPSTREAM");
      if (!retryable || attempt === CBS_MAXIMUM_REQUEST_ATTEMPTS - 1) {
        throw error;
      }
      if (
        error instanceof CbsCollegeFootballRequestError &&
        error.retryAfterUntil !== null
      ) {
        // A function invocation must not sleep for an upstream-requested
        // interval. Persist the parsed not-before time instead of consuming a
        // second request reservation immediately.
        throw error;
      }
      const jitter = Math.floor(
        Math.min(0.999_999, Math.max(0, random())) * 100,
      );
      await sleep(Math.min(
        CBS_MAXIMUM_RETRY_DELAY_MS,
        CBS_RETRY_DELAY_BASE_MS + jitter,
      ));
    }
  }
  throw new CbsCollegeFootballRequestError(
    "CBS_NETWORK_ERROR",
    "CBS scoreboard request failed.",
  );
}

function resultFromCache(input: {
  cache: CbsCacheRecord;
  now: Date;
  status: CbsScheduleCacheStatus;
  stale: boolean;
  delayed: boolean;
}): CbsCollegeFootballScheduleResult {
  const terminal = isCbsTerminalSchedule(input.cache.games);
  const expiresAt = input.cache.nextRefreshAt ??
    new Date(input.cache.cachedAt.valueOf() + CBS_TERMINAL_CACHE_MS);
  return {
    source: "cbsSports",
    season: input.cache.season,
    seasonType: input.cache.seasonType,
    week: input.cache.week,
    division: input.cache.division,
    games: input.cache.games,
    cacheHit: input.status !== "refreshed",
    stale: input.stale && !terminal,
    delayed: input.delayed,
    cachedAt: input.cache.cachedAt,
    expiresAt,
    contentHash: input.cache.contentHash,
    cacheStatus: input.status,
    fetchedAt: input.cache.lastSuccessfulFetchAt,
    nextRefreshAt: input.cache.nextRefreshAt,
    lastErrorCode: input.cache.lastErrorCode,
  };
}

function unavailableWithoutCache(message: string): never {
  throw new HttpsError("unavailable", message);
}

function safeFailureCode(error: unknown): string {
  if (error instanceof CbsCollegeFootballRequestError) return error.safeCode;
  if (error instanceof Error && error.message === "CBS_PARSE_ZERO_GAMES") {
    return "CBS_PARSE_ZERO_GAMES";
  }
  if (error instanceof Error && error.message === "CBS_PARSE_REJECTED_GAME") {
    return "CBS_PARSE_REJECTED_GAME";
  }
  if (error instanceof Error && error.message === "CBS_PARSE_IDENTITY_MISMATCH") {
    return "CBS_PARSE_IDENTITY_MISMATCH";
  }
  if (error instanceof Error && error.message === "CBS_PARSE_SUSPICIOUS_SHRINK") {
    return "CBS_PARSE_SUSPICIOUS_SHRINK";
  }
  if (error instanceof Error && error.message === "CBS_PARSE_REVALIDATION_REQUIRED") {
    return "CBS_PARSE_REVALIDATION_REQUIRED";
  }
  if (error instanceof Error && error.message === "CBS_CACHE_WRITE_REJECTED") {
    return "CBS_CACHE_WRITE_REJECTED";
  }
  return "CBS_REFRESH_FAILED";
}

function cacheMatchesInput(
  cache: CbsCacheRecord | null,
  input: CbsCollegeFootballScheduleInput,
): cache is CbsCacheRecord {
  return (
    cache !== null &&
    cache.season === input.season &&
    cache.seasonType === input.seasonType &&
    cache.week === input.week
  );
}

function isCbsCacheFresh(
  cache: CbsCacheRecord,
  now: Date,
  parserVersion: string,
): boolean {
  if (cache.parserVersion !== parserVersion) return false;
  if (isCbsTerminalSchedule(cache.games)) return true;
  const unresolvedFailure =
    cache.lastErrorAt !== null &&
    (cache.lastSuccessfulFetchAt === null ||
      cache.lastErrorAt >= cache.lastSuccessfulFetchAt);
  return (
    !unresolvedFailure &&
    cache.nextRefreshAt !== null &&
    cache.nextRefreshAt > now
  );
}

function assertSafeCacheGames(games: NormalizedGame[]): void {
  if (games.length > CBS_MAXIMUM_CACHED_GAMES) {
    throw new Error("CBS_CACHE_WRITE_REJECTED");
  }
  const byteCount = Buffer.byteLength(
    JSON.stringify(games.map((game) => cachedGameForStorage(game))),
    "utf8",
  );
  if (byteCount > CBS_MAXIMUM_CACHE_GAME_BYTES) {
    throw new Error("CBS_CACHE_WRITE_REJECTED");
  }
}

/** Reads the Admin-only provider document and applies all fail-closed bounds. */
export async function readCbsCollegeFootballConfiguration(
  dependencies: Pick<
    CbsCollegeFootballDependencies,
    "store" | "configuration"
  > = {},
): Promise<CbsCollegeFootballConfig> {
  if (dependencies.configuration !== undefined) {
    return dependencies.configuration;
  }
  const store = dependencies.store ?? new FirestoreCbsCollegeFootballStore();
  return parseCbsCollegeFootballConfig(await store.readConfiguration());
}

export function activeCbsCollegeFootballScheduleInput(
  config: CbsCollegeFootballConfig,
): CbsCollegeFootballScheduleInput | null {
  if (
    !config.enabled ||
    !config.autoRefreshEnabled ||
    config.activeSeason === null ||
    config.activeSeasonType === null ||
    config.activeWeek === null
  ) {
    return null;
  }
  return {
    season: config.activeSeason,
    seasonType: config.activeSeasonType,
    week: config.activeWeek,
    division: "FBS",
  };
}

/**
 * Loads one exact FBS week. The service owns the only CBS HTTP path and always
 * returns the last known good normalized cache when a safe refresh is delayed.
 */
export async function loadCbsCollegeFootballSchedule(
  scheduleInput: CbsCollegeFootballScheduleInput,
  options: CbsCollegeFootballLoadOptions = {},
  dependencies: CbsCollegeFootballDependencies = {},
): Promise<CbsCollegeFootballScheduleResult> {
  const input = validateCbsCollegeFootballScheduleInput(scheduleInput);
  const clock = dependencies.clock ?? (() => new Date());
  const now = clock();
  const store = dependencies.store ?? new FirestoreCbsCollegeFootballStore();
  const log = dependencies.logger ?? logger;
  const config = dependencies.configuration ??
    parseCbsCollegeFootballConfig(await store.readConfiguration());
  const cacheId = cbsCollegeFootballCacheDocumentId(input);
  let cache = await store.readCache(cacheId);
  if (!cacheMatchesInput(cache, input)) cache = null;
  const forceRefresh = options.forceRefresh === true;
  const refreshReason = options.refreshReason ?? "load";

  if (!config.enabled) {
    log.warn("CBS college-football provider disabled", {
      provider: "cbsSports",
      endpointCategory: "scoreboard",
      cacheId,
      cacheHit: cache !== null,
      safeErrorCode: "CBS_PROVIDER_DISABLED",
    });
    if (cache !== null) {
      return resultFromCache({
        cache,
        now,
        status: "stale",
        stale: true,
        delayed: true,
      });
    }
    return unavailableWithoutCache(
      "College-football schedules are temporarily unavailable.",
    );
  }

  if (!matchesActiveIdentity(input, config)) {
    log.warn("CBS college-football request did not match active identity", {
      provider: "cbsSports",
      endpointCategory: "scoreboard",
      cacheId,
      cacheHit: cache !== null,
      safeErrorCode: "CBS_INACTIVE_IDENTITY",
    });
    if (cache !== null) {
      return resultFromCache({
        cache,
        now,
        status: "stale",
        stale: true,
        delayed: true,
      });
    }
    return unavailableWithoutCache(
      "College-football schedules are temporarily unavailable.",
    );
  }

  const parserVersionMismatch =
    cache !== null && cache.parserVersion !== config.parserVersion;
  const fresh =
    cache !== null && isCbsCacheFresh(cache, now, config.parserVersion);
  if (cache !== null && fresh && !forceRefresh) {
    log.info("CBS college-football cache hit", {
      provider: "cbsSports",
      endpointCategory: "scoreboard",
      cacheId,
      cacheHit: true,
      stale: false,
      gameCount: cache.games.length,
    });
    return resultFromCache({
      cache,
      now,
      status: "fresh",
      stale: false,
      delayed: false,
    });
  }

  const owner = dependencies.leaseOwner?.() ?? randomUUID();
  const emulator = dependencies.emulator ?? isEmulator;
  const lease = await store.acquireRefreshLease({
    cacheId,
    owner,
    now,
    leaseUntil: new Date(now.valueOf() + CBS_REFRESH_LEASE_MS),
    minimumRefreshMinutes: config.minimumRefreshMinutes,
    forceRefresh: forceRefresh || parserVersionMismatch,
    bypassCooldown: emulator && forceRefresh,
  });
  cache = cacheMatchesInput(lease.cache, input) ? lease.cache : cache;
  if (!lease.acquired) {
    const status = lease.reason === "lease" ? "refreshing" :
      cache !== null && isCbsCacheFresh(cache, now, config.parserVersion)
        ? "fresh"
        : "stale";
    log.info("CBS college-football refresh delayed", {
      provider: "cbsSports",
      endpointCategory: "scoreboard",
      cacheId,
      cacheHit: cache !== null,
      refreshReason,
      delayReason: lease.reason,
      retryAt: lease.retryAt?.toISOString() ?? null,
    });
    if (cache !== null) {
      return resultFromCache({
        cache,
        now,
        status,
        stale: status !== "fresh",
        delayed: status !== "fresh",
      });
    }
    return unavailableWithoutCache(
      lease.reason === "lease"
        ? "College-football schedules are already refreshing."
        : "College-football schedules are temporarily unavailable.",
    );
  }

  const sourceUrl = validateCbsCollegeFootballRequestUrl(
    buildCbsCollegeFootballScoreboardUrl(input),
  );
  const startedAt = Date.now();
  try {
    const revalidationCache =
      cache !== null && cache.parserVersion === config.parserVersion
        ? cache
        : null;
    const http = await fetchCbsCollegeFootballScoreboard({
      url: sourceUrl,
      etag: revalidationCache?.etag ?? null,
      lastModified: revalidationCache?.lastModified ?? null,
      authorizeRequest: async () => {
        const attemptAt = clock();
        const reservation = await store.reserveRequestAttempt({
          now: attemptAt,
          limit: config.globalDailyRequestLimit,
          reservationId: randomUUID(),
          cacheId,
        });
        if (!reservation.allowed) {
          const safeCode = reservation.reason === "circuit"
            ? "CBS_PROVIDER_CIRCUIT_OPEN" as const
            : "CBS_DAILY_REQUEST_LIMIT_REACHED" as const;
          log.warn("CBS request suppressed before network access", {
            provider: "cbsSports",
            endpointCategory: "scoreboard",
            cacheId,
            safeErrorCode: safeCode,
            suppressionReason: reservation.reason,
            retryAt: reservation.retryAt?.toISOString() ?? null,
          });
          throw new CbsCollegeFootballRequestError(
            safeCode,
            reservation.reason === "circuit"
              ? "CBS scoreboard requests are temporarily suspended."
              : "CBS scoreboard request budget is exhausted.",
            null,
            reservation.retryAt,
          );
        }
      },
      ...(dependencies.fetchImpl === undefined
        ? {}
        : {fetchImpl: dependencies.fetchImpl}),
      clock,
      ...(dependencies.sleep === undefined
        ? {}
        : {sleep: dependencies.sleep}),
      ...(dependencies.random === undefined
        ? {}
        : {random: dependencies.random}),
      ...(dependencies.timeoutMs === undefined
        ? {}
        : {timeoutMs: dependencies.timeoutMs}),
      ...(dependencies.maximumResponseBytes === undefined
        ? {}
        : {maximumResponseBytes: dependencies.maximumResponseBytes}),
    });

    let games: NormalizedGame[];
    let contentHash: string;
    let gamesForWrite: NormalizedGame[] | null;
    if (http.kind === "notModified") {
      if (cache === null || cache.parserVersion !== config.parserVersion) {
        throw new Error("CBS_PARSE_REVALIDATION_REQUIRED");
      }
      games = cache.games;
      contentHash = cache.contentHash;
      gamesForWrite = null;
    } else {
      const parsed = parseCbsCollegeFootballScoreboardHtml(
        http.html ?? "",
        {...input, observedAt: clock()},
      );
      if (!parsed.identityConfirmed) {
        throw new Error("CBS_PARSE_IDENTITY_MISMATCH");
      }
      if (parsed.rejectedGameCount > 0) {
        throw new Error("CBS_PARSE_REJECTED_GAME");
      }
      if (
        parsed.parserFailure ||
        (parsed.games.length === 0 && !parsed.explicitNoGames)
      ) {
        throw new Error(parsed.failureCode ?? "CBS_PARSE_ZERO_GAMES");
      }
      if (
        cache !== null &&
        parsed.games.length > 0 &&
        parsed.games.length < cache.games.length
      ) {
        throw new Error("CBS_PARSE_SUSPICIOUS_SHRINK");
      }
      games = parsed.games;
      assertSafeCacheGames(games);
      contentHash = cbsCollegeFootballGamesContentHash(games);
      gamesForWrite = contentHash === cache?.contentHash ? null : games;
      if (gamesForWrite === null && cache !== null) games = cache.games;
      if (parsed.duplicateCount > 0) {
        log.warn("CBS parser removed duplicate games", {
          provider: "cbsSports",
          endpointCategory: "scoreboard",
          cacheId,
          duplicateCount: parsed.duplicateCount,
        });
      }
    }
    const completedAt = clock();
    const nextRefreshAt = cbsCollegeFootballNextRefreshAt({
      games,
      schedule: input,
      config,
      now: completedAt,
    });
    const hardExpiresAt = nextRefreshAt ??
      new Date(completedAt.valueOf() + CBS_TERMINAL_CACHE_MS);
    const updated = await store.recordRefreshSuccess({
      cacheId,
      leaseOwner: owner,
      identity: input,
      sourceUrl: sourceUrl.toString(),
      now: completedAt,
      nextRefreshAt,
      hardExpiresAt,
      etag: http.etag ?? cache?.etag ?? null,
      lastModified: http.lastModified ?? cache?.lastModified ?? null,
      contentHash,
      games: gamesForWrite,
      httpStatus: http.status,
      parserVersion: config.parserVersion,
    });
    log.info("CBS college-football refresh completed", {
      provider: "cbsSports",
      endpointCategory: "scoreboard",
      cacheId,
      cacheHit: http.kind === "notModified" || gamesForWrite === null,
      stale: false,
      refreshReason,
      httpStatus: http.status,
      actualRequestCount: http.requestCount,
      gameCount: updated.games.length,
      contentChanged: gamesForWrite !== null,
      durationMs: Date.now() - startedAt,
    });
    return resultFromCache({
      cache: updated,
      now: completedAt,
      status: http.kind === "notModified" ? "notModified" : "refreshed",
      stale: false,
      delayed: false,
    });
  } catch (error: unknown) {
    const failureAt = clock();
    const safeCode = safeFailureCode(error);
    const requestError = error instanceof CbsCollegeFootballRequestError
      ? error
      : null;
    const requestWasSuppressed =
      safeCode === "CBS_DAILY_REQUEST_LIMIT_REACHED" ||
      safeCode === "CBS_PROVIDER_CIRCUIT_OPEN";
    const failureNextRefresh =
      requestWasSuppressed &&
      requestError?.circuitOpenUntil !== null &&
      requestError?.circuitOpenUntil !== undefined
        ? requestError.circuitOpenUntil
        : new Date(
            failureAt.valueOf() + config.maximumRefreshMinutes * 60_000,
          );
    try {
      const recorded = await store.recordRefreshFailure({
        cacheId,
        leaseOwner: owner,
        now: failureAt,
        errorCode: safeCode,
        httpStatus: requestError?.httpStatus ?? null,
        nextRefreshAt: failureNextRefresh,
        circuitOpenUntil: requestError?.circuitOpenUntil ?? null,
        countsTowardCircuit: !requestWasSuppressed,
      });
      if (cacheMatchesInput(recorded, input)) cache = recorded;
    } catch (recordError: unknown) {
      log.error("CBS refresh failure metadata write failed", {
        provider: "cbsSports",
        endpointCategory: "scoreboard",
        cacheId,
        safeErrorCode:
          recordError instanceof Error ? recordError.name : "UnknownError",
      });
    }
    log.warn("CBS college-football refresh failed", {
      provider: "cbsSports",
      endpointCategory: "scoreboard",
      cacheId,
      cacheHit: cache !== null,
      stale: cache !== null,
      refreshReason,
      safeErrorCode: safeCode,
      httpStatus: requestError?.httpStatus ?? null,
      durationMs: Date.now() - startedAt,
    });
    if (cache !== null) {
      return resultFromCache({
        cache,
        now: failureAt,
        status: "stale",
        stale: true,
        delayed: true,
      });
    }
    return unavailableWithoutCache(
      "We could not refresh the college-football schedule right now.",
    );
  } finally {
    try {
      await store.releaseRefreshLease(cacheId, owner);
    } catch (error: unknown) {
      log.error("CBS refresh lease release failed", {
        provider: "cbsSports",
        endpointCategory: "scoreboard",
        cacheId,
        safeErrorCode: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}

/**
 * Scheduler entry point: it evaluates exactly one configured week and never
 * iterates seasons or week numbers. A fresh cache still produces zero HTTP
 * requests because the ordinary coordinator policy remains authoritative.
 */
export async function refreshActiveCbsCollegeFootballSchedule(
  dependencies: CbsCollegeFootballDependencies = {},
): Promise<CbsCollegeFootballScheduleResult | null> {
  const store = dependencies.store ?? new FirestoreCbsCollegeFootballStore();
  const config = await readCbsCollegeFootballConfiguration({
    store,
    ...(dependencies.configuration === undefined
      ? {}
      : {configuration: dependencies.configuration}),
  });
  const schedule = activeCbsCollegeFootballScheduleInput(config);
  if (schedule === null) return null;
  return loadCbsCollegeFootballSchedule(
    schedule,
    {refreshReason: "scheduled"},
    {...dependencies, store, configuration: config},
  );
}

function gameForResponse(game: NormalizedGame): Record<string, unknown> {
  return cachedGameForStorage(game);
}

export function serializeCbsCollegeFootballScheduleResponse(
  result: CbsCollegeFootballScheduleResult,
): Record<string, unknown> {
  return {
    success: true,
    source: result.source,
    season: result.season,
    seasonType: result.seasonType,
    week: result.week,
    division: result.division,
    games: result.games.map((game) => gameForResponse(game)),
    cache: {
      status: result.cacheStatus,
      fetchedAt: result.fetchedAt?.toISOString() ?? null,
      nextRefreshAt: result.nextRefreshAt?.toISOString() ?? null,
      isStale: result.stale,
      delayed: result.delayed,
    },
  };
}

export const cbsCollegeFootballScheduleResponse =
  serializeCbsCollegeFootballScheduleResponse;
