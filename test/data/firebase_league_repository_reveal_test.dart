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

final class _TestFirebaseFunctionsException extends FirebaseFunctionsException {
  _TestFirebaseFunctionsException({
    required super.message,
    required super.code,
    super.details,
  });
}

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

  test('preserves every allowlisted provider configuration reason', () async {
    final catalogCallable = _MockHttpsCallable();
    when(
      () => functions.httpsCallable('listSportsCatalog'),
    ).thenReturn(catalogCallable);
    for (final (reason, message) in const [
      (
        sportsDataIoApiKeyConfigurationReason,
        'SportsDataIO API key is not configured.',
      ),
      (
        sportsDataIoCredentialsConfigurationReason,
        'SportsDataIO server credentials need administrator configuration.',
      ),
      (
        sportsDataIoEntitlementConfigurationReason,
        'SportsDataIO league feed entitlement needs administrator '
            'configuration.',
      ),
    ]) {
      when(() => catalogCallable.call<Object?>(any())).thenThrow(
        _TestFirebaseFunctionsException(
          code: 'failed-precondition',
          message: message,
          details: {
            'reason': reason,
            'upstreamBody': 'sensitive upstream body',
          },
        ),
      );

      await expectLater(
        repository.listSportsCatalog(leagueId: 'league-1', weekId: 'week-0001'),
        throwsA(
          isA<RepositoryException>()
              .having((error) => error.code, 'code', 'failed-precondition')
              .having((error) => error.reason, 'reason', reason)
              .having((error) => error.safeMessage, 'message', message)
              .having(
                (error) => error.toString(),
                'safe rendering',
                isNot(contains('sensitive upstream body')),
              ),
        ),
      );
    }
  });

  test(
    'CBS catalog request propagates the bounded weekly cache identity',
    () async {
      final catalogCallable = _MockHttpsCallable();
      final response = _MockHttpsCallableResult();
      Map<String, Object?>? payload;
      when(
        () => functions.httpsCallable('listSportsCatalog'),
      ).thenReturn(catalogCallable);
      when(() => response.data).thenReturn({
        'ok': true,
        'result': {
          'provider': 'cbsSports',
          'games': const <Object?>[],
          'cache': const <String, Object?>{},
        },
      });
      when(() => catalogCallable.call<Object?>(any())).thenAnswer((
        invocation,
      ) async {
        payload = Map<String, Object?>.from(
          invocation.positionalArguments.single as Map,
        );
        return response;
      });

      await repository.listSportsCatalog(
        leagueId: 'league-1',
        weekId: 'week-0001',
        query: CatalogQuery(
          sportCode: 'NCAAF',
          leagueCode: 'ncaaf',
          providerLeagueId: 'FBS',
          season: '2026',
          seasonType: 'postseason',
          week: 3,
          division: 'FBS',
          from: DateTime.utc(2026, 12, 18),
          to: DateTime.utc(2026, 12, 22),
          timezone: 'America/Chicago',
        ),
      );

      expect(payload?['sportCode'], 'NCAAF');
      expect(payload?['leagueCode'], 'ncaaf');
      expect(payload?['leagueIdForProvider'], 'FBS');
      expect(payload?['season'], '2026');
      expect(payload?['seasonType'], 'postseason');
      expect(payload?['week'], 3);
      expect(payload?['division'], 'FBS');
      expect(payload?['from'], '2026-12-18');
      expect(payload?['to'], '2026-12-22');
      expect(payload?['timezone'], 'America/Chicago');
      expect(payload?['requestId'], isA<String>());
    },
  );

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
        if (includeMetadata) 'providerScoreId': 'score-42',
        if (includeMetadata) 'providerLeagueGameId': 'league-game-42',
        if (includeMetadata) 'providerGlobalGameId': 'global-game-42',
        if (includeMetadata) 'providerGameKey': '2030-JUL-01-AWY-HOM',
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
        if (includeMetadata) 'venueCity': 'Chicago',
        if (includeMetadata) 'venueState': 'IL',
        if (includeMetadata) 'venueCountry': 'USA',
        'neutralSite': false,
        'homeTeam': {
          'id': 'home',
          'name': 'Home Club',
          'shortName': 'Home',
          'abbreviation': 'HOM',
          'logoUrl': null,
          if (includeMetadata) 'color': '#112233',
          if (includeMetadata) 'providerTeamId': 'home-42',
          if (includeMetadata) 'providerGlobalTeamId': 'global-home-42',
        },
        'awayTeam': {
          'id': 'away',
          'name': 'Away Club',
          'shortName': 'Away',
          'abbreviation': 'AWY',
          'logoUrl': null,
          if (includeMetadata) 'color': '#aabbcc',
          if (includeMetadata) 'providerTeamId': 'away-42',
          if (includeMetadata) 'providerGlobalTeamId': 'global-away-42',
        },
        'status': 'scheduled',
        if (includeMetadata) 'statusDetail': 'First pitch delayed',
        if (includeMetadata) 'isClosed': false,
        if (includeMetadata) 'rescheduledFromLeagueGameId': 'league-game-41',
        if (includeMetadata) 'rescheduledToLeagueGameId': 'league-game-43',
        'homeScore': null,
        'awayScore': null,
        'winnerTeamId': null,
        if (includeMetadata) 'broadcast': 'National Stream',
        if (includeMetadata) 'eventDetail': 'Doubleheader · Game 2',
        if (includeMetadata) 'sourceGameUrl': 'https://example.test/game/42',
        if (includeMetadata) 'kickoffDisplayText': '1:00 PM',
        if (includeMetadata) 'dateHeading': 'Monday, July 1',
        'providerLastUpdatedAt': observedAt,
        'lastSyncedAt': observedAt,
        'resultVersion': resultVersion,
        if (includeMetadata) 'rawResponseVersion': 2,
        'sourcePayloadHash': sourcePayloadHash,
        if (includeMetadata) 'selectable': true,
        if (includeMetadata) 'selectionReason': null,
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
      expect(newer.games.single.providerScoreId, 'score-42');
      expect(newer.games.single.providerLeagueGameId, 'league-game-42');
      expect(newer.games.single.providerGlobalGameId, 'global-game-42');
      expect(newer.games.single.providerGameKey, '2030-JUL-01-AWY-HOM');
      expect(newer.games.single.seasonType, 'Regular Season');
      expect(newer.games.single.statusDetail, 'First pitch delayed');
      expect(newer.games.single.broadcast, 'National Stream');
      expect(newer.games.single.eventDetail, 'Doubleheader · Game 2');
      expect(newer.games.single.venueCity, 'Chicago');
      expect(newer.games.single.venueState, 'IL');
      expect(newer.games.single.venueCountry, 'USA');
      expect(newer.games.single.sourceGameUrl?.host, 'example.test');
      expect(newer.games.single.kickoffDisplayText, '1:00 PM');
      expect(newer.games.single.dateHeading, 'Monday, July 1');
      expect(newer.games.single.rawResponseVersion, 2);
      expect(newer.games.single.homeTeam.color, '#112233');
      expect(newer.games.single.awayTeam.color, '#aabbcc');
      expect(newer.games.single.homeTeam.providerTeamId, 'home-42');
      expect(
        newer.games.single.homeTeam.providerGlobalTeamId,
        'global-home-42',
      );
      expect(newer.games.single.awayTeam.providerTeamId, 'away-42');
      expect(newer.games.single.isClosed, isFalse);
      expect(newer.games.single.rescheduledFromLeagueGameId, 'league-game-41');
      expect(newer.games.single.rescheduledToLeagueGameId, 'league-game-43');
      expect(newer.games.single.selectable, isTrue);
      expect(older.games.single.seasonType, isNull);
      expect(older.games.single.statusDetail, isNull);
      expect(older.games.single.broadcast, isNull);
      expect(older.games.single.eventDetail, isNull);
      expect(older.games.single.rawResponseVersion, 1);
      expect(older.games.single.homeTeam.color, isNull);
      expect(older.games.single.awayTeam.color, isNull);
      expect(serialized['providerLeagueId'], '4424');
      expect(serialized['providerScoreId'], 'score-42');
      expect(serialized['providerLeagueGameId'], 'league-game-42');
      expect(serialized['providerGlobalGameId'], 'global-game-42');
      expect(serialized['providerGameKey'], '2030-JUL-01-AWY-HOM');
      expect(serialized['resultVersion'], newerVersion);
      expect(serialized['sourcePayloadHash'], newerHash);
      expect(serialized['seasonType'], 'Regular Season');
      expect(serialized['statusDetail'], 'First pitch delayed');
      expect(serialized['broadcast'], 'National Stream');
      expect(serialized['eventDetail'], 'Doubleheader · Game 2');
      expect(serialized['venueCity'], 'Chicago');
      expect(serialized['venueState'], 'IL');
      expect(serialized['venueCountry'], 'USA');
      expect(serialized['sourceGameUrl'], 'https://example.test/game/42');
      expect(serialized['kickoffDisplayText'], '1:00 PM');
      expect(serialized['dateHeading'], 'Monday, July 1');
      expect(serialized['rawResponseVersion'], 2);
      expect(serialized['isClosed'], isFalse);
      expect(serialized['rescheduledFromLeagueGameId'], 'league-game-41');
      expect(serialized['rescheduledToLeagueGameId'], 'league-game-43');
      expect(serialized['selectable'], isTrue);
      expect(serialized['selectionReason'], isNull);
      expect(
        Map<String, Object?>.from(serialized['homeTeam'] as Map)['color'],
        '#112233',
      );
      expect(
        Map<String, Object?>.from(
          serialized['homeTeam'] as Map,
        )['providerTeamId'],
        'home-42',
      );
      expect(
        Map<String, Object?>.from(serialized['awayTeam'] as Map)['color'],
        '#aabbcc',
      );
    },
  );
}
