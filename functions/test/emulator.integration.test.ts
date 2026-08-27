import {
  deleteApp,
  initializeApp,
  type FirebaseApp,
} from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import {
  type App as AdminApp,
  deleteApp as deleteAdminApp,
  initializeApp as initializeAdminApp,
} from "firebase-admin/app";
import {
  type DocumentData,
  FieldValue,
  Timestamp,
  getFirestore as getAdminFirestore,
} from "firebase-admin/firestore";
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {
  buildCbsCollegeFootballScoreboardUrl,
  CBS_COLLEGE_FOOTBALL_PARSER_VERSION,
} from "../src/providers/cbsCollegeFootball.js";
import {normalizedGameSchema} from "../src/schemas.js";
import {
  cbsCollegeFootballCacheDocumentId,
  cbsCollegeFootballGamesContentHash,
} from "../src/services/cbsCollegeFootballSchedule.js";
import {repairFinalizedWeekFollowUps} from "../src/services/scoring.js";
import {
  MAX_GAME_RESCHEDULE_OFFSET_MS,
  calendarDateInTimezone,
  publishSlate,
  reopenWeekRecord,
  revealLockedPicks,
} from "../src/services/weeks.js";

const projectId = "demo-lukes-picks-local";
const apps: FirebaseApp[] = [];
let maintenanceAdminApp: AdminApp | undefined;
let requestSequence = 0;

type RevealCallableResult = {
  revealedGameCount: number;
  processingGameCount: number;
  revealsByGame: Record<
    string,
    Array<{uid: string; selectedTeamId: string}>
  >;
  revealPage: {
    included: boolean;
    truncated: boolean;
    returnedPickCount: number;
    nextCursor: {gameId: string; afterUid: string | null} | null;
  };
};

function requestId(label: string): string {
  requestSequence += 1;
  return `${label}_${String(requestSequence).padStart(4, "0")}`;
}

async function createSignedInApp(name: string): Promise<FirebaseApp> {
  const app = initializeApp({projectId, apiKey: "demo-api-key"}, name);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
  await signInAnonymously(auth);
  connectFirestoreEmulator(getFirestore(app), "127.0.0.1", 8080);
  connectFunctionsEmulator(getFunctions(app, "us-central1"), "127.0.0.1", 5001);
  return app;
}

async function call<T>(
  app: FirebaseApp,
  name: string,
  data: Record<string, unknown>,
): Promise<T> {
  const response = await httpsCallable(
    getFunctions(app, "us-central1"),
    name,
  )(data);
  const envelope = response.data as {
    ok: boolean;
    result: T;
  };
  expect(envelope.ok).toBe(true);
  return envelope.result;
}

beforeAll(() => {
  if (
    process.env.FIRESTORE_EMULATOR_HOST === undefined ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST === undefined
  ) {
    throw new Error("Integration tests require Auth, Firestore, and Functions emulators.");
  }
  maintenanceAdminApp = initializeAdminApp(
    {projectId},
    "integration-maintenance-admin",
  );
}, 10_000);

async function clearJoinAttemptLimits(): Promise<void> {
  if (maintenanceAdminApp === undefined) {
    throw new Error("The integration maintenance app is unavailable.");
  }
  const collection = getAdminFirestore(maintenanceAdminApp)
    .collection("joinAttemptLimits");
  for (;;) {
    const documents = await collection.limit(400).get();
    if (documents.empty) return;
    const batch = getAdminFirestore(maintenanceAdminApp).batch();
    for (const document of documents.docs) batch.delete(document.ref);
    await batch.commit();
  }
}

beforeEach(async () => {
  await clearJoinAttemptLimits();
});

afterAll(async () => {
  await Promise.all([
    ...apps.map(async (app) => deleteApp(app)),
    ...(maintenanceAdminApp === undefined
      ? []
      : [deleteAdminApp(maintenanceAdminApp)]),
  ]);
});

describe("emulator pick'em lifecycle", () => {
  it(
    "creates, joins, protects, scores, finalizes, corrects, and advances once",
    async () => {
      const owner = await createSignedInApp("integration-owner");
      const memberA = await createSignedInApp("integration-member-a");
      const memberB = await createSignedInApp("integration-member-b");
      const ownerUid = getAuth(owner).currentUser?.uid;
      const memberAUid = getAuth(memberA).currentUser?.uid;
      const memberBUid = getAuth(memberB).currentUser?.uid;
      expect(ownerUid).toBeTruthy();
      expect(memberAUid).toBeTruthy();
      expect(memberBUid).toBeTruthy();
      const adminApp = initializeAdminApp({projectId}, "integration-admin");
      const adminDb = getAdminFirestore(adminApp);

      const created = await call<{leagueId: string; inviteCode: string}>(
        owner,
        "createLeague",
        {
          requestId: requestId("createleague"),
          name: "Integration Arena",
          timezone: "America/Chicago",
          settings: {providerName: "mock"},
        },
      );
      await call(memberA, "joinLeagueByCode", {
        requestId: requestId("joinmembera"),
        inviteCode: created.inviteCode,
        nickname: "Member A",
      });
      await call(memberB, "joinLeagueByCode", {
        requestId: requestId("joinmemberb"),
        inviteCode: created.inviteCode,
        nickname: "Member B",
      });
      await expect(
        httpsCallable(getFunctions(owner, "us-central1"), "leaveLeague")({
          requestId: requestId("ownerleave"),
          leagueId: created.leagueId,
        }),
      ).rejects.toThrow();
      await expect(
        httpsCallable(
          getFunctions(owner, "us-central1"),
          "deleteOrAnonymizeAccount",
        )({
          requestId: requestId("ownerdelete"),
          confirmation: "DELETE",
        }),
      ).rejects.toThrow();

      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() + 1);
      const end = new Date(start.valueOf() + 7 * 24 * 60 * 60_000);
      const week = await call<{weekId: string; pickerUid: string}>(
        owner,
        "createDraftWeek",
        {
          requestId: requestId("createweek"),
          leagueId: created.leagueId,
          sequentialNumber: 1,
          label: "Integration Week",
          startAt: start.toISOString(),
          endAt: end.toISOString(),
        },
      );
      const weekReference = adminDb.doc(
        `leagues/${created.leagueId}/weeks/${week.weekId}`,
      );
      await expect(
        httpsCallable(
          getFunctions(owner, "us-central1"),
          "publishWeeklySlate",
        )({
          requestId: requestId("empty-publish"),
          leagueId: created.leagueId,
          weekId: week.weekId,
        }),
      ).rejects.toThrow();
      const weekAfterEmptyPublish = await weekReference.get();
      expect(weekAfterEmptyPublish.data()?.publishRequestId).toBeUndefined();
      expect(weekAfterEmptyPublish.data()?.publishStartedAt).toBeUndefined();

      const day = start.toISOString().slice(0, 10);
      const catalog = await call<{
        games: Array<Record<string, unknown>>;
        sports: Array<{code: string; displayName: string}>;
        leagues: Array<{
          code: string;
          displayName: string;
          sportCode: string;
          providerLeagueId: string;
          season: string;
        }>;
        presentation: {
          provider: string;
          allowRemoteLogos: boolean;
        };
        effectiveQuery: {
          providerLeagueId: string;
          timezone: string;
        };
        availability: {state: string};
        week: {startAt: string; endAt: string};
      }>(owner, "listSportsCatalog", {
        requestId: requestId("listgames"),
        leagueId: created.leagueId,
        weekId: week.weekId,
        sportCode: "football",
        leagueCode: "demo-football",
        leagueIdForProvider: "demo-football",
        season: "demo",
        from: day,
        to: day,
        timezone: "America/Chicago",
        forceRefresh: false,
      });
      expect(catalog.games.length).toBeGreaterThan(0);
      expect(catalog.sports).toContainEqual({
        code: "football",
        displayName: "Football",
      });
      expect(catalog.leagues).toContainEqual({
        code: "demo-football",
        displayName: "Demo Football",
        sportCode: "football",
        providerLeagueId: "demo-football",
        provider: "mock",
        season: "demo",
      });
      expect(catalog.presentation).toEqual(
        expect.objectContaining({provider: "mock", allowRemoteLogos: false}),
      );
      expect(catalog.effectiveQuery).toEqual(
        expect.objectContaining({
          providerLeagueId: "demo-football",
          timezone: "America/Chicago",
        }),
      );
      expect(catalog.availability.state).toBe("available");
      expect(catalog.week).toEqual({
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      });
      const cachedCatalog = await call<{
        cache: {hit: boolean};
      }>(owner, "listSportsCatalog", {
        requestId: requestId("cachedgames"),
        leagueId: created.leagueId,
        weekId: week.weekId,
        sportCode: "football",
        leagueCode: "demo-football",
        leagueIdForProvider: "demo-football",
        season: "demo",
        from: day,
        to: day,
        timezone: "America/Chicago",
        forceRefresh: false,
      });
      expect(cachedCatalog.cache.hit).toBe(true);
      await expect(
        httpsCallable(
          getFunctions(memberA, "us-central1"),
          "listSportsCatalog",
        )({
          requestId: requestId("membercatalog"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          sportCode: "football",
          leagueCode: "demo-football",
          leagueIdForProvider: "demo-football",
          season: "demo",
          from: day,
          to: day,
          timezone: "America/Chicago",
          forceRefresh: false,
        }),
      ).rejects.toThrow();
      await expect(
        httpsCallable(
          getFunctions(memberA, "us-central1"),
          "listSportsCatalog",
        )({
          requestId: requestId("memberforce"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          sportCode: "football",
          leagueCode: "demo-football",
          leagueIdForProvider: "demo-football",
          season: "demo",
          from: day,
          to: day,
          timezone: "America/Chicago",
          forceRefresh: true,
        }),
      ).rejects.toThrow();
      const selectedGame = catalog.games[0];
      expect(selectedGame).toBeDefined();
      const gameId = String(selectedGame?.id);
      const catalogReference = adminDb.doc(`sportsCatalogGames/${gameId}`);
      await catalogReference.update({
        catalogEligibleUntil: Timestamp.fromMillis(Date.now() - 60_000),
      });
      await expect(
        httpsCallable(
          getFunctions(owner, "us-central1"),
          "saveDraftSlate",
        )({
          requestId: requestId("stale-catalog"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          chunkKey: requestId("stale-chunk"),
          games: [selectedGame],
          removeGameIds: [],
        }),
      ).rejects.toThrow();
      const weekAfterStaleCatalog = await weekReference.get();
      expect(
        weekAfterStaleCatalog.data()?.draftMutationRequestId,
      ).toBeUndefined();
      expect(
        weekAfterStaleCatalog.data()?.draftMutationStartedAt,
      ).toBeUndefined();
      await catalogReference.update({
        catalogUpdatedAt: Timestamp.now(),
        catalogEligibleUntil: Timestamp.fromMillis(
          Date.now() + 24 * 60 * 60_000,
        ),
      });
      await weekReference.update({
        publishRequestId: "active-publish",
        publishStartedAt: Timestamp.now(),
      });
      await expect(
        httpsCallable(
          getFunctions(owner, "us-central1"),
          "saveDraftSlate",
        )({
          requestId: requestId("save-during-publish"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          chunkKey: requestId("racing-chunk"),
          games: [selectedGame],
          removeGameIds: [],
        }),
      ).rejects.toThrow();
      await weekReference.update({
        publishRequestId: FieldValue.delete(),
        publishStartedAt: FieldValue.delete(),
      });
      await call(owner, "saveDraftSlate", {
        requestId: requestId("saveslate"),
        leagueId: created.leagueId,
        weekId: week.weekId,
        chunkKey: requestId("slatechunk"),
        games: [selectedGame],
        removeGameIds: [],
      });
      await catalogReference.update({
        catalogEligibleUntil: Timestamp.fromMillis(Date.now() - 60_000),
      });
      await expect(
        httpsCallable(
          getFunctions(owner, "us-central1"),
          "publishWeeklySlate",
        )({
          requestId: requestId("publish-stale-catalog"),
          leagueId: created.leagueId,
          weekId: week.weekId,
        }),
      ).rejects.toThrow();
      await catalogReference.update({
        catalogUpdatedAt: Timestamp.now(),
        catalogEligibleUntil: Timestamp.fromMillis(
          Date.now() + 24 * 60 * 60_000,
        ),
        sourcePayloadHash: "a".repeat(64),
      });
      await expect(
        httpsCallable(
          getFunctions(owner, "us-central1"),
          "publishWeeklySlate",
        )({
          requestId: requestId("publish-changed-catalog"),
          leagueId: created.leagueId,
          weekId: week.weekId,
        }),
      ).rejects.toThrow();
      await catalogReference.update({
        sourcePayloadHash: String(selectedGame?.sourcePayloadHash),
      });
      await weekReference.update({
        draftMutationRequestId: "active-draft-save",
        draftMutationStartedAt: Timestamp.now(),
      });
      await expect(
        httpsCallable(
          getFunctions(owner, "us-central1"),
          "publishWeeklySlate",
        )({
          requestId: requestId("publish-during-save"),
          leagueId: created.leagueId,
          weekId: week.weekId,
        }),
      ).rejects.toThrow();
      await weekReference.update({
        draftMutationRequestId: FieldValue.delete(),
        draftMutationStartedAt: FieldValue.delete(),
        publishRequestId: "abandoned-publish",
        publishStartedAt: Timestamp.fromMillis(Date.now() - 6 * 60_000),
      });
      const publishRequestId = requestId("publish");
      let signalPublishClaimed!: () => void;
      const publishClaimed = new Promise<void>((resolve) => {
        signalPublishClaimed = resolve;
      });
      let releasePublish!: () => void;
      const publishReleased = new Promise<void>((resolve) => {
        releasePublish = resolve;
      });
      const trailingPublish = publishSlate(
        {
          requestId: publishRequestId,
          leagueId: created.leagueId,
          weekId: week.weekId,
          actorUid: String(ownerUid),
        },
        {
          afterClaim: async () => {
            signalPublishClaimed();
            await publishReleased;
          },
        },
      );
      await publishClaimed;
      await expect(
        publishSlate({
          requestId: publishRequestId,
          leagueId: created.leagueId,
          weekId: week.weekId,
          actorUid: String(ownerUid),
        }),
      ).rejects.toThrow();
      const ownedPublishClaim = await weekReference.get();
      expect(ownedPublishClaim.data()).toMatchObject({
        status: "draft",
        publishRequestId,
      });
      expect(typeof ownedPublishClaim.data()?.publishClaimId).toBe("string");
      releasePublish();
      await expect(trailingPublish).resolves.toMatchObject({published: true});
      const publishedWeekForMember = await getDoc(
        doc(
          getFirestore(memberA),
          `leagues/${created.leagueId}/weeks/${week.weekId}`,
        ),
      );
      expect(publishedWeekForMember.data()).toMatchObject({
        status: "open",
        catalogProviderSnapshot: "mock",
        catalogPresentationSnapshot: {
          provider: "mock",
          attributionText: null,
          allowRemoteLogos: false,
          allowedLogoHosts: [],
          allowedLogoQueryParameters: [],
          logoRightsReviewDate: null,
        },
      });
      await weekReference.update({status: "review"});
      const publishedRetry = await call<{
        published: boolean;
        selectedGameCount: number;
        eligibleMemberCount: number;
      }>(owner, "publishWeeklySlate", {
        requestId: publishRequestId,
        leagueId: created.leagueId,
        weekId: week.weekId,
      });
      expect(publishedRetry).toMatchObject({
        published: true,
        selectedGameCount: 1,
        eligibleMemberCount: 2,
      });
      await weekReference.update({status: "open"});

      const gameReference = adminDb.doc(
        `leagues/${created.leagueId}/weeks/${week.weekId}/games/${gameId}`,
      );
      await expect(
        httpsCallable(
          getFunctions(memberA, "us-central1"),
          "refreshSelectedGames",
        )({
          requestId: requestId("member-game-refresh"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          gameId,
          forceRefresh: true,
        }),
      ).rejects.toThrow();
      await expect(
        call<{updatedGameCount: number; delayed: boolean}>(
          owner,
          "refreshSelectedGames",
          {
            requestId: requestId("admin-game-refresh"),
            leagueId: created.leagueId,
            weekId: week.weekId,
            gameId,
            forceRefresh: true,
          },
        ),
      ).resolves.toMatchObject({delayed: false});

      const originalGame = await gameReference.get();
      const originalScheduledAt = originalGame.data()?.scheduledAtUtc;
      const originalPublishedAt = originalGame.data()?.publishedScheduledAtUtc;
      const originalLockAt = originalGame.data()?.effectiveLockAtUtc;
      expect(originalScheduledAt).toBeInstanceOf(Timestamp);
      expect(originalPublishedAt).toBeInstanceOf(Timestamp);
      expect(originalLockAt).toBeInstanceOf(Timestamp);
      if (
        !(originalScheduledAt instanceof Timestamp) ||
        !(originalPublishedAt instanceof Timestamp) ||
        !(originalLockAt instanceof Timestamp)
      ) {
        throw new Error("Published integration game timestamps are missing.");
      }
      const laterStart = Timestamp.fromMillis(
        originalScheduledAt.toMillis() + 30 * 60_000,
      );
      const earlierStart = Timestamp.fromMillis(
        originalScheduledAt.toMillis() - 15 * 60_000,
      );
      await expect(
        httpsCallable(
          getFunctions(memberA, "us-central1"),
          "overrideGameResult",
        )({
          requestId: requestId("member-reschedule"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          gameId,
          scheduledAtUtc: laterStart.toDate().toISOString(),
          status: "delayed",
          homeScore: null,
          awayScore: null,
          winnerTeamId: null,
          reason: "Member cannot reschedule a published game.",
        }),
      ).rejects.toThrow();
      await expect(
        httpsCallable(
          getFunctions(owner, "us-central1"),
          "overrideGameResult",
        )({
          requestId: requestId("invalid-status-score"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          gameId,
          status: "suspended",
          homeScore: 1,
          awayScore: null,
          winnerTeamId: null,
          reason: "A suspended game cannot carry a score.",
        }),
      ).rejects.toThrow();
      const outsideWeekStart = Timestamp.fromMillis(end.valueOf() + 1);
      await call(owner, "overrideGameResult", {
        requestId: requestId("outside-week-reschedule"),
        leagueId: created.leagueId,
        weekId: week.weekId,
        gameId,
        scheduledAtUtc: outsideWeekStart.toDate().toISOString(),
        status: "postponed",
        homeScore: null,
        awayScore: null,
        winnerTeamId: null,
        reason: "Postponed game moved beyond the original arena week.",
      });
      expect((await gameReference.get()).data()).toMatchObject({
        scheduledAtUtc: outsideWeekStart,
        publishedScheduledAtUtc: originalPublishedAt,
        effectiveLockAtUtc: originalLockAt,
        status: "postponed",
      });
      await expect(
        httpsCallable(
          getFunctions(owner, "us-central1"),
          "overrideGameResult",
        )({
          requestId: requestId("absurd-reschedule"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          gameId,
          scheduledAtUtc: new Date(
            originalPublishedAt.toMillis() +
              MAX_GAME_RESCHEDULE_OFFSET_MS +
              1,
          ).toISOString(),
          status: "postponed",
          homeScore: null,
          awayScore: null,
          winnerTeamId: null,
          reason: "Implausible reschedule must fail the sanity bound.",
        }),
      ).rejects.toThrow();
      await call(owner, "overrideGameResult", {
        requestId: requestId("later-reschedule"),
        leagueId: created.leagueId,
        weekId: week.weekId,
        gameId,
        scheduledAtUtc: laterStart.toDate().toISOString(),
        status: "delayed",
        homeScore: null,
        awayScore: null,
        winnerTeamId: null,
        reason: "Provider announced a delayed scheduled start.",
      });
      const laterGame = await gameReference.get();
      expect(laterGame.data()).toMatchObject({
        scheduledAtUtc: laterStart,
        publishedScheduledAtUtc: originalPublishedAt,
        effectiveLockAtUtc: originalLockAt,
        status: "delayed",
        homeScore: null,
        awayScore: null,
        winnerTeamId: null,
        manualOverride: true,
      });
      const earlierRequestId = requestId("earlier-reschedule");
      await call(owner, "overrideGameResult", {
        requestId: earlierRequestId,
        leagueId: created.leagueId,
        weekId: week.weekId,
        gameId,
        scheduledAtUtc: earlierStart.toDate().toISOString(),
        status: "scheduled",
        homeScore: null,
        awayScore: null,
        winnerTeamId: null,
        reason: "Provider corrected the game to an earlier start.",
      });
      const [earlierGame, rescheduleAudits] = await Promise.all([
        gameReference.get(),
        adminDb
          .collection(`leagues/${created.leagueId}/auditLogs`)
          .where("requestId", "==", earlierRequestId)
          .get(),
      ]);
      expect(earlierGame.data()).toMatchObject({
        scheduledAtUtc: earlierStart,
        publishedScheduledAtUtc: originalPublishedAt,
        effectiveLockAtUtc: earlierStart,
        status: "scheduled",
        homeScore: null,
        awayScore: null,
        winnerTeamId: null,
      });
      expect(rescheduleAudits.size).toBe(1);
      expect(rescheduleAudits.docs[0]?.data()).toMatchObject({
        eventType: "game_overridden",
        before: {
          scheduledAtUtc: laterStart.toDate().toISOString(),
          publishedScheduledAtUtc: originalPublishedAt.toDate().toISOString(),
          effectiveLockAtUtc: originalLockAt.toDate().toISOString(),
          status: "delayed",
          homeScore: null,
          awayScore: null,
          winnerTeamId: null,
          manualOverride: true,
        },
        after: {
          scheduledAtUtc: earlierStart.toDate().toISOString(),
          publishedScheduledAtUtc: originalPublishedAt.toDate().toISOString(),
          effectiveLockAtUtc: earlierStart.toDate().toISOString(),
          status: "scheduled",
          homeScore: null,
          awayScore: null,
          winnerTeamId: null,
          manualOverride: true,
        },
      });

      const homeTeamId = String(
        (selectedGame?.homeTeam as {id: string}).id,
      );
      const awayTeamId = String(
        (selectedGame?.awayTeam as {id: string}).id,
      );
      await call(memberA, "submitOrConfirmEntry", {
        requestId: requestId("pickmembera"),
        leagueId: created.leagueId,
        weekId: week.weekId,
        picks: [{gameId, selectedTeamId: homeTeamId}],
      });
      const entryAfterPick = await adminDb
        .doc(
          `leagues/${created.leagueId}/weeks/${week.weekId}/entries/${memberAUid}`,
        )
        .get();
      await call(owner, "publishWeeklySlate", {
        requestId: publishRequestId,
        leagueId: created.leagueId,
        weekId: week.weekId,
      });
      const entryAfterPublishReplay = await entryAfterPick.ref.get();
      expect(entryAfterPublishReplay.data()).toMatchObject({
        savedPickCount: entryAfterPick.data()?.savedPickCount,
        completionState: entryAfterPick.data()?.completionState,
      });
      await call(memberB, "submitOrConfirmEntry", {
        requestId: requestId("pickmemberb"),
        leagueId: created.leagueId,
        weekId: week.weekId,
        picks: [{gameId, selectedTeamId: awayTeamId}],
      });

      await expect(
        getDoc(
          doc(
            getFirestore(memberB),
            `leagues/${created.leagueId}/weeks/${week.weekId}/entries/${memberAUid}/picks/${gameId}`,
          ),
        ),
      ).rejects.toThrow();

      await call(owner, "overrideGameResult", {
        requestId: requestId("future-override"),
        leagueId: created.leagueId,
        weekId: week.weekId,
        gameId,
        status: "final",
        homeScore: 24,
        awayScore: 17,
        winnerTeamId: homeTeamId,
        reason: "Future result privacy regression.",
      });
      const [futureEntryA, futureEntryB, futureWeek, futurePickA] =
        await Promise.all([
          adminDb
            .doc(
              `leagues/${created.leagueId}/weeks/${week.weekId}/entries/${memberAUid}`,
            )
            .get(),
          adminDb
            .doc(
              `leagues/${created.leagueId}/weeks/${week.weekId}/entries/${memberBUid}`,
            )
            .get(),
          weekReference.get(),
          adminDb
            .doc(
              `leagues/${created.leagueId}/weeks/${week.weekId}/entries/${memberAUid}/picks/${gameId}`,
            )
            .get(),
        ]);
      for (const entry of [futureEntryA, futureEntryB]) {
        expect(entry.data()).toMatchObject({
          gradedCount: 0,
          correctCount: 0,
          incorrectCount: 0,
          voidCount: 0,
          points: 0,
          accuracy: null,
          weeklyRank: null,
          isWeeklyWinner: false,
        });
      }
      expect(futureWeek.data()?.winnerUids).toEqual([]);
      expect(futureWeek.data()?.highScore).toBeNull();
      expect(futureWeek.data()?.resultMutationRequestId).toBeUndefined();
      expect(futureWeek.data()?.gameResultsVersion).toBe(4);
      expect(futurePickA.data()?.outcome).toBe("pending");
      expect(futurePickA.data()?.points).toBe(0);
      await weekReference.update({
        finalizationRequestId: "active-finalization",
        finalizationStartedAt: Timestamp.now(),
      });
      await expect(
        httpsCallable(
          getFunctions(owner, "us-central1"),
          "overrideGameResult",
        )({
          requestId: requestId("override-during-finalize"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          gameId,
          status: "final",
          homeScore: 17,
          awayScore: 24,
          winnerTeamId: awayTeamId,
          reason: "Must not cross a finalization claim.",
        }),
      ).rejects.toThrow();
      await weekReference.update({
        finalizationRequestId: FieldValue.delete(),
        finalizationStartedAt: FieldValue.delete(),
      });
      expect((await gameReference.get()).data()?.winnerTeamId).toBe(homeTeamId);
      const preexistingRevealReference = adminDb.doc(
        `leagues/${created.leagueId}/weeks/${week.weekId}/reveals/${gameId}/picks/${memberAUid}`,
      );
      await Promise.all([
        gameReference.update({
          effectiveLockAtUtc: Timestamp.fromMillis(Date.now() - 60_000),
          status: "final",
          homeScore: 24,
          awayScore: 17,
          winnerTeamId: homeTeamId,
          resultVersion: "integration-home-result",
          pickRevealClaimId: "abandoned-reveal-claim",
          pickRevealRequestId: "abandoned-reveal-request",
          pickRevealStartedAt: Timestamp.fromMillis(Date.now() - 6 * 60_000),
          pickRevealHeartbeatAt: Timestamp.fromMillis(Date.now() - 6 * 60_000),
        }),
        preexistingRevealReference.set({
          uid: memberAUid,
          selectedTeamId: homeTeamId,
          displayName: "Member A",
          outcome: "correct",
          points: 1,
          outcomeVersion: "integration-home-result",
        }),
      ]);
      const concurrentReveals = await Promise.all([
        call<RevealCallableResult>(owner, "revealLockedGamePicks", {
          requestId: requestId("reveal-a"),
          leagueId: created.leagueId,
          weekId: week.weekId,
        }),
        call<RevealCallableResult>(owner, "revealLockedGamePicks", {
          requestId: requestId("reveal-b"),
          leagueId: created.leagueId,
          weekId: week.weekId,
        }),
      ]);
      expect(
        concurrentReveals.reduce(
          (count, result) => count + result.revealedGameCount,
          0,
        ),
      ).toBe(1);
      const hydratedReveal = concurrentReveals.find(
        (result) => result.revealsByGame[gameId]?.length === 2,
      );
      expect(hydratedReveal).toBeDefined();
      expect(
        hydratedReveal?.revealsByGame[gameId]?.map(
          (reveal) => reveal.selectedTeamId,
        ),
      ).toEqual(expect.arrayContaining([homeTeamId, awayTeamId]));
      expect(hydratedReveal?.revealPage.returnedPickCount).toBeLessThanOrEqual(
        200,
      );
      const preservedReveal = await preexistingRevealReference.get();
      expect(preservedReveal.data()?.outcome).toBe("correct");
      expect(preservedReveal.data()?.points).toBe(1);
      expect(preservedReveal.data()?.outcomeVersion).toBe(
        "integration-home-result",
      );
      const newlyGradedReveal = await adminDb
        .doc(
          `leagues/${created.leagueId}/weeks/${week.weekId}/reveals/${gameId}/picks/${memberBUid}`,
        )
        .get();
      expect(newlyGradedReveal.data()?.outcome).toBe("incorrect");
      expect(newlyGradedReveal.data()?.points).toBe(0);

      const repeatedReveal = await call<RevealCallableResult>(
        owner,
        "revealLockedGamePicks",
        {
          requestId: requestId("reveal-repeat"),
          leagueId: created.leagueId,
          weekId: week.weekId,
        },
      );
      expect(repeatedReveal.revealedGameCount).toBe(0);
      expect(repeatedReveal.revealsByGame[gameId]).toHaveLength(2);

      const firstRevealPage = await call<RevealCallableResult>(
        owner,
        "revealLockedGamePicks",
        {
          requestId: requestId("reveal-page-one"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          revealPageSize: 1,
        },
      );
      expect(firstRevealPage.revealPage.truncated).toBe(true);
      expect(firstRevealPage.revealPage.returnedPickCount).toBe(1);
      expect(firstRevealPage.revealPage.nextCursor).not.toBeNull();
      const secondRevealPage = await call<RevealCallableResult>(
        owner,
        "revealLockedGamePicks",
        {
          requestId: requestId("reveal-page-two"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          revealPageSize: 1,
          revealCursor: firstRevealPage.revealPage.nextCursor,
        },
      );
      expect(secondRevealPage.revealPage.truncated).toBe(false);
      expect(secondRevealPage.revealPage.returnedPickCount).toBe(1);
      expect(
        [
          ...(firstRevealPage.revealsByGame[gameId] ?? []),
          ...(secondRevealPage.revealsByGame[gameId] ?? []),
        ].map((reveal) => reveal.uid),
      ).toEqual(expect.arrayContaining([memberAUid, memberBUid]));

      const scheduledReveal = await revealLockedPicks({
        leagueId: created.leagueId,
        weekId: week.weekId,
        actorUid: "system",
        requestId: requestId("scheduled-reveal"),
        skipAuthorization: true,
        includeRevealPayload: false,
      });
      expect(scheduledReveal.revealedGameCount).toBe(0);
      expect(scheduledReveal.revealsByGame).toEqual({});
      expect(scheduledReveal.revealPage.included).toBe(false);
      const revealedGame = await gameReference.get();
      expect(revealedGame.data()?.pickRevealCompletedAt).toBeInstanceOf(
        Timestamp,
      );
      expect(revealedGame.data()?.pickRevealClaimId).toBeUndefined();
      expect(revealedGame.data()?.pickRevealRequestId).toBeUndefined();
      await call(owner, "overrideGameResult", {
        requestId: requestId("overridehome"),
        leagueId: created.leagueId,
        weekId: week.weekId,
        gameId,
        status: "final",
        homeScore: 24,
        awayScore: 17,
        winnerTeamId: homeTeamId,
        reason: "Integration final result.",
      });
      await weekReference.update({
        resultMutationRequestId: "active-result-mutation",
        resultMutationStartedAt: Timestamp.now(),
        resultMutationHeartbeatAt: Timestamp.now(),
      });
      await expect(
        httpsCallable(getFunctions(owner, "us-central1"), "finalizeWeek")({
          requestId: requestId("finalize-during-results"),
          leagueId: created.leagueId,
          weekId: week.weekId,
        }),
      ).rejects.toThrow();
      const weekAfterBlockedFinalize = await weekReference.get();
      expect(
        weekAfterBlockedFinalize.data()?.finalizationRequestId,
      ).toBeUndefined();
      await weekReference.update({
        resultMutationRequestId: FieldValue.delete(),
        resultMutationStartedAt: FieldValue.delete(),
        resultMutationHeartbeatAt: FieldValue.delete(),
      });
      const finalized = await call<{
        winnerUids: string[];
        highScore: number;
        nextPickerUid: string;
      }>(owner, "finalizeWeek", {
        requestId: requestId("finalize"),
        leagueId: created.leagueId,
        weekId: week.weekId,
      });
      expect(finalized.winnerUids).toEqual([memberAUid]);
      expect(finalized.highScore).toBe(1);
      expect(finalized.nextPickerUid).toBe(memberAUid);
      await Promise.all([
        weekReference.update({
          finalizationFollowUpsCompletedAt: FieldValue.delete(),
          finalizationFollowUpsResultVersion: FieldValue.delete(),
          rotationAdvancedAt: FieldValue.delete(),
          nextPickerUid: FieldValue.delete(),
        }),
        adminDb.doc(`leagues/${created.leagueId}`).update({
          currentPickerUid: ownerUid,
          rotationAdvancedForWeekId: FieldValue.delete(),
        }),
        adminDb
          .doc(`leagues/${created.leagueId}/standings/${memberAUid}`)
          .update({totalPoints: 999}),
      ]);
      const repairedByNextWeek = await call<{
        weekId: string;
        pickerUid: string;
      }>(owner, "createNextWeek", {
          requestId: requestId("next-before-rotation-settles"),
          leagueId: created.leagueId,
          sequentialNumber: 2,
          label: "Integration Week 2",
          startAt: end.toISOString(),
          endAt: new Date(
            end.valueOf() + 7 * 24 * 60 * 60_000,
          ).toISOString(),
      });
      expect(repairedByNextWeek.pickerUid).toBe(memberAUid);
      await Promise.all([
        adminDb
          .doc(
            `leagues/${created.leagueId}/weeks/${repairedByNextWeek.weekId}`,
          )
          .delete(),
        adminDb.doc(`leagues/${created.leagueId}`).update({
          currentWeekId: week.weekId,
          currentPickerUid: memberAUid,
        }),
      ]);
      const duplicate = await call<{
        winnerUids: string[];
        highScore: number;
        nextPickerUid: string;
      }>(owner, "finalizeWeek", {
        requestId: requestId("duplicatefinalize"),
        leagueId: created.leagueId,
        weekId: week.weekId,
      });
      expect(duplicate).toEqual({
        winnerUids: finalized.winnerUids,
        highScore: finalized.highScore,
        nextPickerUid: finalized.nextPickerUid,
      });
      const [repairedStanding, repairedLeague, repairedWeek] =
        await Promise.all([
          adminDb
            .doc(`leagues/${created.leagueId}/standings/${memberAUid}`)
            .get(),
          adminDb.doc(`leagues/${created.leagueId}`).get(),
          weekReference.get(),
        ]);
      expect(repairedStanding.data()?.totalPoints).toBe(1);
      expect(repairedLeague.data()?.currentPickerUid).toBe(memberAUid);
      expect(repairedWeek.data()?.rotationAdvancedAt).toBeInstanceOf(
        Timestamp,
      );
      expect(
        repairedWeek.data()?.finalizationFollowUpsCompletedAt,
      ).toBeInstanceOf(Timestamp);
      await expect(
        httpsCallable(getFunctions(owner, "us-central1"), "createNextWeek")({
          requestId: requestId("next-picker-override"),
          leagueId: created.leagueId,
          sequentialNumber: 2,
          label: "Integration Week 2",
          startAt: end.toISOString(),
          endAt: new Date(
            end.valueOf() + 7 * 24 * 60 * 60_000,
          ).toISOString(),
          pickerUid: ownerUid,
        }),
      ).rejects.toThrow();

      await call(owner, "reopenWeek", {
        requestId: requestId("reopen"),
        leagueId: created.leagueId,
        weekId: week.weekId,
        reason: "Provider issued a result correction.",
      });
      await call(owner, "overrideGameResult", {
        requestId: requestId("overrideaway"),
        leagueId: created.leagueId,
        weekId: week.weekId,
        gameId,
        status: "final",
        homeScore: 17,
        awayScore: 24,
        winnerTeamId: awayTeamId,
        reason: "Corrected integration final result.",
      });
      const corrected = await call<{
        winnerUids: string[];
        nextPickerUid: string;
      }>(owner, "finalizeWeek", {
        requestId: requestId("refinalize"),
        leagueId: created.leagueId,
        weekId: week.weekId,
      });
      expect(corrected.winnerUids).toEqual([memberBUid]);
      expect(corrected.nextPickerUid).toBe(memberAUid);

      const [standingA, standingB, reveal] = await Promise.all([
        adminDb.doc(`leagues/${created.leagueId}/standings/${memberAUid}`).get(),
        adminDb.doc(`leagues/${created.leagueId}/standings/${memberBUid}`).get(),
        adminDb
          .doc(
            `leagues/${created.leagueId}/weeks/${week.weekId}/reveals/${gameId}/picks/${memberBUid}`,
          )
          .get(),
      ]);
      expect(standingA.data()?.totalPoints).toBe(0);
      expect(standingB.data()?.totalPoints).toBe(1);
      expect(reveal.data()?.outcome).toBe("correct");
      await deleteAdminApp(adminApp);
    },
    120_000,
  );

  it(
    "coordinates finalized follow-up repair with reopen without re-finalizing",
    async () => {
      const owner = await createSignedInApp("repair-reopen-owner");
      const member = await createSignedInApp("repair-reopen-member");
      const ownerUid = String(getAuth(owner).currentUser?.uid);
      const memberUid = String(getAuth(member).currentUser?.uid);
      const adminApp = initializeAdminApp(
        {projectId},
        "repair-reopen-admin",
      );
      const adminDb = getAdminFirestore(adminApp);
      const created = await call<{leagueId: string; inviteCode: string}>(
        owner,
        "createLeague",
        {
          requestId: requestId("repair-reopen-create"),
          name: "Repair Reopen Arena",
          timezone: "America/Chicago",
          settings: {providerName: "manual"},
        },
      );
      await call(member, "joinLeagueByCode", {
        requestId: requestId("repair-reopen-join"),
        inviteCode: created.inviteCode,
        nickname: "Repair Member",
      });
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() + 1);
      const end = new Date(start.valueOf() + 7 * 24 * 60 * 60_000);
      const week = await call<{weekId: string}>(owner, "createDraftWeek", {
        requestId: requestId("repair-reopen-week"),
        leagueId: created.leagueId,
        sequentialNumber: 1,
        label: "Repair Reopen Week",
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      });
      const weekReference = adminDb.doc(
        `leagues/${created.leagueId}/weeks/${week.weekId}`,
      );
      await weekReference.update({
        status: "finalized",
        finalizedAt: Timestamp.now(),
        finalizedBy: ownerUid,
        finalizedRequestId: "seeded-finalization",
        winnerUids: [],
        highScore: null,
        resultVersion: 1,
      });

      let signalRepairClaimed!: () => void;
      const repairClaimed = new Promise<void>((resolve) => {
        signalRepairClaimed = resolve;
      });
      let releaseRepair!: () => void;
      const repairReleased = new Promise<void>((resolve) => {
        releaseRepair = resolve;
      });
      const repairing = repairFinalizedWeekFollowUps(
        {
          leagueId: created.leagueId,
          weekId: week.weekId,
          actorUid: ownerUid,
          requestId: requestId("repair-reopen-followups"),
        },
        {
          afterClaim: async () => {
            signalRepairClaimed();
            await repairReleased;
          },
        },
      );
      await repairClaimed;
      await expect(
        reopenWeekRecord({
          leagueId: created.leagueId,
          weekId: week.weekId,
          actorUid: ownerUid,
          requestId: requestId("repair-reopen-blocked"),
          reason: "A correction must wait for the active repair.",
        }),
      ).rejects.toMatchObject({code: "aborted"});
      expect((await weekReference.get()).data()?.status).toBe("finalized");

      releaseRepair();
      await expect(repairing).resolves.toBeTruthy();
      await reopenWeekRecord({
        leagueId: created.leagueId,
        weekId: week.weekId,
        actorUid: ownerUid,
        requestId: requestId("repair-reopen-after-repair"),
        reason: "Apply a provider correction after repair settles.",
      });
      expect((await weekReference.get()).data()?.status).toBe("reopened");

      const expiredFinalizationRequestId =
        "expired-followup-repair-finalization";
      const expiredAuditQuery = adminDb
        .collection(`leagues/${created.leagueId}/auditLogs`)
        .where("requestId", "==", expiredFinalizationRequestId);
      expect((await expiredAuditQuery.get()).empty).toBe(true);
      await weekReference.update({
        status: "finalized",
        finalizedAt: Timestamp.now(),
        finalizedBy: ownerUid,
        finalizedRequestId: expiredFinalizationRequestId,
      });
      let signalExpiredRepairClaimed!: () => void;
      const expiredRepairClaimed = new Promise<void>((resolve) => {
        signalExpiredRepairClaimed = resolve;
      });
      let releaseExpiredRepair!: () => void;
      const expiredRepairReleased = new Promise<void>((resolve) => {
        releaseExpiredRepair = resolve;
      });
      const expiredRepair = repairFinalizedWeekFollowUps(
        {
          leagueId: created.leagueId,
          weekId: week.weekId,
          actorUid: ownerUid,
          requestId: requestId("repair-reopen-expired-followups"),
        },
        {
          afterClaim: async () => {
            signalExpiredRepairClaimed();
            await expiredRepairReleased;
          },
        },
      );
      await expiredRepairClaimed;
      const expiredClaimTimestamp = Timestamp.fromMillis(
        Date.now() - 6 * 60_000,
      );
      await weekReference.update({
        finalizationFollowUpsStartedAt: expiredClaimTimestamp,
        finalizationFollowUpsHeartbeatAt: expiredClaimTimestamp,
      });
      await reopenWeekRecord({
        leagueId: created.leagueId,
        weekId: week.weekId,
        actorUid: ownerUid,
        requestId: requestId("repair-reopen-expired-claim"),
        reason: "A stale repair claim must yield to this correction.",
      });
      expect((await expiredAuditQuery.get()).empty).toBe(true);
      releaseExpiredRepair();
      await expect(expiredRepair).rejects.toMatchObject({code: "aborted"});
      const afterExpiredRepair = await weekReference.get();
      expect(afterExpiredRepair.data()?.status).toBe("reopened");
      expect(
        afterExpiredRepair.data()?.finalizationFollowUpsRequestId,
      ).toBeUndefined();
      expect(
        afterExpiredRepair.data()?.finalizationFollowUpsClaimId,
      ).toBeUndefined();
      expect(
        afterExpiredRepair.data()?.finalizationFollowUpsStartedAt,
      ).toBeUndefined();
      expect(
        afterExpiredRepair.data()?.finalizationFollowUpsHeartbeatAt,
      ).toBeUndefined();
      expect((await expiredAuditQuery.get()).empty).toBe(true);

      await Promise.all([
        weekReference.update({
          status: "finalized",
          finalizedAt: Timestamp.now(),
          finalizedBy: ownerUid,
          finalizedRequestId: "expired-standings-repair-finalization",
        }),
        weekReference.collection("entries").doc(memberUid).set({
          uid: memberUid,
          eligible: true,
          points: 7,
          correctCount: 7,
          incorrectCount: 0,
          voidCount: 0,
          gradedCount: 7,
          isWeeklyWinner: true,
        }, {merge: true}),
      ]);
      let signalStandingsReady!: () => void;
      const standingsReady = new Promise<void>((resolve) => {
        signalStandingsReady = resolve;
      });
      let releaseStandingsRepair!: () => void;
      const standingsRepairReleased = new Promise<void>((resolve) => {
        releaseStandingsRepair = resolve;
      });
      const staleStandingsRepair = repairFinalizedWeekFollowUps(
        {
          leagueId: created.leagueId,
          weekId: week.weekId,
          actorUid: ownerUid,
          requestId: requestId("repair-reopen-stale-standings"),
        },
        {
          beforeStandingsCommit: async () => {
            signalStandingsReady();
            await standingsRepairReleased;
          },
        },
      );
      await standingsReady;
      await weekReference.update({
        finalizationFollowUpsStartedAt: expiredClaimTimestamp,
        finalizationFollowUpsHeartbeatAt: expiredClaimTimestamp,
      });
      await reopenWeekRecord({
        leagueId: created.leagueId,
        weekId: week.weekId,
        actorUid: ownerUid,
        requestId: requestId("repair-reopen-during-standings"),
        reason: "A stale standings repair must not overwrite this correction.",
      });
      const memberStandingReference = adminDb.doc(
        `leagues/${created.leagueId}/standings/${memberUid}`,
      );
      expect((await memberStandingReference.get()).data()).toMatchObject({
        totalPoints: 0,
        lastFinalizedWeekId: null,
      });
      releaseStandingsRepair();
      await expect(staleStandingsRepair).rejects.toMatchObject({
        code: "aborted",
      });
      expect((await memberStandingReference.get()).data()).toMatchObject({
        totalPoints: 0,
        lastFinalizedWeekId: null,
      });
      const afterStaleStandingsRepair = await weekReference.get();
      expect(afterStaleStandingsRepair.data()?.status).toBe("reopened");
      expect(
        afterStaleStandingsRepair.data()?.finalizationFollowUpsClaimId,
      ).toBeUndefined();

      await expect(
        httpsCallable(getFunctions(owner, "us-central1"), "createNextWeek")({
          requestId: requestId("repair-reopen-next"),
          leagueId: created.leagueId,
          sequentialNumber: 2,
          label: "Must Not Exist",
          startAt: end.toISOString(),
          endAt: new Date(
            end.valueOf() + 7 * 24 * 60 * 60_000,
          ).toISOString(),
        }),
      ).rejects.toThrow();
      expect((await weekReference.get()).data()?.status).toBe("reopened");
      await deleteAdminApp(adminApp);
    },
    120_000,
  );

  it(
    "reserves one standings generation across a legacy follow-up retry",
    async () => {
      const owner = await createSignedInApp("legacy-repair-generation-owner");
      const ownerUid = String(getAuth(owner).currentUser?.uid);
      const adminApp = initializeAdminApp(
        {projectId},
        "legacy-repair-generation-admin",
      );
      const adminDb = getAdminFirestore(adminApp);
      const created = await call<{leagueId: string}>(owner, "createLeague", {
        requestId: requestId("legacy-repair-generation-create"),
        name: "Legacy Repair Generation Arena",
        timezone: "America/Chicago",
        settings: {providerName: "manual"},
      });
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() + 1);
      const end = new Date(start.valueOf() + 7 * 24 * 60 * 60_000);
      const week = await call<{weekId: string}>(owner, "createDraftWeek", {
        requestId: requestId("legacy-repair-generation-week"),
        leagueId: created.leagueId,
        sequentialNumber: 1,
        label: "Legacy Repair Generation Week",
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      });
      const leagueReference = adminDb.doc(`leagues/${created.leagueId}`);
      const weekReference = leagueReference.collection("weeks").doc(week.weekId);
      const standingReference = leagueReference
        .collection("standings")
        .doc(ownerUid);
      await Promise.all([
        leagueReference.update({
          standingsEpoch: FieldValue.delete(),
          standingsBuiltEpoch: FieldValue.delete(),
          standingsBuiltMemberCount: FieldValue.delete(),
        }),
        weekReference.update({
          status: "finalized",
          finalizedAt: Timestamp.now(),
          finalizedBy: ownerUid,
          finalizedRequestId: "legacy-finalization-without-followups",
          winnerUids: [],
          highScore: null,
          resultVersion: 1,
        }),
        standingReference.set({
          uid: ownerUid,
          totalPoints: 99,
          currentRank: 1,
        }),
      ]);

      let firstClaimId: string | undefined;
      await expect(
        repairFinalizedWeekFollowUps(
          {
            leagueId: created.leagueId,
            weekId: week.weekId,
            actorUid: ownerUid,
            requestId: requestId("legacy-repair-generation-first"),
          },
          {
            afterClaim: async (claimId) => {
              firstClaimId = claimId;
              const [claimedLeague, claimedWeek] = await Promise.all([
                leagueReference.get(),
                weekReference.get(),
              ]);
              expect(claimedLeague.data()?.standingsEpoch).toBe(1);
              expect(claimedLeague.data()?.standingsBuiltEpoch).toBeUndefined();
              expect(
                claimedWeek.data()?.finalizationFollowUpsClaimId,
              ).toBe(claimId);
              throw new Error("Stop after reserving the legacy generation.");
            },
          },
        ),
      ).rejects.toThrow("Stop after reserving the legacy generation.");
      expect(firstClaimId).toBeTypeOf("string");
      const [afterFailureLeague, afterFailureWeek] = await Promise.all([
        leagueReference.get(),
        weekReference.get(),
      ]);
      expect(afterFailureLeague.data()?.standingsEpoch).toBe(1);
      expect(afterFailureLeague.data()?.standingsBuiltEpoch).toBeUndefined();
      expect(
        afterFailureWeek.data()?.finalizationFollowUpsClaimId,
      ).toBeUndefined();
      expect(
        afterFailureWeek.data()?.finalizationFollowUpsRequestId,
      ).toBeUndefined();
      expect(
        afterFailureWeek.data()?.finalizationFollowUpsStartedAt,
      ).toBeUndefined();
      expect(
        afterFailureWeek.data()?.finalizationFollowUpsHeartbeatAt,
      ).toBeUndefined();
      expect(
        afterFailureWeek.data()?.finalizationFollowUpsCompletedAt,
      ).toBeUndefined();

      let retryClaimEpoch: number | undefined;
      const repaired = await repairFinalizedWeekFollowUps(
        {
          leagueId: created.leagueId,
          weekId: week.weekId,
          actorUid: ownerUid,
          requestId: requestId("legacy-repair-generation-retry"),
        },
        {
          afterClaim: async () => {
            retryClaimEpoch = Number(
              (await leagueReference.get()).data()?.standingsEpoch,
            );
          },
        },
      );
      expect(retryClaimEpoch).toBe(1);
      expect(repaired.nextPickerUid).toBe(ownerUid);
      const [afterRetryLeague, afterRetryWeek, afterRetryStanding] =
        await Promise.all([
          leagueReference.get(),
          weekReference.get(),
          standingReference.get(),
        ]);
      expect(afterRetryLeague.data()).toMatchObject({
        standingsEpoch: 1,
        standingsBuiltEpoch: 1,
        standingsBuiltMemberCount: 1,
      });
      expect(afterRetryWeek.data()).toMatchObject({
        status: "finalized",
        finalizationFollowUpsResultVersion: 1,
      });
      expect(
        afterRetryWeek.data()?.finalizationFollowUpsCompletedAt,
      ).toBeInstanceOf(Timestamp);
      expect(
        afterRetryWeek.data()?.finalizationFollowUpsClaimId,
      ).toBeUndefined();
      expect(
        afterRetryWeek.data()?.finalizationFollowUpsRequestId,
      ).toBeUndefined();
      expect(
        afterRetryWeek.data()?.finalizationFollowUpsStartedAt,
      ).toBeUndefined();
      expect(
        afterRetryWeek.data()?.finalizationFollowUpsHeartbeatAt,
      ).toBeUndefined();
      expect(afterRetryStanding.data()).toMatchObject({
        uid: ownerUid,
        totalPoints: 0,
        standingsEpoch: 1,
      });
      await deleteAdminApp(adminApp);
    },
    120_000,
  );

  it(
    "restarts a cross-week standings rebuild after another week reopens",
    async () => {
      const owner = await createSignedInApp("standings-epoch-owner");
      const member = await createSignedInApp("standings-epoch-member");
      const ownerUid = String(getAuth(owner).currentUser?.uid);
      const memberUid = String(getAuth(member).currentUser?.uid);
      const adminApp = initializeAdminApp(
        {projectId},
        "standings-epoch-admin",
      );
      const adminDb = getAdminFirestore(adminApp);
      const created = await call<{leagueId: string; inviteCode: string}>(
        owner,
        "createLeague",
        {
          requestId: requestId("standings-epoch-create"),
          name: "Standings Epoch Arena",
          timezone: "America/Chicago",
          settings: {providerName: "manual"},
        },
      );
      await call(member, "joinLeagueByCode", {
        requestId: requestId("standings-epoch-join"),
        inviteCode: created.inviteCode,
        nickname: "Standings Epoch Member",
      });
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() + 1);
      const end = new Date(start.valueOf() + 7 * 24 * 60 * 60_000);
      const weekOne = await call<{weekId: string}>(
        owner,
        "createDraftWeek",
        {
          requestId: requestId("standings-epoch-week-one"),
          leagueId: created.leagueId,
          sequentialNumber: 1,
          label: "Standings Epoch Week 1",
          startAt: start.toISOString(),
          endAt: end.toISOString(),
        },
      );
      const leagueReference = adminDb.doc(`leagues/${created.leagueId}`);
      const weekOneReference = adminDb.doc(
        `leagues/${created.leagueId}/weeks/${weekOne.weekId}`,
      );
      await Promise.all([
        weekOneReference.update({
          status: "finalized",
          finalizedAt: Timestamp.fromMillis(Date.now() - 2 * 60_000),
          finalizedBy: ownerUid,
          finalizedRequestId: "standings-epoch-finalize-week-one",
          winnerUids: [memberUid],
          highScore: 11,
          resultVersion: 1,
          finalizationFollowUpsCompletedAt: Timestamp.now(),
          finalizationFollowUpsResultVersion: 1,
          rotationAdvancedAt: Timestamp.now(),
          nextPickerUid: memberUid,
        }),
        leagueReference.update({
          currentPickerUid: memberUid,
          rotationAdvancedForWeekId: weekOne.weekId,
        }),
        weekOneReference.collection("entries").doc(memberUid).set({
          uid: memberUid,
          eligible: true,
          points: 11,
          correctCount: 11,
          incorrectCount: 0,
          voidCount: 0,
          gradedCount: 11,
          isWeeklyWinner: true,
        }, {merge: true}),
      ]);
      const weekTwo = await call<{weekId: string; pickerUid: string}>(
        owner,
        "createNextWeek",
        {
          requestId: requestId("standings-epoch-week-two"),
          leagueId: created.leagueId,
          sequentialNumber: 2,
          label: "Standings Epoch Week 2",
          startAt: end.toISOString(),
          endAt: new Date(
            end.valueOf() + 7 * 24 * 60 * 60_000,
          ).toISOString(),
        },
      );
      expect(weekTwo.pickerUid).toBe(memberUid);
      const weekTwoReference = adminDb.doc(
        `leagues/${created.leagueId}/weeks/${weekTwo.weekId}`,
      );
      await Promise.all([
        weekTwoReference.update({
          status: "finalized",
          finalizedAt: Timestamp.fromMillis(Date.now() - 60_000),
          finalizedBy: ownerUid,
          finalizedRequestId: "standings-epoch-finalize-week-two",
          winnerUids: [memberUid],
          highScore: 7,
          resultVersion: 1,
        }),
        weekTwoReference.collection("entries").doc(memberUid).set({
          uid: memberUid,
          eligible: true,
          points: 7,
          correctCount: 7,
          incorrectCount: 0,
          voidCount: 0,
          gradedCount: 7,
          isWeeklyWinner: true,
        }, {merge: true}),
        leagueReference.update({
          standingsEpoch: 2,
          standingsBuiltEpoch: 2,
        }),
      ]);

      let standingsCommitAttemptCount = 0;
      let signalFirstStandingsCommit!: () => void;
      const firstStandingsCommit = new Promise<void>((resolve) => {
        signalFirstStandingsCommit = resolve;
      });
      let releaseFirstStandingsCommit!: () => void;
      const firstStandingsCommitReleased = new Promise<void>((resolve) => {
        releaseFirstStandingsCommit = resolve;
      });
      const repairingWeekTwo = repairFinalizedWeekFollowUps(
        {
          leagueId: created.leagueId,
          weekId: weekTwo.weekId,
          actorUid: ownerUid,
          requestId: requestId("standings-epoch-repair-week-two"),
        },
        {
          beforeStandingsCommit: async () => {
            standingsCommitAttemptCount += 1;
            if (standingsCommitAttemptCount === 1) {
              signalFirstStandingsCommit();
              await firstStandingsCommitReleased;
            }
          },
        },
      );
      await firstStandingsCommit;

      let reopenFailure: unknown;
      let standingAfterReopen: DocumentData | undefined;
      let leagueAfterReopen: DocumentData | undefined;
      try {
        await reopenWeekRecord({
          leagueId: created.leagueId,
          weekId: weekOne.weekId,
          actorUid: ownerUid,
          requestId: requestId("standings-epoch-reopen-week-one"),
          reason: "Correct Week 1 while Week 2 standings are rebuilding.",
        });
        [standingAfterReopen, leagueAfterReopen] = await Promise.all([
          leagueReference
            .collection("standings")
            .doc(memberUid)
            .get()
            .then((snapshot) => snapshot.data()),
          leagueReference.get().then((snapshot) => snapshot.data()),
        ]);
      } catch (error: unknown) {
        reopenFailure = error;
      } finally {
        releaseFirstStandingsCommit();
      }
      const repairedWeekTwo = await repairingWeekTwo;
      expect(reopenFailure).toBeUndefined();
      expect(standingAfterReopen).toMatchObject({
        totalPoints: 7,
        totalCorrect: 7,
        eligibleWeeks: 1,
        lastFinalizedWeekId: weekTwo.weekId,
        standingsEpoch: 4,
      });
      expect(leagueAfterReopen).toMatchObject({
        standingsEpoch: 4,
        standingsBuiltEpoch: 4,
        standingsBuiltMemberCount: 2,
      });
      expect(standingsCommitAttemptCount).toBe(2);
      expect(repairedWeekTwo.nextPickerUid).toBe(ownerUid);

      const [finalLeague, finalStanding, finalWeekOne, finalWeekTwo] =
        await Promise.all([
          leagueReference.get(),
          leagueReference.collection("standings").doc(memberUid).get(),
          weekOneReference.get(),
          weekTwoReference.get(),
        ]);
      expect(finalLeague.data()?.standingsBuiltEpoch).toBe(
        finalLeague.data()?.standingsEpoch,
      );
      expect(finalLeague.data()).toMatchObject({
        standingsEpoch: 4,
        standingsBuiltEpoch: 4,
        standingsBuiltMemberCount: 2,
      });
      expect(finalStanding.data()).toMatchObject({
        totalPoints: 7,
        totalCorrect: 7,
        totalGraded: 7,
        eligibleWeeks: 1,
        weeklyTitles: 1,
        lastFinalizedWeekId: weekTwo.weekId,
        standingsEpoch: 4,
      });
      expect(finalWeekOne.data()?.status).toBe("reopened");
      expect(finalWeekTwo.data()).toMatchObject({
        status: "finalized",
        finalizationFollowUpsResultVersion: 1,
        nextPickerUid: ownerUid,
      });
      expect(
        finalWeekTwo.data()?.finalizationFollowUpsCompletedAt,
      ).toBeInstanceOf(Timestamp);
      expect(
        finalWeekTwo.data()?.finalizationFollowUpsClaimId,
      ).toBeUndefined();
      await deleteAdminApp(adminApp);
    },
    120_000,
  );

  it(
    "advances an inactive finalized next picker before creating the next week",
    async () => {
      const owner = await createSignedInApp("inactive-picker-owner");
      const memberA = await createSignedInApp("inactive-picker-member-a");
      const memberB = await createSignedInApp("inactive-picker-member-b");
      const ownerUid = String(getAuth(owner).currentUser?.uid);
      const memberAUid = String(getAuth(memberA).currentUser?.uid);
      const memberBUid = String(getAuth(memberB).currentUser?.uid);
      const adminApp = initializeAdminApp(
        {projectId},
        "inactive-picker-admin",
      );
      const adminDb = getAdminFirestore(adminApp);
      const created = await call<{leagueId: string; inviteCode: string}>(
        owner,
        "createLeague",
        {
          requestId: requestId("inactive-picker-create"),
          name: "Inactive Picker Arena",
          timezone: "America/Chicago",
          settings: {providerName: "manual"},
        },
      );
      await call(memberA, "joinLeagueByCode", {
        requestId: requestId("inactive-picker-join-a"),
        inviteCode: created.inviteCode,
        nickname: "Inactive Member A",
      });
      await call(memberB, "joinLeagueByCode", {
        requestId: requestId("inactive-picker-join-b"),
        inviteCode: created.inviteCode,
        nickname: "Active Member B",
      });
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() + 1);
      const end = new Date(start.valueOf() + 7 * 24 * 60 * 60_000);
      const week = await call<{weekId: string}>(owner, "createDraftWeek", {
        requestId: requestId("inactive-picker-week"),
        leagueId: created.leagueId,
        sequentialNumber: 1,
        label: "Inactive Picker Week",
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      });
      const leagueReference = adminDb.doc(`leagues/${created.leagueId}`);
      const weekReference = adminDb.doc(
        `leagues/${created.leagueId}/weeks/${week.weekId}`,
      );
      await Promise.all([
        weekReference.update({
          status: "finalized",
          finalizedAt: Timestamp.now(),
          finalizedBy: ownerUid,
          finalizedRequestId: "seeded-inactive-picker-finalization",
          winnerUids: [],
          highScore: null,
          resultVersion: 1,
          finalizationFollowUpsCompletedAt: Timestamp.now(),
          finalizationFollowUpsResultVersion: 1,
          rotationAdvancedAt: Timestamp.now(),
          nextPickerUid: memberAUid,
        }),
        leagueReference.update({
          currentPickerUid: memberAUid,
          rotationAdvancedForWeekId: week.weekId,
        }),
      ]);
      await call(memberA, "leaveLeague", {
        requestId: requestId("inactive-picker-leave"),
        leagueId: created.leagueId,
      });

      const nextWeek = await call<{weekId: string; pickerUid: string}>(
        owner,
        "createNextWeek",
        {
          requestId: requestId("inactive-picker-next"),
          leagueId: created.leagueId,
          sequentialNumber: 2,
          label: "Recovered Rotation Week",
          startAt: end.toISOString(),
          endAt: new Date(
            end.valueOf() + 7 * 24 * 60 * 60_000,
          ).toISOString(),
        },
      );
      expect(nextWeek.pickerUid).toBe(memberBUid);
      const [leagueAfter, finalizedWeekAfter, nextWeekAfter] =
        await Promise.all([
          leagueReference.get(),
          weekReference.get(),
          adminDb
            .doc(`leagues/${created.leagueId}/weeks/${nextWeek.weekId}`)
            .get(),
        ]);
      expect(leagueAfter.data()).toMatchObject({
        currentWeekId: nextWeek.weekId,
        currentPickerUid: memberBUid,
        rotationAdvancedForWeekId: week.weekId,
      });
      expect(finalizedWeekAfter.data()).toMatchObject({
        status: "finalized",
        pickerUid: ownerUid,
        nextPickerUid: memberBUid,
      });
      expect(nextWeekAfter.data()).toMatchObject({
        status: "draft",
        pickerUid: memberBUid,
      });

      await call(memberB, "leaveLeague", {
        requestId: requestId("historical-picker-leave"),
        leagueId: created.leagueId,
      });
      const historicalRepair = await repairFinalizedWeekFollowUps({
        leagueId: created.leagueId,
        weekId: week.weekId,
        actorUid: ownerUid,
        requestId: requestId("historical-picker-repair"),
      });
      expect(historicalRepair.nextPickerUid).toBe(memberBUid);
      const [leagueAfterHistoricalRepair, weekAfterHistoricalRepair] =
        await Promise.all([leagueReference.get(), weekReference.get()]);
      expect(leagueAfterHistoricalRepair.data()).toMatchObject({
        currentWeekId: nextWeek.weekId,
        currentPickerUid: memberBUid,
      });
      expect(weekAfterHistoricalRepair.data()).toMatchObject({
        nextPickerUid: memberBUid,
      });
      await deleteAdminApp(adminApp);
    },
    120_000,
  );

  it(
    "returns stored publish counts when a stale publisher observes its takeover",
    async () => {
      const owner = await createSignedInApp("publish-settlement-owner");
      const member = await createSignedInApp("publish-settlement-member");
      const ownerUid = String(getAuth(owner).currentUser?.uid);
      const memberUid = String(getAuth(member).currentUser?.uid);
      const adminApp = initializeAdminApp(
        {projectId},
        "publish-settlement-admin",
      );
      const adminDb = getAdminFirestore(adminApp);
      const created = await call<{leagueId: string; inviteCode: string}>(
        owner,
        "createLeague",
        {
          requestId: requestId("publish-settlement-create"),
          name: "Publish Settlement Arena",
          timezone: "America/Chicago",
          settings: {
            providerName: "manual",
            pickerParticipatesInPicks: true,
          },
        },
      );
      await call(member, "joinLeagueByCode", {
        requestId: requestId("publish-settlement-join"),
        inviteCode: created.inviteCode,
        nickname: "Settlement Member",
      });
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() + 1);
      const end = new Date(start.valueOf() + 7 * 24 * 60 * 60_000);
      const week = await call<{weekId: string}>(owner, "createDraftWeek", {
        requestId: requestId("publish-settlement-week"),
        leagueId: created.leagueId,
        sequentialNumber: 1,
        label: "Publish Settlement Week",
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      });
      const firstGame = await call<{gameId: string}>(
        owner,
        "createManualGame",
        {
          requestId: requestId("publish-settlement-game-a"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          sportCode: "baseball",
          leagueCode: "mlb",
          leagueName: "MLB",
          season: String(start.getUTCFullYear()),
          scheduledAtUtc: new Date(
            start.valueOf() + 12 * 60 * 60_000,
          ).toISOString(),
          venueName: "Settlement Park A",
          neutralSite: false,
          awayTeam: {
            id: "settlement-away-a",
            name: "Settlement Away A",
            shortName: "Away A",
            abbreviation: "AWA",
          },
          homeTeam: {
            id: "settlement-home-a",
            name: "Settlement Home A",
            shortName: "Home A",
            abbreviation: "HMA",
          },
        },
      );
      const secondGame = await call<{gameId: string}>(
        owner,
        "createManualGame",
        {
          requestId: requestId("publish-settlement-game-b"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          sportCode: "baseball",
          leagueCode: "mlb",
          leagueName: "MLB",
          season: String(start.getUTCFullYear()),
          scheduledAtUtc: new Date(
            start.valueOf() + 24 * 60 * 60_000,
          ).toISOString(),
          venueName: "Settlement Park B",
          neutralSite: false,
          awayTeam: {
            id: "settlement-away-b",
            name: "Settlement Away B",
            shortName: "Away B",
            abbreviation: "AWB",
          },
          homeTeam: {
            id: "settlement-home-b",
            name: "Settlement Home B",
            shortName: "Home B",
            abbreviation: "HMB",
          },
        },
      );
      expect(firstGame.gameId).not.toBe(secondGame.gameId);
      const publishRequestId = requestId("publish-settlement");
      let signalBeforeSettlement!: () => void;
      const beforeSettlement = new Promise<void>((resolve) => {
        signalBeforeSettlement = resolve;
      });
      let releaseStalePublisher!: () => void;
      const stalePublisherReleased = new Promise<void>((resolve) => {
        releaseStalePublisher = resolve;
      });
      let staleClaimId: string | undefined;
      const stalePublisher = publishSlate(
        {
          requestId: publishRequestId,
          leagueId: created.leagueId,
          weekId: week.weekId,
          actorUid: ownerUid,
        },
        {
          beforeSettlement: async (claimId) => {
            staleClaimId = claimId;
            signalBeforeSettlement();
            await stalePublisherReleased;
          },
        },
      );
      await beforeSettlement;
      expect(staleClaimId).toEqual(expect.any(String));
      const weekReference = adminDb.doc(
        `leagues/${created.leagueId}/weeks/${week.weekId}`,
      );
      const [staleWeekBeforeTakeover, staleGames, staleEntries] =
        await Promise.all([
          weekReference.get(),
          weekReference.collection("games").get(),
          weekReference.collection("entries").get(),
        ]);
      expect(staleWeekBeforeTakeover.data()).toMatchObject({
        status: "draft",
        publishClaimId: staleClaimId,
      });
      expect(staleGames.size).toBe(2);
      expect(staleEntries.size).toBe(2);
      expect(
        staleEntries.docs.every(
          (entry) => entry.data().totalRequiredPickCount === 2,
        ),
      ).toBe(true);
      const staleTimestamp = Timestamp.fromMillis(Date.now() - 6 * 60_000);
      await Promise.all([
        adminDb
          .doc(`leagues/${created.leagueId}/members/${memberUid}`)
          .update({status: "inactive"}),
        adminDb
          .doc(
            `leagues/${created.leagueId}/weeks/${week.weekId}/games/${secondGame.gameId}`,
          )
          .delete(),
        weekReference.update({
          publishStartedAt: staleTimestamp,
          publishHeartbeatAt: staleTimestamp,
        }),
      ]);

      let takeoverResult:
        | {
          published: boolean;
          selectedGameCount: number;
          eligibleMemberCount: number;
        }
        | undefined;
      let takeoverFailure: unknown;
      try {
        takeoverResult = await publishSlate({
          requestId: publishRequestId,
          leagueId: created.leagueId,
          weekId: week.weekId,
          actorUid: ownerUid,
        });
      } catch (error: unknown) {
        takeoverFailure = error;
      } finally {
        releaseStalePublisher();
      }
      const staleResult = await stalePublisher;
      if (takeoverFailure !== undefined) {
        throw takeoverFailure instanceof Error
          ? takeoverFailure
          : new Error("Takeover publish failed with a non-Error value.", {
            cause: takeoverFailure,
          });
      }
      expect(takeoverResult).toEqual({
        published: true,
        selectedGameCount: 1,
        eligibleMemberCount: 1,
      });
      expect(staleResult).toEqual(takeoverResult);
      expect((await weekReference.get()).data()).toMatchObject({
        status: "open",
        publishedRequestId: publishRequestId,
        selectedGameCount: 1,
        eligibleMemberCount: 1,
      });
      await deleteAdminApp(adminApp);
    },
    120_000,
  );

  it(
    "keeps entry completion monotonic across concurrent game submissions",
    async () => {
      const owner = await createSignedInApp("concurrent-submit-owner");
      const member = await createSignedInApp("concurrent-submit-member");
      const memberUid = getAuth(member).currentUser?.uid;
      expect(memberUid).toBeTruthy();
      const adminApp = initializeAdminApp(
        {projectId},
        "concurrent-submit-admin",
      );
      const adminDb = getAdminFirestore(adminApp);

      const created = await call<{leagueId: string; inviteCode: string}>(
        owner,
        "createLeague",
        {
          requestId: requestId("concurrent-create"),
          name: "Concurrent Entry Arena",
          timezone: "America/Chicago",
          settings: {providerName: "mock"},
        },
      );
      await call(member, "joinLeagueByCode", {
        requestId: requestId("concurrent-join"),
        inviteCode: created.inviteCode,
        nickname: "Concurrent Member",
      });
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() + 1);
      const end = new Date(start.valueOf() + 7 * 24 * 60 * 60_000);
      const week = await call<{weekId: string}>(owner, "createDraftWeek", {
        requestId: requestId("concurrent-week"),
        leagueId: created.leagueId,
        sequentialNumber: 1,
        label: "Concurrent Week",
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      });
      const day = start.toISOString().slice(0, 10);
      const catalog = await call<{
        games: Array<Record<string, unknown>>;
      }>(owner, "listSportsCatalog", {
        requestId: requestId("concurrent-catalog"),
        leagueId: created.leagueId,
        weekId: week.weekId,
        sportCode: "football",
        leagueCode: "demo-football",
        leagueIdForProvider: "demo-football",
        season: "demo",
        from: day,
        to: day,
        timezone: "America/Chicago",
        forceRefresh: false,
      });
      const selectedGames = catalog.games.slice(0, 2);
      expect(selectedGames).toHaveLength(2);
      await call(owner, "saveDraftSlate", {
        requestId: requestId("concurrent-save"),
        leagueId: created.leagueId,
        weekId: week.weekId,
        chunkKey: requestId("concurrent-chunk"),
        games: selectedGames,
        removeGameIds: [],
      });
      await call(owner, "publishWeeklySlate", {
        requestId: requestId("concurrent-publish"),
        leagueId: created.leagueId,
        weekId: week.weekId,
      });

      const firstGame = selectedGames[0] as {
        id: string;
        homeTeam: {id: string};
      };
      const secondGame = selectedGames[1] as {
        id: string;
        awayTeam: {id: string};
      };
      await Promise.all([
        call(member, "submitOrConfirmEntry", {
          requestId: requestId("concurrent-pick-a"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          picks: [
            {
              gameId: firstGame.id,
              selectedTeamId: firstGame.homeTeam.id,
            },
          ],
        }),
        call(member, "submitOrConfirmEntry", {
          requestId: requestId("concurrent-pick-b"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          picks: [
            {
              gameId: secondGame.id,
              selectedTeamId: secondGame.awayTeam.id,
            },
          ],
        }),
      ]);

      const entryReference = adminDb.doc(
        `leagues/${created.leagueId}/weeks/${week.weekId}/entries/${memberUid}`,
      );
      const [entry, picks] = await Promise.all([
        entryReference.get(),
        entryReference.collection("picks").get(),
      ]);
      expect(picks.size).toBe(2);
      expect(entry.data()).toMatchObject({
        savedPickCount: 2,
        totalRequiredPickCount: 2,
        completionState: "complete",
      });
      expect(entry.data()?.submittedAt).toBeInstanceOf(Timestamp);

      await Promise.all([
        call(member, "submitOrConfirmEntry", {
          requestId: requestId("duplicate-pick-a"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          picks: [
            {
              gameId: firstGame.id,
              selectedTeamId: firstGame.homeTeam.id,
            },
          ],
        }),
        call(member, "submitOrConfirmEntry", {
          requestId: requestId("duplicate-pick-b"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          picks: [
            {
              gameId: firstGame.id,
              selectedTeamId: firstGame.homeTeam.id,
            },
          ],
        }),
      ]);
      const afterDuplicates = await entryReference.get();
      expect(afterDuplicates.data()).toMatchObject({
        savedPickCount: 2,
        totalRequiredPickCount: 2,
        completionState: "complete",
      });
      await deleteAdminApp(adminApp);
    },
    120_000,
  );

  it(
    "publishes a fresh cached CBS game and exposes it to an ordinary member",
    async () => {
      const owner = await createSignedInApp("cbs-cache-lifecycle-owner");
      const member = await createSignedInApp("cbs-cache-lifecycle-member");
      const memberUid = String(getAuth(member).currentUser?.uid);
      const adminApp = initializeAdminApp(
        {projectId},
        "cbs-cache-lifecycle-admin",
      );
      const adminDb = getAdminFirestore(adminApp);
      const configurationReference = adminDb.doc(
        "systemConfig/cbsCollegeFootball",
      );
      const usageReference = adminDb.doc(
        "providerUsage/cbsSports_rolling24h",
      );
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() + 1);
      const end = new Date(start.valueOf() + 7 * 24 * 60 * 60_000);
      const scheduledAt = new Date(start.valueOf() + 36 * 60 * 60_000);
      const season = start.getUTCFullYear();
      const identity = {
        season,
        seasonType: "regular" as const,
        week: 1,
        division: "FBS" as const,
      };
      const cacheReference = adminDb.doc(
        `sportsProviderCache/${cbsCollegeFootballCacheDocumentId(identity)}`,
      );
      const [previousConfiguration, previousCache, usageBefore] =
        await Promise.all([
          configurationReference.get(),
          cacheReference.get(),
          usageReference.get(),
        ]);

      try {
        await configurationReference.set({
          enabled: true,
          autoRefreshEnabled: false,
          activeSeason: season,
          activeSeasonType: identity.seasonType,
          activeWeek: identity.week,
          division: identity.division,
          minimumRefreshMinutes: 120,
          defaultRefreshMinutes: 180,
          maximumRefreshMinutes: 240,
          parserVersion: CBS_COLLEGE_FOOTBALL_PARSER_VERSION,
          globalDailyRequestLimit: 12,
        });
        const created = await call<{leagueId: string; inviteCode: string}>(
          owner,
          "createLeague",
          {
            requestId: requestId("cbs-cache-create"),
            name: "CBS Cached Schedule Arena",
            timezone: "America/Chicago",
            settings: {
              providerName: "manual",
              providerBySport: {NCAAF: "cbsSports"},
              enabledSports: ["NCAAF"],
              enabledLeagues: ["ncaaf"],
            },
          },
        );
        await call(member, "joinLeagueByCode", {
          requestId: requestId("cbs-cache-join"),
          inviteCode: created.inviteCode,
          nickname: "CBS Member",
        });
        const week = await call<{weekId: string}>(owner, "createDraftWeek", {
          requestId: requestId("cbs-cache-week"),
          leagueId: created.leagueId,
          sequentialNumber: 1,
          label: "CBS Cache Week",
          startAt: start.toISOString(),
          endAt: end.toISOString(),
        });

        const providerGameId =
          `emulator-${created.leagueId.slice(-24)}`;
        const game = normalizedGameSchema.parse({
          id: `cbsSports:NCAAF:${providerGameId}`,
          provider: "cbsSports",
          providerGameId,
          providerScoreId: null,
          providerLeagueGameId: providerGameId,
          providerGlobalGameId: null,
          providerGameKey: providerGameId,
          providerLeagueId: "FBS",
          sportCode: "NCAAF",
          leagueCode: "ncaaf",
          leagueName: "NCAA Football",
          season: String(season),
          seasonType: identity.seasonType,
          weekOrRound: String(identity.week),
          scheduledAtUtc: scheduledAt,
          publishedScheduledAtUtc: scheduledAt,
          effectiveLockAtUtc: scheduledAt,
          scheduledDayEastern: calendarDateInTimezone(
            scheduledAt,
            "America/New_York",
          ),
          timeTbd: false,
          venueName: "Cached Test Stadium",
          venueCity: "Chicago",
          venueState: "IL",
          venueCountry: "US",
          neutralSite: false,
          homeTeam: {
            id: "cbsSports:ncaaf:cached-home",
            name: "Cached Home",
            shortName: "Home",
            abbreviation: "HME",
            logoUrl: null,
            color: null,
            providerTeamId: "cached-home",
            providerGlobalTeamId: null,
          },
          awayTeam: {
            id: "cbsSports:ncaaf:cached-away",
            name: "Cached Away",
            shortName: "Away",
            abbreviation: "AWY",
            logoUrl: null,
            color: null,
            providerTeamId: "cached-away",
            providerGlobalTeamId: null,
          },
          status: "scheduled",
          statusDetail: "Scheduled",
          isClosed: null,
          rescheduledFromLeagueGameId: null,
          rescheduledToLeagueGameId: null,
          homeScore: null,
          awayScore: null,
          winnerTeamId: null,
          broadcast: "CBS",
          eventDetail: null,
          sourceGameUrl: null,
          kickoffDisplayText: "12:00 PM ET",
          dateHeading: calendarDateInTimezone(
            scheduledAt,
            "America/New_York",
          ),
          rawResponseVersion: 1,
          providerLastUpdatedAt: new Date(),
          lastSyncedAt: new Date(),
          manualOverride: false,
          manualOverrideReason: null,
          manualOverrideBy: null,
          resultVersion: "cbs-emulator-result-v1",
          sourcePayloadHash: "c".repeat(64),
        });
        const cachedAt = new Date();
        const nextRefreshAt = new Date(
          cachedAt.valueOf() + 12 * 60 * 60_000,
        );
        await cacheReference.set({
          source: "cbsSports",
          sourceUrl: buildCbsCollegeFootballScoreboardUrl(identity).toString(),
          sport: "NCAAF",
          division: identity.division,
          season: identity.season,
          seasonType: identity.seasonType,
          week: identity.week,
          games: [{
            ...game,
            scheduledAtUtc: game.scheduledAtUtc?.toISOString() ?? null,
            publishedScheduledAtUtc:
              game.publishedScheduledAtUtc?.toISOString() ?? null,
            effectiveLockAtUtc:
              game.effectiveLockAtUtc?.toISOString() ?? null,
            providerLastUpdatedAt:
              game.providerLastUpdatedAt.toISOString(),
            lastSyncedAt: game.lastSyncedAt.toISOString(),
          }],
          etag: '"cbs-emulator-cache"',
          lastModified: "Wed, 28 Aug 2030 10:00:00 GMT",
          contentHash: cbsCollegeFootballGamesContentHash([game]),
          cachedAt: Timestamp.fromDate(cachedAt),
          lastAttemptAt: Timestamp.fromDate(cachedAt),
          lastSuccessfulFetchAt: Timestamp.fromDate(cachedAt),
          nextRefreshAt: Timestamp.fromDate(nextRefreshAt),
          hardExpiresAt: Timestamp.fromMillis(
            nextRefreshAt.valueOf() + 24 * 60 * 60_000,
          ),
          refreshState: "idle",
          refreshLeaseOwner: null,
          refreshLeaseUntil: null,
          lastHttpStatus: 200,
          consecutiveFailures: 0,
          lastErrorCode: null,
          lastErrorAt: null,
          circuitOpenUntil: null,
          parserVersion: CBS_COLLEGE_FOOTBALL_PARSER_VERSION,
        });

        const queryDay = calendarDateInTimezone(
          scheduledAt,
          "America/Chicago",
        );
        const catalog = await call<{
          provider: string;
          games: Array<Record<string, unknown>>;
          cache: {hit: boolean; stale: boolean; delayed: boolean};
        }>(owner, "listSportsCatalog", {
          requestId: requestId("cbs-cache-catalog"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          sportCode: "NCAAF",
          leagueCode: "ncaaf",
          leagueIdForProvider: "FBS",
          season: String(season),
          seasonType: identity.seasonType,
          week: identity.week,
          division: identity.division,
          from: queryDay,
          to: queryDay,
          timezone: "America/Chicago",
          dateMode: "custom",
          forceRefresh: false,
        });
        expect(catalog).toMatchObject({
          provider: "cbsSports",
          cache: {hit: true, stale: false, delayed: false},
        });
        expect(catalog.games).toHaveLength(1);
        expect(catalog.games[0]).toMatchObject({
          id: game.id,
          provider: "cbsSports",
          providerGameId,
          selectable: true,
        });
        const [cacheAfterCatalog, usageAfter] = await Promise.all([
          cacheReference.get(),
          usageReference.get(),
        ]);
        const cacheLastAttemptAt = cacheAfterCatalog.get(
          "lastAttemptAt",
        ) as Timestamp;
        expect(cacheLastAttemptAt.toMillis()).toBe(
          cachedAt.valueOf(),
        );
        expect(usageAfter.exists).toBe(usageBefore.exists);
        expect(usageAfter.data()).toEqual(usageBefore.data());

        const directScheduleInput = {
          requestId: requestId("cbs-cache-direct"),
          leagueId: created.leagueId,
          season,
          seasonType: identity.seasonType,
          week: identity.week,
          division: identity.division,
        };
        await expect(
          httpsCallable(
            getFunctions(member, "us-central1"),
            "getCollegeFootballSchedule",
          )(directScheduleInput),
        ).rejects.toThrow();
        const directSchedule = await call<{
          source: string;
          games: Array<Record<string, unknown>>;
          cache: {status: string};
        }>(owner, "getCollegeFootballSchedule", {
          ...directScheduleInput,
          requestId: requestId("cbs-cache-direct-owner"),
        });
        expect(directSchedule).toMatchObject({
          source: "cbsSports",
          cache: {status: "fresh"},
        });
        expect(directSchedule.games).toHaveLength(1);
        expect((await usageReference.get()).data()).toEqual(
          usageBefore.data(),
        );

        const selectedGame = catalog.games[0];
        if (selectedGame === undefined) {
          throw new Error("The cached CBS catalog game was unavailable.");
        }
        await call(owner, "saveDraftSlate", {
          requestId: requestId("cbs-cache-save"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          chunkKey: requestId("cbs-cache-chunk"),
          games: [selectedGame],
          removeGameIds: [],
        });
        const published = await call<{
          published: boolean;
          selectedGameCount: number;
          eligibleMemberCount: number;
        }>(owner, "publishWeeklySlate", {
          requestId: requestId("cbs-cache-publish"),
          leagueId: created.leagueId,
          weekId: week.weekId,
        });
        expect(published).toEqual({
          published: true,
          selectedGameCount: 1,
          eligibleMemberCount: 1,
        });

        const gamePath =
          `leagues/${created.leagueId}/weeks/${week.weekId}/games/${game.id}`;
        const memberGame = await getDoc(doc(getFirestore(member), gamePath));
        expect(memberGame.data()).toMatchObject({
          provider: "cbsSports",
          providerGameId,
          homeTeam: {name: "Cached Home"},
          awayTeam: {name: "Cached Away"},
        });
        await call(member, "submitOrConfirmEntry", {
          requestId: requestId("cbs-cache-pick"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          picks: [{gameId: game.id, selectedTeamId: game.awayTeam.id}],
        });
        const entry = await adminDb
          .doc(
            `leagues/${created.leagueId}/weeks/${week.weekId}/entries/${memberUid}`,
          )
          .get();
        const pick = await entry.ref.collection("picks").doc(game.id).get();
        expect(entry.data()).toMatchObject({
          savedPickCount: 1,
          totalRequiredPickCount: 1,
          completionState: "complete",
        });
        expect(pick.data()).toMatchObject({
          gameId: game.id,
          selectedTeamId: game.awayTeam.id,
          outcome: "pending",
        });
        const publishedWeek = await adminDb
          .doc(`leagues/${created.leagueId}/weeks/${week.weekId}`)
          .get();
        expect(publishedWeek.data()).toMatchObject({
          status: "open",
          catalogProviderSnapshot: "cbsSports",
          catalogPresentationSnapshot: {
            provider: "cbsSports",
            allowRemoteLogos: true,
          },
        });
      } finally {
        await Promise.all([
          previousConfiguration.exists
            ? configurationReference.set(previousConfiguration.data() ?? {})
            : configurationReference.delete(),
          previousCache.exists
            ? cacheReference.set(previousCache.data() ?? {})
            : cacheReference.delete(),
          usageBefore.exists
            ? usageReference.set(usageBefore.data() ?? {})
            : usageReference.delete(),
        ]);
        await deleteAdminApp(adminApp);
      }
    },
    120_000,
  );

  it(
    "tightens every first-game lock after an earlier manual reschedule",
    async () => {
      const owner = await createSignedInApp("first-game-reschedule-owner");
      const ownerUid = String(getAuth(owner).currentUser?.uid);
      const adminApp = initializeAdminApp(
        {projectId},
        "first-game-reschedule-admin",
      );
      const adminDb = getAdminFirestore(adminApp);
      const created = await call<{leagueId: string}>(owner, "createLeague", {
        requestId: requestId("first-game-create"),
        name: "First Game Lock Arena",
        timezone: "America/Chicago",
        settings: {
          providerName: "manual",
          pickerParticipatesInPicks: true,
          pickLockPolicy: "firstGame",
        },
      });
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() + 1);
      const end = new Date(start.valueOf() + 7 * 24 * 60 * 60_000);
      const week = await call<{weekId: string}>(owner, "createDraftWeek", {
        requestId: requestId("first-game-week"),
        leagueId: created.leagueId,
        sequentialNumber: 1,
        label: "First Game Lock Week",
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      });
      const createGame = async (input: {
        label: string;
        scheduledAtUtc: Date;
      }) =>
        call<{gameId: string}>(owner, "createManualGame", {
          requestId: requestId(`first-game-${input.label}`),
          leagueId: created.leagueId,
          weekId: week.weekId,
          sportCode: "football",
          leagueCode: "nfl",
          leagueName: "NFL",
          season: String(start.getUTCFullYear()),
          scheduledAtUtc: input.scheduledAtUtc.toISOString(),
          venueName: `First Game Field ${input.label}`,
          neutralSite: false,
          awayTeam: {
            id: `first-away-${input.label}`,
            name: `Away ${input.label}`,
            shortName: `Away ${input.label}`,
            abbreviation: `A${input.label.toUpperCase()}`,
          },
          homeTeam: {
            id: `first-home-${input.label}`,
            name: `Home ${input.label}`,
            shortName: `Home ${input.label}`,
            abbreviation: `H${input.label.toUpperCase()}`,
          },
        });
      const [first, sibling] = await Promise.all([
        createGame({
          label: "a",
          scheduledAtUtc: new Date(start.valueOf() + 36 * 60 * 60_000),
        }),
        createGame({
          label: "b",
          scheduledAtUtc: new Date(start.valueOf() + 48 * 60 * 60_000),
        }),
      ]);
      await call(owner, "publishWeeklySlate", {
        requestId: requestId("first-game-publish"),
        leagueId: created.leagueId,
        weekId: week.weekId,
      });
      await call(owner, "submitOrConfirmEntry", {
        requestId: requestId("first-game-picks"),
        leagueId: created.leagueId,
        weekId: week.weekId,
        picks: [
          {gameId: first.gameId, selectedTeamId: "first-home-a"},
          {gameId: sibling.gameId, selectedTeamId: "first-away-b"},
        ],
      });

      const tightenedLock = new Date(Date.now() - 60_000);
      await call(owner, "overrideGameResult", {
        requestId: requestId("first-game-earlier"),
        leagueId: created.leagueId,
        weekId: week.weekId,
        gameId: first.gameId,
        scheduledAtUtc: tightenedLock.toISOString(),
        status: "scheduled",
        homeScore: null,
        awayScore: null,
        winnerTeamId: null,
        reason: "The first selected game moved to an earlier confirmed time.",
      });

      const weekPath = `leagues/${created.leagueId}/weeks/${week.weekId}`;
      const [storedWeek, storedFirst, storedSibling] = await Promise.all([
        adminDb.doc(weekPath).get(),
        adminDb.doc(`${weekPath}/games/${first.gameId}`).get(),
        adminDb.doc(`${weekPath}/games/${sibling.gameId}`).get(),
      ]);
      const slateLock = storedWeek.data()?.effectiveSlateLockAtUtc;
      expect(slateLock).toBeInstanceOf(Timestamp);
      expect(storedFirst.data()?.effectiveLockAtUtc).toEqual(slateLock);
      expect(storedSibling.data()?.effectiveLockAtUtc).toEqual(slateLock);
      await expect(
        httpsCallable(
          getFunctions(owner, "us-central1"),
          "submitOrConfirmEntry",
        )({
          requestId: requestId("first-game-late-pick"),
          leagueId: created.leagueId,
          weekId: week.weekId,
          picks: [
            {gameId: sibling.gameId, selectedTeamId: "first-home-b"},
          ],
        }),
      ).rejects.toThrow();

      const reveal = await call<RevealCallableResult>(
        owner,
        "revealLockedGamePicks",
        {
          requestId: requestId("first-game-reveal"),
          leagueId: created.leagueId,
          weekId: week.weekId,
        },
      );
      expect(reveal.revealedGameCount).toBe(2);
      expect(reveal.revealsByGame[first.gameId]?.[0]?.uid).toBe(ownerUid);
      expect(reveal.revealsByGame[sibling.gameId]?.[0]?.uid).toBe(ownerUid);
      await deleteAdminApp(adminApp);
    },
    120_000,
  );

  it(
    "publishes a manual fallback game while a connected provider is configured",
    async () => {
      const owner = await createSignedInApp("manual-fallback-owner");
      const adminApp = initializeAdminApp(
        {projectId},
        "manual-fallback-admin",
      );
      const adminDb = getAdminFirestore(adminApp);
      const created = await call<{leagueId: string}>(owner, "createLeague", {
        requestId: requestId("manual-fallback-create"),
        name: "Manual Fallback Arena",
        timezone: "America/Chicago",
        settings: {
          providerName: "mock",
          pickerParticipatesInPicks: true,
        },
      });
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() + 1);
      const end = new Date(start.valueOf() + 7 * 24 * 60 * 60_000);
      const week = await call<{weekId: string}>(owner, "createDraftWeek", {
        requestId: requestId("manual-fallback-week"),
        leagueId: created.leagueId,
        sequentialNumber: 1,
        label: "Manual Fallback Week",
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      });
      const scheduledAt = new Date(start.valueOf() + 12 * 60 * 60_000);
      const manual = await call<{gameId: string}>(owner, "createManualGame", {
        requestId: requestId("manual-fallback-game"),
        leagueId: created.leagueId,
        weekId: week.weekId,
        sportCode: "baseball",
        leagueCode: "mlb",
        leagueName: "MLB",
        season: String(start.getUTCFullYear()),
        scheduledAtUtc: scheduledAt.toISOString(),
        venueName: "Neutral Test Park",
        neutralSite: false,
        awayTeam: {
          id: "manual-away",
          name: "Away Club",
          shortName: "Away",
          abbreviation: "AWY",
        },
        homeTeam: {
          id: "manual-home",
          name: "Home Club",
          shortName: "Home",
          abbreviation: "HME",
        },
      });

      const published = await call<{
        selectedGameCount: number;
        eligibleMemberCount: number;
      }>(owner, "publishWeeklySlate", {
        requestId: requestId("manual-fallback-publish"),
        leagueId: created.leagueId,
        weekId: week.weekId,
      });
      expect(published.selectedGameCount).toBe(1);
      expect(published.eligibleMemberCount).toBe(1);

      const [storedWeek, storedGame] = await Promise.all([
        adminDb
          .doc(`leagues/${created.leagueId}/weeks/${week.weekId}`)
          .get(),
        adminDb
          .doc(
            `leagues/${created.leagueId}/weeks/${week.weekId}/games/${manual.gameId}`,
          )
          .get(),
      ]);
      expect(storedWeek.data()).toMatchObject({
        status: "open",
        selectedGameCount: 1,
        catalogProviderSnapshot: "manual",
        catalogPresentationSnapshot: {
          provider: "manual",
          allowRemoteLogos: false,
          allowedLogoHosts: [],
          allowedLogoQueryParameters: [],
          logoRightsReviewDate: null,
        },
      });
      expect(storedGame.data()).toMatchObject({
        provider: "manual",
        leagueCode: "mlb",
        venueName: "Neutral Test Park",
      });
      await deleteAdminApp(adminApp);
    },
    120_000,
  );
});
