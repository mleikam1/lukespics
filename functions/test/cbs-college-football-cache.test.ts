import {describe, expect, it, vi} from "vitest";
import type {Firestore} from "firebase-admin/firestore";
import {CbsCollegeFootballProvider} from
  "../src/providers/cbsCollegeFootballProvider.js";
import {parseCbsCollegeFootballScoreboardHtml} from
  "../src/providers/cbsCollegeFootball.js";
import {fetchGamesByIdsWithCache} from
  "../src/services/providerGateway.js";
import {
  CBS_CACHE_COLLECTION,
  CBS_CIRCUIT_DURATION_MS,
  CBS_MAXIMUM_RESPONSE_BYTES,
  CBS_REQUEST_WINDOW_MS,
  CBS_USER_AGENT,
  CbsCollegeFootballRequestError,
  FirestoreCbsCollegeFootballStore,
  activeCbsCollegeFootballScheduleInput,
  cbsCollegeFootballCacheDocumentId,
  cbsCollegeFootballGamesContentHash,
  cbsCollegeFootballRefreshMinutes,
  fetchCbsCollegeFootballScoreboard,
  isCbsTerminalSchedule,
  loadCbsCollegeFootballSchedule,
  parseCbsCollegeFootballConfig,
  refreshActiveCbsCollegeFootballSchedule,
  serializeCbsCollegeFootballScheduleResponse,
  validateCbsCollegeFootballRequestUrl,
  validateCbsCollegeFootballScheduleInput,
  type CbsCacheRecord,
  type CbsCollegeFootballConfig,
  type CbsCollegeFootballScheduleInput,
  type CbsCollegeFootballStore,
  type CbsLeaseResult,
  type CbsRecordFailureInput,
  type CbsRecordSuccessInput,
  type CbsUsageReservation,
} from "../src/services/cbsCollegeFootballSchedule.js";
import type {NormalizedGame, ProviderQuery} from "../src/types.js";

const NOW = new Date("2030-08-28T12:00:00.000Z");
const SCHEDULE: CbsCollegeFootballScheduleInput = {
  season: 2030,
  seasonType: "regular",
  week: 1,
  division: "FBS",
};

const ENABLED_CONFIG: CbsCollegeFootballConfig =
  parseCbsCollegeFootballConfig({
    enabled: true,
    autoRefreshEnabled: true,
    activeSeason: 2030,
    activeSeasonType: "regular",
    activeWeek: 1,
    division: "FBS",
    minimumRefreshMinutes: 120,
    defaultRefreshMinutes: 180,
    maximumRefreshMinutes: 240,
    parserVersion: "test-v1",
    globalDailyRequestLimit: 12,
  });

const QUIET_LOGGER = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function game(input: {
  id?: string;
  kickoff?: string | null;
  day?: string | null;
  status?: NormalizedGame["status"];
  homeScore?: number | null;
  awayScore?: number | null;
} = {}): NormalizedGame {
  const id = input.id ?? "game-1";
  const kickoff = input.kickoff === undefined
    ? new Date("2030-08-31T16:00:00.000Z")
    : input.kickoff === null
      ? null
      : new Date(input.kickoff);
  const day = input.day === undefined ? "2030-08-31" : input.day;
  const status = input.status ?? "scheduled";
  const homeScore = input.homeScore ?? null;
  const awayScore = input.awayScore ?? null;
  const sourceHash = "a".repeat(64);
  return {
    id: `cbsSports:ncaaf:${id}`,
    provider: "cbsSports",
    providerGameId: id,
    providerScoreId: id,
    providerLeagueGameId: id,
    providerGlobalGameId: null,
    providerGameKey: id,
    providerLeagueId: "FBS",
    sportCode: "NCAAF",
    leagueCode: "ncaaf",
    leagueName: "NCAA FBS College Football",
    season: "2030",
    seasonType: "regular",
    weekOrRound: "1",
    scheduledAtUtc: kickoff,
    publishedScheduledAtUtc: kickoff,
    effectiveLockAtUtc: kickoff,
    scheduledDayEastern: day,
    timeTbd: kickoff === null,
    venueName: "Fixture Field",
    neutralSite: false,
    homeTeam: {
      id: `cbsSports:ncaaf:${id}-home`,
      name: `${id} Home`,
      shortName: "Home",
      abbreviation: "HOM",
      logoUrl: null,
      providerTeamId: `${id}-home`,
      providerGlobalTeamId: null,
    },
    awayTeam: {
      id: `cbsSports:ncaaf:${id}-away`,
      name: `${id} Away`,
      shortName: "Away",
      abbreviation: "AWY",
      logoUrl: null,
      providerTeamId: `${id}-away`,
      providerGlobalTeamId: null,
    },
    status,
    statusDetail: status,
    isClosed: status === "final",
    rescheduledFromLeagueGameId: null,
    rescheduledToLeagueGameId: null,
    homeScore,
    awayScore,
    winnerTeamId:
      homeScore !== null && awayScore !== null && homeScore > awayScore
        ? `cbsSports:ncaaf:${id}-home`
        : null,
    broadcast: "CBS",
    eventDetail: null,
    rawResponseVersion: 1,
    providerLastUpdatedAt: NOW,
    lastSyncedAt: NOW,
    manualOverride: false,
    manualOverrideReason: null,
    manualOverrideBy: null,
    resultVersion: "fixture-v1",
    sourcePayloadHash: sourceHash,
  };
}

function cacheRecord(input: {
  games?: NormalizedGame[];
  cachedAt?: Date;
  nextRefreshAt?: Date | null;
  lastSuccessfulFetchAt?: Date | null;
  failures?: number;
  circuitOpenUntil?: Date | null;
  etag?: string | null;
  lastModified?: string | null;
  parserVersion?: string;
} = {}): CbsCacheRecord {
  const games = input.games ?? [game()];
  const cachedAt = input.cachedAt ?? new Date(NOW.valueOf() - 60_000);
  const lastSuccessfulFetchAt =
    input.lastSuccessfulFetchAt === undefined
      ? cachedAt
      : input.lastSuccessfulFetchAt;
  return {
    source: "cbsSports",
    sourceUrl:
      "https://www.cbssports.com/college-football/scoreboard/FBS/2030/regular/1/",
    sport: "NCAAF",
    division: "FBS",
    season: 2030,
    seasonType: "regular",
    week: 1,
    games,
    etag: input.etag ?? '"fixture-etag"',
    lastModified: input.lastModified ?? "Wed, 28 Aug 2030 10:00:00 GMT",
    contentHash: cbsCollegeFootballGamesContentHash(games),
    cachedAt,
    lastAttemptAt: lastSuccessfulFetchAt,
    lastSuccessfulFetchAt,
    nextRefreshAt:
      input.nextRefreshAt === undefined
        ? new Date(NOW.valueOf() + 60 * 60_000)
        : input.nextRefreshAt,
    hardExpiresAt: new Date(NOW.valueOf() + 24 * 60 * 60_000),
    refreshState: "idle",
    refreshLeaseOwner: null,
    refreshLeaseUntil: null,
    lastHttpStatus: 200,
    consecutiveFailures: input.failures ?? 0,
    lastErrorCode: null,
    lastErrorAt: null,
    circuitOpenUntil: input.circuitOpenUntil ?? null,
    parserVersion: input.parserVersion ?? "test-v1",
  };
}

type MemoryMetadata = {
  owner: string | null;
  leaseUntil: Date | null;
  lastAttemptAt: Date | null;
  lastSuccessfulFetchAt: Date | null;
  nextRefreshAt: Date | null;
  circuitOpenUntil: Date | null;
  failures: number;
};

class MemoryCbsStore implements CbsCollegeFootballStore {
  readonly caches = new Map<string, CbsCacheRecord>();
  readonly metadata = new Map<string, MemoryMetadata>();
  readonly reservations: Date[] = [];
  readonly successInputs: CbsRecordSuccessInput[] = [];
  readonly failureInputs: CbsRecordFailureInput[] = [];
  readCount = 0;
  acquireCount = 0;
  reserveCount = 0;
  releaseCount = 0;
  gameWriteCount = 0;
  providerCircuitOpenUntil: Date | null = null;
  providerConsecutiveFailures = 0;

  constructor(
    readonly configuration: unknown = ENABLED_CONFIG,
    initialCache?: CbsCacheRecord,
  ) {
    if (initialCache !== undefined) this.setCache(initialCache);
  }

  private state(cacheId: string): MemoryMetadata {
    const existing = this.metadata.get(cacheId);
    if (existing !== undefined) return existing;
    const cache = this.caches.get(cacheId);
    const created = {
      owner: cache?.refreshLeaseOwner ?? null,
      leaseUntil: cache?.refreshLeaseUntil ?? null,
      lastAttemptAt: cache?.lastAttemptAt ?? null,
      lastSuccessfulFetchAt: cache?.lastSuccessfulFetchAt ?? null,
      nextRefreshAt: cache?.nextRefreshAt ?? null,
      circuitOpenUntil: cache?.circuitOpenUntil ?? null,
      failures: cache?.consecutiveFailures ?? 0,
    };
    this.metadata.set(cacheId, created);
    return created;
  }

  setCache(cache: CbsCacheRecord): void {
    const cacheId = cbsCollegeFootballCacheDocumentId({
      season: cache.season,
      seasonType: cache.seasonType,
      week: cache.week,
      division: cache.division,
    });
    this.caches.set(cacheId, cache);
    this.metadata.set(cacheId, {
      owner: cache.refreshLeaseOwner,
      leaseUntil: cache.refreshLeaseUntil,
      lastAttemptAt: cache.lastAttemptAt,
      lastSuccessfulFetchAt: cache.lastSuccessfulFetchAt,
      nextRefreshAt: cache.nextRefreshAt,
      circuitOpenUntil: cache.circuitOpenUntil,
      failures: cache.consecutiveFailures,
    });
  }

  async readConfiguration(): Promise<unknown> {
    return this.configuration;
  }

  async readCache(cacheId: string): Promise<CbsCacheRecord | null> {
    this.readCount += 1;
    return this.caches.get(cacheId) ?? null;
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
    this.acquireCount += 1;
    const state = this.state(input.cacheId);
    const cache = this.caches.get(input.cacheId) ?? null;
    if (
      state.owner !== null &&
      state.owner !== input.owner &&
      state.leaseUntil !== null &&
      state.leaseUntil > input.now
    ) {
      return {
        acquired: false,
        cache,
        reason: "lease",
        retryAt: state.leaseUntil,
      };
    }
    if (state.circuitOpenUntil !== null && state.circuitOpenUntil > input.now) {
      return {
        acquired: false,
        cache,
        reason: "circuit",
        retryAt: state.circuitOpenUntil,
      };
    }
    if (
      !input.forceRefresh &&
      state.nextRefreshAt !== null &&
      state.nextRefreshAt > input.now
    ) {
      return {
        acquired: false,
        cache,
        reason: "fresh",
        retryAt: state.nextRefreshAt,
      };
    }
    const cooldownAnchor = [state.lastAttemptAt, state.lastSuccessfulFetchAt]
      .filter((date): date is Date => date !== null)
      .sort((left, right) => right.valueOf() - left.valueOf())[0] ?? null;
    const cooldownUntil = cooldownAnchor === null
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
    state.owner = input.owner;
    state.leaseUntil = input.leaseUntil;
    state.lastAttemptAt = input.now;
    return {acquired: true, cache};
  }

  async reserveRequestAttempt(input: {
    now: Date;
    limit: number;
    reservationId: string;
    cacheId: string;
  }): Promise<CbsUsageReservation> {
    this.reserveCount += 1;
    if (
      this.providerCircuitOpenUntil !== null &&
      this.providerCircuitOpenUntil > input.now
    ) {
      return {
        allowed: false,
        reason: "circuit",
        retryAt: this.providerCircuitOpenUntil,
        remaining: 0,
      };
    }
    const cutoff = input.now.valueOf() - CBS_REQUEST_WINDOW_MS;
    const active = this.reservations.filter((date) => date.valueOf() > cutoff);
    this.reservations.splice(0, this.reservations.length, ...active);
    if (active.length >= input.limit) {
      const retryAt = new Date(
        Math.min(...active.map((date) => date.valueOf())) +
        CBS_REQUEST_WINDOW_MS,
      );
      this.providerCircuitOpenUntil = retryAt;
      return {
        allowed: false,
        reason: "limit",
        retryAt,
        remaining: 0,
      };
    }
    this.reservations.push(input.now);
    return {
      allowed: true,
      reason: null,
      retryAt: null,
      remaining: input.limit - this.reservations.length,
    };
  }

  async recordRefreshSuccess(
    input: CbsRecordSuccessInput,
  ): Promise<CbsCacheRecord> {
    this.successInputs.push(input);
    const existing = this.caches.get(input.cacheId);
    const games = input.games ?? existing?.games;
    if (games === undefined) throw new Error("No games for success.");
    if (input.games !== null) this.gameWriteCount += 1;
    const state = this.state(input.cacheId);
    const updated: CbsCacheRecord = {
      source: "cbsSports",
      sourceUrl: input.sourceUrl,
      sport: "NCAAF",
      division: "FBS",
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
      refreshLeaseUntil: state.leaseUntil,
      lastHttpStatus: input.httpStatus,
      consecutiveFailures: 0,
      lastErrorCode: null,
      lastErrorAt: null,
      circuitOpenUntil: null,
      parserVersion: input.parserVersion,
    };
    this.caches.set(input.cacheId, updated);
    state.lastSuccessfulFetchAt = input.now;
    state.lastAttemptAt = input.now;
    state.nextRefreshAt = input.nextRefreshAt;
    state.failures = 0;
    state.circuitOpenUntil = null;
    this.providerConsecutiveFailures = 0;
    return updated;
  }

  async recordRefreshFailure(
    input: CbsRecordFailureInput,
  ): Promise<CbsCacheRecord | null> {
    this.failureInputs.push(input);
    const state = this.state(input.cacheId);
    state.lastAttemptAt = input.now;
    if (input.countsTowardCircuit) state.failures += 1;
    const automaticCircuit = state.failures >= 3
      ? new Date(input.now.valueOf() + CBS_CIRCUIT_DURATION_MS)
      : null;
    if (input.countsTowardCircuit) this.providerConsecutiveFailures += 1;
    const providerAutomaticCircuit = this.providerConsecutiveFailures >= 3
      ? new Date(input.now.valueOf() + CBS_CIRCUIT_DURATION_MS)
      : null;
    state.circuitOpenUntil = [input.circuitOpenUntil, automaticCircuit]
      .filter((date): date is Date => date !== null)
      .sort((left, right) => right.valueOf() - left.valueOf())[0] ?? null;
    this.providerCircuitOpenUntil = [
      this.providerCircuitOpenUntil,
      state.circuitOpenUntil,
      providerAutomaticCircuit,
    ]
      .filter((date): date is Date => date !== null)
      .sort((left, right) => right.valueOf() - left.valueOf())[0] ?? null;
    state.circuitOpenUntil = [
      state.circuitOpenUntil,
      this.providerCircuitOpenUntil,
    ]
      .filter((date): date is Date => date !== null)
      .sort((left, right) => right.valueOf() - left.valueOf())[0] ?? null;
    state.nextRefreshAt = [input.nextRefreshAt, state.circuitOpenUntil]
      .filter((date): date is Date => date !== null)
      .sort((left, right) => right.valueOf() - left.valueOf())[0] ?? null;
    const existing = this.caches.get(input.cacheId);
    if (existing === undefined) return null;
    const updated = {
      ...existing,
      lastAttemptAt: input.now,
      nextRefreshAt: state.nextRefreshAt,
      lastHttpStatus: input.httpStatus,
      consecutiveFailures: state.failures,
      lastErrorCode: input.errorCode,
      lastErrorAt: input.now,
      circuitOpenUntil: state.circuitOpenUntil,
    };
    this.caches.set(input.cacheId, updated);
    return updated;
  }

  async releaseRefreshLease(cacheId: string, owner: string): Promise<void> {
    this.releaseCount += 1;
    const state = this.state(cacheId);
    if (state.owner === owner) {
      state.owner = null;
      state.leaseUntil = null;
      const existing = this.caches.get(cacheId);
      if (existing !== undefined) {
        this.caches.set(cacheId, {
          ...existing,
          refreshState: "idle",
          refreshLeaseOwner: null,
          refreshLeaseUntil: null,
        });
      }
    }
  }
}

function oneGameHtml(input: {
  id?: string;
  date?: string;
  start?: string;
  away?: string;
  home?: string;
  status?: string;
  scores?: {away: number; home: number};
} = {}): string {
  const id = input.id ?? "game-1";
  const date = input.date ?? "2030-08-31";
  const start = input.start ?? "2030-08-31T16:00:00Z";
  const status = input.status ?? "scheduled";
  const score = (side: "away" | "home"): string => {
    const value = input.scores?.[side];
    return value === undefined ? "" : `<span class="score">${value}</span>`;
  };
  return `
    <title>2030 NCAA Football Scores - FBS - Week 1 - CBS Sports</title>
    <section>
      <h3>Saturday, August 31, 2030</h3>
      <article class="single-score-card" data-game-id="${id}"
        data-game-date="${date}" data-start-time="${start}"
        data-game-status="${status}">
        <div class="team" data-side="away" data-abbreviation="AWY">
          <a class="team-name-link" href="/college-football/teams/${id}-away/">${input.away ?? "Fixture Away"}</a>
          ${score("away")}
        </div>
        <div class="team" data-side="home" data-abbreviation="HOM">
          <a class="team-name-link" href="/college-football/teams/${id}-home/">${input.home ?? "Fixture Home"}</a>
          ${score("home")}
        </div>
        <span class="broadcaster">CBS</span>
      </article>
    </section>`;
}

function twoGameHtml(): string {
  return `${oneGameHtml()}
    ${oneGameHtml({
      id: "game-2",
      date: "2030-09-01",
      start: "2030-09-01T20:00:00Z",
      away: "Second Away",
      home: "Second Home",
    })}`;
}

function mockedFetch(
  implementation: (input: URL, init: RequestInit) => Promise<Response>,
): typeof fetch {
  return vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = input instanceof URL
      ? input
      : typeof input === "string"
        ? new URL(input)
        : new URL(input.url);
    return implementation(url, init ?? {});
  }) as unknown as typeof fetch;
}

function query(input: Partial<ProviderQuery> = {}): ProviderQuery {
  return {
    sportCode: "NCAAF",
    leagueCode: "ncaaf",
    providerLeagueId: "FBS",
    season: "2030",
    seasonType: "regular",
    week: 1,
    division: "FBS",
    from: "2030-08-31",
    to: "2030-08-31",
    timezone: "America/New_York",
    ...input,
  };
}

describe("CBS configuration and refresh policy", () => {
  it("fails closed and caps every configurable safety value", () => {
    expect(parseCbsCollegeFootballConfig(undefined)).toMatchObject({
      enabled: false,
      autoRefreshEnabled: false,
      activeSeason: null,
      activeSeasonType: null,
      activeWeek: null,
      activeWeekStartsAtUtc: null,
      division: "FBS",
      minimumRefreshMinutes: 120,
      defaultRefreshMinutes: 180,
      maximumRefreshMinutes: 240,
      globalDailyRequestLimit: 12,
    });
    expect(parseCbsCollegeFootballConfig({
      enabled: true,
      autoRefreshEnabled: true,
      globalDailyRequestLimit: 99,
      minimumRefreshMinutes: 1,
      maximumRefreshMinutes: 10_000,
    })).toMatchObject({
      enabled: true,
      autoRefreshEnabled: false,
      minimumRefreshMinutes: 120,
      defaultRefreshMinutes: 180,
      maximumRefreshMinutes: 240,
      globalDailyRequestLimit: 12,
    });
    expect(parseCbsCollegeFootballConfig({
      minimumRefreshMinutes: 240,
    })).toMatchObject({
      minimumRefreshMinutes: 240,
      defaultRefreshMinutes: 240,
      maximumRefreshMinutes: 240,
    });
    expect(parseCbsCollegeFootballConfig({
      maximumRefreshMinutes: 120,
    })).toMatchObject({
      minimumRefreshMinutes: 120,
      defaultRefreshMinutes: 120,
      maximumRefreshMinutes: 120,
    });
    expect(parseCbsCollegeFootballConfig({
      activeWeekStartsAtUtc: "2030-09-01T00:00:00.000Z",
    }).activeWeekStartsAtUtc).toEqual(
      new Date("2030-09-01T00:00:00.000Z"),
    );
    expect(parseCbsCollegeFootballConfig({
      activeWeekStartsAtUtc: "not-a-timestamp",
    }).activeWeekStartsAtUtc).toBeNull();
  });

  it("accepts only FBS seasons 2000-2100 and weeks 0-25", () => {
    expect(validateCbsCollegeFootballScheduleInput({
      season: 2000,
      seasonType: "postseason",
      week: 0,
      division: "FBS",
    })).toMatchObject({season: 2000, week: 0});
    expect(cbsCollegeFootballCacheDocumentId(SCHEDULE)).toBe(
      "cbs_ncaaf_FBS_2030_regular_1",
    );
    expect(() => validateCbsCollegeFootballScheduleInput({
      ...SCHEDULE,
      week: 26,
    })).toThrow();
    expect(() => validateCbsCollegeFootballScheduleInput({
      ...SCHEDULE,
      division: "FCS",
    })).toThrow();
  });

  it("uses two, three, and four hours and stops terminal schedules", () => {
    expect(cbsCollegeFootballRefreshMinutes({
      games: [game({kickoff: "2030-08-29T11:00:00Z"})],
      schedule: SCHEDULE,
      config: ENABLED_CONFIG,
      now: NOW,
    })).toBe(120);
    expect(cbsCollegeFootballRefreshMinutes({
      games: [game({kickoff: "2030-09-05T12:00:00Z"})],
      schedule: SCHEDULE,
      config: {
        ...ENABLED_CONFIG,
        activeWeekStartsAtUtc: new Date("2030-09-01T00:00:00.000Z"),
      },
      now: NOW,
    })).toBe(240);
    expect(cbsCollegeFootballRefreshMinutes({
      games: [game({kickoff: "2030-09-05T12:00:00Z"})],
      schedule: SCHEDULE,
      config: ENABLED_CONFIG,
      now: NOW,
    })).toBe(180);
    const finals = [game({status: "final", homeScore: 24, awayScore: 17})];
    expect(isCbsTerminalSchedule(finals)).toBe(true);
    expect(cbsCollegeFootballRefreshMinutes({
      games: finals,
      schedule: SCHEDULE,
      config: ENABLED_CONFIG,
      now: NOW,
    })).toBeNull();
  });

  it("resolves only one enabled, fully configured active schedule", async () => {
    expect(activeCbsCollegeFootballScheduleInput(ENABLED_CONFIG)).toEqual(
      SCHEDULE,
    );
    const disabled = parseCbsCollegeFootballConfig({enabled: false});
    expect(activeCbsCollegeFootballScheduleInput(disabled)).toBeNull();
    const disabledStore = new MemoryCbsStore(disabled);
    const fetchImpl = mockedFetch(async () => {
      throw new Error("inactive scheduler must not fetch");
    });
    await expect(refreshActiveCbsCollegeFootballSchedule({
      store: disabledStore,
      fetchImpl,
      clock: () => NOW,
      logger: QUIET_LOGGER,
    })).resolves.toBeNull();
    expect(disabledStore.readCount).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("CBS safe HTTP client", () => {
  it("uses stable honest headers, conditionals, timeout, and manual redirects", async () => {
    let capturedInit: RequestInit | undefined;
    const authorizeRequest = vi.fn(async () => undefined);
    const fetchImpl = mockedFetch(async (_url, init) => {
      capturedInit = init;
      return new Response(oneGameHtml(), {
        status: 200,
        headers: {
          etag: '"new"',
          "last-modified": "Wed, 28 Aug 2030 12:00:00 GMT",
        },
      });
    });
    const result = await fetchCbsCollegeFootballScoreboard({
      url: cacheRecord().sourceUrl,
      etag: '"old"',
      lastModified: "Wed, 28 Aug 2030 10:00:00 GMT",
      authorizeRequest,
      fetchImpl,
    });
    expect(result).toMatchObject({kind: "modified", requestCount: 1});
    expect(authorizeRequest).toHaveBeenCalledTimes(1);
    expect(capturedInit?.redirect).toBe("manual");
    expect(capturedInit?.signal).toBeDefined();
    expect(new Headers(capturedInit?.headers).get("user-agent")).toBe(
      CBS_USER_AGENT,
    );
    expect(new Headers(capturedInit?.headers).get("if-none-match")).toBe(
      '"old"',
    );
  });

  it("counts each same-host redirect and rejects any escaped host", async () => {
    const authorizeRequest = vi.fn(async () => undefined);
    let calls = 0;
    const fetchImpl = mockedFetch(async () => {
      calls += 1;
      return calls === 1
        ? new Response(null, {
            status: 302,
            headers: {location: cacheRecord().sourceUrl},
          })
        : new Response(oneGameHtml());
    });
    const result = await fetchCbsCollegeFootballScoreboard({
      url: cacheRecord().sourceUrl,
      etag: null,
      lastModified: null,
      authorizeRequest,
      fetchImpl,
    });
    expect(result.requestCount).toBe(2);
    expect(authorizeRequest).toHaveBeenCalledTimes(2);

    await expect(fetchCbsCollegeFootballScoreboard({
      url: cacheRecord().sourceUrl,
      etag: null,
      lastModified: null,
      authorizeRequest: async () => undefined,
      fetchImpl: mockedFetch(async () => new Response(null, {
        status: 302,
        headers: {location: "https://evil.example/scoreboard/"},
      })),
    })).rejects.toMatchObject({safeCode: "CBS_REDIRECT_REJECTED"});
    await expect(fetchCbsCollegeFootballScoreboard({
      url: cacheRecord().sourceUrl,
      etag: null,
      lastModified: null,
      authorizeRequest: async () => undefined,
      fetchImpl: mockedFetch(async () => new Response(null, {
        status: 302,
        headers: {
          location:
            "https://www.cbssports.com/college-football/scoreboard/FBS/2030/regular/2/",
        },
      })),
    })).rejects.toMatchObject({safeCode: "CBS_REDIRECT_REJECTED"});
    expect(() => validateCbsCollegeFootballRequestUrl(
      `${cacheRecord().sourceUrl}?week=2`,
    )).toThrow();
  });

  it("retries only a timeout or 5xx once and authorizes each attempt", async () => {
    const sleep = vi.fn(async () => undefined);
    const authorizeTimeout = vi.fn(async () => undefined);
    const timeoutFetch = mockedFetch(async () => {
      const error = new Error("timeout");
      error.name = "TimeoutError";
      throw error;
    });
    await expect(fetchCbsCollegeFootballScoreboard({
      url: cacheRecord().sourceUrl,
      etag: null,
      lastModified: null,
      authorizeRequest: authorizeTimeout,
      fetchImpl: timeoutFetch,
      sleep,
      random: () => 0,
    })).rejects.toMatchObject({safeCode: "CBS_REQUEST_TIMEOUT"});
    expect(timeoutFetch).toHaveBeenCalledTimes(2);
    expect(authorizeTimeout).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);

    const retryAfterSleep = vi.fn(async () => undefined);
    const retryAfterFetch = mockedFetch(async () => new Response("busy", {
      status: 503,
      headers: {"retry-after": "1"},
    }));
    await expect(fetchCbsCollegeFootballScoreboard({
      url: cacheRecord().sourceUrl,
      etag: null,
      lastModified: null,
      authorizeRequest: async () => undefined,
      fetchImpl: retryAfterFetch,
      sleep: retryAfterSleep,
      clock: () => NOW,
      random: () => 0,
    })).rejects.toMatchObject({safeCode: "CBS_HTTP_UPSTREAM"});
    expect(retryAfterFetch).toHaveBeenCalledTimes(1);
    expect(retryAfterSleep).not.toHaveBeenCalled();

    const upstreamSleep = vi.fn(async () => undefined);
    const upstreamFetch = mockedFetch(async () => new Response("busy", {
      status: 503,
    }));
    await expect(fetchCbsCollegeFootballScoreboard({
      url: cacheRecord().sourceUrl,
      etag: null,
      lastModified: null,
      authorizeRequest: async () => undefined,
      fetchImpl: upstreamFetch,
      sleep: upstreamSleep,
      clock: () => NOW,
      random: () => 0,
    })).rejects.toMatchObject({safeCode: "CBS_HTTP_UPSTREAM"});
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
    expect(upstreamSleep).toHaveBeenCalledWith(250);

    const authorizeNetwork = vi.fn(async () => undefined);
    const networkFetch = mockedFetch(async () => {
      throw new Error("connection reset");
    });
    await expect(fetchCbsCollegeFootballScoreboard({
      url: cacheRecord().sourceUrl,
      etag: null,
      lastModified: null,
      authorizeRequest: authorizeNetwork,
      fetchImpl: networkFetch,
    })).rejects.toMatchObject({safeCode: "CBS_NETWORK_ERROR"});
    expect(networkFetch).toHaveBeenCalledTimes(1);
    expect(authorizeNetwork).toHaveBeenCalledTimes(1);
  });

  it("does not retry 403, 404, 429, or challenge pages and opens restrictions for six hours", async () => {
    for (const status of [403, 404, 429]) {
      const authorizeRequest = vi.fn(async () => undefined);
      const fetchImpl = mockedFetch(async () => new Response("blocked", {
        status,
        headers: status === 429 ? {"retry-after": "28800"} : {},
      }));
      let caught: unknown;
      try {
        await fetchCbsCollegeFootballScoreboard({
          url: cacheRecord().sourceUrl,
          etag: null,
          lastModified: null,
          authorizeRequest,
          fetchImpl,
          clock: () => NOW,
        });
      } catch (error: unknown) {
        caught = error;
      }
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(authorizeRequest).toHaveBeenCalledTimes(1);
      expect(caught).toBeInstanceOf(CbsCollegeFootballRequestError);
      if (status !== 404) {
        expect(
          (caught as CbsCollegeFootballRequestError)
            .circuitOpenUntil?.valueOf(),
        ).toBeGreaterThanOrEqual(
          NOW.valueOf() + CBS_CIRCUIT_DURATION_MS,
        );
      }
    }

    const challengeFetch = mockedFetch(async () =>
      new Response("<html>Verify you are human CAPTCHA</html>"));
    await expect(fetchCbsCollegeFootballScoreboard({
      url: cacheRecord().sourceUrl,
      etag: null,
      lastModified: null,
      authorizeRequest: async () => undefined,
      fetchImpl: challengeFetch,
      clock: () => NOW,
    })).rejects.toMatchObject({
      safeCode: "CBS_CHALLENGE_PAGE",
      circuitOpenUntil: new Date(NOW.valueOf() + CBS_CIRCUIT_DURATION_MS),
    });
    expect(challengeFetch).toHaveBeenCalledTimes(1);
  });

  it("does not mistake a scoreboard CAPTCHA asset marker for a challenge page", async () => {
    const scoreboardHtml = [
      "<html><head>",
      "<title>2026 NCAA Football Scores - FBS - Week 1 - CBS Sports</title>",
      "<script src='/assets/captcha-telemetry.js'></script>",
      "</head><body><div class='single-score-card'></div></body></html>",
    ].join("");
    const fetchImpl = mockedFetch(async () => new Response(scoreboardHtml));
    const result = await fetchCbsCollegeFootballScoreboard({
      url: cacheRecord().sourceUrl,
      etag: null,
      lastModified: null,
      authorizeRequest: async () => undefined,
      fetchImpl,
      clock: () => NOW,
    });
    expect(result).toMatchObject({
      kind: "modified",
      status: 200,
      html: scoreboardHtml,
      requestCount: 1,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("enforces the five-megabyte streaming/declared-size limit", async () => {
    await expect(fetchCbsCollegeFootballScoreboard({
      url: cacheRecord().sourceUrl,
      etag: null,
      lastModified: null,
      authorizeRequest: async () => undefined,
      fetchImpl: mockedFetch(async () => new Response("small", {
        headers: {
          "content-length": String(CBS_MAXIMUM_RESPONSE_BYTES + 1),
        },
      })),
    })).rejects.toMatchObject({safeCode: "CBS_HTTP_TOO_LARGE"});
  });
});

describe("CBS shared schedule cache coordinator", () => {
  it("makes zero requests for a fresh cache", async () => {
    const store = new MemoryCbsStore(ENABLED_CONFIG, cacheRecord());
    const fetchImpl = mockedFetch(async () => {
      throw new Error("fresh cache must not fetch");
    });
    const result = await loadCbsCollegeFootballSchedule(
      SCHEDULE,
      {},
      {store, fetchImpl, clock: () => NOW, logger: QUIET_LOGGER},
    );
    expect(result).toMatchObject({
      cacheHit: true,
      stale: false,
      delayed: false,
      cacheStatus: "fresh",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.reserveCount).toBe(0);
    expect(store.acquireCount).toBe(0);
  });

  it("refreshes one stale week page and never stores HTML", async () => {
    const stale = cacheRecord({
      nextRefreshAt: new Date(NOW.valueOf() - 1),
      lastSuccessfulFetchAt: new Date(NOW.valueOf() - 3 * 60 * 60_000),
    });
    const futureWeekConfig = {
      ...ENABLED_CONFIG,
      activeWeekStartsAtUtc: new Date(NOW.valueOf() + 24 * 60 * 60_000),
    };
    const store = new MemoryCbsStore(futureWeekConfig, stale);
    const fetchImpl = mockedFetch(async () => new Response(oneGameHtml(), {
      headers: {etag: '"updated"'},
    }));
    const result = await loadCbsCollegeFootballSchedule(
      SCHEDULE,
      {},
      {store, fetchImpl, clock: () => NOW, logger: QUIET_LOGGER},
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.reserveCount).toBe(1);
    expect(store.gameWriteCount).toBe(1);
    expect(store.releaseCount).toBe(1);
    expect(result).toMatchObject({
      cacheStatus: "refreshed",
      stale: false,
      delayed: false,
      nextRefreshAt: new Date(NOW.valueOf() + 240 * 60_000),
    });
    expect(JSON.stringify([...store.caches.values()]))
      .not.toContain("single-score-card");
    expect(Object.keys(store.successInputs[0] ?? {})).not.toContain("html");
  });

  it("handles 304 and unchanged content without rewriting games", async () => {
    const parsedGames = parseCbsCollegeFootballScoreboardHtml(
      oneGameHtml(),
      {...SCHEDULE, observedAt: NOW},
    ).games;
    for (const response of [
      new Response(null, {status: 304, headers: {etag: '"same"'}}),
      new Response(oneGameHtml()),
    ]) {
      const stale = cacheRecord({
        games: parsedGames,
        nextRefreshAt: new Date(NOW.valueOf() - 1),
        lastSuccessfulFetchAt: new Date(NOW.valueOf() - 3 * 60 * 60_000),
      });
      const store = new MemoryCbsStore(ENABLED_CONFIG, stale);
      const result = await loadCbsCollegeFootballSchedule(
        SCHEDULE,
        {},
        {
          store,
          fetchImpl: mockedFetch(async () => response),
          clock: () => NOW,
          logger: QUIET_LOGGER,
        },
      );
      expect(store.gameWriteCount).toBe(0);
      expect(store.successInputs[0]?.games).toBeNull();
      expect(result.games[0]?.providerGameId).toBe("game-1");
      expect(result.nextRefreshAt?.valueOf()).toBeGreaterThan(NOW.valueOf());
    }
  });

  it("reparses unconditionally before adopting a new parser version", async () => {
    const oldParserCache = cacheRecord({
      parserVersion: "old-v1",
      nextRefreshAt: new Date(NOW.valueOf() + 60 * 60_000),
      lastSuccessfulFetchAt: new Date(NOW.valueOf() - 3 * 60 * 60_000),
    });
    const store = new MemoryCbsStore(ENABLED_CONFIG, oldParserCache);
    let headers = new Headers();
    const fetchImpl = mockedFetch(async (_url, init) => {
      headers = new Headers(init.headers);
      return new Response(oneGameHtml());
    });
    const result = await loadCbsCollegeFootballSchedule(
      SCHEDULE,
      {},
      {store, fetchImpl, clock: () => NOW, logger: QUIET_LOGGER},
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(headers.has("if-none-match")).toBe(false);
    expect(headers.has("if-modified-since")).toBe(false);
    expect(result).toMatchObject({stale: false, delayed: false});
    expect(store.successInputs[0]?.parserVersion).toBe("test-v1");

    const notModifiedStore = new MemoryCbsStore(
      ENABLED_CONFIG,
      oldParserCache,
    );
    const notModified = await loadCbsCollegeFootballSchedule(
      SCHEDULE,
      {},
      {
        store: notModifiedStore,
        fetchImpl: mockedFetch(async () => new Response(null, {status: 304})),
        clock: () => NOW,
        logger: QUIET_LOGGER,
      },
    );
    expect(notModified).toMatchObject({stale: true, delayed: true});
    expect(notModifiedStore.successInputs).toHaveLength(0);
    expect(notModifiedStore.failureInputs[0]?.errorCode).toBe(
      "CBS_PARSE_REVALIDATION_REQUIRED",
    );
    expect(notModifiedStore.caches.values().next().value?.parserVersion).toBe(
      "old-v1",
    );

    const secondAttemptAt = new Date(NOW.valueOf() + 5 * 60 * 60_000);
    let secondHeaders = new Headers();
    const secondNotModified = await loadCbsCollegeFootballSchedule(
      SCHEDULE,
      {},
      {
        store: notModifiedStore,
        fetchImpl: mockedFetch(async (_url, init) => {
          secondHeaders = new Headers(init.headers);
          return new Response(null, {status: 304});
        }),
        clock: () => secondAttemptAt,
        logger: QUIET_LOGGER,
      },
    );
    expect(secondHeaders.has("if-none-match")).toBe(false);
    expect(secondHeaders.has("if-modified-since")).toBe(false);
    expect(secondNotModified).toMatchObject({stale: true, delayed: true});
    expect(notModifiedStore.successInputs).toHaveLength(0);
    expect(notModifiedStore.failureInputs).toHaveLength(2);
    expect(notModifiedStore.failureInputs[1]?.errorCode).toBe(
      "CBS_PARSE_REVALIDATION_REQUIRED",
    );
    expect(notModifiedStore.caches.values().next().value?.parserVersion).toBe(
      "old-v1",
    );
  });

  it("does not advance parserVersion in the Firestore failure transaction", async () => {
    type FakeReference = {path: string};
    type FakeSnapshot = {
      data(): Record<string, unknown> | undefined;
    };
    type FakeTransaction = {
      get(reference: FakeReference): Promise<FakeSnapshot>;
      set(reference: FakeReference, data: Record<string, unknown>): void;
    };
    const cacheId = cbsCollegeFootballCacheDocumentId(SCHEDULE);
    const storedGames = parseCbsCollegeFootballScoreboardHtml(
      oneGameHtml(),
      {...SCHEDULE, observedAt: NOW},
    ).games;
    const stored = {
      ...cacheRecord({games: storedGames, parserVersion: "old-v1"}),
      refreshState: "refreshing",
      refreshLeaseOwner: "lease-owner",
      refreshLeaseUntil: new Date(NOW.valueOf() + 90_000),
    } as unknown as Record<string, unknown>;
    const writes: Array<{
      reference: FakeReference;
      data: Record<string, unknown>;
    }> = [];
    const transaction: FakeTransaction = {
      get: async (reference) => ({
        data: () => reference.path === `${CBS_CACHE_COLLECTION}/${cacheId}`
          ? stored
          : {consecutiveFailures: 0},
      }),
      set: (reference, data) => {
        writes.push({reference, data});
      },
    };
    const fakeFirestore = {
      collection: (collection: string) => ({
        doc: (document: string): FakeReference => ({
          path: `${collection}/${document}`,
        }),
      }),
      runTransaction: async (
        operation: (value: FakeTransaction) => Promise<unknown>,
      ): Promise<unknown> => operation(transaction),
    } as unknown as Firestore;
    const store = new FirestoreCbsCollegeFootballStore(fakeFirestore);
    const recorded = await store.recordRefreshFailure({
      cacheId,
      leaseOwner: "lease-owner",
      now: NOW,
      errorCode: "CBS_PARSE_REVALIDATION_REQUIRED",
      httpStatus: 304,
      nextRefreshAt: new Date(NOW.valueOf() + 4 * 60 * 60_000),
      circuitOpenUntil: null,
      countsTowardCircuit: true,
    });
    expect(recorded?.parserVersion).toBe("old-v1");
    const cacheWrite = writes.find(
      (write) => write.reference.path === `${CBS_CACHE_COLLECTION}/${cacheId}`,
    );
    expect(cacheWrite?.data).not.toHaveProperty("parserVersion");
  });

  it("uses one lease/request for ten concurrent stale-cache callers", async () => {
    const stale = cacheRecord({
      nextRefreshAt: new Date(NOW.valueOf() - 1),
      lastSuccessfulFetchAt: new Date(NOW.valueOf() - 3 * 60 * 60_000),
    });
    const store = new MemoryCbsStore(ENABLED_CONFIG, stale);
    let releaseFetch: ((response: Response) => void) | undefined;
    const fetchResponse = new Promise<Response>((resolve) => {
      releaseFetch = resolve;
    });
    const fetchImpl = mockedFetch(async () => fetchResponse);
    const loads = Array.from({length: 10}, () =>
      loadCbsCollegeFootballSchedule(
        SCHEDULE,
        {},
        {store, fetchImpl, clock: () => NOW, logger: QUIET_LOGGER},
      ));
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
    releaseFetch?.(new Response(oneGameHtml()));
    const results = await Promise.all(loads);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.reserveCount).toBe(1);
    expect(results.filter((result) => result.cacheStatus === "refreshing"))
      .toHaveLength(9);
  });

  it("enforces production cooldown even for force and bypasses only in the emulator", async () => {
    for (const emulator of [false, true]) {
      const recent = cacheRecord({
        nextRefreshAt: new Date(NOW.valueOf() + 60 * 60_000),
        lastSuccessfulFetchAt: new Date(NOW.valueOf() - 30 * 60_000),
      });
      const store = new MemoryCbsStore(ENABLED_CONFIG, recent);
      const fetchImpl = mockedFetch(async () => new Response(oneGameHtml()));
      const result = await loadCbsCollegeFootballSchedule(
        SCHEDULE,
        {forceRefresh: true, refreshReason: "admin"},
        {store, fetchImpl, clock: () => NOW, emulator, logger: QUIET_LOGGER},
      );
      expect(fetchImpl).toHaveBeenCalledTimes(emulator ? 1 : 0);
      expect(result.delayed).toBe(false);
    }
  });

  it("applies production cooldown after a failed attempt, with emulator-only bypass", async () => {
    let current = NOW;
    const stale = cacheRecord({
      nextRefreshAt: new Date(NOW.valueOf() - 1),
      lastSuccessfulFetchAt: new Date(NOW.valueOf() - 3 * 60 * 60_000),
    });
    const store = new MemoryCbsStore(ENABLED_CONFIG, stale);
    let httpCalls = 0;
    const fetchImpl = mockedFetch(async () => {
      httpCalls += 1;
      return httpCalls <= 2
        ? new Response("upstream busy", {status: 503})
        : new Response(oneGameHtml());
    });
    const first = await loadCbsCollegeFootballSchedule(
      SCHEDULE,
      {},
      {
        store,
        fetchImpl,
        sleep: async () => undefined,
        clock: () => current,
        logger: QUIET_LOGGER,
      },
    );
    expect(first).toMatchObject({stale: true, delayed: true});
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    current = new Date(NOW.valueOf() + 30 * 60_000);
    const productionForce = await loadCbsCollegeFootballSchedule(
      SCHEDULE,
      {forceRefresh: true, refreshReason: "admin"},
      {
        store,
        fetchImpl,
        sleep: async () => undefined,
        clock: () => current,
        emulator: false,
        logger: QUIET_LOGGER,
      },
    );
    expect(productionForce).toMatchObject({stale: true, delayed: true});
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const emulatorForce = await loadCbsCollegeFootballSchedule(
      SCHEDULE,
      {forceRefresh: true, refreshReason: "admin"},
      {
        store,
        fetchImpl,
        sleep: async () => undefined,
        clock: () => current,
        emulator: true,
        logger: QUIET_LOGGER,
      },
    );
    expect(emulatorForce.stale).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("keeps failed last-good data stale throughout its request backoff", async () => {
    let current = NOW;
    const stale = cacheRecord({
      nextRefreshAt: new Date(NOW.valueOf() - 1),
      lastSuccessfulFetchAt: new Date(NOW.valueOf() - 3 * 60 * 60_000),
    });
    const store = new MemoryCbsStore(ENABLED_CONFIG, stale);
    const fetchImpl = mockedFetch(async () =>
      new Response("<main>redesigned markup</main>"));
    const first = await loadCbsCollegeFootballSchedule(
      SCHEDULE,
      {},
      {store, fetchImpl, clock: () => current, logger: QUIET_LOGGER},
    );
    expect(first).toMatchObject({stale: true, delayed: true});
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    current = new Date(NOW.valueOf() + 30 * 60_000);
    const second = await loadCbsCollegeFootballSchedule(
      SCHEDULE,
      {},
      {store, fetchImpl, clock: () => current, logger: QUIET_LOGGER},
    );
    expect(second).toMatchObject({
      cacheStatus: "stale",
      stale: true,
      delayed: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("honors a long 5xx Retry-After without retrying or allowing force", async () => {
    let current = NOW;
    const stale = cacheRecord({
      nextRefreshAt: new Date(NOW.valueOf() - 1),
      lastSuccessfulFetchAt: new Date(NOW.valueOf() - 3 * 60 * 60_000),
    });
    const store = new MemoryCbsStore(ENABLED_CONFIG, stale);
    const fetchImpl = mockedFetch(async () => new Response("maintenance", {
      status: 503,
      headers: {"retry-after": "28800"},
    }));
    const first = await loadCbsCollegeFootballSchedule(
      SCHEDULE,
      {},
      {
        store,
        fetchImpl,
        sleep: async () => undefined,
        clock: () => current,
        logger: QUIET_LOGGER,
      },
    );
    expect(first).toMatchObject({stale: true, delayed: true});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const metadata = store.metadata.get(
      cbsCollegeFootballCacheDocumentId(SCHEDULE),
    );
    expect(metadata?.circuitOpenUntil?.toISOString()).toBe(
      "2030-08-28T20:00:00.000Z",
    );

    current = new Date(NOW.valueOf() + 4 * 60 * 60_000);
    const forced = await loadCbsCollegeFootballSchedule(
      SCHEDULE,
      {forceRefresh: true, refreshReason: "admin"},
      {
        store,
        fetchImpl,
        clock: () => current,
        emulator: true,
        logger: QUIET_LOGGER,
      },
    );
    expect(forced).toMatchObject({stale: true, delayed: true});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("suppresses every week behind one provider-wide access circuit", async () => {
    const stale = cacheRecord({
      nextRefreshAt: new Date(NOW.valueOf() - 1),
      lastSuccessfulFetchAt: new Date(NOW.valueOf() - 3 * 60 * 60_000),
    });
    const store = new MemoryCbsStore(ENABLED_CONFIG, stale);
    const fetchImpl = mockedFetch(async () =>
      new Response("restricted", {
        status: 403,
        headers: {"retry-after": "9007199254740991"},
      }));
    const first = await loadCbsCollegeFootballSchedule(
      SCHEDULE,
      {},
      {store, fetchImpl, clock: () => NOW, logger: QUIET_LOGGER},
    );
    expect(first).toMatchObject({stale: true, delayed: true});
    expect(store.providerCircuitOpenUntil?.valueOf()).toBe(
      NOW.valueOf() + CBS_CIRCUIT_DURATION_MS,
    );

    await expect(loadCbsCollegeFootballSchedule(
      {...SCHEDULE, week: 2},
      {},
      {
        store,
        fetchImpl,
        clock: () => NOW,
        configuration: {...ENABLED_CONFIG, activeWeek: 2},
        logger: QUIET_LOGGER,
      },
    )).rejects.toMatchObject({code: "unavailable"});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.failureInputs.at(-1)).toMatchObject({
      errorCode: "CBS_PROVIDER_CIRCUIT_OPEN",
      countsTowardCircuit: false,
    });
  });

  it("opens the provider-wide circuit after failures across three weeks", async () => {
    let current = NOW;
    const store = new MemoryCbsStore(ENABLED_CONFIG);
    const fetchImpl = mockedFetch(async () => {
      throw new Error("network unavailable");
    });
    for (const week of [3, 4, 5]) {
      await expect(loadCbsCollegeFootballSchedule(
        {...SCHEDULE, week},
        {},
        {
          store,
          fetchImpl,
          clock: () => current,
          configuration: {...ENABLED_CONFIG, activeWeek: week},
          logger: QUIET_LOGGER,
        },
      )).rejects.toMatchObject({code: "unavailable"});
      current = new Date(current.valueOf() + 3 * 60 * 60_000);
    }
    expect(store.providerConsecutiveFailures).toBe(3);
    expect(store.providerCircuitOpenUntil?.valueOf()).toBeGreaterThan(
      current.valueOf(),
    );
    await expect(loadCbsCollegeFootballSchedule(
      {...SCHEDULE, week: 6},
      {},
      {
        store,
        fetchImpl,
        clock: () => current,
        configuration: {...ENABLED_CONFIG, activeWeek: 6},
        logger: QUIET_LOGGER,
      },
    )).rejects.toMatchObject({code: "unavailable"});
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("reserves every retry and stops before network at the rolling-24h cap", async () => {
    const stale = cacheRecord({
      nextRefreshAt: new Date(NOW.valueOf() - 1),
      lastSuccessfulFetchAt: new Date(NOW.valueOf() - 3 * 60 * 60_000),
    });
    const retryStore = new MemoryCbsStore(ENABLED_CONFIG, stale);
    const timeoutFetch = mockedFetch(async () => {
      const error = new Error("timeout");
      error.name = "AbortError";
      throw error;
    });
    const retryResult = await loadCbsCollegeFootballSchedule(
      SCHEDULE,
      {},
      {
        store: retryStore,
        fetchImpl: timeoutFetch,
        sleep: async () => undefined,
        clock: () => NOW,
        logger: QUIET_LOGGER,
      },
    );
    expect(timeoutFetch).toHaveBeenCalledTimes(2);
    expect(retryStore.reservations).toHaveLength(2);
    expect(retryResult).toMatchObject({stale: true, delayed: true});

    const cappedStore = new MemoryCbsStore(ENABLED_CONFIG, stale);
    cappedStore.reservations.push(
      ...Array.from({length: 12}, () => new Date(NOW.valueOf() - 60_000)),
    );
    const cappedFetch = mockedFetch(async () => new Response(oneGameHtml()));
    const cappedResult = await loadCbsCollegeFootballSchedule(
      SCHEDULE,
      {},
      {
        store: cappedStore,
        fetchImpl: cappedFetch,
        clock: () => NOW,
        logger: QUIET_LOGGER,
      },
    );
    expect(cappedFetch).not.toHaveBeenCalled();
    expect(cappedStore.failureInputs[0]?.errorCode).toBe(
      "CBS_DAILY_REQUEST_LIMIT_REACHED",
    );
    expect(cappedStore.failureInputs[0]?.countsTowardCircuit).toBe(false);
    expect(cappedStore.metadata.get(
      cbsCollegeFootballCacheDocumentId(SCHEDULE),
    )?.failures).toBe(0);
    expect(cappedResult).toMatchObject({stale: true, delayed: true});
  });

  it("retains last-good games for parser drift and opens after three failures", async () => {
    let current = NOW;
    const stale = cacheRecord({
      nextRefreshAt: new Date(NOW.valueOf() - 1),
      lastSuccessfulFetchAt: new Date(NOW.valueOf() - 3 * 60 * 60_000),
    });
    const store = new MemoryCbsStore(ENABLED_CONFIG, stale);
    const fetchImpl = mockedFetch(async () =>
      new Response("<main>redesigned markup</main>"));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = store.metadata.get(cbsCollegeFootballCacheDocumentId(
        SCHEDULE,
      ));
      if (state !== undefined) {
        state.nextRefreshAt = new Date(current.valueOf() - 1);
        state.lastSuccessfulFetchAt = new Date(current.valueOf() - 3 * 60 * 60_000);
      }
      const result = await loadCbsCollegeFootballSchedule(
        SCHEDULE,
        {},
        {store, fetchImpl, clock: () => current, logger: QUIET_LOGGER},
      );
      expect(result.games[0]?.providerGameId).toBe("game-1");
      expect(result).toMatchObject({stale: true, delayed: true});
      current = new Date(current.valueOf() + 5 * 60 * 60_000);
    }
    expect(store.gameWriteCount).toBe(0);
    expect(store.failureInputs).toHaveLength(3);
    const metadata = store.metadata.get(
      cbsCollegeFootballCacheDocumentId(SCHEDULE),
    );
    expect(metadata?.circuitOpenUntil?.valueOf()).toBeGreaterThan(
      current.valueOf(),
    );
  });

  it("rejects an unexplained nonempty shrink after selector drift", async () => {
    const previousGames = [game(), game({
      id: "game-2",
      kickoff: "2030-09-01T20:00:00Z",
      day: "2030-09-01",
    })];
    const stale = cacheRecord({
      games: previousGames,
      nextRefreshAt: new Date(NOW.valueOf() - 1),
      lastSuccessfulFetchAt: new Date(NOW.valueOf() - 3 * 60 * 60_000),
    });
    const store = new MemoryCbsStore(ENABLED_CONFIG, stale);
    const redesignedResidue = `${oneGameHtml()}
      <section data-redesigned-scoreboard-card="game-2">
        Second Away at Second Home
      </section>`;
    const result = await loadCbsCollegeFootballSchedule(
      SCHEDULE,
      {},
      {
        store,
        fetchImpl: mockedFetch(async () => new Response(redesignedResidue)),
        clock: () => NOW,
        logger: QUIET_LOGGER,
      },
    );
    expect(result.games.map((item) => item.providerGameId)).toEqual([
      "game-1",
      "game-2",
    ]);
    expect(result).toMatchObject({stale: true, delayed: true});
    expect(store.gameWriteCount).toBe(0);
    expect(store.failureInputs[0]?.errorCode).toBe(
      "CBS_PARSE_SUSPICIOUS_SHRINK",
    );
  });

  it("never overwrites a week when the response identity does not match", async () => {
    const stale = cacheRecord({
      nextRefreshAt: new Date(NOW.valueOf() - 1),
      lastSuccessfulFetchAt: new Date(NOW.valueOf() - 3 * 60 * 60_000),
    });
    const store = new MemoryCbsStore(ENABLED_CONFIG, stale);
    const mismatched = oneGameHtml().replace("Week 1", "Week 2");
    const result = await loadCbsCollegeFootballSchedule(
      SCHEDULE,
      {},
      {
        store,
        fetchImpl: mockedFetch(async () => new Response(mismatched)),
        clock: () => NOW,
        logger: QUIET_LOGGER,
      },
    );
    expect(result.games[0]?.providerGameId).toBe("game-1");
    expect(result).toMatchObject({stale: true, delayed: true});
    expect(store.gameWriteCount).toBe(0);
    expect(store.failureInputs[0]?.errorCode).toBe(
      "CBS_PARSE_IDENTITY_MISMATCH",
    );
  });

  it("returns stale data behind the kill switch and a safe error without cache", async () => {
    const disabled = parseCbsCollegeFootballConfig({enabled: false});
    const withCache = await loadCbsCollegeFootballSchedule(
      SCHEDULE,
      {},
      {
        store: new MemoryCbsStore(disabled, cacheRecord()),
        fetchImpl: mockedFetch(async () => {
          throw new Error("disabled must not fetch");
        }),
        clock: () => NOW,
        logger: QUIET_LOGGER,
      },
    );
    expect(withCache).toMatchObject({stale: true, delayed: true});
    await expect(loadCbsCollegeFootballSchedule(
      SCHEDULE,
      {},
      {
        store: new MemoryCbsStore(disabled),
        fetchImpl: mockedFetch(async () => {
          throw new Error("disabled must not fetch");
        }),
        clock: () => NOW,
        logger: QUIET_LOGGER,
      },
    )).rejects.toMatchObject({code: "unavailable"});
  });

  it("serializes only normalized games and ISO cache metadata", async () => {
    const result = await loadCbsCollegeFootballSchedule(
      SCHEDULE,
      {},
      {
        store: new MemoryCbsStore(ENABLED_CONFIG, cacheRecord()),
        fetchImpl: mockedFetch(async () => {
          throw new Error("fresh serializer fixture must not fetch");
        }),
        clock: () => NOW,
        logger: QUIET_LOGGER,
      },
    );
    expect(serializeCbsCollegeFootballScheduleResponse(result)).toMatchObject({
      success: true,
      source: "cbsSports",
      season: 2030,
      cache: {
        status: "fresh",
        fetchedAt: expect.stringMatching(/^2030-/),
        isStale: false,
      },
      games: [{scheduledAtUtc: "2030-08-31T16:00:00.000Z"}],
    });
  });
});

describe("CBS SportsDataProvider adapter", () => {
  it("advertises only the configured active FBS week", async () => {
    const provider = new CbsCollegeFootballProvider(ENABLED_CONFIG);
    await expect(provider.listSupportedSports()).resolves.toEqual(["NCAAF"]);
    await expect(provider.listLeagues()).resolves.toEqual([{
      code: "ncaaf",
      name: "NCAA FBS College Football",
      sportCode: "NCAAF",
      providerLeagueId: "FBS",
      season: "2030",
      seasonType: "regular",
      week: 1,
      division: "FBS",
    }]);
    expect(provider.presentation).toMatchObject({
      provider: "cbsSports",
      allowRemoteLogos: true,
      allowedLogoHosts: [
        "sports.cbsimg.net",
        "sportshub.cbsistatic.com",
      ],
      allowedLogoQueryParameters: [],
      logoRightsReviewDate: "2026-08-25",
    });
  });

  it("keeps the configured week discoverable when fetching is disabled", async () => {
    const provider = new CbsCollegeFootballProvider({
      ...ENABLED_CONFIG,
      enabled: false,
      autoRefreshEnabled: false,
    });

    await expect(provider.listSupportedSports()).resolves.toEqual(["NCAAF"]);
    await expect(provider.listLeagues()).resolves.toMatchObject([{
      sportCode: "NCAAF",
      providerLeagueId: "FBS",
      season: "2030",
      seasonType: "regular",
      week: 1,
    }]);
  });

  it("loads one cached week across date filters and selected-game refreshes", async () => {
    const store = new MemoryCbsStore(ENABLED_CONFIG);
    const fetchImpl = mockedFetch(async () => new Response(twoGameHtml()));
    const provider = new CbsCollegeFootballProvider(ENABLED_CONFIG, {
      dependencies: {
        store,
        fetchImpl,
        clock: () => NOW,
        logger: QUIET_LOGGER,
      },
    });
    const saturday = await provider.listGamesCached(query());
    const sunday = await provider.listGamesCached(query({
      from: "2030-09-01",
      to: "2030-09-01",
    }));
    const selected = await provider.fetchGamesCached(
      ["game-2", "missing-game"],
      query({from: "2030-09-01", to: "2030-09-01"}),
    );
    const gatewaySelected = await fetchGamesByIdsWithCache(
      provider,
      ["game-2", "missing-game"],
      query({from: "2030-09-01", to: "2030-09-01"}),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(saturday.games.map((item) => item.providerGameId)).toEqual([
      "game-1",
    ]);
    expect(sunday.games.map((item) => item.providerGameId)).toEqual([
      "game-2",
    ]);
    expect(selected.games.map((item) => item.providerGameId)).toEqual([
      "game-2",
    ]);
    expect(gatewaySelected.games.map((item) => item.providerGameId)).toEqual([
      "game-2",
    ]);
    expect(gatewaySelected.delayed).toBe(true);
    expect(provider.selectedGameRefreshMode).toBe("partial");
    expect(provider.selectedGameRefreshMaximumIds).toBe(500);
  });

  it("serves a historical cached week without contacting CBS", async () => {
    const activeWeekTwo = {...ENABLED_CONFIG, activeWeek: 2};
    const historical = cacheRecord();
    const store = new MemoryCbsStore(activeWeekTwo, historical);
    const fetchImpl = mockedFetch(async () => {
      throw new Error("historical week must remain cache-only");
    });
    const provider = new CbsCollegeFootballProvider(activeWeekTwo, {
      dependencies: {
        store,
        fetchImpl,
        clock: () => NOW,
        logger: QUIET_LOGGER,
      },
    });
    const result = await provider.listGamesCached(query());
    expect(result.games.map((item) => item.providerGameId)).toEqual([
      "game-1",
    ]);
    expect(result).toMatchObject({stale: true, delayed: true});
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.acquireCount).toBe(0);
    expect(store.reserveCount).toBe(0);
  });

  it("rejects any non-NCAAF/FBS context before loading", async () => {
    const loadSchedule = vi.fn();
    const provider = new CbsCollegeFootballProvider(ENABLED_CONFIG, {
      loadSchedule,
    });
    await expect(provider.listGames(query({sportCode: "football"})))
      .rejects.toMatchObject({code: "failed-precondition"});
    expect(loadSchedule).not.toHaveBeenCalled();
  });
});
