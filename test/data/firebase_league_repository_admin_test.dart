import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/data/models/game.dart';
import 'package:lukespics/data/repositories/firebase_league_repository.dart';
import 'package:mocktail/mocktail.dart';

class _MockFirebaseAuth extends Mock implements FirebaseAuth {}

class _MockFirebaseFirestore extends Mock implements FirebaseFirestore {}

class _MockFirebaseFunctions extends Mock implements FirebaseFunctions {}

class _MockHttpsCallable extends Mock implements HttpsCallable {}

class _MockHttpsCallableResult extends Mock
    implements HttpsCallableResult<Object?> {}

void main() {
  late _MockFirebaseFunctions functions;
  late FirebaseLeagueRepository repository;

  setUp(() {
    functions = _MockFirebaseFunctions();
    repository = FirebaseLeagueRepository(
      auth: _MockFirebaseAuth(),
      firestore: _MockFirebaseFirestore(),
      functions: functions,
    );
  });

  test('one-game force refresh sends the selected game id', () async {
    final callable = _MockHttpsCallable();
    final response = _MockHttpsCallableResult();
    Map<String, Object?>? payload;
    when(
      () => functions.httpsCallable('refreshSelectedGames'),
    ).thenReturn(callable);
    when(() => response.data).thenReturn({
      'ok': true,
      'result': {'updatedGameCount': 1, 'delayed': false},
    });
    when(() => callable.call<Object?>(any())).thenAnswer((invocation) async {
      payload = Map<String, Object?>.from(
        invocation.positionalArguments.single as Map,
      );
      return response;
    });

    final result = await repository.refreshSelectedGames(
      leagueId: 'league-1',
      weekId: 'week-1',
      forceRefresh: true,
      gameId: 'game-1',
    );

    expect(result.updatedGameCount, 1);
    expect(payload?['leagueId'], 'league-1');
    expect(payload?['weekId'], 'week-1');
    expect(payload?['forceRefresh'], isTrue);
    expect(payload?['gameId'], 'game-1');
    expect(payload?['requestId'], isA<String>());
  });

  test(
    'override serializes every non-final state and corrected UTC time',
    () async {
      final callable = _MockHttpsCallable();
      final response = _MockHttpsCallableResult();
      final payloads = <Map<String, Object?>>[];
      when(
        () => functions.httpsCallable('overrideGameResult'),
      ).thenReturn(callable);
      when(() => response.data).thenReturn({
        'ok': true,
        'result': {'resultVersion': 'version-1'},
      });
      when(() => callable.call<Object?>(any())).thenAnswer((invocation) async {
        payloads.add(
          Map<String, Object?>.from(
            invocation.positionalArguments.single as Map,
          ),
        );
        return response;
      });

      for (final status in const [
        GameStatus.scheduled,
        GameStatus.delayed,
        GameStatus.postponed,
        GameStatus.suspended,
      ]) {
        await repository.overrideGameResult(
          leagueId: 'league-1',
          weekId: 'week-1',
          gameId: 'game-1',
          status: status,
          homeScore: null,
          awayScore: null,
          winnerTeamId: null,
          reason: 'Trusted provider correction',
          scheduledAtUtc: DateTime.utc(2030, 7, 2, 0, 30),
        );
      }

      expect(payloads.map((payload) => payload['status']), [
        'scheduled',
        'delayed',
        'postponed',
        'suspended',
      ]);
      for (final payload in payloads) {
        expect(payload['scheduledAtUtc'], '2030-07-02T00:30:00.000Z');
        expect(payload['homeScore'], isNull);
        expect(payload['awayScore'], isNull);
        expect(payload['winnerTeamId'], isNull);
      }
    },
  );
}
