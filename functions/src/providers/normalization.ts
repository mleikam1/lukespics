import {sha256} from "../utils.js";
import type {GameStatus, NormalizedGame, Team} from "../types.js";

export function resultVersionFor(input: {
  status: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
  winnerTeamId: string | null;
  manualOverride?: boolean;
}): string {
  return sha256(input);
}

export function normalizeTeam(
  id: string | number,
  name: string,
  logoUrl: string | null,
): Team {
  const normalizedName = name.trim().slice(0, 120) || "Unknown team";
  const words = normalizedName.split(/\s+/);
  const abbreviation =
    words
      .map((word) => word[0] ?? "")
      .join("")
      .slice(0, 4)
      .toUpperCase() || "TEAM";
  return {
    id: String(id),
    name: normalizedName,
    shortName: words.at(-1)?.slice(0, 80) ?? normalizedName,
    abbreviation,
    logoUrl,
  };
}

export function finalWinner(
  status: GameStatus,
  homeTeamId: string,
  awayTeamId: string,
  homeScore: number | null,
  awayScore: number | null,
): {status: GameStatus; winnerTeamId: string | null} {
  if (status !== "final") {
    return {status, winnerTeamId: null};
  }
  if (homeScore === null || awayScore === null || homeScore === awayScore) {
    return {status: "reviewRequired", winnerTeamId: null};
  }
  return {
    status,
    winnerTeamId: homeScore > awayScore ? homeTeamId : awayTeamId,
  };
}

export function withSourceHash(
  game: Omit<NormalizedGame, "sourcePayloadHash" | "resultVersion">,
  source: unknown,
): NormalizedGame {
  const resultVersion = resultVersionFor({
    status: game.status,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    winnerTeamId: game.winnerTeamId,
    manualOverride: game.manualOverride,
  });
  return {
    ...game,
    resultVersion,
    sourcePayloadHash: sha256(source),
  };
}
