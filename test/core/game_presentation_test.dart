import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/core/domain/game_presentation.dart';
import 'package:lukespics/data/models/game.dart';

void main() {
  test('combines event and provider status details in display order', () {
    final game = _game(
      eventDetail: '  Doubleheader · Game 2 ',
      statusDetail: ' First pitch delayed ',
      broadcast: ' ESPN+ ',
    );

    expect(
      gameDetailSummary(game),
      'Doubleheader · Game 2 · First pitch delayed',
    );
    expect(gameBroadcastSummary(game), 'ESPN+');
  });

  test('omits empty, duplicate, and generic status detail', () {
    expect(gameDetailSummary(_game(statusDetail: 'Scheduled')), isNull);
    expect(
      gameDetailSummary(_game(eventDetail: 'Game 2', statusDetail: ' game 2 ')),
      'Game 2',
    );
    expect(gameBroadcastSummary(_game(broadcast: '   ')), isNull);
  });
}

Game _game({String? eventDetail, String? statusDetail, String? broadcast}) {
  final scheduledAt = DateTime.utc(2030, 7, 1, 18);
  return Game(
    id: 'game-1',
    provider: 'provider',
    providerGameId: '1',
    sportCode: 'baseball',
    leagueCode: 'mlb',
    leagueName: 'MLB',
    season: '2030',
    scheduledAtUtc: scheduledAt,
    publishedScheduledAtUtc: scheduledAt,
    effectiveLockAtUtc: scheduledAt,
    homeTeam: const Team(
      id: 'home',
      name: 'Home Club',
      shortName: 'Home',
      abbreviation: 'HOM',
    ),
    awayTeam: const Team(
      id: 'away',
      name: 'Away Club',
      shortName: 'Away',
      abbreviation: 'AWY',
    ),
    status: GameStatus.scheduled,
    statusDetail: statusDetail,
    broadcast: broadcast,
    eventDetail: eventDetail,
    providerLastUpdatedAt: scheduledAt,
    lastSyncedAt: scheduledAt,
    resultVersion: 1,
    sourcePayloadHash: 'hash',
  );
}
