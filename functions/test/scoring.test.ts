import {describe, expect, it} from "vitest";
import {Timestamp} from "firebase-admin/firestore";
import {
  finalWinner,
  resultVersionFor,
  withSourceHash,
} from "../src/providers/normalization.js";
import {MockSportsProvider} from "../src/providers/mock.js";
import {
  leagueSettingsSchema,
  normalizedGameSchema,
  overrideGameSchema,
  selectedGamesSchema,
} from "../src/schemas.js";
import {
  gameResultVersionsAreStable,
  scoreEntry,
} from "../src/services/scoring.js";
import {
  emptyCatalogAvailabilityState,
  effectiveStoredGameLock,
  hasDuplicateSportsDataIoGameAliases,
  isCatalogGameSelectable,
  MAX_GAME_RESCHEDULE_OFFSET_MS,
  preserveSelectedGameParticipants,
  preserveSelectedGameSchedule,
  protectedFirstGameSlateLock,
  protectedSelectedGameLock,
  resolveGameOverride,
  selectedGameRefreshDateRange,
} from "../src/services/weeks.js";
import type {NormalizedGame} from "../src/types.js";

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
      provider: "mock" as const,
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
  const scheduledGame = normalizedGameSchema.parse({
    id: "mock:football:scheduled",
    provider: "mock",
    providerGameId: "scheduled",
    providerLeagueId: "demo-football",
    sportCode: "football",
    leagueCode: "demo-football",
    leagueName: "Demo Football",
    season: "demo",
    weekOrRound: null,
    scheduledAtUtc: new Date("2030-09-02T18:00:00.000Z"),
    publishedScheduledAtUtc: new Date("2030-09-02T18:00:00.000Z"),
    effectiveLockAtUtc: new Date("2030-09-02T18:00:00.000Z"),
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
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    winnerTeamId: null,
    providerLastUpdatedAt: new Date("2030-09-01T00:00:00.000Z"),
    lastSyncedAt: new Date("2030-09-01T00:00:00.000Z"),
    manualOverride: false,
    manualOverrideReason: null,
    manualOverrideBy: null,
    resultVersion: "scheduled-version",
    sourcePayloadHash: "a".repeat(64),
  }) as NormalizedGame;

  it("preserves an honest time-TBD game but never makes it selectable", () => {
    const tbd = normalizedGameSchema.parse({
      ...scheduledGame,
      id: "sportsDataIo:football:tbd",
      provider: "sportsDataIo",
      providerGameId: "tbd",
      scheduledAtUtc: null,
      publishedScheduledAtUtc: null,
      effectiveLockAtUtc: null,
      scheduledDayEastern: "2030-09-02",
      timeTbd: true,
    });
    expect(tbd.timeTbd).toBe(true);
    expect(
      isCatalogGameSelectable(tbd, {
        now: new Date("2030-09-01T00:00:00.000Z"),
      }),
    ).toBe(false);
    expect(() =>
      normalizedGameSchema.parse({
        ...tbd,
        scheduledAtUtc: new Date("2030-09-02T16:00:00.000Z"),
      }),
    ).toThrow("invented lock instant");
  });

  it("uses the published schedule when a provider cancellation omits its time", () => {
    const cancelledWithoutTime = normalizedGameSchema.parse({
      ...scheduledGame,
      scheduledAtUtc: null,
      publishedScheduledAtUtc: null,
      effectiveLockAtUtc: null,
      scheduledDayEastern: "2030-09-02",
      timeTbd: true,
      status: "cancelled",
      isClosed: false,
      resultVersion: "cancelled-version",
      sourcePayloadHash: "b".repeat(64),
    }) as NormalizedGame;

    const refreshed = preserveSelectedGameSchedule(
      scheduledGame,
      cancelledWithoutTime,
    );

    expect(refreshed).toMatchObject({
      status: "cancelled",
      scheduledAtUtc: scheduledGame.scheduledAtUtc,
      effectiveLockAtUtc: scheduledGame.effectiveLockAtUtc,
      timeTbd: false,
    });
  });

  it("reads historical provenance without allowing it in active settings", () => {
    expect(
      normalizedGameSchema.parse({
        ...scheduledGame,
        id: "espn:football:historical",
        provider: "espn",
        providerGameId: "historical",
      }).provider,
    ).toBe("espn");
    expect(() =>
      leagueSettingsSchema.parse({providerName: "espn"}),
    ).toThrow();
  });

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

describe("SportsDataIO draft identity safety", () => {
  const scoreIdentity = {
    id: "sportsDataIo:football:5001",
    provider: "sportsDataIo",
    providerLeagueId: "nfl",
    leagueCode: "nfl",
    providerGameId: "5001",
    providerScoreId: "5001",
    providerLeagueGameId: null,
    providerGlobalGameId: null,
    providerGameKey: null,
  };

  it("detects one NFL event submitted under ScoreID and GameID", () => {
    expect(
      hasDuplicateSportsDataIoGameAliases([
        scoreIdentity,
        {
          ...scoreIdentity,
          id: "sportsDataIo:football:7001",
          providerGameId: "7001",
          providerLeagueGameId: "7001",
        },
      ]),
    ).toBe(true);
  });

  it("keeps provider ID namespaces distinct when numeric values overlap", () => {
    expect(
      hasDuplicateSportsDataIoGameAliases([
        {
          ...scoreIdentity,
          providerLeagueGameId: "7001",
        },
        {
          ...scoreIdentity,
          id: "sportsDataIo:football:7001",
          providerGameId: "7001",
          providerScoreId: "7001",
          providerLeagueGameId: "8001",
        },
      ]),
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

describe("admin game refresh and override validation", () => {
  const originalStart = new Date("2030-09-03T18:00:00.000Z");
  const baseOverride = {
    currentScheduledAtUtc: originalStart,
    currentPublishedScheduledAtUtc: originalStart,
    currentEffectiveLockAtUtc: originalStart,
    homeTeamId: "home",
    awayTeamId: "away",
    status: "scheduled" as const,
    homeScore: null,
    awayScore: null,
    winnerTeamId: null,
  };

  it("requires a scoped selected-game refresh to be forced", () => {
    const base = {
      requestId: "refresh_request_0001",
      leagueId: "league",
      weekId: "week",
      gameId: "game",
    };
    expect(selectedGamesSchema.safeParse(base).success).toBe(false);
    expect(
      selectedGamesSchema.safeParse({...base, forceRefresh: true}).success,
    ).toBe(true);
    expect(
      selectedGamesSchema.safeParse({
        requestId: "refresh_request_0002",
        leagueId: "league",
        weekId: "week",
      }).success,
    ).toBe(true);
  });

  it("builds selected SportsDataIO buckets from the US Eastern day", () => {
    expect(
      selectedGameRefreshDateRange({
        scheduledAtUtc: new Date("2030-03-10T05:30:00.000Z"),
        timezone: "America/New_York",
      }),
    ).toEqual({from: "2030-03-10", to: "2030-03-10"});
    expect(
      selectedGameRefreshDateRange({
        scheduledAtUtc: new Date("2031-01-01T04:30:00.000Z"),
        timezone: "America/New_York",
      }),
    ).toEqual({from: "2030-12-31", to: "2030-12-31"});
  });

  it("keeps other selected refreshes on their supplied calendar timezone", () => {
    expect(
      selectedGameRefreshDateRange({
        scheduledAtUtc: new Date("2031-01-01T01:30:00.000Z"),
        timezone: "America/Chicago",
      }),
    ).toEqual({from: "2030-12-31", to: "2030-12-31"});
  });

  it("preserves the published start and never widens the effective lock", () => {
    const later = new Date("2030-09-03T20:00:00.000Z");
    const delayed = resolveGameOverride({
      ...baseOverride,
      scheduledAtUtc: later,
      status: "delayed",
    });
    expect(delayed.scheduledAtUtc).toEqual(later);
    expect(delayed.publishedScheduledAtUtc).toEqual(originalStart);
    expect(delayed.effectiveLockAtUtc).toEqual(originalStart);

    const earlier = new Date("2030-09-03T16:00:00.000Z");
    const tightened = resolveGameOverride({
      ...baseOverride,
      scheduledAtUtc: earlier,
      status: "postponed",
    });
    expect(tightened.effectiveLockAtUtc).toEqual(earlier);
  });

  it("keeps a first-game slate lock monotonic and authoritative", () => {
    const original = new Date("2030-09-03T18:00:00.000Z");
    const earlier = new Date("2030-09-03T16:00:00.000Z");
    const later = new Date("2030-09-03T20:00:00.000Z");

    expect(
      protectedFirstGameSlateLock({
        currentSlateLockAt: original,
        candidateLockAt: earlier,
      }),
    ).toEqual(earlier);
    expect(
      protectedFirstGameSlateLock({
        currentSlateLockAt: earlier,
        candidateLockAt: later,
      }),
    ).toEqual(earlier);

    const slateTimestamp = Timestamp.fromDate(earlier);
    const gameTimestamp = Timestamp.fromDate(later);
    expect(
      effectiveStoredGameLock(
        {
          lockPolicySnapshot: "firstGame",
          effectiveSlateLockAtUtc: slateTimestamp,
        },
        {effectiveLockAtUtc: gameTimestamp},
      )?.toMillis(),
    ).toBe(slateTimestamp.toMillis());
    expect(
      effectiveStoredGameLock(
        {lockPolicySnapshot: "firstGame"},
        {effectiveLockAtUtc: gameTimestamp},
      )?.toMillis(),
    ).toBe(gameTimestamp.toMillis());
  });

  it("allows cross-week moves but rejects implausible reschedule dates", () => {
    const outsideWeek = new Date("2030-09-09T18:00:00.000Z");
    expect(
      resolveGameOverride({
        ...baseOverride,
        scheduledAtUtc: outsideWeek,
        status: "postponed",
      }).scheduledAtUtc,
    ).toEqual(outsideWeek);
    expect(() =>
      resolveGameOverride({
        ...baseOverride,
        scheduledAtUtc: new Date(
          originalStart.valueOf() + MAX_GAME_RESCHEDULE_OFFSET_MS + 1,
        ),
      }),
    ).toThrow();
  });

  it("rejects outcomes on nonterminal statuses", () => {
    expect(() =>
      resolveGameOverride({
        ...baseOverride,
        status: "suspended",
        homeScore: 2,
      }),
    ).toThrow();
    expect(
      overrideGameSchema.safeParse({
        requestId: "override_request_0001",
        leagueId: "league",
        weekId: "week",
        gameId: "game",
        status: "void",
        homeScore: 1,
        awayScore: null,
        winnerTeamId: null,
        reason: "A sufficiently detailed audit reason.",
      }).success,
    ).toBe(false);
  });

  it("validates finals and produces a stable manual result version", () => {
    const finalInput = {
      ...baseOverride,
      status: "final" as const,
      homeScore: 7,
      awayScore: 3,
      winnerTeamId: "home",
    };
    const first = resolveGameOverride(finalInput);
    const second = resolveGameOverride(finalInput);
    expect(first.resultVersion).toBe(second.resultVersion);
    expect(() =>
      resolveGameOverride({...finalInput, winnerTeamId: "away"}),
    ).toThrow();
  });

  it("keeps void picks outside the graded denominator", () => {
    expect(
      scoreEntry(
        "member",
        true,
        [
          {
            id: "void-only",
            status: "void",
            winnerTeamId: null,
            resultVersion: "void-version",
            revealed: true,
          },
        ],
        [{gameId: "void-only", selectedTeamId: "home"}],
      ),
    ).toMatchObject({
      gradedCount: 0,
      correctCount: 0,
      incorrectCount: 0,
      voidCount: 1,
      points: 0,
      accuracy: null,
    });
  });
});
