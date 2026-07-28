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
  deleteApp as deleteAdminApp,
  initializeApp as initializeAdminApp,
} from "firebase-admin/app";
import {
  FieldValue,
  Timestamp,
  getFirestore as getAdminFirestore,
} from "firebase-admin/firestore";
import {afterAll, beforeAll, describe, expect, it} from "vitest";

const projectId = "demo-lukes-picks-local";
const apps: FirebaseApp[] = [];
let requestSequence = 0;

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
}, 10_000);

afterAll(async () => {
  await Promise.all(apps.map(async (app) => deleteApp(app)));
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

      const start = new Date(Date.now() + 24 * 60 * 60_000);
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
      }>(owner, "listSportsCatalog", {
        requestId: requestId("listgames"),
        leagueId: created.leagueId,
        sportCode: "football",
        leagueCode: "demo-football",
        leagueIdForProvider: "demo-football",
        season: "demo",
        from: day,
        to: day,
        forceRefresh: false,
      });
      expect(catalog.games.length).toBeGreaterThan(0);
      const cachedCatalog = await call<{
        cache: {hit: boolean};
      }>(owner, "listSportsCatalog", {
        requestId: requestId("cachedgames"),
        leagueId: created.leagueId,
        sportCode: "football",
        leagueCode: "demo-football",
        leagueIdForProvider: "demo-football",
        season: "demo",
        from: day,
        to: day,
        forceRefresh: false,
      });
      expect(cachedCatalog.cache.hit).toBe(true);
      await expect(
        httpsCallable(
          getFunctions(memberA, "us-central1"),
          "listSportsCatalog",
        )({
          requestId: requestId("memberforce"),
          leagueId: created.leagueId,
          sportCode: "football",
          leagueCode: "demo-football",
          leagueIdForProvider: "demo-football",
          season: "demo",
          from: day,
          to: day,
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
      await call(owner, "publishWeeklySlate", {
        requestId: requestId("publish"),
        leagueId: created.leagueId,
        weekId: week.weekId,
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

      const gameReference = adminDb.doc(
        `leagues/${created.leagueId}/weeks/${week.weekId}/games/${gameId}`,
      );
      await gameReference.update({
        effectiveLockAtUtc: Timestamp.fromMillis(Date.now() - 60_000),
      });
      await call(owner, "revealLockedGamePicks", {
        requestId: requestId("reveal"),
        leagueId: created.leagueId,
        weekId: week.weekId,
      });
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
});
