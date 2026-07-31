import {
  FieldValue,
  Timestamp,
} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {z} from "zod";
import {db, positiveIntegerSetting} from "../config.js";
import {
  normalizedGameSchema,
  teamSchema,
} from "../schemas.js";
import type {
  GameStatus,
  NormalizedGame,
  ProviderHealth,
  ProviderLeague,
  ProviderQuery,
  SportsDataProvider,
  Team,
} from "../types.js";
import {sha256} from "../utils.js";
import {finalWinner, normalizeTeam, withSourceHash} from "./normalization.js";

// Official v1 documentation:
// https://www.thesportsdb.com/docs_api_guide
// Free/test use remains subject to:
// https://www.thesportsdb.com/docs_terms_of_use.php
const BASE_URL = "https://www.thesportsdb.com/api/v1/json/123/";
const MAX_QUERY_DAYS = 7;
const MAX_LOOKUP_EVENTS = 20;
const TEAM_CACHE_TTL_MS = 7 * 24 * 60 * 60_000;

export const THE_SPORTS_DB_ATTRIBUTION = {
  text: "Sports data and artwork from TheSportsDB",
  url: "https://www.thesportsdb.com",
} as const;

const providerConfigSchema = z.object({
  sportCode: z.string().trim().min(1).max(128),
  leagueCode: z.string().trim().min(1).max(128),
  leagueName: z.string().trim().min(1).max(120),
  providerLeagueId: z
    .union([z.string(), z.number()])
    .transform(String)
    .pipe(z.string().regex(/^\d+$/)),
  season: z.string().trim().min(1).max(32),
});

export type TheSportsDbTestConfig = z.infer<typeof providerConfigSchema>;

export function parseTheSportsDbTestConfigs(
  value: unknown,
): TheSportsDbTestConfig[] {
  return z.array(providerConfigSchema).max(100).parse(value);
}

const identifierSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .pipe(z.string().min(1).max(128));
const optionalScalarSchema = z
  .union([z.string(), z.number(), z.null()])
  .optional();

const eventSchema = z
  .object({
    idEvent: identifierSchema,
    idLeague: identifierSchema,
    idHomeTeam: identifierSchema,
    idAwayTeam: identifierSchema,
    strHomeTeam: z.string().trim().min(1).max(120),
    strAwayTeam: z.string().trim().min(1).max(120),
    strLeague: optionalScalarSchema,
    strSport: optionalScalarSchema,
    strSeason: optionalScalarSchema,
    intRound: optionalScalarSchema,
    dateEvent: optionalScalarSchema,
    strTime: optionalScalarSchema,
    strTimestamp: optionalScalarSchema,
    strStatus: optionalScalarSchema,
    strPostponed: optionalScalarSchema,
    intHomeScore: optionalScalarSchema,
    intAwayScore: optionalScalarSchema,
    strHomeTeamBadge: optionalScalarSchema,
    strAwayTeamBadge: optionalScalarSchema,
    strVenue: optionalScalarSchema,
    strUpdated: optionalScalarSchema,
    updated: optionalScalarSchema,
  })
  .passthrough();

const eventsEnvelopeSchema = z
  .object({
    events: z.array(z.unknown()).nullable(),
  })
  .passthrough();

const teamResponseSchema = z
  .object({
    idTeam: identifierSchema,
    strTeam: z.string().trim().min(1).max(120),
    strTeamShort: optionalScalarSchema,
    strBadge: optionalScalarSchema,
    strTeamBadge: optionalScalarSchema,
  })
  .passthrough();

const teamsEnvelopeSchema = z
  .object({
    teams: z.array(z.unknown()).nullable(),
  })
  .passthrough();

type ProviderEndpoint =
  | "eventsday.php"
  | "lookupevent.php"
  | "lookupteam.php";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type TheSportsDbTestProviderOptions = {
  fetchImpl?: FetchLike;
  reserveRequest?: () => Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
};

class NonRetryableProviderError extends Error {}

function scalarText(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result.length > 0 ? result : null;
}

function score(value: unknown): number | null {
  const text = scalarText(value);
  if (text === null) return null;
  const parsed = Number(text);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function utcDate(value: unknown): Date | null {
  const text = scalarText(value);
  if (text === null) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function eventStart(event: z.infer<typeof eventSchema>): Date {
  const timestamp = utcDate(event.strTimestamp);
  if (timestamp !== null) return timestamp;

  const date = scalarText(event.dateEvent);
  const time = scalarText(event.strTime);
  if (
    date === null ||
    time === null ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^\d{2}:\d{2}(?::\d{2})?$/.test(time)
  ) {
    throw new Error("TheSportsDB event did not include a valid UTC start time.");
  }
  const parsed = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}Z`);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error("TheSportsDB event did not include a valid UTC start time.");
  }
  return parsed;
}

const ALLOWED_IMAGE_HOSTS = new Set([
  "www.thesportsdb.com",
  "thesportsdb.com",
  "r2.thesportsdb.com",
  "r3.thesportsdb.com",
]);

export function theSportsDbSmallImageUrl(value: unknown): string | null {
  const text = scalarText(value);
  if (text === null) return null;
  try {
    const url = new URL(text);
    if (
      url.protocol !== "https:" ||
      !ALLOWED_IMAGE_HOSTS.has(url.hostname.toLowerCase()) ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return null;
    }
    url.search = "";
    url.hash = "";
    if (!/\/(medium|small|tiny)$/.test(url.pathname)) {
      url.pathname = `${url.pathname.replace(/\/$/, "")}/small`;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function mapTheSportsDbStatus(providerStatus: string): GameStatus {
  const status = providerStatus.trim().toUpperCase();
  if (
    status.length === 0 ||
    ["NS", "TBD", "NOT STARTED", "SCHEDULED"].includes(status)
  ) {
    return "scheduled";
  }
  if (
    /^(Q[1-4]|IN\d+|[12]H)$/.test(status) ||
    ["OT", "HT", "BT", "LIVE", "IN PLAY"].includes(status)
  ) {
    return "live";
  }
  if (["FT", "AOT", "AP", "FINAL", "MATCH FINISHED"].includes(status)) {
    return "final";
  }
  if (["PST", "POST", "POSTPONED"].includes(status)) return "postponed";
  if (
    ["SUSP", "SUSPENDED", "INTR", "INTERRUPTED", "ABD", "ABANDONED"].includes(
      status,
    )
  ) {
    return "suspended";
  }
  if (["CANC", "CANCELLED", "CANCELED"].includes(status)) return "cancelled";
  if (["DELAYED", "DELAY"].includes(status)) return "delayed";
  return "reviewRequired";
}

export type TheSportsDbNormalizationContext = {
  sportCode: string;
  leagueCode: string;
  leagueName: string;
  providerLeagueId: string;
  season: string;
  importedAt?: Date;
};

export function normalizeTheSportsDbEvents(
  values: unknown[],
  context: TheSportsDbNormalizationContext,
): NormalizedGame[] {
  const importedAt = context.importedAt ?? new Date();
  const parsedEvents = z.array(eventSchema).parse(values);
  const games = new Map<string, NormalizedGame>();

  for (const event of parsedEvents) {
    if (event.idLeague !== context.providerLeagueId) continue;
    const homeTeam = normalizeTeam(
      event.idHomeTeam,
      event.strHomeTeam,
      theSportsDbSmallImageUrl(event.strHomeTeamBadge),
    );
    const awayTeam = normalizeTeam(
      event.idAwayTeam,
      event.strAwayTeam,
      theSportsDbSmallImageUrl(event.strAwayTeamBadge),
    );
    const rawStatus =
      scalarText(event.strPostponed)?.toLowerCase() === "yes"
        ? "postponed"
        : scalarText(event.strStatus) ?? "";
    const mappedStatus = mapTheSportsDbStatus(rawStatus);
    const homeScore = score(event.intHomeScore);
    const awayScore = score(event.intAwayScore);
    const outcome = finalWinner(
      mappedStatus,
      homeTeam.id,
      awayTeam.id,
      homeScore,
      awayScore,
    );
    const scheduledAt = eventStart(event);
    const providerUpdatedAt =
      utcDate(event.strUpdated) ?? utcDate(event.updated) ?? importedAt;
    const game = normalizedGameSchema.parse(
      withSourceHash(
        {
          id: `theSportsDbTest:${context.sportCode}:${event.idEvent}`,
          provider: "theSportsDbTest",
          providerGameId: event.idEvent,
          sportCode: context.sportCode,
          leagueCode: context.leagueCode,
          leagueName:
            scalarText(event.strLeague) ?? context.leagueName,
          season: scalarText(event.strSeason) ?? context.season,
          weekOrRound: scalarText(event.intRound),
          scheduledAtUtc: scheduledAt,
          publishedScheduledAtUtc: scheduledAt,
          effectiveLockAtUtc: scheduledAt,
          venueName: scalarText(event.strVenue),
          neutralSite: false,
          homeTeam,
          awayTeam,
          status: outcome.status,
          homeScore,
          awayScore,
          winnerTeamId: outcome.winnerTeamId,
          providerLastUpdatedAt: providerUpdatedAt,
          lastSyncedAt: importedAt,
          manualOverride: false,
          manualOverrideReason: null,
          manualOverrideBy: null,
        },
        event,
      ),
    );
    const existing = games.get(game.id);
    if (
      existing === undefined ||
      game.providerLastUpdatedAt > existing.providerLastUpdatedAt
    ) {
      games.set(game.id, game);
    }
  }
  return [...games.values()];
}

async function reserveTheSportsDbRequest(): Promise<void> {
  const minuteLimit = positiveIntegerSetting(
    "THESPORTSDB_TEST_REQUESTS_PER_MINUTE",
    20,
    25,
  );
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const rateReference = db
    .collection("providerUsage")
    .doc("theSportsDbTest_rateWindow");
  const dailyReference = db
    .collection("providerUsage")
    .doc(`theSportsDbTest_${day}`);

  await db.runTransaction(async (transaction) => {
    const [rateSnapshot, dailySnapshot] = await Promise.all([
      transaction.get(rateReference),
      transaction.get(dailyReference),
    ]);
    const previousWindow = rateSnapshot.data()?.windowStartedAt;
    const sameWindow =
      previousWindow instanceof Timestamp &&
      previousWindow.toMillis() > now - 60_000;
    const minuteCount =
      sameWindow && typeof rateSnapshot.data()?.requestCount === "number"
        ? Number(rateSnapshot.data()?.requestCount)
        : 0;
    if (minuteCount >= minuteLimit) {
      throw new HttpsError(
        "resource-exhausted",
        "The internal sports test provider is rate limited. Try again shortly.",
      );
    }
    const dailyCount =
      typeof dailySnapshot.data()?.requestCount === "number"
        ? Number(dailySnapshot.data()?.requestCount)
        : 0;
    transaction.set(rateReference, {
      provider: "theSportsDbTest",
      windowStartedAt: sameWindow
        ? previousWindow
        : Timestamp.fromMillis(now),
      requestCount: minuteCount + 1,
      limit: minuteLimit,
      expiresAt: Timestamp.fromMillis(now + 2 * 60_000),
    });
    transaction.set(
      dailyReference,
      {
        provider: "theSportsDbTest",
        day,
        requestCount: dailyCount + 1,
        softLimit: null,
        lastAttempt: FieldValue.serverTimestamp(),
      },
      {merge: true},
    );
  });
}

function dateRange(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  const days =
    Math.floor((end.valueOf() - start.valueOf()) / 86_400_000) + 1;
  if (
    Number.isNaN(start.valueOf()) ||
    Number.isNaN(end.valueOf()) ||
    days < 1 ||
    days > MAX_QUERY_DAYS
  ) {
    throw new HttpsError(
      "invalid-argument",
      `TheSportsDB test queries must span 1-${MAX_QUERY_DAYS} days.`,
    );
  }
  return Array.from({length: days}, (_, index) =>
    new Date(start.valueOf() + index * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export class TheSportsDbTestProvider implements SportsDataProvider {
  readonly name = "theSportsDbTest";
  private readonly fetchImpl: FetchLike;
  private readonly reserveRequest: () => Promise<void>;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(
    private readonly configs: TheSportsDbTestConfig[],
    options: TheSportsDbTestProviderOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.reserveRequest = options.reserveRequest ?? reserveTheSportsDbRequest;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => new Date());
  }

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
    const rawEvents: unknown[] = [];
    for (const day of dateRange(query.from, query.to)) {
      const envelope = eventsEnvelopeSchema.parse(
        await this.request("eventsday.php", {
          d: day,
          l: config.providerLeagueId,
        }),
      );
      rawEvents.push(...(envelope.events ?? []));
    }
    return normalizeTheSportsDbEvents(rawEvents, {
      sportCode: config.sportCode,
      leagueCode: config.leagueCode,
      leagueName: config.leagueName,
      providerLeagueId: config.providerLeagueId,
      season: config.season,
      importedAt: this.now(),
    });
  }

  async fetchGames(
    providerGameIds: string[],
    context?: Partial<ProviderQuery>,
  ): Promise<NormalizedGame[]> {
    const uniqueIds = [...new Set(providerGameIds)];
    if (
      uniqueIds.length > MAX_LOOKUP_EVENTS ||
      uniqueIds.some((id) => !/^\d+$/.test(id))
    ) {
      throw new HttpsError(
        "invalid-argument",
        `At most ${MAX_LOOKUP_EVENTS} numeric event IDs may be looked up.`,
      );
    }
    if (
      context?.sportCode === undefined ||
      context.leagueCode === undefined ||
      context.leagueId === undefined ||
      context.season === undefined
    ) {
      throw new HttpsError(
        "invalid-argument",
        "A configured league context is required for event lookup.",
      );
    }
    const config = this.resolveConfig({
      sportCode: context.sportCode,
      leagueCode: context.leagueCode,
      leagueId: context.leagueId,
      season: context.season,
      from: context.from ?? "2000-01-01",
      to: context.to ?? "2000-01-01",
    });
    const rawEvents: unknown[] = [];
    for (const id of uniqueIds) {
      const envelope = eventsEnvelopeSchema.parse(
        await this.request("lookupevent.php", {id}),
      );
      rawEvents.push(...(envelope.events ?? []));
    }
    return normalizeTheSportsDbEvents(rawEvents, {
      sportCode: config.sportCode,
      leagueCode: config.leagueCode,
      leagueName: config.leagueName,
      providerLeagueId: config.providerLeagueId,
      season: config.season,
      importedAt: this.now(),
    });
  }

  async getTeamMetadata(teamId: string): Promise<Team | null> {
    if (!/^\d+$/.test(teamId)) {
      throw new HttpsError("invalid-argument", "Team ID must be numeric.");
    }
    const reference = db
      .collection("sportsTeamCache")
      .doc(`theSportsDbTest:${teamId}`);
    const cached = await reference.get();
    const expiresAt = cached.data()?.expiresAt;
    const parsedCached = teamSchema.safeParse(cached.data());
    if (
      cached.exists &&
      expiresAt instanceof Timestamp &&
      expiresAt.toMillis() > Date.now() &&
      parsedCached.success
    ) {
      return parsedCached.data;
    }

    const envelope = teamsEnvelopeSchema.parse(
      await this.request("lookupteam.php", {id: teamId}),
    );
    const first = envelope.teams?.[0];
    if (first === undefined) return null;
    const rawTeam = teamResponseSchema.parse(first);
    const team = teamSchema.parse(
      normalizeTeam(
        rawTeam.idTeam,
        rawTeam.strTeam,
        theSportsDbSmallImageUrl(rawTeam.strBadge ?? rawTeam.strTeamBadge),
      ),
    );
    await reference.set({
      ...team,
      provider: "theSportsDbTest",
      attribution: THE_SPORTS_DB_ATTRIBUTION,
      sourcePayloadHash: sha256(rawTeam),
      cachedAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + TEAM_CACHE_TTL_MS),
    });
    return team;
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      state: this.configs.length > 0 ? "healthy" : "degraded",
      quotaRemaining: null,
      checkedAt: this.now(),
      detail:
        this.configs.length > 0
          ? `${THE_SPORTS_DB_ATTRIBUTION.text}; internal emulator testing only.`
          : "No internal TheSportsDB test leagues are configured.",
    };
  }

  mapStatus(providerStatus: string): GameStatus {
    return mapTheSportsDbStatus(providerStatus);
  }

  private resolveConfig(query: ProviderQuery): TheSportsDbTestConfig {
    const config = this.configs.find(
      (item) =>
        item.sportCode === query.sportCode &&
        item.leagueCode === query.leagueCode &&
        (item.providerLeagueId === query.leagueId ||
          item.leagueCode === query.leagueId) &&
        item.season === query.season,
    );
    if (config === undefined) {
      throw new HttpsError(
        "failed-precondition",
        "This internal test league and season are not configured.",
      );
    }
    return config;
  }

  private async request(
    endpoint: ProviderEndpoint,
    query: Record<string, string>,
  ): Promise<unknown> {
    const url = new URL(endpoint, BASE_URL);
    for (const [name, value] of Object.entries(query)) {
      url.searchParams.set(name, value);
    }
    const timeout = positiveIntegerSetting(
      "THESPORTSDB_TEST_TIMEOUT_MS",
      8000,
      15000,
    );
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.reserveRequest();
        const response = await this.fetchImpl(url, {
          method: "GET",
          headers: {accept: "application/json"},
          redirect: "error",
          signal: AbortSignal.timeout(timeout),
        });
        if (response.ok) return await response.json();
        if (response.status !== 429 && response.status < 500) {
          throw new NonRetryableProviderError(
            `TheSportsDB request failed with status ${response.status}.`,
          );
        }
        lastError = new Error(
          `TheSportsDB request failed with status ${response.status}.`,
        );
      } catch (error: unknown) {
        lastError = error;
        if (error instanceof NonRetryableProviderError) throw error;
      }
      if (attempt < 2) {
        await this.sleep(250 * 2 ** attempt);
      }
    }
    if (lastError instanceof HttpsError) throw lastError;
    throw new HttpsError(
      "unavailable",
      "The internal sports test provider is temporarily unavailable.",
    );
  }
}
