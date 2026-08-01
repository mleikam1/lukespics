import {normalizedGameSchema} from "../schemas.js";
import type {
  GameStatus,
  NormalizedGame,
  ProviderQuery,
  Team,
} from "../types.js";
import {finalWinner, normalizeTeam, withSourceHash} from "./normalization.js";
import {
  assertSportsDataIoNflSeason,
  enumerateIsoDates,
  settledOrThrow,
  SportsDataIoClient,
} from "./sportsDataIoClient.js";

export const SPORTSDATAIO_TEAM_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
export const SPORTSDATAIO_NFL_SCHEDULE_CACHE_TTL_MS = 30 * 60 * 1000;
const SPORTSDATAIO_RAW_RESPONSE_VERSION = 1;

type JsonObject = Record<string, unknown>;

type CacheCell<T> = {
  value: T | null;
  expiresAt: number;
  inFlight: Promise<T> | null;
};

export type SportsDataIoNflScheduleBridge = {
  scoreId: string | null;
  leagueGameId: string | null;
  globalGameId: string | null;
  gameKey: string | null;
  homeTeamId: string | null;
  awayTeamId: string | null;
  status: string | null;
  canceled: boolean | null;
  isClosed: boolean | null;
  day: string | null;
  dateTimeUtc: string | null;
  season: string | null;
  seasonType: unknown;
  week: string | null;
  rescheduledFromGameId: string | null;
  rescheduledGameId: string | null;
  venueName: string | null;
  lastUpdated: string | null;
};

export type SportsDataIoNflScheduleIndex = {
  records: SportsDataIoNflScheduleBridge[];
  byScoreId: Map<string, SportsDataIoNflScheduleBridge>;
};

export type SportsDataIoNflCaches = {
  teams: Map<string, CacheCell<Team[]>>;
  schedules: Map<string, CacheCell<SportsDataIoNflScheduleIndex>>;
};

export type SportsDataIoNflAdapterOptions = {
  client: SportsDataIoClient;
  season: string;
  cacheNamespace: string;
  caches?: SportsDataIoNflCaches;
  now?: () => Date;
};

const moduleCaches = createSportsDataIoNflCaches();

export function createSportsDataIoNflCaches(): SportsDataIoNflCaches {
  return {
    teams: new Map(),
    schedules: new Map(),
  };
}

function objectValue(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function boundedText(value: unknown, maximumLength: number): string | null {
  const printable = Array.from(text(value))
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("");
  const normalized = printable
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length === 0 ? null : normalized.slice(0, maximumLength);
}

function identifier(value: unknown): string | null {
  const normalized = text(value);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)
    ? normalized
    : null;
}

function nullableInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  const normalized = text(value);
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function nestedVenueName(raw: JsonObject): string | null {
  const stadiumDetails = objectValue(raw.StadiumDetails);
  const stadium = objectValue(raw.Stadium);
  return (
    boundedText(stadiumDetails.Name, 160) ??
    boundedText(stadiumDetails.FullName, 160) ??
    boundedText(stadium.Name, 160) ??
    boundedText(stadium.FullName, 160)
  );
}

function utcDate(value: unknown): Date | null {
  const normalized = text(value);
  if (normalized.length === 0) return null;
  const explicitUtc = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+$/i.test(
    normalized,
  )
    ? `${normalized}Z`
    : normalized;
  const parsed = new Date(explicitUtc);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error("SportsDataIO NFL game returned an invalid UTC time.");
  }
  return parsed;
}

function providerRevisionDate(value: unknown, fallback: Date): Date {
  try {
    return utcDate(value) ?? fallback;
  } catch {
    return fallback;
  }
}

function easternDay(value: unknown): string | null {
  const normalized = text(value);
  const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(normalized);
  if (match?.[1] === undefined) return null;
  try {
    enumerateIsoDates(match[1], match[1]);
    return match[1];
  } catch {
    return null;
  }
}

function teamId(providerTeamId: string): string {
  return `sportsDataIo:nfl:team:${providerTeamId}`;
}

function requestedBridgeAlias(
  bridge: SportsDataIoNflScheduleBridge,
  requestedProviderGameIds: ReadonlySet<string>,
): string | null {
  for (const alias of [bridge.leagueGameId, bridge.scoreId]) {
    if (alias !== null && requestedProviderGameIds.has(alias)) return alias;
  }
  return null;
}

function requestedGameAliases(
  game: NormalizedGame,
  requestedProviderGameIds: ReadonlySet<string>,
): string[] {
  const aliases = new Set<string>();
  for (const alias of [
    game.providerGameId,
    game.providerLeagueGameId,
    game.providerScoreId,
  ]) {
    if (
      alias !== null &&
      alias !== undefined &&
      requestedProviderGameIds.has(alias)
    ) {
      aliases.add(alias);
    }
  }
  return [...aliases];
}

function preserveRequestedCanonicalId(
  game: NormalizedGame,
  requestedProviderGameId: string,
): NormalizedGame {
  if (game.providerGameId === requestedProviderGameId) return game;
  return normalizedGameSchema.parse({
    ...game,
    id: `sportsDataIo:football:${requestedProviderGameId}`,
    providerGameId: requestedProviderGameId,
  });
}

function safeAbbreviation(value: unknown, fallback: string): string {
  const normalized = text(value).toUpperCase();
  return /^[A-Z0-9 .&'-]{1,12}$/.test(normalized)
    ? normalized
    : fallback;
}

export function normalizeSportsDataIoNflTeam(value: unknown): Team {
  const raw = objectValue(value);
  const providerTeamId = identifier(raw.TeamID);
  if (providerTeamId === null) {
    throw new Error("SportsDataIO NFL team is missing TeamID.");
  }
  const city = boundedText(raw.City, 80);
  const shortName = boundedText(raw.Name, 80);
  const key = boundedText(raw.Key, 12);
  const fullName =
    boundedText(raw.FullName, 120) ??
    boundedText([city, shortName].filter(Boolean).join(" "), 120) ??
    shortName ??
    key;
  if (fullName === null) {
    throw new Error("SportsDataIO NFL team is missing a usable name.");
  }
  const base = normalizeTeam(teamId(providerTeamId), fullName, null);
  return {
    ...base,
    shortName: shortName ?? base.shortName,
    abbreviation: safeAbbreviation(key, base.abbreviation),
    logoUrl: null,
    color: null,
    providerTeamId,
    providerGlobalTeamId: identifier(raw.GlobalTeamID),
  };
}

function fallbackTeam(
  providerTeamId: string,
  abbreviation: unknown,
  teams: ReadonlyMap<string, Team>,
): Team {
  const cached = teams.get(providerTeamId);
  if (cached !== undefined) return cached;
  const rawAbbreviation = boundedText(abbreviation, 12) ?? `Team ${providerTeamId}`;
  const base = normalizeTeam(teamId(providerTeamId), rawAbbreviation, null);
  return {
    ...base,
    abbreviation: safeAbbreviation(abbreviation, base.abbreviation),
    logoUrl: null,
    color: null,
    providerTeamId,
    providerGlobalTeamId: null,
  };
}

function seasonType(value: unknown, configuredSeason: string): string | null {
  const numeric = nullableInteger(value);
  if (numeric !== null) {
    return (
      {
        1: "REG",
        2: "PRE",
        3: "POST",
        5: "STAR",
      } as Record<number, string>
    )[numeric] ?? null;
  }
  const raw = text(value).toUpperCase();
  if (/^(?:REG|PRE|POST|STAR)$/.test(raw)) return raw;
  const suffix = /(?:REG|PRE|POST|STAR)$/.exec(configuredSeason)?.[0];
  return suffix ?? null;
}

export function mapSportsDataIoNflStatus(
  providerStatus: string,
  isClosed = false,
): GameStatus {
  const status = providerStatus.trim().toUpperCase().replace(/[ _-]/g, "");
  if (status === "CANCELED" || status === "CANCELLED") return "cancelled";
  if (status === "POSTPONED") return "postponed";
  if (status === "SUSPENDED") return "suspended";
  if (status === "DELAYED") return "delayed";
  if (status === "INPROGRESS") return "live";
  if (status === "SCHEDULED") return "scheduled";
  if (status === "FINAL" || status === "F/OT") {
    return isClosed ? "final" : "reviewRequired";
  }
  return "reviewRequired";
}

function bridgeFor(value: unknown): SportsDataIoNflScheduleBridge | null {
  const raw = objectValue(value);
  const scoreId = identifier(raw.ScoreID);
  const leagueGameId = identifier(raw.GameID);
  if (scoreId === null && leagueGameId === null) return null;
  return {
    scoreId,
    leagueGameId,
    globalGameId: identifier(raw.GlobalGameID),
    gameKey: identifier(raw.GameKey),
    homeTeamId: identifier(raw.HomeTeamID),
    awayTeamId: identifier(raw.AwayTeamID),
    status: boundedText(raw.Status, 80),
    canceled: nullableBoolean(raw.Canceled),
    isClosed:
      nullableBoolean(raw.IsClosed) ?? nullableBoolean(raw.Closed),
    day: boundedText(raw.Day, 64) ?? boundedText(raw.Date, 64),
    dateTimeUtc: boundedText(raw.DateTimeUTC, 64),
    season: identifier(raw.Season),
    seasonType: raw.SeasonType,
    week: identifier(raw.Week),
    rescheduledFromGameId: identifier(raw.RescheduledFromGameID),
    rescheduledGameId: identifier(raw.RescheduledGameID),
    venueName: nestedVenueName(raw),
    lastUpdated: boundedText(raw.LastUpdated, 64),
  };
}

export function normalizeSportsDataIoNflScore(
  value: unknown,
  options: {
    season: string;
    teams: ReadonlyMap<string, Team>;
    bridge?: SportsDataIoNflScheduleBridge | null;
    observedAt?: Date;
  },
): NormalizedGame {
  const raw = objectValue(value);
  const bridge = options.bridge ?? null;
  const providerScoreId = identifier(raw.ScoreID) ?? bridge?.scoreId ?? null;
  const leagueGameId = identifier(raw.GameID) ?? bridge?.leagueGameId ?? null;
  // ScoreID is the identity exposed by the full score feed and remains usable
  // whether or not the nullable SchedulesBasic GameID has been populated yet.
  // Keep GameID as a cross-reference and use it as the canonical fallback only
  // for real schedule-only rows (for example, a time-TBD game with no ScoreID).
  const providerGameId = providerScoreId ?? leagueGameId;
  if (providerGameId === null) {
    throw new Error("SportsDataIO NFL game is missing stable game identity.");
  }
  const homeProviderTeamId =
    identifier(raw.HomeTeamID) ?? bridge?.homeTeamId ?? null;
  const awayProviderTeamId =
    identifier(raw.AwayTeamID) ?? bridge?.awayTeamId ?? null;
  if (
    homeProviderTeamId === null ||
    awayProviderTeamId === null ||
    homeProviderTeamId === awayProviderTeamId
  ) {
    throw new Error("SportsDataIO NFL game is missing distinct team IDs.");
  }
  const homeTeam = fallbackTeam(
    homeProviderTeamId,
    raw.HomeTeam,
    options.teams,
  );
  const awayTeam = fallbackTeam(
    awayProviderTeamId,
    raw.AwayTeam,
    options.teams,
  );

  const rawDay = raw.Day ?? raw.Date ?? bridge?.day;
  const scheduledDayEastern = easternDay(rawDay);
  const rawDateTimeUtc = raw.DateTimeUTC ?? bridge?.dateTimeUtc;
  const scheduledAtUtc = utcDate(rawDateTimeUtc);
  if (scheduledAtUtc === null && scheduledDayEastern === null) {
    throw new Error("SportsDataIO NFL game is missing both day and UTC time.");
  }
  const timeTbd = scheduledAtUtc === null;

  const isClosed =
    nullableBoolean(raw.IsClosed) ??
    nullableBoolean(raw.Closed) ??
    bridge?.isClosed ??
    null;
  const canceled =
    nullableBoolean(raw.Canceled) ?? bridge?.canceled ?? false;
  const providerStatus =
    boundedText(raw.Status, 80) ?? bridge?.status ?? "";
  let mappedStatus = canceled
    ? "cancelled" as const
    : mapSportsDataIoNflStatus(providerStatus, isClosed === true);
  if (
    providerStatus.length === 0 &&
    raw.IsInProgress === true &&
    !canceled
  ) {
    mappedStatus = "live";
  }

  const normalizedProviderStatus = providerStatus
    .toUpperCase()
    .replace(/[ _-]/g, "");
  const started =
    raw.HasStarted === true ||
    raw.IsInProgress === true ||
    raw.IsOver === true ||
    isClosed === true ||
    mappedStatus === "live" ||
    normalizedProviderStatus === "FINAL" ||
    normalizedProviderStatus === "F/OT";
  const homeScore = started ? nullableInteger(raw.HomeScore) : null;
  const awayScore = started ? nullableInteger(raw.AwayScore) : null;
  if (
    isClosed === true &&
    mappedStatus !== "cancelled" &&
    (homeScore === null || awayScore === null)
  ) {
    mappedStatus = "reviewRequired";
  }
  const outcome = finalWinner(
    mappedStatus,
    homeTeam.id,
    awayTeam.id,
    homeScore,
    awayScore,
  );

  const rawSeason = identifier(raw.Season) ?? bridge?.season;
  const configuredSeasonYear = options.season.slice(0, 4);
  if (
    rawSeason !== null &&
    rawSeason !== undefined &&
    /^\d{4}$/.test(rawSeason) &&
    rawSeason !== configuredSeasonYear
  ) {
    throw new Error("SportsDataIO NFL game belongs to another season.");
  }
  const normalizedSeason = options.season;
  const normalizedSeasonType = seasonType(
    raw.SeasonType ?? bridge?.seasonType,
    options.season,
  );
  const configuredSeasonType = /(?:REG|PRE|POST|STAR)$/.exec(
    options.season,
  )?.[0];
  if (
    configuredSeasonType !== undefined &&
    normalizedSeasonType !== null &&
    normalizedSeasonType !== configuredSeasonType
  ) {
    throw new Error("SportsDataIO NFL game has another season type.");
  }
  const weekOrRound = identifier(raw.Week) ?? bridge?.week ?? null;
  const statusDetail =
    boundedText(raw.QuarterDescription, 120) ??
    boundedText(raw.Status, 120) ??
    bridge?.status ??
    null;
  const observedAt = options.observedAt ?? new Date();
  const providerLastUpdatedAt = providerRevisionDate(
    raw.LastUpdated ?? bridge?.lastUpdated,
    observedAt,
  );
  const globalGameId =
    identifier(raw.GlobalGameID) ?? bridge?.globalGameId ?? null;
  const gameKey = identifier(raw.GameKey) ?? bridge?.gameKey ?? null;
  const rescheduledFromLeagueGameId =
    identifier(raw.RescheduledFromGameID) ??
    bridge?.rescheduledFromGameId ??
    null;
  const rescheduledToLeagueGameId =
    identifier(raw.RescheduledGameID) ?? bridge?.rescheduledGameId ?? null;

  const sourceProjection = {
    scoreId: providerScoreId,
    providerGameId,
    leagueGameId,
    globalGameId,
    gameKey,
    season: normalizedSeason,
    seasonType: normalizedSeasonType,
    week: weekOrRound,
    day: scheduledDayEastern,
    dateTimeUtc: scheduledAtUtc?.toISOString() ?? null,
    status: outcome.status,
    statusDetail,
    isClosed,
    canceled,
    homeTeamId: homeProviderTeamId,
    awayTeamId: awayProviderTeamId,
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    rescheduledFromLeagueGameId,
    rescheduledToLeagueGameId,
  };

  return normalizedGameSchema.parse(
    withSourceHash(
      {
        id: `sportsDataIo:football:${providerGameId}`,
        provider: "sportsDataIo",
        providerGameId,
        providerScoreId,
        providerLeagueGameId: leagueGameId,
        providerGlobalGameId: globalGameId,
        providerGameKey: gameKey,
        providerLeagueId: "nfl",
        sportCode: "football",
        leagueCode: "nfl",
        leagueName: "NFL",
        season: normalizedSeason,
        seasonType: sourceProjection.seasonType,
        weekOrRound,
        scheduledAtUtc,
        publishedScheduledAtUtc: scheduledAtUtc,
        effectiveLockAtUtc: scheduledAtUtc,
        scheduledDayEastern,
        timeTbd,
        venueName: nestedVenueName(raw) ?? bridge?.venueName ?? null,
        neutralSite: raw.NeutralVenue === true,
        homeTeam,
        awayTeam,
        status: outcome.status,
        statusDetail,
        isClosed,
        rescheduledFromLeagueGameId,
        rescheduledToLeagueGameId,
        homeScore,
        awayScore,
        winnerTeamId: outcome.winnerTeamId,
        broadcast: boundedText(raw.Channel, 240),
        eventDetail: null,
        rawResponseVersion: SPORTSDATAIO_RAW_RESPONSE_VERSION,
        providerLastUpdatedAt,
        lastSyncedAt: observedAt,
        manualOverride: false,
        manualOverrideReason: null,
        manualOverrideBy: null,
      },
      sourceProjection,
    ),
  );
}

async function cached<T>(
  cache: Map<string, CacheCell<T>>,
  key: string,
  ttlMs: number,
  forceRefresh: boolean,
  now: () => Date,
  loader: () => Promise<T>,
): Promise<T> {
  const existing = cache.get(key);
  if (existing?.inFlight !== null && existing?.inFlight !== undefined) {
    return existing.inFlight;
  }
  if (
    !forceRefresh &&
    existing?.value !== null &&
    existing?.value !== undefined &&
    existing.expiresAt > now().valueOf()
  ) {
    return existing.value;
  }
  const inFlight = loader();
  cache.set(key, {
    value: existing?.value ?? null,
    expiresAt: existing?.expiresAt ?? 0,
    inFlight,
  });
  try {
    const value = await inFlight;
    cache.set(key, {
      value,
      expiresAt: now().valueOf() + ttlMs,
      inFlight: null,
    });
    return value;
  } catch (error: unknown) {
    if (existing === undefined) cache.delete(key);
    else cache.set(key, {...existing, inFlight: null});
    throw error;
  }
}

export class SportsDataIoNflAdapter {
  private readonly client: SportsDataIoClient;
  private readonly season: string;
  private readonly cacheNamespace: string;
  private readonly caches: SportsDataIoNflCaches;
  private readonly now: () => Date;

  constructor(options: SportsDataIoNflAdapterOptions) {
    this.client = options.client;
    this.season = assertSportsDataIoNflSeason(options.season);
    this.cacheNamespace = options.cacheNamespace;
    this.caches = options.caches ?? moduleCaches;
    this.now = options.now ?? (() => new Date());
  }

  async listTeams(forceRefresh = false): Promise<Team[]> {
    return cached(
      this.caches.teams,
      `${this.cacheNamespace}:nfl:teams`,
      SPORTSDATAIO_TEAM_CACHE_TTL_MS,
      forceRefresh,
      this.now,
      async () => {
        const payload = await this.client.getJson({
          league: "nfl",
          resource: "Teams",
        });
        if (!Array.isArray(payload)) {
          throw new Error("SportsDataIO NFL Teams response was not an array.");
        }
        const teams: Team[] = [];
        for (const value of payload) {
          try {
            teams.push(normalizeSportsDataIoNflTeam(value));
          } catch {
            // Additive or retired team records cannot weaken minimum identity.
          }
        }
        if (payload.length > 0 && teams.length === 0) {
          throw new Error(
            "SportsDataIO NFL Teams contained records but none could be normalized.",
          );
        }
        return teams;
      },
    );
  }

  async listScheduleBridges(
    forceRefresh = false,
  ): Promise<SportsDataIoNflScheduleIndex> {
    return cached(
      this.caches.schedules,
      `${this.cacheNamespace}:nfl:schedule:${this.season}`,
      SPORTSDATAIO_NFL_SCHEDULE_CACHE_TTL_MS,
      forceRefresh,
      this.now,
      async () => {
        const payload = await this.client.getJson({
          league: "nfl",
          resource: "SchedulesBasic",
          season: this.season,
        });
        if (!Array.isArray(payload)) {
          throw new Error(
            "SportsDataIO NFL SchedulesBasic response was not an array.",
          );
        }
        const records: SportsDataIoNflScheduleBridge[] = [];
        const byScoreId = new Map<
          string,
          SportsDataIoNflScheduleBridge
        >();
        let realMalformedRecords = 0;
        for (const value of payload) {
          const raw = objectValue(value);
          const bridge = bridgeFor(raw);
          if (bridge !== null) {
            records.push(bridge);
            if (bridge.scoreId !== null) {
              byScoreId.set(bridge.scoreId, bridge);
            }
            continue;
          }
          const looksLikeRealGame =
            identifier(raw.GameID) !== null ||
            identifier(raw.GlobalGameID) !== null ||
            (identifier(raw.HomeTeamID) !== null &&
              identifier(raw.AwayTeamID) !== null);
          if (looksLikeRealGame) realMalformedRecords += 1;
        }
        if (
          payload.length > 0 &&
          records.length === 0 &&
          realMalformedRecords > 0
        ) {
          throw new Error(
            "SportsDataIO NFL schedule contained real games but none had usable ScoreID bridges.",
          );
        }
        return {records, byScoreId};
      },
    );
  }

  private async loadGames(
    query: ProviderQuery,
    requestedProviderGameIds?: ReadonlySet<string>,
  ): Promise<NormalizedGame[]> {
    const queriedDates = enumerateIsoDates(query.from, query.to);
    const [teamList, schedule] = await settledOrThrow([
      this.listTeams(query.forceRefresh === true),
      this.listScheduleBridges(query.forceRefresh === true),
    ] as const);
    const teams = new Map(
      teamList.flatMap((team) =>
        team.providerTeamId === null || team.providerTeamId === undefined
          ? []
        : [[team.providerTeamId, team] as const],
      ),
    );
    const dateSet = new Set(queriedDates);
    if (requestedProviderGameIds !== undefined) {
      for (const bridge of schedule.records) {
        if (requestedBridgeAlias(bridge, requestedProviderGameIds) === null) {
          continue;
        }
        const currentDay = easternDay(bridge.day);
        if (currentDay !== null) dateSet.add(currentDay);
      }
    }
    const dates = [...dateSet];
    const buckets = await settledOrThrow(
      dates.map(async (date) => {
        const payload = await this.client.getJson({
          league: "nfl",
          resource: "ScoresByDate",
          date,
        });
        if (!Array.isArray(payload)) {
          throw new Error(
            "SportsDataIO NFL ScoresByDate response was not an array.",
          );
        }
        const games: NormalizedGame[] = [];
        let normalizedRecordCount = 0;
        for (const value of payload) {
          const raw = objectValue(value);
          const scoreId = identifier(raw.ScoreID);
          try {
            const game = normalizeSportsDataIoNflScore(value, {
              season: this.season,
              teams,
              bridge:
                scoreId === null
                  ? null
                  : (schedule.byScoreId.get(scoreId) ?? null),
              observedAt: this.now(),
            });
            normalizedRecordCount += 1;
            if (
              game.scheduledDayEastern === null ||
              game.scheduledDayEastern === date ||
              (requestedProviderGameIds !== undefined &&
                requestedGameAliases(
                  game,
                  requestedProviderGameIds,
                ).length > 0)
            ) {
              games.push(game);
            }
          } catch {
            // Skip only this malformed/bye record; fail below if all are unusable.
          }
        }
        if (payload.length > 0 && normalizedRecordCount === 0) {
          throw new Error(
            "SportsDataIO NFL date bucket contained records but none could be normalized.",
          );
        }
        const presentIds = new Set(games.map((game) => game.providerGameId));
        for (const bridge of schedule.records) {
          const bridgeProviderGameId = bridge.leagueGameId ?? bridge.scoreId;
          const bridgeDay = easternDay(bridge.day);
          if (
            bridgeDay !== date &&
            (bridgeDay !== null ||
              bridgeProviderGameId === null ||
              requestedProviderGameIds === undefined ||
              requestedBridgeAlias(
                bridge,
                requestedProviderGameIds,
              ) === null)
          ) {
            continue;
          }
          try {
            const game = normalizeSportsDataIoNflScore({}, {
              season: this.season,
              teams,
              bridge,
              observedAt: this.now(),
            });
            if (!presentIds.has(game.providerGameId)) {
              games.push(game);
              presentIds.add(game.providerGameId);
            }
          } catch {
            // True byes and incomplete non-game schedule rows remain omitted.
          }
        }
        return games;
      }),
    );
    const unique = new Map<string, NormalizedGame>();
    for (const game of buckets.flat()) unique.set(game.providerGameId, game);
    return [...unique.values()];
  }

  async listGames(query: ProviderQuery): Promise<NormalizedGame[]> {
    return this.loadGames(query);
  }

  async fetchGames(
    providerGameIds: ReadonlySet<string>,
    query: ProviderQuery,
  ): Promise<NormalizedGame[]> {
    const games = await this.loadGames(query, providerGameIds);
    return games.flatMap((game) =>
      requestedGameAliases(game, providerGameIds).map((requestedId) =>
        preserveRequestedCanonicalId(game, requestedId),
      ),
    );
  }

  async getTeamMetadata(teamIdentity: string): Promise<Team | null> {
    const teams = await this.listTeams();
    return (
      teams.find(
        (team) =>
          team.id === teamIdentity || team.providerTeamId === teamIdentity,
      ) ?? null
    );
  }
}
