import {describe, expect, it} from "vitest";
import {
  finalWinner,
  resultVersionFor,
  withSourceHash,
} from "../src/providers/normalization.js";
import {MockSportsProvider} from "../src/providers/mock.js";
import {
  gameResultVersionsAreStable,
  scoreEntry,
} from "../src/services/scoring.js";
import {
  emptyCatalogAvailabilityState,
  isCatalogGameSelectable,
  preserveSelectedGameParticipants,
  protectedSelectedGameLock,
} from "../src/services/weeks.js";

describe("authoritative scoring", () => {
  const games = [
    {
      id: "final-home",
      status: "final",
      winnerTeamId: "home",
      resultVersion: "version-home",
      revealed: true,
    },
    {
      id: "final-away",
      status: "final",
      winnerTeamId: "away",
      resultVersion: "version-away",
      revealed: true,
    },
    {
      id: "void-game",
      status: "void",
      winnerTeamId: null,
      resultVersion: "version-void",
      revealed: true,
    },
    {
      id: "pending-game",
      status: "postponed",
      winnerTeamId: null,
      resultVersion: "version-pending",
      revealed: true,
    },
  ];

  it("awards one point per correct pick, counts missing, and excludes void", () => {
    const result = scoreEntry("member", true, games, [
      {gameId: "final-home", selectedTeamId: "home"},
      {gameId: "void-game", selectedTeamId: "one"},
    ]);
    expect(result).toMatchObject({
      points: 1,
      correctCount: 1,
      incorrectCount: 1,
      gradedCount: 2,
      voidCount: 1,
      accuracy: 0.5,
    });
  });

  it("excludes an ineligible picker from all denominators", () => {
    expect(
      scoreEntry("picker", false, games, [
        {gameId: "final-home", selectedTeamId: "home"},
      ]),
    ).toEqual({
      uid: "picker",
      eligible: false,
      gradedCount: 0,
      correctCount: 0,
      incorrectCount: 0,
      voidCount: 0,
      points: 0,
      accuracy: null,
    });
  });

  it("is deterministic when delivery is duplicated", () => {
    const picks = [{gameId: "final-home", selectedTeamId: "home"}];
    expect(scoreEntry("member", true, games, picks)).toEqual(
      scoreEntry("member", true, games, picks),
    );
  });

  it("ignores final and void results until server reveal completes", () => {
    const result = scoreEntry(
      "member",
      true,
      [
        {
          id: "future-final",
          status: "final",
          winnerTeamId: "home",
          resultVersion: "future-final-version",
          revealed: false,
        },
        {
          id: "future-void",
          status: "void",
          winnerTeamId: null,
          resultVersion: "future-void-version",
          revealed: false,
        },
      ],
      [{gameId: "future-final", selectedTeamId: "home"}],
    );

    expect(result).toMatchObject({
      points: 0,
      correctCount: 0,
      incorrectCount: 0,
      gradedCount: 0,
      voidCount: 0,
      accuracy: null,
    });
  });

  it("detects a changed, added, or removed game result during finalization", () => {
    const first = {id: "game-a", resultVersion: "version-a"};
    const claimed = [
      first,
      {id: "game-b", resultVersion: "version-b"},
    ];
    expect(gameResultVersionsAreStable(claimed, [...claimed])).toBe(true);
    expect(
      gameResultVersionsAreStable(claimed, [
        first,
        {id: "game-b", resultVersion: "corrected-version"},
      ]),
    ).toBe(false);
    expect(gameResultVersionsAreStable(claimed, [first])).toBe(false);
    expect(
      gameResultVersionsAreStable(claimed, [
        ...claimed,
        {id: "game-c", resultVersion: "version-c"},
      ]),
    ).toBe(false);
  });
});

describe("result normalization", () => {
  it("uses a stable outcome version that ignores sync timestamps", () => {
    const first = resultVersionFor({
      status: "final",
      homeScore: 24,
      awayScore: 17,
      winnerTeamId: "home",
      manualOverride: false,
    });
    const second = resultVersionFor({
      status: "final",
      homeScore: 24,
      awayScore: 17,
      winnerTeamId: "home",
      manualOverride: false,
    });
    expect(first).toBe(second);
  });

  it("flags a true final tie for commissioner review", () => {
    expect(finalWinner("final", "home", "away", 21, 21)).toEqual({
      status: "reviewRequired",
      winnerTeamId: null,
    });
  });

  it("keeps result versions stable across volatile provider timestamps", () => {
    const base = {
      id: "mock:football:1",
      provider: "mock",
      providerGameId: "1",
      providerLeagueId: "demo-football",
      sportCode: "football",
      leagueCode: "demo-football",
      leagueName: "Demo Football",
      season: "demo",
      weekOrRound: null,
      scheduledAtUtc: new Date("2030-01-01T18:00:00.000Z"),
      publishedScheduledAtUtc: new Date("2030-01-01T18:00:00.000Z"),
      effectiveLockAtUtc: new Date("2030-01-01T18:00:00.000Z"),
      venueName: null,
      neutralSite: false,
      homeTeam: {
        id: "home",
        name: "Home",
        shortName: "Home",
        abbreviation: "HOM",
        logoUrl: null,
      },
      awayTeam: {
        id: "away",
        name: "Away",
        shortName: "Away",
        abbreviation: "AWY",
        logoUrl: null,
      },
      status: "final" as const,
      homeScore: 10,
      awayScore: 7,
      winnerTeamId: "home",
      manualOverride: false,
      manualOverrideReason: null,
      manualOverrideBy: null,
    };
    const first = withSourceHash(
      {
        ...base,
        providerLastUpdatedAt: new Date("2030-01-01T20:00:00.000Z"),
        lastSyncedAt: new Date("2030-01-01T20:00:00.000Z"),
      },
      {id: 1},
    );
    const second = withSourceHash(
      {
        ...base,
        providerLastUpdatedAt: new Date("2030-01-01T21:00:00.000Z"),
        lastSyncedAt: new Date("2030-01-01T21:00:00.000Z"),
      },
      {id: 1},
    );
    expect(first.resultVersion).toBe(second.resultVersion);
  });
});

describe("mock provider contract", () => {
  it("returns deterministic normalized games without network access", async () => {
    const provider = new MockSportsProvider();
    const query = {
      sportCode: "football",
      leagueCode: "demo-football",
      providerLeagueId: "demo-football",
      season: "demo",
      from: "2030-09-01",
      to: "2030-09-01",
      timezone: "UTC",
    };
    const first = await provider.listGames(query);
    const second = await provider.listGames(query);
    expect(first).toHaveLength(8);
    expect(first.map((game) => game.id)).toEqual(
      second.map((game) => game.id),
    );
    expect(first.every((game) => game.homeTeam.logoUrl === null)).toBe(true);
  });
});

describe("catalog eligibility", () => {
  it("distinguishes an empty exact date from an empty broader range", () => {
    expect(
      emptyCatalogAvailabilityState({
        discovery: false,
        dateMode: "today",
        from: "2030-09-01",
        to: "2030-09-01",
      }),
    ).toBe("noGamesScheduled");
    expect(
      emptyCatalogAvailabilityState({
        discovery: false,
        dateMode: "allDates",
        from: "2030-09-01",
        to: "2030-09-07",
      }),
    ).toBe("offSeason");
    expect(
      emptyCatalogAvailabilityState({
        discovery: true,
        dateMode: undefined,
        from: "2030-09-01",
        to: "2030-09-01",
      }),
    ).toBe("offSeason");
  });

  it("accepts only future scheduled-like games in the configured week", async () => {
    const provider = new MockSportsProvider();
    const [game] = await provider.listGames({
      sportCode: "football",
      leagueCode: "demo-football",
      providerLeagueId: "demo-football",
      season: "demo",
      from: "2030-09-01",
      to: "2030-09-01",
      timezone: "UTC",
    });
    expect(game).toBeDefined();
    if (game === undefined) return;
    const input = {
      now: new Date("2030-08-31T00:00:00.000Z"),
      weekStartAt: new Date("2030-09-01T00:00:00.000Z"),
      weekEndAt: new Date("2030-09-08T00:00:00.000Z"),
      enabledSports: ["football"],
      enabledLeagues: ["demo-football"],
    };
    expect(isCatalogGameSelectable(game, input)).toBe(true);
    expect(
      isCatalogGameSelectable({...game, status: "postponed"}, input),
    ).toBe(false);
    expect(isCatalogGameSelectable({...game, status: "final"}, input)).toBe(
      false,
    );
    expect(
      isCatalogGameSelectable(game, {
        ...input,
        now: new Date("2030-09-02T00:00:00.000Z"),
      }),
    ).toBe(false);
    expect(
      isCatalogGameSelectable(game, {
        ...input,
        weekStartAt: new Date("2030-09-02T00:00:00.000Z"),
      }),
    ).toBe(false);
    expect(
      isCatalogGameSelectable(game, {
        ...input,
        enabledLeagues: ["another-league"],
      }),
    ).toBe(false);
  });
});

describe("selected-game result trust", () => {
  it("never widens a published first-game lock during result refresh", () => {
    const mondayLock = new Date("2030-09-02T18:00:00.000Z");
    const tuesdayProviderStart = new Date("2030-09-03T18:00:00.000Z");
    expect(
      protectedSelectedGameLock({
        currentLockAt: mondayLock,
        refreshedLockAt: tuesdayProviderStart,
        alreadyExposed: false,
      }),
    ).toEqual(mondayLock);
    const earlierCorrection = new Date("2030-09-02T16:00:00.000Z");
    expect(
      protectedSelectedGameLock({
        currentLockAt: mondayLock,
        refreshedLockAt: earlierCorrection,
        alreadyExposed: false,
      }),
    ).toEqual(earlierCorrection);
  });

  it("quarantines a provider participant change without rewriting the slate", async () => {
    const provider = new MockSportsProvider();
    const [current, replacement] = await provider.listGames({
      sportCode: "football",
      leagueCode: "demo-football",
      providerLeagueId: "demo-football",
      season: "demo",
      from: "2030-09-01",
      to: "2030-09-01",
      timezone: "UTC",
    });
    expect(current).toBeDefined();
    expect(replacement).toBeDefined();
    if (current === undefined || replacement === undefined) return;

    const reconciled = preserveSelectedGameParticipants(current, {
      ...current,
      homeTeam: replacement.homeTeam,
      awayTeam: replacement.awayTeam,
      status: "final",
      homeScore: 5,
      awayScore: 2,
      winnerTeamId: replacement.homeTeam.id,
      sourcePayloadHash: replacement.sourcePayloadHash,
    });

    expect(reconciled.homeTeam.id).toBe(current.homeTeam.id);
    expect(reconciled.awayTeam.id).toBe(current.awayTeam.id);
    expect(reconciled.status).toBe("reviewRequired");
    expect(reconciled.homeScore).toBeNull();
    expect(reconciled.awayScore).toBeNull();
    expect(reconciled.winnerTeamId).toBeNull();
  });
});
