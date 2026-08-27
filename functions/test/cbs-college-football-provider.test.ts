import {describe, expect, it} from "vitest";
import {
  buildCbsCollegeFootballScoreboardUrl,
  CBS_COLLEGE_FOOTBALL_PARSER_VERSION,
  parseCbsCollegeFootballScoreboardHtml,
  sanitizeCbsCollegeFootballLogoUrl,
} from "../src/providers/cbsCollegeFootball.js";

const context = {
  season: 2030,
  seasonType: "regular" as const,
  week: 1,
  division: "FBS" as const,
  observedAt: new Date("2030-08-28T12:00:00.000Z"),
};

function teamRow(input: {
  name: string;
  slug?: string;
  side?: "away" | "home";
  abbreviation?: string;
  score?: number;
  logo?: string;
}): string {
  const side = input.side === undefined ? "" : ` data-side="${input.side}"`;
  const abbreviation =
    input.abbreviation === undefined
      ? ""
      : ` data-abbreviation="${input.abbreviation}"`;
  const score =
    input.score === undefined ? "" : `<span class="score">${input.score}</span>`;
  const logo =
    input.logo === undefined ? "" : `<img src="${input.logo}" alt="">`;
  const slug = input.slug ?? input.name.toLowerCase().replaceAll(" ", "-");
  return `
    <div class="team"${side}${abbreviation}>
      ${logo}
      <a class="team-name-link" href="/college-football/teams/${slug}/">${input.name}</a>
      ${score}
    </div>`;
}

function statusCard(input: {
  id: string;
  status: string;
  awayScore?: number;
  homeScore?: number;
}): string {
  return `
    <article class="single-score-card" data-game-id="${input.id}"
      data-game-date="2030-08-31" data-start-time="2030-08-31T16:00:00Z"
      data-game-status="${input.status}">
      ${teamRow({
        name: `${input.id} Away`,
        side: "away",
        ...(input.awayScore === undefined ? {} : {score: input.awayScore}),
      })}
      ${teamRow({
        name: `${input.id} Home`,
        side: "home",
        ...(input.homeScore === undefined ? {} : {score: input.homeScore}),
      })}
    </article>`;
}

const preloadedGameAbbreviation = "NCAAF_20300829_AWY@HOM";
const preloadedGameEpoch = Date.parse("2030-08-29T16:00:00.000Z") / 1_000;
const postseasonGameAbbreviation = "NCAAF_20260109_OREG@IND";
const postseasonGameEpoch = Date.parse("2026-01-10T00:30:00.000Z") / 1_000;

function preloadedState(input: {
  config?: Record<string, unknown>;
  game?: Record<string, unknown>;
} = {}): Record<string, unknown> {
  return {
    config: {
      arenaAbbr: "ncaaf",
      league: "ncaaf",
      year: "2030",
      season: "regular",
      week: "1",
      ...input.config,
    },
    games: [
      {
        id: 50027398,
        abbr: preloadedGameAbbreviation,
        gameAbbr: preloadedGameAbbreviation,
        status: "SCHEDULED",
        scheduled_date_time: "2030-08-29 12:00 EDT",
        scheduled_epoch: preloadedGameEpoch,
        seasonType: "regular",
        seasonYear: 2030,
        meta: {weekNumber: 1, cbsWeekNumber: 1},
        ...input.game,
      },
    ],
  };
}

function postseasonPreloadedState(input: {
  config?: Record<string, unknown>;
  game?: Record<string, unknown>;
} = {}): Record<string, unknown> {
  return {
    config: {
      arenaAbbr: "ncaaf",
      league: "ncaaf",
      year: "2025",
      season: "postseason",
      week: "20",
      ...input.config,
    },
    games: [
      {
        id: 50022911,
        abbr: postseasonGameAbbreviation,
        gameAbbr: postseasonGameAbbreviation,
        status: "SCHEDULED",
        // This is the current CBS winter shape: the wall clock is Eastern
        // standard time even though CBS leaves the display suffix as "EDT".
        scheduled_date_time: "2026-01-09 19:30 EDT",
        scheduled_epoch: postseasonGameEpoch,
        seasonType: "post",
        seasonYear: 2025,
        meta: {weekNumber: 20, cbsWeekNumber: 18},
        ...input.game,
      },
    ],
  };
}

function preloadedStateScript(value: unknown): string {
  const encoded = Buffer.from(JSON.stringify(value), "utf8").toString(
    "base64",
  );
  return `<script>
    define('reduxPreloadedState', [], function() {
      return JSON.parse( atob('${encoded}') || '{}' );
    });
  </script>`;
}

function currentLikePreloadedCard(input: {
  id?: string;
  abbreviation?: string;
  startTime?: string;
} = {}): string {
  const startTime = input.startTime === undefined
    ? ""
    : ` data-start-time="${input.startTime}"`;
  return `<article class="single-score-card"
      id="game-${input.id ?? "50027398"}"
      data-abbrev="${input.abbreviation ?? preloadedGameAbbreviation}"${startTime}>
    <div class="game-status pregame"><span class="pregame-date"></span></div>
    ${teamRow({name: "Fixture Away", slug: "AWY", side: "away"})}
    ${teamRow({name: "Fixture Home", slug: "HOM", side: "home"})}
    <span class="broadcaster">CBS</span>
  </article>`;
}

function postseasonPreloadedCard(): string {
  return `<article class="single-score-card"
      id="game-50022911" data-abbrev="${postseasonGameAbbreviation}">
    <div class="game-status pregame"><span class="pregame-date"></span></div>
    ${teamRow({name: "Oregon", slug: "OREG", side: "away"})}
    ${teamRow({name: "Indiana", slug: "IND", side: "home"})}
  </article>`;
}

describe("CBS college-football scoreboard URL policy", () => {
  it("builds only the exact HTTPS FBS scoreboard route", () => {
    const url = buildCbsCollegeFootballScoreboardUrl({
      season: 2030,
      seasonType: "regular",
      week: 0,
      division: "FBS",
    });
    expect(url.toString()).toBe(
      "https://www.cbssports.com/college-football/scoreboard/FBS/2030/regular/0/",
    );
    expect(url.search).toBe("");
    expect(url.username).toBe("");
    expect(url.password).toBe("");
  });

  it("rejects unsupported seasons, season types, divisions, and weeks", () => {
    expect(() =>
      buildCbsCollegeFootballScoreboardUrl({
        season: 1999,
        seasonType: "regular",
        week: 1,
      }),
    ).toThrow();
    expect(() =>
      buildCbsCollegeFootballScoreboardUrl({
        season: 2030,
        seasonType: "preseason" as never,
        week: 1,
      }),
    ).toThrow();
    expect(() =>
      buildCbsCollegeFootballScoreboardUrl({
        season: 2030,
        seasonType: "regular",
        week: -1,
      }),
    ).toThrow();
    expect(() =>
      buildCbsCollegeFootballScoreboardUrl({
        season: 2030,
        seasonType: "regular",
        week: 26,
      }),
    ).toThrow();
    expect(() =>
      buildCbsCollegeFootballScoreboardUrl({
        season: 2030,
        seasonType: "regular",
        week: 1,
        division: "FCS" as never,
      }),
    ).toThrow();
  });

  it("allows only HTTPS logos from the two CBS scoreboard asset hosts", () => {
    expect(
      sanitizeCbsCollegeFootballLogoUrl(
        "https://sports.cbsimg.net/team/alpha.png?tracking=discarded#x",
      ),
    ).toBe("https://sports.cbsimg.net/team/alpha.png");
    expect(
      sanitizeCbsCollegeFootballLogoUrl(
        "https://sportshub.cbsistatic.com/team/beta.svg",
      ),
    ).toBe("https://sportshub.cbsistatic.com/team/beta.svg");
    expect(
      sanitizeCbsCollegeFootballLogoUrl("http://sports.cbsimg.net/team/a.png"),
    ).toBeNull();
    expect(
      sanitizeCbsCollegeFootballLogoUrl("https://images.example.test/a.png"),
    ).toBeNull();
    expect(
      sanitizeCbsCollegeFootballLogoUrl(
        "https://sports.cbsimg.net.evil.test/a.png",
      ),
    ).toBeNull();
  });
});

describe("CBS college-football semantic parsing", () => {
  it("confirms the requested FBS season/week from public page identity", () => {
    const exact = parseCbsCollegeFootballScoreboardHtml(
      `<title>2030 NCAA Football Scores - FBS - Week 1 - CBS Sports</title>
       ${statusCard({id: "identity-game", status: "Scheduled"})}`,
      context,
    );
    const wrongWeek = parseCbsCollegeFootballScoreboardHtml(
      `<title>2030 NCAA Football Scores - FBS - Week 2 - CBS Sports</title>
       ${statusCard({id: "wrong-week", status: "Scheduled"})}`,
      context,
    );
    const canonical = parseCbsCollegeFootballScoreboardHtml(
      `<link rel="canonical"
         href="https://www.cbssports.com/college-football/scoreboard/FBS/2030/regular/1/">
       ${statusCard({id: "canonical-game", status: "Scheduled"})}`,
      context,
    );

    expect(exact.identityConfirmed).toBe(true);
    expect(canonical.identityConfirmed).toBe(true);
    expect(wrongWeek.identityConfirmed).toBe(false);
  });

  it("does not confuse regular and postseason title identities", () => {
    const postseasonTitle =
      `<title>2030 NCAA Football Scores - FBS - Week 1 Postseason - CBS Sports</title>
       ${statusCard({id: "postseason-title", status: "Scheduled"})}`;
    const regularResult = parseCbsCollegeFootballScoreboardHtml(
      postseasonTitle,
      context,
    );
    const postseasonResult = parseCbsCollegeFootballScoreboardHtml(
      postseasonTitle,
      {...context, seasonType: "postseason"},
    );

    expect(regularResult.identityConfirmed).toBe(false);
    expect(postseasonResult.identityConfirmed).toBe(true);
  });

  it("prefers public JSON-LD and extracts normalized factual game data", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [{
            "@type": "SportsEvent",
            "identifier": "json-game-1",
            "url": "https://www.cbssports.com/college-football/gametracker/preview/json-game-1/",
            "startDate": "2030-08-29T16:00:00Z",
            "eventStatus": "https://schema.org/EventScheduled",
            "awayTeam": {
              "@type": "SportsTeam",
              "name": "Alpha State",
              "alternateName": "ALP",
              "url": "https://www.cbssports.com/college-football/teams/alpha-state/",
              "logo": "https://sports.cbsimg.net/alpha.png"
            },
            "homeTeam": {
              "@type": "SportsTeam",
              "name": "Beta Tech",
              "alternateName": "BET",
              "url": "https://www.cbssports.com/college-football/teams/beta-tech/",
              "logo": "https://unapproved.example.test/beta.png"
            },
            "location": {
              "@type": "Place",
              "name": "Synthetic Stadium",
              "address": {"addressLocality": "Test City", "addressRegion": "TX"}
            },
            "broadcastNetwork": "CBS"
          }]
        }
      </script>`;

    const result = parseCbsCollegeFootballScoreboardHtml(html, context);
    expect(result).toMatchObject({
      parserFailure: false,
      explicitNoGames: false,
      duplicateCount: 0,
      rejectedGameCount: 0,
    });
    expect(result.games).toHaveLength(1);
    expect(result.games[0]).toMatchObject({
      id: "cbsSports:NCAAF:json-game-1",
      provider: "cbsSports",
      providerGameId: "json-game-1",
      providerLeagueId: "FBS",
      sportCode: "NCAAF",
      leagueCode: "ncaaf",
      season: "2030",
      seasonType: "regular",
      weekOrRound: "1",
      status: "scheduled",
      venueName: "Synthetic Stadium",
      venueCity: "Test City",
      venueState: "TX",
      venueCountry: null,
      broadcast: "CBS",
      sourceGameUrl:
        "https://www.cbssports.com/college-football/gametracker/preview/json-game-1/",
      awayTeam: {
        name: "Alpha State",
        abbreviation: "ALP",
        providerTeamId: "alpha-state",
        logoUrl: "https://sports.cbsimg.net/alpha.png",
      },
      homeTeam: {
        name: "Beta Tech",
        abbreviation: "BET",
        providerTeamId: "beta-tech",
        logoUrl: null,
      },
    });
    expect(result.games[0]?.scheduledAtUtc?.toISOString()).toBe(
      "2030-08-29T16:00:00.000Z",
    );
    expect(result.games[0]?.sourcePayloadHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("never retains an article URL as a structured game link", () => {
    const result = parseCbsCollegeFootballScoreboardHtml(`
      <title>2030 NCAA Football Scores - FBS - Week 1 - CBS Sports</title>
      <script type="application/ld+json">
        {
          "@type": "SportsEvent",
          "identifier": "article-link-game",
          "url": "https://www.cbssports.com/college-football/news/an-editorial-story/",
          "startDate": "2030-08-31T16:00:00Z",
          "awayTeam": {"name": "Article Away"},
          "homeTeam": {"name": "Article Home"}
        }
      </script>`, context);

    expect(result.games).toHaveLength(1);
    expect(result.games[0]?.providerGameId).toBe("article-link-game");
    expect(result.games[0]?.sourceGameUrl).toBeNull();
  });

  it("uses explicit JSON-LD competitor roles instead of array order", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@type": "SportsEvent",
          "identifier": "role-game",
          "startDate": "2030-09-01T00:00:00Z",
          "competitor": [
            {"homeAway": "home", "name": "Home First"},
            {"homeAway": "away", "name": "Away Second"}
          ]
        }
      </script>`;
    const result = parseCbsCollegeFootballScoreboardHtml(html, context);
    expect(result.games[0]?.awayTeam.name).toBe("Away Second");
    expect(result.games[0]?.homeTeam.name).toBe("Home First");
  });

  it("normalizes schema.org statuses and lets a stronger card state win", () => {
    const html = `
      <script type="application/ld+json">
        [{
          "@type": "SportsEvent",
          "identifier": "merged-final",
          "startDate": "2030-08-31T16:00:00Z",
          "eventStatus": "https://schema.org/EventScheduled",
          "awayTeam": {"name": "Merged Away"},
          "homeTeam": {"name": "Merged Home"}
        }, {
          "@type": "SportsEvent",
          "identifier": "schema-live",
          "startDate": "2030-08-31T17:00:00Z",
          "eventStatus": "https://schema.org/EventInProgress",
          "awayTeam": {"name": "Live Away"},
          "homeTeam": {"name": "Live Home"}
        }, {
          "@type": "SportsEvent",
          "identifier": "schema-cancelled",
          "startDate": "2030-08-31T18:00:00Z",
          "eventStatus": "https://schema.org/EventCancelled",
          "awayTeam": {"name": "Cancelled Away"},
          "homeTeam": {"name": "Cancelled Home"}
        }]
      </script>
      <article class="single-score-card" data-game-id="merged-final"
        data-start-time="2030-08-31T16:00:00Z" data-game-status="Final">
        ${teamRow({name: "Merged Away", side: "away", score: 17})}
        ${teamRow({name: "Merged Home", side: "home", score: 24})}
      </article>`;

    const games = parseCbsCollegeFootballScoreboardHtml(html, context).games;
    const mergedFinal = games.find(
      (game) => game.providerGameId === "merged-final",
    );
    expect(mergedFinal).toMatchObject({
      status: "final",
      statusDetail: "Final",
      awayScore: 17,
      homeScore: 24,
      winnerTeamId: "cbsSports:ncaaf:merged-home",
    });
    expect(
      games.find((game) => game.providerGameId === "schema-live")?.status,
    ).toBe("live");
    expect(
      games.find(
        (game) => game.providerGameId === "schema-cancelled",
      )?.status,
    ).toBe("cancelled");
  });

  it("counts a game-shaped rejected SportsEvent without flagging unrelated JSON-LD", () => {
    const result = parseCbsCollegeFootballScoreboardHtml(`
      <script type="application/ld+json">
        [{
          "@type": "SportsEvent",
          "identifier": "complete-event",
          "startDate": "2030-08-31T16:00:00Z",
          "awayTeam": {"name": "Complete Away"},
          "homeTeam": {"name": "Complete Home"}
        }, {
          "@type": "SportsEvent",
          "identifier": "partial-event",
          "startDate": "2030-08-31T17:00:00Z",
          "awayTeam": {"name": "Only Away"}
        }, {
          "@type": "SportsEvent",
          "name": "Unrelated structured event without competitors"
        }]
      </script>`, context);

    expect(result.games).toHaveLength(1);
    expect(result.rejectedGameCount).toBe(1);
  });

  it("ignores SportsEvent metadata nested in non-primary related content", () => {
    const result = parseCbsCollegeFootballScoreboardHtml(`
      <script type="application/ld+json">
        {
          "@type": "WebPage",
          "mainEntity": {
            "@type": "SportsEvent",
            "identifier": "scoreboard-event",
            "startDate": "2030-08-31T16:00:00Z",
            "awayTeam": {"name": "Scoreboard Away"},
            "homeTeam": {"name": "Scoreboard Home"}
          },
          "subjectOf": {
            "@type": "SportsEvent",
            "identifier": "related-story-event",
            "startDate": "2030-12-31T16:00:00Z",
            "awayTeam": {"name": "Related Away"},
            "homeTeam": {"name": "Related Home"}
          }
        }
      </script>`, context);

    expect(result.games.map((game) => game.providerGameId)).toEqual([
      "scoreboard-event",
    ]);
  });
});

describe("CBS inert preloaded-state kickoff enrichment", () => {
  it("never creates a game that has no visible scoreboard card", () => {
    const result = parseCbsCollegeFootballScoreboardHtml(
      preloadedStateScript(preloadedState()),
      context,
    );

    expect(result.games).toEqual([]);
    expect(result).toMatchObject({
      parserFailure: true,
      failureCode: "CBS_PARSE_ZERO_GAMES",
    });
  });

  it("cross-checks and applies the exact UTC kickoff to its matching card", () => {
    const result = parseCbsCollegeFootballScoreboardHtml(
      `${preloadedStateScript(preloadedState({
        game: {
          odds: {marker: "must-not-be-retained"},
          ticketUrl: "https://tickets.example.test/must-not-be-retained",
        },
      }))}
       ${currentLikePreloadedCard()}`,
      context,
    );

    expect(CBS_COLLEGE_FOOTBALL_PARSER_VERSION).toBe("1.2.0");
    expect(result).toMatchObject({
      parserFailure: false,
      rejectedGameCount: 0,
    });
    expect(result.games).toHaveLength(1);
    expect(result.games[0]).toMatchObject({
      providerGameId: "50027398",
      scheduledDayEastern: "2030-08-29",
      publishedScheduledAtUtc: new Date("2030-08-29T16:00:00.000Z"),
      effectiveLockAtUtc: new Date("2030-08-29T16:00:00.000Z"),
      timeTbd: false,
      kickoffDisplayText: "2030-08-29 12:00 EDT",
      status: "scheduled",
      broadcast: "CBS",
      awayTeam: {name: "Fixture Away"},
      homeTeam: {name: "Fixture Home"},
    });
    expect(result.games[0]?.scheduledAtUtc?.toISOString()).toBe(
      "2030-08-29T16:00:00.000Z",
    );
    expect(JSON.stringify(result.games)).not.toContain("must-not-be-retained");
  });

  it("validates CBS's year-round EDT label by its actual Eastern wall time", () => {
    const abbreviation = "NCAAF_20301116_AWY@HOM";
    const epoch = Date.parse("2030-11-16T17:00:00.000Z") / 1_000;
    const result = parseCbsCollegeFootballScoreboardHtml(
      `${preloadedStateScript(preloadedState({
        config: {week: "12"},
        game: {
          abbr: abbreviation,
          gameAbbr: abbreviation,
          scheduled_date_time: "2030-11-16 12:00 EDT",
          scheduled_epoch: epoch,
          meta: {weekNumber: 12, cbsWeekNumber: 12},
        },
      }))}${currentLikePreloadedCard({abbreviation})}`,
      {...context, week: 12},
    );

    expect(result.games[0]).toMatchObject({
      scheduledAtUtc: new Date("2030-11-16T17:00:00.000Z"),
      scheduledDayEastern: "2030-11-16",
      kickoffDisplayText: "2030-11-16 12:00 EDT",
      timeTbd: false,
    });
  });

  it("supports CBS's live postseason tokens while keeping route week identity strict", () => {
    const postseasonContext = {
      ...context,
      season: 2025,
      seasonType: "postseason" as const,
      week: 20,
    };
    const livePageIdentity = `
      <title>2025 NCAA Football Scores - FBS - Semifinals - CBS Sports</title>
      <link rel="canonical"
        href="https://www.cbssports.com/college-football/scoreboard/">`;
    const result = parseCbsCollegeFootballScoreboardHtml(
      `${livePageIdentity}${preloadedStateScript(postseasonPreloadedState())}${postseasonPreloadedCard()}`,
      postseasonContext,
    );

    expect(result.identityConfirmed).toBe(true);
    expect(result.games[0]).toMatchObject({
      providerGameId: "50022911",
      season: "2025",
      seasonType: "postseason",
      weekOrRound: "20",
      scheduledAtUtc: new Date("2026-01-10T00:30:00.000Z"),
      scheduledDayEastern: "2026-01-09",
      kickoffDisplayText: "2026-01-09 19:30 EDT",
      timeTbd: false,
    });

    const wrongRouteWeek = parseCbsCollegeFootballScoreboardHtml(
      `${preloadedStateScript(postseasonPreloadedState({game: {
        meta: {weekNumber: 19, cbsWeekNumber: 18},
      }}))}${postseasonPreloadedCard()}`,
      postseasonContext,
    );
    expect(wrongRouteWeek.games[0]).toMatchObject({
      scheduledAtUtc: null,
      timeTbd: true,
    });

    const wrongRequestedWeek = parseCbsCollegeFootballScoreboardHtml(
      `${livePageIdentity}${preloadedStateScript(postseasonPreloadedState({
        config: {week: "19"},
      }))}${postseasonPreloadedCard()}`,
      postseasonContext,
    );
    expect(wrongRequestedWeek.identityConfirmed).toBe(false);
  });

  it("requires both the numeric card ID and abbreviation to match", () => {
    for (const card of [
      currentLikePreloadedCard({id: "50027399"}),
      currentLikePreloadedCard({
        id: "50027398",
        abbreviation: "NCAAF_20300829_ALT@HOM",
      }),
    ]) {
      const game = parseCbsCollegeFootballScoreboardHtml(
        `${preloadedStateScript(preloadedState())}${card}`,
        context,
      ).games[0];
      expect(game?.scheduledAtUtc).toBeNull();
      expect(game?.timeTbd).toBe(true);
    }
  });

  it("fails closed when the matched card kickoff conflicts with preloaded state", () => {
    const game = parseCbsCollegeFootballScoreboardHtml(
      `${preloadedStateScript(preloadedState())}${currentLikePreloadedCard({
        startTime: "2030-08-29T17:00:00Z",
      })}`,
      context,
    ).games[0];

    expect(game).toMatchObject({
      scheduledAtUtc: null,
      publishedScheduledAtUtc: null,
      effectiveLockAtUtc: null,
      scheduledDayEastern: null,
      kickoffDisplayText: null,
      timeTbd: true,
    });
  });

  it("fails closed when the visible date heading conflicts with preloaded state", () => {
    const game = parseCbsCollegeFootballScoreboardHtml(
      `${preloadedStateScript(preloadedState())}
       <h2>Friday, August 30, 2030</h2>
       ${currentLikePreloadedCard()}`,
      context,
    ).games[0];

    expect(game).toMatchObject({
      scheduledAtUtc: null,
      publishedScheduledAtUtc: null,
      effectiveLockAtUtc: null,
      scheduledDayEastern: null,
      kickoffDisplayText: null,
      dateHeading: null,
      timeTbd: true,
    });
  });

  it("keeps a structured/card/preloaded kickoff disagreement TBD after merging", () => {
    const game = parseCbsCollegeFootballScoreboardHtml(`
      ${preloadedStateScript(preloadedState())}
      <script type="application/ld+json">
        {
          "@type": "SportsEvent",
          "identifier": "50027398",
          "startDate": "2030-08-29T17:00:00Z",
          "awayTeam": {"name": "Fixture Away"},
          "homeTeam": {"name": "Fixture Home"}
        }
      </script>
      ${currentLikePreloadedCard()}
    `, context).games[0];

    expect(game).toMatchObject({
      providerGameId: "50027398",
      scheduledAtUtc: null,
      publishedScheduledAtUtc: null,
      effectiveLockAtUtc: null,
      scheduledDayEastern: null,
      kickoffDisplayText: null,
      timeTbd: true,
    });
  });

  it.each([
    ["page identity", preloadedState({config: {week: "2"}})],
    [
      "UTC/display disagreement",
      preloadedState({game: {scheduled_epoch: preloadedGameEpoch + 60}}),
    ],
    [
      "unsupported timezone suffix",
      preloadedState({
        game: {scheduled_date_time: "2030-08-29 12:00 PDT"},
      }),
    ],
    [
      "game abbreviation disagreement",
      preloadedState({game: {gameAbbr: "NCAAF_20300829_OTHER@HOM"}}),
    ],
    [
      "week metadata disagreement",
      preloadedState({game: {meta: {weekNumber: 2, cbsWeekNumber: 1}}}),
    ],
  ])("keeps the card TBD on %s", (_label, state) => {
    const result = parseCbsCollegeFootballScoreboardHtml(
      `${preloadedStateScript(state)}${currentLikePreloadedCard()}`,
      context,
    );

    expect(result.rejectedGameCount).toBe(0);
    expect(result.games[0]).toMatchObject({
      scheduledAtUtc: null,
      publishedScheduledAtUtc: null,
      effectiveLockAtUtc: null,
      timeTbd: true,
    });
  });

  it("does not execute or accept malformed, appended, or duplicate state", () => {
    const validScript = preloadedStateScript(preloadedState());
    const appended = validScript.replace(
      "</script>",
      "globalThis.preloadedStateWasExecuted = true;</script>",
    );
    const malformed = `<script>
      define('reduxPreloadedState', [], function() {
        return JSON.parse(atob('not_base64!') || '{}');
      });
    </script>`;
    for (const stateSource of [
      appended,
      malformed,
      `${validScript}${validScript}`,
      `${validScript}${malformed}`,
    ]) {
      const game = parseCbsCollegeFootballScoreboardHtml(
        `${stateSource}${currentLikePreloadedCard()}`,
        context,
      ).games[0];
      expect(game?.scheduledAtUtc).toBeNull();
      expect(game?.timeTbd).toBe(true);
    }
    expect(
      (globalThis as {preloadedStateWasExecuted?: boolean})
        .preloadedStateWasExecuted,
    ).toBeUndefined();
  });
});

describe("CBS public score-card fallbacks", () => {
  it("extracts the raw card's numeric game ID and calendar day without inventing a kickoff", () => {
    const html = `
      <article class="single-score-card" id="game-50027398"
        data-abbrev="NCAAF_20260829_UNC@TCU">
        ${teamRow({name: "North Carolina", side: "away"})}
        ${teamRow({name: "TCU", side: "home"})}
      </article>`;

    const result = parseCbsCollegeFootballScoreboardHtml(html, {
      ...context,
      season: 2026,
      observedAt: new Date("2026-08-27T12:00:00.000Z"),
    });

    expect(result.games).toHaveLength(1);
    expect(result.games[0]).toMatchObject({
      providerGameId: "50027398",
      scheduledDayEastern: "2026-08-29",
      scheduledAtUtc: null,
      publishedScheduledAtUtc: null,
      effectiveLockAtUtc: null,
      timeTbd: true,
      kickoffDisplayText: null,
      dateHeading: null,
      status: "reviewRequired",
    });
  });

  it("uses a validated data-abbrev as the stable ID fallback", () => {
    const html = `
      <article class="single-score-card"
        data-abbrev="NCAAF_20260829_UNC@TCU">
        ${teamRow({name: "North Carolina", side: "away"})}
        ${teamRow({name: "TCU", side: "home"})}
      </article>`;

    const game = parseCbsCollegeFootballScoreboardHtml(html, {
      ...context,
      season: 2026,
    }).games[0];

    expect(game).toMatchObject({
      providerGameId: "NCAAF_20260829_UNC-TCU",
      scheduledDayEastern: "2026-08-29",
      scheduledAtUtc: null,
      timeTbd: true,
    });
  });

  it("associates multiple games with their date headings and keeps incomplete optional data", () => {
    const html = `
      <section>
        <h3>Thursday, August 29, 2030</h3>
        <article class="single-score-card" data-game-id="opening-game" data-neutral-site="true">
          <div class="pregame-date">12:00 PM ET</div>
          ${teamRow({
            name: "12 Alpha State",
            slug: "alpha-state",
            abbreviation: "ALP",
            logo: "https://sports.cbsimg.net/alpha.png",
          })}
          ${teamRow({
            name: "Beta Tech",
            slug: "beta-tech",
            abbreviation: "BET",
            logo: "https://evil.example.test/beta.png",
          })}
          <div class="tickets"><a href="/tickets/"><span class="location">Ticket Partner Arena</span></a></div>
          <div class="game-info"><span class="location">Neutral Field</span></div>
          <div class="neutral-site">Neutral site</div>
          <div class="odds">Alpha -7.5 / O/U 51</div>
        </article>
        <article class="single-score-card" data-game-id="fbs-fcs-game">
          <div class="pregame-date">TBD</div>
          ${teamRow({name: "Gamma University", abbreviation: "GAM"})}
          ${teamRow({name: "Small College", abbreviation: "FCS"})}
        </article>
      </section>
      <section>
        <h3>Friday, August 30, 2030</h3>
        <article class="single-score-card" data-game-id="friday-game">
          <time datetime="2030-08-31T00:30:00Z">8:30 PM ET</time>
          ${teamRow({name: "Delta"})}
          ${teamRow({name: "Epsilon"})}
          <span class="broadcaster">ESPN2</span>
        </article>
      </section>`;

    const result = parseCbsCollegeFootballScoreboardHtml(html, context);
    expect(result.games).toHaveLength(3);
    const opening = result.games.find(
      (game) => game.providerGameId === "opening-game",
    );
    const fbsFcs = result.games.find(
      (game) => game.providerGameId === "fbs-fcs-game",
    );
    const friday = result.games.find(
      (game) => game.providerGameId === "friday-game",
    );
    expect(opening).toMatchObject({
      dateHeading: "Thursday, August 29, 2030",
      scheduledDayEastern: "2030-08-29",
      timeTbd: false,
      neutralSite: true,
      venueName: "Neutral Field",
      broadcast: null,
      awayTeam: {
        name: "Alpha State",
        logoUrl: "https://sports.cbsimg.net/alpha.png",
      },
      homeTeam: {name: "Beta Tech", logoUrl: null},
    });
    expect(opening?.scheduledAtUtc?.toISOString()).toBe(
      "2030-08-29T16:00:00.000Z",
    );
    expect(fbsFcs).toMatchObject({
      scheduledDayEastern: "2030-08-29",
      scheduledAtUtc: null,
      timeTbd: true,
      venueName: null,
      broadcast: null,
      awayTeam: {name: "Gamma University"},
      homeTeam: {name: "Small College"},
    });
    expect(friday).toMatchObject({
      dateHeading: "Friday, August 30, 2030",
      broadcast: "ESPN2",
    });
  });

  it("honors explicit home/away metadata even when DOM order is reversed", () => {
    const html = `
      <article class="single-score-card" data-game-id="reversed"
        data-game-date="2030-08-31" data-start-time="2030-08-31T17:00:00Z"
        data-game-status="Final">
        ${teamRow({name: "Home Appears First", side: "home", score: 31})}
        ${teamRow({name: "Away Appears Second", side: "away", score: 17})}
      </article>`;
    const result = parseCbsCollegeFootballScoreboardHtml(html, context);
    expect(result.games[0]).toMatchObject({
      awayTeam: {name: "Away Appears Second"},
      homeTeam: {name: "Home Appears First"},
      awayScore: 17,
      homeScore: 31,
      status: "final",
      winnerTeamId: "cbsSports:ncaaf:home-appears-first",
    });
  });

  it("maps scheduled, live/halftime, final, postponed, and canceled states conservatively", () => {
    const html = [
      statusCard({id: "scheduled", status: "Scheduled"}),
      statusCard({id: "live", status: "Q3 04:21"}),
      statusCard({id: "halftime", status: "Halftime"}),
      statusCard({id: "final", status: "Final", awayScore: 20, homeScore: 27}),
      statusCard({id: "postponed", status: "Postponed"}),
      statusCard({id: "canceled", status: "Canceled"}),
      statusCard({id: "mystery", status: "Weather update pending"}),
    ].join("");
    const games = parseCbsCollegeFootballScoreboardHtml(html, context).games;
    const statuses = Object.fromEntries(
      games.map((game) => [game.providerGameId, game.status]),
    );
    expect(statuses).toEqual({
      canceled: "cancelled",
      final: "final",
      halftime: "live",
      live: "live",
      mystery: "scheduled",
      postponed: "postponed",
      scheduled: "scheduled",
    });
    const final = games.find((game) => game.providerGameId === "final");
    expect(final?.winnerTeamId).toBe("cbsSports:ncaaf:final-home");
  });

  it("keeps zone-less kickoff displays and completely missing dates as TBD", () => {
    const html = `
      <article class="single-score-card" data-game-id="ambiguous-time" data-game-date="2030-08-31">
        <div class="pregame-date">7:30 PM</div>
        ${teamRow({name: "Ambiguous Away"})}
        ${teamRow({name: "Ambiguous Home"})}
      </article>
      <article class="single-score-card" data-game-id="no-date-or-time">
        <div class="pregame"><span class="pregame-date"></span></div>
        ${teamRow({name: "Unknown Away"})}
        ${teamRow({name: "Unknown Home"})}
      </article>
      <article class="single-score-card" data-game-id="ambiguous-iso"
        data-start-time="2030-08-31T19:30:00">
        ${teamRow({name: "ISO Away"})}
        ${teamRow({name: "ISO Home"})}
      </article>
      <article class="single-score-card" data-game-id="central-daylight"
        data-game-date="2030-08-31">
        <div class="pregame-date">2:00 PM CT</div>
        ${teamRow({name: "Central Away"})}
        ${teamRow({name: "Central Home"})}
      </article>`;
    const games = parseCbsCollegeFootballScoreboardHtml(html, context).games;
    const ambiguous = games.find(
      (game) => game.providerGameId === "ambiguous-time",
    );
    const unknown = games.find(
      (game) => game.providerGameId === "no-date-or-time",
    );
    const ambiguousIso = games.find(
      (game) => game.providerGameId === "ambiguous-iso",
    );
    const centralDaylight = games.find(
      (game) => game.providerGameId === "central-daylight",
    );
    expect(ambiguous).toMatchObject({
      scheduledAtUtc: null,
      scheduledDayEastern: "2030-08-31",
      timeTbd: true,
      kickoffDisplayText: "7:30 PM",
    });
    expect(unknown).toMatchObject({
      scheduledAtUtc: null,
      publishedScheduledAtUtc: null,
      effectiveLockAtUtc: null,
      scheduledDayEastern: null,
      timeTbd: true,
      status: "scheduled",
    });
    expect(ambiguousIso).toMatchObject({
      scheduledAtUtc: null,
      scheduledDayEastern: "2030-08-31",
      timeTbd: true,
    });
    expect(centralDaylight?.scheduledAtUtc?.toISOString()).toBe(
      "2030-08-31T19:00:00.000Z",
    );
  });

  it("uses deterministic fallback IDs and handles duplicate and malformed cards", () => {
    const complete = `
      <article class="single-score-card" data-game-date="2030-08-31">
        <div class="pregame-date">1:00 PM ET</div>
        ${teamRow({name: "Fallback Away"})}
        ${teamRow({name: "Fallback Home"})}
      </article>`;
    const malformed = `
      <article class="single-score-card" data-game-id="malformed">
        ${teamRow({name: "Only One Team"})}
      </article>`;
    const first = parseCbsCollegeFootballScoreboardHtml(
      `${complete}${complete}${malformed}`,
      context,
    );
    const second = parseCbsCollegeFootballScoreboardHtml(complete, {
      ...context,
      observedAt: new Date("2030-08-28T13:00:00.000Z"),
    });
    expect(first.games).toHaveLength(1);
    expect(first.duplicateCount).toBe(1);
    expect(first.rejectedGameCount).toBe(1);
    expect(first.games[0]?.providerGameId).toMatch(/^fallback-[a-f0-9]{32}$/);
    expect(first.games[0]?.providerGameId).toBe(second.games[0]?.providerGameId);
    expect(first.games[0]?.sourcePayloadHash).toBe(
      second.games[0]?.sourcePayloadHash,
    );
  });

  it("keeps a gametracker live slug stable when kickoff changes", () => {
    const card = (start: string) => `
      <article class="single-score-card" data-start-time="${start}">
        <a href="/college-football/gametracker/live/NCAAF_20300831_AWY@HOM/">Game</a>
        ${teamRow({name: "Stable Away", side: "away"})}
        ${teamRow({name: "Stable Home", side: "home"})}
      </article>`;
    const before = parseCbsCollegeFootballScoreboardHtml(
      card("2030-08-31T16:00:00Z"),
      context,
    ).games[0];
    const after = parseCbsCollegeFootballScoreboardHtml(
      card("2030-08-31T18:00:00Z"),
      context,
    ).games[0];

    expect(before?.providerGameId).toBe("NCAAF_20300831_AWY-HOM");
    expect(after?.providerGameId).toBe(before?.providerGameId);
    expect(after?.scheduledAtUtc?.toISOString()).toBe(
      "2030-08-31T18:00:00.000Z",
    );
  });
});

describe("CBS zero-game protection", () => {
  it("accepts zero games only when the public page explicitly says so", () => {
    const result = parseCbsCollegeFootballScoreboardHtml(
      `<main data-scoreboard>
        <div class="no-games-message">There are no games scheduled for this week.</div>
      </main>`,
      context,
    );
    expect(result).toMatchObject({
      games: [],
      explicitNoGames: true,
      parserFailure: false,
      failureCode: null,
    });
  });

  it("does not let an unrelated empty widget authorize an empty schedule", () => {
    const result = parseCbsCollegeFootballScoreboardHtml(
      `<main>
        <aside class="related-widget" data-no-games="true">
          There are no games available.
        </aside>
        <article class="redesigned-score-card">Markup changed</article>
      </main>`,
      context,
    );

    expect(result).toMatchObject({
      games: [],
      explicitNoGames: false,
      parserFailure: true,
      failureCode: "CBS_PARSE_ZERO_GAMES",
    });
  });

  it("flags selector drift that produces an unexplained empty parse", () => {
    const result = parseCbsCollegeFootballScoreboardHtml(
      '<main><article class="redesigned-score-card">Markup changed</article></main>',
      context,
    );
    expect(result).toMatchObject({
      games: [],
      explicitNoGames: false,
      parserFailure: true,
      failureCode: "CBS_PARSE_ZERO_GAMES",
    });
  });

  it("ignores unusable JSON-LD without treating it as a malformed card", () => {
    const result = parseCbsCollegeFootballScoreboardHtml(
      `<script type="application/ld+json">
        {"@type":"SportsEvent","name":"Editorial event without teams"}
      </script>`,
      context,
    );
    expect(result.rejectedGameCount).toBe(0);
    expect(result.parserFailure).toBe(true);
  });
});
