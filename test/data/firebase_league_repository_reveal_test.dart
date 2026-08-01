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

  test(
    'saves the exact result version carried by the chosen snapshot',
    () async {
      final catalogCallable = _MockHttpsCallable();
      final saveCallable = _MockHttpsCallable();
      final newerResponse = _MockHttpsCallableResult();
      final olderResponse = _MockHttpsCallableResult();
      final saveResponse = _MockHttpsCallableResult();
      final newerVersion = List<String>.filled(64, 'b').join();
      final olderVersion = List<String>.filled(64, 'a').join();
      final newerHash = List<String>.filled(64, '2').join();
      final olderHash = List<String>.filled(64, '1').join();
      Map<String, Object?>? savedPayload;

      Map<String, Object?> game({
        required String resultVersion,
        required String sourcePayloadHash,
        required String observedAt,
        bool includeMetadata = false,
      }) => {
        'id': 'apiSports:baseball:42',
        'provider': 'apiSports',
        'providerGameId': '42',
        'providerLeagueId': '4424',
        'sportCode': 'baseball',
        'leagueCode': 'mlb',
        'leagueName': 'MLB',
        'season': '2030',
        if (includeMetadata) 'seasonType': 'Regular Season',
        'scheduledAtUtc': '2030-07-01T18:00:00.000Z',
        'publishedScheduledAtUtc': '2030-07-01T18:00:00.000Z',
        'effectiveLockAtUtc': '2030-07-01T18:00:00.000Z',
        'venueName': 'Version Park',
        'neutralSite': false,
        'homeTeam': {
          'id': 'home',
          'name': 'Home Club',
          'shortName': 'Home',
          'abbreviation': 'HOM',
          'logoUrl': null,
          if (includeMetadata) 'color': '#112233',
        },
        'awayTeam': {
          'id': 'away',
          'name': 'Away Club',
          'shortName': 'Away',
          'abbreviation': 'AWY',
          'logoUrl': null,
          if (includeMetadata) 'color': '#aabbcc',
        },
        'status': 'scheduled',
        if (includeMetadata) 'statusDetail': 'First pitch delayed',
        'homeScore': null,
        'awayScore': null,
        'winnerTeamId': null,
        if (includeMetadata) 'broadcast': 'ESPN+',
        if (includeMetadata) 'eventDetail': 'Doubleheader · Game 2',
        'providerLastUpdatedAt': observedAt,
        'lastSyncedAt': observedAt,
        'resultVersion': resultVersion,
        if (includeMetadata) 'rawResponseVersion': 2,
        'sourcePayloadHash': sourcePayloadHash,
      };

      Map<String, Object?> catalogEnvelope(Map<String, Object?> value) => {
        'ok': true,
        'result': {
          'provider': 'apiSports',
          'games': [value],
          'cache': {
            'hit': false,
            'stale': false,
            'delayed': false,
            'cachedAt': '2030-06-01T00:00:00.000Z',
            'expiresAt': '2030-06-01T01:00:00.000Z',
          },
          'availability': {'state': 'available'},
        },
      };

      when(
        () => functions.httpsCallable('listSportsCatalog'),
      ).thenReturn(catalogCallable);
      when(
        () => functions.httpsCallable('saveDraftSlate'),
      ).thenReturn(saveCallable);
      when(() => newerResponse.data).thenReturn(
        catalogEnvelope(
          game(
            resultVersion: newerVersion,
            sourcePayloadHash: newerHash,
            observedAt: '2030-06-01T00:02:00.000Z',
            includeMetadata: true,
          ),
        ),
      );
      when(() => olderResponse.data).thenReturn(
        catalogEnvelope(
          game(
            resultVersion: olderVersion,
            sourcePayloadHash: olderHash,
            observedAt: '2030-06-01T00:01:00.000Z',
          ),
        ),
      );
      when(() => saveResponse.data).thenReturn({
        'ok': true,
        'result': {'selectedGameCount': 1},
      });
      var catalogCallCount = 0;
      when(() => catalogCallable.call<Object?>(any())).thenAnswer((_) async {
        catalogCallCount += 1;
        return catalogCallCount == 1 ? newerResponse : olderResponse;
      });
      when(() => saveCallable.call<Object?>(any())).thenAnswer((
        invocation,
      ) async {
        savedPayload = Map<String, Object?>.from(
          invocation.positionalArguments.single as Map,
        );
        return saveResponse;
      });

      final newer = await repository.listSportsCatalog(
        leagueId: 'league-1',
        weekId: 'week-0001',
      );
      final older = await repository.listSportsCatalog(
        leagueId: 'league-1',
        weekId: 'week-0001',
      );
      await repository.saveDraftSlate(
        leagueId: 'league-1',
        weekId: 'week-0001',
        chunkKey: 'version-race-chunk',
        games: [newer.games.single],
      );

      final serializedGames = savedPayload?['games'] as List<Object?>;
      final serialized = Map<String, Object?>.from(
        serializedGames.single as Map,
      );
      expect(newer.games.single.resultVersionToken, newerVersion);
      expect(newer.games.single.providerLeagueId, '4424');
      expect(newer.games.single.seasonType, 'Regular Season');
      expect(newer.games.single.statusDetail, 'First pitch delayed');
      expect(newer.games.single.broadcast, 'ESPN+');
      expect(newer.games.single.eventDetail, 'Doubleheader · Game 2');
      expect(newer.games.single.rawResponseVersion, 2);
      expect(newer.games.single.homeTeam.color, '#112233');
      expect(newer.games.single.awayTeam.color, '#aabbcc');
      expect(older.games.single.seasonType, isNull);
      expect(older.games.single.statusDetail, isNull);
      expect(older.games.single.broadcast, isNull);
      expect(older.games.single.eventDetail, isNull);
      expect(older.games.single.rawResponseVersion, 1);
      expect(older.games.single.homeTeam.color, isNull);
      expect(older.games.single.awayTeam.color, isNull);
      expect(serialized['providerLeagueId'], '4424');
      expect(serialized['resultVersion'], newerVersion);
      expect(serialized['sourcePayloadHash'], newerHash);
      expect(serialized['seasonType'], 'Regular Season');
      expect(serialized['statusDetail'], 'First pitch delayed');
      expect(serialized['broadcast'], 'ESPN+');
      expect(serialized['eventDetail'], 'Doubleheader · Game 2');
      expect(serialized['rawResponseVersion'], 2);
      expect(
        Map<String, Object?>.from(serialized['homeTeam'] as Map)['color'],
        '#112233',
      );
      expect(
        Map<String, Object?>.from(serialized['awayTeam'] as Map)['color'],
        '#aabbcc',
      );
    },
  );
}
