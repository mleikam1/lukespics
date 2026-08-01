import {HttpsError} from "firebase-functions/v2/https";
import {z} from "zod";
import {sportsDataIoKey} from "../config.js";
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
import {neutralCatalogPresentation} from "./presentation.js";
import {
  enumerateIsoDates,
  isSportsDataIoMlbSeason,
  isSportsDataIoNflSeason,
  SPORTSDATAIO_MAX_REQUEST_ATTEMPTS,
  SportsDataIoClient,
  type SportsDataIoClientOptions,
} from "./sportsDataIoClient.js";
import {
  mapSportsDataIoMlbStatus,
  SportsDataIoMlbAdapter,
  type SportsDataIoMlbCaches,
} from "./sportsDataIoMlb.js";
import {
  mapSportsDataIoNflStatus,
  SportsDataIoNflAdapter,
  type SportsDataIoNflCaches,
} from "./sportsDataIoNfl.js";

export const SPORTSDATAIO_MAX_DATE_RANGE_DAYS = 7;
export const SPORTSDATAIO_SELECTED_GAME_MAXIMUM_IDS = 500;

export type SportsDataIoAccessMode =
  | "fixture"
  | "trial"
  | "discovery"
  | "production";

export type SportsDataIoFeedEntitlements = {
  teams: boolean;
  schedules: boolean;
  liveAndFinal: boolean;
};

export type SportsDataIoLeagueConfig = {
  code: "nfl" | "mlb";
  enabled: boolean;
  season: string;
  entitlements: SportsDataIoFeedEntitlements;
};

export type SportsDataIoCatalog = {
  enabled: boolean;
  accessMode: SportsDataIoAccessMode;
  revision: string;
  cacheNamespace: string;
  entitlementVerified: boolean;
  entitlementReference: string | null;
  entitlementReviewedAt: string | null;
  leagues: SportsDataIoLeagueConfig[];
};

export type SportsDataIoProviderOptions = {
  client?: SportsDataIoClient;
  getApiKey?: SportsDataIoClientOptions["getApiKey"];
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  random?: () => number;
  timeoutMs?: number;
  maximumResponseBytes?: number;
  nflCaches?: SportsDataIoNflCaches;
  mlbCaches?: SportsDataIoMlbCaches;
  allowNonProductionForTesting?: boolean;
};

const feedEntitlementsSchema = z
  .object({
    teams: z.boolean(),
    schedules: z.boolean(),
    liveAndFinal: z.boolean(),
  })
  .strict();

const nflConfigSchema = z
  .object({
    code: z.literal("nfl"),
    enabled: z.boolean(),
    season: z
      .string()
      .trim()
      .refine(isSportsDataIoNflSeason, "Invalid SportsDataIO NFL season."),
    entitlements: feedEntitlementsSchema,
  })
  .strict();

const mlbConfigSchema = z
  .object({
    code: z.literal("mlb"),
    enabled: z.boolean(),
    season: z
      .string()
      .trim()
      .refine(isSportsDataIoMlbSeason, "Invalid SportsDataIO MLB season."),
    entitlements: feedEntitlementsSchema,
  })
  .strict();

const catalogSchema = z
  .object({
    enabled: z.boolean().default(false),
    accessMode: z
      .enum(["fixture", "trial", "discovery", "production"])
      .default("fixture"),
    revision: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
      .default("disabled"),
    entitlementVerified: z.boolean().default(false),
    entitlementReference: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .nullable()
      .default(null),
    entitlementReviewedAt: z.iso.date().nullable().default(null),
    leagues: z
      .array(z.discriminatedUnion("code", [nflConfigSchema, mlbConfigSchema]))
      .max(2)
      .default([]),
  })
  .strict()
  .superRefine((catalog, context) => {
    if (catalog.leagues.length !== 0) {
      const codes = new Set(catalog.leagues.map((league) => league.code));
      if (
        catalog.leagues.length !== 2 ||
        !codes.has("nfl") ||
        !codes.has("mlb")
      ) {
        context.addIssue({
          code: "custom",
          path: ["leagues"],
          message:
            "SportsDataIO catalog must contain exactly one NFL and one MLB configuration.",
        });
      }
    }
    if (
      catalog.enabled &&
      !catalog.leagues.some((league) => league.enabled)
    ) {
      context.addIssue({
        code: "custom",
        path: ["enabled"],
        message:
          "SportsDataIO cannot be enabled without an enabled league configuration.",
      });
    }
    if (catalog.enabled && catalog.accessMode === "production") {
      if (
        !catalog.entitlementVerified ||
        catalog.entitlementReference === null ||
        catalog.entitlementReviewedAt === null
      ) {
        context.addIssue({
          code: "custom",
          path: ["entitlementVerified"],
          message:
            "Production SportsDataIO access requires reviewed entitlement metadata.",
        });
      }
      for (const [index, league] of catalog.leagues.entries()) {
        if (
          league.enabled &&
          (!league.entitlements.teams ||
            !league.entitlements.schedules ||
            !league.entitlements.liveAndFinal)
        ) {
          context.addIssue({
            code: "custom",
            path: ["leagues", index, "entitlements"],
            message:
              "Production SportsDataIO leagues require Teams, Schedule, and Live & Final feed verification.",
          });
        }
      }
    }
  });

export function parseSportsDataIoCatalog(value: unknown): SportsDataIoCatalog {
  const parsed = catalogSchema.parse(value ?? {});
  return {
    enabled: parsed.enabled,
    accessMode: parsed.accessMode,
    revision: parsed.revision,
    cacheNamespace: `sportsDataIo:${parsed.revision}`,
    entitlementVerified: parsed.entitlementVerified,
    entitlementReference: parsed.entitlementReference,
    entitlementReviewedAt: parsed.entitlementReviewedAt,
    leagues: parsed.leagues,
  };
}

export function assertSportsDataIoProductionReady(
  catalog: SportsDataIoCatalog,
): void {
  if (!catalog.enabled) {
    throw new HttpsError(
      "failed-precondition",
      "SportsDataIO provider is disabled by its server-side kill switch.",
    );
  }
  if (catalog.accessMode !== "production") {
    throw new HttpsError(
      "failed-precondition",
      "SportsDataIO automatic production access requires production mode.",
    );
  }
  if (
    !catalog.entitlementVerified ||
    catalog.entitlementReference === null ||
    catalog.entitlementReviewedAt === null
  ) {
    throw new HttpsError(
      "failed-precondition",
      "SportsDataIO production entitlement has not been verified.",
    );
  }
  const enabledLeagues = catalog.leagues.filter((league) => league.enabled);
  if (enabledLeagues.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      "SportsDataIO has no enabled production leagues.",
    );
  }
  for (const league of enabledLeagues) {
    if (
      !league.entitlements.teams ||
      !league.entitlements.schedules ||
      !league.entitlements.liveAndFinal
    ) {
      throw new HttpsError(
        "failed-precondition",
        "SportsDataIO required feed entitlement is not verified.",
      );
    }
  }
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
      "A dated, validated SportsDataIO league context is required.",
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
    ...(context.forceRefresh === undefined
      ? {}
      : {forceRefresh: context.forceRefresh}),
  };
}

function safeProviderIds(values: string[]): Set<string> {
  if (values.length > SPORTSDATAIO_SELECTED_GAME_MAXIMUM_IDS) {
    throw new HttpsError(
      "invalid-argument",
      "SportsDataIO selected-game refresh batch is too large.",
    );
  }
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) {
      throw new HttpsError(
        "invalid-argument",
        "SportsDataIO selected-game ID is invalid.",
      );
    }
    unique.add(normalized);
  }
  return unique;
}

function clientOptions(
  options: SportsDataIoProviderOptions,
): SportsDataIoClientOptions {
  return {
    getApiKey: options.getApiKey ?? sportsDataIoKey,
    ...(options.fetchImpl === undefined ? {} : {fetchImpl: options.fetchImpl}),
    ...(options.sleep === undefined ? {} : {sleep: options.sleep}),
    ...(options.now === undefined ? {} : {now: options.now}),
    ...(options.random === undefined ? {} : {random: options.random}),
    ...(options.timeoutMs === undefined
      ? {}
      : {timeoutMs: options.timeoutMs}),
    ...(options.maximumResponseBytes === undefined
      ? {}
      : {maximumResponseBytes: options.maximumResponseBytes}),
  };
}

export class SportsDataIoProvider implements SportsDataProvider {
  readonly name = "sportsDataIo";
  readonly cacheNamespace: string;
  readonly presentation: CatalogPresentation = neutralCatalogPresentation(
    "sportsDataIo",
  );
  readonly selectedGameRefreshMode = "partial" as const;
  readonly selectedGameRefreshMaximumIds =
    SPORTSDATAIO_SELECTED_GAME_MAXIMUM_IDS;
  // This is an application safety budget, not a claim about a vendor quota.
  readonly usagePolicy = {
    softDailyLimitSetting: "SPORTSDATAIO_SOFT_DAILY_LIMIT",
    defaultSoftDailyLimit: 2_000,
    maximumSoftDailyLimit: 100_000,
  } as const;

  private readonly client: SportsDataIoClient;
  private readonly now: () => Date;
  private readonly nfl: SportsDataIoNflAdapter | null;
  private readonly mlb: SportsDataIoMlbAdapter | null;

  constructor(
    private readonly catalog: SportsDataIoCatalog,
    options: SportsDataIoProviderOptions = {},
  ) {
    if (options.allowNonProductionForTesting !== true) {
      assertSportsDataIoProductionReady(catalog);
    }
    this.cacheNamespace = catalog.cacheNamespace;
    this.client = options.client ?? new SportsDataIoClient(clientOptions(options));
    this.now = options.now ?? (() => new Date());
    const nflConfig = catalog.leagues.find(
      (league) => league.code === "nfl" && league.enabled,
    );
    const mlbConfig = catalog.leagues.find(
      (league) => league.code === "mlb" && league.enabled,
    );
    this.nfl = nflConfig === undefined
      ? null
      : new SportsDataIoNflAdapter({
          client: this.client,
          season: nflConfig.season,
          cacheNamespace: catalog.cacheNamespace,
          ...(options.nflCaches === undefined
            ? {}
            : {caches: options.nflCaches}),
          now: this.now,
        });
    this.mlb = mlbConfig === undefined
      ? null
      : new SportsDataIoMlbAdapter({
          client: this.client,
          season: mlbConfig.season,
          cacheNamespace: catalog.cacheNamespace,
          ...(options.mlbCaches === undefined
            ? {}
            : {caches: options.mlbCaches}),
          now: this.now,
        });
  }

  async listSupportedSports(): Promise<string[]> {
    if (!this.catalog.enabled) return [];
    return this.catalog.leagues.flatMap((league) =>
      league.enabled
        ? [league.code === "nfl" ? "football" : "baseball"]
        : [],
    );
  }

  async listLeagues(sportCode?: string): Promise<ProviderLeague[]> {
    if (!this.catalog.enabled) return [];
    return this.catalog.leagues.flatMap((league) => {
      if (!league.enabled) return [];
      const expectedSport = league.code === "nfl" ? "football" : "baseball";
      if (sportCode !== undefined && sportCode !== expectedSport) return [];
      return [{
        code: league.code,
        name: league.code === "nfl" ? "NFL" : "MLB",
        sportCode: expectedSport,
        providerLeagueId: league.code,
        season: league.season,
      }];
    });
  }

  async listGames(query: ProviderQuery): Promise<NormalizedGame[]> {
    enumerateIsoDates(
      query.from,
      query.to,
      SPORTSDATAIO_MAX_DATE_RANGE_DAYS,
    );
    const league = this.resolveLeague(query);
    if (league.code === "nfl") {
      if (this.nfl === null) {
        throw new Error("SportsDataIO NFL adapter was not constructed.");
      }
      return this.nfl.listGames(query);
    }
    if (this.mlb === null) {
      throw new Error("SportsDataIO MLB adapter was not constructed.");
    }
    return this.mlb.listGames(query);
  }

  async fetchGames(
    providerGameIds: string[],
    context?: Partial<ProviderQuery>,
  ): Promise<NormalizedGame[]> {
    if (providerGameIds.length === 0) return [];
    const requested = safeProviderIds(providerGameIds);
    const query = fullQuery(context);
    const league = this.resolveLeague(query);
    if (league.code === "nfl") {
      if (this.nfl === null) {
        throw new Error("SportsDataIO NFL adapter was not constructed.");
      }
      return this.nfl.fetchGames(requested, query);
    }
    if (this.mlb === null) {
      throw new Error("SportsDataIO MLB adapter was not constructed.");
    }
    return this.mlb.fetchGames(requested, query);
  }

  requestEstimate(
    operation: ProviderRequestOperation,
    itemCount: number,
    context?: Partial<ProviderQuery>,
  ): ProviderRequestEstimate {
    if (operation === "fetchGames" && itemCount === 0) {
      return {baseRequestCount: 0, maximumRequestCount: 0};
    }
    const dateCount =
      context?.from === undefined || context.to === undefined
        ? SPORTSDATAIO_MAX_DATE_RANGE_DAYS
        : enumerateIsoDates(
            context.from,
            context.to,
            SPORTSDATAIO_MAX_DATE_RANGE_DAYS,
          ).length;
    const isMlb =
      context?.leagueCode === "mlb" ||
      context?.providerLeagueId === "mlb" ||
      context?.sportCode === "baseball";
    // NFL selected-game refreshes may discover a different current day from
    // SchedulesBasic. Reserve conservatively for one additional distinct day
    // per requested ID; settlement refunds every unused base request.
    const possibleMovedDateCount =
      operation === "fetchGames" && !isMlb ? itemCount : 0;
    const baseRequestCount =
      dateCount + possibleMovedDateCount + (isMlb ? 1 : 2);
    return {
      baseRequestCount,
      maximumRequestCount:
        baseRequestCount * SPORTSDATAIO_MAX_REQUEST_ATTEMPTS,
    };
  }

  getRequestAttemptCount(): number {
    return this.client.getRequestAttemptCount();
  }

  setRetryAuthorizer(authorizer: (() => Promise<void>) | null): void {
    this.client.setRetryAuthorizer(authorizer);
  }

  async getTeamMetadata(teamId: string): Promise<Team | null> {
    if (teamId.startsWith("sportsDataIo:nfl:team:")) {
      return this.nfl?.getTeamMetadata(teamId) ?? null;
    }
    if (teamId.startsWith("sportsDataIo:mlb:team:")) {
      return this.mlb?.getTeamMetadata(teamId) ?? null;
    }
    return null;
  }

  async getHealth(): Promise<ProviderHealth> {
    const productionReady =
      this.catalog.enabled &&
      this.catalog.accessMode === "production" &&
      this.catalog.entitlementVerified;
    return {
      provider: this.name,
      state: productionReady ? "healthy" : "degraded",
      quotaRemaining: null,
      checkedAt: this.now(),
      detail: productionReady
        ? "SportsDataIO League API provider is configured behind server controls."
        : "SportsDataIO is disabled or restricted to a non-production access mode.",
    };
  }

  mapStatus(providerStatus: string): GameStatus {
    return providerStatus.trim().toUpperCase().replace(/[ _-]/g, "") ===
      "NOTNECESSARY"
      ? mapSportsDataIoMlbStatus(providerStatus)
      : mapSportsDataIoNflStatus(providerStatus);
  }

  private resolveLeague(
    query: Pick<
      ProviderQuery,
      "sportCode" | "leagueCode" | "providerLeagueId" | "season"
    >,
  ): SportsDataIoLeagueConfig {
    const config = this.catalog.leagues.find(
      (league) =>
        league.enabled &&
        league.code === query.leagueCode &&
        league.code === query.providerLeagueId &&
        league.season === query.season &&
        query.sportCode ===
          (league.code === "nfl" ? "football" : "baseball"),
    );
    if (
      config === undefined ||
      (config.code === "nfl" ? this.nfl === null : this.mlb === null)
    ) {
      throw new HttpsError(
        "failed-precondition",
        "This SportsDataIO league is not enabled in the reviewed catalog.",
      );
    }
    return config;
  }
}
