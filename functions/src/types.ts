import type {Timestamp} from "firebase-admin/firestore";

export const MEMBER_ROLES = ["owner", "commissioner", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const WEEK_STATUSES = [
  "draft",
  "open",
  "inProgress",
  "review",
  "finalized",
  "reopened",
] as const;
export type WeekStatus = (typeof WEEK_STATUSES)[number];

export const GAME_STATUSES = [
  "scheduled",
  "delayed",
  "live",
  "final",
  "postponed",
  "suspended",
  "cancelled",
  "void",
  "reviewRequired",
] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

export type Team = {
  id: string;
  name: string;
  shortName: string;
  abbreviation: string;
  logoUrl: string | null;
};

export type NormalizedGame = {
  id: string;
  provider: string;
  providerGameId: string;
  sportCode: string;
  leagueCode: string;
  leagueName: string;
  season: string;
  weekOrRound: string | null;
  scheduledAtUtc: Date;
  publishedScheduledAtUtc: Date;
  effectiveLockAtUtc: Date;
  venueName: string | null;
  neutralSite: boolean;
  homeTeam: Team;
  awayTeam: Team;
  status: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
  winnerTeamId: string | null;
  providerLastUpdatedAt: Date;
  lastSyncedAt: Date;
  manualOverride: boolean;
  manualOverrideReason: string | null;
  manualOverrideBy: string | null;
  resultVersion: string;
  sourcePayloadHash: string;
};

export type StoredGame = Omit<
  NormalizedGame,
  | "scheduledAtUtc"
  | "publishedScheduledAtUtc"
  | "effectiveLockAtUtc"
  | "providerLastUpdatedAt"
  | "lastSyncedAt"
> & {
  scheduledAtUtc: Timestamp;
  publishedScheduledAtUtc: Timestamp;
  effectiveLockAtUtc: Timestamp;
  providerLastUpdatedAt: Timestamp;
  lastSyncedAt: Timestamp;
};

export type ProviderLeague = {
  code: string;
  name: string;
  sportCode: string;
  providerLeagueId: string;
  season: string;
};

export type ProviderQuery = {
  sportCode: string;
  leagueCode: string;
  leagueId: string;
  season: string;
  from: string;
  to: string;
  forceRefresh?: boolean;
};

export type ProviderHealth = {
  provider: string;
  state: "healthy" | "degraded" | "unavailable";
  quotaRemaining: number | null;
  checkedAt: Date;
  detail: string;
};

export type SportsDataProvider = {
  readonly name: string;
  listSupportedSports(): Promise<string[]>;
  listLeagues(sportCode?: string): Promise<ProviderLeague[]>;
  listGames(query: ProviderQuery): Promise<NormalizedGame[]>;
  fetchGames(
    providerGameIds: string[],
    context?: Partial<ProviderQuery>,
  ): Promise<NormalizedGame[]>;
  getTeamMetadata(teamId: string): Promise<Team | null>;
  getHealth(): Promise<ProviderHealth>;
  mapStatus(providerStatus: string): GameStatus;
};

export type LeagueSettings = {
  pickerParticipatesInPicks: boolean;
  pickLockPolicy: "perGame" | "firstGame";
  weekStartDay: number;
  weekStartTime: string;
  enabledSports: string[];
  enabledLeagues: string[];
  manualFinalizationRequired: boolean;
  providerName: "mock" | "manual" | "apiSports";
};

export type EntryScore = {
  uid: string;
  eligible: boolean;
  gradedCount: number;
  correctCount: number;
  incorrectCount: number;
  voidCount: number;
  points: number;
  accuracy: number | null;
};

export type StandingAggregate = {
  uid: string;
  totalPoints: number;
  totalCorrect: number;
  totalIncorrect: number;
  totalVoid: number;
  totalGraded: number;
  overallAccuracy: number | null;
  eligibleWeeks: number;
  pickerWeeks: number;
  weeklyTitles: number;
  bestWeekPoints: number;
};
