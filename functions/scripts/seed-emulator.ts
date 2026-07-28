import {createHash, createHmac} from "node:crypto";
import {getApps, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {FieldValue, Timestamp, getFirestore} from "firebase-admin/firestore";

const projectId =
  process.env.GCLOUD_PROJECT ??
  process.env.GOOGLE_CLOUD_PROJECT ??
  "demo-lukes-picks-local";

if (
  process.env.FIRESTORE_EMULATOR_HOST === undefined ||
  !projectId.startsWith("demo-")
) {
  throw new Error(
    "Refusing to seed: use a demo-* project with FIRESTORE_EMULATOR_HOST.",
  );
}

if (getApps().length === 0) initializeApp({projectId});
const db = getFirestore();
const auth = getAuth();
const leagueId = "demo-lukes-picks-arena";
const inviteCode = "DEMO-LUKES-PICKS-2026";
const pepper = "emulator-only-invite-pepper-000000000000";
const inviteCodeHash = createHmac("sha256", pepper)
  .update(inviteCode)
  .digest("hex");
const now = Date.now();

const members = [
  {uid: "demo-owner", displayName: "Casey", role: "owner"},
  {uid: "demo-picker", displayName: "Jordan", role: "member"},
  {uid: "demo-member-a", displayName: "Riley", role: "member"},
  {uid: "demo-member-b", displayName: "Morgan", role: "member"},
] as const;

if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== undefined) {
  for (const member of members) {
    try {
      await auth.createUser({
        uid: member.uid,
        displayName: member.displayName,
        email: `${member.uid}@example.test`,
        emailVerified: true,
      });
    } catch (error: unknown) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("already exists")
      ) {
        throw error;
      }
    }
  }
}

const leagueReference = db.collection("leagues").doc(leagueId);
await leagueReference.set({
  name: "Luke's Picks Arena",
  slug: "lukes-picks-arena-demo",
  ownerUid: "demo-owner",
  timezone: "America/Chicago",
  status: "active",
  currentWeekId: "week-0002",
  currentPickerUid: "demo-picker",
  rotationCursor: 1,
  settings: {
    pickerParticipatesInPicks: false,
    pickLockPolicy: "perGame",
    weekStartDay: 1,
    weekStartTime: "09:00",
    enabledSports: ["football", "basketball", "baseball", "hockey"],
    enabledLeagues: [
      "demo-football",
      "demo-basketball",
      "demo-baseball",
      "demo-hockey",
    ],
    manualFinalizationRequired: true,
    providerName: "mock",
  },
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});

for (const [rotationOrder, member] of members.entries()) {
  await leagueReference.collection("members").doc(member.uid).set({
    uid: member.uid,
    displayName: member.displayName,
    photoUrl: null,
    role: member.role,
    status: "active",
    rotationOrder,
    joinedAt: FieldValue.serverTimestamp(),
    eligibleFromWeekId: null,
    lastActiveAt: FieldValue.serverTimestamp(),
  });
  await db.collection("users").doc(member.uid).set({
    uid: member.uid,
    email: `${member.uid}@example.test`,
    displayName: member.displayName,
    photoUrl: null,
    accountStatus: "active",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastLoginAt: FieldValue.serverTimestamp(),
  });
}

await leagueReference.collection("private").doc("invite").set({
  inviteCodeHash,
  generatedAt: FieldValue.serverTimestamp(),
  generatedBy: "demo-owner",
  expiresAt: null,
  maxUses: null,
  useCount: 0,
  active: true,
});
await db.collection("joinCodeMappings").doc(inviteCodeHash).set({
  leagueId,
  active: true,
  expiresAt: null,
  maxUses: null,
  useCount: 0,
  createdAt: FieldValue.serverTimestamp(),
});

const finalizedWeek = leagueReference.collection("weeks").doc("week-0001");
await finalizedWeek.set({
  sequentialNumber: 1,
  label: "Demo Week 1",
  startAt: Timestamp.fromMillis(now - 14 * 24 * 60 * 60_000),
  endAt: Timestamp.fromMillis(now - 7 * 24 * 60 * 60_000),
  pickerUid: "demo-owner",
  pickerDisplayNameSnapshot: "Casey",
  status: "finalized",
  pickerParticipatesSnapshot: false,
  lockPolicySnapshot: "perGame",
  publishedAt: Timestamp.fromMillis(now - 13 * 24 * 60 * 60_000),
  finalizedAt: Timestamp.fromMillis(now - 7 * 24 * 60 * 60_000),
  selectedGameCount: 3,
  eligibleMemberCount: 3,
  winnerUids: ["demo-member-a", "demo-member-b"],
  highScore: 2,
  resultVersion: 1,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});

for (const member of members) {
  const eligible = member.uid !== "demo-owner";
  const winner = ["demo-member-a", "demo-member-b"].includes(member.uid);
  await finalizedWeek.collection("entries").doc(member.uid).set({
    uid: member.uid,
    eligible,
    ineligibilityReason: eligible ? null : "weeklyPicker",
    savedPickCount: eligible ? 3 : 0,
    totalRequiredPickCount: 3,
    completionState: eligible ? "complete" : "ineligible",
    submittedAt: eligible ? Timestamp.fromMillis(now - 8 * 24 * 60 * 60_000) : null,
    gradedCount: eligible ? 3 : 0,
    correctCount: winner ? 2 : eligible ? 1 : 0,
    incorrectCount: winner ? 1 : eligible ? 2 : 0,
    voidCount: 0,
    points: winner ? 2 : eligible ? 1 : 0,
    accuracy: winner ? 2 / 3 : eligible ? 1 / 3 : null,
    weeklyRank: winner ? 1 : eligible ? 3 : null,
    isWeeklyWinner: winner,
    lastSyncedAt: FieldValue.serverTimestamp(),
  });
  await leagueReference.collection("standings").doc(member.uid).set({
    uid: member.uid,
    totalPoints: winner ? 2 : eligible ? 1 : 0,
    totalCorrect: winner ? 2 : eligible ? 1 : 0,
    totalIncorrect: winner ? 1 : eligible ? 2 : 0,
    totalVoid: 0,
    totalGraded: eligible ? 3 : 0,
    overallAccuracy: winner ? 2 / 3 : eligible ? 1 / 3 : null,
    eligibleWeeks: eligible ? 1 : 0,
    pickerWeeks: member.uid === "demo-owner" ? 1 : 0,
    weeklyTitles: winner ? 1 : 0,
    currentRank: winner ? 1 : eligible ? 3 : 4,
    previousRank: null,
    bestWeekPoints: winner ? 2 : eligible ? 1 : 0,
    lastFinalizedWeekId: "week-0001",
    updatedAt: FieldValue.serverTimestamp(),
    calculationVersion: 1,
  });
}

const draftWeek = leagueReference.collection("weeks").doc("week-0002");
await draftWeek.set({
  sequentialNumber: 2,
  label: "Demo Week 2",
  startAt: Timestamp.fromMillis(now),
  endAt: Timestamp.fromMillis(now + 7 * 24 * 60 * 60_000),
  pickerUid: "demo-picker",
  pickerDisplayNameSnapshot: "Jordan",
  status: "draft",
  pickerParticipatesSnapshot: false,
  lockPolicySnapshot: "perGame",
  publishedAt: null,
  finalizedAt: null,
  selectedGameCount: 8,
  eligibleMemberCount: 0,
  winnerUids: [],
  highScore: null,
  resultVersion: 0,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});

const statuses = [
  "scheduled",
  "scheduled",
  "live",
  "final",
  "final",
  "postponed",
  "void",
  "scheduled",
] as const;
const sports = [
  "football",
  "basketball",
  "baseball",
  "hockey",
] as const;
for (let index = 0; index < 8; index += 1) {
  const sport = sports[index % sports.length] ?? "football";
  const status = statuses[index] ?? "scheduled";
  const scheduledAt = new Date(now + (index - 3) * 2 * 60 * 60_000);
  const homeId = `demo-${sport}-home-${index + 1}`;
  const awayId = `demo-${sport}-away-${index + 1}`;
  const homeScore = status === "final" ? 24 + index : null;
  const awayScore = status === "final" ? 17 + index : null;
  const winnerTeamId = status === "final" ? homeId : null;
  const material = {status, homeScore, awayScore, winnerTeamId};
  const gameId = `mock:${sport}:seed-${index + 1}`;
  await draftWeek.collection("games").doc(gameId).set({
    id: gameId,
    provider: "mock",
    providerGameId: `seed-${index + 1}`,
    sportCode: sport,
    leagueCode: `demo-${sport}`,
    leagueName: `Demo ${sport}`,
    season: "demo",
    weekOrRound: "2",
    scheduledAtUtc: Timestamp.fromDate(scheduledAt),
    publishedScheduledAtUtc: Timestamp.fromDate(scheduledAt),
    effectiveLockAtUtc: Timestamp.fromDate(scheduledAt),
    venueName: null,
    neutralSite: index % 3 === 0,
    homeTeam: {
      id: homeId,
      name: `Harbor ${index + 1}`,
      shortName: `Harbor ${index + 1}`,
      abbreviation: `H${index + 1}`,
      logoUrl: null,
    },
    awayTeam: {
      id: awayId,
      name: `Prairie ${index + 1}`,
      shortName: `Prairie ${index + 1}`,
      abbreviation: `P${index + 1}`,
      logoUrl: null,
    },
    status,
    homeScore,
    awayScore,
    winnerTeamId,
    providerLastUpdatedAt: FieldValue.serverTimestamp(),
    lastSyncedAt: FieldValue.serverTimestamp(),
    manualOverride: status === "void",
    manualOverrideReason: status === "void" ? "Emulator demo void." : null,
    manualOverrideBy: status === "void" ? "demo-owner" : null,
    resultVersion: createHash("sha256")
      .update(JSON.stringify(material))
      .digest("hex"),
    sourcePayloadHash: createHash("sha256")
      .update(`seed-${index + 1}`)
      .digest("hex"),
    selectedByPickerUid: "demo-picker",
    selectedAt: FieldValue.serverTimestamp(),
    pickRevealCompletedAt: null,
    gradingStatus: "pending",
  });
}

console.log(
  JSON.stringify({
    seeded: true,
    projectId,
    leagueId,
    inviteCode,
    members: members.map((member) => member.uid),
  }),
);
