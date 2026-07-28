final class Standing {
  const Standing({
    required this.uid,
    required this.displayName,
    required this.totalPoints,
    required this.totalCorrect,
    required this.totalIncorrect,
    required this.totalVoid,
    required this.totalGraded,
    required this.eligibleWeeks,
    required this.pickerWeeks,
    required this.weeklyTitles,
    required this.bestWeekPoints,
    required this.currentRank,
  });

  final String uid;
  final String displayName;
  final int totalPoints;
  final int totalCorrect;
  final int totalIncorrect;
  final int totalVoid;
  final int totalGraded;
  final int eligibleWeeks;
  final int pickerWeeks;
  final int weeklyTitles;
  final int bestWeekPoints;
  final int currentRank;

  double? get overallAccuracy =>
      totalGraded == 0 ? null : totalCorrect / totalGraded;
}
