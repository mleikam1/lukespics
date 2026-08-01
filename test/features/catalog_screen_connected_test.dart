import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/app/bootstrap.dart';
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
      tester.view.physicalSize = const Size(1440, 1200);
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
        final query = invocation.namedArguments[#query] as CatalogQuery?;
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
        final games = effectiveQuery.dateMode == CatalogDateMode.allDates
            ? [allDatesGame]
            : [filteredGame];
        return SportsCatalogResult(
          provider: 'theSportsDbTest',
          supportedSports: const [
            CatalogSport(code: 'baseball', displayName: 'Baseball'),
          ],
          supportedLeagues: const [
            CatalogLeague(
              code: 'mlb',
              displayName: 'MLB',
              sportCode: 'baseball',
              providerLeagueId: providerLeagueId,
              season: season,
            ),
          ],
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

      expect(controller.catalogSports.map((sport) => sport.code), ['baseball']);
      expect(controller.catalogLeagues.map((league) => league.code), ['mlb']);
      expect(find.byKey(const Key('sport-filter-baseball')), findsOneWidget);
      expect(find.byKey(const Key('league-filter-mlb')), findsOneWidget);
      expect(find.text('Baseball'), findsOneWidget);
      expect(find.text('MLB'), findsOneWidget);
      expect(find.text('Football'), findsNothing);
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

      expect(find.text('Lake Wolves'), findsOneWidget);
      expect(find.text('Metro Stars'), findsOneWidget);
      expect(find.text('LW'), findsWidgets);
      expect(find.text('MS'), findsWidgets);
      expect(find.text('Major League Baseball'), findsOneWidget);
      expect(find.text('Scheduled'), findsOneWidget);
      expect(find.textContaining('Harbor Ballpark'), findsOneWidget);

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
      await tester.tap(restoredCheckbox);
      await tester.pump();
      expect(controller.selectedGameIds, isEmpty);
      expect(find.textContaining('0 games selected'), findsOneWidget);

      await _tapAndReadCall(tester, calls, const Key('date-filter-tomorrow'));
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
        tester
            .widget<ChoiceChip>(find.byKey(const Key('date-filter-tomorrow')))
            .selected,
        isTrue,
      );
      expect(
        tester
            .widget<ChoiceChip>(find.byKey(const Key('date-filter-allDates')))
            .selected,
        isFalse,
      );
      expect(tester.takeException(), isNull);
    },
  );
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
}) {
  final call = captured.$3;
  final query = call.query;
  expect(query, isNotNull);
  expect(query!.sportCode, 'baseball');
  expect(query.leagueCode, 'mlb');
  expect(query.providerLeagueId, '4424');
  expect(query.season, '2026');
  expect(query.timezone, 'America/Chicago');
  expect(query.dateMode, mode);
  expect(query.weekStartAt, weekStartAt);
  expect(query.weekEndAt, weekEndAt);
  expect(call.timezone, 'America/Chicago');
  expect(call.weekStartAt, weekStartAt);
  expect(call.weekEndAt, weekEndAt);
  expect(call.forceRefresh, isFalse);

  final beforeWindow = catalogDateWindow(
    mode: mode,
    nowUtc: beforeTap,
    timezone: 'America/Chicago',
    weekStartAt: weekStartAt,
    weekEndAt: weekEndAt,
  );
  final afterWindow = catalogDateWindow(
    mode: mode,
    nowUtc: afterTap,
    timezone: 'America/Chicago',
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

  final firstActiveDate = catalogCalendarDate(weekStartAt, 'America/Chicago');
  final lastActiveDate = catalogCalendarDate(weekEndAt, 'America/Chicago');
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
    timezone: 'America/Chicago',
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
    timezone: 'America/Chicago',
    dateMode: mode,
    weekStartAt: weekStartAt,
    weekEndAt: weekEndAt,
  );
}

void _stubArena(
  _MockLeagueRepository repository, {
  required DateTime weekStartAt,
  required DateTime weekEndAt,
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
    role: LeagueRole.owner,
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
  required DateTime scheduledAt,
  required Team awayTeam,
  required Team homeTeam,
  required String venueName,
}) => Game(
  id: id,
  provider: 'theSportsDbTest',
  providerGameId: id,
  sportCode: 'baseball',
  leagueCode: 'mlb',
  leagueName: 'Major League Baseball',
  season: '2026',
  scheduledAtUtc: scheduledAt,
  publishedScheduledAtUtc: scheduledAt,
  effectiveLockAtUtc: scheduledAt,
  venueName: venueName,
  homeTeam: homeTeam,
  awayTeam: awayTeam,
  status: GameStatus.scheduled,
  providerLastUpdatedAt: DateTime.now().toUtc(),
  lastSyncedAt: DateTime.now().toUtc(),
  resultVersion: 1,
  sourcePayloadHash:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
);
