import 'game.dart';
import 'pick.dart';

enum WeekStatus { draft, open, inProgress, review, finalized, reopened }

final class LeagueWeek {
  const LeagueWeek({
    required this.id,
    required this.sequentialNumber,
    required this.label,
    required this.startAt,
    required this.endAt,
    required this.pickerUid,
    required this.pickerDisplayNameSnapshot,
    required this.status,
    required this.pickerParticipatesSnapshot,
    required this.lockPolicySnapshot,
    required this.games,
    required this.eligibleMemberUids,
    this.publishedAt,
    this.finalizedAt,
    this.winnerUids = const [],
    this.highScore,
    this.resultVersion = 0,
  });

  final String id;
  final int sequentialNumber;
  final String label;
  final DateTime startAt;
  final DateTime endAt;
  final String pickerUid;
  final String pickerDisplayNameSnapshot;
  final WeekStatus status;
  final bool pickerParticipatesSnapshot;
  final PickLockPolicy lockPolicySnapshot;
  final List<Game> games;
  final Set<String> eligibleMemberUids;
  final DateTime? publishedAt;
  final DateTime? finalizedAt;
  final List<String> winnerUids;
  final int? highScore;
  final int resultVersion;

  DateTime? get firstGameLockAt {
    if (games.isEmpty) return null;
    final locks = games
        .map((game) => game.effectiveLockAtUtc)
        .whereType<DateTime>()
        .toList(growable: false);
    if (locks.length != games.length) return null;
    return locks.reduce((a, b) => a.isBefore(b) ? a : b);
  }

  bool isEligible(String uid) {
    if (uid == pickerUid && !pickerParticipatesSnapshot) return false;
    return eligibleMemberUids.contains(uid);
  }
}

final class WeekEntryInput {
  const WeekEntryInput({
    required this.uid,
    required this.displayName,
    required this.eligible,
    required this.picks,
    this.ineligibilityReason,
  });

  final String uid;
  final String displayName;
  final bool eligible;
  final String? ineligibilityReason;
  final Map<String, Pick> picks;
}

final class WeekEntryResult {
  const WeekEntryResult({
    required this.uid,
    required this.displayName,
    required this.eligible,
    required this.gradedCount,
    required this.correctCount,
    required this.incorrectCount,
    required this.voidCount,
    required this.points,
    required this.gradedPicks,
    this.ineligibilityReason,
    this.weeklyRank,
    this.isWeeklyWinner = false,
  });

  final String uid;
  final String displayName;
  final bool eligible;
  final String? ineligibilityReason;
  final int gradedCount;
  final int correctCount;
  final int incorrectCount;
  final int voidCount;
  final int points;
  final Map<String, Pick> gradedPicks;
  final int? weeklyRank;
  final bool isWeeklyWinner;

  double? get accuracy => gradedCount == 0 ? null : correctCount / gradedCount;

  WeekEntryResult copyWith({int? weeklyRank, bool? isWeeklyWinner}) =>
      WeekEntryResult(
        uid: uid,
        displayName: displayName,
        eligible: eligible,
        ineligibilityReason: ineligibilityReason,
        gradedCount: gradedCount,
        correctCount: correctCount,
        incorrectCount: incorrectCount,
        voidCount: voidCount,
        points: points,
        gradedPicks: gradedPicks,
        weeklyRank: weeklyRank ?? this.weeklyRank,
        isWeeklyWinner: isWeeklyWinner ?? this.isWeeklyWinner,
      );
}

final class WeekScore {
  const WeekScore({
    required this.weekId,
    required this.resultVersion,
    required this.entries,
    required this.winnerUids,
    required this.highScore,
    required this.complete,
  });

  final String weekId;
  final int resultVersion;
  final List<WeekEntryResult> entries;
  final List<String> winnerUids;
  final int? highScore;
  final bool complete;
}
