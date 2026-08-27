import {HttpsError} from "firebase-functions/v2/https";
import type {
  CatalogPresentation,
  GameStatus,
  NormalizedGame,
  ProviderCachedGamesResult,
  ProviderHealth,
  ProviderLeague,
  ProviderQuery,
  SportsDataProvider,
  Team,
} from "../types.js";
import {
  CBS_SELECTED_GAME_MAXIMUM_IDS,
  cbsCollegeFootballGamesContentHash,
  loadCbsCollegeFootballSchedule,
  parseCbsCollegeFootballConfig,
  type CbsCollegeFootballConfig,
  type CbsCollegeFootballDependencies,
  type CbsCollegeFootballLoadOptions,
  type CbsCollegeFootballScheduleInput,
  type CbsCollegeFootballScheduleResult,
} from "../services/cbsCollegeFootballSchedule.js";
import {CBS_COLLEGE_FOOTBALL_LOGO_HOSTS} from "./cbsCollegeFootball.js";

export type CbsCollegeFootballScheduleLoader = (
  input: CbsCollegeFootballScheduleInput,
  options?: CbsCollegeFootballLoadOptions,
  dependencies?: CbsCollegeFootballDependencies,
) => Promise<CbsCollegeFootballScheduleResult>;

export type CbsCollegeFootballProviderOptions = {
  dependencies?: CbsCollegeFootballDependencies;
  loadSchedule?: CbsCollegeFootballScheduleLoader;
  now?: () => Date;
};

function validIsoDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function calendarDay(date: Date, timezone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
  } catch {
    throw new HttpsError(
      "invalid-argument",
      "College-football catalog timezone is invalid.",
    );
  }
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function assertDateRange(query: ProviderQuery): void {
  if (!validIsoDay(query.from) || !validIsoDay(query.to)) {
    throw new HttpsError(
      "invalid-argument",
      "College-football catalog dates must use valid YYYY-MM-DD values.",
    );
  }
  if (query.to < query.from) {
    throw new HttpsError(
      "invalid-argument",
      "College-football catalog end date must not precede its start date.",
    );
  }
  // Force timezone validation even when every game is date-TBD.
  calendarDay(new Date(0), query.timezone);
}

function scheduleInputFromQuery(
  query: ProviderQuery,
): CbsCollegeFootballScheduleInput {
  if (
    query.sportCode !== "NCAAF" ||
    query.leagueCode !== "ncaaf" ||
    query.providerLeagueId !== "FBS"
  ) {
    throw new HttpsError(
      "failed-precondition",
      "CBS Sports supports only the NCAAF / ncaaf / FBS catalog.",
    );
  }
  if (!/^\d{4}$/.test(query.season)) {
    throw new HttpsError(
      "invalid-argument",
      "CBS college-football season must be a four-digit year.",
    );
  }
  const season = Number(query.season);
  if (
    !Number.isSafeInteger(season) ||
    season < 2000 ||
    season > 2100 ||
    (query.seasonType !== "regular" &&
      query.seasonType !== "postseason") ||
    !Number.isSafeInteger(query.week) ||
    query.week === undefined ||
    query.week < 0 ||
    query.week > 25
  ) {
    throw new HttpsError(
      "invalid-argument",
      "CBS college-football season, season type, or week is invalid.",
    );
  }
  return {
    season,
    seasonType: query.seasonType,
    week: query.week,
    division: "FBS",
  };
}

function filterGamesForQuery(
  games: NormalizedGame[],
  query: ProviderQuery,
): NormalizedGame[] {
  assertDateRange(query);
  return games.filter((game) => {
    const day =
      game.scheduledAtUtc === null
        ? game.scheduledDayEastern ?? null
        : calendarDay(game.scheduledAtUtc, query.timezone);
    // A valid time/date-TBD matchup remains selectable for review. Omitting it
    // here would make the normalized week cache impossible to discover.
    return day === null || (day >= query.from && day <= query.to);
  });
}

function withFilteredGames(
  result: CbsCollegeFootballScheduleResult,
  games: NormalizedGame[],
): ProviderCachedGamesResult {
  return {
    games,
    cacheHit: result.cacheHit,
    stale: result.stale,
    delayed: result.delayed,
    cachedAt: result.cachedAt,
    expiresAt: result.expiresAt,
    contentHash: cbsCollegeFootballGamesContentHash(games),
  };
}

function safeProviderIds(values: string[]): Set<string> {
  if (values.length > CBS_SELECTED_GAME_MAXIMUM_IDS) {
    throw new HttpsError(
      "invalid-argument",
      `CBS selected-game refreshes allow at most ${CBS_SELECTED_GAME_MAXIMUM_IDS} IDs.`,
    );
  }
  const ids = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) {
      throw new HttpsError(
        "invalid-argument",
        "CBS selected-game ID is invalid.",
      );
    }
    ids.add(normalized);
  }
  return ids;
}

function fullQuery(context?: Partial<ProviderQuery>): ProviderQuery {
  if (
    context?.sportCode === undefined ||
    context.leagueCode === undefined ||
    context.providerLeagueId === undefined ||
    context.season === undefined ||
    context.from === undefined ||
    context.to === undefined ||
    context.timezone === undefined
  ) {
    throw new HttpsError(
      "failed-precondition",
      "A complete CBS college-football week context is required.",
    );
  }
  return {
    sportCode: context.sportCode,
    leagueCode: context.leagueCode,
    providerLeagueId: context.providerLeagueId,
    season: context.season,
    from: context.from,
    to: context.to,
    timezone: context.timezone,
    ...(context.seasonType === undefined
      ? {}
      : {seasonType: context.seasonType}),
    ...(context.week === undefined ? {} : {week: context.week}),
    ...(context.division === undefined
      ? {}
      : {division: context.division}),
    ...(context.forceRefresh === undefined
      ? {}
      : {forceRefresh: context.forceRefresh}),
  };
}

export class CbsCollegeFootballProvider implements SportsDataProvider {
  readonly name = "cbsSports";
  readonly cacheNamespace = "cbsSports:ncaaf:week-v1";
  readonly selectedGameRefreshMode = "partial" as const;
  readonly selectedGameRefreshMaximumIds = CBS_SELECTED_GAME_MAXIMUM_IDS;
  readonly presentation: CatalogPresentation = {
    provider: "cbsSports",
    attributionText: "Schedule data from CBS Sports",
    allowRemoteLogos: true,
    allowedLogoHosts: [...CBS_COLLEGE_FOOTBALL_LOGO_HOSTS],
    allowedLogoQueryParameters: [],
    logoRightsReviewDate: "2026-08-25",
  };

  private readonly loadSchedule: CbsCollegeFootballScheduleLoader;
  private readonly dependencies: CbsCollegeFootballDependencies;
  private readonly now: () => Date;

  constructor(
    private readonly config: CbsCollegeFootballConfig =
      parseCbsCollegeFootballConfig({}),
    options: CbsCollegeFootballProviderOptions = {},
  ) {
    this.loadSchedule = options.loadSchedule ??
      loadCbsCollegeFootballSchedule;
    this.dependencies = {
      ...(options.dependencies ?? {}),
      configuration: config,
    };
    this.now = options.now ?? (() => new Date());
  }

  async listSupportedSports(): Promise<string[]> {
    return this.config.activeSeason !== null &&
      this.config.activeSeasonType !== null &&
      this.config.activeWeek !== null
      ? ["NCAAF"]
      : [];
  }

  async listLeagues(sportCode?: string): Promise<ProviderLeague[]> {
    if (
      (sportCode !== undefined && sportCode !== "NCAAF") ||
      this.config.activeSeason === null ||
      this.config.activeSeasonType === null ||
      this.config.activeWeek === null
    ) {
      return [];
    }
    return [{
      code: "ncaaf",
      name: "NCAA FBS College Football",
      sportCode: "NCAAF",
      providerLeagueId: "FBS",
      season: String(this.config.activeSeason),
      seasonType: this.config.activeSeasonType,
      week: this.config.activeWeek,
      division: "FBS",
    }];
  }

  async listGames(query: ProviderQuery): Promise<NormalizedGame[]> {
    return (await this.listGamesCached(query)).games;
  }

  async listGamesCached(
    query: ProviderQuery,
  ): Promise<ProviderCachedGamesResult> {
    const schedule = scheduleInputFromQuery(query);
    const result = await this.loadSchedule(
      schedule,
      {forceRefresh: query.forceRefresh === true, refreshReason: "load"},
      this.dependencies,
    );
    return withFilteredGames(result, filterGamesForQuery(result.games, query));
  }

  async fetchGames(
    providerGameIds: string[],
    context?: Partial<ProviderQuery>,
  ): Promise<NormalizedGame[]> {
    if (providerGameIds.length === 0) return [];
    return (await this.fetchGamesCached(
      providerGameIds,
      fullQuery(context),
    )).games;
  }

  async fetchGamesCached(
    providerGameIds: string[],
    context: ProviderQuery,
  ): Promise<ProviderCachedGamesResult> {
    const requested = safeProviderIds(providerGameIds);
    assertDateRange(context);
    const schedule = scheduleInputFromQuery(context);
    const result = await this.loadSchedule(
      schedule,
      {forceRefresh: context.forceRefresh === true, refreshReason: "load"},
      this.dependencies,
    );
    const games = result.games.filter((game) =>
      requested.has(game.providerGameId),
    );
    return withFilteredGames(result, games);
  }

  async getTeamMetadata(teamId: string): Promise<Team | null> {
    if (!teamId.startsWith("cbsSports:ncaaf:")) return null;
    return null;
  }

  async getHealth(): Promise<ProviderHealth> {
    const activeConfigured =
      this.config.activeSeason !== null &&
      this.config.activeSeasonType !== null &&
      this.config.activeWeek !== null;
    return {
      provider: this.name,
      state: this.config.enabled && activeConfigured
        ? "healthy"
        : "unavailable",
      quotaRemaining: null,
      checkedAt: this.now(),
      detail: this.config.enabled && activeConfigured
        ? "CBS public FBS scoreboard is enabled behind the shared private cache."
        : "CBS college football is disabled or has no active configured week.",
    };
  }

  mapStatus(providerStatus: string): GameStatus {
    const normalized = providerStatus
      .trim()
      .toLowerCase()
      .replaceAll(/[ _-]/g, "");
    if (["scheduled", "pregame", "upcoming"].includes(normalized)) {
      return "scheduled";
    }
    if (["live", "inprogress", "halftime"].includes(normalized)) {
      return "live";
    }
    if (["final", "complete", "completed"].includes(normalized)) {
      return "final";
    }
    if (normalized === "delayed") return "delayed";
    if (normalized === "postponed" || normalized === "ppd") {
      return "postponed";
    }
    if (normalized === "suspended") return "suspended";
    if (normalized === "cancelled" || normalized === "canceled") {
      return "cancelled";
    }
    if (normalized === "void") return "void";
    return "reviewRequired";
  }
}
