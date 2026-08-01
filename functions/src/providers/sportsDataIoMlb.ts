import {normalizedGameSchema} from "../schemas.js";
import type {
  GameStatus,
  NormalizedGame,
  ProviderQuery,
  Team,
} from "../types.js";
import {finalWinner, normalizeTeam, withSourceHash} from "./normalization.js";
import {
  assertSportsDataIoMlbSeason,
  enumerateIsoDates,
  settledOrThrow,
  SportsDataIoClient,
} from "./sportsDataIoClient.js";

export const SPORTSDATAIO_MLB_TEAM_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const SPORTSDATAIO_RAW_RESPONSE_VERSION = 1;

type JsonObject = Record<string, unknown>;

type CacheCell<T> = {
  value: T | null;
  expiresAt: number;
  inFlight: Promise<T> | null;
};

export type SportsDataIoMlbCaches = {
  teams: Map<string, CacheCell<Team[]>>;
};

export type SportsDataIoMlbAdapterOptions = {
  client: SportsDataIoClient;
  season: string;
  cacheNamespace: string;
  caches?: SportsDataIoMlbCaches;
  now?: () => Date;
};

const moduleCaches = createSportsDataIoMlbCaches();

export function createSportsDataIoMlbCaches(): SportsDataIoMlbCaches {
  return {teams: new Map()};
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
    throw new Error("SportsDataIO MLB game returned an invalid UTC time.");
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
  return `sportsDataIo:mlb:team:${providerTeamId}`;
}

function safeAbbreviation(value: unknown, fallback: string): string {
  const normalized = text(value).toUpperCase();
  return /^[A-Z0-9 .&'-]{1,12}$/.test(normalized)
    ? normalized
    : fallback;
}

export function normalizeSportsDataIoMlbTeam(value: unknown): Team {
  const raw = objectValue(value);
  const providerTeamId = identifier(raw.TeamID);
  if (providerTeamId === null) {
    throw new Error("SportsDataIO MLB team is missing TeamID.");
  }
  const city = boundedText(raw.City, 80);
  const shortName = boundedText(raw.Name, 80);
  const key = boundedText(raw.Key, 12);
  const fullName =
    boundedText([city, shortName].filter(Boolean).join(" "), 120) ??
    shortName ??
    key;
  if (fullName === null) {
    throw new Error("SportsDataIO MLB team is missing a usable name.");
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

export function mapSportsDataIoMlbStatus(
  providerStatus: string,
  isClosed = false,
): GameStatus {
  const status = providerStatus.trim().toUpperCase().replace(/[ _-]/g, "");
  if (
    status === "CANCELED" ||
    status === "CANCELLED" ||
    status === "NOTNECESSARY"
  ) {
    return "cancelled";
  }
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

export function normalizeSportsDataIoMlbGame(
  value: unknown,
  options: {
    season: string;
    teams: ReadonlyMap<string, Team>;
    observedAt?: Date;
  },
): NormalizedGame {
  const raw = objectValue(value);
  const providerGameId = identifier(raw.GameID);
  if (providerGameId === null) {
    throw new Error("SportsDataIO MLB game is missing GameID.");
  }
  const homeProviderTeamId = identifier(raw.HomeTeamID);
  const awayProviderTeamId = identifier(raw.AwayTeamID);
  if (
    homeProviderTeamId === null ||
    awayProviderTeamId === null ||
    homeProviderTeamId === awayProviderTeamId
  ) {
    throw new Error("SportsDataIO MLB game is missing distinct team IDs.");
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

  const scheduledDayEastern = easternDay(raw.Day);
  const scheduledAtUtc = utcDate(raw.DateTimeUTC);
  if (scheduledAtUtc === null && scheduledDayEastern === null) {
    throw new Error("SportsDataIO MLB game is missing both day and UTC time.");
  }
  const timeTbd = scheduledAtUtc === null;
  const isClosed = nullableBoolean(raw.IsClosed);
  const providerStatus = boundedText(raw.Status, 80) ?? "";
  let mappedStatus = mapSportsDataIoMlbStatus(
    providerStatus,
    isClosed === true,
  );
  const normalizedProviderStatus = providerStatus
    .toUpperCase()
    .replace(/[ _-]/g, "");
  const started =
    isClosed === true ||
    mappedStatus === "live" ||
    mappedStatus === "suspended" ||
    normalizedProviderStatus === "FINAL" ||
    normalizedProviderStatus === "F/OT" ||
    normalizedProviderStatus === "FORFEIT";
  const homeScore = started ? nullableInteger(raw.HomeTeamRuns) : null;
  const awayScore = started ? nullableInteger(raw.AwayTeamRuns) : null;
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

  const rawSeason = identifier(raw.Season);
  const configuredSeasonYear = options.season.slice(0, 4);
  if (
    rawSeason !== null &&
    /^\d{4}$/.test(rawSeason) &&
    rawSeason !== configuredSeasonYear
  ) {
    throw new Error("SportsDataIO MLB game belongs to another season.");
  }
  const normalizedSeason = options.season;
  const statusDetail =
    boundedText(raw.InningDescription, 120) ??
    boundedText(raw.Status, 120);
  const observedAt = options.observedAt ?? new Date();
  const providerLastUpdatedAt = providerRevisionDate(raw.Updated, observedAt);
  const providerGlobalGameId = identifier(raw.GlobalGameID);
  const rescheduledFromLeagueGameId = identifier(raw.RescheduledFromGameID);
  const rescheduledToLeagueGameId = identifier(raw.RescheduledGameID);
  const normalizedSeasonType = seasonType(raw.SeasonType, options.season);
  const configuredSeasonType = /(?:REG|PRE|POST|STAR)$/.exec(
    options.season,
  )?.[0];
  if (
    configuredSeasonType !== undefined &&
    normalizedSeasonType !== null &&
    normalizedSeasonType !== configuredSeasonType
  ) {
    throw new Error("SportsDataIO MLB game has another season type.");
  }

  const sourceProjection = {
    gameId: providerGameId,
    globalGameId: providerGlobalGameId,
    season: normalizedSeason,
    seasonType: normalizedSeasonType,
    day: scheduledDayEastern,
    dateTimeUtc: scheduledAtUtc?.toISOString() ?? null,
    status: outcome.status,
    statusDetail,
    isClosed,
    homeTeamId: homeProviderTeamId,
    awayTeamId: awayProviderTeamId,
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    rescheduledFromLeagueGameId,
    rescheduledToLeagueGameId,
    suspensionResumeDay: boundedText(raw.SuspensionResumeDay, 64),
    suspensionResumeDateTime: boundedText(
      raw.SuspensionResumeDateTime,
      64,
    ),
  };

  return normalizedGameSchema.parse(
    withSourceHash(
      {
        id: `sportsDataIo:baseball:${providerGameId}`,
        provider: "sportsDataIo",
        providerGameId,
        providerScoreId: null,
        providerLeagueGameId: providerGameId,
        providerGlobalGameId,
        providerGameKey: null,
        providerLeagueId: "mlb",
        sportCode: "baseball",
        leagueCode: "mlb",
        leagueName: "MLB",
        season: normalizedSeason,
        seasonType: normalizedSeasonType,
        weekOrRound: null,
        scheduledAtUtc,
        publishedScheduledAtUtc: scheduledAtUtc,
        effectiveLockAtUtc: scheduledAtUtc,
        scheduledDayEastern,
        timeTbd,
        venueName: nestedVenueName(raw),
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

export class SportsDataIoMlbAdapter {
  private readonly client: SportsDataIoClient;
  private readonly season: string;
  private readonly cacheNamespace: string;
  private readonly caches: SportsDataIoMlbCaches;
  private readonly now: () => Date;

  constructor(options: SportsDataIoMlbAdapterOptions) {
    this.client = options.client;
    this.season = assertSportsDataIoMlbSeason(options.season);
    this.cacheNamespace = options.cacheNamespace;
    this.caches = options.caches ?? moduleCaches;
    this.now = options.now ?? (() => new Date());
  }

  async listTeams(forceRefresh = false): Promise<Team[]> {
    return cached(
      this.caches.teams,
      `${this.cacheNamespace}:mlb:teams`,
      SPORTSDATAIO_MLB_TEAM_CACHE_TTL_MS,
      forceRefresh,
      this.now,
      async () => {
        const payload = await this.client.getJson({
          league: "mlb",
          resource: "teams",
        });
        if (!Array.isArray(payload)) {
          throw new Error("SportsDataIO MLB teams response was not an array.");
        }
        const teams: Team[] = [];
        for (const value of payload) {
          try {
            teams.push(normalizeSportsDataIoMlbTeam(value));
          } catch {
            // Additive or retired team records cannot weaken minimum identity.
          }
        }
        if (payload.length > 0 && teams.length === 0) {
          throw new Error(
            "SportsDataIO MLB teams contained records but none could be normalized.",
          );
        }
        return teams;
      },
    );
  }

  private async loadGames(
    query: ProviderQuery,
    requestedProviderGameIds?: ReadonlySet<string>,
  ): Promise<NormalizedGame[]> {
    const dates = enumerateIsoDates(query.from, query.to);
    const teamList = await this.listTeams(query.forceRefresh === true);
    const teams = new Map(
      teamList.flatMap((team) =>
        team.providerTeamId === null || team.providerTeamId === undefined
          ? []
          : [[team.providerTeamId, team] as const],
      ),
    );
    const buckets = await settledOrThrow(
      dates.map(async (date) => {
        const payload = await this.client.getJson({
          league: "mlb",
          resource: "GamesByDate",
          date,
        });
        if (!Array.isArray(payload)) {
          throw new Error(
            "SportsDataIO MLB GamesByDate response was not an array.",
          );
        }
        const games: NormalizedGame[] = [];
        let normalizedRecordCount = 0;
        for (const value of payload) {
          try {
            const game = normalizeSportsDataIoMlbGame(value, {
              season: this.season,
              teams,
              observedAt: this.now(),
            });
            normalizedRecordCount += 1;
            if (
              game.scheduledDayEastern === null ||
              game.scheduledDayEastern === date ||
              requestedProviderGameIds?.has(game.providerGameId) === true
            ) {
              games.push(game);
            }
          } catch {
            // Skip only this malformed record; fail below if all are unusable.
          }
        }
        if (payload.length > 0 && normalizedRecordCount === 0) {
          throw new Error(
            "SportsDataIO MLB date bucket contained records but none could be normalized.",
          );
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
    return games.filter((game) => providerGameIds.has(game.providerGameId));
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
