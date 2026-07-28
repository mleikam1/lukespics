enum PickOutcome { pending, correct, incorrect, voided }

final class Pick {
  const Pick({
    required this.gameId,
    required this.selectedTeamId,
    required this.selectedAt,
    required this.updatedAt,
    required this.lockAtSnapshot,
    this.serverConfirmedAt,
    this.lockedAt,
    this.outcome = PickOutcome.pending,
    this.points = 0,
    this.outcomeVersion = 0,
  });

  final String gameId;
  final String selectedTeamId;
  final DateTime selectedAt;
  final DateTime updatedAt;
  final DateTime? serverConfirmedAt;
  final DateTime lockAtSnapshot;
  final DateTime? lockedAt;
  final PickOutcome outcome;
  final int points;
  final int outcomeVersion;

  Pick graded({required PickOutcome nextOutcome, required int resultVersion}) =>
      Pick(
        gameId: gameId,
        selectedTeamId: selectedTeamId,
        selectedAt: selectedAt,
        updatedAt: updatedAt,
        serverConfirmedAt: serverConfirmedAt,
        lockAtSnapshot: lockAtSnapshot,
        lockedAt: lockedAt,
        outcome: nextOutcome,
        points: nextOutcome == PickOutcome.correct ? 1 : 0,
        outcomeVersion: resultVersion,
      );
}
