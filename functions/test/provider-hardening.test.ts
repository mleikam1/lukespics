import {
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {
  leagueSettingsSchema,
  sportsCatalogSchema,
  updateLeagueSettingsSchema,
} from "../src/schemas.js";
import {
  isProviderAllowed,
  type ProviderRuntime,
} from "../src/providers/policy.js";
import {
  normalizeTheSportsDbEvents,
  THE_SPORTS_DB_ATTRIBUTION,
  TheSportsDbTestProvider,
  theSportsDbSmallImageUrl,
} from "../src/providers/theSportsDbTest.js";
import {validateAndDeduplicateProviderGames} from "../src/services/providerGateway.js";
import {validateCatalogProviderForLeague} from "../src/services/weeks.js";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/thesportsdb-eventsday.sanitized.json", import.meta.url),
    "utf8",
  ),
) as {events: unknown[]};

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
  leagueId: providerConfig.providerLeagueId,
  season: providerConfig.season,
  from: "2030-09-01",
  to: "2030-09-01",
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

describe("provider runtime policy", () => {
  const production: ProviderRuntime = {
    projectId: "lukes-picks",
    emulator: false,
    allowTheSportsDbTest: false,
    allowApiSports: false,
  };
  const local: ProviderRuntime = {
    projectId: "demo-lukes-picks-local",
    emulator: true,
    allowTheSportsDbTest: false,
    allowApiSports: false,
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
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

describe("provider source allowlist", () => {
  it("contains no forbidden broadcaster API or image hosts", () => {
    const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
    const broadcasterDomain = ["espn", "com"].join(".");
    const forbiddenHosts = [
      ["site", "api", broadcasterDomain].join("."),
      ["site", "web", "api", broadcasterDomain].join("."),
      ["a", "espncdn", "com"].join("."),
    ];
    for (const path of sourceFiles(sourceRoot)) {
      const source = readFileSync(path, "utf8").toLowerCase();
      for (const host of forbiddenHosts) {
        expect(source).not.toContain(host);
      }
    }
  });

  it("does not declare dormant provider credentials as deploy-time secrets", () => {
    const configPath = fileURLToPath(new URL("../src/config.ts", import.meta.url));
    const configSource = readFileSync(configPath, "utf8");
    expect(configSource).not.toMatch(
      /defineSecret\(\s*["'](?:API_SPORTS_KEY|COLLEGE_FOOTBALL_DATA_KEY)["']\s*\)/,
    );
    expect(configSource).toMatch(
      /defineSecret\(\s*["']INVITE_CODE_PEPPER["']\s*\)/,
    );
  });
});
