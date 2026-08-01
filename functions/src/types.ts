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
  providerTeamId?: string | null;
  providerGlobalTeamId?: string | null;
};

export type NormalizedGame = {
  id: string;
  provider: PersistedProviderName;
  providerGameId: string;
  providerScoreId?: string | null;
  providerLeagueGameId?: string | null;
  providerGlobalGameId?: string | null;
  providerGameKey?: string | null;
  providerLeagueId: string;
  sportCode: string;
  leagueCode: string;
  leagueName: string;
  season: string;
  seasonType?: string | null;
  weekOrRound: string | null;
  scheduledAtUtc: Date | null;
  publishedScheduledAtUtc: Date | null;
  effectiveLockAtUtc: Date | null;
  scheduledDayEastern?: string | null;
  timeTbd?: boolean;
  venueName: string | null;
  neutralSite: boolean;
  homeTeam: Team;
  awayTeam: Team;
  status: GameStatus;
  statusDetail?: string | null;
  isClosed?: boolean | null;
  rescheduledFromLeagueGameId?: string | null;
  rescheduledToLeagueGameId?: string | null;
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
  scheduledAtUtc: Timestamp | null;
  publishedScheduledAtUtc: Timestamp | null;
  effectiveLockAtUtc: Timestamp | null;
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
  readonly name: ProviderName;
  readonly cacheNamespace?: string;
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
  "sportsDataIo",
] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

// Persisted week snapshots retain their original provenance so historic picks,
// results, and audits remain readable. Historical values are deliberately not
// part of ProviderName and therefore cannot be selected, configured, or used
// to construct a network provider.
export const HISTORICAL_PROVIDER_NAMES = ["espn"] as const;
export const PERSISTED_PROVIDER_NAMES = [
  ...PROVIDER_NAMES,
  ...HISTORICAL_PROVIDER_NAMES,
] as const;
export type PersistedProviderName =
  (typeof PERSISTED_PROVIDER_NAMES)[number];

export function isProviderName(value: unknown): value is ProviderName {
  return PROVIDER_NAMES.includes(value as ProviderName);
}

export function isHistoricalProviderName(
  value: unknown,
): value is (typeof HISTORICAL_PROVIDER_NAMES)[number] {
  return HISTORICAL_PROVIDER_NAMES.includes(
    value as (typeof HISTORICAL_PROVIDER_NAMES)[number],
  );
}

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
