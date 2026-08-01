import {readFileSync} from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";

const projectId = "demo-lukes-picks-rules";
let environment: RulesTestEnvironment;

function emulatorAddress(): {host: string; port: number} {
  const [host = "127.0.0.1", rawPort = "8080"] = (
    process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080"
  ).split(":");
  return {host, port: Number.parseInt(rawPort, 10)};
}

async function seed(): Promise<void> {
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const now = Date.now();
    const future = Timestamp.fromMillis(now + 60 * 60_000);
    const past = Timestamp.fromMillis(now - 60 * 60_000);
    await Promise.all([
      setDoc(doc(firestore, "users/owner"), {
        uid: "owner",
        email: "private@example.test",
        displayName: "Owner",
        accountStatus: "active",
      }),
      setDoc(doc(firestore, "leagues/alpha"), {
        name: "Alpha",
        ownerUid: "owner",
        settings: {pickLockPolicy: "perGame"},
      }),
      setDoc(doc(firestore, "leagues/beta"), {
        name: "Beta",
        ownerUid: "outsider",
      }),
      setDoc(doc(firestore, "leagues/alpha/members/owner"), {
        uid: "owner",
        displayName: "Owner",
        role: "owner",
        status: "active",
      }),
      setDoc(doc(firestore, "leagues/alpha/members/picker"), {
        uid: "picker",
        displayName: "Picker",
        role: "member",
        status: "active",
      }),
      setDoc(doc(firestore, "leagues/alpha/members/commissioner"), {
        uid: "commissioner",
        displayName: "Commissioner",
        role: "commissioner",
        status: "active",
      }),
      setDoc(doc(firestore, "leagues/alpha/members/member"), {
        uid: "member",
        displayName: "Member",
        role: "member",
        status: "active",
      }),
      setDoc(doc(firestore, "leagues/alpha/members/other"), {
        uid: "other",
        displayName: "Other",
        role: "member",
        status: "active",
      }),
      setDoc(doc(firestore, "leagues/alpha/weeks/week-0001"), {
        status: "open",
        pickerUid: "picker",
      }),
      setDoc(doc(firestore, "leagues/alpha/weeks/week-draft"), {
        status: "draft",
        pickerUid: "picker",
      }),
      setDoc(doc(firestore, "leagues/alpha/weeks/week-draft/games/hidden"), {
        status: "scheduled",
        effectiveLockAtUtc: future,
        homeTeam: {id: "draft-home"},
        awayTeam: {id: "draft-away"},
      }),
      setDoc(doc(firestore, "leagues/alpha/weeks/week-orphan/games/orphan"), {
        status: "scheduled",
        effectiveLockAtUtc: future,
        homeTeam: {id: "orphan-home"},
        awayTeam: {id: "orphan-away"},
      }),
      setDoc(doc(firestore, "leagues/alpha/weeks/week-0001/games/future"), {
        status: "scheduled",
        effectiveLockAtUtc: future,
        homeTeam: {id: "home"},
        awayTeam: {id: "away"},
      }),
      setDoc(doc(firestore, "leagues/alpha/weeks/week-0001/games/past"), {
        status: "final",
        effectiveLockAtUtc: past,
        pickRevealCompletedAt: Timestamp.fromMillis(now - 30 * 60_000),
        homeTeam: {id: "home"},
        awayTeam: {id: "away"},
        winnerTeamId: "home",
      }),
      setDoc(doc(firestore, "leagues/alpha/weeks/week-0001/entries/member"), {
        uid: "member",
        eligible: true,
        points: 0,
      }),
      setDoc(doc(firestore, "leagues/alpha/weeks/week-0001/entries/other"), {
        uid: "other",
        eligible: true,
        points: 0,
      }),
      setDoc(
        doc(
          firestore,
          "leagues/alpha/weeks/week-0001/entries/other/picks/future",
        ),
        {
          gameId: "future",
          selectedTeamId: "home",
          selectedAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          lockAtSnapshot: future,
        },
      ),
      setDoc(
        doc(
          firestore,
          "leagues/alpha/weeks/week-0001/reveals/past/picks/other",
        ),
        {
          uid: "other",
          selectedTeamId: "home",
          displayName: "Other",
          revealedAt: Timestamp.now(),
          outcome: "correct",
          points: 1,
        },
      ),
      setDoc(
        doc(
          firestore,
          "leagues/alpha/weeks/week-0001/reveals/future/picks/other",
        ),
        {
          uid: "other",
          selectedTeamId: "home",
          displayName: "Other",
          revealedAt: Timestamp.now(),
          outcome: "pending",
          points: 0,
        },
      ),
      setDoc(doc(firestore, "sportsCache/internal"), {
        secret: "server-only",
      }),
      setDoc(doc(firestore, "sportsCatalogGames/espn:football:401000001"), {
        provider: "espn",
        providerGameId: "401000001",
      }),
      setDoc(doc(firestore, "providerLocks/espn-scoreboard"), {
        owner: "server",
        expiresAt: future,
      }),
      setDoc(doc(firestore, "providerManualRefreshLimits/espn-owner"), {
        actorUid: "owner",
        nextAllowedAt: future,
      }),
      setDoc(doc(firestore, "systemConfig/espnCatalog"), {
        enabled: false,
        authorizationReference: "not-approved-test-fixture",
        authorizationReviewedAt: "2026-08-01",
      }),
    ]);
  });
}

beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      ...emulatorAddress(),
      rules: readFileSync(
        new URL("../../firestore.rules", import.meta.url),
        "utf8",
      ),
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await seed();
});

afterAll(async () => {
  await environment.cleanup();
});

describe("Firestore security boundary", () => {
  it("denies unauthenticated league access", async () => {
    const firestore = environment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(firestore, "leagues/alpha")));
  });

  it("denies nonmembers and cross-league reads", async () => {
    const outsider = environment.authenticatedContext("outsider").firestore();
    const member = environment.authenticatedContext("member").firestore();
    await assertFails(getDoc(doc(outsider, "leagues/alpha")));
    await assertFails(getDoc(doc(member, "leagues/beta")));
  });

  it("restores only the signed-in user's active memberships", async () => {
    const firestore = environment.authenticatedContext("member").firestore();
    const memberships = query(
      collectionGroup(firestore, "members"),
      where("uid", "==", "member"),
      where("status", "==", "active"),
    );
    const snapshot = await assertSucceeds(getDocs(memberships));
    expect(snapshot.docs.map((document) => document.id)).toEqual(["member"]);
    await assertFails(
      getDocs(
        query(
          collectionGroup(firestore, "members"),
          where("uid", "==", "owner"),
          where("status", "==", "active"),
        ),
      ),
    );
    await assertFails(
      getDocs(
        query(
          collectionGroup(firestore, "members"),
          where("uid", "==", "member"),
        ),
      ),
    );
  });

  it("keeps private user profiles and pre-lock picks private", async () => {
    const member = environment.authenticatedContext("member").firestore();
    const other = environment.authenticatedContext("other").firestore();
    await assertFails(getDoc(doc(member, "users/owner")));
    await assertFails(
      getDoc(
        doc(
          member,
          "leagues/alpha/weeks/week-0001/entries/other/picks/future",
        ),
      ),
    );
    await assertSucceeds(
      getDoc(
        doc(
          other,
          "leagues/alpha/weeks/week-0001/entries/other/picks/future",
        ),
      ),
    );
    await assertSucceeds(
      getDocs(
        collection(
          member,
          "leagues/alpha/weeks/week-0001/reveals/past/picks",
        ),
      ),
    );
  });

  it("allows active members to read backend reveals after lock", async () => {
    const member = environment.authenticatedContext("member").firestore();
    await assertSucceeds(
      getDoc(
        doc(
          member,
          "leagues/alpha/weeks/week-0001/reveals/past/picks/other",
        ),
      ),
    );
    await assertFails(
      getDoc(
        doc(
          member,
          "leagues/alpha/weeks/week-0001/reveals/future/picks/other",
        ),
      ),
    );
  });

  it("keeps draft game contents limited to the picker and arena admins", async () => {
    const member = environment.authenticatedContext("member").firestore();
    const picker = environment.authenticatedContext("picker").firestore();
    const owner = environment.authenticatedContext("owner").firestore();
    const commissioner = environment
      .authenticatedContext("commissioner")
      .firestore();
    const draftGame = "leagues/alpha/weeks/week-draft/games/hidden";

    await assertFails(getDoc(doc(member, draftGame)));
    await assertFails(
      getDocs(collection(member, "leagues/alpha/weeks/week-draft/games")),
    );
    await assertFails(
      getDoc(doc(owner, "leagues/alpha/weeks/week-orphan/games/orphan")),
    );
    await assertSucceeds(
      getDoc(doc(member, "leagues/alpha/weeks/week-0001/games/future")),
    );
    await assertSucceeds(getDoc(doc(picker, draftGame)));
    await assertSucceeds(getDoc(doc(owner, draftGame)));
    await assertSucceeds(getDoc(doc(commissioner, draftGame)));
  });

  it("accepts a valid own pick before lock", async () => {
    const firestore = environment.authenticatedContext("member").firestore();
    let lock = Timestamp.fromMillis(0);
    await environment.withSecurityRulesDisabled(async (context) => {
      const snapshot = await getDoc(
        doc(
          context.firestore(),
          "leagues/alpha/weeks/week-0001/games/future",
        ),
      );
      lock = snapshot.data()?.effectiveLockAtUtc as Timestamp;
    });
    await assertSucceeds(
      setDoc(
        doc(
          firestore,
          "leagues/alpha/weeks/week-0001/entries/member/picks/future",
        ),
        {
          gameId: "future",
          selectedTeamId: "away",
          selectedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lockAtSnapshot: lock,
        },
      ),
    );
  });

  it("rejects late picks and invalid teams", async () => {
    const firestore = environment.authenticatedContext("member").firestore();
    const pastLock = Timestamp.fromMillis(Date.now() - 60 * 60_000);
    const futureLock = Timestamp.fromMillis(Date.now() + 60 * 60_000);
    await assertFails(
      setDoc(
        doc(
          firestore,
          "leagues/alpha/weeks/week-0001/entries/member/picks/past",
        ),
        {
          gameId: "past",
          selectedTeamId: "home",
          selectedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lockAtSnapshot: pastLock,
        },
      ),
    );
    await assertFails(
      setDoc(
        doc(
          firestore,
          "leagues/alpha/weeks/week-0001/entries/member/picks/future",
        ),
        {
          gameId: "future",
          selectedTeamId: "not-a-team",
          selectedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lockAtSnapshot: futureLock,
        },
      ),
    );
  });

  it("rejects score manipulation and role escalation", async () => {
    const firestore = environment.authenticatedContext("member").firestore();
    await assertFails(
      updateDoc(
        doc(firestore, "leagues/alpha/weeks/week-0001/games/future"),
        {status: "final", winnerTeamId: "home"},
      ),
    );
    await assertFails(
      updateDoc(
        doc(firestore, "leagues/alpha/weeks/week-0001/entries/member"),
        {points: 999, correctCount: 999},
      ),
    );
    await assertFails(
      updateDoc(doc(firestore, "leagues/alpha/members/member"), {
        role: "owner",
      }),
    );
  });

  it("rejects post-publish picker edits and member admin operations", async () => {
    const picker = environment.authenticatedContext("picker").firestore();
    const member = environment.authenticatedContext("member").firestore();
    await assertFails(
      setDoc(
        doc(picker, "leagues/alpha/weeks/week-0001/games/forged"),
        {
          status: "scheduled",
          homeTeam: {id: "one"},
          awayTeam: {id: "two"},
        },
      ),
    );
    await assertFails(
      updateDoc(doc(member, "leagues/alpha"), {
        settings: {pickerParticipatesInPicks: true},
      }),
    );
  });

  it("denies direct access to server-internal collections", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    await assertFails(getDoc(doc(owner, "sportsCache/internal")));
    await assertFails(
      getDoc(doc(owner, "sportsCatalogGames/espn:football:401000001")),
    );
    await assertFails(getDoc(doc(owner, "providerLocks/espn-scoreboard")));
    await assertFails(
      getDoc(doc(owner, "providerManualRefreshLimits/espn-owner")),
    );
    await assertFails(getDoc(doc(owner, "systemConfig/espnCatalog")));
    await assertFails(
      setDoc(doc(owner, "providerUsage/apiSports_2099-01-01"), {
        requestCount: 0,
      }),
    );
    await assertFails(
      setDoc(doc(owner, "systemConfig/espnCatalog"), {
        enabled: true,
      }),
    );
  });
});
