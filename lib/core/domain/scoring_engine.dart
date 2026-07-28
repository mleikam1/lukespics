import '../../data/models/game.dart';
import '../../data/models/pick.dart';
import '../../data/models/standing.dart';
import '../../data/models/week.dart';

final class ScoringEngine {
  const ScoringEngine();

  WeekScore scoreWeek(LeagueWeek week, Iterable<WeekEntryInput> entryInputs) {
    final complete = week.games.every(
      (game) =>
          game.status == GameStatus.finalStatus ||
          game.status == GameStatus.voided ||
          game.status == GameStatus.cancelled,
    );

    final rawResults = entryInputs.map((entry) {
      final eligible = entry.eligible && week.isEligible(entry.uid);
      if (!eligible) {
        return WeekEntryResult(
          uid: entry.uid,
          displayName: entry.displayName,
          eligible: false,
          ineligibilityReason:
              entry.ineligibilityReason ??
              (entry.uid == week.pickerUid
                  ? 'Weekly picker does not participate'
                  : 'Not eligible for this week'),
          gradedCount: 0,
          correctCount: 0,
          incorrectCount: 0,
          voidCount: 0,
          points: 0,
          gradedPicks: const {},
        );
      }

      var correct = 0;
      var incorrect = 0;
      var voided = 0;
      final graded = <String, Pick>{};

      for (final game in week.games) {
        final pick = entry.picks[game.id];
        if (game.isVoid) {
          voided += 1;
          if (pick != null) {
            graded[game.id] = pick.graded(
              nextOutcome: PickOutcome.voided,
              resultVersion: game.resultVersion,
            );
          }
          continue;
        }

        if (game.status != GameStatus.finalStatus ||
            game.winnerTeamId == null) {
          continue;
        }

        if (pick?.selectedTeamId == game.winnerTeamId) {
          correct += 1;
          graded[game.id] = pick!.graded(
            nextOutcome: PickOutcome.correct,
            resultVersion: game.resultVersion,
          );
        } else {
          incorrect += 1;
          if (pick != null) {
            graded[game.id] = pick.graded(
              nextOutcome: PickOutcome.incorrect,
              resultVersion: game.resultVersion,
            );
          }
        }
      }

      return WeekEntryResult(
        uid: entry.uid,
        displayName: entry.displayName,
        eligible: true,
        gradedCount: correct + incorrect,
        correctCount: correct,
        incorrectCount: incorrect,
        voidCount: voided,
        points: correct,
        gradedPicks: graded,
      );
    }).toList();

    final eligible = rawResults.where((entry) => entry.eligible).toList()
      ..sort((a, b) => b.points.compareTo(a.points));
    final highScore = eligible.isEmpty ? null : eligible.first.points;
    final winnerUids = highScore == null
        ? <String>[]
        : eligible
              .where((entry) => entry.points == highScore)
              .map((entry) => entry.uid)
              .toList();

    var previousScore = -1;
    var currentRank = 0;
    final rankedByUid = <String, WeekEntryResult>{};
    for (var index = 0; index < eligible.length; index += 1) {
      final entry = eligible[index];
      if (entry.points != previousScore) {
        currentRank = index + 1;
        previousScore = entry.points;
      }
      rankedByUid[entry.uid] = entry.copyWith(
        weeklyRank: currentRank,
        isWeeklyWinner: winnerUids.contains(entry.uid),
      );
    }

    return WeekScore(
      weekId: week.id,
      resultVersion: week.resultVersion,
      entries: rawResults
          .map((entry) => rankedByUid[entry.uid] ?? entry)
          .toList(),
      winnerUids: winnerUids,
      highScore: highScore,
      complete: complete,
    );
  }

  /// Rebuilds aggregate standings from complete finalized-week snapshots.
  /// Calling it repeatedly with the same inputs always returns the same values.
  List<Standing> rebuildStandings(
    Iterable<WeekScore> finalizedWeeks, {
    required Map<String, String> displayNames,
    Map<String, int> pickerWeekCounts = const {},
  }) {
    final totals = <String, _StandingAccumulator>{};
    for (final week in finalizedWeeks) {
      for (final entry in week.entries.where((entry) => entry.eligible)) {
        final total = totals.putIfAbsent(
          entry.uid,
          () => _StandingAccumulator(entry.uid, entry.displayName),
        );
        total
          ..points += entry.points
          ..correct += entry.correctCount
          ..incorrect += entry.incorrectCount
          ..voided += entry.voidCount
          ..graded += entry.gradedCount
          ..eligibleWeeks += 1
          ..bestWeek = entry.points > total.bestWeek
              ? entry.points
              : total.bestWeek;
        if (entry.isWeeklyWinner) total.weeklyTitles += 1;
      }
    }

    for (final item in displayNames.entries) {
      totals.putIfAbsent(
        item.key,
        () => _StandingAccumulator(item.key, item.value),
      );
    }

    final sorted = totals.values.toList()
      ..sort((a, b) {
        final points = b.points.compareTo(a.points);
        if (points != 0) return points;
        final accuracy = b.accuracy.compareTo(a.accuracy);
        if (accuracy != 0) return accuracy;
        return b.weeklyTitles.compareTo(a.weeklyTitles);
      });

    var previousMetrics = '';
    var rank = 0;
    return [
      for (var index = 0; index < sorted.length; index += 1)
        (() {
          final item = sorted[index];
          final metrics =
              '${item.points}:${item.correct}:${item.graded}:${item.weeklyTitles}';
          if (metrics != previousMetrics) {
            rank = index + 1;
            previousMetrics = metrics;
          }
          return Standing(
            uid: item.uid,
            displayName: displayNames[item.uid] ?? item.displayName,
            totalPoints: item.points,
            totalCorrect: item.correct,
            totalIncorrect: item.incorrect,
            totalVoid: item.voided,
            totalGraded: item.graded,
            eligibleWeeks: item.eligibleWeeks,
            pickerWeeks: pickerWeekCounts[item.uid] ?? 0,
            weeklyTitles: item.weeklyTitles,
            bestWeekPoints: item.bestWeek,
            currentRank: rank,
          );
        })(),
    ];
  }
}

final class _StandingAccumulator {
  _StandingAccumulator(this.uid, this.displayName);

  final String uid;
  final String displayName;
  int points = 0;
  int correct = 0;
  int incorrect = 0;
  int voided = 0;
  int graded = 0;
  int eligibleWeeks = 0;
  int weeklyTitles = 0;
  int bestWeek = 0;

  double get accuracy => graded == 0 ? -1 : correct / graded;
}
