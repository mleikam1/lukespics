import type {
  GameStatus,
  NormalizedGame,
  ProviderHealth,
  ProviderLeague,
  ProviderQuery,
  SportsDataProvider,
  Team,
} from "../types.js";
import {neutralCatalogPresentation} from "./presentation.js";

export class ManualSportsProvider implements SportsDataProvider {
  readonly name = "manual";
  readonly presentation = neutralCatalogPresentation(this.name);

  async listSupportedSports(): Promise<string[]> {
    return [];
  }

  async listLeagues(_sportCode?: string): Promise<ProviderLeague[]> {
    return [];
  }

  async listGames(_query: ProviderQuery): Promise<NormalizedGame[]> {
    return [];
  }

  async fetchGames(
    _providerGameIds: string[],
    _context?: Partial<ProviderQuery>,
  ): Promise<NormalizedGame[]> {
    return [];
  }

  async getTeamMetadata(_teamId: string): Promise<Team | null> {
    return null;
  }

  async getHealth(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      state: "healthy",
      quotaRemaining: null,
      checkedAt: new Date(),
      detail: "Commissioner-entered games; no external requests.",
    };
  }

  mapStatus(providerStatus: string): GameStatus {
    const valid: GameStatus[] = [
      "scheduled",
      "delayed",
      "live",
      "final",
      "postponed",
      "suspended",
      "cancelled",
      "void",
      "reviewRequired",
    ];
    return valid.includes(providerStatus as GameStatus)
      ? (providerStatus as GameStatus)
      : "reviewRequired";
  }
}
