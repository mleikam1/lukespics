import type {
  GameStatus,
  NormalizedGame,
  ProviderHealth,
  ProviderLeague,
  ProviderQuery,
  SportsDataProvider,
  Team,
} from "../types.js";
import {withSourceHash} from "./normalization.js";

const LEAGUES: ProviderLeague[] = [
  {
    code: "demo-football",
    name: "Demo Football",
    sportCode: "football",
    providerLeagueId: "demo-football",
    season: "demo",
  },
  {
    code: "demo-basketball",
    name: "Demo Basketball",
    sportCode: "basketball",
    providerLeagueId: "demo-basketball",
    season: "demo",
  },
  {
    code: "demo-baseball",
    name: "Demo Baseball",
    sportCode: "baseball",
    providerLeagueId: "demo-baseball",
    season: "demo",
  },
  {
    code: "demo-hockey",
    name: "Demo Hockey",
    sportCode: "hockey",
    providerLeagueId: "demo-hockey",
    season: "demo",
  },
];

const NAMES = [
  ["Lake City", "Voyagers"],
  ["Prairie", "Owls"],
  ["Riverbend", "Foxes"],
  ["North Shore", "Comets"],
  ["Hill Country", "Bison"],
  ["Pine Valley", "Herons"],
  ["Capitol", "Guardians"],
  ["Sunset", "Rockets"],
] as const;

function team(index: number): Team {
  const pair = NAMES[index % NAMES.length] ?? NAMES[0];
  const name = `${pair[0]} ${pair[1]}`;
  return {
    id: `demo-team-${index + 1}`,
    name,
    shortName: pair[1],
    abbreviation: pair[1].slice(0, 3).toUpperCase(),
    logoUrl: null,
  };
}

function parseStart(value: string): Date {
  const date = new Date(`${value}T18:00:00.000Z`);
  return Number.isNaN(date.valueOf()) ? new Date() : date;
}

export class MockSportsProvider implements SportsDataProvider {
  readonly name = "mock";

  async listSupportedSports(): Promise<string[]> {
    return [...new Set(LEAGUES.map((league) => league.sportCode))];
  }

  async listLeagues(sportCode?: string): Promise<ProviderLeague[]> {
    return LEAGUES.filter(
      (league) => sportCode === undefined || league.sportCode === sportCode,
    );
  }

  async listGames(query: ProviderQuery): Promise<NormalizedGame[]> {
    const league =
      LEAGUES.find((item) => item.code === query.leagueCode) ??
      ({
        code: query.leagueCode,
        name: `Demo ${query.sportCode}`,
        sportCode: query.sportCode,
        providerLeagueId: query.leagueId,
        season: query.season,
      } satisfies ProviderLeague);
    const start = parseStart(query.from);
    const now = new Date();

    return Array.from({length: 8}, (_, index) => {
      const scheduledAt = new Date(start.valueOf() + index * 7_200_000);
      const homeTeam = team(index * 2);
      const awayTeam = team(index * 2 + 1);
      const source = {
        providerGameId: `${league.code}-${query.from}-${index + 1}`,
        scheduledAt: scheduledAt.toISOString(),
        home: homeTeam.id,
        away: awayTeam.id,
      };
      return withSourceHash(
        {
          id: `mock:${query.sportCode}:${source.providerGameId}`,
          provider: "mock",
          providerGameId: source.providerGameId,
          sportCode: query.sportCode,
          leagueCode: league.code,
          leagueName: league.name,
          season: query.season,
          weekOrRound: null,
          scheduledAtUtc: scheduledAt,
          publishedScheduledAtUtc: scheduledAt,
          effectiveLockAtUtc: scheduledAt,
          venueName: null,
          neutralSite: index % 4 === 0,
          homeTeam,
          awayTeam,
          status: "scheduled",
          homeScore: null,
          awayScore: null,
          winnerTeamId: null,
          providerLastUpdatedAt: now,
          lastSyncedAt: now,
          manualOverride: false,
          manualOverrideReason: null,
          manualOverrideBy: null,
        },
        source,
      );
    });
  }

  async fetchGames(
    providerGameIds: string[],
    context?: Partial<ProviderQuery>,
  ): Promise<NormalizedGame[]> {
    const query: ProviderQuery = {
      sportCode: context?.sportCode ?? "football",
      leagueCode: context?.leagueCode ?? "demo-football",
      leagueId: context?.leagueId ?? "demo-football",
      season: context?.season ?? "demo",
      from: context?.from ?? new Date().toISOString().slice(0, 10),
      to: context?.to ?? new Date().toISOString().slice(0, 10),
    };
    const games = await this.listGames(query);
    const byId = new Map(games.map((game) => [game.providerGameId, game]));
    return providerGameIds
      .map((id) => byId.get(id))
      .filter((game): game is NormalizedGame => game !== undefined);
  }

  async getTeamMetadata(teamId: string): Promise<Team | null> {
    const index = Number.parseInt(teamId.replace("demo-team-", ""), 10) - 1;
    return Number.isFinite(index) && index >= 0 ? team(index) : null;
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      state: "healthy",
      quotaRemaining: null,
      checkedAt: new Date(),
      detail: "Deterministic local provider.",
    };
  }

  mapStatus(providerStatus: string): GameStatus {
    const normalized = providerStatus.toLowerCase();
    return [
      "scheduled",
      "delayed",
      "live",
      "final",
      "postponed",
      "suspended",
      "cancelled",
      "void",
      "reviewrequired",
    ].includes(normalized)
      ? (normalized === "reviewrequired"
          ? "reviewRequired"
          : normalized as GameStatus)
      : "reviewRequired";
  }
}
