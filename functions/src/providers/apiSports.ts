import {HttpsError} from "firebase-functions/v2/https";
import {z} from "zod";
import {
  API_SPORTS_KEY,
  positiveIntegerSetting,
} from "../config.js";
import {normalizedGameSchema} from "../schemas.js";
import type {
  CatalogPresentation,
  GameStatus,
  NormalizedGame,
  ProviderHealth,
  ProviderLeague,
  ProviderQuery,
  SportsDataProvider,
  Team,
} from "../types.js";
import {finalWinner, normalizeTeam, withSourceHash} from "./normalization.js";
import {neutralCatalogPresentation} from "./presentation.js";

const API_SPORTS_HOST_PATTERN =
  /^https:\/\/v1\.(american-football|basketball|baseball|hockey)\.api-sports\.io$/;
const DEFAULT_FINAL_STATUSES = ["FT", "AOT", "AP", "FINAL"];
export const API_SPORTS_MAX_REQUEST_ATTEMPTS = 3;
export const API_SPORTS_SELECTED_GAME_CONCURRENCY = 10;
const FORBIDDEN_LOGO_HOSTS = [
  ["espn", "com"].join("."),
  ["espncdn", "com"].join("."),
];
const SENSITIVE_LOGO_QUERY_KEYS = new Set([
  "access_token",
  "api-key",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "credential",
  "key",
  "password",
  "secret",
  "sig",
  "signature",
  "token",
]);

function forbiddenLogoHost(host: string): boolean {
  return FORBIDDEN_LOGO_HOSTS.some(
    (forbidden) => host === forbidden || host.endsWith(`.${forbidden}`),
  );
}

function sensitiveLogoQueryKey(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  return (
    SENSITIVE_LOGO_QUERY_KEYS.has(normalized) ||
    compact.endsWith("apikey") ||
    compact.includes("accesstoken") ||
    compact.includes("accessid") ||
    compact.includes("authorization") ||
    compact.includes("credential") ||
    compact.includes("password") ||
    compact.includes("signature") ||
    compact.includes("token") ||
    compact.includes("secret")
  );
}

const apiSportsConfigSchema = z.object({
  sportCode: z.string().trim().min(1).max(128),
  leagueCode: z.string().trim().min(1).max(128),
  leagueName: z.string().trim().min(1).max(120),
  providerLeagueId: z
    .union([z.string(), z.number()])
    .transform(String)
    .pipe(z.string().trim().min(1).max(128)),
  season: z
    .union([z.string(), z.number()])
    .transform(String)
    .pipe(z.string().trim().min(1).max(32)),
  baseUrl: z
    .url()
    .refine(
      (url) => API_SPORTS_HOST_PATTERN.test(url),
      "Only allowlisted API-Sports product hosts are permitted.",
    ),
  gamesPath: z
    .string()
    .regex(/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/)
    .default("/games"),
  finalStatuses: z
    .array(z.string().trim().min(1).max(40))
    .max(50)
    .default(DEFAULT_FINAL_STATUSES)
    .transform((values) => [
      ...new Set(values.map((value) => value.toUpperCase())),
    ]),
});

export type ApiSportsConfig = z.infer<typeof apiSportsConfigSchema>;

const apiSportsConfigsSchema = z
  .array(apiSportsConfigSchema)
  .max(100)
  .superRefine((configs, context) => {
    const identities = new Set<string>();
    for (const [index, config] of configs.entries()) {
      const identity = [
        config.sportCode,
        config.leagueCode,
      ].join(":");
      if (identities.has(identity)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Duplicate API-Sports league configuration.",
        });
      }
      identities.add(identity);
    }
  });

const hostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/)
  .refine(
    (host) => !forbiddenLogoHost(host),
    "Broadcaster-owned image hosts are not permitted.",
  );

const apiSportsPresentationSchema = z
  .object({
    attributionText: z.string().trim().min(1).max(240).nullable().default(null),
    allowRemoteLogos: z.boolean().default(false),
    allowedLogoHosts: z.array(hostSchema).max(20).default([]),
    allowedLogoQueryParameters: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9_-]{1,64}$/)
          .refine(
            (name) => !sensitiveLogoQueryKey(name),
            "Credential-bearing logo query parameters are not permitted.",
          ),
      )
      .max(20)
      .default([]),
    logoRightsReviewDate: z.iso.date().nullable().default(null),
  })
  .superRefine((presentation, context) => {
    if (
      presentation.allowRemoteLogos &&
      (presentation.allowedLogoHosts.length === 0 ||
        presentation.logoRightsReviewDate === null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Remote logos require reviewed rights and at least one exact host.",
      });
    }
  });

const apiSportsCatalogSchema = z.object({
  leagues: apiSportsConfigsSchema.default([]),
  presentation: apiSportsPresentationSchema.optional(),
});

export function parseApiSportsConfigs(value: unknown): ApiSportsConfig[] {
  return apiSportsConfigsSchema.parse(value);
}

export function parseApiSportsCatalog(value: unknown): {
  leagues: ApiSportsConfig[];
  presentation: CatalogPresentation;
} {
  const parsed = apiSportsCatalogSchema.parse(value);
  const presentation = parsed.presentation;
  if (presentation === undefined) {
    return {
      leagues: parsed.leagues,
      presentation: neutralCatalogPresentation("apiSports"),
    };
  }
  return {
    leagues: parsed.leagues,
    presentation: {
      provider: "apiSports",
      attributionText: presentation.attributionText,
      allowRemoteLogos: presentation.allowRemoteLogos,
      allowedLogoHosts: [...new Set(presentation.allowedLogoHosts)],
      allowedLogoQueryParameters: [
        ...new Set(presentation.allowedLogoQueryParameters),
      ],
      logoRightsReviewDate: presentation.logoRightsReviewDate,
    },
  };
}

const envelopeSchema = z
  .object({
    response: z.array(z.unknown()),
    results: z.number().int().nonnegative().optional(),
    errors: z
      .union([z.array(z.unknown()), z.record(z.string(), z.unknown())])
      .default([]),
    paging: z
      .object({
        current: z.number().int().positive(),
        total: z.number().int().positive(),
      })
      .optional(),
  })
  .passthrough();

type ApiSportsEnvelope = z.infer<typeof envelopeSchema>;

class NonRetryableProviderError extends Error {}

export class ApiSportsRetryAuthorizationError extends Error {
  constructor(readonly authorizationCause: unknown) {
    super("API-Sports retry authorization failed.");
    this.name = "ApiSportsRetryAuthorizationError";
  }
}

export function resolveApiSportsGamesUrl(config: ApiSportsConfig): URL {
  const baseUrl = new URL(config.baseUrl);
  const url = new URL(config.gamesPath, baseUrl);
  if (url.origin !== baseUrl.origin) {
    throw new Error("API-Sports games path escaped its configured origin.");
  }
  return url;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nested(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    current = objectValue(current)[segment];
  }
  return current;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function providerErrorsPresent(errors: ApiSportsEnvelope["errors"]): boolean {
  return Array.isArray(errors)
    ? errors.length > 0
    : Object.keys(errors).length > 0;
}

function permittedLogoUrl(
  value: unknown,
  presentation: CatalogPresentation,
): string | null {
  if (!presentation.allowRemoteLogos || typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.port.length > 0 ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      !presentation.allowedLogoHosts.includes(hostname) ||
      forbiddenLogoHost(hostname)
    ) {
      return null;
    }
    const allowedParameters = new Set(
      presentation.allowedLogoQueryParameters,
    );
    if (
      [...url.searchParams.keys()].some(
        (name) =>
          sensitiveLogoQueryKey(name) || !allowedParameters.has(name),
      )
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function itemTimestamp(item: unknown): Date {
  const game = objectValue(nested(item, "game"));
  const raw =
    game.timestamp ??
    objectValue(item).timestamp ??
    nested(game, "date", "timestamp");
  if (typeof raw === "number" || /^\d+$/.test(text(raw))) {
    const seconds = Number(raw);
    if (Number.isSafeInteger(seconds) && seconds > 0) {
      return new Date(seconds * 1000);
    }
  }
  const rawDate =
    game.date ?? objectValue(item).date ?? nested(game, "date", "date");
  const date = new Date(text(rawDate));
  if (Number.isNaN(date.valueOf())) {
    throw new Error("API-Sports returned an invalid game timestamp.");
  }
  return date;
}

export function mapApiSportsStatus(
  providerStatus: string,
  finalStatuses: string[] = DEFAULT_FINAL_STATUSES,
): GameStatus {
  const status = providerStatus.trim().toUpperCase();
  if (new Set(finalStatuses.map((value) => value.toUpperCase())).has(status)) {
    return "final";
  }
  if (["NS", "TBD", "SCHEDULED"].includes(status)) return "scheduled";
  if (
    /^IN\d{1,2}$/.test(status) ||
    [
      "1Q",
      "2Q",
      "3Q",
      "4Q",
      "HT",
      "LIVE",
      "IN PLAY",
      "IN PLAYING",
    ].includes(status)
  ) {
    return "live";
  }
  if (["PST", "POST", "POSTPONED"].includes(status)) return "postponed";
  if (
    [
      "SUSP",
      "SUSPENDED",
      "INT",
      "INTR",
      "INTERRUPTED",
      "ABD",
      "ABANDONED",
      "AWD",
      "AWARDED",
    ].includes(status)
  ) {
    return "reviewRequired";
  }
  if (["CANC", "CANCELLED", "CANCELED"].includes(status)) {
    return "cancelled";
  }
  if (["DELAYED"].includes(status)) return "delayed";
  return "reviewRequired";
}

function normalizedTeam(
  value: unknown,
  fallback: string,
  presentation: CatalogPresentation,
): Team {
  const raw = objectValue(value);
  const team = normalizeTeam(
    text(raw.id),
    text(raw.name, fallback),
    permittedLogoUrl(raw.logo, presentation),
  );
  const abbreviation = text(raw.code) || text(raw.abbreviation);
  return abbreviation.length > 0 && /^[A-Za-z0-9 .&'-]{1,12}$/.test(abbreviation)
    ? {...team, abbreviation: abbreviation.toUpperCase()}
    : team;
}

export function normalizeApiSportsGame(
  item: unknown,
  config: ApiSportsConfig,
  presentation: CatalogPresentation = neutralCatalogPresentation("apiSports"),
  observedAt = new Date(),
): NormalizedGame {
  const itemObject = objectValue(item);
  const gameObject = objectValue(itemObject.game);
  const root =
    Object.keys(gameObject).length > 0
      ? {...itemObject, ...gameObject}
      : itemObject;
  const providerGameId = text(root.id);
  if (providerGameId.length === 0) {
    throw new Error("API-Sports game did not include a stable ID.");
  }

  const responseLeagueId = text(nested(item, "league", "id"));
  if (
    responseLeagueId.length > 0 &&
    responseLeagueId !== config.providerLeagueId
  ) {
    throw new Error("API-Sports returned a game for an unexpected league.");
  }
  const responseSeason = text(nested(item, "league", "season"));
  if (responseSeason.length > 0 && responseSeason !== config.season) {
    throw new Error("API-Sports returned a game for an unexpected season.");
  }

  const homeTeam = normalizedTeam(
    nested(item, "teams", "home"),
    "Home team",
    presentation,
  );
  const awayTeam = normalizedTeam(
    nested(item, "teams", "away"),
    "Away team",
    presentation,
  );
  const rawStatus =
    text(nested(root, "status", "short")) ||
    text(nested(root, "status", "long")) ||
    text(root.status);
  const mappedStatus = mapApiSportsStatus(rawStatus, config.finalStatuses);
  const homeScore =
    nullableNumber(nested(item, "scores", "home", "total")) ??
    nullableNumber(nested(item, "scores", "home"));
  const awayScore =
    nullableNumber(nested(item, "scores", "away", "total")) ??
    nullableNumber(nested(item, "scores", "away"));
  const outcome = finalWinner(
    mappedStatus,
    homeTeam.id,
    awayTeam.id,
    homeScore,
    awayScore,
  );
  const scheduledAt = itemTimestamp(item);
  const venue = nested(root, "venue", "name");

  return normalizedGameSchema.parse(
    withSourceHash(
      {
        id: `apiSports:${config.sportCode}:${providerGameId}`,
        provider: "apiSports",
        providerGameId,
        providerLeagueId: config.providerLeagueId,
        sportCode: config.sportCode,
        leagueCode: config.leagueCode,
        leagueName: config.leagueName,
        season: responseSeason || config.season,
        weekOrRound:
          text(root.week) || text(root.stage)
            ? text(root.week) || text(root.stage)
            : null,
        scheduledAtUtc: scheduledAt,
        publishedScheduledAtUtc: scheduledAt,
        effectiveLockAtUtc: scheduledAt,
        venueName: text(venue) || null,
        neutralSite: root.neutral === true,
        homeTeam,
        awayTeam,
        status: outcome.status,
        homeScore,
        awayScore,
        winnerTeamId: outcome.winnerTeamId,
        providerLastUpdatedAt: observedAt,
        lastSyncedAt: observedAt,
        manualOverride: false,
        manualOverrideReason: null,
        manualOverrideBy: null,
      },
      item,
    ),
  );
}

export class ApiSportsProvider implements SportsDataProvider {
  readonly name = "apiSports";
  private observedQuotaRemaining: number | null = null;
  private requestAttemptCount = 0;
  private retryAuthorizer: (() => Promise<void>) | null = null;

  constructor(
    private readonly configs: ApiSportsConfig[],
    readonly presentation: CatalogPresentation =
      neutralCatalogPresentation("apiSports"),
  ) {}

  async listSupportedSports(): Promise<string[]> {
    return [...new Set(this.configs.map((config) => config.sportCode))];
  }

  async listLeagues(sportCode?: string): Promise<ProviderLeague[]> {
    return this.configs
      .filter(
        (config) =>
          sportCode === undefined || config.sportCode === sportCode,
      )
      .map((config) => ({
        code: config.leagueCode,
        name: config.leagueName,
        sportCode: config.sportCode,
        providerLeagueId: config.providerLeagueId,
        season: config.season,
      }));
  }

  async listGames(query: ProviderQuery): Promise<NormalizedGame[]> {
    const config = this.resolveConfig(query);
    const payload = await this.request(config, {
      league: config.providerLeagueId,
      season: config.season,
      from: query.from,
      to: query.to,
      timezone: query.timezone,
    });
    return payload.response.map((item) =>
      normalizeApiSportsGame(item, config, this.presentation),
    );
  }

  async fetchGames(
    providerGameIds: string[],
    context?: Partial<ProviderQuery>,
  ): Promise<NormalizedGame[]> {
    if (
      context?.sportCode === undefined ||
      context.leagueCode === undefined ||
      context.providerLeagueId === undefined ||
      context.season === undefined
    ) {
      throw new HttpsError(
        "failed-precondition",
        "A validated league context is required.",
      );
    }
    const config = this.resolveConfig({
      sportCode: context.sportCode,
      leagueCode: context.leagueCode,
      providerLeagueId: context.providerLeagueId,
      season: context.season,
      from: context.from ?? "2000-01-01",
      to: context.to ?? "2000-01-01",
      timezone: context.timezone ?? "UTC",
    });
    const uniqueIds = [...new Set(providerGameIds)];
    if (uniqueIds.length > 20) {
      throw new HttpsError(
        "invalid-argument",
        "At most 20 provider games may be refreshed at once.",
      );
    }
    const games: NormalizedGame[] = [];
    // At the maximum 15-second request timeout, one three-attempt envelope is
    // under 47 seconds including backoff. Two waves of ten stay below the
    // callable's 120-second timeout while keeping outbound fan-out bounded.
    for (
      let offset = 0;
      offset < uniqueIds.length;
      offset += API_SPORTS_SELECTED_GAME_CONCURRENCY
    ) {
      const batch = uniqueIds.slice(
        offset,
        offset + API_SPORTS_SELECTED_GAME_CONCURRENCY,
      );
      // Wait for every request already launched in this wave to finish before
      // surfacing an error. Otherwise sibling retries could outlive gateway
      // quota settlement and be undercounted.
      const batchResults = await Promise.allSettled(
        batch.map(async (id) => {
          const payload = await this.request(config, {id});
          const normalized = payload.response.map((item) =>
            normalizeApiSportsGame(item, config, this.presentation),
          );
          if (
            normalized.length !== 1 ||
            normalized[0]?.providerGameId !== id
          ) {
            throw new NonRetryableProviderError(
              "API-Sports returned an incomplete selected-game response.",
            );
          }
          return normalized[0];
        }),
      );
      const failure =
        batchResults.find(
          (result) =>
            result.status === "rejected" &&
            result.reason instanceof ApiSportsRetryAuthorizationError,
        ) ??
        batchResults.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      games.push(
        ...batchResults.map((result) => {
          if (result.status !== "fulfilled") {
            throw new Error("API-Sports selected-game batch failed.");
          }
          return result.value;
        }),
      );
    }
    return games;
  }

  getRequestAttemptCount(): number {
    return this.requestAttemptCount;
  }

  setRetryAuthorizer(authorizer: (() => Promise<void>) | null): void {
    if (authorizer !== null && this.retryAuthorizer !== null) {
      throw new Error("API-Sports retry authorization is already installed.");
    }
    this.retryAuthorizer = authorizer;
  }

  async getTeamMetadata(_teamId: string): Promise<Team | null> {
    return null;
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      state: this.configs.length > 0 ? "healthy" : "degraded",
      quotaRemaining: this.observedQuotaRemaining,
      checkedAt: new Date(),
      detail:
        this.configs.length > 0
          ? "Validated server catalog is configured."
          : "No validated API-Sports leagues are configured.",
    };
  }

  mapStatus(providerStatus: string): GameStatus {
    return mapApiSportsStatus(providerStatus);
  }

  private resolveConfig(query: ProviderQuery): ApiSportsConfig {
    const config = this.configs.find(
      (item) =>
        item.sportCode === query.sportCode &&
        item.leagueCode === query.leagueCode &&
        item.providerLeagueId === query.providerLeagueId &&
        item.season === query.season,
    );
    if (config === undefined) {
      throw new HttpsError(
        "failed-precondition",
        "This league and season have not been validated in the server provider catalog.",
      );
    }
    return config;
  }

  private async request(
    config: ApiSportsConfig,
    query: Record<string, string>,
  ): Promise<ApiSportsEnvelope> {
    const url = resolveApiSportsGamesUrl(config);
    const key = API_SPORTS_KEY.value().trim();
    if (key.length === 0) {
      throw new Error("API-Sports secret is not configured.");
    }
    for (const [name, value] of Object.entries(query)) {
      url.searchParams.set(name, value);
    }
    const timeout = positiveIntegerSetting(
      "API_SPORTS_TIMEOUT_MS",
      8000,
      15000,
    );
    let response: Response | null = null;
    let lastError: unknown = null;
    for (
      let attempt = 0;
      attempt < API_SPORTS_MAX_REQUEST_ATTEMPTS;
      attempt += 1
    ) {
      if (attempt > 0) {
        const authorizeRetry = this.retryAuthorizer;
        if (authorizeRetry === null) {
          throw new ApiSportsRetryAuthorizationError(
            new HttpsError(
              "failed-precondition",
              "Sports data retry authorization is unavailable.",
            ),
          );
        }
        try {
          await authorizeRetry();
        } catch (error: unknown) {
          throw new ApiSportsRetryAuthorizationError(error);
        }
      }
      try {
        this.requestAttemptCount += 1;
        response = await fetch(url, {
          method: "GET",
          headers: {
            "x-apisports-key": key,
            accept: "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(timeout),
        });
        const remainingHeader =
          response.headers.get("x-ratelimit-requests-remaining") ??
          response.headers.get("x-ratelimit-remaining");
        const remaining =
          remainingHeader === null
            ? Number.NaN
            : Number.parseInt(remainingHeader, 10);
        if (Number.isFinite(remaining)) {
          this.observedQuotaRemaining =
            this.observedQuotaRemaining === null
              ? remaining
              : Math.min(this.observedQuotaRemaining, remaining);
        }
        if (response.ok) break;
        if (response.status === 429) {
          throw new HttpsError(
            "resource-exhausted",
            "Sports data refresh is temporarily delayed.",
          );
        }
        if (
          response.status < 500 ||
          attempt === API_SPORTS_MAX_REQUEST_ATTEMPTS - 1
        ) {
          throw new NonRetryableProviderError(
            `API-Sports request failed with status ${response.status}.`,
          );
        }
      } catch (error: unknown) {
        lastError = error;
        if (
          error instanceof NonRetryableProviderError ||
          error instanceof HttpsError
        ) {
          throw error;
        }
        if (attempt === API_SPORTS_MAX_REQUEST_ATTEMPTS - 1) throw error;
      }
      const jitterMs = Math.floor(Math.random() * 150);
      await new Promise((resolve) => {
        setTimeout(resolve, 250 * 2 ** attempt + jitterMs);
      });
    }
    if (response === null || !response.ok) {
      if (lastError instanceof Error) throw lastError;
      throw new Error("API-Sports request failed.");
    }
    const payload = envelopeSchema.parse(await response.json());
    if (providerErrorsPresent(payload.errors)) {
      throw new NonRetryableProviderError(
        "API-Sports reported a provider error.",
      );
    }
    if ((payload.paging?.total ?? 1) > 1) {
      throw new NonRetryableProviderError(
        "API-Sports returned a paginated response that cannot be represented as complete.",
      );
    }
    if (
      payload.results !== undefined &&
      payload.results > payload.response.length
    ) {
      throw new NonRetryableProviderError(
        "API-Sports returned an incomplete response.",
      );
    }
    return payload;
  }
}
