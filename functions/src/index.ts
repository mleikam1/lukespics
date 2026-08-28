import {logger} from "firebase-functions";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {HttpsError} from "firebase-functions/v2/https";
import {callable} from "./callable.js";
import {
  db,
  INVITE_CODE_PEPPER,
} from "./config.js";
import {
  assignPickerSchema,
  createDraftWeekSchema,
  createLeagueSchema,
  collegeFootballAdminRefreshSchema,
  collegeFootballScheduleSchema,
  deleteAccountSchema,
  ensureUserProfileSchema,
  gameMutationSchema,
  issueArenaInviteSchema,
  joinLeagueSchema,
  leagueMutationSchema,
  leaveLeagueSchema,
  manualGameSchema,
  overrideGameSchema,
  publishSlateSchema,
  reasonSchema,
  revealLockedPicksSchema,
  reorderRotationSchema,
  revokeArenaInviteSchema,
  rotateInviteCodeSchema,
  saveDraftSlateSchema,
  selectedGamesSchema,
  sportsCatalogSchema,
  submitEntrySchema,
  updateLeagueSettingsSchema,
  updateMemberSchema,
  voidGameSchema,
  weekMutationSchema,
} from "./schemas.js";
import {
  anonymizeAccount,
  createLeagueRecord,
  ensureProfile,
  issueArenaInviteRecord,
  joinByInvite,
  leaveLeagueRecord,
  reorderRotation,
  revokeArenaInviteRecord,
  rotateInvite,
  updateMember,
  updateSettings,
  withCbsProviderForNewLeague,
} from "./services/leagues.js";
import {
  assertCbsCollegeFootballActiveIdentity,
  loadCbsCollegeFootballSchedule,
  readCbsCollegeFootballConfiguration,
  refreshActiveCbsCollegeFootballSchedule,
  serializeCbsCollegeFootballScheduleResponse,
  type CbsCollegeFootballConfig,
} from "./services/cbsCollegeFootballSchedule.js";
import {
  finalizeWeekAuthoritatively,
  rebuildLeagueStandingsAsNewGeneration,
} from "./services/scoring.js";
import {
  advanceRotation,
  assignPicker,
  assertCurrentWeekProviderAccess,
  configuredProviderForSport,
  createDraftWeekRecord,
  gradeWeekWithResultClaim,
  listCatalog,
  manualGame,
  overrideResult,
  publishSlate,
  refreshWeekGames,
  reopenWeekRecord,
  revealLockedPicks,
  saveDraftSlateRecord,
  submitEntry,
  syncActiveWeeks,
} from "./services/weeks.js";
import {
  requireAdmin,
  requireMembership,
  requirePickerOrAdmin,
  requireUser,
} from "./authz.js";
import {writeAudit} from "./audit.js";
import type {LeagueSettings} from "./types.js";
import {assertProviderAllowedForRuntime} from "./providers/policy.js";
import {sha256} from "./utils.js";

async function requireCbsCollegeFootballArena(input: {
  leagueId: string;
  season: number;
  seasonType: "regular" | "postseason";
  week: number;
  division: "FBS";
}): Promise<{
  league: FirebaseFirestore.DocumentData;
  configuration: CbsCollegeFootballConfig;
}> {
  const leagueSnapshot = await db.collection("leagues").doc(input.leagueId)
    .get();
  const league = leagueSnapshot.data();
  if (!leagueSnapshot.exists || league === undefined) {
    throw new HttpsError("not-found", "Arena not found.");
  }
  const settings =
    (league.settings as Partial<LeagueSettings> | undefined) ?? {};
  if (configuredProviderForSport(settings, "NCAAF") !== "cbsSports") {
    throw new HttpsError(
      "failed-precondition",
      "CBS college football is not configured for this arena.",
    );
  }
  const configuration = await readCbsCollegeFootballConfiguration();
  assertCbsCollegeFootballActiveIdentity(configuration, input);
  return {league, configuration};
}

function definedSettings(
  value: Record<string, unknown>,
): Partial<LeagueSettings> {
  return Object.fromEntries(
    Object.entries(value).filter(([, setting]) => setting !== undefined),
  ) as Partial<LeagueSettings>;
}

export const ensureUserProfile = callable(
  "ensureUserProfile",
  ensureUserProfileSchema,
  async (input, request) => {
    const user = requireUser(request);
    return ensureProfile(user, {
      ...(input.displayName === undefined
        ? {}
        : {displayName: input.displayName}),
      ...(input.photoUrl === undefined ? {} : {photoUrl: input.photoUrl}),
    });
  },
);

export const createLeague = callable(
  "createLeague",
  createLeagueSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    await ensureProfile(user, {});
    const cbsConfiguration = await readCbsCollegeFootballConfiguration();
    const settings = withCbsProviderForNewLeague(
      definedSettings(input.settings),
      cbsConfiguration.enabled,
    );
    return createLeagueRecord({
      user,
      requestId,
      name: input.name,
      timezone: input.timezone,
      settings,
    });
  },
  {secrets: [INVITE_CODE_PEPPER]},
);

export const joinLeagueByCode = callable(
  "joinLeagueByCode",
  joinLeagueSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    await ensureProfile(user, {});
    return joinByInvite({
      user,
      request,
      requestId,
      inviteCode: input.inviteCode,
      ...(input.nickname === undefined ? {} : {nickname: input.nickname}),
    });
  },
  {secrets: [INVITE_CODE_PEPPER]},
);

export const leaveLeague = callable(
  "leaveLeague",
  leaveLeagueSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    await leaveLeagueRecord({
      leagueId: input.leagueId,
      actorUid: user.uid,
      requestId,
    });
    return {left: true};
  },
);

export const rotateInviteCode = callable(
  "rotateInviteCode",
  rotateInviteCodeSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    return rotateInvite({
      leagueId: input.leagueId,
      actorUid: user.uid,
      requestId,
      expiresAt: input.expiresAt,
      maxUses: input.maxUses,
    });
  },
  {secrets: [INVITE_CODE_PEPPER]},
);

export const issueArenaInvite = callable(
  "issueArenaInvite",
  issueArenaInviteSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    return issueArenaInviteRecord({
      leagueId: input.leagueId,
      actorUid: user.uid,
      requestId,
      ...(input.expiresAt === undefined
        ? {}
        : {expiresAt: input.expiresAt}),
      maxUses: input.maxUses,
    });
  },
  {secrets: [INVITE_CODE_PEPPER]},
);

export const revokeArenaInvite = callable(
  "revokeArenaInvite",
  revokeArenaInviteSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    return revokeArenaInviteRecord({
      leagueId: input.leagueId,
      actorUid: user.uid,
      requestId,
      inviteId: input.inviteId,
    });
  },
);

export const updateLeagueSettings = callable(
  "updateLeagueSettings",
  updateLeagueSettingsSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    await updateSettings({
      leagueId: input.leagueId,
      actorUid: user.uid,
      requestId,
      settings: definedSettings(input.settings),
    });
    return {updated: true};
  },
);

export const updateMemberRoleOrStatus = callable(
  "updateMemberRoleOrStatus",
  updateMemberSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    await updateMember({
      leagueId: input.leagueId,
      actorUid: user.uid,
      requestId,
      memberUid: input.memberUid,
      ...(input.role === undefined ? {} : {role: input.role}),
      ...(input.status === undefined ? {} : {status: input.status}),
    });
    return {updated: true};
  },
);

export const reorderPickerRotation = callable(
  "reorderPickerRotation",
  reorderRotationSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    await reorderRotation({
      leagueId: input.leagueId,
      actorUid: user.uid,
      requestId,
      orderedMemberUids: input.orderedMemberUids,
    });
    return {updated: true};
  },
);

export const createDraftWeek = callable(
  "createDraftWeek",
  createDraftWeekSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    return createDraftWeekRecord({
      leagueId: input.leagueId,
      actorUid: user.uid,
      requestId,
      sequentialNumber: input.sequentialNumber,
      label: input.label,
      startAt: input.startAt,
      endAt: input.endAt,
      ...(input.pickerUid === undefined ? {} : {pickerUid: input.pickerUid}),
    });
  },
);

export const createNextWeek = callable(
  "createNextWeek",
  createDraftWeekSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    return createDraftWeekRecord({
      leagueId: input.leagueId,
      actorUid: user.uid,
      requestId,
      sequentialNumber: input.sequentialNumber,
      label: input.label,
      startAt: input.startAt,
      endAt: input.endAt,
      ...(input.pickerUid === undefined ? {} : {pickerUid: input.pickerUid}),
    });
  },
);

export const assignWeeklyPicker = callable(
  "assignWeeklyPicker",
  assignPickerSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    await assignPicker({
      leagueId: input.leagueId,
      weekId: input.weekId,
      pickerUid: input.pickerUid,
      actorUid: user.uid,
      requestId,
    });
    return {updated: true};
  },
);

export const listSportsCatalog = callable(
  "listSportsCatalog",
  sportsCatalogSchema,
  async (input, request) => {
    const user = requireUser(request);
    return listCatalog({
      leagueId: input.leagueId,
      weekId: input.weekId,
      actorUid: user.uid,
      query: {
        ...(input.sportCode === undefined
          ? {}
          : {sportCode: input.sportCode}),
        ...(input.leagueCode === undefined
          ? {}
          : {leagueCode: input.leagueCode}),
        ...(input.leagueIdForProvider === undefined
          ? {}
          : {providerLeagueId: input.leagueIdForProvider}),
        ...(input.season === undefined ? {} : {season: input.season}),
        ...(input.seasonType === undefined
          ? {}
          : {seasonType: input.seasonType}),
        ...(input.week === undefined ? {} : {week: input.week}),
        ...(input.division === undefined
          ? {}
          : {division: input.division}),
        ...(input.from === undefined ? {} : {from: input.from}),
        ...(input.to === undefined ? {} : {to: input.to}),
        ...(input.timezone === undefined
          ? {}
          : {timezone: input.timezone}),
        ...(input.dateMode === undefined ? {} : {dateMode: input.dateMode}),
        forceRefresh: input.forceRefresh,
      },
    });
  },
);

export const getCollegeFootballSchedule = callable(
  "getCollegeFootballSchedule",
  collegeFootballScheduleSchema,
  async (input, request) => {
    const user = requireUser(request);
    await requireMembership(input.leagueId, user.uid);
    assertProviderAllowedForRuntime("cbsSports");
    const {league, configuration} = await requireCbsCollegeFootballArena(input);
    const currentWeekId = league.currentWeekId;
    if (typeof currentWeekId !== "string" || currentWeekId.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "The arena does not have a current week for schedule access.",
      );
    }
    await requirePickerOrAdmin(input.leagueId, currentWeekId, user.uid);
    const scheduleInput = {
      season: input.season,
      seasonType: input.seasonType,
      week: input.week,
      division: input.division,
    };
    const schedule = await loadCbsCollegeFootballSchedule(
      scheduleInput,
      {},
      {configuration},
    );
    return serializeCbsCollegeFootballScheduleResponse(schedule);
  },
);

export const refreshCollegeFootballScheduleAdmin = callable(
  "refreshCollegeFootballScheduleAdmin",
  collegeFootballAdminRefreshSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    const {member} = await requirePickerOrAdmin(
      input.leagueId,
      input.weekId,
      user.uid,
    );
    assertProviderAllowedForRuntime("cbsSports");
    const {league, configuration} =
      await requireCbsCollegeFootballArena(input);
    assertCurrentWeekProviderAccess({
      role: member.role,
      currentWeekId: league.currentWeekId,
      requestedWeekId: input.weekId,
    });
    logger.info("CBS college-football administrative refresh requested", {
      functionName: "refreshCollegeFootballScheduleAdmin",
      requestId,
      season: input.season,
      seasonType: input.seasonType,
      week: input.week,
      division: input.division,
      reasonLength: input.reason.length,
      reasonFingerprint: sha256({reason: input.reason}),
    });
    const schedule = await loadCbsCollegeFootballSchedule(
      {
        season: input.season,
        seasonType: input.seasonType,
        week: input.week,
        division: input.division,
      },
      {forceRefresh: true, refreshReason: "admin"},
      {configuration},
    );
    return serializeCbsCollegeFootballScheduleResponse(schedule);
  },
);

export const saveDraftSlate = callable(
  "saveDraftSlate",
  saveDraftSlateSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    return saveDraftSlateRecord({
      leagueId: input.leagueId,
      weekId: input.weekId,
      actorUid: user.uid,
      requestId,
      chunkKey: input.chunkKey,
      games: input.games,
      removeGameIds: input.removeGameIds,
    });
  },
);

export const publishWeeklySlate = callable(
  "publishWeeklySlate",
  publishSlateSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    return publishSlate({
      leagueId: input.leagueId,
      weekId: input.weekId,
      actorUid: user.uid,
      requestId,
    });
  },
);

export const submitOrConfirmEntry = callable(
  "submitOrConfirmEntry",
  submitEntrySchema,
  async (input, request) => {
    const user = requireUser(request);
    return submitEntry({
      leagueId: input.leagueId,
      weekId: input.weekId,
      actorUid: user.uid,
      picks: input.picks,
    });
  },
);

function refreshCallable(functionName: string) {
  return callable(
    functionName,
    selectedGamesSchema,
    async (input, request, requestId) => {
      const user = requireUser(request);
      return refreshWeekGames({
        leagueId: input.leagueId,
        weekId: input.weekId,
        actorUid: user.uid,
        requestId,
        forceRefresh: input.forceRefresh,
        ...(input.gameId === undefined ? {} : {gameId: input.gameId}),
      });
    },
    {
      // A slate has no artificial game maximum. Provider requests remain
      // bounded per cache chunk, while the callable has room to process
      // multiple chunks and league groups in one claimed operation.
      timeoutSeconds: 540,
    },
  );
}

export const refreshSelectedGames = refreshCallable("refreshSelectedGames");
export const syncSelectedGameResults = refreshCallable(
  "syncSelectedGameResults",
);

export const revealLockedGamePicks = callable(
  "revealLockedGamePicks",
  revealLockedPicksSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    return revealLockedPicks({
      leagueId: input.leagueId,
      weekId: input.weekId,
      actorUid: user.uid,
      requestId,
      revealCursor: input.revealCursor,
      revealPageSize: input.revealPageSize,
    });
  },
);

export const calculateProvisionalWeekResults = callable(
  "calculateProvisionalWeekResults",
  weekMutationSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    await requireAdmin(input.leagueId, user.uid);
    return gradeWeekWithResultClaim({
      leagueId: input.leagueId,
      weekId: input.weekId,
      requestId,
    });
  },
);

export const overrideGameResult = callable(
  "overrideGameResult",
  overrideGameSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    return overrideResult({
      leagueId: input.leagueId,
      weekId: input.weekId,
      gameId: input.gameId,
      actorUid: user.uid,
      requestId,
      ...(input.scheduledAtUtc === undefined
        ? {}
        : {scheduledAtUtc: input.scheduledAtUtc}),
      status: input.status,
      homeScore: input.homeScore,
      awayScore: input.awayScore,
      winnerTeamId: input.winnerTeamId,
      reason: input.reason,
    });
  },
);

export const voidGame = callable(
  "voidGame",
  voidGameSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    return overrideResult({
      leagueId: input.leagueId,
      weekId: input.weekId,
      gameId: input.gameId,
      actorUid: user.uid,
      requestId,
      status: "void",
      homeScore: null,
      awayScore: null,
      winnerTeamId: null,
      reason: input.reason,
    });
  },
);

export const finalizeWeek = callable(
  "finalizeWeek",
  weekMutationSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    await requireAdmin(input.leagueId, user.uid);
    return finalizeWeekAuthoritatively({
      leagueId: input.leagueId,
      weekId: input.weekId,
      actorUid: user.uid,
      requestId,
    });
  },
);

export const reopenWeek = callable(
  "reopenWeek",
  reasonSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    await reopenWeekRecord({
      leagueId: input.leagueId,
      weekId: input.weekId,
      actorUid: user.uid,
      requestId,
      reason: input.reason,
    });
    return {reopened: true};
  },
);

export const rebuildStandings = callable(
  "rebuildStandings",
  leagueMutationSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    await requireAdmin(input.leagueId, user.uid);
    const standings = await rebuildLeagueStandingsAsNewGeneration(
      input.leagueId,
    );
    await writeAudit({
      leagueId: input.leagueId,
      eventType: "standings_rebuilt",
      actorUid: user.uid,
      target: "standings",
      requestId,
      after: {memberCount: standings.length},
    });
    return {memberCount: standings.length};
  },
);

export const advancePickerRotation = callable(
  "advancePickerRotation",
  weekMutationSchema,
  async (input, request) => {
    const user = requireUser(request);
    return advanceRotation({
      leagueId: input.leagueId,
      weekId: input.weekId,
      actorUid: user.uid,
    });
  },
);

export const createManualGame = callable(
  "createManualGame",
  manualGameSchema,
  async (input, request, requestId) => {
    const user = requireUser(request);
    return manualGame({
      leagueId: input.leagueId,
      weekId: input.weekId,
      actorUid: user.uid,
      requestId,
      sportCode: input.sportCode,
      leagueCode: input.leagueCode,
      leagueName: input.leagueName,
      season: input.season,
      scheduledAtUtc: input.scheduledAtUtc,
      venueName: input.venueName,
      neutralSite: input.neutralSite,
      homeTeam: input.homeTeam,
      awayTeam: input.awayTeam,
    });
  },
);

export const deleteOrAnonymizeAccount = callable(
  "deleteOrAnonymizeAccount",
  deleteAccountSchema,
  async (_input, request, requestId) => {
    const user = requireUser(request);
    await anonymizeAccount({user, requestId});
    return {deleted: true, historicalRecordsPreserved: true};
  },
);

export const scheduledResultSync = onSchedule(
  {
    schedule: "every 30 minutes",
    timeZone: "UTC",
    retryCount: 0,
    timeoutSeconds: 540,
  },
  async () => {
    const startedAt = Date.now();
    try {
      await syncActiveWeeks();
      logger.info("Scheduled result sync completed", {
        functionName: "scheduledResultSync",
        durationMs: Date.now() - startedAt,
        outcome: "success",
      });
    } catch (error: unknown) {
      logger.error("Scheduled result sync failed", {
        functionName: "scheduledResultSync",
        durationMs: Date.now() - startedAt,
        safeErrorCode: error instanceof Error ? error.name : "UnknownError",
      });
      throw error;
    }
  },
);

export const refreshActiveCollegeFootballSchedule = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: "UTC",
    retryCount: 0,
    timeoutSeconds: 120,
  },
  async () => {
    const startedAt = Date.now();
    try {
      assertProviderAllowedForRuntime("cbsSports");
      const result = await refreshActiveCbsCollegeFootballSchedule();
      logger.info("Scheduled CBS college-football refresh check completed", {
        functionName: "refreshActiveCollegeFootballSchedule",
        durationMs: Date.now() - startedAt,
        outcome: "success",
        activeScheduleConfigured: result !== null,
        cacheStatus: result?.cacheStatus ?? null,
        gameCount: result?.games.length ?? 0,
        nextRefreshAt: result?.nextRefreshAt?.toISOString() ?? null,
      });
    } catch (error: unknown) {
      logger.error("Scheduled CBS college-football refresh check failed", {
        functionName: "refreshActiveCollegeFootballSchedule",
        durationMs: Date.now() - startedAt,
        safeErrorCode: error instanceof Error ? error.name : "UnknownError",
      });
      throw error;
    }
  },
);

// Kept as an explicit protected recovery capability for client parity.
export const getGameForReview = callable(
  "getGameForReview",
  gameMutationSchema,
  async (input, request) => {
    const user = requireUser(request);
    await requireAdmin(input.leagueId, user.uid);
    const snapshot = await (
      await import("./config.js")
    ).db
      .collection("leagues")
      .doc(input.leagueId)
      .collection("weeks")
      .doc(input.weekId)
      .collection("games")
      .doc(input.gameId)
      .get();
    if (!snapshot.exists) return {game: null};
    return {game: snapshot.data()};
  },
);
