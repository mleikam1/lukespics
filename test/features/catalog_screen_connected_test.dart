import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:lukespics/app/bootstrap.dart';
import 'package:lukespics/core/domain/league_time.dart';
import 'package:lukespics/data/demo/demo_repository.dart';
import 'package:lukespics/data/models/game.dart';
import 'package:lukespics/data/models/member.dart';
import 'package:lukespics/data/models/pick.dart';
import 'package:lukespics/data/models/standing.dart';
import 'package:lukespics/data/repositories/league_repository.dart';
import 'package:lukespics/features/sports_catalog/catalog_date_window.dart';
import 'package:lukespics/features/sports_catalog/catalog_screen.dart';
import 'package:mocktail/mocktail.dart';
import 'package:timezone/data/latest.dart' as timezone_data;

class _MockLeagueRepository extends Mock implements LeagueRepository {}

class _MockFirebaseAuth extends Mock implements FirebaseAuth {}

class _MockUser extends Mock implements User {}

final class _CatalogCall {
  const _CatalogCall({
    required this.query,
    required this.timezone,
    required this.weekStartAt,
    required this.weekEndAt,
    required this.forceRefresh,
  });

  final CatalogQuery? query;
  final String? timezone;
  final DateTime? weekStartAt;
  final DateTime? weekEndAt;
  final bool forceRefresh;
}

void main() {
  const providerLeagueId = '4424';
  const footballProviderLeagueId = '3';
  const season = '2026';

  setUpAll(() {
    timezone_data.initializeTimeZones();
    registerFallbackValue(
      CatalogQuery(
        sportCode: 'baseball',
        leagueCode: 'mlb',
        providerLeagueId: providerLeagueId,
        season: season,
        from: DateTime.utc(2026, 1, 1),
        to: DateTime.utc(2026, 1, 2),
      ),
    );
  });

  testWidgets(
    'connected catalog sends canonical bounded queries and keeps selections',
    (tester) async {
      tester.view.physicalSize = const Size(1440, 2200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final now = DateTime.now().toUtc();
      final weekStartAt = now.subtract(const Duration(days: 1));
      final weekEndAt = now.add(const Duration(days: 6));
      final allDatesGame = _game(
        id: 'mlb-all-dates',
        scheduledAt: now.add(const Duration(days: 3)),
        awayTeam: const Team(
          id: 'lake-wolves',
          name: 'Lake Wolves',
          shortName: 'Wolves',
          abbreviation: 'LW',
        ),
        homeTeam: const Team(
          id: 'metro-stars',
          name: 'Metro Stars',
          shortName: 'Stars',
          abbreviation: 'MS',
        ),
        venueName: 'Harbor Ballpark',
        statusDetail: 'First pitch delayed',
        broadcast: 'National Stream',
        eventDetail: 'Doubleheader · Game 2',
        awayScore: 3,
        homeScore: 5,
        rescheduledToLeagueGameId: 'mlb-rescheduled-game',
      );
      final doubleheaderFirstGame = _game(
        id: 'mlb-doubleheader-first',
        scheduledAt: now.add(const Duration(days: 3, hours: -3)),
        awayTeam: allDatesGame.awayTeam,
        homeTeam: allDatesGame.homeTeam,
        venueName: 'Harbor Ballpark',
        eventDetail: 'Doubleheader · Game 1',
      );
      final tbdGame = _game(
        id: 'mlb-time-tbd',
        scheduledAt: null,
        scheduledDayEastern: DateFormat(
          'yyyy-MM-dd',
        ).format(now.toUtc().add(const Duration(days: 4))),
        timeTbd: true,
        selectable: true,
        selectionReason: null,
        awayTeam: const Team(
          id: 'north-pines',
          name: 'North Pines',
          shortName: 'Pines',
          abbreviation: 'NP',
        ),
        homeTeam: const Team(
          id: 'river-herons',
          name: 'River Herons',
          shortName: 'Herons',
          abbreviation: 'RH',
        ),
        venueName: 'River Field',
      );
      final filteredGame = _game(
        id: 'mlb-filtered-date',
        scheduledAt: now.add(const Duration(days: 2)),
        awayTeam: const Team(
          id: 'coast-caps',
          name: 'Coast Caps',
          shortName: 'Caps',
          abbreviation: 'CC',
        ),
        homeTeam: const Team(
          id: 'prairie-bats',
          name: 'Prairie Bats',
          shortName: 'Bats',
          abbreviation: 'PB',
        ),
        venueName: 'Prairie Field',
      );
      final footballGame = _game(
        id: 'nfl-week-game',
        scheduledAt: now.add(const Duration(days: 4)),
        sportCode: 'football',
        leagueCode: 'nfl',
        leagueName: 'National Football League',
        awayTeam: const Team(
          id: 'summit-foxes',
          name: 'Summit Foxes',
          shortName: 'Foxes',
          abbreviation: 'SF',
        ),
        homeTeam: const Team(
          id: 'valley-owls',
          name: 'Valley Owls',
          shortName: 'Owls',
          abbreviation: 'VO',
        ),
        venueName: 'Valley Stadium',
      );
      final calls = <_CatalogCall>[];
      final repository = _MockLeagueRepository();
      final auth = _MockFirebaseAuth();
      final user = _MockUser();

      when(() => user.uid).thenReturn('owner');
      when(() => user.displayName).thenReturn('Connected Owner');
      when(() => auth.currentUser).thenReturn(user);
      when(auth.authStateChanges).thenAnswer((_) => const Stream.empty());
      when(repository.findActiveLeagueIds).thenAnswer((_) async => const []);
      _stubArena(repository, weekStartAt: weekStartAt, weekEndAt: weekEndAt);
      when(
        () => repository.listSportsCatalog(
          leagueId: 'league-1',
          weekId: 'week-0001',
          query: any(named: 'query'),
          timezone: any(named: 'timezone'),
          weekStartAt: any(named: 'weekStartAt'),
          weekEndAt: any(named: 'weekEndAt'),
          forceRefresh: any(named: 'forceRefresh'),
        ),
      ).thenAnswer((invocation) async {
        final requestedQuery =
            invocation.namedArguments[#query] as CatalogQuery?;
        final query = requestedQuery;
        calls.add(
          _CatalogCall(
            query: query,
            timezone: invocation.namedArguments[#timezone] as String?,
            weekStartAt: invocation.namedArguments[#weekStartAt] as DateTime?,
            weekEndAt: invocation.namedArguments[#weekEndAt] as DateTime?,
            forceRefresh:
                invocation.namedArguments[#forceRefresh] as bool? ?? false,
          ),
        );
        final effectiveQuery =
            query ??
            _queryForMode(
              CatalogDateMode.allDates,
              nowUtc: DateTime.now().toUtc(),
              weekStartAt: weekStartAt,
              weekEndAt: weekEndAt,
            );
        final games = effectiveQuery.leagueCode == 'nfl'
            ? [footballGame]
            : effectiveQuery.dateMode == CatalogDateMode.allDates
            ? [doubleheaderFirstGame, allDatesGame, tbdGame]
            : [filteredGame];
        final visibleSports = requestedQuery == null
            ? const [
                CatalogSport(code: 'baseball', displayName: 'Baseball'),
                CatalogSport(code: 'football', displayName: 'Football'),
              ]
            : [
                requestedQuery.sportCode == 'football'
                    ? const CatalogSport(
                        code: 'football',
                        displayName: 'Football',
                      )
                    : const CatalogSport(
                        code: 'baseball',
                        displayName: 'Baseball',
                      ),
              ];
        final visibleLeagues = requestedQuery == null
            ? const [
                CatalogLeague(
                  code: 'mlb',
                  displayName: 'MLB',
                  sportCode: 'baseball',
                  providerLeagueId: providerLeagueId,
                  provider: 'sportsDataIo',
                  season: season,
                ),
                CatalogLeague(
                  code: 'nfl',
                  displayName: 'NFL',
                  sportCode: 'football',
                  providerLeagueId: footballProviderLeagueId,
                  provider: 'sportsDataIo',
                  season: season,
                ),
              ]
            : requestedQuery.sportCode == 'football'
            ? const [
                CatalogLeague(
                  code: 'nfl',
                  displayName: 'NFL',
                  sportCode: 'football',
                  providerLeagueId: footballProviderLeagueId,
                  provider: 'sportsDataIo',
                  season: season,
                ),
              ]
            : const [
                CatalogLeague(
                  code: 'mlb',
                  displayName: 'MLB',
                  sportCode: 'baseball',
                  providerLeagueId: providerLeagueId,
                  provider: 'sportsDataIo',
                  season: season,
                ),
              ];
        return SportsCatalogResult(
          provider: 'sportsDataIo',
          supportedSports: visibleSports,
          supportedLeagues: visibleLeagues,
          games: games,
          cacheHit: false,
          stale: false,
          delayed: false,
          cachedAt: DateTime.now().toUtc(),
          expiresAt: DateTime.now().toUtc().add(const Duration(hours: 1)),
          effectiveQuery: effectiveQuery.snapshot,
          availability: const CatalogAvailability(
            state: CatalogAvailabilityState.available,
          ),
          weekStartAt: weekStartAt,
          weekEndAt: weekEndAt,
        );
      });

      final controller = AppController.connected(
        runtimeMode: AppRuntimeMode.firebaseEmulator,
        repository: repository,
        auth: auth,
      );
      await tester.pump();
      expect(await controller.joinArena('ABC12345'), isTrue);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [appControllerProvider.overrideWith((ref) => controller)],
          child: const MaterialApp(home: Scaffold(body: CatalogScreen())),
        ),
      );
      await _pumpCatalogFrames(tester);

      expect(controller.catalogSports.map((sport) => sport.code), [
        'baseball',
        'football',
      ]);
      expect(controller.catalogLeagues.map((league) => league.code), [
        'mlb',
        'nfl',
      ]);
      expect(find.byKey(const Key('sport-filter-baseball')), findsOneWidget);
      expect(find.byKey(const Key('sport-filter-football')), findsOneWidget);
      expect(find.byKey(const Key('league-filter-mlb')), findsOneWidget);
      expect(find.text('Baseball'), findsOneWidget);
      expect(find.text('MLB'), findsOneWidget);
      expect(find.text('Football'), findsOneWidget);
      expect(find.text('Basketball'), findsNothing);
      expect(find.text('Soccer'), findsNothing);

      calls.clear();
      final baseballCall = await _tapAndReadCall(
        tester,
        calls,
        const Key('sport-filter-baseball'),
      );
      _expectCompleteQuery(
        baseballCall,
        mode: CatalogDateMode.allDates,
        beforeTap: baseballCall.$1,
        afterTap: baseballCall.$2,
        weekStartAt: weekStartAt,
        weekEndAt: weekEndAt,
      );

      final mlbCall = await _tapAndReadCall(
        tester,
        calls,
        const Key('league-filter-mlb'),
      );
      _expectCompleteQuery(
        mlbCall,
        mode: CatalogDateMode.allDates,
        beforeTap: mlbCall.$1,
        afterTap: mlbCall.$2,
        weekStartAt: weekStartAt,
        weekEndAt: weekEndAt,
      );

      for (final (key, mode) in const [
        (Key('date-filter-today'), CatalogDateMode.today),
        (Key('date-filter-tomorrow'), CatalogDateMode.tomorrow),
        (Key('date-filter-later'), CatalogDateMode.later),
        (Key('date-filter-allDates'), CatalogDateMode.allDates),
      ]) {
        final call = await _tapAndReadCall(tester, calls, key);
        _expectCompleteQuery(
          call,
          mode: mode,
          beforeTap: call.$1,
          afterTap: call.$2,
          weekStartAt: weekStartAt,
          weekEndAt: weekEndAt,
        );
      }

      expect(find.text('Lake Wolves'), findsNWidgets(2));
      expect(find.text('Metro Stars'), findsNWidgets(2));
      expect(find.text('LW'), findsWidgets);
      expect(find.text('MS'), findsWidgets);
      expect(find.text('Major League Baseball'), findsNWidgets(3));
      expect(find.text('Scheduled'), findsNWidgets(3));
      expect(find.textContaining('Harbor Ballpark'), findsNWidgets(2));
      expect(
        find.byKey(const Key('catalog-checkbox-mlb-doubleheader-first')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('catalog-checkbox-mlb-all-dates')),
        findsOneWidget,
      );
      expect(
        tester
            .widget<Text>(
              find.byKey(const Key('catalog-away-score-mlb-all-dates')),
            )
            .data,
        '3',
      );
      expect(
        tester
            .widget<Text>(
              find.byKey(const Key('catalog-home-score-mlb-all-dates')),
            )
            .data,
        '5',
      );
      final localStart = allDatesGame.scheduledAtUtc!.toLocal();
      final localZone = localStart.timeZoneName.trim();
      final expectedLocalTime =
          '${DateFormat('EEE, MMM d · h:mm a').format(localStart)} '
          '${localZone.isEmpty ? 'local time' : localZone} · Harbor Ballpark';
      expect(
        tester
            .widget<Text>(
              find.byKey(const Key('catalog-game-time-mlb-all-dates')),
            )
            .data,
        expectedLocalTime,
      );
      final tbdTime = tester
          .widget<Text>(find.byKey(const Key('catalog-game-time-mlb-time-tbd')))
          .data;
      expect(tbdTime, contains('Time TBD (Eastern)'));
      final tbdCheckbox = tester.widget<Checkbox>(
        find.byKey(const Key('catalog-checkbox-mlb-time-tbd')),
      );
      expect(tbdCheckbox.onChanged, isNull);
      expect(controller.isCatalogGameSelectable(tbdGame), isFalse);
      expect(controller.selectedGameIds, isEmpty);
      final confirmTimeButton = find.byKey(
        const Key('catalog-confirm-time-mlb-time-tbd'),
      );
      expect(confirmTimeButton, findsOneWidget);
      await tester.tap(confirmTimeButton);
      await tester.pumpAndSettle();
      expect(find.text('Confirm kickoff and add'), findsOneWidget);
      expect(find.text('Tap to enter the verified kickoff'), findsOneWidget);
      final dialogTextFields = find.descendant(
        of: find.byType(AlertDialog),
        matching: find.byType(TextField),
      );
      expect(
        tester.widget<TextField>(dialogTextFields.first).controller?.text,
        'North Pines',
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Add to slate'));
      await tester.pump();
      expect(
        find.text('Confirm the published kickoff date and time first.'),
        findsOneWidget,
      );
      await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<Text>(
              find.byKey(const Key('catalog-game-context-mlb-all-dates')),
            )
            .data,
        'Doubleheader · Game 2 · First pitch delayed · Broadcast: National Stream · '
        'Rescheduled to game mlb-rescheduled-game; this selection is not replaced automatically',
      );

      final visibleQuery = controller.activeCatalogQuery!;
      final refreshCall = await _tapAndReadCall(
        tester,
        calls,
        const Key('refresh-catalog-button'),
      );
      expect(refreshCall.$3.forceRefresh, isTrue);
      expect(refreshCall.$3.query?.forceRefresh, isTrue);
      expect(refreshCall.$3.query?.sameVisibleQuery(visibleQuery), isTrue);

      final allDatesCheckbox = find.byKey(
        const Key('catalog-checkbox-mlb-all-dates'),
      );
      await tester.tap(allDatesCheckbox);
      await tester.pump();
      expect(controller.selectedGameIds, {'mlb-all-dates'});
      expect(find.textContaining('1 game selected'), findsOneWidget);
      expect(tester.widget<Checkbox>(allDatesCheckbox).value, isTrue);

      final footballCall = await _tapAndReadCall(
        tester,
        calls,
        const Key('sport-filter-football'),
      );
      _expectCompleteQuery(
        footballCall,
        mode: CatalogDateMode.allDates,
        beforeTap: footballCall.$1,
        afterTap: footballCall.$2,
        weekStartAt: weekStartAt,
        weekEndAt: weekEndAt,
        sportCode: 'football',
        leagueCode: 'nfl',
        providerLeagueId: footballProviderLeagueId,
      );
      expect(controller.selectedGameIds, {'mlb-all-dates'});
      final footballCheckbox = find.byKey(
        const Key('catalog-checkbox-nfl-week-game'),
      );
      expect(footballCheckbox, findsOneWidget);
      await tester.tap(footballCheckbox);
      await tester.pump();
      expect(controller.selectedGameIds, {'mlb-all-dates', 'nfl-week-game'});

      await _tapAndReadCall(tester, calls, const Key('sport-filter-baseball'));
      expect(controller.selectedGameIds, {'mlb-all-dates', 'nfl-week-game'});
      expect(
        tester
            .widget<Checkbox>(
              find.byKey(const Key('catalog-checkbox-mlb-all-dates')),
            )
            .value,
        isTrue,
      );

      await _tapAndReadCall(tester, calls, const Key('sport-filter-football'));
      final retainedFootballCheckbox = find.byKey(
        const Key('catalog-checkbox-nfl-week-game'),
      );
      expect(tester.widget<Checkbox>(retainedFootballCheckbox).value, isTrue);
      await tester.tap(retainedFootballCheckbox);
      await tester.pump();
      expect(controller.selectedGameIds, {'mlb-all-dates'});
      await _tapAndReadCall(tester, calls, const Key('sport-filter-baseball'));

      final todayCall = await _tapAndReadCall(
        tester,
        calls,
        const Key('date-filter-today'),
      );
      _expectCompleteQuery(
        todayCall,
        mode: CatalogDateMode.today,
        beforeTap: todayCall.$1,
        afterTap: todayCall.$2,
        weekStartAt: weekStartAt,
        weekEndAt: weekEndAt,
      );
      expect(
        find.byKey(const Key('catalog-checkbox-mlb-all-dates')),
        findsNothing,
      );
      expect(
        find.byKey(const Key('catalog-checkbox-mlb-filtered-date')),
        findsOneWidget,
      );
      expect(controller.selectedGameIds, {'mlb-all-dates'});
      expect(
        controller.selectedDraftGamesById['mlb-all-dates'],
        same(allDatesGame),
      );
      expect(find.textContaining('1 game selected'), findsOneWidget);

      final filteredCheckbox = find.byKey(
        const Key('catalog-checkbox-mlb-filtered-date'),
      );
      await tester.tap(filteredCheckbox);
      await tester.pump();
      expect(controller.selectedGameIds, {
        'mlb-all-dates',
        'mlb-filtered-date',
      });
      expect(find.textContaining('2 games selected'), findsOneWidget);
      await tester.tap(filteredCheckbox);
      await tester.pump();
      expect(controller.selectedGameIds, {'mlb-all-dates'});
      expect(find.textContaining('1 game selected'), findsOneWidget);

      await _tapAndReadCall(tester, calls, const Key('date-filter-allDates'));
      final restoredCheckbox = find.byKey(
        const Key('catalog-checkbox-mlb-all-dates'),
      );
      expect(tester.widget<Checkbox>(restoredCheckbox).value, isTrue);
      expect(controller.selectedGameIds, {'mlb-all-dates'});

      final tomorrowCall = await _tapAndReadCall(
        tester,
        calls,
        const Key('date-filter-tomorrow'),
      );
      final tomorrowQuery = tomorrowCall.$3.query!;
      final nextDayCall = await _tapAndReadCall(
        tester,
        calls,
        const Key('catalog-next-day-button'),
      );
      final nextDayQuery = nextDayCall.$3.query!;
      expect(nextDayQuery.dateMode, CatalogDateMode.custom);
      expect(
        nextDayQuery.from,
        tomorrowQuery.from.add(const Duration(days: 1)),
      );
      expect(nextDayQuery.to, nextDayQuery.from);
      expect(controller.selectedGameIds, {'mlb-all-dates'});

      await tester.pumpWidget(
        ProviderScope(
          overrides: [appControllerProvider.overrideWith((ref) => controller)],
          child: const MaterialApp(
            home: Scaffold(body: CatalogScreen(key: Key('rehydrated-catalog'))),
          ),
        ),
      );
      await _pumpCatalogFrames(tester);
      expect(
        controller.activeCatalogQuery?.sameVisibleQuery(nextDayQuery),
        isTrue,
      );
      expect(
        tester
            .widget<ChoiceChip>(find.byKey(const Key('date-filter-allDates')))
            .selected,
        isFalse,
      );
      expect(find.byKey(const Key('catalog-single-day-label')), findsOneWidget);
      expect(controller.selectedGameIds, {'mlb-all-dates'});

      final inheritedCustomSwitch = await _tapAndReadCall(
        tester,
        calls,
        const Key('sport-filter-football'),
      );
      expect(inheritedCustomSwitch.$3.query?.dateMode, CatalogDateMode.custom);
      expect(inheritedCustomSwitch.$3.query?.from, nextDayQuery.from);
      expect(inheritedCustomSwitch.$3.query?.to, nextDayQuery.to);
      await _tapAndReadCall(tester, calls, const Key('sport-filter-baseball'));

      final previousDayCall = await _tapAndReadCall(
        tester,
        calls,
        const Key('catalog-previous-day-button'),
      );
      final previousDayQuery = previousDayCall.$3.query!;
      expect(previousDayQuery.dateMode, CatalogDateMode.custom);
      expect(previousDayQuery.from, tomorrowQuery.from);
      expect(previousDayQuery.to, tomorrowQuery.to);
      expect(controller.selectedGameIds, {'mlb-all-dates'});
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'CBS college football keeps weekly metadata, groups dates, and refreshes in place',
    (tester) async {
      tester.view.physicalSize = const Size(1440, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final weekStartAt = DateTime.utc(2026, 8, 24, 5);
      final weekEndAt = DateTime.utc(2026, 9, 1, 4, 59);
      final fridayKickoff = DateTime.utc(2026, 8, 29, 4, 30);
      final saturdayKickoff = DateTime.utc(2026, 8, 29, 17);
      const metadata = CollegeFootballCatalogMetadata(
        activeSeason: 2026,
        activeSeasonType: 'regular',
        activeWeek: 1,
        division: 'FBS',
        seasons: [2026],
        seasonTypes: ['regular'],
        minimumWeek: 1,
        maximumWeek: 1,
      );
      final fridayGame = _game(
        id: 'cbs-friday',
        provider: 'cbsSports',
        scheduledAt: fridayKickoff,
        sportCode: 'NCAAF',
        leagueCode: 'ncaaf',
        leagueName: 'NCAA Football',
        awayTeam: const Team(
          id: 'away-friday',
          name: 'Away Friday',
          shortName: 'Friday',
          abbreviation: 'AFR',
        ),
        homeTeam: const Team(
          id: 'home-friday',
          name: 'Home Friday',
          shortName: 'Friday',
          abbreviation: 'HFR',
        ),
        venueName: 'Memorial Stadium',
      );
      final saturdayGame = _game(
        id: 'cbs-saturday',
        provider: 'cbsSports',
        scheduledAt: saturdayKickoff,
        sportCode: 'NCAAF',
        leagueCode: 'ncaaf',
        leagueName: 'NCAA Football',
        awayTeam: const Team(
          id: 'away-saturday',
          name: 'Away Saturday',
          shortName: 'Saturday',
          abbreviation: 'ASA',
        ),
        homeTeam: const Team(
          id: 'home-saturday',
          name: 'Home Saturday',
          shortName: 'Saturday',
          abbreviation: 'HSA',
        ),
        venueName: 'College Field',
      );
      final tbdGame = _game(
        id: 'cbs-time-tbd',
        provider: 'cbsSports',
        scheduledAt: null,
        scheduledDayEastern: '2026-08-30',
        timeTbd: true,
        kickoffDisplayText: '7:30 PM',
        sportCode: 'NCAAF',
        leagueCode: 'ncaaf',
        leagueName: 'NCAA Football',
        awayTeam: const Team(
          id: 'away-tbd',
          name: 'Away TBD',
          shortName: 'Away TBD',
          abbreviation: 'ATB',
        ),
        homeTeam: const Team(
          id: 'home-tbd',
          name: 'Home TBD',
          shortName: 'Home TBD',
          abbreviation: 'HTB',
        ),
        venueName: 'TBD Field',
      );
      final initialQuery = CatalogQuery(
        sportCode: 'NCAAF',
        leagueCode: 'ncaaf',
        providerLeagueId: 'FBS',
        season: '2026',
        seasonType: 'regular',
        week: 1,
        division: 'FBS',
        collegeFootball: metadata,
        from: DateTime.utc(2026, 8, 25),
        to: DateTime.utc(2026, 8, 31),
        timezone: 'America/Chicago',
        dateMode: CatalogDateMode.allDates,
        weekStartAt: weekStartAt,
        weekEndAt: weekEndAt,
      );
      final calls = <_CatalogCall>[];
      Completer<SportsCatalogResult>? refreshCompleter;
      final repository = _MockLeagueRepository();
      final auth = _MockFirebaseAuth();
      final user = _MockUser();

      SportsCatalogResult resultFor(CatalogQuery query, {bool stale = true}) =>
          SportsCatalogResult(
            provider: 'cbsSports',
            supportedSports: const [
              CatalogSport(code: 'NCAAF', displayName: 'College Football'),
            ],
            supportedLeagues: const [
              CatalogLeague(
                code: 'ncaaf',
                displayName: 'NCAA Football',
                sportCode: 'NCAAF',
                providerLeagueId: 'FBS',
                provider: 'cbsSports',
                season: '2026',
                seasonType: 'regular',
                week: 1,
                division: 'FBS',
              ),
            ],
            games: [fridayGame, saturdayGame, tbdGame],
            cacheHit: true,
            stale: stale,
            delayed: false,
            cachedAt: DateTime.utc(2026, 8, 25, 19, 15),
            expiresAt: DateTime.now().toUtc().add(const Duration(hours: 1)),
            presentation: CatalogPresentation(
              provider: 'cbsSports',
              attributionText: 'Schedule source: CBS Sports',
              allowRemoteLogos: true,
              allowedLogoHosts: const {'sports.cbsimg.net'},
              allowedLogoQueryParameters: const {},
              logoRightsReviewDate: DateTime.utc(2026, 8, 25),
            ),
            effectiveQuery: query.copyWith(forceRefresh: false).snapshot,
            availability: const CatalogAvailability(
              state: CatalogAvailabilityState.available,
            ),
            collegeFootball: metadata,
            weekStartAt: weekStartAt,
            weekEndAt: weekEndAt,
          );

      when(() => user.uid).thenReturn('owner');
      when(() => user.displayName).thenReturn('Connected Owner');
      when(() => auth.currentUser).thenReturn(user);
      when(auth.authStateChanges).thenAnswer((_) => const Stream.empty());
      when(repository.findActiveLeagueIds).thenAnswer((_) async => const []);
      _stubArena(repository, weekStartAt: weekStartAt, weekEndAt: weekEndAt);
      when(
        () => repository.listSportsCatalog(
          leagueId: 'league-1',
          weekId: 'week-0001',
          query: any(named: 'query'),
          timezone: any(named: 'timezone'),
          weekStartAt: any(named: 'weekStartAt'),
          weekEndAt: any(named: 'weekEndAt'),
          forceRefresh: any(named: 'forceRefresh'),
        ),
      ).thenAnswer((invocation) async {
        final query =
            invocation.namedArguments[#query] as CatalogQuery? ?? initialQuery;
        calls.add(
          _CatalogCall(
            query: invocation.namedArguments[#query] as CatalogQuery?,
            timezone: invocation.namedArguments[#timezone] as String?,
            weekStartAt: invocation.namedArguments[#weekStartAt] as DateTime?,
            weekEndAt: invocation.namedArguments[#weekEndAt] as DateTime?,
            forceRefresh:
                invocation.namedArguments[#forceRefresh] as bool? ?? false,
          ),
        );
        if (query.forceRefresh) {
          refreshCompleter = Completer<SportsCatalogResult>();
          return refreshCompleter!.future;
        }
        return resultFor(query);
      });
      when(
        () => repository.saveDraftSlate(
          leagueId: 'league-1',
          weekId: 'week-0001',
          chunkKey: any(named: 'chunkKey'),
          games: any(named: 'games'),
          removeGameIds: any(named: 'removeGameIds'),
          requestId: any(named: 'requestId'),
        ),
      ).thenAnswer((_) async => 1);

      final controller = AppController.connected(
        runtimeMode: AppRuntimeMode.firebaseEmulator,
        repository: repository,
        auth: auth,
      );
      await tester.pump();
      expect(await controller.joinArena('ABC12345'), isTrue);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [appControllerProvider.overrideWith((ref) => controller)],
          child: const MaterialApp(home: Scaffold(body: CatalogScreen())),
        ),
      );
      await _pumpCatalogFrames(tester);

      expect(find.byKey(const Key('cbs-season-filter-2026')), findsOneWidget);
      expect(find.byKey(const Key('cbs-season-filter-2025')), findsNothing);
      expect(
        find.byKey(const Key('cbs-season-type-filter-postseason')),
        findsNothing,
      );
      expect(find.byKey(const Key('cbs-season-filter-2026')), findsOneWidget);
      expect(
        find.byKey(const Key('cbs-season-type-filter-regular')),
        findsOneWidget,
      );
      expect(find.byKey(const Key('cbs-week-filter-1')), findsOneWidget);
      expect(
        find.byKey(const Key('catalog-date-header-2026-08-28')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('catalog-date-header-2026-08-29')),
        findsOneWidget,
      );
      expect(find.text('Friday, August 28'), findsOneWidget);
      expect(find.text('Saturday, August 29'), findsOneWidget);
      expect(find.text('AFR'), findsNWidgets(2));
      expect(find.textContaining('Last updated:'), findsOneWidget);
      expect(
        find.textContaining('Showing the most recently saved schedule.'),
        findsOneWidget,
      );
      final zone = inLeagueTimezone(
        fridayKickoff,
        'America/Chicago',
      ).timeZoneName;
      expect(
        tester
            .widget<Text>(find.byKey(const Key('catalog-game-time-cbs-friday')))
            .data,
        '${formatLeagueTime(fridayKickoff, 'America/Chicago', 'EEE, MMM d · h:mm a')} '
        '$zone · Memorial Stadium',
      );
      expect(
        tester
            .widget<Text>(
              find.byKey(const Key('catalog-game-time-cbs-time-tbd')),
            )
            .data,
        contains('Time TBD (source shows 7:30 PM; timezone unconfirmed)'),
      );
      expect(
        tester
            .widget<Checkbox>(
              find.byKey(const Key('catalog-checkbox-cbs-time-tbd')),
            )
            .onChanged,
        isNull,
      );

      final seasonCall = await _tapAndReadCall(
        tester,
        calls,
        const Key('cbs-season-filter-2026'),
      );
      expect(seasonCall.$3.query?.season, '2026');
      final seasonTypeCall = await _tapAndReadCall(
        tester,
        calls,
        const Key('cbs-season-type-filter-regular'),
      );
      expect(seasonTypeCall.$3.query?.seasonType, 'regular');
      final weekCall = await _tapAndReadCall(
        tester,
        calls,
        const Key('cbs-week-filter-1'),
      );
      expect(weekCall.$3.query?.week, 1);
      expect(weekCall.$3.query?.division, 'FBS');
      final dateCall = await _tapAndReadCall(
        tester,
        calls,
        const Key('date-filter-today'),
      );
      expect(dateCall.$3.query?.season, '2026');
      expect(dateCall.$3.query?.seasonType, 'regular');
      expect(dateCall.$3.query?.week, 1);
      expect(dateCall.$3.query?.division, 'FBS');

      final callCount = calls.length;
      await tester.tap(find.byKey(const Key('refresh-catalog-button')));
      await tester.pump();
      expect(calls, hasLength(callCount + 1));
      expect(controller.catalogLoading, isTrue);
      expect(
        find.byKey(const Key('catalog-refreshing-indicator')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('catalog-checkbox-cbs-friday')),
        findsOneWidget,
      );
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.textContaining('Loading the NCAA Football'), findsNothing);

      final refreshQuery = calls.last.query!;
      refreshCompleter!.complete(resultFor(refreshQuery, stale: false));
      await _pumpCatalogFrames(tester);
      expect(controller.catalogLoading, isFalse);
      expect(
        find.byKey(const Key('catalog-refreshing-indicator')),
        findsNothing,
      );
      final refreshedCheckbox = find.byKey(
        const Key('catalog-checkbox-cbs-friday'),
      );
      expect(tester.widget<Checkbox>(refreshedCheckbox).onChanged, isNotNull);
      await tester.tap(refreshedCheckbox);
      await tester.pump();
      expect(controller.selectedGameIds, {'cbs-friday'});
      await tester.tap(refreshedCheckbox);
      await tester.pump();
      expect(controller.selectedGameIds, isEmpty);
      await tester.tap(refreshedCheckbox);
      await tester.pump();
      await tester.tap(find.byKey(const Key('save-draft-button')));
      await _pumpCatalogFrames(tester);
      verify(
        () => repository.saveDraftSlate(
          leagueId: 'league-1',
          weekId: 'week-0001',
          chunkKey: any(named: 'chunkKey'),
          games: any(
            named: 'games',
            that: predicate<List<Game>>(
              (games) => games.length == 1 && games.single.id == 'cbs-friday',
            ),
          ),
          removeGameIds: const [],
          requestId: any(named: 'requestId'),
        ),
      ).called(1);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'failed cross-provider switch still uses the selected league calendar',
    (tester) async {
      tester.view.physicalSize = const Size(1200, 2600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final weekStartAt = DateTime.utc(2030, 8, 24, 4, 30);
      final weekEndAt = DateTime.utc(2030, 8, 31, 4);
      final repository = _MockLeagueRepository();
      final auth = _MockFirebaseAuth();
      final user = _MockUser();
      when(() => user.uid).thenReturn('owner');
      when(() => user.displayName).thenReturn('Connected Owner');
      when(() => auth.currentUser).thenReturn(user);
      when(auth.authStateChanges).thenAnswer((_) => const Stream.empty());
      when(repository.findActiveLeagueIds).thenAnswer((_) async => const []);
      _stubArena(repository, weekStartAt: weekStartAt, weekEndAt: weekEndAt);
      when(
        () => repository.listSportsCatalog(
          leagueId: 'league-1',
          weekId: 'week-0001',
          query: any(named: 'query'),
          timezone: any(named: 'timezone'),
          weekStartAt: any(named: 'weekStartAt'),
          weekEndAt: any(named: 'weekEndAt'),
          forceRefresh: any(named: 'forceRefresh'),
        ),
      ).thenAnswer((invocation) async {
        final query = invocation.namedArguments[#query] as CatalogQuery?;
        if (query != null) {
          throw const RepositoryException(
            'unavailable',
            'The selected provider is temporarily unavailable.',
          );
        }
        final effectiveQuery = CatalogQuery(
          sportCode: 'baseball',
          leagueCode: 'mlb',
          providerLeagueId: providerLeagueId,
          season: '2030',
          from: catalogCalendarDate(weekStartAt, sportsDataIoCatalogTimezone),
          to: catalogCalendarDate(weekEndAt, sportsDataIoCatalogTimezone),
          timezone: sportsDataIoCatalogTimezone,
          dateMode: CatalogDateMode.allDates,
          weekStartAt: weekStartAt,
          weekEndAt: weekEndAt,
        );
        return SportsCatalogResult(
          provider: 'sportsDataIo',
          supportedSports: const [
            CatalogSport(code: 'baseball', displayName: 'Baseball'),
            CatalogSport(code: 'NCAAF', displayName: 'College Football'),
          ],
          supportedLeagues: const [
            CatalogLeague(
              code: 'mlb',
              displayName: 'MLB',
              sportCode: 'baseball',
              providerLeagueId: providerLeagueId,
              provider: 'sportsDataIo',
              season: '2030',
            ),
            CatalogLeague(
              code: 'ncaaf',
              displayName: 'NCAA Football',
              sportCode: 'NCAAF',
              providerLeagueId: 'FBS',
              provider: 'cbsSports',
              season: '2030',
              seasonType: 'regular',
              week: 1,
              division: 'FBS',
            ),
          ],
          games: const [],
          cacheHit: true,
          stale: false,
          delayed: false,
          cachedAt: DateTime.utc(2030, 8, 23),
          expiresAt: DateTime.utc(2030, 8, 24),
          effectiveQuery: effectiveQuery.snapshot,
          availability: const CatalogAvailability(
            state: CatalogAvailabilityState.noGames,
          ),
          weekStartAt: weekStartAt,
          weekEndAt: weekEndAt,
        );
      });

      final controller = AppController.connected(
        runtimeMode: AppRuntimeMode.firebaseEmulator,
        repository: repository,
        auth: auth,
      );
      await tester.pump();
      expect(await controller.joinArena('ABC12345'), isTrue);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [appControllerProvider.overrideWith((ref) => controller)],
          child: const MaterialApp(home: Scaffold(body: CatalogScreen())),
        ),
      );
      await _pumpCatalogFrames(tester);

      final sportsDataDay = catalogCalendarDate(
        weekStartAt,
        sportsDataIoCatalogTimezone,
      );
      final cbsDay = catalogCalendarDate(weekStartAt, 'America/Chicago');
      expect(sportsDataDay, isNot(cbsDay));
      expect(
        find.text(DateFormat('EEE, MMM d').format(sportsDataDay)),
        findsOneWidget,
      );

      await tester.tap(find.byKey(const Key('sport-filter-NCAAF')));
      await _pumpCatalogFrames(tester);
      expect(controller.catalogProvider, 'sportsDataIo');
      expect(
        find.byKey(const Key('cbs-season-type-filter-postseason')),
        findsNothing,
      );
      expect(find.byKey(const Key('cbs-week-filter-0')), findsNothing);
      expect(find.byKey(const Key('cbs-week-filter-1')), findsOneWidget);
      expect(
        find.text(DateFormat('EEE, MMM d').format(cbsDay)),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'commissioner sees actionable SportsDataIO server configuration guidance',
    (tester) async {
      final controller = await _pumpCredentialFailureCatalog(
        tester,
        role: LeagueRole.commissioner,
        reason: sportsDataIoApiKeyConfigurationReason,
        message: 'SportsDataIO API key is not configured.',
      );

      expect(
        controller.catalogAvailability.state,
        CatalogAvailabilityState.providerConfigurationRequired,
      );
      expect(
        find.text('Live sports data needs administrator configuration.'),
        findsOneWidget,
      );
      expect(
        find.textContaining('server-side SportsDataIO key'),
        findsOneWidget,
      );
      expect(find.textContaining('league feed entitlement'), findsOneWidget);
      expect(find.text('Schedule access is unavailable.'), findsNothing);
      expect(find.textContaining('sensitive upstream body'), findsNothing);
    },
  );

  testWidgets(
    'ordinary weekly picker does not see provider credential guidance',
    (tester) async {
      final controller = await _pumpCredentialFailureCatalog(
        tester,
        role: LeagueRole.member,
        reason: sportsDataIoEntitlementConfigurationReason,
        message:
            'SportsDataIO league feed entitlement needs administrator '
            'configuration.',
      );

      expect(controller.canAdmin, isFalse);
      expect(controller.canDraftSlate, isTrue);
      expect(
        controller.catalogAvailability.state,
        CatalogAvailabilityState.providerConfigurationRequired,
      );
      expect(find.text('Live sports data is unavailable.'), findsOneWidget);
      expect(find.textContaining('Ask an arena commissioner'), findsOneWidget);
      expect(find.textContaining('SportsDataIO'), findsNothing);
      expect(find.textContaining('server-side'), findsNothing);
    },
  );
}

Future<AppController> _pumpCredentialFailureCatalog(
  WidgetTester tester, {
  required LeagueRole role,
  required String reason,
  required String message,
}) async {
  tester.view.physicalSize = const Size(1200, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final now = DateTime.now().toUtc();
  final weekStartAt = now.subtract(const Duration(days: 1));
  final weekEndAt = now.add(const Duration(days: 6));
  final repository = _MockLeagueRepository();
  final auth = _MockFirebaseAuth();
  final user = _MockUser();
  when(() => user.uid).thenReturn('owner');
  when(() => user.displayName).thenReturn('Connected User');
  when(() => auth.currentUser).thenReturn(user);
  when(auth.authStateChanges).thenAnswer((_) => const Stream.empty());
  when(repository.findActiveLeagueIds).thenAnswer((_) async => const []);
  _stubArena(
    repository,
    weekStartAt: weekStartAt,
    weekEndAt: weekEndAt,
    role: role,
  );
  when(
    () => repository.listSportsCatalog(
      leagueId: 'league-1',
      weekId: 'week-0001',
      query: any(named: 'query'),
      timezone: any(named: 'timezone'),
      weekStartAt: any(named: 'weekStartAt'),
      weekEndAt: any(named: 'weekEndAt'),
      forceRefresh: any(named: 'forceRefresh'),
    ),
  ).thenThrow(
    RepositoryException('failed-precondition', message, reason: reason),
  );

  final controller = AppController.connected(
    runtimeMode: AppRuntimeMode.firebaseEmulator,
    repository: repository,
    auth: auth,
  );
  await tester.pump();
  expect(await controller.joinArena('ABC12345'), isTrue);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [appControllerProvider.overrideWith((ref) => controller)],
      child: const MaterialApp(home: Scaffold(body: CatalogScreen())),
    ),
  );
  await _pumpCatalogFrames(tester);
  return controller;
}

/// Returns the instants surrounding the tap plus the single resulting call.
Future<(DateTime, DateTime, _CatalogCall)> _tapAndReadCall(
  WidgetTester tester,
  List<_CatalogCall> calls,
  Key key,
) async {
  final callCount = calls.length;
  final beforeTap = DateTime.now().toUtc();
  await tester.tap(find.byKey(key));
  await _pumpCatalogFrames(tester);
  final afterTap = DateTime.now().toUtc();
  expect(calls, hasLength(callCount + 1));
  return (beforeTap, afterTap, calls.last);
}

Future<void> _pumpCatalogFrames(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 20));
  await tester.pump();
}

void _expectCompleteQuery(
  (DateTime, DateTime, _CatalogCall) captured, {
  required CatalogDateMode mode,
  required DateTime beforeTap,
  required DateTime afterTap,
  required DateTime weekStartAt,
  required DateTime weekEndAt,
  String sportCode = 'baseball',
  String leagueCode = 'mlb',
  String providerLeagueId = '4424',
}) {
  final call = captured.$3;
  final query = call.query;
  expect(query, isNotNull);
  expect(query!.sportCode, sportCode);
  expect(query.leagueCode, leagueCode);
  expect(query.providerLeagueId, providerLeagueId);
  expect(query.season, '2026');
  expect(query.timezone, sportsDataIoCatalogTimezone);
  expect(query.dateMode, mode);
  expect(query.weekStartAt, weekStartAt);
  expect(query.weekEndAt, weekEndAt);
  expect(call.timezone, sportsDataIoCatalogTimezone);
  expect(call.weekStartAt, weekStartAt);
  expect(call.weekEndAt, weekEndAt);
  expect(call.forceRefresh, isFalse);

  final beforeWindow = catalogDateWindow(
    mode: mode,
    nowUtc: beforeTap,
    timezone: sportsDataIoCatalogTimezone,
    weekStartAt: weekStartAt,
    weekEndAt: weekEndAt,
  );
  final afterWindow = catalogDateWindow(
    mode: mode,
    nowUtc: afterTap,
    timezone: sportsDataIoCatalogTimezone,
    weekStartAt: weekStartAt,
    weekEndAt: weekEndAt,
  );
  expect(beforeWindow, isNotNull);
  expect(afterWindow, isNotNull);
  final matchesBefore =
      query.from == beforeWindow!.from && query.to == beforeWindow.to;
  final matchesAfter =
      query.from == afterWindow!.from && query.to == afterWindow.to;
  expect(matchesBefore || matchesAfter, isTrue);
  expect(query.from.isUtc, isTrue);
  expect(query.to.isUtc, isTrue);
  expect(query.to.difference(query.from).inDays, lessThan(7));

  final firstActiveDate = catalogCalendarDate(
    weekStartAt,
    sportsDataIoCatalogTimezone,
  );
  final lastActiveDate = catalogCalendarDate(
    weekEndAt,
    sportsDataIoCatalogTimezone,
  );
  expect(query.from.isBefore(firstActiveDate), isFalse);
  expect(query.to.isAfter(lastActiveDate), isFalse);
}

CatalogQuery _queryForMode(
  CatalogDateMode mode, {
  required DateTime nowUtc,
  required DateTime weekStartAt,
  required DateTime weekEndAt,
}) {
  final window = catalogDateWindow(
    mode: mode,
    nowUtc: nowUtc,
    timezone: sportsDataIoCatalogTimezone,
    weekStartAt: weekStartAt,
    weekEndAt: weekEndAt,
  )!;
  return CatalogQuery(
    sportCode: 'baseball',
    leagueCode: 'mlb',
    providerLeagueId: '4424',
    season: '2026',
    from: window.from,
    to: window.to,
    timezone: sportsDataIoCatalogTimezone,
    dateMode: mode,
    weekStartAt: weekStartAt,
    weekEndAt: weekEndAt,
  );
}

void _stubArena(
  _MockLeagueRepository repository, {
  required DateTime weekStartAt,
  required DateTime weekEndAt,
  LeagueRole role = LeagueRole.owner,
}) {
  const league = LeagueSummary(
    id: 'league-1',
    name: 'Connected Arena',
    timezone: 'America/Chicago',
    currentWeekId: 'week-0001',
    currentPickerUid: 'owner',
    pickerParticipatesInPicks: false,
    pickLockPolicy: PickLockPolicy.perGame,
  );
  final week = WeekSummary(
    id: 'week-0001',
    sequentialNumber: 1,
    label: 'Week 1',
    pickerUid: 'owner',
    status: 'draft',
    startAt: weekStartAt,
    endAt: weekEndAt,
    finalizedAt: null,
    winnerUids: const [],
    highScore: null,
    pickerParticipatesInPicks: false,
    lockPolicy: PickLockPolicy.perGame,
    selectedGameCount: 0,
    eligibleMemberCount: 0,
  );
  final member = LeagueMember(
    uid: 'owner',
    displayName: 'Connected Owner',
    role: role,
    status: MemberStatus.active,
    rotationOrder: 0,
    joinedAt: DateTime.now().toUtc(),
  );

  when(
    () => repository.joinLeagueByCode(
      inviteCode: any(named: 'inviteCode'),
      nickname: any(named: 'nickname'),
    ),
  ).thenAnswer((_) async => 'league-1');
  when(
    () => repository.watchLeague('league-1'),
  ).thenAnswer((_) => Stream.value(league));
  when(
    () => repository.watchMembers('league-1'),
  ).thenAnswer((_) => Stream.value([member]));
  when(
    () => repository.watchStandings('league-1'),
  ).thenAnswer((_) => Stream.value(const <Standing>[]));
  when(
    () => repository.watchFinalizedWeeks('league-1'),
  ).thenAnswer((_) => Stream.value(const <WeekSummary>[]));
  when(
    () => repository.watchWeek('league-1', 'week-0001'),
  ).thenAnswer((_) => Stream.value(week));
  when(
    () => repository.watchWeekGames('league-1', 'week-0001'),
  ).thenAnswer((_) => Stream.value(const <Game>[]));
  when(
    () => repository.watchPublicEntries('league-1', 'week-0001'),
  ).thenAnswer((_) => Stream.value(const <EntrySummary>[]));
  when(
    () => repository.watchOwnPrivatePicks('league-1', 'week-0001'),
  ).thenAnswer((_) => Stream.value(const <Pick>[]));
}

Game _game({
  required String id,
  required DateTime? scheduledAt,
  required Team awayTeam,
  required Team homeTeam,
  required String venueName,
  String provider = 'sportsDataIo',
  String sportCode = 'baseball',
  String leagueCode = 'mlb',
  String leagueName = 'Major League Baseball',
  String? scheduledDayEastern,
  bool timeTbd = false,
  String? kickoffDisplayText,
  String? statusDetail,
  String? broadcast,
  String? eventDetail,
  int? awayScore,
  int? homeScore,
  String? rescheduledFromLeagueGameId,
  String? rescheduledToLeagueGameId,
  bool? selectable,
  String? selectionReason,
}) => Game(
  id: id,
  provider: provider,
  providerGameId: id,
  sportCode: sportCode,
  leagueCode: leagueCode,
  leagueName: leagueName,
  season: '2026',
  scheduledAtUtc: scheduledAt,
  publishedScheduledAtUtc: timeTbd ? null : scheduledAt,
  effectiveLockAtUtc: timeTbd ? null : scheduledAt,
  scheduledDayEastern: scheduledDayEastern,
  timeTbd: timeTbd,
  kickoffDisplayText: kickoffDisplayText,
  venueName: venueName,
  homeTeam: homeTeam,
  awayTeam: awayTeam,
  status: GameStatus.scheduled,
  statusDetail: statusDetail,
  awayScore: awayScore,
  homeScore: homeScore,
  broadcast: broadcast,
  eventDetail: eventDetail,
  rescheduledFromLeagueGameId: rescheduledFromLeagueGameId,
  rescheduledToLeagueGameId: rescheduledToLeagueGameId,
  providerLastUpdatedAt: DateTime.now().toUtc(),
  lastSyncedAt: DateTime.now().toUtc(),
  resultVersion: 1,
  sourcePayloadHash:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  selectable: selectable,
  selectionReason: selectionReason,
);
