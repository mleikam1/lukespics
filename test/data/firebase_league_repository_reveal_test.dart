import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/data/repositories/firebase_league_repository.dart';
import 'package:lukespics/data/repositories/league_repository.dart';
import 'package:mocktail/mocktail.dart';

class _MockFirebaseAuth extends Mock implements FirebaseAuth {}

class _MockFirebaseFirestore extends Mock implements FirebaseFirestore {}

class _MockFirebaseFunctions extends Mock implements FirebaseFunctions {}

class _MockHttpsCallable extends Mock implements HttpsCallable {}

class _MockHttpsCallableResult extends Mock
    implements HttpsCallableResult<Object?> {}

void main() {
  late _MockFirebaseFunctions functions;
  late _MockHttpsCallable callable;
  late FirebaseLeagueRepository repository;

  setUp(() {
    functions = _MockFirebaseFunctions();
    callable = _MockHttpsCallable();
    repository = FirebaseLeagueRepository(
      auth: _MockFirebaseAuth(),
      firestore: _MockFirebaseFirestore(),
      functions: functions,
    );
    when(
      () => functions.httpsCallable('revealLockedGamePicks'),
    ).thenReturn(callable);
  });

  test('accepts the previous reveal response without a payload map', () async {
    final response = _MockHttpsCallableResult();
    when(() => response.data).thenReturn({
      'ok': true,
      'result': {'revealedGameCount': 1},
    });
    when(() => callable.call<Object?>(any())).thenAnswer((_) async => response);

    final result = await repository.revealLockedGamePicks(
      leagueId: 'league-1',
      weekId: 'week-0001',
    );

    expect(result.revealedGameCount, 1);
    expect(result.revealsByGame, isEmpty);
    expect(result.payloadTruncated, isFalse);
  });

  test('follows bounded reveal pages and merges picks by uid', () async {
    final first = _MockHttpsCallableResult();
    final second = _MockHttpsCallableResult();
    when(() => first.data).thenReturn({
      'ok': true,
      'result': {
        'revealedGameCount': 1,
        'revealsByGame': {
          'game-1': [
            {
              'uid': 'member-a',
              'displayName': 'Member A',
              'selectedTeamId': 'home',
              'outcome': 'pending',
              'points': 0,
            },
          ],
        },
        'revealPage': {
          'truncated': true,
          'nextCursor': {'gameId': 'game-1', 'afterUid': 'member-a'},
        },
      },
    });
    when(() => second.data).thenReturn({
      'ok': true,
      'result': {
        'revealedGameCount': 0,
        'revealsByGame': {
          'game-1': [
            {
              'uid': 'member-b',
              'displayName': 'Member B',
              'selectedTeamId': 'away',
              'outcome': 'correct',
              'points': 1,
            },
          ],
        },
        'revealPage': {'truncated': false, 'nextCursor': null},
      },
    });
    var callCount = 0;
    when(() => callable.call<Object?>(any())).thenAnswer((_) async {
      callCount += 1;
      return callCount == 1 ? first : second;
    });

    final result = await repository.revealLockedGamePicks(
      leagueId: 'league-1',
      weekId: 'week-0001',
    );

    expect(callCount, 2);
    expect(result.revealedGameCount, 1);
    expect(
      result.revealsByGame['game-1']?.map((pick) => pick.uid),
      containsAll(['member-a', 'member-b']),
    );
    expect(result.payloadTruncated, isFalse);
  });

  test('rejects a non-advancing reveal cursor', () async {
    final response = _MockHttpsCallableResult();
    when(() => response.data).thenReturn({
      'ok': true,
      'result': {
        'revealedGameCount': 0,
        'revealsByGame': const {},
        'revealPage': {
          'truncated': true,
          'nextCursor': {'gameId': 'game-1', 'afterUid': 'member-a'},
        },
      },
    });
    when(() => callable.call<Object?>(any())).thenAnswer((_) async => response);

    await expectLater(
      repository.revealLockedGamePicks(
        leagueId: 'league-1',
        weekId: 'week-0001',
      ),
      throwsA(isA<RepositoryException>()),
    );
  });
}
