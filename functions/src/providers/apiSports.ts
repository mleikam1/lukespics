import {z} from "zod";
import {positiveIntegerSetting} from "../config.js";
import type {
  GameStatus,
  NormalizedGame,
  ProviderHealth,
  ProviderLeague,
  ProviderQuery,
  SportsDataProvider,
  Team,
} from "../types.js";
import {finalWinner, normalizeTeam, withSourceHash} from "./normalization.js";

const apiSportsConfigSchema = z.object({
  sportCode: z.string().min(1),
  leagueCode: z.string().min(1),
  leagueName: z.string().min(1),
  providerLeagueId: z.union([z.string(), z.number()]).transform(String),
  season: z.union([z.string(), z.number()]).transform(String),
  baseUrl: z
    .url()
    .refine(
      (url) =>
        /^https:\/\/v1\.(american-football|basketball|baseball|hockey)\.api-sports\.io$/.test(
          url,
        ),
      "Only allowlisted API-Sports product hosts are permitted.",
    ),
  gamesPath: z.string().regex(/^\/[A-Za-z0-9/_-]+$/).default("/games"),
  finalStatuses: z.array(z.string()).default(["FT", "AOT", "AP"]),
});

export type ApiSportsConfig = z.infer<typeof apiSportsConfigSchema>;

export function parseApiSportsConfigs(value: unknown): ApiSportsConfig[] {
  return z.array(apiSportsConfigSchema).parse(value);
}

const envelopeSchema = z
  .object({
    response: z.array(z.unknown()),
    results: z.number().int().nonnegative().optional(),
    errors: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]),
  })
  .passthrough();

class NonRetryableProviderError extends Error {}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nested(
  value: unknown,
  ...path: string[]
): unknown {
  let current = value;
  for (const segment of path) {
    current = objectValue(current)[segment];
  }
  return current;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
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
  if (typeof raw === "number") {
    return new Date(raw * 1000);
  }
  const rawDate =
    game.date ?? objectValue(item).date ?? nested(game, "date", "date");
  const date = new Date(text(rawDate));
  if (Number.isNaN(date.valueOf())) {
    throw new Error("API-Sports returned an invalid game timestamp.");
  }
  return date;
}

export class ApiSportsProvider implements SportsDataProvider {
  readonly name = "apiSports";
  private observedQuotaRemaining: number | null = null;

  constructor(private readonly configs: ApiSportsConfig[]) {}

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
    const config = this.configs.find(
      (item) =>
        item.sportCode === query.sportCode &&
        item.leagueCode === query.leagueCode,
    );
    if (config === undefined) {
      throw new Error(
        "This league has not been validated in the server provider catalog.",
      );
    }
    const payload = await this.request(config, {
      league: config.providerLeagueId,
      season: query.season,
      from: query.from,
      to: query.to,
      timezone: "UTC",
    });
    return payload.response.map((item) => this.normalize(item, config));
  }

  async fetchGames(
    providerGameIds: string[],
    context?: Partial<ProviderQuery>,
  ): Promise<NormalizedGame[]> {
    const config = this.configs.find(
      (item) =>
        item.sportCode === context?.sportCode &&
        item.leagueCode === context.leagueCode,
    );
    if (config === undefined) {
      throw new Error("A validated league context is required.");
    }
    const chunks: string[][] = [];
    for (let index = 0; index < providerGameIds.length; index += 20) {
      chunks.push(providerGameIds.slice(index, index + 20));
    }
    const games: NormalizedGame[] = [];
    for (const ids of chunks) {
      const payload = await this.request(config, {ids: ids.join("-")});
      games.push(
        ...payload.response.map((item) => this.normalize(item, config)),
      );
    }
    return games;
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
    const status = providerStatus.trim().toUpperCase();
    if (["NS", "TBD", "SCHEDULED"].includes(status)) return "scheduled";
    if (["1Q", "2Q", "3Q", "4Q", "HT", "LIVE", "IN PLAY"].includes(status)) {
      return "live";
    }
    if (["FT", "AOT", "AP", "FINAL"].includes(status)) return "final";
    if (["PST", "POSTPONED"].includes(status)) return "postponed";
    if (["SUSP", "SUSPENDED"].includes(status)) return "suspended";
    if (["CANC", "CANCELLED"].includes(status)) return "cancelled";
    if (["DELAYED", "INT"].includes(status)) return "delayed";
    return "reviewRequired";
  }

  private async request(
    config: ApiSportsConfig,
    query: Record<string, string>,
  ): Promise<z.infer<typeof envelopeSchema>> {
    const key = process.env.API_SPORTS_KEY?.trim() ?? "";
    if (key.length === 0) {
      throw new Error("API-Sports secret is not configured.");
    }
    const url = new URL(config.gamesPath, config.baseUrl);
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
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        response = await fetch(url, {
          method: "GET",
          headers: {
            "x-apisports-key": key,
            accept: "application/json",
          },
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
          this.observedQuotaRemaining = remaining;
        }
        if (response.ok) break;
        if (response.status < 500 || attempt === 2) {
          throw new NonRetryableProviderError(
            `API-Sports request failed with status ${response.status}.`,
          );
        }
      } catch (error: unknown) {
        lastError = error;
        if (error instanceof NonRetryableProviderError) throw error;
        if (attempt === 2) throw error;
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
    return envelopeSchema.parse(await response.json());
  }

  private normalize(item: unknown, config: ApiSportsConfig): NormalizedGame {
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
    const homeRaw = objectValue(nested(item, "teams", "home"));
    const awayRaw = objectValue(nested(item, "teams", "away"));
    const homeTeam = normalizeTeam(
      text(homeRaw.id),
      text(homeRaw.name, "Home team"),
      nullableUrl(homeRaw.logo),
    );
    const awayTeam = normalizeTeam(
      text(awayRaw.id),
      text(awayRaw.name, "Away team"),
      nullableUrl(awayRaw.logo),
    );
    const rawStatus =
      text(nested(root, "status", "short")) ||
      text(nested(root, "status", "long")) ||
      text(root.status);
    const mappedStatus = this.mapStatus(rawStatus);
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
    const now = new Date();
    return withSourceHash(
      {
        id: `apiSports:${config.sportCode}:${providerGameId}`,
        provider: "apiSports",
        providerGameId,
        sportCode: config.sportCode,
        leagueCode: config.leagueCode,
        leagueName: config.leagueName,
        season: text(nested(item, "league", "season"), config.season),
        weekOrRound:
          text(root.week) || text(root.stage)
            ? text(root.week) || text(root.stage)
            : null,
        scheduledAtUtc: scheduledAt,
        publishedScheduledAtUtc: scheduledAt,
        effectiveLockAtUtc: scheduledAt,
        venueName:
          text(nested(root, "venue", "name")) ||
          text(nested(item, "country", "name")) ||
          null,
        neutralSite: Boolean(root.neutral),
        homeTeam,
        awayTeam,
        status: outcome.status,
        homeScore,
        awayScore,
        winnerTeamId: outcome.winnerTeamId,
        providerLastUpdatedAt: now,
        lastSyncedAt: now,
        manualOverride: false,
        manualOverrideReason: null,
        manualOverrideBy: null,
      },
      item,
    );
  }
}
