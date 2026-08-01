import '../../data/models/game.dart';

/// Returns the provider's useful event and status context without repeating
/// the status pill's generic label (for example, `Final · Final`).
String? gameDetailSummary(Game game) {
  final details = <String>[];
  final seen = <String>{};
  final genericStatus = _gameStatusLabel(game.status).toLowerCase();

  void add(String? value, {bool omitGenericStatus = false}) {
    final normalized = value?.trim();
    if (normalized == null || normalized.isEmpty) return;
    final comparison = normalized.toLowerCase();
    if (omitGenericStatus && comparison == genericStatus) return;
    if (seen.add(comparison)) details.add(normalized);
  }

  add(game.eventDetail);
  add(game.statusDetail, omitGenericStatus: true);
  return details.isEmpty ? null : details.join(' · ');
}

String? gameBroadcastSummary(Game game) {
  final broadcast = game.broadcast?.trim();
  return broadcast == null || broadcast.isEmpty ? null : broadcast;
}

String _gameStatusLabel(GameStatus status) => switch (status) {
  GameStatus.scheduled => 'Scheduled',
  GameStatus.delayed => 'Delayed',
  GameStatus.live => 'Live',
  GameStatus.finalStatus => 'Final',
  GameStatus.postponed => 'Postponed',
  GameStatus.suspended => 'Suspended',
  GameStatus.cancelled => 'Cancelled',
  GameStatus.voided => 'Void',
  GameStatus.reviewRequired => 'Review needed',
};
