import {randomUUID} from "node:crypto";
import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {writeAuditInTransaction} from "../audit.js";
import {db} from "../config.js";
import type {EntryScore, StandingAggregate} from "../types.js";
import {commitWritesInChunks} from "../utils.js";

export type GradeableGame = {
  id: string;
  status: string;
  winnerTeamId: string | null;
  resultVersion: string;
  revealed: boolean;
};

export type PickForScoring = {
  gameId: string;
  selectedTeamId: string;
};

export type GameResultVersionSnapshot = {
  id: string;
  resultVersion: string;
};

export function gameResultVersionsAreStable(
  claimed: GameResultVersionSnapshot[],
  current: GameResultVersionSnapshot[],
): boolean {
  const currentById = new Map(
    current.map((game) => [game.id, game.resultVersion]),
  );
  return (
    claimed.length === currentById.size &&
    claimed.every(
      (game) => currentById.get(game.id) === game.resultVersion,
    )
  );
}

export function scoreEntry(
  uid: string,
  eligible: boolean,
  games: GradeableGame[],
  picks: PickForScoring[],
): EntryScore {
  if (!eligible) {
    return {
      uid,
      eligible: false,
      gradedCount: 0,
      correctCount: 0,
      incorrectCount: 0,
      voidCount: 0,
      points: 0,
      accuracy: null,
    };
  }
  const picksByGame = new Map(picks.map((pick) => [pick.gameId, pick]));
  let correctCount = 0;
  let incorrectCount = 0;
  let voidCount = 0;

  for (const game of games) {
    if (!game.revealed) {
      continue;
    }
    if (game.status === "void" || game.status === "cancelled") {
      voidCount += 1;
      continue;
    }
    if (game.status !== "final" || game.winnerTeamId === null) {
      continue;
    }
    const pick = picksByGame.get(game.id);
    if (pick?.selectedTeamId === game.winnerTeamId) {
      correctCount += 1;
    } else {
      incorrectCount += 1;
    }
  }
  const gradedCount = correctCount + incorrectCount;
  return {
    uid,
    eligible: true,
    gradedCount,
    correctCount,
    incorrectCount,
    voidCount,
    points: correctCount,
    accuracy: gradedCount === 0 ? null : correctCount / gradedCount,
  };
}

function competitionRanks(scores: EntryScore[]): Map<string, number> {
  const sorted = [...scores]
    .filter((score) => score.eligible && score.gradedCount > 0)
    .sort((left, right) => right.points - left.points);
  const ranks = new Map<string, number>();
  let previousPoints: number | null = null;
  let previousRank = 0;
  sorted.forEach((score, index) => {
    const rank =
      previousPoints === score.points ? previousRank : index + 1;
    ranks.set(score.uid, rank);
    previousPoints = score.points;
    previousRank = rank;
  });
  return ranks;
}

function gameFromSnapshot(
  snapshot: QueryDocumentSnapshot,
): GradeableGame {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    status: String(data.status),
    winnerTeamId:
      typeof data.winnerTeamId === "string" ? data.winnerTeamId : null,
    resultVersion: String(data.resultVersion ?? "unversioned"),
    revealed: data.pickRevealCompletedAt instanceof Timestamp,
  };
}

export async function gradeWeek(
  leagueId: string,
  weekId: string,
): Promise<{
  scores: EntryScore[];
  winnerUids: string[];
  highScore: number | null;
}> {
  const weekReference = db
    .collection("leagues")
    .doc(leagueId)
    .collection("weeks")
    .doc(weekId);
  const [weekSnapshot, gamesSnapshot, entriesSnapshot] = await Promise.all([
    weekReference.get(),
    weekReference.collection("games").get(),
    weekReference.collection("entries").get(),
  ]);
  if (!weekSnapshot.exists) {
    throw new HttpsError("not-found", "Week not found.");
  }
  const games = gamesSnapshot.docs.map(gameFromSnapshot);
  const scores: EntryScore[] = [];
  const pickUpdates: Array<{
    reference: FirebaseFirestore.DocumentReference;
    data: Record<string, unknown>;
  }> = [];
  const revealUpdates: Array<{
    reference: FirebaseFirestore.DocumentReference;
    data: Record<string, unknown>;
  }> = [];
  const entryUpdates: Array<{
    reference: FirebaseFirestore.DocumentReference;
    data: Record<string, unknown>;
  }> = [];

  for (const entry of entriesSnapshot.docs) {
    const entryData = entry.data();
    const picksSnapshot = await entry.ref.collection("picks").get();
    const picks: PickForScoring[] = picksSnapshot.docs.map((pick) => ({
      gameId: pick.id,
      selectedTeamId: String(pick.data().selectedTeamId),
    }));
    const score = scoreEntry(
      entry.id,
      entryData.eligible === true,
      games,
      picks,
    );
    scores.push(score);
    const gamesById = new Map(games.map((game) => [game.id, game]));
    for (const pick of picksSnapshot.docs) {
      const game = gamesById.get(pick.id);
      if (game === undefined) continue;
      let outcome: "pending" | "correct" | "incorrect" | "void" = "pending";
      let points = 0;
      if (!game.revealed) {
        outcome = "pending";
      } else if (game.status === "void" || game.status === "cancelled") {
        outcome = "void";
      } else if (game.status === "final" && game.winnerTeamId !== null) {
        outcome =
          pick.data().selectedTeamId === game.winnerTeamId
            ? "correct"
            : "incorrect";
        points = outcome === "correct" ? 1 : 0;
      }
      if (
        pick.data().outcome !== outcome ||
        pick.data().points !== points ||
        pick.data().outcomeVersion !== game.resultVersion
      ) {
        pickUpdates.push({
          reference: pick.ref,
          data: {
            outcome,
            points,
            outcomeVersion: game.resultVersion,
            gradedAt: FieldValue.serverTimestamp(),
          },
        });
      }
      if (game.revealed) {
        const revealReference = weekReference
          .collection("reveals")
          .doc(game.id)
          .collection("picks")
          .doc(entry.id);
        const reveal = await revealReference.get();
        if (
          reveal.exists &&
          (reveal.data()?.outcome !== outcome ||
            reveal.data()?.points !== points ||
            reveal.data()?.outcomeVersion !== game.resultVersion)
        ) {
          revealUpdates.push({
            reference: revealReference,
            data: {
              outcome,
              points,
              outcomeVersion: game.resultVersion,
              updatedAt: FieldValue.serverTimestamp(),
            },
          });
        }
      }
    }
  }

  const eligibleScores = scores.filter(
    (score) => score.eligible && score.gradedCount > 0,
  );
  const highScore =
    eligibleScores.length === 0
      ? null
      : Math.max(...eligibleScores.map((score) => score.points));
  const winnerUids =
    highScore === null
      ? []
      : eligibleScores
          .filter((score) => score.points === highScore)
          .map((score) => score.uid);
  const ranks = competitionRanks(scores);

  await commitWritesInChunks(db, pickUpdates, (batch, update) => {
    batch.set(update.reference, update.data, {merge: true});
  });
  for (const score of scores) {
    const current = entriesSnapshot.docs.find(
      (entry) => entry.id === score.uid,
    )?.data();
    const data = {
        gradedCount: score.gradedCount,
        correctCount: score.correctCount,
        incorrectCount: score.incorrectCount,
        voidCount: score.voidCount,
        points: score.points,
        accuracy: score.accuracy,
        weeklyRank: ranks.get(score.uid) ?? null,
        isWeeklyWinner: winnerUids.includes(score.uid),
        lastSyncedAt: FieldValue.serverTimestamp(),
        calculationVersion: 1,
    };
    if (
      current?.gradedCount !== score.gradedCount ||
      current.correctCount !== score.correctCount ||
      current.incorrectCount !== score.incorrectCount ||
      current.voidCount !== score.voidCount ||
      current.points !== score.points ||
      current.accuracy !== score.accuracy ||
      current.weeklyRank !== (ranks.get(score.uid) ?? null) ||
      current.isWeeklyWinner !== winnerUids.includes(score.uid)
    ) {
      entryUpdates.push({
        reference: weekReference.collection("entries").doc(score.uid),
        data,
      });
    }
  }
  await commitWritesInChunks(db, revealUpdates, (batch, update) => {
    batch.set(update.reference, update.data, {merge: true});
  });
  await commitWritesInChunks(db, entryUpdates, (batch, update) => {
    batch.set(update.reference, update.data, {merge: true});
  });
  const currentWinners = Array.isArray(weekSnapshot.data()?.winnerUids)
    ? weekSnapshot.data()?.winnerUids as unknown[]
    : [];
  if (
    JSON.stringify(currentWinners) !== JSON.stringify(winnerUids) ||
    weekSnapshot.data()?.highScore !== highScore
  ) {
    await weekReference.set(
      {
        winnerUids,
        highScore,
        updatedAt: FieldValue.serverTimestamp(),
        calculationVersion: 1,
      },
      {merge: true},
    );
  }
  return {scores, winnerUids, highScore};
}

function emptyAggregate(uid: string): StandingAggregate {
  return {
    uid,
    totalPoints: 0,
    totalCorrect: 0,
    totalIncorrect: 0,
    totalVoid: 0,
    totalGraded: 0,
    overallAccuracy: null,
    eligibleWeeks: 0,
    pickerWeeks: 0,
    weeklyTitles: 0,
    bestWeekPoints: 0,
  };
}

function aggregateEntry(
  aggregate: StandingAggregate,
  entry: DocumentData,
  week: DocumentData,
): void {
  if (entry.eligible === true) aggregate.eligibleWeeks += 1;
  if (week.pickerUid === aggregate.uid) aggregate.pickerWeeks += 1;
  aggregate.totalPoints += Number(entry.points ?? 0);
  aggregate.totalCorrect += Number(entry.correctCount ?? 0);
  aggregate.totalIncorrect += Number(entry.incorrectCount ?? 0);
  aggregate.totalVoid += Number(entry.voidCount ?? 0);
  aggregate.totalGraded += Number(entry.gradedCount ?? 0);
  aggregate.weeklyTitles += entry.isWeeklyWinner === true ? 1 : 0;
  aggregate.bestWeekPoints = Math.max(
    aggregate.bestWeekPoints,
    Number(entry.points ?? 0),
  );
}

function standingsRank(
  aggregates: StandingAggregate[],
): Map<string, number> {
  const sorted = [...aggregates].sort((left, right) => {
    if (left.totalPoints !== right.totalPoints) {
      return right.totalPoints - left.totalPoints;
    }
    const leftAccuracy = left.overallAccuracy ?? -1;
    const rightAccuracy = right.overallAccuracy ?? -1;
    if (leftAccuracy !== rightAccuracy) return rightAccuracy - leftAccuracy;
    return right.weeklyTitles - left.weeklyTitles;
  });
  const ranks = new Map<string, number>();
  let previousSignature = "";
  let previousRank = 0;
  sorted.forEach((aggregate, index) => {
    const signature = [
      aggregate.totalPoints,
      aggregate.overallAccuracy ?? "na",
      aggregate.weeklyTitles,
    ].join(":");
    const rank = signature === previousSignature ? previousRank : index + 1;
    ranks.set(aggregate.uid, rank);
    previousSignature = signature;
    previousRank = rank;
  });
  return ranks;
}

type StandingsFinalizationGuard = {
  reference: FirebaseFirestore.DocumentReference;
  claimId: string;
  resultVersion: number;
};

type StandingsRebuildTestHooks = {
  beforeCommit?: () => Promise<void>;
};

export async function rebuildLeagueStandingsAsNewGeneration(
  leagueId: string,
): Promise<StandingAggregate[]> {
  await db.collection("leagues").doc(leagueId).update({
    standingsEpoch: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return rebuildLeagueStandings(leagueId);
}

export async function rebuildLeagueStandings(
  leagueId: string,
  finalizationGuard?: StandingsFinalizationGuard,
  hooks: StandingsRebuildTestHooks = {},
): Promise<StandingAggregate[]> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rebuilt = await rebuildLeagueStandingsAtCurrentEpoch(
      leagueId,
      finalizationGuard,
      hooks,
    );
    if (rebuilt !== null) return rebuilt;
  }
  throw new HttpsError(
    "aborted",
    "Standings changed repeatedly while they were rebuilding. Try again.",
  );
}

async function rebuildLeagueStandingsAtCurrentEpoch(
  leagueId: string,
  finalizationGuard: StandingsFinalizationGuard | undefined,
  hooks: StandingsRebuildTestHooks,
): Promise<StandingAggregate[] | null> {
  const leagueReference = db.collection("leagues").doc(leagueId);
  // Read the epoch before any aggregate input. Finalize and reopen update the
  // week status and increment this epoch in the same transaction. Every write
  // below rechecks it, so a cross-week change forces a clean restart.
  const leagueSnapshot = await leagueReference.get();
  if (!leagueSnapshot.exists) {
    throw new HttpsError("not-found", "Arena not found.");
  }
  const standingsEpoch = Number(leagueSnapshot.data()?.standingsEpoch ?? 0);
  const [weeksSnapshot, membersSnapshot, existingSnapshot] = await Promise.all([
    leagueReference.collection("weeks").where("status", "==", "finalized").get(),
    leagueReference.collection("members").get(),
    leagueReference.collection("standings").get(),
  ]);
  const finalizedWeeks: Array<{
    id: string;
    data: DocumentData;
    finalizedAtMillis: number;
    sequentialNumber: number;
    entries: Array<{uid: string; data: DocumentData}>;
  }> = [];
  for (const week of weeksSnapshot.docs) {
    const entries = await week.ref.collection("entries").get();
    const data = week.data();
    const finalizedAt = data.finalizedAt;
    const finalizedAtMillis =
      finalizedAt instanceof Timestamp ? finalizedAt.toMillis() : 0;
    finalizedWeeks.push({
      id: week.id,
      data,
      finalizedAtMillis,
      sequentialNumber: Number(data.sequentialNumber ?? 0),
      entries: entries.docs.map((entry) => ({
        uid: entry.id,
        data: entry.data(),
      })),
    });
  }
  const orderedFinalizedWeeks = [...finalizedWeeks].sort((left, right) =>
    left.finalizedAtMillis !== right.finalizedAtMillis
      ? left.finalizedAtMillis - right.finalizedAtMillis
      : left.sequentialNumber !== right.sequentialNumber
        ? left.sequentialNumber - right.sequentialNumber
        : left.id.localeCompare(right.id),
  );
  const latestWeekId = orderedFinalizedWeeks.at(-1)?.id ?? null;
  const aggregateWeeks = (
    weeks: typeof finalizedWeeks,
  ): Map<string, StandingAggregate> => {
    const aggregates = new Map<string, StandingAggregate>();
    for (const member of membersSnapshot.docs) {
      aggregates.set(member.id, emptyAggregate(member.id));
    }
    for (const week of weeks) {
      for (const entry of week.entries) {
        const aggregate =
          aggregates.get(entry.uid) ?? emptyAggregate(entry.uid);
        aggregateEntry(aggregate, entry.data, week.data);
        aggregates.set(entry.uid, aggregate);
      }
    }
    for (const aggregate of aggregates.values()) {
      aggregate.overallAccuracy =
        aggregate.totalGraded === 0
          ? null
          : aggregate.totalCorrect / aggregate.totalGraded;
    }
    return aggregates;
  };
  const aggregates = aggregateWeeks(finalizedWeeks);
  const values = [...aggregates.values()];
  const ranks = standingsRank(values);
  const previousWeeks = latestWeekId === null
    ? []
    : finalizedWeeks.filter((week) => week.id !== latestWeekId);
  const previousRanks = previousWeeks.length === 0
    ? null
    : standingsRank([...aggregateWeeks(previousWeeks).values()]);
  const standingWrites = values.map((aggregate) => {
    return {
      reference: leagueReference.collection("standings").doc(aggregate.uid),
      data: {
        ...aggregate,
        currentRank: ranks.get(aggregate.uid) ?? null,
        previousRank: previousRanks?.get(aggregate.uid) ?? null,
        lastFinalizedWeekId: latestWeekId,
        standingsEpoch,
        updatedAt: FieldValue.serverTimestamp(),
        calculationVersion: 1,
      },
    };
  });
  const currentStandingUids = new Set(values.map((aggregate) => aggregate.uid));
  const standingOperations: Array<
    | {
      kind: "set";
      reference: FirebaseFirestore.DocumentReference;
      data: DocumentData;
    }
    | {
      kind: "delete";
      reference: FirebaseFirestore.DocumentReference;
    }
  > = [
    ...standingWrites.map((standing) => ({
      kind: "set" as const,
      reference: standing.reference,
      data: standing.data,
    })),
    ...existingSnapshot.docs
      .filter((standing) => !currentStandingUids.has(standing.id))
      .map((standing) => ({
        kind: "delete" as const,
        reference: standing.ref,
      })),
  ];
  await hooks.beforeCommit?.();
  for (let index = 0; index < standingOperations.length; index += 350) {
    const chunk = standingOperations.slice(index, index + 350);
    const committed = await db.runTransaction(async (transaction) => {
      const [currentLeague, guardedWeek] = await Promise.all([
        transaction.get(leagueReference),
        finalizationGuard === undefined
          ? Promise.resolve(null)
          : transaction.get(finalizationGuard.reference),
      ]);
      if (finalizationGuard !== undefined) {
        assertFinalizationFollowUpClaim(
          guardedWeek?.data(),
          finalizationGuard.claimId,
          finalizationGuard.resultVersion,
        );
      }
      if (
        Number(currentLeague.data()?.standingsEpoch ?? 0) !== standingsEpoch
      ) {
        return false;
      }
      for (const standing of chunk) {
        if (standing.kind === "set") {
          transaction.set(standing.reference, standing.data, {merge: false});
        } else {
          transaction.delete(standing.reference);
        }
      }
      if (finalizationGuard !== undefined) {
        transaction.update(finalizationGuard.reference, {
          finalizationFollowUpsHeartbeatAt: FieldValue.serverTimestamp(),
        });
      }
      return true;
    });
    if (!committed) return null;
  }

  const completed = await db.runTransaction(async (transaction) => {
    const [currentLeague, guardedWeek] = await Promise.all([
      transaction.get(leagueReference),
      finalizationGuard === undefined
        ? Promise.resolve(null)
        : transaction.get(finalizationGuard.reference),
    ]);
    if (finalizationGuard !== undefined) {
      assertFinalizationFollowUpClaim(
        guardedWeek?.data(),
        finalizationGuard.claimId,
        finalizationGuard.resultVersion,
      );
    }
    if (
      Number(currentLeague.data()?.standingsEpoch ?? 0) !== standingsEpoch
    ) {
      return false;
    }
    transaction.update(leagueReference, {
      standingsBuiltEpoch: standingsEpoch,
      standingsBuiltMemberCount: standingWrites.length,
      standingsBuiltAt: FieldValue.serverTimestamp(),
    });
    if (finalizationGuard !== undefined) {
      transaction.update(finalizationGuard.reference, {
        finalizationFollowUpsHeartbeatAt: FieldValue.serverTimestamp(),
      });
    }
    return true;
  });
  if (!completed) return null;
  return values;
}

const FINALIZATION_FOLLOW_UP_CLAIM_TTL_MS = 5 * 60_000;

export function finalizationFollowUpClaimIsActive(
  data: DocumentData,
  now = Date.now(),
): boolean {
  const heartbeat =
    data.finalizationFollowUpsHeartbeatAt instanceof Timestamp
      ? data.finalizationFollowUpsHeartbeatAt
      : data.finalizationFollowUpsStartedAt;
  return (
    typeof data.finalizationFollowUpsClaimId === "string" &&
    heartbeat instanceof Timestamp &&
    heartbeat.toMillis() > now - FINALIZATION_FOLLOW_UP_CLAIM_TTL_MS
  );
}

function assertFinalizationFollowUpClaim(
  data: DocumentData | undefined,
  claimId: string,
  resultVersion: number,
): asserts data is DocumentData {
  if (
    data?.status !== "finalized" ||
    data.finalizationFollowUpsClaimId !== claimId ||
    Number(data.resultVersion ?? 0) !== resultVersion
  ) {
    throw new HttpsError(
      "aborted",
      "Week state changed while finalization follow-ups completed.",
    );
  }
}

async function heartbeatFinalizationFollowUpClaim(
  reference: FirebaseFirestore.DocumentReference,
  claimId: string,
  resultVersion: number,
): Promise<void> {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    assertFinalizationFollowUpClaim(
      snapshot.data(),
      claimId,
      resultVersion,
    );
    transaction.update(reference, {
      finalizationFollowUpsHeartbeatAt: FieldValue.serverTimestamp(),
    });
  });
}

async function releaseFinalizationFollowUpClaim(
  reference: FirebaseFirestore.DocumentReference,
  claimId: string,
): Promise<void> {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (snapshot.data()?.finalizationFollowUpsClaimId !== claimId) return;
    transaction.update(reference, {
      finalizationFollowUpsRequestId: FieldValue.delete(),
      finalizationFollowUpsClaimId: FieldValue.delete(),
      finalizationFollowUpsStartedAt: FieldValue.delete(),
      finalizationFollowUpsHeartbeatAt: FieldValue.delete(),
    });
  });
}

type FinalizedWeekResponse = {
  winnerUids: string[];
  highScore: number | null;
  nextPickerUid: string | null;
};

function finalizedWeekResponse(
  data: DocumentData,
  nextPickerUid: string | null,
): FinalizedWeekResponse {
  return {
    winnerUids: Array.isArray(data.winnerUids)
      ? data.winnerUids.filter(
          (uid: unknown): uid is string => typeof uid === "string",
        )
      : [],
    highScore:
      typeof data.highScore === "number" ? data.highScore : null,
    nextPickerUid,
  };
}

type FinalizationFollowUpTestHooks = {
  afterClaim?: (claimId: string) => Promise<void>;
  beforeStandingsCommit?: (claimId: string) => Promise<void>;
};

export async function repairFinalizedWeekFollowUps(input: {
  leagueId: string;
  weekId: string;
  requestId: string;
  actorUid: string;
}, hooks: FinalizationFollowUpTestHooks = {}): Promise<FinalizedWeekResponse> {
  const leagueReference = db.collection("leagues").doc(input.leagueId);
  const weekReference = leagueReference
    .collection("weeks")
    .doc(input.weekId);
  const claimId = randomUUID();
  const claim = await db.runTransaction(async (transaction) => {
    const [snapshot, leagueSnapshot] = await Promise.all([
      transaction.get(weekReference),
      transaction.get(leagueReference),
    ]);
    const data = snapshot.data();
    if (data === undefined) {
      throw new HttpsError("not-found", "Week not found.");
    }
    const league = leagueSnapshot.data();
    if (league === undefined) {
      throw new HttpsError("not-found", "Arena not found.");
    }
    if (data.status !== "finalized") {
      throw new HttpsError(
        "failed-precondition",
        "Finalization follow-ups can only repair a finalized week.",
      );
    }
    const resultVersion = Number(data.resultVersion ?? 0);
    if (
      data.finalizationFollowUpsCompletedAt instanceof Timestamp &&
      data.finalizationFollowUpsResultVersion === resultVersion
    ) {
      return {claimed: false as const, data, resultVersion};
    }
    if (finalizationFollowUpClaimIsActive(data)) {
      throw new HttpsError(
        "aborted",
        "Finalization follow-ups are already running.",
      );
    }
    transaction.update(weekReference, {
      finalizationFollowUpsRequestId: input.requestId,
      finalizationFollowUpsClaimId: claimId,
      finalizationFollowUpsStartedAt: FieldValue.serverTimestamp(),
      finalizationFollowUpsHeartbeatAt: FieldValue.serverTimestamp(),
    });
    // A freshly finalized week already dirtied the standings generation in
    // its status transaction. Legacy/incomplete repairs can arrive with the
    // published and current epochs still equal, so reserve a new generation
    // atomically with the repair claim only in that case. A failed retry then
    // inherits the outstanding generation instead of incrementing it again.
    if (
      Number(league.standingsBuiltEpoch ?? 0) ===
      Number(league.standingsEpoch ?? 0)
    ) {
      transaction.update(leagueReference, {
        standingsEpoch: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return {claimed: true as const, data, resultVersion};
  });

  if (!claim.claimed) {
    const nextPickerUid = await advanceRotationOnce(
      input.leagueId,
      input.weekId,
    );
    return finalizedWeekResponse(claim.data, nextPickerUid);
  }

  const finalizedOutcome = finalizedWeekResponse(claim.data, null);
  const {winnerUids, highScore} = finalizedOutcome;
  const finalizedRequestId =
    typeof claim.data.finalizedRequestId === "string"
      ? claim.data.finalizedRequestId
      : input.requestId;
  const finalizedBy =
    typeof claim.data.finalizedBy === "string"
      ? claim.data.finalizedBy
      : input.actorUid;

  try {
    await hooks.afterClaim?.(claimId);
    // These operations are deliberately ordered and individually idempotent.
    // The completion marker is written last, so retrying repairs an interrupted
    // audit, standings rebuild, or rotation without ever re-finalizing a reopen.
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(weekReference);
      assertFinalizationFollowUpClaim(
        current.data(),
        claimId,
        claim.resultVersion,
      );
      transaction.update(weekReference, {
        finalizationFollowUpsHeartbeatAt: FieldValue.serverTimestamp(),
      });
      writeAuditInTransaction(transaction, {
        leagueId: input.leagueId,
        eventType: "week_finalized",
        actorUid: finalizedBy,
        target: `weeks/${input.weekId}`,
        requestId: finalizedRequestId,
        after: {winnerUids, highScore},
      });
    });
    await heartbeatFinalizationFollowUpClaim(
      weekReference,
      claimId,
      claim.resultVersion,
    );
    await rebuildLeagueStandings(
      input.leagueId,
      {
        reference: weekReference,
        claimId,
        resultVersion: claim.resultVersion,
      },
      {
        beforeCommit: async () => {
          await hooks.beforeStandingsCommit?.(claimId);
        },
      },
    );
    await heartbeatFinalizationFollowUpClaim(
      weekReference,
      claimId,
      claim.resultVersion,
    );
    const nextPickerUid = await advanceRotationOnce(
      input.leagueId,
      input.weekId,
    );
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(weekReference);
      assertFinalizationFollowUpClaim(
        current.data(),
        claimId,
        claim.resultVersion,
      );
      transaction.update(weekReference, {
        finalizationFollowUpsCompletedAt: FieldValue.serverTimestamp(),
        finalizationFollowUpsResultVersion: claim.resultVersion,
        finalizationFollowUpsRequestId: FieldValue.delete(),
        finalizationFollowUpsClaimId: FieldValue.delete(),
        finalizationFollowUpsStartedAt: FieldValue.delete(),
        finalizationFollowUpsHeartbeatAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return {winnerUids, highScore, nextPickerUid};
  } finally {
    await releaseFinalizationFollowUpClaim(weekReference, claimId);
  }
}

export async function finalizeWeekAuthoritatively(input: {
  leagueId: string;
  weekId: string;
  actorUid: string;
  requestId: string;
}): Promise<{
  winnerUids: string[];
  highScore: number | null;
  nextPickerUid: string | null;
}> {
  const leagueReference = db.collection("leagues").doc(input.leagueId);
  const weekReference = leagueReference
    .collection("weeks")
    .doc(input.weekId);
  const initialWeek = await weekReference.get();
  const initialData = initialWeek.data();
  if (initialData === undefined) {
    throw new HttpsError("not-found", "Week not found.");
  }
  if (initialData.status === "finalized") {
    return repairFinalizedWeekFollowUps(input);
  }

  const claim = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(weekReference);
    const data = snapshot.data();
    if (data === undefined) {
      throw new HttpsError("not-found", "Week not found.");
    }
    if (data.status === "finalized") {
      return {
        claimed: false,
        gameResultsVersion: Number(data.gameResultsVersion ?? 0),
      };
    }
    if (
      !["open", "inProgress", "review", "reopened"].includes(
        String(data.status),
      )
    ) {
      throw new HttpsError(
        "failed-precondition",
        "This week cannot be finalized from its current state.",
      );
    }
    const existingRequest = data.finalizationRequestId;
    const startedAt = data.finalizationStartedAt;
    const activeClaim =
      startedAt instanceof Timestamp &&
      startedAt.toMillis() > Date.now() - 5 * 60_000;
    if (
      typeof existingRequest === "string" &&
      existingRequest !== input.requestId &&
      activeClaim
    ) {
      throw new HttpsError(
        "aborted",
        "This week is already being finalized.",
      );
    }
    const resultMutationStartedAt =
      data.resultMutationHeartbeatAt instanceof Timestamp
        ? data.resultMutationHeartbeatAt
        : data.resultMutationStartedAt;
    const activeResultMutation =
      typeof data.resultMutationRequestId === "string" &&
      resultMutationStartedAt instanceof Timestamp &&
      resultMutationStartedAt.toMillis() > Date.now() - 5 * 60_000;
    if (activeResultMutation) {
      throw new HttpsError(
        "aborted",
        "Game results are currently being updated.",
      );
    }
    transaction.update(weekReference, {
      finalizationRequestId: input.requestId,
      finalizationStartedAt: FieldValue.serverTimestamp(),
      resultMutationRequestId: FieldValue.delete(),
      resultMutationClaimId: FieldValue.delete(),
      resultMutationStartedAt: FieldValue.delete(),
      resultMutationHeartbeatAt: FieldValue.delete(),
    });
    return {
      claimed: true,
      gameResultsVersion: Number(data.gameResultsVersion ?? 0),
    };
  });

  if (!claim.claimed) {
    return repairFinalizedWeekFollowUps(input);
  }

  let result: Awaited<ReturnType<typeof gradeWeek>>;
  try {
    const games = await weekReference.collection("games").get();
    const claimedGameResultVersions = games.docs.map((game) => ({
      id: game.id,
      resultVersion: String(game.data().resultVersion ?? "unversioned"),
    }));
    if (
      games.empty ||
      games.docs.some((game) =>
        !["final", "void"].includes(String(game.data().status)),
      )
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Every selected game must be final or void before finalization.",
      );
    }
    const now = Date.now();
    if (
      games.docs.some((game) => {
        const lockAt = game.data().effectiveLockAtUtc;
        return !(lockAt instanceof Timestamp) || lockAt.toMillis() > now;
      })
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Every selected game must be locked before finalization.",
      );
    }
    if (
      games.docs.some(
        (game) => !(game.data().pickRevealCompletedAt instanceof Timestamp),
      )
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Reveal locked picks before finalizing the week.",
      );
    }
    result = await gradeWeek(input.leagueId, input.weekId);
    await db.runTransaction(async (transaction) => {
      const [snapshot, currentGames] = await Promise.all([
        transaction.get(weekReference),
        transaction.get(weekReference.collection("games")),
      ]);
      const data = snapshot.data();
      if (
        data?.status === "finalized" &&
        data.finalizedRequestId === input.requestId
      ) {
        return;
      }
      if (
        data === undefined ||
        data.finalizationRequestId !== input.requestId ||
        !["open", "inProgress", "review", "reopened"].includes(
          String(data.status),
        )
      ) {
        throw new HttpsError(
          "aborted",
          "Week state changed during finalization.",
        );
      }
      const stableGameResultVersions = gameResultVersionsAreStable(
        claimedGameResultVersions,
        currentGames.docs.map((game) => ({
          id: game.id,
          resultVersion: String(game.data().resultVersion ?? "unversioned"),
        })),
      );
      if (
        typeof data.resultMutationRequestId === "string" ||
        typeof data.resultMutationClaimId === "string" ||
        Number(data.gameResultsVersion ?? 0) !== claim.gameResultsVersion ||
        !stableGameResultVersions
      ) {
        throw new HttpsError(
          "aborted",
          "Game results changed during finalization.",
        );
      }
      transaction.update(weekReference, {
        status: "finalized",
        finalizedAt: FieldValue.serverTimestamp(),
        finalizedBy: input.actorUid,
        finalizedRequestId: input.requestId,
        finalizationRequestId: FieldValue.delete(),
        finalizationStartedAt: FieldValue.delete(),
        finalizationFollowUpsCompletedAt: FieldValue.delete(),
        finalizationFollowUpsResultVersion: FieldValue.delete(),
        finalizationFollowUpsRequestId: FieldValue.delete(),
        finalizationFollowUpsClaimId: FieldValue.delete(),
        finalizationFollowUpsStartedAt: FieldValue.delete(),
        finalizationFollowUpsHeartbeatAt: FieldValue.delete(),
        winnerUids: result.winnerUids,
        highScore: result.highScore,
        resultVersion: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(leagueReference, {
        standingsEpoch: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (error: unknown) {
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(weekReference);
      if (snapshot.data()?.finalizationRequestId === input.requestId) {
        transaction.update(weekReference, {
          finalizationRequestId: FieldValue.delete(),
          finalizationStartedAt: FieldValue.delete(),
        });
      }
    });
    throw error;
  }

  return repairFinalizedWeekFollowUps(input);
}

export async function advanceRotationOnce(
  leagueId: string,
  finalizedWeekId: string,
): Promise<string | null> {
  const leagueReference = db.collection("leagues").doc(leagueId);
  const activeMembersQuery = leagueReference
    .collection("members")
    .where("status", "==", "active");

  return db.runTransaction(async (transaction) => {
    const finalizedWeekReference = leagueReference
      .collection("weeks")
      .doc(finalizedWeekId);
    const [leagueSnapshot, finalizedWeek, members] = await Promise.all([
      transaction.get(leagueReference),
      transaction.get(finalizedWeekReference),
      transaction.get(activeMembersQuery),
    ]);
    const league = leagueSnapshot.data();
    if (league === undefined) {
      throw new HttpsError("not-found", "Arena not found.");
    }
    const finalizedWeekData = finalizedWeek.data();
    if (finalizedWeekData === undefined) {
      throw new HttpsError("not-found", "Finalized week not found.");
    }
    if (finalizedWeekData.status !== "finalized") {
      throw new HttpsError(
        "failed-precondition",
        "Rotation can only advance from a finalized week.",
      );
    }
    const ordered = members.docs
      .map((member) => {
        const rawOrder = Number(member.data().rotationOrder ?? 0);
        return {
          uid: member.id,
          rotationOrder: Number.isFinite(rawOrder) ? rawOrder : 0,
        };
      })
      .sort((left, right) =>
        left.rotationOrder === right.rotationOrder
          ? left.uid.localeCompare(right.uid)
          : left.rotationOrder - right.rotationOrder,
      );
    if (ordered.length === 0) return null;

    const rotationAlreadyAdvanced =
      finalizedWeekData.rotationAdvancedAt instanceof Timestamp;
    const storedNextPickerUid =
      typeof finalizedWeekData.nextPickerUid === "string"
        ? finalizedWeekData.nextPickerUid
        : null;
    const isCurrentFinalizedWeek = league.currentWeekId === finalizedWeekId;
    if (
      rotationAlreadyAdvanced &&
      (
        !isCurrentFinalizedWeek ||
        (
          storedNextPickerUid !== null &&
          ordered.some((member) => member.uid === storedNextPickerUid)
        )
      )
    ) {
      return storedNextPickerUid;
    }
    // Once a later week exists, this finalized week's next-picker value is a
    // historical snapshot. A retry may repair its standings/audit marker, but
    // must never rewrite the current week's picker context.
    if (!isCurrentFinalizedWeek) return storedNextPickerUid;

    const weekPickerUid =
      typeof finalizedWeekData.pickerUid === "string"
        ? finalizedWeekData.pickerUid
        : ordered[0]?.uid;
    const currentIndex = ordered.findIndex(
      (item) => item.uid === weekPickerUid,
    );
    let nextIndex = currentIndex < 0
      ? 0
      : (currentIndex + 1) % ordered.length;

    // Backfill the per-week idempotency marker for a week advanced by an older
    // deployment that only recorded the latest week on the league document.
    if (
      !rotationAlreadyAdvanced &&
      league.rotationAdvancedForWeekId === finalizedWeekId
    ) {
      const legacyNextPickerUid =
        typeof league.currentPickerUid === "string"
          ? league.currentPickerUid
          : null;
      const legacyNextIndex = ordered.findIndex(
        (member) => member.uid === legacyNextPickerUid,
      );
      if (legacyNextIndex >= 0) nextIndex = legacyNextIndex;
    }
    const nextPickerUid = ordered[nextIndex]?.uid ?? null;
    transaction.update(leagueReference, {
      currentPickerUid: nextPickerUid,
      rotationCursor: nextIndex,
      rotationAdvancedForWeekId: finalizedWeekId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(
      finalizedWeekReference,
      {
        ...(rotationAlreadyAdvanced
          ? {rotationRepairedAt: FieldValue.serverTimestamp()}
          : {rotationAdvancedAt: FieldValue.serverTimestamp()}),
        nextPickerUid,
      },
      {merge: true},
    );
    return nextPickerUid;
  });
}
