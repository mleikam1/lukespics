import {logger} from "firebase-functions";
import {HttpsError} from "firebase-functions/v2/https";
import {z} from "zod";
import {positiveIntegerSetting} from "../config.js";
import {normalizedGameSchema} from "../schemas.js";
import type {
  CatalogPresentation,
  GameStatus,
  NormalizedGame,
  ProviderHealth,
  ProviderLeague,
  ProviderQuery,
  ProviderRequestEstimate,
  ProviderRequestOperation,
  SportsDataProvider,
  Team,
} from "../types.js";
import {finalWinner, normalizeTeam, withSourceHash} from "./normalization.js";
import {neutralCatalogPresentation} from "./presentation.js";
import {ProviderRetryAuthorizationError} from "./retry.js";

// ESPN's Site API is public but unofficial: its schema may change without
// notice, and it has no published SLA or rate limit. Keep every URL here,
// behind a literal origin/path allowlist, so this adapter can be replaced and
// can never become a user-controlled proxy.
export const ESPN_SCOREBOARD_ORIGIN = "https://site.api.espn.com";
const ESPN_SCOREBOARD_PREFIX = "/apis/site/v2/sports/";
const ESPN_LOGO_HOST = "a.espncdn.com";
export const ESPN_OWNED_ROOT_HOSTS = ["espn.com", "espncdn.com"] as const;
export const ESPN_MAX_REQUEST_ATTEMPTS = 3;
const ESPN_RAW_RESPONSE_VERSION = 1;
const ESPN_MAX_RESPONSE_BYTES = 10_000_000;

export function isEspnOwnedHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/\.$/, "");
  return ESPN_OWNED_ROOT_HOSTS.some(
    (root) => normalized === root || normalized.endsWith(`.${root}`),
  );
}

const espnLeagueConfigSchema = z.object({
  id: z.string().trim().min(1).max(64),
  displayName: z.string().trim().min(1).max(120),
  sportCode: z.string().trim().min(1).max(64),
  espnSportSlug: z.string().regex(/^[a-z]+(?:-[a-z]+)*$/),
  espnLeagueSlug: z.string().regex(/^[a-z]+(?:-[a-z]+)*$/),
  queryParameters: z
    .object({
      groups: z.string().regex(/^[A-Za-z0-9_-]{1,16}$/).optional(),
      limit: z.string().regex(/^[A-Za-z0-9_-]{1,16}$/).optional(),
      lang: z.string().regex(/^[A-Za-z0-9_-]{1,16}$/).optional(),
      region: z.string().regex(/^[A-Za-z0-9_-]{1,16}$/).optional(),
    })
    .default({}),
  tiesPossible: z.boolean(),
  enabled: z.boolean(),
  defaultScheduleQueryBehavior: z.literal("dateRange"),
  fallbackAsset: z.literal("neutral-initials"),
});

export type EspnLeagueConfig = z.infer<typeof espnLeagueConfigSchema>;

export const ESPN_LEAGUE_CONFIGS: readonly EspnLeagueConfig[] = z
  .array(espnLeagueConfigSchema)
  .length(8)
  .parse([
    {
      id: "nfl",
      displayName: "NFL",
      sportCode: "football",
      espnSportSlug: "football",
      espnLeagueSlug: "nfl",
      queryParameters: {limit: "100"},
      tiesPossible: true,
      enabled: true,
      defaultScheduleQueryBehavior: "dateRange",
      fallbackAsset: "neutral-initials",
    },
    {
      id: "college-football",
      displayName: "NCAA Football",
      sportCode: "football",
      espnSportSlug: "football",
      espnLeagueSlug: "college-football",
      queryParameters: {groups: "80", limit: "500"},
      tiesPossible: false,
      enabled: true,
      defaultScheduleQueryBehavior: "dateRange",
      fallbackAsset: "neutral-initials",
    },
    {
      id: "nba",
      displayName: "NBA",
      sportCode: "basketball",
      espnSportSlug: "basketball",
      espnLeagueSlug: "nba",
      queryParameters: {limit: "100"},
      tiesPossible: false,
      enabled: true,
      defaultScheduleQueryBehavior: "dateRange",
      fallbackAsset: "neutral-initials",
    },
    {
      id: "wnba",
      displayName: "WNBA",
      sportCode: "basketball",
      espnSportSlug: "basketball",
      espnLeagueSlug: "wnba",
      queryParameters: {limit: "100"},
      tiesPossible: false,
      enabled: true,
      defaultScheduleQueryBehavior: "dateRange",
      fallbackAsset: "neutral-initials",
    },
    {
      id: "mens-college-basketball",
      displayName: "NCAA Men's Basketball",
      sportCode: "basketball",
      espnSportSlug: "basketball",
      espnLeagueSlug: "mens-college-basketball",
      queryParameters: {groups: "50", limit: "500"},
      tiesPossible: false,
      enabled: true,
      defaultScheduleQueryBehavior: "dateRange",
      fallbackAsset: "neutral-initials",
    },
    {
      id: "womens-college-basketball",
      displayName: "NCAA Women's Basketball",
      sportCode: "basketball",
      espnSportSlug: "basketball",
      espnLeagueSlug: "womens-college-basketball",
      queryParameters: {groups: "50", limit: "500"},
      tiesPossible: false,
      enabled: true,
      defaultScheduleQueryBehavior: "dateRange",
      fallbackAsset: "neutral-initials",
    },
    {
      id: "mlb",
      displayName: "MLB",
      sportCode: "baseball",
      espnSportSlug: "baseball",
      espnLeagueSlug: "mlb",
      queryParameters: {limit: "100"},
      tiesPossible: false,
      enabled: true,
      defaultScheduleQueryBehavior: "dateRange",
      fallbackAsset: "neutral-initials",
    },
    {
      id: "nhl",
      displayName: "NHL",
      sportCode: "hockey",
      espnSportSlug: "hockey",
      espnLeagueSlug: "nhl",
      queryParameters: {limit: "100"},
      tiesPossible: false,
      enabled: true,
      defaultScheduleQueryBehavior: "dateRange",
      fallbackAsset: "neutral-initials",
    },
  ]);

const espnCatalogSchema = z
  .object({
    enabled: z.boolean().default(false),
    authorizationReference: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .nullable()
      .default(null),
    authorizationReviewedAt: z.iso.date().nullable().default(null),
    presentation: z
      .object({
        attributionText: z.string().trim().min(1).max(240).nullable().default(null),
        allowRemoteLogos: z.boolean().default(false),
        logoRightsReviewDate: z.iso.date().nullable().default(null),
      })
      .default({
        attributionText: null,
        allowRemoteLogos: false,
        logoRightsReviewDate: null,
      }),
  })
  .superRefine((catalog, context) => {
    if (
      catalog.enabled &&
      (catalog.authorizationReference === null ||
        catalog.authorizationReviewedAt === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["enabled"],
        message:
          "ESPN activation requires a reviewed authorization record.",
      });
    }
    if (
      catalog.presentation.allowRemoteLogos &&
      catalog.presentation.logoRightsReviewDate === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["presentation", "logoRightsReviewDate"],
        message: "Remote ESPN logos require a recorded rights-review date.",
      });
    }
  });

export function parseEspnCatalog(value: unknown): {
  enabled: boolean;
  presentation: CatalogPresentation;
} {
  const parsed = espnCatalogSchema.parse(value ?? {});
  return {
    enabled: parsed.enabled,
    presentation: parsed.presentation.allowRemoteLogos
      ? {
          provider: "espn",
          attributionText: parsed.presentation.attributionText,
          allowRemoteLogos: true,
          allowedLogoHosts: [ESPN_LOGO_HOST],
          allowedLogoQueryParameters: [],
          logoRightsReviewDate: parsed.presentation.logoRightsReviewDate,
        }
      : neutralCatalogPresentation(
          "espn",
          parsed.presentation.attributionText,
        ),
  };
}

const scoreboardEnvelopeSchema = z
  .object({
    events: z.array(z.unknown()),
    leagues: z.array(z.unknown()).optional(),
  })
  .passthrough();

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function nested(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const segment of path) current = objectValue(current)[segment];
  return current;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function boundedOptionalText(value: unknown, maximumLength: number): string | null {
  const normalized = text(value);
  return normalized.length === 0 ? null : normalized.slice(0, maximumLength);
}

function usableStatusType(value: unknown): JsonObject | null {
  const candidate = objectValue(value);
  const statusName =
    text(candidate.name) ||
    text(candidate.description) ||
    text(candidate.detail) ||
    text(candidate.shortDetail);
  // A named-but-unknown event status is authoritative drift and must remain
  // reviewRequired. Fall back only when the event status has no meaningful
  // label and no state/completion signal that maps safely.
  if (statusName.length > 0) return candidate;
  return mapEspnStatus(
    statusName,
    text(candidate.state),
    candidate.completed === true,
  ) === "reviewRequired"
    ? null
    : candidate;
}

function nullableScore(value: unknown): number | null {
  const raw = text(value);
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function safeEventId(value: unknown): string | null {
  const id = text(objectValue(value).id);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) ? id : null;
}

function safeLogoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== ESPN_LOGO_HOST ||
      url.port.length > 0 ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      [...url.searchParams.keys()].length > 0
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function firstLogo(team: JsonObject): string | null {
  const direct = safeLogoUrl(team.logo);
  if (direct !== null) return direct;
  for (const candidate of arrayValue(team.logos)) {
    const logo = safeLogoUrl(objectValue(candidate).href);
    if (logo !== null) return logo;
  }
  return null;
}

function teamColor(value: unknown): string | null {
  const color = text(value).toLowerCase().replace(/^#/, "");
  return /^[0-9a-f]{6}$/.test(color) ? `#${color}` : null;
}

function normalizeEspnTeam(
  competitorValue: unknown,
  side: "Home" | "Away",
): Team {
  const competitor = objectValue(competitorValue);
  const rawTeam = objectValue(competitor.team);
  const id = text(rawTeam.id) || text(competitor.id);
  const name = text(rawTeam.displayName) || text(rawTeam.name);
  if (id.length === 0 || name.length === 0) {
    throw new Error(`ESPN ${side.toLowerCase()} competitor is missing identity.`);
  }
  const base = normalizeTeam(id, name, firstLogo(rawTeam));
  const shortName = text(rawTeam.shortDisplayName) || text(rawTeam.name);
  const abbreviation = text(rawTeam.abbreviation).toUpperCase();
  return {
    ...base,
    shortName:
      shortName.length > 0 && shortName.length <= 80
        ? shortName
        : base.shortName,
    abbreviation: /^[A-Z0-9 .&'-]{1,12}$/.test(abbreviation)
      ? abbreviation
      : base.abbreviation,
    color: teamColor(rawTeam.color),
  };
}

export function mapEspnStatus(
  providerStatus: string,
  state = "",
  completed = false,
): GameStatus {
  const status = providerStatus.trim().toUpperCase();
  const normalizedState = state.trim().toLowerCase();
  if (/CANCEL(?:ED|LED)/.test(status)) return "cancelled";
  if (status.includes("POSTPON")) return "postponed";
  if (status.includes("SUSPEND") || status.includes("ABANDON")) {
    return "suspended";
  }
  if (status.includes("DELAY") || status.includes("RAIN_DELAY")) {
    return "delayed";
  }
  if (status.includes("FINAL") || completed) return "final";
  if (
    normalizedState === "in" ||
    status.includes("IN_PROGRESS") ||
    status.includes("HALFTIME") ||
    status.includes("END_PERIOD")
  ) {
    return "live";
  }
  if (
    normalizedState === "pre" ||
    status.includes("SCHEDULED") ||
    status.includes("PREGAME")
  ) {
    return "scheduled";
  }
  return "reviewRequired";
}

function seasonType(value: JsonObject): string | null {
  const slug = text(value.slug);
  if (slug.length > 0) {
    return boundedOptionalText(slug.replace(/-season$/, ""), 40);
  }
  const type = Number(value.type);
  return (
    {
      1: "preseason",
      2: "regular",
      3: "postseason",
      4: "offseason",
    } as Record<number, string>
  )[type] ?? null;
}

function broadcastFor(competition: JsonObject): string | null {
  const names = new Set<string>();
  for (const broadcastValue of arrayValue(competition.broadcasts)) {
    const broadcast = objectValue(broadcastValue);
    for (const name of arrayValue(broadcast.names).map(text)) {
      if (name.length > 0) names.add(name);
    }
    const mediaName = text(nested(broadcast, "media", "shortName"));
    if (mediaName.length > 0) names.add(mediaName);
  }
  const joined = [...names].join(", ");
  return joined.length === 0 ? null : joined.slice(0, 240);
}

function eventDetailFor(event: JsonObject, competition: JsonObject): string | null {
  const note = arrayValue(competition.notes)
    .map((value) => text(objectValue(value).headline))
    .find((value) => value.length > 0);
  if (note !== undefined) return note.slice(0, 160);
  const detail = text(event.shortName);
  return detail.length > 0 ? detail.slice(0, 160) : null;
}

export function normalizeEspnEvent(
  value: unknown,
  config: EspnLeagueConfig,
  observedAt = new Date(),
): NormalizedGame {
  const event = objectValue(value);
  const providerGameId = safeEventId(event);
  if (providerGameId === null) {
    throw new Error("ESPN event did not include a stable event ID.");
  }
  const competition = objectValue(arrayValue(event.competitions)[0]);
  if (Object.keys(competition).length === 0) {
    throw new Error("ESPN event did not include a competition.");
  }
  const competitors = arrayValue(competition.competitors);
  const homeValue = competitors.find(
    (item) => text(objectValue(item).homeAway).toLowerCase() === "home",
  );
  const awayValue = competitors.find(
    (item) => text(objectValue(item).homeAway).toLowerCase() === "away",
  );
  if (homeValue === undefined || awayValue === undefined) {
    throw new Error("ESPN event did not include distinct home and away teams.");
  }
  const homeTeam = normalizeEspnTeam(homeValue, "Home");
  const awayTeam = normalizeEspnTeam(awayValue, "Away");
  if (homeTeam.id === awayTeam.id) {
    throw new Error("ESPN event returned the same team on both sides.");
  }

  const statusType =
    usableStatusType(nested(event, "status", "type")) ??
    usableStatusType(nested(competition, "status", "type")) ??
    {};
  const statusName =
    text(statusType.name) ||
    text(statusType.description) ||
    text(statusType.detail) ||
    text(statusType.shortDetail);
  const state = text(statusType.state);
  const mappedStatus = mapEspnStatus(
    statusName,
    state,
    statusType.completed === true,
  );
  const statusDetail = boundedOptionalText(
    text(statusType.detail) ||
      text(statusType.shortDetail) ||
      text(statusType.description) ||
      statusName,
    120,
  );
  const normalizedState = state.toLowerCase();
  const started =
    normalizedState === "in" ||
    normalizedState === "post" ||
    mappedStatus === "live" ||
    mappedStatus === "final";
  const homeCompetitor = objectValue(homeValue);
  const awayCompetitor = objectValue(awayValue);
  const homeScore = started ? nullableScore(homeCompetitor.score) : null;
  const awayScore = started ? nullableScore(awayCompetitor.score) : null;
  const outcome = finalWinner(
    mappedStatus,
    homeTeam.id,
    awayTeam.id,
    homeScore,
    awayScore,
  );

  const rawDate = text(event.date) || text(competition.date);
  const scheduledAt = new Date(rawDate);
  if (rawDate.length === 0 || Number.isNaN(scheduledAt.valueOf())) {
    throw new Error("ESPN event did not include a valid UTC start time.");
  }
  const season = objectValue(event.season);
  const seasonYear = text(season.year) || String(scheduledAt.getUTCFullYear());
  const rawWeek = objectValue(event.week);
  const weekOrRound = boundedOptionalText(
    text(rawWeek.text) || text(rawWeek.number),
    80,
  );
  const venue = objectValue(competition.venue);
  const venueName = boundedOptionalText(
    text(venue.fullName) || text(venue.name),
    160,
  );
  const broadcast = broadcastFor(competition);
  const eventDetail = eventDetailFor(event, competition);

  // Hash the same bounded canonical projection for schedule and result reads.
  // Never hash or log ESPN's full response, which is large and endpoint-shape
  // dependent even when the material game is identical.
  const sourceProjection = {
    eventId: providerGameId,
    date: scheduledAt.toISOString(),
    status: outcome.status,
    statusDetail,
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    venueName,
    broadcast,
    eventDetail,
  };

  return normalizedGameSchema.parse(
    withSourceHash(
      {
        id: `espn:${config.sportCode}:${providerGameId}`,
        provider: "espn",
        providerGameId,
        providerLeagueId: config.espnLeagueSlug,
        sportCode: config.sportCode,
        leagueCode: config.id,
        leagueName: config.displayName,
        season: seasonYear,
        seasonType: seasonType(season),
        weekOrRound,
        scheduledAtUtc: scheduledAt,
        publishedScheduledAtUtc: scheduledAt,
        effectiveLockAtUtc: scheduledAt,
        venueName,
        neutralSite: competition.neutralSite === true,
        homeTeam,
        awayTeam,
        status: outcome.status,
        statusDetail,
        homeScore,
        awayScore,
        winnerTeamId: outcome.winnerTeamId,
        broadcast,
        eventDetail,
        rawResponseVersion: ESPN_RAW_RESPONSE_VERSION,
        providerLastUpdatedAt: observedAt,
        lastSyncedAt: observedAt,
        manualOverride: false,
        manualOverrideReason: null,
        manualOverrideBy: null,
      },
      sourceProjection,
    ),
  );
}

function responseLeagueSlug(value: unknown): string | null {
  for (const leagueValue of arrayValue(value)) {
    const slug = text(objectValue(leagueValue).slug);
    if (slug.length > 0) return slug;
  }
  return null;
}

export function normalizeEspnScoreboard(
  value: unknown,
  config: EspnLeagueConfig,
  observedAt = new Date(),
): NormalizedGame[] {
  const payload = scoreboardEnvelopeSchema.parse(value);
  const returnedLeague = responseLeagueSlug(payload.leagues);
  if (returnedLeague !== null && returnedLeague !== config.espnLeagueSlug) {
    throw new Error("ESPN returned a scoreboard for an unexpected league.");
  }
  const games: NormalizedGame[] = [];
  payload.events.forEach((event, eventIndex) => {
    try {
      games.push(normalizeEspnEvent(event, config, observedAt));
    } catch (error: unknown) {
      logger.warn("ESPN event skipped during normalization", {
        provider: "espn",
        leagueCode: config.id,
        eventIndex,
        providerGameId: safeEventId(event),
        parseFailure:
          error instanceof Error
            ? {name: error.name, message: error.message.slice(0, 160)}
            : {name: "UnknownError"},
      });
    }
  });
  if (payload.events.length > 0 && games.length === 0) {
    throw new Error(
      "ESPN scoreboard contained events but none could be normalized.",
    );
  }
  return games;
}

function compactDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("ESPN scoreboard dates must use YYYY-MM-DD.");
  }
  return value.replaceAll("-", "");
}

export function resolveEspnScoreboardUrl(
  config: EspnLeagueConfig,
  query: Pick<ProviderQuery, "from" | "to">,
  requestType: "games" | "selectedGames" = "games",
): URL {
  const path = `${ESPN_SCOREBOARD_PREFIX}${config.espnSportSlug}/${config.espnLeagueSlug}/scoreboard`;
  const url = new URL(path, ESPN_SCOREBOARD_ORIGIN);
  if (
    url.origin !== ESPN_SCOREBOARD_ORIGIN ||
    !url.pathname.startsWith(ESPN_SCOREBOARD_PREFIX)
  ) {
    throw new Error("ESPN scoreboard URL escaped its allowlisted endpoint.");
  }
  const from = compactDate(query.from);
  const to = compactDate(query.to);
  url.searchParams.set("dates", from === to ? from : `${from}-${to}`);
  for (const [name, value] of Object.entries(config.queryParameters)) {
    if (value !== undefined) url.searchParams.set(name, value);
  }
  if (requestType === "selectedGames") {
    // A selected refresh searches seven inclusive days. Pro leagues can
    // exceed their ordinary single-day catalog limits across that window.
    url.searchParams.set("limit", "500");
  }
  return url;
}

class NonRetryableEspnError extends Error {}

async function boundedResponseText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > ESPN_MAX_RESPONSE_BYTES
  ) {
    throw new NonRetryableEspnError(
      "ESPN response exceeded the safe size limit.",
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
      if (byteCount > ESPN_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new NonRetryableEspnError(
          "ESPN response exceeded the safe size limit.",
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

export class EspnProvider implements SportsDataProvider {
  readonly name = "espn";
  readonly selectedGameRefreshMode = "partial" as const;
  readonly selectedGameRefreshMaximumIds = 500;
  readonly usagePolicy = {
    softDailyLimitSetting: "ESPN_SOFT_DAILY_LIMIT",
    defaultSoftDailyLimit: 500,
    maximumSoftDailyLimit: 20_000,
  } as const;
  private requestAttemptCount = 0;
  private retryAuthorizer: (() => Promise<void>) | null = null;

  constructor(
    private readonly configs: readonly EspnLeagueConfig[] = ESPN_LEAGUE_CONFIGS,
    readonly presentation: CatalogPresentation = neutralCatalogPresentation("espn"),
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async listSupportedSports(): Promise<string[]> {
    return [...new Set(this.configs.filter((item) => item.enabled).map((item) => item.sportCode))];
  }

  async listLeagues(sportCode?: string): Promise<ProviderLeague[]> {
    const season = String(new Date().getUTCFullYear());
    return this.configs
      .filter(
        (config) =>
          config.enabled &&
          (sportCode === undefined || config.sportCode === sportCode),
      )
      .map((config) => ({
        code: config.id,
        name: config.displayName,
        sportCode: config.sportCode,
        providerLeagueId: config.espnLeagueSlug,
        season,
      }));
  }

  async listGames(query: ProviderQuery): Promise<NormalizedGame[]> {
    const config = this.resolveConfig(query);
    return this.requestScoreboard(config, query, "games");
  }

  async fetchGames(
    providerGameIds: string[],
    context?: Partial<ProviderQuery>,
  ): Promise<NormalizedGame[]> {
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
        "A dated, validated ESPN league context is required.",
      );
    }
    const query: ProviderQuery = {
      sportCode: context.sportCode,
      leagueCode: context.leagueCode,
      providerLeagueId: context.providerLeagueId,
      season: context.season,
      from: context.from,
      to: context.to,
      timezone: context.timezone,
      ...(context.forceRefresh === undefined
        ? {}
        : {forceRefresh: context.forceRefresh}),
    };
    const config = this.resolveConfig(query);
    const requested = new Set(providerGameIds);
    return (await this.requestScoreboard(config, query, "selectedGames")).filter(
      (game) => requested.has(game.providerGameId),
    );
  }

  requestEstimate(
    _operation: ProviderRequestOperation,
    _itemCount: number,
  ): ProviderRequestEstimate {
    return {
      baseRequestCount: 1,
      maximumRequestCount: ESPN_MAX_REQUEST_ATTEMPTS,
    };
  }

  getRequestAttemptCount(): number {
    return this.requestAttemptCount;
  }

  setRetryAuthorizer(authorizer: (() => Promise<void>) | null): void {
    if (authorizer !== null && this.retryAuthorizer !== null) {
      throw new Error("ESPN retry authorization is already installed.");
    }
    this.retryAuthorizer = authorizer;
  }

  async getTeamMetadata(_teamId: string): Promise<Team | null> {
    return null;
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      state: this.configs.some((config) => config.enabled)
        ? "healthy"
        : "degraded",
      quotaRemaining: null,
      checkedAt: new Date(),
      detail: "Unofficial ESPN Site API adapter is configured behind runtime gates.",
    };
  }

  mapStatus(providerStatus: string): GameStatus {
    return mapEspnStatus(providerStatus);
  }

  private resolveConfig(query: Partial<ProviderQuery>): EspnLeagueConfig {
    const config = this.configs.find(
      (item) =>
        item.enabled &&
        item.sportCode === query.sportCode &&
        item.id === query.leagueCode &&
        item.espnLeagueSlug === query.providerLeagueId,
    );
    if (config === undefined) {
      throw new HttpsError(
        "failed-precondition",
        "This ESPN league has not been enabled in the server allowlist.",
      );
    }
    return config;
  }

  private async requestScoreboard(
    config: EspnLeagueConfig,
    query: ProviderQuery,
    requestType: "games" | "selectedGames",
  ): Promise<NormalizedGame[]> {
    const attemptCountBefore = this.requestAttemptCount;
    try {
      return await this.performScoreboardRequest(config, query, requestType);
    } catch (error: unknown) {
      logger.warn("ESPN scoreboard request failed", {
        provider: this.name,
        leagueCode: config.id,
        from: query.from,
        to: query.to,
        attemptCount: this.requestAttemptCount - attemptCountBefore,
        safeErrorCode:
          error instanceof HttpsError
            ? error.code
            : error instanceof Error
              ? error.name.slice(0, 80)
              : "UnknownError",
      });
      throw error;
    }
  }

  private async performScoreboardRequest(
    config: EspnLeagueConfig,
    query: ProviderQuery,
    requestType: "games" | "selectedGames",
  ): Promise<NormalizedGame[]> {
    const url = resolveEspnScoreboardUrl(config, query, requestType);
    const timeout = positiveIntegerSetting("ESPN_TIMEOUT_MS", 8000, 15_000);
    let response: Response | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < ESPN_MAX_REQUEST_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        if (this.retryAuthorizer === null) {
          throw new ProviderRetryAuthorizationError(
            new HttpsError(
              "failed-precondition",
              "ESPN retry authorization is unavailable.",
            ),
          );
        }
        try {
          await this.retryAuthorizer();
        } catch (error: unknown) {
          throw new ProviderRetryAuthorizationError(error);
        }
      }
      try {
        this.requestAttemptCount += 1;
        response = await this.fetchImplementation(url, {
          method: "GET",
          headers: {accept: "application/json"},
          redirect: "error",
          signal: AbortSignal.timeout(timeout),
        });
        if (response.ok) break;
        if (response.status === 429) {
          throw new HttpsError(
            "resource-exhausted",
            "Sports data refresh is temporarily delayed.",
          );
        }
        if (response.status < 500) {
          throw new NonRetryableEspnError(
            `ESPN request failed with status ${response.status}.`,
          );
        }
        throw new Error(`ESPN request failed with status ${response.status}.`);
      } catch (error: unknown) {
        lastError = error;
        if (
          error instanceof NonRetryableEspnError ||
          error instanceof HttpsError ||
          attempt === ESPN_MAX_REQUEST_ATTEMPTS - 1
        ) {
          throw error;
        }
      }
      const jitterMs = Math.floor(Math.random() * 100);
      await new Promise((resolve) => {
        setTimeout(resolve, 200 * 2 ** attempt + jitterMs);
      });
    }
    if (response === null || !response.ok) {
      if (lastError instanceof Error) throw lastError;
      throw new Error("ESPN request failed.");
    }
    const body = await boundedResponseText(response);
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new NonRetryableEspnError("ESPN returned invalid JSON.");
    }
    const games = normalizeEspnScoreboard(payload, config);
    logger.info("ESPN scoreboard request completed", {
      provider: this.name,
      leagueCode: config.id,
      from: query.from,
      to: query.to,
      gameCount: games.length,
      attemptCount: this.requestAttemptCount,
    });
    return games;
  }
}
