import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/data/models/sports_catalog.dart';
import 'package:lukespics/data/repositories/firebase_league_repository.dart';

void main() {
  test('league and standing parsers retain generation fencing metadata', () {
    final league = parseLeagueSummary('league-1', {
      'name': 'Connected Arena',
      'timezone': 'America/Chicago',
      'standingsEpoch': 7,
      'standingsBuiltEpoch': 6,
      'standingsBuiltMemberCount': 12,
      'settings': {
        'pickerParticipatesInPicks': true,
        'pickLockPolicy': 'firstGame',
      },
    });
    final standing = parseStanding('member-a', {
      'displayName': 'Member A',
      'standingsEpoch': 7,
    });

    expect(league.standingsEpoch, 7);
    expect(league.standingsBuiltEpoch, 6);
    expect(league.standingsBuiltMemberCount, 12);
    expect(standing.standingsEpoch, 7);
  });

  test('legacy generation metadata defaults to compatible 0/0 values', () {
    final league = parseLeagueSummary('legacy-league', const {});
    final standing = parseStanding('legacy-member', const {});

    expect(league.standingsEpoch, 0);
    expect(league.standingsBuiltEpoch, 0);
    expect(league.standingsBuiltMemberCount, isNull);
    expect(standing.standingsEpoch, 0);
  });

  test(
    'catalog parser retains discovery, policy, cache, query, and week data',
    () {
      final result = parseSportsCatalogResult(
        {
          'provider': 'apiSports',
          'sports': [
            {'code': 'baseball', 'displayName': 'Baseball'},
            {'displayName': 'Missing code'},
          ],
          'leagues': [
            {
              'code': 'mlb',
              'displayName': 'MLB',
              'sportCode': 'baseball',
              'providerLeagueId': 1,
              'season': 2026,
            },
            {'code': 'incomplete'},
          ],
          'cache': {
            'hit': true,
            'stale': false,
            'delayed': false,
            'cachedAt': '2026-07-31T15:00:00.000Z',
            'expiresAt': '2026-07-31T17:00:00.000Z',
          },
          'presentation': {
            'provider': 'apiSports',
            'attributionText': 'Schedule data from API-Sports',
            'allowRemoteLogos': true,
            'allowedLogoHosts': ['MEDIA.API-SPORTS.IO'],
            'allowedLogoQueryParameters': ['size'],
            'logoRightsReviewDate': '2026-07-31T00:00:00.000Z',
          },
          'effectiveQuery': {
            'sportCode': 'baseball',
            'leagueCode': 'mlb',
            'providerLeagueId': '1',
            'season': '2026',
            'from': '2026-08-01',
            'to': '2026-08-03',
            'timezone': 'America/Chicago',
          },
          'availability': {
            'state': 'noGamesScheduled',
            'message': 'No games are scheduled for this selected range.',
          },
          'week': {
            'startAt': '2026-07-27T05:00:00.000Z',
            'endAt': '2026-08-03T05:00:00.000Z',
          },
        },
        requestedQuery: null,
        games: const [],
      );

      expect(result.supportedSports.single.code, 'baseball');
      expect(result.supportedSports.single.displayName, 'Baseball');
      expect(result.supportedLeagues.single.code, 'mlb');
      expect(result.supportedLeagues.single.providerLeagueId, '1');
      expect(result.supportedLeagues.single.season, '2026');
      expect(result.cache.hit, isTrue);
      expect(result.cache.expiresAt, DateTime.utc(2026, 7, 31, 17));
      expect(result.presentation.attributionText, contains('API-Sports'));
      expect(result.presentation.allowedLogoHosts, {'media.api-sports.io'});
      expect(
        result.presentation.permitsRemoteLogosForProvider('apiSports'),
        isTrue,
      );
      expect(
        result.presentation.permitsRemoteLogosForProvider('anotherProvider'),
        isFalse,
      );
      expect(result.effectiveQuery?.leagueCode, 'mlb');
      expect(result.effectiveQuery?.timezone, 'America/Chicago');
      expect(result.availability.state, CatalogAvailabilityState.noGames);
      expect(result.weekStartAt, DateTime.utc(2026, 7, 27, 5));
      expect(result.weekEndAt, DateTime.utc(2026, 8, 3, 5));
    },
  );

  test('legacy attribution cannot enable remote logos', () {
    final requested = CatalogQuery(
      sportCode: 'baseball',
      leagueCode: 'mlb',
      providerLeagueId: '1',
      season: '2026',
      from: DateTime.utc(2026, 8, 1),
      to: DateTime.utc(2026, 8, 1),
    );
    final result = parseSportsCatalogResult(
      {
        'provider': 'apiSports',
        'attribution': {
          'text': 'Provider attribution',
          'url': 'https://example.test',
        },
        'cache': const <String, Object?>{},
      },
      requestedQuery: requested,
      games: const [],
    );

    expect(result.presentation.attributionText, isEmpty);
    expect(result.presentation.allowRemoteLogos, isFalse);
    expect(
      result.presentation.permitsRemoteLogosForProvider('apiSports'),
      isFalse,
    );
    expect(result.effectiveQuery?.leagueCode, 'mlb');
  });

  test(
    'CBS catalog parser retains bounded college-football discovery data',
    () {
      final result = parseSportsCatalogResult({
        'provider': 'cbsSports',
        'sports': [
          {'code': 'NCAAF', 'displayName': 'College Football'},
        ],
        'leagues': [
          {
            'code': 'ncaaf',
            'displayName': 'NCAA Football',
            'sportCode': 'NCAAF',
            'providerLeagueId': 'FBS',
            'provider': 'cbsSports',
            'season': '2026',
            'seasonType': 'regular',
            'week': 1,
            'division': 'FBS',
          },
        ],
        'presentation': {
          'provider': 'cbsSports',
          'attributionText': 'Schedule source: CBS Sports',
          'allowRemoteLogos': true,
          'allowedLogoHosts': ['sports.cbsimg.net'],
          'allowedLogoQueryParameters': <String>[],
          'logoRightsReviewDate': '2026-08-25T00:00:00.000Z',
        },
        'effectiveQuery': {
          'sportCode': 'NCAAF',
          'leagueCode': 'ncaaf',
          'providerLeagueId': 'FBS',
          'season': '2026',
          'seasonType': 'regular',
          'week': 1,
          'division': 'FBS',
          'from': '2026-08-27',
          'to': '2026-08-31',
          'timezone': 'America/Chicago',
        },
        'collegeFootball': {
          'activeSeason': 2026,
          'activeSeasonType': 'regular',
          'activeWeek': 1,
          'division': 'FBS',
          'seasons': [2025, 2026, 'invalid'],
          'seasonTypes': ['regular', 'postseason', 'invalid'],
          'minimumWeek': 0,
          'maximumWeek': 25,
        },
        'cache': const <String, Object?>{},
      }, games: const []);

      final league = result.supportedLeagues.single;
      expect(league.provider, 'cbsSports');
      expect(league.seasonType, 'regular');
      expect(league.week, 1);
      expect(league.division, 'FBS');
      expect(result.effectiveQuery?.seasonType, 'regular');
      expect(result.effectiveQuery?.week, 1);
      expect(result.effectiveQuery?.division, 'FBS');
      expect(result.effectiveQuery?.from, DateTime.utc(2026, 8, 27));
      expect(result.effectiveQuery?.to, DateTime.utc(2026, 8, 31));
      expect(result.collegeFootball?.activeSeason, 2026);
      expect(result.collegeFootball?.activeSeasonType, 'regular');
      expect(result.collegeFootball?.activeWeek, 1);
      expect(result.collegeFootball?.seasons, [2025, 2026]);
      expect(result.collegeFootball?.seasonTypes, ['regular', 'postseason']);
      expect(result.collegeFootball?.minimumWeek, 0);
      expect(result.collegeFootball?.maximumWeek, 25);
      expect(
        result.effectiveQuery?.collegeFootball,
        same(result.collegeFootball),
      );
      expect(result.presentation.allowRemoteLogos, isTrue);
      expect(
        result.presentation.permitsRemoteLogosForProvider('cbsSports'),
        isTrue,
      );
    },
  );

  test('logo rights require an explicit matching presentation provider', () {
    for (final presentation in <Map<String, Object?>>[
      {
        'attributionText': 'Missing provider attribution',
        'allowRemoteLogos': true,
        'allowedLogoHosts': ['media.api-sports.io'],
        'logoRightsReviewDate': '2026-07-31T00:00:00.000Z',
      },
      {
        'provider': 'anotherProvider',
        'attributionText': 'Mismatched provider attribution',
        'allowRemoteLogos': true,
        'allowedLogoHosts': ['media.api-sports.io'],
        'logoRightsReviewDate': '2026-07-31T00:00:00.000Z',
      },
    ]) {
      final result = parseSportsCatalogResult({
        'provider': 'apiSports',
        'presentation': presentation,
        'cache': const <String, Object?>{},
      }, games: const []);

      expect(result.presentation.attributionText, isEmpty);
      expect(result.presentation.allowRemoteLogos, isFalse);
      expect(
        result.presentation.permitsRemoteLogosForProvider('apiSports'),
        isFalse,
      );
      expect(result.presentation.allowedLogoHosts, isEmpty);
    }

    final missingEnvelopeProvider = parseSportsCatalogResult({
      'presentation': {
        'provider': 'unknown',
        'attributionText': 'Unknown provider attribution',
        'allowRemoteLogos': true,
        'allowedLogoHosts': ['media.api-sports.io'],
        'logoRightsReviewDate': '2026-07-31T00:00:00.000Z',
      },
    }, games: const []);
    expect(missingEnvelopeProvider.presentation.allowRemoteLogos, isFalse);
    expect(missingEnvelopeProvider.presentation.attributionText, isEmpty);
  });

  test('SportsDataIO remains neutral without reviewed artwork rights', () {
    final result = parseSportsCatalogResult({
      'provider': 'sportsDataIo',
      'presentation': {
        'provider': 'sportsDataIo',
        'attributionText': 'Schedule data provider',
        'allowRemoteLogos': true,
        'allowedLogoHosts': ['images.example.test'],
        'logoRightsReviewDate': '2026-07-31T00:00:00.000Z',
      },
      'cache': const <String, Object?>{},
    }, games: const []);

    expect(result.presentation.provider, 'sportsDataIo');
    expect(result.presentation.attributionText, 'Schedule data provider');
    expect(result.presentation.allowRemoteLogos, isFalse);
    expect(result.presentation.allowedLogoHosts, isEmpty);
    expect(
      result.presentation.permitsRemoteLogosForProvider('sportsDataIo'),
      isFalse,
    );
  });

  test(
    'time-TBD game parsing preserves provider identity and fails closed',
    () {
      final game = parseGameSnapshot('sportsDataIo:mlb:score-42', {
        'provider': 'sportsDataIo',
        'providerGameId': 'score-42',
        'providerScoreId': 42,
        'providerLeagueGameId': 'league-game-42',
        'providerGlobalGameId': 'global-game-42',
        'providerGameKey': '2026-JUL-31-AWY-HOM',
        'sportCode': 'baseball',
        'leagueCode': 'mlb',
        'leagueName': 'Major League Baseball',
        'season': 2026,
        'scheduledAtUtc': 'not-a-date',
        'publishedScheduledAtUtc': null,
        'effectiveLockAtUtc': null,
        'scheduledDayEastern': '2026-07-31',
        'timeTbd': true,
        'homeTeam': {
          'id': 'home',
          'name': 'Home Club',
          'shortName': 'Home',
          'abbreviation': 'HOM',
          'providerTeamId': 10,
          'providerGlobalTeamId': 'global-home',
        },
        'awayTeam': {
          'id': 'away',
          'name': 'Away Club',
          'shortName': 'Away',
          'abbreviation': 'AWY',
          'providerTeamId': 11,
          'providerGlobalTeamId': 'global-away',
        },
        'status': 'scheduled',
        'isClosed': false,
        'rescheduledFromLeagueGameId': 'league-game-41',
        'rescheduledToLeagueGameId': 'league-game-43',
        'selectable': false,
        'selectionReason': 'A confirmed start time is required.',
        'resultVersion': 'version-1',
      });

      expect(game.timeTbd, isTrue);
      expect(game.scheduledDayEastern, '2026-07-31');
      expect(game.scheduledAtUtc, isNull);
      expect(game.publishedScheduledAtUtc, isNull);
      expect(game.effectiveLockAtUtc, isNull);
      expect(game.hasConfirmedSchedule, isFalse);
      expect(game.isLockedAt(DateTime.utc(2026, 7, 1)), isTrue);
      expect(game.providerScoreId, '42');
      expect(game.providerLeagueGameId, 'league-game-42');
      expect(game.providerGlobalGameId, 'global-game-42');
      expect(game.providerGameKey, '2026-JUL-31-AWY-HOM');
      expect(game.homeTeam.providerTeamId, '10');
      expect(game.homeTeam.providerGlobalTeamId, 'global-home');
      expect(game.isClosed, isFalse);
      expect(game.rescheduledFromLeagueGameId, 'league-game-41');
      expect(game.rescheduledToLeagueGameId, 'league-game-43');
      expect(game.selectable, isFalse);
      expect(game.selectionReason, 'A confirmed start time is required.');
    },
  );

  test('CBS game parsing retains normalized venue and display metadata', () {
    final game = parseGameSnapshot('cbsSports:football:42', {
      'provider': 'cbsSports',
      'providerGameId': '42',
      'sportCode': 'NCAAF',
      'leagueCode': 'ncaaf',
      'leagueName': 'NCAA Football',
      'season': '2026',
      'seasonType': 'regular',
      'weekOrRound': '1',
      'scheduledAtUtc': '2026-08-29T16:00:00.000Z',
      'venueName': 'Memorial Stadium',
      'venueCity': 'Lincoln',
      'venueState': 'NE',
      'venueCountry': 'USA',
      'homeTeam': {
        'id': 'home',
        'name': 'Home Team',
        'shortName': 'Home',
        'abbreviation': 'HOM',
      },
      'awayTeam': {
        'id': 'away',
        'name': 'Away Team',
        'shortName': 'Away',
        'abbreviation': 'AWY',
      },
      'status': 'scheduled',
      'sourceGameUrl':
          'https://www.cbssports.com/college-football/gametracker/live/NCAAF_20260829_AWY@HOM/',
      'kickoffDisplayText': '11:00 AM',
      'dateHeading': 'Saturday, August 29',
    });

    expect(game.venueName, 'Memorial Stadium');
    expect(game.venueCity, 'Lincoln');
    expect(game.venueState, 'NE');
    expect(game.venueCountry, 'USA');
    expect(game.sourceGameUrl?.host, 'www.cbssports.com');
    expect(game.kickoffDisplayText, '11:00 AM');
    expect(game.dateHeading, 'Saturday, August 29');
  });

  test('historic confirmed snapshots reuse their real scheduled instant', () {
    final game = parseGameSnapshot('historic-game', {
      'provider': 'manual',
      'providerGameId': 'historic-game',
      'scheduledAtUtc': '2024-09-08T17:00:00.000Z',
      'timeTbd': false,
      'homeTeam': const <String, Object?>{},
      'awayTeam': const <String, Object?>{},
    });

    expect(game.scheduledAtUtc, DateTime.utc(2024, 9, 8, 17));
    expect(game.publishedScheduledAtUtc, game.scheduledAtUtc);
    expect(game.effectiveLockAtUtc, game.scheduledAtUtc);
    expect(game.hasConfirmedSchedule, isTrue);
  });

  test('published week parser retains a matching presentation snapshot', () {
    final week = parseWeekSummary('week-0001', {
      'sequentialNumber': 1,
      'label': 'Week 1',
      'pickerUid': 'picker',
      'nextPickerUid': 'next-picker',
      'status': 'open',
      'catalogProviderSnapshot': 'apiSports',
      'catalogPresentationSnapshot': {
        'provider': 'apiSports',
        'attributionText': 'Schedule data from API-Sports',
        'allowRemoteLogos': true,
        'allowedLogoHosts': ['MEDIA.API-SPORTS.IO'],
        'allowedLogoQueryParameters': <String>[],
        'logoRightsReviewDate': '2026-07-31',
      },
    });

    expect(week.catalogPresentation.provider, 'apiSports');
    expect(week.nextPickerUid, 'next-picker');
    expect(week.catalogPresentation.allowRemoteLogos, isTrue);
    expect(week.catalogPresentation.allowedLogoHosts, {'media.api-sports.io'});
    expect(
      week.catalogPresentation.permitsRemoteLogosForProvider('apiSports'),
      isTrue,
    );
  });

  test('published week presentation fails closed on missing or mismatch', () {
    for (final data in <Map<String, Object?>>[
      {'status': 'open'},
      {
        'status': 'open',
        'catalogProviderSnapshot': 'apiSports',
        'catalogPresentationSnapshot': {
          'provider': 'anotherProvider',
          'allowRemoteLogos': true,
          'allowedLogoHosts': ['media.api-sports.io'],
          'logoRightsReviewDate': '2026-07-31',
        },
      },
    ]) {
      final week = parseWeekSummary('week-0001', data);
      expect(week.catalogPresentation.allowRemoteLogos, isFalse);
      expect(week.catalogPresentation.allowedLogoHosts, isEmpty);
    }
  });
}
