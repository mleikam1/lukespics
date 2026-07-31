import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {writeAudit} from "../audit.js";
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

export async function rebuildLeagueStandings(
  leagueId: string,
): Promise<StandingAggregate[]> {
  const leagueReference = db.collection("leagues").doc(leagueId);
  const [weeksSnapshot, membersSnapshot, existingSnapshot] = await Promise.all([
    leagueReference.collection("weeks").where("status", "==", "finalized").get(),
    leagueReference.collection("members").get(),
    leagueReference.collection("standings").get(),
  ]);
  const aggregates = new Map<string, StandingAggregate>();
  for (const member of membersSnapshot.docs) {
    aggregates.set(member.id, emptyAggregate(member.id));
  }

  let latestWeekId: string | null = null;
  let latestFinalizedAt = 0;
  for (const week of weeksSnapshot.docs) {
    const entries = await week.ref.collection("entries").get();
    for (const entry of entries.docs) {
      const aggregate =
        aggregates.get(entry.id) ?? emptyAggregate(entry.id);
      aggregateEntry(aggregate, entry.data(), week.data());
      aggregates.set(entry.id, aggregate);
    }
    const finalizedAt = week.data().finalizedAt;
    const millis =
      finalizedAt instanceof Timestamp ? finalizedAt.toMillis() : 0;
    if (millis >= latestFinalizedAt) {
      latestFinalizedAt = millis;
      latestWeekId = week.id;
    }
  }

  for (const aggregate of aggregates.values()) {
    aggregate.overallAccuracy =
      aggregate.totalGraded === 0
        ? null
        : aggregate.totalCorrect / aggregate.totalGraded;
  }
  const values = [...aggregates.values()];
  const ranks = standingsRank(values);
  const oldRanks = new Map(
    existingSnapshot.docs.map((standing) => [
      standing.id,
      {
        currentRank:
          typeof standing.data().currentRank === "number"
            ? standing.data().currentRank as number
            : null,
        previousRank:
          typeof standing.data().previousRank === "number"
            ? standing.data().previousRank as number
            : null,
        lastFinalizedWeekId:
          typeof standing.data().lastFinalizedWeekId === "string"
            ? standing.data().lastFinalizedWeekId as string
            : null,
      },
    ]),
  );
  await commitWritesInChunks(db, values, (batch, aggregate) => {
    const previous = oldRanks.get(aggregate.uid);
    batch.set(
      leagueReference.collection("standings").doc(aggregate.uid),
      {
        ...aggregate,
        currentRank: ranks.get(aggregate.uid) ?? null,
        previousRank:
          previous?.lastFinalizedWeekId === latestWeekId
            ? previous.previousRank
            : previous?.currentRank ?? null,
        lastFinalizedWeekId: latestWeekId,
        updatedAt: FieldValue.serverTimestamp(),
        calculationVersion: 1,
      },
      {merge: false},
    );
  });
  return values;
}

async function completeFinalizationFollowUps(input: {
  leagueId: string;
  weekId: string;
  requestId: string;
  actorUid: string;
  data: DocumentData;
}): Promise<string | null> {
  if (input.data.status !== "finalized") {
    throw new HttpsError(
      "aborted",
      "Week state changed before finalization completed.",
    );
  }
  const resultVersion =
    typeof input.data.resultVersion === "number"
      ? input.data.resultVersion
      : 0;
  if (
    input.data.finalizationFollowUpsCompletedAt instanceof Timestamp &&
    input.data.finalizationFollowUpsResultVersion === resultVersion
  ) {
    return typeof input.data.nextPickerUid === "string"
      ? input.data.nextPickerUid
      : null;
  }

  const winnerUids = Array.isArray(input.data.winnerUids)
    ? input.data.winnerUids.filter(
        (uid: unknown): uid is string => typeof uid === "string",
      )
    : [];
  const highScore =
    typeof input.data.highScore === "number" ? input.data.highScore : null;
  const finalizedRequestId =
    typeof input.data.finalizedRequestId === "string"
      ? input.data.finalizedRequestId
      : input.requestId;
  const finalizedBy =
    typeof input.data.finalizedBy === "string"
      ? input.data.finalizedBy
      : input.actorUid;

  // These operations are deliberately ordered and individually idempotent.
  // The completion marker is written last, so retrying a finalized week repairs
  // any audit, standings, or rotation side effect interrupted by a prior run.
  await writeAudit({
    leagueId: input.leagueId,
    eventType: "week_finalized",
    actorUid: finalizedBy,
    target: `weeks/${input.weekId}`,
    requestId: finalizedRequestId,
    after: {winnerUids, highScore},
  });
  await rebuildLeagueStandings(input.leagueId);
  const nextPickerUid = await advanceRotationOnce(
    input.leagueId,
    input.weekId,
  );
  const weekReference = db
    .collection("leagues")
    .doc(input.leagueId)
    .collection("weeks")
    .doc(input.weekId);
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(weekReference);
    const data = current.data();
    if (
      data?.status !== "finalized" ||
      data.resultVersion !== resultVersion
    ) {
      throw new HttpsError(
        "aborted",
        "Week state changed while finalization follow-ups completed.",
      );
    }
    transaction.update(weekReference, {
      finalizationFollowUpsCompletedAt: FieldValue.serverTimestamp(),
      finalizationFollowUpsResultVersion: resultVersion,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return nextPickerUid;
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
  const weekReference = db
    .collection("leagues")
    .doc(input.leagueId)
    .collection("weeks")
    .doc(input.weekId);
  const finalizedResponse = async (
    data: DocumentData,
  ): Promise<{
    winnerUids: string[];
    highScore: number | null;
    nextPickerUid: string | null;
  }> => {
    const nextPickerUid = await completeFinalizationFollowUps({
      ...input,
      data,
    });
    return {
      winnerUids: Array.isArray(data.winnerUids)
        ? data.winnerUids.filter(
            (uid: unknown): uid is string => typeof uid === "string",
          )
        : [],
      highScore:
        typeof data.highScore === "number"
          ? data.highScore
          : null,
      nextPickerUid,
    };
  };
  const initialWeek = await weekReference.get();
  const initialData = initialWeek.data();
  if (initialData === undefined) {
    throw new HttpsError("not-found", "Week not found.");
  }
  if (initialData.status === "finalized") {
    return finalizedResponse(initialData);
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
    const finalizedWeek = await weekReference.get();
    return finalizedResponse(finalizedWeek.data() ?? {});
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
        winnerUids: result.winnerUids,
        highScore: result.highScore,
        resultVersion: FieldValue.increment(1),
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

  const finalizedWeek = await weekReference.get();
  return finalizedResponse(finalizedWeek.data() ?? {});
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
    const ordered = members.docs
      .map((member) => ({
        uid: member.id,
        rotationOrder: Number(member.data().rotationOrder ?? 0),
      }))
      .sort((left, right) => left.rotationOrder - right.rotationOrder);
    if (ordered.length === 0) return null;
    const league = leagueSnapshot.data();
    if (league === undefined) {
      throw new HttpsError("not-found", "Arena not found.");
    }
    const finalizedWeekData = finalizedWeek.data();
    if (finalizedWeekData === undefined) {
      throw new HttpsError("not-found", "Finalized week not found.");
    }
    if (finalizedWeekData.rotationAdvancedAt instanceof Timestamp) {
      return typeof finalizedWeekData.nextPickerUid === "string"
        ? finalizedWeekData.nextPickerUid
        : null;
    }

    // Backfill the per-week idempotency marker for a week advanced by an older
    // deployment that only recorded the latest week on the league document.
    if (league.rotationAdvancedForWeekId === finalizedWeekId) {
      const existingNextPickerUid =
        typeof league.currentPickerUid === "string"
        ? league.currentPickerUid
        : null;
      transaction.set(
        finalizedWeekReference,
        {
          rotationAdvancedAt: FieldValue.serverTimestamp(),
          nextPickerUid: existingNextPickerUid,
        },
        {merge: true},
      );
      return existingNextPickerUid;
    }
    const weekPickerUid = finalizedWeekData.pickerUid;
    const currentUid =
      typeof weekPickerUid === "string" ? weekPickerUid : ordered[0]?.uid;
    const currentIndex = ordered.findIndex((item) => item.uid === currentUid);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % ordered.length;
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
        rotationAdvancedAt: FieldValue.serverTimestamp(),
        nextPickerUid,
      },
      {merge: true},
    );
    return nextPickerUid;
  });
}
