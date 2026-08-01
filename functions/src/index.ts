import {logger} from "firebase-functions";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {callable} from "./callable.js";
import {INVITE_CODE_PEPPER} from "./config.js";
import {
  assignPickerSchema,
  createDraftWeekSchema,
  createLeagueSchema,
  deleteAccountSchema,
  ensureUserProfileSchema,
  gameMutationSchema,
  joinLeagueSchema,
  leagueMutationSchema,
  leaveLeagueSchema,
  manualGameSchema,
  overrideGameSchema,
  publishSlateSchema,
  reasonSchema,
  revealLockedPicksSchema,
  reorderRotationSchema,
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
  joinByInvite,
  leaveLeagueRecord,
  reorderRotation,
  rotateInvite,
  updateMember,
  updateSettings,
} from "./services/leagues.js";
import {
  finalizeWeekAuthoritatively,
  rebuildLeagueStandingsAsNewGeneration,
} from "./services/scoring.js";
import {
  advanceRotation,
  assignPicker,
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
import {requireAdmin, requireUser} from "./authz.js";
import {writeAudit} from "./audit.js";
import type {LeagueSettings} from "./types.js";

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
    return createLeagueRecord({
      user,
      requestId,
      name: input.name,
      timezone: input.timezone,
      settings: definedSettings(input.settings),
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
