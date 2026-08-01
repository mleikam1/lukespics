import {readFileSync} from "node:fs";
import {describe, expect, it, vi} from "vitest";
import {ProviderRetryAuthorizationError} from "../src/providers/retry.js";
import {
  assertSportsDataIoProductionReady,
  parseSportsDataIoCatalog,
  SportsDataIoProvider,
} from "../src/providers/sportsDataIo.js";
import {
  formatSportsDataIoDate,
  isSportsDataIoMlbSeason,
  isSportsDataIoNflSeason,
  resolveSportsDataIoUrl,
  SPORTSDATAIO_KEY_CONFIGURATION_MESSAGE,
  SPORTSDATAIO_KEY_CONFIGURATION_REASON,
  SPORTSDATAIO_CREDENTIALS_CONFIGURATION_MESSAGE,
  SPORTSDATAIO_CREDENTIALS_CONFIGURATION_REASON,
  SPORTSDATAIO_ENTITLEMENT_CONFIGURATION_MESSAGE,
  SPORTSDATAIO_ENTITLEMENT_CONFIGURATION_REASON,
  SportsDataIoClient,
} from "../src/providers/sportsDataIoClient.js";
import {
  createSportsDataIoMlbCaches,
  mapSportsDataIoMlbStatus,
  normalizeSportsDataIoMlbGame,
  normalizeSportsDataIoMlbTeam,
} from "../src/providers/sportsDataIoMlb.js";
import {
  createSportsDataIoNflCaches,
  mapSportsDataIoNflStatus,
  normalizeSportsDataIoNflTeam,
} from "../src/providers/sportsDataIoNfl.js";
import type {ProviderQuery, Team} from "../src/types.js";

const nflTeams = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/sportsdataio-nfl-teams.sanitized.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as unknown[];
const nflSchedule = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/sportsdataio-nfl-schedule.sanitized.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as unknown[];
const nflScores = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/sportsdataio-nfl-scores.sanitized.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as unknown[];
const mlbTeams = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/sportsdataio-mlb-teams.sanitized.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as unknown[];
const mlbGames = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/sportsdataio-mlb-games.sanitized.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as unknown[];

const fixtureCatalogInput = {
  enabled: true,
  accessMode: "fixture",
  revision: "fixture-v1",
  entitlementVerified: false,
  entitlementReference: null,
  entitlementReviewedAt: null,
  leagues: [
    {
      code: "nfl",
      enabled: true,
      season: "2031REG",
      entitlements: {teams: true, schedules: true, liveAndFinal: true},
    },
    {
      code: "mlb",
      enabled: true,
      season: "2031",
      entitlements: {teams: true, schedules: true, liveAndFinal: true},
    },
  ],
} as const;

const nflQuery: ProviderQuery = {
  sportCode: "football",
  leagueCode: "nfl",
  providerLeagueId: "nfl",
  season: "2031REG",
  from: "2031-11-02",
  to: "2031-11-02",
  timezone: "America/New_York",
};

const mlbQuery: ProviderQuery = {
  sportCode: "baseball",
  leagueCode: "mlb",
  providerLeagueId: "mlb",
  season: "2031",
  from: "2031-06-10",
  to: "2031-06-10",
  timezone: "America/New_York",
};

type FixtureProviderOptions = {
  catalogInput?: unknown;
  nflScorePayload?: unknown;
  nflScorePayloadsByPath?: Readonly<Record<string, unknown>>;
  mlbGamePayload?: unknown;
  nflSchedulePayload?: unknown;
  calls?: string[];
  requestInits?: RequestInit[];
};

function fixtureProvider(options: FixtureProviderOptions = {}): SportsDataIoProvider {
  const calls = options.calls ?? [];
  const requestInits = options.requestInits ?? [];
  return new SportsDataIoProvider(
    parseSportsDataIoCatalog(options.catalogInput ?? fixtureCatalogInput),
    {
      allowNonProductionForTesting: true,
      getApiKey: () => "sanitized-fixture-key",
      nflCaches: createSportsDataIoNflCaches(),
      mlbCaches: createSportsDataIoMlbCaches(),
      now: () => new Date("2031-11-04T12:00:00.000Z"),
      fetchImpl: async (input, init) => {
        const url =
          input instanceof URL
            ? input
            : typeof input === "string"
              ? new URL(input)
              : new URL(input.url);
        calls.push(url.pathname);
        requestInits.push(init ?? {});
        if (url.pathname === "/v3/nfl/scores/json/Teams") {
          return Response.json(nflTeams);
        }
        if (
          url.pathname ===
          "/v3/nfl/scores/json/SchedulesBasic/2031REG"
        ) {
          return Response.json(options.nflSchedulePayload ?? nflSchedule);
        }
        const nflScorePayloadByPath =
          options.nflScorePayloadsByPath?.[url.pathname];
        if (nflScorePayloadByPath !== undefined) {
          return Response.json(nflScorePayloadByPath);
        }
        if (
          url.pathname ===
          "/v3/nfl/scores/json/ScoresByDate/2031-NOV-02"
        ) {
          return Response.json(options.nflScorePayload ?? nflScores);
        }
        if (url.pathname.startsWith("/v3/nfl/scores/json/ScoresByDate/")) {
          return Response.json([]);
        }
        if (url.pathname === "/v3/mlb/scores/json/teams") {
          return Response.json(mlbTeams);
        }
        if (
          url.pathname ===
          "/v3/mlb/scores/json/GamesByDate/2031-JUN-10"
        ) {
          return Response.json(options.mlbGamePayload ?? mlbGames);
        }
        if (url.pathname.startsWith("/v3/mlb/scores/json/GamesByDate/")) {
          return Response.json([]);
        }
        return new Response(null, {status: 404});
      },
    },
  );
}

function byProviderId(
  games: Awaited<ReturnType<SportsDataIoProvider["listGames"]>>,
  id: string,
) {
  const game = games.find((candidate) => candidate.providerGameId === id);
  if (game === undefined) throw new Error(`Missing fixture game ${id}.`);
  return game;
}

describe("SportsDataIO strict request contract", () => {
  it("encapsulates the documented date-format disagreement", () => {
    expect(formatSportsDataIoDate("2031-01-09")).toBe("2031-JAN-09");
    expect(formatSportsDataIoDate("2032-02-29")).toBe("2032-FEB-29");
    expect(() => formatSportsDataIoDate("2031-02-29")).toThrow();
    expect(() => formatSportsDataIoDate("2031-JAN-09")).toThrow();
    expect(
      resolveSportsDataIoUrl({
        league: "nfl",
        resource: "ScoresByDate",
        date: "2031-11-02",
      }).pathname,
    ).toBe("/v3/nfl/scores/json/ScoresByDate/2031-NOV-02");
    expect(
      resolveSportsDataIoUrl({
        league: "mlb",
        resource: "GamesByDate",
        date: "2031-06-10",
      }).pathname,
    ).toBe("/v3/mlb/scores/json/GamesByDate/2031-JUN-10");
  });

  it("validates NFL and MLB seasons independently", () => {
    expect(isSportsDataIoNflSeason("2031REG")).toBe(true);
    expect(isSportsDataIoNflSeason("2031POST")).toBe(true);
    expect(isSportsDataIoMlbSeason("2031")).toBe(true);
    expect(isSportsDataIoMlbSeason("2031STAR")).toBe(true);
    expect(isSportsDataIoNflSeason("2031EXH")).toBe(false);
    expect(isSportsDataIoMlbSeason("31REG")).toBe(false);
  });

  it("uses only the exact host/path, key header, and redirect denial", async () => {
    const capturedUrls: URL[] = [];
    let capturedInit: RequestInit | undefined;
    const client = new SportsDataIoClient({
      getApiKey: () => "sanitized-fixture-key",
      fetchImpl: async (input, init) => {
        const requestedUrl =
          input instanceof URL
            ? input
            : typeof input === "string"
              ? new URL(input)
              : new URL(input.url);
        capturedUrls.push(requestedUrl);
        capturedInit = init;
        return Response.json([]);
      },
    });
    await expect(
      client.getJson({league: "mlb", resource: "teams"}),
    ).resolves.toEqual([]);
    expect(capturedUrls[0]?.origin).toBe("https://api.sportsdata.io");
    expect(capturedUrls[0]?.pathname).toBe("/v3/mlb/scores/json/teams");
    expect(capturedUrls[0]?.search).toBe("");
    expect(capturedInit?.method).toBe("GET");
    expect(capturedInit?.redirect).toBe("error");
    expect(capturedInit?.signal).toBeDefined();
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get("Ocp-Apim-Subscription-Key")).toBe(
      "sanitized-fixture-key",
    );
    expect(headers.has("authorization")).toBe(false);
  });

  it("does not issue a request when the lazy key is absent", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new SportsDataIoClient({
      getApiKey: () => "   ",
      fetchImpl,
    });
    await expect(
      client.getJson({league: "nfl", resource: "Teams"}),
    ).rejects.toMatchObject({
      code: "failed-precondition",
      message: SPORTSDATAIO_KEY_CONFIGURATION_MESSAGE,
      details: {reason: SPORTSDATAIO_KEY_CONFIGURATION_REASON},
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(client.getRequestAttemptCount()).toBe(0);
  });

  it("maps upstream 401 to safe provider configuration, not user auth", async () => {
    const upstreamBody = "sensitive upstream body with credential metadata";
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(upstreamBody, {status: 401}),
    );
    const client = new SportsDataIoClient({
      getApiKey: () => "sanitized-fixture-key",
      fetchImpl,
    });

    let thrown: unknown;
    try {
      await client.getJson({league: "nfl", resource: "Teams"});
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "failed-precondition",
      message: SPORTSDATAIO_CREDENTIALS_CONFIGURATION_MESSAGE,
      details: {reason: SPORTSDATAIO_CREDENTIALS_CONFIGURATION_REASON},
    });
    expect(String(thrown)).not.toContain(upstreamBody);
    expect(JSON.stringify(thrown)).not.toContain(upstreamBody);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps upstream 403 to safe feed configuration, not caller auth", async () => {
    const upstreamBody = "sensitive subscription metadata";
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(upstreamBody, {status: 403}),
    );
    const client = new SportsDataIoClient({
      getApiKey: () => "sanitized-fixture-key",
      fetchImpl,
    });
    let thrown: unknown;
    try {
      await client.getJson({league: "nfl", resource: "Teams"});
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "failed-precondition",
      message: SPORTSDATAIO_ENTITLEMENT_CONFIGURATION_MESSAGE,
      details: {reason: SPORTSDATAIO_ENTITLEMENT_CONFIGURATION_REASON},
    });
    expect(String(thrown)).not.toContain(upstreamBody);
    expect(JSON.stringify(thrown)).not.toContain(upstreamBody);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries 429 with capped Retry-After and reauthorizes first", async () => {
    const delays: number[] = [];
    let attempts = 0;
    let authorizations = 0;
    const client = new SportsDataIoClient({
      getApiKey: () => "sanitized-fixture-key",
      random: () => 0,
      sleep: async (delay) => {
        delays.push(delay);
      },
      fetchImpl: async () => {
        attempts += 1;
        return attempts === 1
          ? new Response(null, {
              status: 429,
              headers: {"retry-after": "99"},
            })
          : Response.json([]);
      },
    });
    client.setRetryAuthorizer(async () => {
      authorizations += 1;
    });
    await expect(
      client.getJson({league: "nfl", resource: "Teams"}),
    ).resolves.toEqual([]);
    expect(attempts).toBe(2);
    expect(authorizations).toBe(1);
    expect(delays).toEqual([5_000]);
  });

  it("bounds transient 5xx retries to three attempts", async () => {
    const delays: number[] = [];
    let authorizations = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(null, {status: 503}),
    );
    const client = new SportsDataIoClient({
      getApiKey: () => "sanitized-fixture-key",
      fetchImpl,
      random: () => 0,
      sleep: async (delay) => {
        delays.push(delay);
      },
    });
    client.setRetryAuthorizer(async () => {
      authorizations += 1;
    });
    await expect(
      client.getJson({league: "nfl", resource: "Teams"}),
    ).rejects.toMatchObject({code: "unavailable"});
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(authorizations).toBe(2);
    expect(delays).toEqual([250, 500]);
  });

  it("retries network and timeout failures but no more than the boundary", async () => {
    const delays: number[] = [];
    let attempts = 0;
    let authorizations = 0;
    const client = new SportsDataIoClient({
      getApiKey: () => "sanitized-fixture-key",
      random: () => 0,
      sleep: async (delay) => {
        delays.push(delay);
      },
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError("network disconnected");
        if (attempts === 2) {
          throw new DOMException("timed out", "TimeoutError");
        }
        return Response.json({ok: true});
      },
    });
    client.setRetryAuthorizer(async () => {
      authorizations += 1;
    });
    await expect(
      client.getJson({league: "nfl", resource: "Teams"}),
    ).resolves.toEqual({ok: true});
    expect(attempts).toBe(3);
    expect(authorizations).toBe(2);
    expect(delays).toEqual([250, 500]);
  });

  it("requires retry authorization before issuing another request", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(null, {status: 503}),
    );
    const client = new SportsDataIoClient({
      getApiKey: () => "sanitized-fixture-key",
      fetchImpl,
      sleep: async () => undefined,
    });
    client.setRetryAuthorizer(async () => {
      throw new Error("reservation denied");
    });
    await expect(
      client.getJson({league: "nfl", resource: "Teams"}),
    ).rejects.toBeInstanceOf(ProviderRetryAuthorizationError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("drains a retrying sibling before surfacing another bucket failure", async () => {
    let releaseSleep = (): void => undefined;
    let markSleepStarted = (): void => undefined;
    const sleepGate = new Promise<void>((resolve) => {
      releaseSleep = resolve;
    });
    const sleepStarted = new Promise<void>((resolve) => {
      markSleepStarted = resolve;
    });
    const attemptsByPath = new Map<string, number>();
    const provider = new SportsDataIoProvider(
      parseSportsDataIoCatalog(fixtureCatalogInput),
      {
        allowNonProductionForTesting: true,
        getApiKey: () => "sanitized-fixture-key",
        nflCaches: createSportsDataIoNflCaches(),
        mlbCaches: createSportsDataIoMlbCaches(),
        sleep: async () => {
          markSleepStarted();
          await sleepGate;
        },
        fetchImpl: async (input) => {
          const url =
            input instanceof URL
              ? input
              : typeof input === "string"
                ? new URL(input)
                : new URL(input.url);
          const count = (attemptsByPath.get(url.pathname) ?? 0) + 1;
          attemptsByPath.set(url.pathname, count);
          if (url.pathname.endsWith("/Teams")) return Response.json([]);
          if (url.pathname.includes("/SchedulesBasic/")) {
            return Response.json([]);
          }
          if (url.pathname.endsWith("/2031-NOV-02")) {
            return new Response(null, {status: 400});
          }
          if (url.pathname.endsWith("/2031-NOV-03")) {
            return count === 1
              ? new Response(null, {status: 503})
              : Response.json([]);
          }
          return new Response(null, {status: 404});
        },
      },
    );
    provider.setRetryAuthorizer(async () => undefined);
    let settled = false;
    const request = provider
      .listGames({...nflQuery, to: "2031-11-03"})
      .finally(() => {
        settled = true;
      });

    await sleepStarted;
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseSleep();

    await expect(request).rejects.toMatchObject({code: "failed-precondition"});
    expect(
      attemptsByPath.get(
        "/v3/nfl/scores/json/ScoresByDate/2031-NOV-03",
      ),
    ).toBe(2);
    provider.setRetryAuthorizer(null);
  });

  it("rejects oversize, malformed JSON, and redirects without retries", async () => {
    const cases = [
      {
        response: new Response("[]", {
          status: 200,
          headers: {"content-length": "100"},
        }),
        maximumResponseBytes: 10,
        code: "data-loss",
      },
      {
        response: new Response("not-json", {status: 200}),
        maximumResponseBytes: 100,
        code: "data-loss",
      },
      {
        response: new Response(null, {
          status: 302,
          headers: {location: "https://unapproved.example.test"},
        }),
        maximumResponseBytes: 100,
        code: "failed-precondition",
      },
    ];
    for (const testCase of cases) {
      const fetchImpl = vi.fn<typeof fetch>(async () => testCase.response);
      const client = new SportsDataIoClient({
        getApiKey: () => "sanitized-fixture-key",
        fetchImpl,
        maximumResponseBytes: testCase.maximumResponseBytes,
      });
      await expect(
        client.getJson({league: "nfl", resource: "Teams"}),
      ).rejects.toMatchObject({code: testCase.code});
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
});

describe("SportsDataIO catalog and production activation", () => {
  it("defaults absent configuration to the fail-closed fixture kill switch", () => {
    expect(parseSportsDataIoCatalog({})).toEqual({
      enabled: false,
      accessMode: "fixture",
      revision: "disabled",
      cacheNamespace: "sportsDataIo:disabled",
      entitlementVerified: false,
      entitlementReference: null,
      entitlementReviewedAt: null,
      leagues: [],
    });
  });

  it("accepts exactly NFL plus MLB and rejects unknown fields and seasons", () => {
    expect(parseSportsDataIoCatalog(fixtureCatalogInput).leagues).toHaveLength(2);
    expect(() =>
      parseSportsDataIoCatalog({...fixtureCatalogInput, unexpected: true}),
    ).toThrow();
    expect(() =>
      parseSportsDataIoCatalog({
        ...fixtureCatalogInput,
        leagues: [fixtureCatalogInput.leagues[0]],
      }),
    ).toThrow();
    expect(() =>
      parseSportsDataIoCatalog({
        ...fixtureCatalogInput,
        leagues: [
          {...fixtureCatalogInput.leagues[0], season: "2031EXH"},
          fixtureCatalogInput.leagues[1],
        ],
      }),
    ).toThrow();
  });

  it("requires reviewed metadata and every chosen production feed", () => {
    expect(() =>
      parseSportsDataIoCatalog({
        ...fixtureCatalogInput,
        accessMode: "production",
      }),
    ).toThrow();
    expect(() =>
      parseSportsDataIoCatalog({
        ...fixtureCatalogInput,
        accessMode: "production",
        entitlementVerified: true,
        entitlementReference: "contract-review-2031",
        entitlementReviewedAt: "2031-01-15",
        leagues: [
          {
            ...fixtureCatalogInput.leagues[0],
            entitlements: {
              teams: true,
              schedules: true,
              liveAndFinal: false,
            },
          },
          fixtureCatalogInput.leagues[1],
        ],
      }),
    ).toThrow();

    const production = parseSportsDataIoCatalog({
      ...fixtureCatalogInput,
      accessMode: "production",
      entitlementVerified: true,
      entitlementReference: "contract-review-2031",
      entitlementReviewedAt: "2031-01-15",
    });
    expect(() => assertSportsDataIoProductionReady(production)).not.toThrow();
    expect(() => new SportsDataIoProvider(production)).not.toThrow();
  });

  it("does not let a fixture/trial/discovery catalog use production construction", () => {
    const catalog = parseSportsDataIoCatalog(fixtureCatalogInput);
    expect(() => new SportsDataIoProvider(catalog)).toThrow();
    expect(() =>
      new SportsDataIoProvider(catalog, {
        allowNonProductionForTesting: true,
        getApiKey: () => "",
      }),
    ).not.toThrow();
  });

  it("lists leagues from reviewed config without making a network request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new SportsDataIoProvider(
      parseSportsDataIoCatalog(fixtureCatalogInput),
      {
        allowNonProductionForTesting: true,
        getApiKey: () => "sanitized-fixture-key",
        fetchImpl,
      },
    );
    await expect(provider.listSupportedSports()).resolves.toEqual([
      "football",
      "baseball",
    ]);
    await expect(provider.listLeagues()).resolves.toEqual([
      expect.objectContaining({code: "nfl", season: "2031REG"}),
      expect.objectContaining({code: "mlb", season: "2031"}),
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("estimates actual endpoint fanout and three-attempt boundaries", () => {
    const provider = fixtureProvider();
    expect(
      provider.requestEstimate("listGames", 1, {
        ...nflQuery,
        to: "2031-11-03",
      }),
    ).toEqual({baseRequestCount: 4, maximumRequestCount: 12});
    expect(
      provider.requestEstimate("fetchGames", 2, {
        ...mlbQuery,
        to: "2031-06-11",
      }),
    ).toEqual({baseRequestCount: 3, maximumRequestCount: 9});
    expect(provider.requestEstimate("fetchGames", 1, nflQuery)).toEqual({
      baseRequestCount: 4,
      maximumRequestCount: 12,
    });
    expect(provider.requestEstimate("fetchGames", 0, mlbQuery)).toEqual({
      baseRequestCount: 0,
      maximumRequestCount: 0,
    });
  });
});

describe("SportsDataIO NFL adapter", () => {
  it("normalizes endpoint-specific identities, UTC, status, and neutral teams", async () => {
    const games = await fixtureProvider().listGames(nflQuery);
    expect(games).toHaveLength(13);

    const scheduled = byProviderId(games, "5001");
    expect(scheduled).toMatchObject({
      id: "sportsDataIo:football:5001",
      provider: "sportsDataIo",
      providerGameId: "5001",
      providerScoreId: "5001",
      providerLeagueGameId: "7001",
      providerGlobalGameId: "9001",
      providerGameKey: "2031REG-09-SEN-VOY",
      season: "2031REG",
      seasonType: "REG",
      scheduledDayEastern: "2031-11-02",
      timeTbd: false,
      status: "scheduled",
      homeScore: null,
      awayScore: null,
    });
    expect(scheduled.scheduledAtUtc?.toISOString()).toBe(
      "2031-11-03T04:30:00.000Z",
    );
    expect(scheduled.providerLastUpdatedAt.toISOString()).toBe(
      "2031-11-01T16:00:00.000Z",
    );
    expect(scheduled.homeTeam).toMatchObject({
      id: "sportsDataIo:nfl:team:1",
      providerTeamId: "1",
      providerGlobalTeamId: "1001",
      abbreviation: "SEN",
      logoUrl: null,
      color: null,
    });
    expect(scheduled.sourcePayloadHash).toMatch(/^[a-f0-9]{64}$/);

    expect(byProviderId(games, "5002")).toMatchObject({
      status: "live",
      homeScore: 14,
      awayScore: 10,
      statusDetail: "3rd Quarter",
    });
    expect(byProviderId(games, "5003")).toMatchObject({
      status: "final",
      homeScore: 21,
      awayScore: 17,
      winnerTeamId: "sportsDataIo:nfl:team:1",
      venueName: "Sanitized Stadium",
      isClosed: true,
    });
  });

  it("guards closure, ties, missing scores, forfeits, and unknown statuses", async () => {
    const games = await fixtureProvider().listGames(nflQuery);
    expect(byProviderId(games, "5004")).toMatchObject({
      status: "reviewRequired",
      winnerTeamId: null,
      homeScore: 20,
      awayScore: 20,
    });
    expect(byProviderId(games, "5009")).toMatchObject({
      status: "reviewRequired",
      winnerTeamId: null,
    });
    expect(byProviderId(games, "5010").status).toBe("reviewRequired");
    expect(byProviderId(games, "5011")).toMatchObject({
      status: "reviewRequired",
      winnerTeamId: null,
      isClosed: false,
    });
    expect(byProviderId(games, "5012")).toMatchObject({
      status: "reviewRequired",
      winnerTeamId: null,
      homeScore: null,
      awayScore: 10,
    });
  });

  it("keeps interruption states distinct and carries reschedule links", async () => {
    const games = await fixtureProvider().listGames(nflQuery);
    expect(byProviderId(games, "5005").status).toBe("delayed");
    expect(byProviderId(games, "5006")).toMatchObject({
      status: "postponed",
      rescheduledToLeagueGameId: "8006",
    });
    expect(byProviderId(games, "5007")).toMatchObject({
      status: "suspended",
      homeScore: 7,
      awayScore: 7,
    });
    expect(byProviderId(games, "5008").status).toBe("cancelled");
  });

  it("surfaces a real schedule-only TBD game and skips an all-null bye", async () => {
    const games = await fixtureProvider().listGames(nflQuery);
    const tbd = byProviderId(games, "7013");
    expect(tbd).toMatchObject({
      providerScoreId: null,
      providerLeagueGameId: "7013",
      providerGlobalGameId: "9013",
      status: "scheduled",
      scheduledDayEastern: "2031-11-02",
      scheduledAtUtc: null,
      publishedScheduledAtUtc: null,
      effectiveLockAtUtc: null,
      timeTbd: true,
    });
    expect(games.every((game) => game.providerGameId.length > 0)).toBe(true);
  });

  it("accepts empty dates but fails a wholly malformed nonempty bucket", async () => {
    await expect(
      fixtureProvider().listGames({
        ...nflQuery,
        from: "2031-11-04",
        to: "2031-11-04",
      }),
    ).resolves.toEqual([]);
    await expect(
      fixtureProvider({
        nflScorePayload: [{Status: "Scheduled", HomeTeamID: 1}],
      }).listGames(nflQuery),
    ).rejects.toThrow("records but none could be normalized");
  });

  it("refreshes a requested same-ID NFL game after it moves to another day", async () => {
    const movedScore = {
      ...(nflScores[0] as Record<string, unknown>),
      Day: "2031-11-03T00:00:00",
      DateTimeUTC: "2031-11-04T01:15:00",
    };
    const movedSchedule = {
      ...(nflSchedule[0] as Record<string, unknown>),
      Day: "2031-11-03T00:00:00",
      DateTimeUTC: "2031-11-04T01:15:00",
    };
    const provider = fixtureProvider({
      nflScorePayload: [movedScore],
      nflSchedulePayload: [movedSchedule],
    });

    await expect(provider.listGames(nflQuery)).resolves.toEqual([]);
    const refreshed = await provider.fetchGames(["7001"], nflQuery);

    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]).toMatchObject({
      providerGameId: "7001",
      scheduledDayEastern: "2031-11-03",
    });
    expect(refreshed[0]?.scheduledAtUtc?.toISOString()).toBe(
      "2031-11-04T01:15:00.000Z",
    );
  });

  it("fetches the current NFL bridge day when the old bucket no longer has the game", async () => {
    const movedSchedule = {
      ...(nflSchedule[0] as Record<string, unknown>),
      Status: "Final",
      IsClosed: true,
      Day: "2031-11-03T00:00:00",
      DateTimeUTC: "2031-11-04T01:15:00",
      LastUpdated: "2031-11-04T05:00:00",
    };
    const movedFinal = {
      ...(nflScores[0] as Record<string, unknown>),
      Status: "Final",
      IsClosed: true,
      HasStarted: true,
      IsInProgress: false,
      IsOver: true,
      HomeScore: 28,
      AwayScore: 21,
      Day: "2031-11-03T00:00:00",
      DateTimeUTC: "2031-11-04T01:15:00",
      LastUpdated: "2031-11-04T05:00:00",
    };
    const calls: string[] = [];
    const provider = fixtureProvider({
      calls,
      nflSchedulePayload: [movedSchedule],
      nflScorePayloadsByPath: {
        "/v3/nfl/scores/json/ScoresByDate/2031-NOV-02": [],
        "/v3/nfl/scores/json/ScoresByDate/2031-NOV-03": [movedFinal],
      },
    });

    const refreshed = await provider.fetchGames(["7001"], nflQuery);

    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]).toMatchObject({
      providerGameId: "7001",
      status: "final",
      isClosed: true,
      homeScore: 28,
      awayScore: 21,
      winnerTeamId: "sportsDataIo:nfl:team:1",
      scheduledDayEastern: "2031-11-03",
    });
    expect(calls.filter((path) => path.includes("/ScoresByDate/"))).toEqual([
      "/v3/nfl/scores/json/ScoresByDate/2031-NOV-02",
      "/v3/nfl/scores/json/ScoresByDate/2031-NOV-03",
    ]);
  });

  it("keeps catalog and selected ScoreID identity when GameID appears later", async () => {
    const scoreOnlySchedule = {
      ...(nflSchedule[0] as Record<string, unknown>),
      GameID: null,
    };
    const initial = fixtureProvider({
      nflSchedulePayload: [scoreOnlySchedule],
      nflScorePayload: [nflScores[0]],
    });
    const selected = (await initial.listGames(nflQuery))[0];
    expect(selected).toMatchObject({
      id: "sportsDataIo:football:5001",
      providerGameId: "5001",
      providerScoreId: "5001",
      providerLeagueGameId: null,
    });

    const finalScore = {
      ...(nflScores[0] as Record<string, unknown>),
      Status: "Final",
      IsClosed: true,
      HasStarted: true,
      IsOver: true,
      HomeScore: 24,
      AwayScore: 17,
      LastUpdated: "2031-11-03T07:00:00",
    };
    const updated = fixtureProvider({
      nflSchedulePayload: [nflSchedule[0]],
      nflScorePayload: [finalScore],
    });
    const updatedCatalog = await updated.listGames(nflQuery);
    const refreshed = await updated.fetchGames(["5001"], nflQuery);

    expect(updatedCatalog).toHaveLength(1);
    expect(updatedCatalog[0]).toMatchObject({
      id: "sportsDataIo:football:5001",
      providerGameId: "5001",
      providerScoreId: "5001",
      providerLeagueGameId: "7001",
    });
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]).toMatchObject({
      id: "sportsDataIo:football:5001",
      providerGameId: "5001",
      providerScoreId: "5001",
      providerLeagueGameId: "7001",
      status: "final",
      winnerTeamId: "sportsDataIo:nfl:team:1",
    });
  });

  it("round-trips the configured NFL season token into selected refresh", async () => {
    const provider = fixtureProvider();
    const selected = byProviderId(await provider.listGames(nflQuery), "5001");

    const refreshed = await provider.fetchGames([selected.providerGameId], {
      ...nflQuery,
      season: selected.season,
    });

    expect(refreshed[0]).toMatchObject({
      providerGameId: "5001",
      season: "2031REG",
      seasonType: "REG",
    });
  });

  it("caches/coalesces teams and schedules while fetching each date bucket once", async () => {
    const calls: string[] = [];
    const provider = fixtureProvider({calls});
    await Promise.all([provider.listGames(nflQuery), provider.listGames(nflQuery)]);
    expect(calls.filter((path) => path.endsWith("/Teams"))).toHaveLength(1);
    expect(calls.filter((path) => path.includes("/SchedulesBasic/"))).toHaveLength(1);
    expect(calls.filter((path) => path.includes("/ScoresByDate/"))).toHaveLength(2);
    await provider.listGames(nflQuery);
    expect(calls.filter((path) => path.endsWith("/Teams"))).toHaveLength(1);
    expect(calls.filter((path) => path.includes("/SchedulesBasic/"))).toHaveLength(1);
  });

  it("maps only explicit NFL statuses", () => {
    expect(mapSportsDataIoNflStatus("Scheduled")).toBe("scheduled");
    expect(mapSportsDataIoNflStatus("InProgress")).toBe("live");
    expect(mapSportsDataIoNflStatus("Final", false)).toBe("reviewRequired");
    expect(mapSportsDataIoNflStatus("F/OT", true)).toBe("final");
    expect(mapSportsDataIoNflStatus("Forfeit", true)).toBe("reviewRequired");
  });
});

describe("SportsDataIO MLB adapter", () => {
  it("normalizes MLB-specific run fields, UTC values, and neutral teams", async () => {
    const games = await fixtureProvider().listGames(mlbQuery);
    expect(games).toHaveLength(14);
    expect(byProviderId(games, "9001")).toMatchObject({
      id: "sportsDataIo:baseball:9001",
      providerLeagueGameId: "9001",
      providerGlobalGameId: "19001",
      status: "scheduled",
      homeScore: null,
      awayScore: null,
      scheduledDayEastern: "2031-06-10",
    });
    expect(byProviderId(games, "9002")).toMatchObject({
      status: "live",
      homeScore: 3,
      awayScore: 2,
      statusDetail: "Top 7",
    });
    expect(byProviderId(games, "9003")).toMatchObject({
      status: "final",
      homeScore: 5,
      awayScore: 2,
      winnerTeamId: "sportsDataIo:mlb:team:11",
      venueName: "Sanitized Ballpark",
    });
    expect(byProviderId(games, "9003").homeTeam).toMatchObject({
      name: "Harbor Captains",
      abbreviation: "HBR",
      providerTeamId: "11",
      providerGlobalTeamId: "2011",
      logoUrl: null,
      color: null,
    });
    expect(byProviderId(games, "9001").providerLastUpdatedAt.toISOString())
      .toBe("2031-06-10T12:30:00.000Z");
  });

  it("keeps MLB exception states and reschedule/suspension data safe", async () => {
    const games = await fixtureProvider().listGames(mlbQuery);
    expect(byProviderId(games, "9004").status).toBe("delayed");
    expect(byProviderId(games, "9005")).toMatchObject({
      status: "postponed",
      rescheduledToLeagueGameId: "9905",
    });
    expect(byProviderId(games, "9006")).toMatchObject({
      status: "suspended",
      homeScore: 1,
      awayScore: 1,
    });
    expect(byProviderId(games, "9007").status).toBe("cancelled");
    expect(byProviderId(games, "9008")).toMatchObject({
      status: "cancelled",
      timeTbd: true,
      scheduledAtUtc: null,
    });
  });

  it("never invents a final winner for forfeits, unknowns, or missing scores", async () => {
    const games = await fixtureProvider().listGames(mlbQuery);
    for (const id of ["9009", "9010", "9013"]) {
      expect(byProviderId(games, id)).toMatchObject({
        status: "reviewRequired",
        winnerTeamId: null,
      });
    }
  });

  it("preserves doubleheaders by GameID rather than matchup and day", async () => {
    const games = await fixtureProvider().listGames(mlbQuery);
    const first = byProviderId(games, "9011");
    const second = byProviderId(games, "9012");
    expect(first.id).not.toBe(second.id);
    expect(first.homeTeam.id).toBe(second.homeTeam.id);
    expect(first.awayTeam.id).toBe(second.awayTeam.id);
    expect(first.eventDetail).toBeNull();
    expect(second.eventDetail).toBeNull();
  });

  it("preserves a real MLB time-TBD game without synthesizing a lock", async () => {
    expect(byProviderId(await fixtureProvider().listGames(mlbQuery), "9014"))
      .toMatchObject({
        status: "scheduled",
        scheduledDayEastern: "2031-06-10",
        scheduledAtUtc: null,
        publishedScheduledAtUtc: null,
        effectiveLockAtUtc: null,
        timeTbd: true,
      });
  });

  it("parses offsetless UTC explicitly across a DST boundary", () => {
    const teams = new Map<string, Team>(
      mlbTeams.map((value) => {
        const team = normalizeSportsDataIoMlbTeam(value);
        return [team.providerTeamId ?? "", team];
      }),
    );
    const game = normalizeSportsDataIoMlbGame(
      {
        GameID: 9991,
        Season: 2031,
        SeasonType: 1,
        Status: "Scheduled",
        Day: "2031-03-09T00:00:00",
        DateTimeUTC: "2031-03-09T07:30:00",
        HomeTeamID: 11,
        AwayTeamID: 12,
        HomeTeam: "HBR",
        AwayTeam: "PLN",
        IsClosed: false,
      },
      {season: "2031", teams},
    );
    expect(game.scheduledDayEastern).toBe("2031-03-09");
    expect(game.scheduledAtUtc?.toISOString()).toBe(
      "2031-03-09T07:30:00.000Z",
    );
  });

  it("fetchGames filters selected IDs after one required date-bucket fetch", async () => {
    const calls: string[] = [];
    const provider = fixtureProvider({calls});
    const games = await provider.fetchGames(["9003", "9012"], mlbQuery);
    expect(games.map((game) => game.providerGameId)).toEqual([
      "9003",
      "9012",
    ]);
    expect(calls.filter((path) => path.includes("/GamesByDate/"))).toHaveLength(1);
    expect(calls.every((path) => !path.includes("9003"))).toBe(true);
    expect(calls.every((path) => !path.includes("9012"))).toBe(true);
  });

  it("refreshes a requested same-ID MLB game after it moves to another day", async () => {
    const movedGame = {
      ...(mlbGames[0] as Record<string, unknown>),
      Day: "2031-06-11T00:00:00",
      DateTimeUTC: "2031-06-11T23:05:00",
    };
    const provider = fixtureProvider({mlbGamePayload: [movedGame]});

    await expect(provider.listGames(mlbQuery)).resolves.toEqual([]);
    const refreshed = await provider.fetchGames(["9001"], mlbQuery);

    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]).toMatchObject({
      providerGameId: "9001",
      scheduledDayEastern: "2031-06-11",
    });
    expect(refreshed[0]?.scheduledAtUtc?.toISOString()).toBe(
      "2031-06-11T23:05:00.000Z",
    );
  });

  it("round-trips an MLB postseason token into selected refresh", async () => {
    const postseasonCatalog = {
      ...fixtureCatalogInput,
      leagues: [
        fixtureCatalogInput.leagues[0],
        {...fixtureCatalogInput.leagues[1], season: "2031POST"},
      ],
    };
    const postseasonGame = {
      ...(mlbGames[0] as Record<string, unknown>),
      SeasonType: 3,
    };
    const provider = fixtureProvider({
      catalogInput: postseasonCatalog,
      mlbGamePayload: [postseasonGame],
    });
    const postseasonQuery = {...mlbQuery, season: "2031POST"};
    const selected = byProviderId(
      await provider.listGames(postseasonQuery),
      "9001",
    );

    const refreshed = await provider.fetchGames(
      [selected.providerGameId],
      {...postseasonQuery, season: selected.season},
    );

    expect(refreshed[0]).toMatchObject({
      providerGameId: "9001",
      season: "2031POST",
      seasonType: "POST",
    });
  });

  it("rejects date ranges over seven days before any request", async () => {
    const calls: string[] = [];
    const provider = fixtureProvider({calls});
    await expect(
      provider.listGames({
        ...mlbQuery,
        from: "2031-06-01",
        to: "2031-06-08",
      }),
    ).rejects.toMatchObject({code: "invalid-argument"});
    expect(calls).toEqual([]);
  });

  it("maps only explicit MLB statuses including NotNecessary", () => {
    expect(mapSportsDataIoMlbStatus("Scheduled")).toBe("scheduled");
    expect(mapSportsDataIoMlbStatus("NotNecessary")).toBe("cancelled");
    expect(mapSportsDataIoMlbStatus("Final", false)).toBe("reviewRequired");
    expect(mapSportsDataIoMlbStatus("Final", true)).toBe("final");
    expect(mapSportsDataIoMlbStatus("VendorNewState", true)).toBe(
      "reviewRequired",
    );
  });

  it("ignores all unlicensed logo and color fields", () => {
    for (const team of [
      normalizeSportsDataIoNflTeam(nflTeams[0]),
      normalizeSportsDataIoMlbTeam(mlbTeams[0]),
    ]) {
      expect(team.logoUrl).toBeNull();
      expect(team.color).toBeNull();
    }
  });
});
