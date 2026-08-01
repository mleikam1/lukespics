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
  color?: string | null;
};

export type NormalizedGame = {
  id: string;
  provider: string;
  providerGameId: string;
  providerLeagueId: string;
  sportCode: string;
  leagueCode: string;
  leagueName: string;
  season: string;
  seasonType?: string | null;
  weekOrRound: string | null;
  scheduledAtUtc: Date;
  publishedScheduledAtUtc: Date;
  effectiveLockAtUtc: Date;
  venueName: string | null;
  neutralSite: boolean;
  homeTeam: Team;
  awayTeam: Team;
  status: GameStatus;
  statusDetail?: string | null;
  homeScore: number | null;
  awayScore: number | null;
  winnerTeamId: string | null;
  broadcast?: string | null;
  eventDetail?: string | null;
  rawResponseVersion?: number;
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
  providerLeagueId: string;
  season: string;
  from: string;
  to: string;
  timezone: string;
  forceRefresh?: boolean;
};

export type CatalogQueryRequest = Omit<
  ProviderQuery,
  | "sportCode"
  | "leagueCode"
  | "providerLeagueId"
  | "season"
  | "from"
  | "to"
  | "timezone"
> & {
  sportCode?: string;
  leagueCode?: string;
  providerLeagueId?: string;
  season?: string;
  from?: string;
  to?: string;
  timezone?: string;
  dateMode?: "today" | "tomorrow" | "later" | "allDates" | "custom";
};

export type CatalogPresentation = {
  provider: string;
  attributionText: string | null;
  allowRemoteLogos: boolean;
  allowedLogoHosts: string[];
  allowedLogoQueryParameters: string[];
  logoRightsReviewDate: string | null;
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
  readonly presentation: CatalogPresentation;
  readonly usagePolicy?: ProviderUsagePolicy;
  readonly selectedGameRefreshMode?: "strict" | "partial";
  readonly selectedGameRefreshMaximumIds?: number;
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
  requestEstimate?(
    operation: ProviderRequestOperation,
    itemCount: number,
    context?: Partial<ProviderQuery>,
  ): ProviderRequestEstimate;
  getRequestAttemptCount?(): number;
  setRetryAuthorizer?(authorizer: (() => Promise<void>) | null): void;
};

export type ProviderRequestOperation = "listGames" | "fetchGames";

export type ProviderRequestEstimate = {
  baseRequestCount: number;
  maximumRequestCount: number;
};

export type ProviderUsagePolicy = {
  softDailyLimitSetting: string;
  defaultSoftDailyLimit: number;
  maximumSoftDailyLimit: number;
};

export const PROVIDER_NAMES = [
  "mock",
  "manual",
  "theSportsDbTest",
  "apiSports",
  "espn",
] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export type LeagueSettings = {
  pickerParticipatesInPicks: boolean;
  pickLockPolicy: "perGame" | "firstGame";
  weekStartDay: number;
  weekStartTime: string;
  enabledSports: string[];
  enabledLeagues: string[];
  manualFinalizationRequired: boolean;
  providerName: ProviderName;
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
