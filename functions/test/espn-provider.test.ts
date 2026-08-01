import {readFileSync} from "node:fs";
import {describe, expect, it, vi} from "vitest";
import {
  ESPN_LEAGUE_CONFIGS,
  ESPN_MAX_REQUEST_ATTEMPTS,
  ESPN_SCOREBOARD_ORIGIN,
  EspnProvider,
  isEspnOwnedHost,
  mapEspnStatus,
  normalizeEspnScoreboard,
  parseEspnCatalog,
  resolveEspnScoreboardUrl,
  type EspnLeagueConfig,
} from "../src/providers/espn.js";
import {MockSportsProvider} from "../src/providers/mock.js";
import {isProviderAllowed} from "../src/providers/policy.js";
import {
  assertCompleteSelectedGamesResponse,
  ESPN_EMPTY_CACHE_DURATION_MS,
  ESPN_FUTURE_CACHE_DURATION_MS,
  ESPN_LIVE_CACHE_DURATION_MS,
  ESPN_UPCOMING_CACHE_DURATION_MS,
  providerCacheDurationMs,
  providerCacheKey,
  selectedGameRefreshMaximumIds,
  selectedGamesCacheKey,
  SELECTED_GAMES_TERMINAL_CACHE_DURATION_MS,
} from "../src/services/providerGateway.js";
import type {NormalizedGame, ProviderQuery} from "../src/types.js";

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/espn-scoreboard.sanitized.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {events: unknown[]; leagues?: unknown[]};

function leagueConfig(id: string): EspnLeagueConfig {
  const config = ESPN_LEAGUE_CONFIGS.find((item) => item.id === id);
  if (config === undefined) throw new Error(`Missing ESPN config: ${id}`);
  return config;
}

const mlbConfig = leagueConfig("mlb");
const query: ProviderQuery = {
  sportCode: "baseball",
  leagueCode: "mlb",
  providerLeagueId: "mlb",
  season: "2031",
  from: "2031-06-10",
  to: "2031-06-12",
  timezone: "UTC",
};

function fixtureGames(): NormalizedGame[] {
  return normalizeEspnScoreboard(
    fixture,
    mlbConfig,
    new Date("2031-06-12T23:00:00.000Z"),
  );
}

describe("ESPN league configuration and URL allowlist", () => {
  it("defines exactly the supported eight leagues", () => {
    expect(ESPN_LEAGUE_CONFIGS.map((item) => item.id)).toEqual([
      "nfl",
      "college-football",
      "nba",
      "wnba",
      "mens-college-basketball",
      "womens-college-basketball",
      "mlb",
      "nhl",
    ]);
  });

  it("pins NCAA groups, large limits, and the requested date range", () => {
    const footballUrl = resolveEspnScoreboardUrl(
      leagueConfig("college-football"),
      {from: "2031-09-01", to: "2031-09-07"},
    );
    expect(footballUrl.origin).toBe(ESPN_SCOREBOARD_ORIGIN);
    expect(footballUrl.pathname).toBe(
      "/apis/site/v2/sports/football/college-football/scoreboard",
    );
    expect(footballUrl.searchParams.get("dates")).toBe(
      "20310901-20310907",
    );
    expect(footballUrl.searchParams.get("groups")).toBe("80");
    expect(footballUrl.searchParams.get("limit")).toBe("500");

    for (const id of [
      "mens-college-basketball",
      "womens-college-basketball",
    ]) {
      const url = resolveEspnScoreboardUrl(leagueConfig(id), {
        from: "2031-01-02",
        to: "2031-01-02",
      });
      expect(url.searchParams.get("groups"), id).toBe("50");
      expect(url.searchParams.get("limit"), id).toBe("500");
      expect(url.searchParams.get("dates"), id).toBe("20310102");
    }
  });
});

describe("ESPN normalization", () => {
  it("maps scheduled, live, interruption, terminal, and unknown statuses", () => {
    expect(mapEspnStatus("STATUS_SCHEDULED", "pre")).toBe("scheduled");
    expect(mapEspnStatus("STATUS_IN_PROGRESS", "in")).toBe("live");
    expect(mapEspnStatus("STATUS_DELAYED", "pre")).toBe("delayed");
    expect(mapEspnStatus("STATUS_POSTPONED", "pre")).toBe("postponed");
    expect(mapEspnStatus("STATUS_SUSPENDED", "in")).toBe("suspended");
    expect(mapEspnStatus("STATUS_CANCELED", "pre")).toBe("cancelled");
    expect(mapEspnStatus("STATUS_FINAL", "post", true)).toBe("final");
    expect(mapEspnStatus("STATUS_NEW_SHAPE", "mystery")).toBe(
      "reviewRequired",
    );
  });

  it("skips malformed events while preserving valid exact event IDs", () => {
    const games = fixtureGames();
    expect(games).toHaveLength(5);
    expect(games.map((game) => game.id)).toEqual([
      "espn:baseball:1001",
      "espn:baseball:1002",
      "espn:baseball:1003",
      "espn:baseball:1004",
      "espn:baseball:1005",
    ]);
  });

  it("accepts an empty schedule but rejects a wholly unusable event envelope", () => {
    expect(
      normalizeEspnScoreboard({...fixture, events: []}, mlbConfig),
    ).toEqual([]);
    const malformedEvents = fixture.events.slice(-2);
    expect(malformedEvents).toHaveLength(2);
    expect(() =>
      normalizeEspnScoreboard(
        {...fixture, events: malformedEvents},
        mlbConfig,
      ),
    ).toThrow("events but none could be normalized");
  });

  it("bounds noncritical upstream labels instead of dropping the event", () => {
    const event = structuredClone(
      fixture.events[0] as Record<string, unknown>,
    );
    const status = (event.status ??= {}) as Record<string, unknown>;
    const statusType = (status.type ??= {}) as Record<string, unknown>;
    statusType.detail = `Status ${"x".repeat(300)}`;
    const [competition] = event.competitions as Array<Record<string, unknown>>;
    if (competition === undefined) throw new Error("Fixture competition missing.");
    competition.venue = {fullName: `Venue ${"y".repeat(300)}`};
    event.week = {text: `Round ${"z".repeat(300)}`};
    event.season = {year: 2031, slug: `${"q".repeat(100)}-season`};

    const [game] = normalizeEspnScoreboard(
      {...fixture, events: [event]},
      mlbConfig,
    );
    expect(game?.statusDetail).toHaveLength(120);
    expect(game?.venueName).toHaveLength(160);
    expect(game?.weekOrRound).toHaveLength(80);
    expect(game?.seasonType).toHaveLength(40);
  });

  it("falls back to competition status when the event status type is unusable", () => {
    const event = structuredClone(
      fixture.events[0] as Record<string, unknown>,
    );
    event.status = {clock: 0, type: {state: "post", completed: false}};
    const [competition] = event.competitions as Array<Record<string, unknown>>;
    if (competition === undefined) throw new Error("Fixture competition missing.");
    competition.status = {
      type: {
        name: "STATUS_DELAYED",
        state: "pre",
        completed: false,
        detail: "Weather delay",
      },
    };
    const [game] = normalizeEspnScoreboard(
      {...fixture, events: [event]},
      mlbConfig,
    );
    expect(game).toMatchObject({
      status: "delayed",
      statusDetail: "Weather delay",
    });
  });

  it("keeps an unknown named event status in review despite stale competition status", () => {
    const event = structuredClone(
      fixture.events[0] as Record<string, unknown>,
    );
    event.status = {
      type: {
        name: "STATUS_NEW_SHAPE",
        state: "mystery",
        detail: "New provider state",
      },
    };
    const [competition] = event.competitions as Array<Record<string, unknown>>;
    if (competition === undefined) throw new Error("Fixture competition missing.");
    competition.status = {
      type: {
        name: "STATUS_SCHEDULED",
        state: "pre",
        detail: "Scheduled",
      },
    };
    const [game] = normalizeEspnScoreboard(
      {...fixture, events: [event]},
      mlbConfig,
    );
    expect(game).toMatchObject({
      status: "reviewRequired",
      statusDetail: "New provider state",
    });
  });

  it("normalizes sparse final scores, winner, time, venue, and broadcast", () => {
    const game = fixtureGames().find((item) => item.providerGameId === "1002");
    expect(game).toMatchObject({
      provider: "espn",
      status: "final",
      statusDetail: "Final",
      homeScore: 7,
      awayScore: 3,
      winnerTeamId: "h2",
      seasonType: "regular",
      venueName: "Sanitized Park",
      broadcast: "TESTNET",
      rawResponseVersion: 1,
    });
    expect(game?.scheduledAtUtc.toISOString()).toBe(
      "2031-06-10T20:30:00.000Z",
    );
    expect(game?.homeTeam.logoUrl).toBe(
      "https://a.espncdn.com/i/teamlogos/sanitized/home.png",
    );
    expect(game?.homeTeam.color).toBe("#123abc");
    expect(game?.awayTeam.logoUrl).toBeNull();
  });

  it("keeps pregame scores null and routes tied finals to review", () => {
    const games = fixtureGames();
    const scheduled = games.find((item) => item.providerGameId === "1001");
    expect(scheduled).toMatchObject({
      status: "scheduled",
      homeScore: null,
      awayScore: null,
      winnerTeamId: null,
    });
    expect(scheduled?.homeTeam.logoUrl).toBeNull();
    expect(games.find((item) => item.providerGameId === "1003")).toMatchObject({
      status: "reviewRequired",
      homeScore: 4,
      awayScore: 4,
      winnerTeamId: null,
    });
  });

  it("keeps doubleheaders distinct and carries their game labels", () => {
    const games = fixtureGames();
    const first = games.find((item) => item.providerGameId === "1004");
    const second = games.find((item) => item.providerGameId === "1005");
    expect(first?.id).not.toBe(second?.id);
    expect(first?.homeTeam.id).toBe(second?.homeTeam.id);
    expect(first?.awayTeam.id).toBe(second?.awayTeam.id);
    expect(first?.eventDetail).toBe("Doubleheader - Game 1");
    expect(second?.eventDetail).toBe("Doubleheader - Game 2");
  });
});

describe("ESPN activation and provider behavior", () => {
  it("centralizes ESPN-owned host detection for presentation policy", () => {
    expect(isEspnOwnedHost("espn.com")).toBe(true);
    expect(isEspnOwnedHost("WWW.ESPN.COM.")).toBe(true);
    expect(isEspnOwnedHost("a.espncdn.com")).toBe(true);
    expect(isEspnOwnedHost("notespn.com")).toBe(false);
    expect(isEspnOwnedHost("espn.com.example.test")).toBe(false);
  });

  it("requires reviewed authorization and keeps logos fail-closed", () => {
    expect(parseEspnCatalog({})).toEqual({
      enabled: false,
      presentation: expect.objectContaining({
        provider: "espn",
        allowRemoteLogos: false,
        allowedLogoHosts: [],
      }),
    });
    expect(() => parseEspnCatalog({enabled: true})).toThrow();
    expect(() =>
      parseEspnCatalog({
        enabled: true,
        authorizationReference: "review-2031-001",
        authorizationReviewedAt: "2031-05-01",
        presentation: {allowRemoteLogos: true},
      }),
    ).toThrow();
    const enabled = parseEspnCatalog({
      enabled: true,
      authorizationReference: "review-2031-001",
      authorizationReviewedAt: "2031-05-01",
      presentation: {
        allowRemoteLogos: true,
        logoRightsReviewDate: "2031-05-01",
      },
    });
    expect(enabled).toEqual({
      enabled: true,
      presentation: expect.objectContaining({
        allowRemoteLogos: true,
        allowedLogoHosts: ["a.espncdn.com"],
        allowedLogoQueryParameters: [],
      }),
    });
    expect(enabled).not.toHaveProperty("authorizationReference");
  });

  it("requires the production project and flag and rejects emulator use", () => {
    expect(
      isProviderAllowed("espn", {
        projectId: "lukes-picks",
        emulator: false,
        allowTheSportsDbTest: false,
        allowApiSports: false,
        allowEspn: true,
      }),
    ).toBe(true);
    expect(
      isProviderAllowed("espn", {
        projectId: "lukes-picks",
        emulator: true,
        allowTheSportsDbTest: false,
        allowApiSports: false,
        allowEspn: true,
      }),
    ).toBe(false);
  });

  it("filters scoreboard results by requested IDs and meters one request", async () => {
    const requestedUrls: string[] = [];
    const fetchImplementation: typeof fetch = async (input) => {
      requestedUrls.push(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      return new Response(JSON.stringify(fixture), {status: 200});
    };
    const provider = new EspnProvider(
      ESPN_LEAGUE_CONFIGS,
      parseEspnCatalog({}).presentation,
      fetchImplementation,
    );
    const games = await provider.fetchGames(["1001", "not-returned"], query);
    expect(games.map((game) => game.providerGameId)).toEqual(["1001"]);
    expect(provider.getRequestAttemptCount()).toBe(1);
    expect(provider.requestEstimate("fetchGames", 2)).toEqual({
      baseRequestCount: 1,
      maximumRequestCount: ESPN_MAX_REQUEST_ATTEMPTS,
    });
    const requestedUrl = new URL(requestedUrls[0] ?? "");
    expect(requestedUrl.searchParams.get("dates")).toBe(
      "20310610-20310612",
    );
    expect(requestedUrl.searchParams.get("limit")).toBe("500");
  });

  it("raises only selected-refresh limits while preserving catalog defaults", () => {
    for (const id of ["nfl", "nba", "wnba", "mlb", "nhl"]) {
      const config = leagueConfig(id);
      const ordinary = resolveEspnScoreboardUrl(config, query);
      const selected = resolveEspnScoreboardUrl(
        config,
        query,
        "selectedGames",
      );
      expect(ordinary.searchParams.get("limit"), id).toBe("100");
      expect(selected.searchParams.get("limit"), id).toBe("500");
    }
  });

  it("refreshes more than 20 ESPN IDs with one bounded scoreboard request", async () => {
    const requestedUrls: string[] = [];
    const provider = new EspnProvider(
      ESPN_LEAGUE_CONFIGS,
      parseEspnCatalog({}).presentation,
      async (input) => {
        requestedUrls.push(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url,
        );
        return new Response(JSON.stringify(fixture), {status: 200});
      },
    );
    const requestedIds = Array.from({length: 25}, (_, index) =>
      index === 0 ? "1001" : `missing-${index}`,
    );
    const games = await provider.fetchGames(requestedIds, query);
    expect(games.map((game) => game.providerGameId)).toEqual(["1001"]);
    expect(selectedGameRefreshMaximumIds(provider)).toBe(500);
    expect(requestedUrls).toHaveLength(1);
    expect(provider.getRequestAttemptCount()).toBe(1);
  });

  it("retries a transient failure only after retry authorization", async () => {
    const retryAuthorizer = vi.fn(async () => undefined);
    let attempts = 0;
    const provider = new EspnProvider(
      ESPN_LEAGUE_CONFIGS,
      parseEspnCatalog({}).presentation,
      async () => {
        attempts += 1;
        return attempts === 1
          ? new Response("temporary", {status: 503})
          : new Response(JSON.stringify(fixture), {status: 200});
      },
    );
    provider.setRetryAuthorizer(retryAuthorizer);
    await expect(provider.listGames(query)).resolves.toHaveLength(5);
    provider.setRetryAuthorizer(null);
    expect(attempts).toBe(2);
    expect(retryAuthorizer).toHaveBeenCalledTimes(1);
  });

  it("fails closed on rate limiting, invalid JSON, and oversized bodies", async () => {
    const cases: Array<{
      response: Response;
      expected: string | {code: string};
    }> = [
      {
        response: new Response("limited", {status: 429}),
        expected: {code: "resource-exhausted"},
      },
      {
        response: new Response("not-json", {status: 200}),
        expected: "invalid JSON",
      },
      {
        response: new Response("{}", {
          status: 200,
          headers: {"content-length": "10000001"},
        }),
        expected: "safe size limit",
      },
    ];
    for (const testCase of cases) {
      const provider = new EspnProvider(
        ESPN_LEAGUE_CONFIGS,
        parseEspnCatalog({}).presentation,
        async () => testCase.response,
      );
      const promise = provider.listGames(query);
      if (typeof testCase.expected === "string") {
        await expect(promise).rejects.toThrow(testCase.expected);
      } else {
        await expect(promise).rejects.toMatchObject(testCase.expected);
      }
      expect(provider.getRequestAttemptCount()).toBe(1);
    }
  });

  it("allows an ESPN partial selected refresh but rejects unexpected games", () => {
    const games = fixtureGames();
    const oneGame = games.filter((game) => game.providerGameId === "1001");
    const requested = new Set(["1001", "missing"]);
    expect(() =>
      assertCompleteSelectedGamesResponse("espn", requested, oneGame, true),
    ).not.toThrow();
    expect(() =>
      assertCompleteSelectedGamesResponse("espn", requested, oneGame),
    ).toThrow();
    expect(() =>
      assertCompleteSelectedGamesResponse(
        "espn",
        requested,
        games.filter((game) => game.providerGameId === "1002"),
        true,
      ),
    ).toThrow();
  });
});

describe("ESPN-aware cache durations", () => {
  const now = new Date("2031-06-01T00:00:00.000Z");

  function atOffset(
    game: NormalizedGame,
    hours: number,
    status: NormalizedGame["status"] = "scheduled",
  ): NormalizedGame {
    return {
      ...game,
      status,
      scheduledAtUtc: new Date(now.valueOf() + hours * 60 * 60 * 1000),
    };
  }

  it("uses ESPN cadence while retaining terminal selected games", () => {
    const base = fixtureGames()[0];
    if (base === undefined) throw new Error("Fixture game missing.");
    expect(providerCacheDurationMs([atOffset(base, 25)], "games", now, "espn"))
      .toBe(ESPN_FUTURE_CACHE_DURATION_MS);
    expect(providerCacheDurationMs([atOffset(base, 3)], "games", now, "espn"))
      .toBe(ESPN_UPCOMING_CACHE_DURATION_MS);
    expect(providerCacheDurationMs([atOffset(base, 1)], "games", now, "espn"))
      .toBe(15 * 60 * 1000);
    expect(providerCacheDurationMs([atOffset(base, 1, "live")], "games", now, "espn"))
      .toBe(ESPN_LIVE_CACHE_DURATION_MS);
    expect(providerCacheDurationMs([atOffset(base, -1, "final")], "selectedGames", now, "espn"))
      .toBe(SELECTED_GAMES_TERMINAL_CACHE_DURATION_MS);
    expect(providerCacheDurationMs([atOffset(base, 25)], "games", now))
      .toBe(12 * 60 * 60 * 1000);
    expect(providerCacheDurationMs([], "games", now, "espn"))
      .toBe(ESPN_EMPTY_CACHE_DURATION_MS);
    expect(providerCacheDurationMs([], "games", now, "apiSports"))
      .toBe(2 * 60 * 60 * 1000);
  });

  it("deduplicates ESPN cache identity across unused season and timezone context", () => {
    const provider = new EspnProvider();
    const alternateContext = {
      ...query,
      season: "2099",
      timezone: "Pacific/Auckland",
    };
    expect(providerCacheKey(provider, alternateContext)).toBe(
      providerCacheKey(provider, query),
    );
    expect(
      selectedGamesCacheKey(provider, ["1002", "1001"], alternateContext),
    ).toBe(selectedGamesCacheKey(provider, ["1001", "1002"], query));

    const genericProvider = new MockSportsProvider();
    expect(providerCacheKey(genericProvider, alternateContext)).not.toBe(
      providerCacheKey(genericProvider, query),
    );
  });
});
