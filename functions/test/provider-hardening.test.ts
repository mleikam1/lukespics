import {
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {afterEach, describe, expect, it, vi} from "vitest";
import * as functionExports from "../src/index.js";
import {
  API_SPORTS_SELECTED_GAME_CONCURRENCY,
  ApiSportsProvider,
  ApiSportsRetryAuthorizationError,
  mapApiSportsStatus,
  normalizeApiSportsGame,
  parseApiSportsCatalog,
  parseApiSportsConfigs,
  resolveApiSportsGamesUrl,
} from "../src/providers/apiSports.js";
import {MockSportsProvider} from "../src/providers/mock.js";
import {
  leagueSettingsSchema,
  sportsCatalogSchema,
  updateLeagueSettingsSchema,
} from "../src/schemas.js";
import {
  isProviderAllowed,
  providerRuntime,
  type ProviderRuntime,
} from "../src/providers/policy.js";
import {
  normalizeTheSportsDbEvents,
  THE_SPORTS_DB_ATTRIBUTION,
  TheSportsDbTestProvider,
  theSportsDbSmallImageUrl,
} from "../src/providers/theSportsDbTest.js";
import {
  assertCompleteSelectedGamesResponse,
  cacheFallbackAfterRefreshError,
  CanonicalTrustConflictError,
  catalogTrustDecision,
  minimumProviderQuotaRemaining,
  providerCacheSnapshotMatchesMetadata,
  providerCacheDurationMs,
  providerCacheKey,
  providerGamesContentHash,
  PROVIDER_CACHE_LOCK_LEASE_MS,
  providerQuotaReservationAllowed,
  quotaReservationSettlement,
  SELECTED_GAMES_TERMINAL_CACHE_DURATION_MS,
  shouldRecordProviderFailure,
  validateAndDeduplicateProviderGames,
} from "../src/services/providerGateway.js";
import {
  assertCatalogQueryWithinWeek,
  boundedRemainingWeekRange,
  resolveCatalogLeague,
  validateCatalogProviderForLeague,
} from "../src/services/weeks.js";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/thesportsdb-eventsday.sanitized.json", import.meta.url),
    "utf8",
  ),
) as {events: unknown[]};

const apiSportsFixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/api-sports-baseball.sanitized.json", import.meta.url),
    "utf8",
  ),
) as {response: unknown[]};

const providerConfig = {
  sportCode: "american-football",
  leagueCode: "test-football",
  leagueName: "Sanitized Test League",
  providerLeagueId: "4391",
  season: "2030",
};

const query = {
  sportCode: providerConfig.sportCode,
  leagueCode: providerConfig.leagueCode,
  providerLeagueId: providerConfig.providerLeagueId,
  season: providerConfig.season,
  from: "2030-09-01",
  to: "2030-09-01",
  timezone: "UTC",
};

function normalizedFixtureGames() {
  return normalizeTheSportsDbEvents(fixture.events, {
    ...providerConfig,
    importedAt: new Date("2030-09-02T02:00:00.000Z"),
  });
}

describe("TheSportsDB internal test provider", () => {
  it("normalizes and deduplicates sanitized event fixtures", () => {
    const games = normalizedFixtureGames();
    expect(games).toHaveLength(2);
    expect(games[0]).toMatchObject({
      id: "theSportsDbTest:american-football:900001",
      provider: "theSportsDbTest",
      providerGameId: "900001",
      status: "scheduled",
      winnerTeamId: null,
    });
    expect(games[0]?.providerLastUpdatedAt.toISOString()).toBe(
      "2030-08-30T12:00:00.000Z",
    );
    expect(games[0]?.homeTeam.logoUrl).toBe(
      "https://r2.thesportsdb.com/images/media/team/badge/sanitized-home.png/small",
    );
    expect(games[0]?.sourcePayloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(games[1]).toMatchObject({
      status: "final",
      winnerTeamId: "800004",
      homeScore: 17,
      awayScore: 24,
    });
    expect(games[1]?.homeTeam.logoUrl).toBeNull();
    expect(games[1]?.awayTeam.logoUrl).toBeNull();
    expect(THE_SPORTS_DB_ATTRIBUTION).toEqual({
      text: "Sports data and artwork from TheSportsDB",
      url: "https://www.thesportsdb.com",
    });
  });

  it("rejects malformed event identifiers and unsafe image URLs", () => {
    const malformed = {
      ...(fixture.events[0] as Record<string, unknown>),
      idHomeTeam: null,
    };
    expect(() =>
      normalizeTheSportsDbEvents([malformed], {
        ...providerConfig,
        importedAt: new Date("2030-09-02T02:00:00.000Z"),
      }),
    ).toThrow();
    expect(theSportsDbSmallImageUrl("http://r2.thesportsdb.com/a.png")).toBeNull();
    expect(theSportsDbSmallImageUrl("https://images.example.test/a.png")).toBeNull();
    expect(
      theSportsDbSmallImageUrl(
        "https://r2.thesportsdb.com/a.png?credential=removed#fragment",
      ),
    ).toBe("https://r2.thesportsdb.com/a.png/small");
  });

  it("uses only the documented HTTPS endpoint and bounded retries", async () => {
    const urls: URL[] = [];
    const delays: number[] = [];
    let requestReservations = 0;
    let attempts = 0;
    const provider = new TheSportsDbTestProvider([providerConfig], {
      fetchImpl: async (input, init) => {
        attempts += 1;
        urls.push(
          input instanceof URL
            ? input
            : typeof input === "string"
              ? new URL(input)
              : new URL(input.url),
        );
        expect(init?.method).toBe("GET");
        expect(init?.redirect).toBe("error");
        expect(init?.signal).toBeDefined();
        if (attempts === 1) {
          return new Response("temporary", {status: 503});
        }
        return new Response(JSON.stringify(fixture), {
          status: 200,
          headers: {"content-type": "application/json"},
        });
      },
      reserveRequest: async () => {
        requestReservations += 1;
      },
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
      now: () => new Date("2030-09-02T02:00:00.000Z"),
    });

    const games = await provider.listGames(query);
    expect(games).toHaveLength(2);
    expect(attempts).toBe(2);
    expect(requestReservations).toBe(2);
    expect(delays).toEqual([250]);
    expect(urls.every((url) => url.protocol === "https:")).toBe(true);
    expect(urls.every((url) => url.hostname === "www.thesportsdb.com")).toBe(
      true,
    );
    expect(
      urls.every(
        (url) => url.pathname === "/api/v1/json/123/eventsday.php",
      ),
    ).toBe(true);
    expect(urls[0]?.searchParams.get("d")).toBe("2030-09-01");
    expect(urls[0]?.searchParams.get("l")).toBe("4391");
  });

  it("stops after three failed provider attempts", async () => {
    let attempts = 0;
    const provider = new TheSportsDbTestProvider([providerConfig], {
      fetchImpl: async () => {
        attempts += 1;
        return new Response("temporary", {status: 503});
      },
      reserveRequest: async () => undefined,
      sleep: async () => undefined,
    });
    await expect(provider.listGames(query)).rejects.toThrow(
      "temporarily unavailable",
    );
    expect(attempts).toBe(3);
  });
});

describe("API-Sports baseball sanitized contract", () => {
  const rawConfig = {
    sportCode: "baseball",
    leagueCode: "mlb",
    leagueName: "MLB",
    providerLeagueId: "9000",
    season: "2030",
    baseUrl: "https://v1.baseball.api-sports.io",
    gamesPath: "/games",
    finalStatuses: ["FT"],
  };
  const [config] = parseApiSportsConfigs([rawConfig]);
  if (config === undefined) throw new Error("Sanitized API config is missing.");

  const selectedGameContext = {
    sportCode: rawConfig.sportCode,
    leagueCode: rawConfig.leagueCode,
    providerLeagueId: rawConfig.providerLeagueId,
    season: rawConfig.season,
    from: "2030-09-01",
    to: "2030-09-01",
    timezone: "UTC",
  };

  function selectedGameEnvelope(id: string): Record<string, unknown> {
    const first = apiSportsFixture.response[0] as Record<string, unknown>;
    return {
      errors: [],
      results: 1,
      paging: {current: 1, total: 1},
      response: [{...first, id: Number(id)}],
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("normalizes root-level baseball games and derives only valid winners", () => {
    const catalog = parseApiSportsCatalog({
      leagues: [rawConfig],
      presentation: {
        attributionText: "Sanitized provider fixture",
        allowRemoteLogos: true,
        allowedLogoHosts: ["images.example.test"],
        allowedLogoQueryParameters: [],
        logoRightsReviewDate: "2030-01-01",
      },
    });
    const observedAt = new Date("2030-09-02T00:00:00.000Z");
    const games = apiSportsFixture.response.map((item) =>
      normalizeApiSportsGame(item, config, catalog.presentation, observedAt),
    );
    expect(games).toHaveLength(3);
    expect(games[0]).toMatchObject({
      id: "apiSports:baseball:900001",
      providerLeagueId: "9000",
      sportCode: "baseball",
      leagueCode: "mlb",
      status: "scheduled",
      venueName: "Sanitized Ballpark",
    });
    expect(games[0]?.homeTeam.logoUrl).toBe(
      "https://images.example.test/teams/home.png",
    );
    expect(games[0]?.awayTeam.logoUrl).toBeNull();
    expect(games[0]?.homeTeam.abbreviation).toBe("SHC");
    expect(games[1]).toMatchObject({
      status: "final",
      homeScore: 5,
      awayScore: 3,
      winnerTeamId: "9201",
    });
    expect(games[2]).toMatchObject({
      status: "reviewRequired",
      winnerTeamId: null,
    });
    expect(games.every((game) => game.sourcePayloadHash.length === 64)).toBe(
      true,
    );
  });

  it("defaults production logo presentation off and rejects response drift", () => {
    const catalog = parseApiSportsCatalog({leagues: [rawConfig]});
    expect(catalog.presentation).toEqual({
      provider: "apiSports",
      attributionText: null,
      allowRemoteLogos: false,
      allowedLogoHosts: [],
      allowedLogoQueryParameters: [],
      logoRightsReviewDate: null,
    });
    const first = apiSportsFixture.response[0] as Record<string, unknown>;
    expect(() =>
      normalizeApiSportsGame(
        {
          ...first,
          league: {...(first.league as object), id: 9999},
        },
        config,
      ),
    ).toThrow("unexpected league");
    expect(() =>
      parseApiSportsCatalog({
        leagues: [rawConfig],
        presentation: {
          allowRemoteLogos: true,
          allowedLogoHosts: ["a.espncdn.com"],
          logoRightsReviewDate: "2030-01-01",
        },
      }),
    ).toThrow();
    expect(() =>
      parseApiSportsCatalog({
        leagues: [rawConfig],
        presentation: {
          allowRemoteLogos: true,
          allowedLogoHosts: ["images.example.test"],
          allowedLogoQueryParameters: ["access_token"],
          logoRightsReviewDate: "2030-01-01",
        },
      }),
    ).toThrow("Credential-bearing logo query parameters");
    const reviewedPresentation = parseApiSportsCatalog({
      leagues: [rawConfig],
      presentation: {
        allowRemoteLogos: true,
        allowedLogoHosts: ["images.example.test"],
        logoRightsReviewDate: "2030-01-01",
      },
    }).presentation;
    expect(
      normalizeApiSportsGame(
        {
          ...first,
          teams: {
            ...(first.teams as object),
            home: {
              ...((first.teams as {home: object}).home),
              logo: "https://images.example.test:444/teams/home.png",
            },
          },
        },
        config,
        reviewedPresentation,
      ).homeTeam.logoUrl,
    ).toBeNull();
  });

  it("rejects protocol-relative games paths at schema and runtime", () => {
    expect(() =>
      parseApiSportsConfigs([
        {...rawConfig, gamesPath: "//localhost/games"},
      ]),
    ).toThrow();
    expect(() =>
      resolveApiSportsGamesUrl({
        ...config,
        gamesPath: "//localhost/games",
      }),
    ).toThrow("escaped its configured origin");
  });

  it("fails closed without a validated config and maps unknown status to review", async () => {
    await expect(
      new ApiSportsProvider([]).listGames({
        sportCode: "baseball",
        leagueCode: "mlb",
        providerLeagueId: "9000",
        season: "2030",
        from: "2030-09-01",
        to: "2030-09-01",
        timezone: "UTC",
      }),
    ).rejects.toThrow("have not been validated");
    const first = apiSportsFixture.response[0] as Record<string, unknown>;
    const game = normalizeApiSportsGame(
      {...first, status: {short: "UNKNOWN_TERMINAL"}},
      config,
    );
    expect(game.status).toBe("reviewRequired");
    expect(game.winnerTeamId).toBeNull();
    expect(mapApiSportsStatus("IN7", ["FT"])).toBe("live");
    expect(mapApiSportsStatus("POST", ["FT"])).toBe("postponed");
    expect(mapApiSportsStatus("SUSP", ["FT"])).toBe("reviewRequired");
    expect(mapApiSportsStatus("ABD", ["FT"])).toBe("reviewRequired");
  });

  it("refreshes 20 selected IDs in two bounded concurrent waves", async () => {
    vi.stubEnv("API_SPORTS_KEY", "sanitized-test-key");
    let inFlight = 0;
    let maximumInFlight = 0;
    const requestedIds: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url =
        input instanceof URL
          ? input
          : typeof input === "string"
            ? new URL(input)
            : new URL(input.url);
      const id = url.searchParams.get("id");
      if (id === null) throw new Error("Expected a selected-game ID.");
      requestedIds.push(id);
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await new Promise((resolve) =>
        setTimeout(resolve, id === "910001" ? 5 : 2),
      );
      inFlight -= 1;
      return new Response(JSON.stringify(selectedGameEnvelope(id)), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-requests-remaining":
            id === "910001" ? "60" : "80",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const ids = Array.from({length: 20}, (_, index) =>
      String(910001 + index),
    );
    const provider = new ApiSportsProvider([config]);

    const games = await provider.fetchGames(ids, selectedGameContext);

    expect(games.map((game) => game.providerGameId)).toEqual(ids);
    expect(requestedIds).toEqual(ids);
    expect(maximumInFlight).toBe(API_SPORTS_SELECTED_GAME_CONCURRENCY);
    expect(provider.getRequestAttemptCount()).toBe(20);
    await expect(provider.getHealth()).resolves.toMatchObject({
      quotaRemaining: 60,
    });
  });

  it("stops before a later wave when a selected ID is missing", async () => {
    vi.stubEnv("API_SPORTS_KEY", "sanitized-test-key");
    const ids = Array.from({length: 20}, (_, index) =>
      String(920001 + index),
    );
    let completedSiblingRequests = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url =
        input instanceof URL
          ? input
          : typeof input === "string"
            ? new URL(input)
            : new URL(input.url);
      const id = url.searchParams.get("id");
      if (id === null) throw new Error("Expected a selected-game ID.");
      if (id === ids[0]) {
        return new Response(
          JSON.stringify({
            errors: [],
            results: 0,
            paging: {current: 1, total: 1},
            response: [],
          }),
          {status: 200, headers: {"content-type": "application/json"}},
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2));
      completedSiblingRequests += 1;
      return new Response(JSON.stringify(selectedGameEnvelope(id)), {
        status: 200,
        headers: {"content-type": "application/json"},
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new ApiSportsProvider([config]).fetchGames(ids, selectedGameContext),
    ).rejects.toThrow("incomplete selected-game response");
    expect(fetchMock).toHaveBeenCalledTimes(
      API_SPORTS_SELECTED_GAME_CONCURRENCY,
    );
    expect(completedSiblingRequests).toBe(
      API_SPORTS_SELECTED_GAME_CONCURRENCY - 1,
    );
  });

  it("maps provider HTTP 429 to resource-exhausted without retrying", async () => {
    vi.stubEnv("API_SPORTS_KEY", "sanitized-test-key");
    const fetchMock = vi.fn(async () =>
      new Response("quota", {status: 429}),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ApiSportsProvider([config]);

    await expect(
      provider.fetchGames(["930001"], selectedGameContext),
    ).rejects.toMatchObject({code: "resource-exhausted"});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(provider.getRequestAttemptCount()).toBe(1);
  });

  it("authorizes a retry before its network attempt", async () => {
    vi.stubEnv("API_SPORTS_KEY", "sanitized-test-key");
    const events: string[] = [];
    let fetchCount = 0;
    const fetchMock = vi.fn(async () => {
      fetchCount += 1;
      events.push(`fetch-${fetchCount}`);
      if (fetchCount === 1) return new Response("temporary", {status: 503});
      return new Response(JSON.stringify(selectedGameEnvelope("900001")), {
        status: 200,
        headers: {"content-type": "application/json"},
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ApiSportsProvider([config]);
    provider.setRetryAuthorizer(async () => {
      events.push("authorize-retry");
    });
    try {
      await provider.listGames(selectedGameContext);
    } finally {
      provider.setRetryAuthorizer(null);
    }
    expect(events).toEqual(["fetch-1", "authorize-retry", "fetch-2"]);
    expect(provider.getRequestAttemptCount()).toBe(2);
  });

  it("stops before retry network use when local authorization fails", async () => {
    vi.stubEnv("API_SPORTS_KEY", "sanitized-test-key");
    const fetchMock = vi.fn(async () =>
      new Response("temporary", {status: 503}),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ApiSportsProvider([config]);
    provider.setRetryAuthorizer(async () => {
      throw new Error("local Firestore rejection");
    });
    try {
      await expect(
        provider.listGames(selectedGameContext),
      ).rejects.toBeInstanceOf(ApiSportsRetryAuthorizationError);
    } finally {
      provider.setRetryAuthorizer(null);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(provider.getRequestAttemptCount()).toBe(1);
  });

  it("performs no request when the API key is missing", async () => {
    vi.stubEnv("API_SPORTS_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ApiSportsProvider([config]);
    await expect(
      provider.listGames(selectedGameContext),
    ).rejects.toThrow("secret is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(provider.getRequestAttemptCount()).toBe(0);
  });
});

describe("sanitized mock MLB fixtures", () => {
  it("keeps overlapping day identities stable across query windows", async () => {
    const provider = new MockSportsProvider();
    const base = {
      sportCode: "baseball",
      leagueCode: "mlb",
      providerLeagueId: "synthetic-mlb-fixture",
      season: "fixture",
      timezone: "America/Chicago",
    };
    const day = await provider.listGames({
      ...base,
      from: "2030-09-02",
      to: "2030-09-02",
    });
    const range = await provider.listGames({
      ...base,
      from: "2030-09-01",
      to: "2030-09-03",
    });
    const overlapping = range.filter(
      (game) => game.scheduledAtUtc.toISOString().startsWith("2030-09-02"),
    );
    expect(overlapping.map((game) => game.id)).toEqual(
      day.map((game) => game.id),
    );
    expect(overlapping.map((game) => game.homeTeam.id)).toEqual(
      day.map((game) => game.homeTeam.id),
    );
  });
});

describe("provider runtime policy", () => {
  const production: ProviderRuntime = {
    projectId: "lukes-picks",
    emulator: false,
    allowTheSportsDbTest: false,
    allowApiSports: false,
    allowEspn: false,
  };
  const local: ProviderRuntime = {
    projectId: "demo-lukes-picks-local",
    emulator: true,
    allowTheSportsDbTest: false,
    allowApiSports: false,
    allowEspn: false,
  };

  it("defaults arenas to manual and rejects test modes in production", () => {
    expect(leagueSettingsSchema.parse({}).providerName).toBe("manual");
    expect(isProviderAllowed("manual", production)).toBe(true);
    expect(isProviderAllowed("mock", production)).toBe(false);
    expect(
      isProviderAllowed("theSportsDbTest", {
        ...production,
        allowTheSportsDbTest: true,
      }),
    ).toBe(false);
    expect(isProviderAllowed("apiSports", production)).toBe(false);
    expect(
      isProviderAllowed("apiSports", {
        ...production,
        allowApiSports: true,
      }),
    ).toBe(true);
    expect(
      isProviderAllowed("apiSports", {
        ...production,
        projectId: "another-project",
        allowApiSports: true,
      }),
    ).toBe(false);
    expect(
      isProviderAllowed("apiSports", {
        ...production,
        emulator: true,
        allowApiSports: true,
      }),
    ).toBe(false);
    expect(
      providerRuntime({GCLOUD_PROJECT: "lukes-picks"}).allowApiSports,
    ).toBe(false);
  });

  it("keeps settings updates as patches instead of resetting provider policy", () => {
    const parsed = updateLeagueSettingsSchema.parse({
      requestId: "settings-patch-0001",
      leagueId: "league-alpha",
      settings: {pickerParticipatesInPicks: true},
    });
    expect(parsed.settings).toEqual({pickerParticipatesInPicks: true});
    expect(parsed.settings).not.toHaveProperty("providerName");
  });

  it("requires both the approved emulator project and explicit test flag", () => {
    expect(isProviderAllowed("mock", local)).toBe(true);
    expect(isProviderAllowed("theSportsDbTest", local)).toBe(false);
    expect(
      isProviderAllowed("theSportsDbTest", {
        ...local,
        allowTheSportsDbTest: true,
      }),
    ).toBe(true);
    expect(
      isProviderAllowed("theSportsDbTest", {
        ...local,
        projectId: "demo-another-project",
        allowTheSportsDbTest: true,
      }),
    ).toBe(false);
  });

  it("rejects stale catalog providers and applies runtime policy on save", () => {
    expect(() =>
      validateCatalogProviderForLeague("mock", "manual", production),
    ).toThrow("does not match");
    expect(() =>
      validateCatalogProviderForLeague(
        "theSportsDbTest",
        "manual",
        production,
      ),
    ).toThrow("does not match");
    expect(() =>
      validateCatalogProviderForLeague("mock", "mock", production),
    ).toThrow("restricted");
    expect(
      validateCatalogProviderForLeague("mock", "mock", local),
    ).toBe("mock");
  });
});

describe("catalog input and provider response hardening", () => {
  const request = {
    requestId: "catalog_request_0001",
    leagueId: "league-test",
    weekId: "week-0001",
    sportCode: "american-football",
    leagueCode: "test-football",
    leagueIdForProvider: "4391",
    season: "2030",
    from: "2030-09-01",
    to: "2030-09-07",
    timezone: "America/Chicago",
    forceRefresh: false,
  };

  it("requires week context and bounds catalog ranges to seven days", () => {
    expect(sportsCatalogSchema.safeParse(request).success).toBe(true);
    const {weekId: _weekId, ...withoutWeek} = request;
    expect(sportsCatalogSchema.safeParse(withoutWeek).success).toBe(false);
    expect(
      sportsCatalogSchema.safeParse({...request, to: "2030-09-08"}).success,
    ).toBe(false);
    expect(
      sportsCatalogSchema.safeParse({...request, to: "2030-08-31"}).success,
    ).toBe(false);
    expect(
      sportsCatalogSchema.safeParse({
        requestId: request.requestId,
        leagueId: request.leagueId,
        weekId: request.weekId,
        from: request.from,
        to: request.to,
        timezone: request.timezone,
      }).success,
    ).toBe(true);
    expect(
      sportsCatalogSchema.safeParse({
        requestId: request.requestId,
        leagueId: request.leagueId,
        weekId: request.weekId,
        timezone: request.timezone,
        forceRefresh: false,
      }).success,
    ).toBe(true);
    expect(
      sportsCatalogSchema.safeParse({
        requestId: request.requestId,
        leagueId: request.leagueId,
        weekId: request.weekId,
        from: request.from,
        timezone: request.timezone,
      }).success,
    ).toBe(false);
    expect(
      sportsCatalogSchema.safeParse({...request, timezone: "Not/A_Timezone"})
        .success,
    ).toBe(false);
  });

  it("resolves canonical server metadata and rejects forged metadata", () => {
    const leagues = [
      {
        code: "mlb",
        name: "MLB",
        sportCode: "baseball",
        providerLeagueId: "sanitized-league-id",
        season: "sanitized-season",
      },
    ];
    const base = {
      from: "2030-09-01",
      to: "2030-09-01",
      timezone: "America/Chicago",
    };
    expect(resolveCatalogLeague(base, leagues)).toEqual(leagues[0]);
    expect(
      resolveCatalogLeague(
        {...base, sportCode: "baseball", leagueCode: "mlb"},
        leagues,
      ),
    ).toEqual(leagues[0]);
    expect(
      resolveCatalogLeague(
        {...base, leagueCode: "mlb", providerLeagueId: "forged"},
        leagues,
      ),
    ).toBeNull();
    expect(() =>
      assertCatalogQueryWithinWeek({
        query: {
          sportCode: "baseball",
          leagueCode: "mlb",
          providerLeagueId: "sanitized-league-id",
          season: "sanitized-season",
          from: "2030-09-01",
          to: "2030-09-07",
          timezone: "America/Chicago",
        },
        arenaTimezone: "America/Chicago",
        weekStartAt: new Date("2030-09-01T05:00:00.000Z"),
        weekEndAt: new Date("2030-09-08T04:59:59.999Z"),
      }),
    ).not.toThrow();
    expect(() =>
      assertCatalogQueryWithinWeek({
        query: {
          sportCode: "baseball",
          leagueCode: "mlb",
          providerLeagueId: "sanitized-league-id",
          season: "sanitized-season",
          from: "2030-09-01",
          to: "2030-09-08",
          timezone: "America/Chicago",
        },
        arenaTimezone: "America/Chicago",
        weekStartAt: new Date("2030-09-01T05:00:00.000Z"),
        weekEndAt: new Date("2030-09-08T04:59:59.999Z"),
      }),
    ).toThrow("active week");
    expect(
      boundedRemainingWeekRange({
        now: new Date("2030-09-03T15:00:00.000Z"),
        timezone: "America/Chicago",
        weekStartAt: new Date("2030-09-01T05:00:00.000Z"),
        weekEndAt: new Date("2030-09-15T04:59:59.999Z"),
      }),
    ).toEqual({from: "2030-09-03", to: "2030-09-09"});
  });

  it("validates and deduplicates normalized provider games", () => {
    const games = normalizedFixtureGames();
    expect(
      validateAndDeduplicateProviderGames([
        games[0],
        games[0],
        games[1],
      ]),
    ).toHaveLength(2);
    expect(() =>
      validateAndDeduplicateProviderGames([
        games[0],
        {...games[0], homeTeam: {...games[0]?.homeTeam, id: ""}},
      ]),
    ).toThrow();
  });

  it("requires every requested selected-game ID before caching", () => {
    const games = normalizedFixtureGames();
    const requestedIds = new Set(
      games.map((game) => game.providerGameId),
    );
    expect(() =>
      assertCompleteSelectedGamesResponse(
        "theSportsDbTest",
        requestedIds,
        games,
      ),
    ).not.toThrow();
    expect(() =>
      assertCompleteSelectedGamesResponse(
        "theSportsDbTest",
        requestedIds,
        games.slice(0, 1),
      ),
    ).toThrow("incomplete selected-game refresh");
    expect(() =>
      assertCompleteSelectedGamesResponse(
        "theSportsDbTest",
        requestedIds,
        [],
      ),
    ).toThrow("incomplete selected-game refresh");
  });

  it("charges actual attempts and refunds only unused base reservations", () => {
    expect(
      quotaReservationSettlement(20, 0, 100, 120),
    ).toEqual({
      actualRequestCount: 20,
      actualBaseRequestCount: 20,
      authorizedRetryRequestCount: 0,
      refundBaseRequestCount: 0,
    });
    expect(
      quotaReservationSettlement(20, 2, 100, 122),
    ).toEqual({
      actualRequestCount: 22,
      actualBaseRequestCount: 20,
      authorizedRetryRequestCount: 2,
      refundBaseRequestCount: 0,
    });
    expect(
      quotaReservationSettlement(20, 0, 100, 110),
    ).toEqual({
      actualRequestCount: 10,
      actualBaseRequestCount: 10,
      authorizedRetryRequestCount: 0,
      refundBaseRequestCount: 10,
    });
    expect(
      quotaReservationSettlement(20, 0, 100, 100),
    ).toEqual({
      actualRequestCount: 0,
      actualBaseRequestCount: 0,
      authorizedRetryRequestCount: 0,
      refundBaseRequestCount: 20,
    });
    expect(
      quotaReservationSettlement(20, 2, null, null),
    ).toEqual({
      actualRequestCount: 22,
      actualBaseRequestCount: 20,
      authorizedRetryRequestCount: 2,
      refundBaseRequestCount: 0,
    });
  });

  it("allows four healthy 20-game cycles up to the 80-call soft limit", () => {
    for (const [requestCount, providerReportedRemaining] of [
      [0, 100],
      [20, 80],
      [40, 60],
      [60, 40],
    ]) {
      expect(
        providerQuotaReservationAllowed({
          requestCount: requestCount ?? 0,
          requestedCount: 20,
          softLimit: 80,
          providerReportedRemaining: providerReportedRemaining ?? null,
          unreportedRequestCount: 0,
        }),
      ).toBe(true);
    }
    expect(
      providerQuotaReservationAllowed({
        requestCount: 80,
        requestedCount: 20,
        softLimit: 80,
        providerReportedRemaining: null,
        unreportedRequestCount: 0,
      }),
    ).toBe(false);
    expect(
      providerQuotaReservationAllowed({
        requestCount: 40,
        requestedCount: 1,
        softLimit: 80,
        providerReportedRemaining: 6,
        unreportedRequestCount: 1,
      }),
    ).toBe(false);
    expect(minimumProviderQuotaRemaining(60, 80)).toBe(60);
    expect(minimumProviderQuotaRemaining(80, 60)).toBe(60);
    expect(minimumProviderQuotaRemaining(60, null)).toBe(60);
  });

  it("does not classify local retry authorization rejection as provider failure", () => {
    expect(
      shouldRecordProviderFailure(
        new ApiSportsRetryAuthorizationError(new Error("local quota")),
        1,
      ),
    ).toBe(false);
    expect(shouldRecordProviderFailure(new Error("provider"), 1)).toBe(true);
    expect(shouldRecordProviderFailure(new Error("missing key"), 0)).toBe(
      false,
    );
  });

  it("keeps selected terminal results on a finite scheduler-visible TTL", () => {
    const finalGame = normalizedFixtureGames().find(
      (game) => game.status === "final",
    );
    if (finalGame === undefined) throw new Error("Final fixture is missing.");
    expect(
      providerCacheDurationMs([finalGame], "selectedGames"),
    ).toBe(SELECTED_GAMES_TERMINAL_CACHE_DURATION_MS);
    expect(
      providerCacheDurationMs([finalGame], "games"),
    ).toBe(10 * 365 * 24 * 60 * 60 * 1000);
    expect(SELECTED_GAMES_TERMINAL_CACHE_DURATION_MS).toBeLessThan(
      24 * 60 * 60 * 1000,
    );
  });

  it("keeps cancelled catalog games discoverable for reinstatement", () => {
    const finalGame = normalizedFixtureGames().find(
      (game) => game.status === "final",
    );
    if (finalGame === undefined) throw new Error("Final fixture is missing.");
    const cancelledGame = {
      ...finalGame,
      status: "cancelled" as const,
      homeScore: null,
      awayScore: null,
      winnerTeamId: null,
    };
    const afterScheduledGame = new Date("2040-01-01T00:00:00.000Z");
    expect(
      providerCacheDurationMs(
        [cancelledGame],
        "games",
        afterScheduledGame,
      ),
    ).toBe(
      30 * 60 * 1000,
    );
    expect(
      providerCacheDurationMs(
        [finalGame, cancelledGame],
        "games",
        afterScheduledGame,
      ),
    ).toBe(30 * 60 * 1000);
  });

  it("hashes cache items order-independently and rejects partial metadata", () => {
    const games = normalizedFixtureGames();
    const contentHash = providerGamesContentHash(games);
    expect(providerGamesContentHash([...games].reverse())).toBe(contentHash);
    expect(
      providerCacheSnapshotMatchesMetadata(games, {
        contentHash,
        itemCount: games.length,
      }),
    ).toBe(true);
    expect(
      providerCacheSnapshotMatchesMetadata(games.slice(0, 1), {
        contentHash,
        itemCount: games.length,
      }),
    ).toBe(false);
    expect(
      providerCacheSnapshotMatchesMetadata(games, {
        contentHash: "0".repeat(64),
        itemCount: games.length,
      }),
    ).toBe(false);
  });

  it("never shortens trust for identical canonical cross-cache content", () => {
    const [existingGame] = normalizedFixtureGames();
    if (existingGame === undefined) {
      throw new Error("Provider fixture is missing.");
    }
    const sameContentAtT3 = {
      ...existingGame,
      providerLastUpdatedAt: new Date("2030-09-02T03:00:00.000Z"),
      lastSyncedAt: new Date("2030-09-02T03:00:00.000Z"),
    };
    const longEligibility = new Date("2030-09-03T00:00:00.000Z");
    const shortEligibility = new Date("2030-09-02T03:15:00.000Z");
    const sameContentDecision = catalogTrustDecision({
      existingGame,
      existingEligibleUntil: longEligibility,
      incomingGame: sameContentAtT3,
      incomingEligibleUntil: shortEligibility,
    });
    expect(sameContentDecision).toEqual({
      action: "extend",
      eligibleUntil: longEligibility,
      incomingIsCanonical: true,
      observationUpdate: {
        providerLastUpdatedAt: sameContentAtT3.providerLastUpdatedAt,
        lastSyncedAt: sameContentAtT3.lastSyncedAt,
      },
    });
    const canonicalAtT3 = {
      ...existingGame,
      providerLastUpdatedAt:
        sameContentDecision.observationUpdate?.providerLastUpdatedAt ??
        existingGame.providerLastUpdatedAt,
      lastSyncedAt:
        sameContentDecision.observationUpdate?.lastSyncedAt ??
        existingGame.lastSyncedAt,
    };
    const divergentAtT2 = {
      ...existingGame,
      providerLastUpdatedAt: new Date("2030-09-02T02:30:00.000Z"),
      lastSyncedAt: new Date("2030-09-02T02:30:00.000Z"),
      sourcePayloadHash: "b".repeat(64),
    };
    expect(
      catalogTrustDecision({
        existingGame: canonicalAtT3,
        existingEligibleUntil: longEligibility,
        incomingGame: divergentAtT2,
        incomingEligibleUntil: shortEligibility,
      }),
    ).toEqual({
      action: "keep",
      eligibleUntil: longEligibility,
      incomingIsCanonical: false,
      observationUpdate: null,
    });
    const divergentAtT4 = {
      ...divergentAtT2,
      providerLastUpdatedAt: new Date("2030-09-02T04:00:00.000Z"),
      lastSyncedAt: new Date("2030-09-02T04:00:00.000Z"),
    };
    expect(
      catalogTrustDecision({
        existingGame: canonicalAtT3,
        existingEligibleUntil: longEligibility,
        incomingGame: divergentAtT4,
        incomingEligibleUntil: shortEligibility,
      }),
    ).toEqual({
      action: "replace",
      eligibleUntil: shortEligibility,
      incomingIsCanonical: true,
      observationUpdate: null,
    });
  });

  it("marks a force-refresh fallback stale after any cache write error", () => {
    const games = normalizedFixtureGames();
    const freshCache = {
      games,
      cacheHit: true,
      stale: false,
      delayed: false,
      cachedAt: new Date("2030-09-02T02:00:00.000Z"),
      expiresAt: new Date("2030-09-03T02:00:00.000Z"),
      contentHash: providerGamesContentHash(games),
    };
    expect(
      cacheFallbackAfterRefreshError(
        freshCache,
        new CanonicalTrustConflictError("newer canonical game won"),
      ),
    ).toMatchObject({stale: true, delayed: false});
    expect(
      cacheFallbackAfterRefreshError(freshCache, new Error("cache write")),
    ).toMatchObject({stale: true, delayed: false});
  });

  it("keeps the provider lock beyond the endpoint execution window", () => {
    expect(PROVIDER_CACHE_LOCK_LEASE_MS).toBe(660_000);
    const gatewayPath = fileURLToPath(
      new URL("../src/services/providerGateway.ts", import.meta.url),
    );
    const gatewaySource = readFileSync(gatewayPath, "utf8");
    expect(gatewaySource).toMatch(
      /Date\.now\(\) \+ PROVIDER_CACHE_LOCK_LEASE_MS/,
    );
    expect(gatewaySource).toMatch(
      /shouldRecordProviderFailure\(error, settlement\.actualRequestCount\)/,
    );
    expect(gatewaySource.match(/recordProviderFailure\(/g)).toHaveLength(2);
    expect(gatewaySource).toContain(
      "if (publicError instanceof HttpsError) throw publicError;",
    );
    expect(gatewaySource).toContain("clearRetryAuthorizer();");
    expect(gatewaySource).toContain(
      "cached = {...cached, stale: true};",
    );
    expect(gatewaySource).toContain(
      "const cacheRemainsCanonical = await writeCatalogTrust",
    );
    expect(gatewaySource).toContain(
      "cached: cacheFallbackAfterRefreshError(cached, error)",
    );
    expect(gatewaySource).toContain(
      "const estimate = providerRequestEstimate(",
    );
    expect(gatewaySource).toContain(
      "baseRequestCount: estimate.baseRequestCount",
    );
    expect(gatewaySource).not.toContain("API_SPORTS_MAX_REQUEST_ATTEMPTS");
  });

  it("separates cache entries by canonical provider metadata and timezone", () => {
    const provider = new TheSportsDbTestProvider([providerConfig]);
    const base = providerCacheKey(provider, query);
    expect(
      providerCacheKey(provider, {...query, timezone: "America/Chicago"}),
    ).not.toBe(base);
    expect(
      providerCacheKey(provider, {
        ...query,
        providerLeagueId: "different-league",
      }),
    ).not.toBe(base);
  });

  it("treats the source payload hash as canonical cache content", () => {
    const [game] = normalizedFixtureGames();
    if (game === undefined) throw new Error("Provider fixture is missing.");
    expect(
      providerGamesContentHash([
        {...game, sourcePayloadHash: "b".repeat(64)},
      ]),
    ).not.toBe(providerGamesContentHash([game]));
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

describe("provider source allowlist", () => {
  it("contains ESPN hosts only in the literal allowlisted adapter", () => {
    const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
    const broadcasterDomain = ["espn", "com"].join(".");
    const forbiddenHosts = [
      ["site", "api", broadcasterDomain].join("."),
      ["site", "web", "api", broadcasterDomain].join("."),
      ["a", "espncdn", "com"].join("."),
    ];
    for (const path of sourceFiles(sourceRoot)) {
      const source = readFileSync(path, "utf8").toLowerCase();
      if (path.endsWith(join("providers", "espn.ts"))) {
        expect(source).toContain("https://site.api.espn.com");
        expect(source).toContain('const espn_logo_host = "a.espncdn.com"');
        continue;
      }
      for (const host of forbiddenHosts) {
        expect(source).not.toContain(host);
      }
    }
  });

  it("declares only required secrets and deployable fail-closed flags", () => {
    const configPath = fileURLToPath(new URL("../src/config.ts", import.meta.url));
    const configSource = readFileSync(configPath, "utf8");
    expect(configSource).not.toMatch(
      /defineSecret\(\s*["']API_SPORTS_KEY["']\s*\)/,
    );
    expect(configSource).toMatch(/process\.env\.API_SPORTS_KEY/);
    expect(configSource).not.toMatch(/defineSecret\(\s*["']COLLEGE_FOOTBALL_DATA_KEY/);
    expect(configSource).toMatch(
      /defineSecret\(\s*["']INVITE_CODE_PEPPER["']\s*\)/,
    );
    expect(configSource).toMatch(
      /defineBoolean\(\s*["']ALLOW_API_SPORTS_PROVIDER["'][\s\S]*default:\s*false/,
    );
    expect(configSource).toMatch(
      /defineBoolean\(\s*["']ALLOW_ESPN_PROVIDER["'][\s\S]*default:\s*false/,
    );
  });

  it("does not bind an optional provider secret to generic Functions", () => {
    const genericFunctions = new Set([
      "listSportsCatalog",
      "refreshSelectedGames",
      "syncSelectedGameResults",
      "scheduledResultSync",
    ]);
    const observed = new Set<string>();
    for (const [name, candidate] of Object.entries(functionExports)) {
      const endpoint = (
        candidate as {
          __endpoint?: {
            secretEnvironmentVariables?: Array<{key?: string}>;
          };
        }
      ).__endpoint;
      const secrets = new Set(
        endpoint?.secretEnvironmentVariables?.map((secret) => secret.key) ?? [],
      );
      if (secrets.has("API_SPORTS_KEY")) observed.add(name);
      if (genericFunctions.has(name)) {
        expect(secrets.has("API_SPORTS_KEY"), name).toBe(false);
      }
    }
    expect(observed).toEqual(new Set());
  });
});
