import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/app/bootstrap.dart';
import 'package:lukespics/data/demo/demo_repository.dart';
import 'package:lukespics/data/models/game.dart';
import 'package:lukespics/data/models/member.dart';
import 'package:lukespics/data/models/pick.dart';
import 'package:lukespics/data/models/standing.dart';
import 'package:lukespics/data/repositories/league_repository.dart';
import 'package:mocktail/mocktail.dart';

class _MockLeagueRepository extends Mock implements LeagueRepository {}

class _MockFirebaseAuth extends Mock implements FirebaseAuth {}

class _MockUser extends Mock implements User {}

void main() {
  late _MockLeagueRepository repository;
  late _MockFirebaseAuth auth;
  late _MockUser user;

  setUpAll(() {
    registerFallbackValue(<Game>[]);
    registerFallbackValue(<String>[]);
    registerFallbackValue(
      const Team(
        id: 'fallback',
        name: 'Fallback',
        shortName: 'Fallback',
        abbreviation: 'F',
      ),
    );
    registerFallbackValue(
      CatalogQuery(
        sportCode: 'football',
        leagueCode: 'nfl',
        providerLeagueId: '4391',
        season: '2026',
        from: DateTime.utc(2026),
        to: DateTime.utc(2026, 1, 2),
      ),
    );
  });

  setUp(() {
    repository = _MockLeagueRepository();
    auth = _MockFirebaseAuth();
    user = _MockUser();
    when(() => user.uid).thenReturn('owner');
    when(() => user.displayName).thenReturn('Connected Owner');
    when(() => auth.currentUser).thenReturn(user);
    when(auth.authStateChanges).thenAnswer((_) => const Stream.empty());
    when(repository.findActiveLeagueIds).thenAnswer((_) async => const []);
  });

  test('connected runtime starts empty and never exposes demo seeds', () async {
    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );
    addTearDown(controller.dispose);
    await _flush();

    expect(controller.isDemo, isFalse);
    expect(controller.catalogGames, isEmpty);
    expect(controller.selectedWeekGames, isEmpty);
    expect(controller.members, isEmpty);
    expect(controller.standings, isEmpty);
    expect(controller.weekLabel, isNot('Week 9'));
    expect(controller.currentPickerName, 'Weekly picker');
  });

  test(
    'standings stay hidden through chunks and reveal after marker catch-up',
    () async {
      var currentLeague = _leagueSummary(
        standingsEpoch: 1,
        standingsBuiltEpoch: 1,
        standingsBuiltMemberCount: 2,
      );
      var currentStandings = [
        _standing('a', standingsEpoch: 1),
        _standing('b', standingsEpoch: 1),
      ];
      late StreamController<LeagueSummary?> leagues;
      late StreamController<List<Standing>> standings;
      leagues = StreamController<LeagueSummary?>.broadcast(
        onListen: () => scheduleMicrotask(() {
          if (!leagues.isClosed) leagues.add(currentLeague);
        }),
      );
      standings = StreamController<List<Standing>>.broadcast(
        onListen: () => scheduleMicrotask(() {
          if (!standings.isClosed) standings.add(currentStandings);
        }),
      );
      addTearDown(() async {
        await Future.wait([leagues.close(), standings.close()]);
      });
      _stubArena(
        repository,
        catalogGames: const [],
        selectedGames: const [],
        weekStatus: 'open',
        leagueStream: leagues.stream,
        standingsStream: standings.stream,
      );
      final controller = AppController.connected(
        runtimeMode: AppRuntimeMode.firebaseEmulator,
        repository: repository,
        auth: auth,
      );
      addTearDown(controller.dispose);
      await _flush();
      expect(await controller.joinArena('ABC12345'), isTrue);
      await _flush();
      expect(controller.standings.map((row) => row.uid), ['a', 'b']);

      currentStandings = [
        _standing('a', standingsEpoch: 2),
        _standing('b', standingsEpoch: 1),
      ];
      standings.add(currentStandings);
      await _flush();
      expect(controller.standings, isEmpty);

      currentLeague = _leagueSummary(
        standingsEpoch: 2,
        standingsBuiltEpoch: 1,
        standingsBuiltMemberCount: 2,
      );
      leagues.add(currentLeague);
      await _flush();
      expect(controller.standings, isEmpty);

      currentStandings = [
        _standing('a', standingsEpoch: 2),
        _standing('b', standingsEpoch: 2),
      ];
      standings.add(currentStandings);
      await _flush();
      expect(controller.standings, isEmpty);

      currentLeague = _leagueSummary(
        standingsEpoch: 2,
        standingsBuiltEpoch: 2,
        standingsBuiltMemberCount: 2,
      );
      leagues.add(currentLeague);
      await _flush();
      expect(controller.standings.map((row) => row.uid), ['a', 'b']);
      expect(
        controller.standings.every((row) => row.standingsEpoch == 2),
        isTrue,
      );
    },
  );

  test('completion marker cannot reveal a partial query snapshot', () async {
    var currentLeague = _leagueSummary(
      standingsEpoch: 3,
      standingsBuiltEpoch: 2,
      standingsBuiltMemberCount: 2,
    );
    var currentStandings = [_standing('a', standingsEpoch: 3)];
    late StreamController<LeagueSummary?> leagues;
    late StreamController<List<Standing>> standings;
    leagues = StreamController<LeagueSummary?>.broadcast(
      onListen: () => scheduleMicrotask(() {
        if (!leagues.isClosed) leagues.add(currentLeague);
      }),
    );
    standings = StreamController<List<Standing>>.broadcast(
      onListen: () => scheduleMicrotask(() {
        if (!standings.isClosed) standings.add(currentStandings);
      }),
    );
    addTearDown(() async {
      await Future.wait([leagues.close(), standings.close()]);
    });
    _stubArena(
      repository,
      catalogGames: const [],
      selectedGames: const [],
      weekStatus: 'open',
      leagueStream: leagues.stream,
      standingsStream: standings.stream,
    );
    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );
    addTearDown(controller.dispose);
    await _flush();
    expect(await controller.joinArena('ABC12345'), isTrue);
    await _flush();
    expect(controller.standings, isEmpty);

    currentLeague = _leagueSummary(
      standingsEpoch: 3,
      standingsBuiltEpoch: 3,
      standingsBuiltMemberCount: 2,
    );
    leagues.add(currentLeague);
    await _flush();
    expect(controller.standings, isEmpty);

    currentStandings = [
      _standing('a', standingsEpoch: 3),
      _standing('b', standingsEpoch: 3),
    ];
    standings.add(currentStandings);
    await _flush();
    expect(controller.standings.map((row) => row.uid), ['a', 'b']);
  });

  test('legacy 0/0 standings hydrate visibly and clear on sign-out', () async {
    _stubArena(
      repository,
      catalogGames: const [],
      selectedGames: const [],
      weekStatus: 'open',
      standings: [_standing('legacy')],
    );
    when(auth.signOut).thenAnswer((_) async {});
    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );
    addTearDown(controller.dispose);
    await _flush();
    expect(await controller.joinArena('ABC12345'), isTrue);
    await _flush();
    expect(controller.standings.single.uid, 'legacy');

    await controller.signOut();

    expect(controller.standings, isEmpty);
  });

  test(
    'ordinary member hydrates published logo policy without catalog access',
    () async {
      when(() => user.uid).thenReturn('member');
      when(() => user.displayName).thenReturn('Connected Member');
      _stubArena(
        repository,
        catalogGames: const [],
        selectedGames: [_game('published-game', const Duration(days: 1))],
        weekStatus: 'open',
        memberUid: 'member',
        memberRole: LeagueRole.member,
        pickerUid: 'picker',
        catalogPresentation: CatalogPresentation(
          provider: 'theSportsDbTest',
          attributionText: 'Reviewed test presentation',
          allowRemoteLogos: true,
          allowedLogoHosts: const {'r2.thesportsdb.com'},
          allowedLogoQueryParameters: const {},
          logoRightsReviewDate: DateTime.utc(2026, 7, 30),
        ),
      );
      final controller = AppController.connected(
        runtimeMode: AppRuntimeMode.firebaseEmulator,
        repository: repository,
        auth: auth,
      );
      addTearDown(controller.dispose);
      await _flush();

      expect(await controller.joinArena('ABC12345'), isTrue);
      await _flush();

      expect(controller.canDraftSlate, isFalse);
      expect(controller.catalogPresentation.allowRemoteLogos, isTrue);
      expect(controller.catalogPresentation.provider, 'theSportsDbTest');
      expect(
        controller.catalogPresentation.permitsRemoteLogosForProvider(
          'theSportsDbTest',
        ),
        isTrue,
      );
      verifyNever(
        () => repository.listSportsCatalog(
          leagueId: any(named: 'leagueId'),
          weekId: any(named: 'weekId'),
          query: any(named: 'query'),
          timezone: any(named: 'timezone'),
          weekStartAt: any(named: 'weekStartAt'),
          weekEndAt: any(named: 'weekEndAt'),
          forceRefresh: any(named: 'forceRefresh'),
        ),
      );
    },
  );

  test('ordinary member never watches games while the week is draft', () async {
    when(() => user.uid).thenReturn('member');
    when(() => user.displayName).thenReturn('Connected Member');
    _stubArena(
      repository,
      catalogGames: const [],
      selectedGames: const [],
      weekStatus: 'draft',
      memberUid: 'member',
      memberRole: LeagueRole.member,
      pickerUid: 'picker',
    );
    when(
      () => repository.watchWeekGames('league-1', 'week-0001'),
    ).thenThrow(StateError('Draft games are not readable by this member.'));

    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );
    addTearDown(controller.dispose);
    await _flush();

    expect(await controller.joinArena('ABC12345'), isTrue);
    await _flush();

    expect(controller.weekStatus, 'draft');
    expect(controller.canDraftSlate, isFalse);
    expect(controller.selectedWeekGames, isEmpty);
    expect(controller.offline, isFalse);
    expect(controller.errorMessage, isNull);
    expect(await controller.watchGamesForWeek('week-0001').first, isEmpty);
    verifyNever(() => repository.watchWeekGames('league-1', 'week-0001'));
  });

  test(
    'ordinary member starts one game stream when a draft publishes',
    () async {
      when(() => user.uid).thenReturn('member');
      when(() => user.displayName).thenReturn('Connected Member');
      var currentWeek = _weekSummary(pickerUid: 'picker', status: 'draft');
      late StreamController<WeekSummary?> weeks;
      weeks = StreamController<WeekSummary?>.broadcast(
        onListen: () => scheduleMicrotask(() {
          if (!weeks.isClosed) weeks.add(currentWeek);
        }),
      );
      final games = StreamController<List<Game>>.broadcast();
      addTearDown(() async {
        await Future.wait([weeks.close(), games.close()]);
      });
      _stubArena(
        repository,
        catalogGames: const [],
        selectedGames: const [],
        weekStatus: 'draft',
        memberUid: 'member',
        memberRole: LeagueRole.member,
        pickerUid: 'picker',
        weekStream: weeks.stream,
      );
      var published = false;
      var gameWatchCount = 0;
      when(() => repository.watchWeekGames('league-1', 'week-0001')).thenAnswer(
        (_) {
          if (!published) {
            throw StateError('Draft games are not readable by this member.');
          }
          gameWatchCount += 1;
          return games.stream;
        },
      );

      final controller = AppController.connected(
        runtimeMode: AppRuntimeMode.firebaseEmulator,
        repository: repository,
        auth: auth,
      );
      addTearDown(controller.dispose);
      await _flush();
      expect(await controller.joinArena('ABC12345'), isTrue);
      await _flush();
      expect(gameWatchCount, 0);
      expect(controller.errorMessage, isNull);

      final publishedGame = _game(
        'newly-published-game',
        const Duration(days: 1),
      );
      published = true;
      currentWeek = _weekSummary(
        pickerUid: 'picker',
        status: 'open',
        selectedGameCount: 1,
      );
      weeks.add(currentWeek);
      await _flush();
      expect(gameWatchCount, 1);
      expect(games.hasListener, isTrue);

      games.add([publishedGame]);
      await _flush();
      expect(controller.selectedWeekGames, [publishedGame]);

      weeks.add(currentWeek);
      weeks.add(currentWeek);
      await _flush();
      expect(gameWatchCount, 1);

      currentWeek = _weekSummary(pickerUid: 'picker', status: 'draft');
      weeks.add(currentWeek);
      await _flush();
      expect(games.hasListener, isFalse);
      expect(controller.selectedWeekGames, isEmpty);
      expect(controller.offline, isFalse);
      expect(controller.errorMessage, isNull);
    },
  );

  test('published week rejects a late draft catalog presentation', () async {
    var currentWeek = _weekSummary();
    late StreamController<WeekSummary?> weeks;
    weeks = StreamController<WeekSummary?>.broadcast(
      onListen: () => scheduleMicrotask(() {
        if (!weeks.isClosed) weeks.add(currentWeek);
      }),
    );
    addTearDown(weeks.close);
    _stubArena(
      repository,
      catalogGames: const [],
      selectedGames: const [],
      weekStatus: 'draft',
      weekStream: weeks.stream,
    );
    final pendingCatalog = Completer<SportsCatalogResult>();
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
    ).thenAnswer((_) => pendingCatalog.future);
    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );
    addTearDown(controller.dispose);
    await _flush();

    expect(await controller.joinArena('ABC12345'), isTrue);
    await _flush();
    expect(controller.catalogLoading, isTrue);

    currentWeek = _weekSummary(
      status: 'open',
      catalogPresentation: const CatalogPresentation.disabled(
        provider: 'theSportsDbTest',
        attributionText: 'Published neutral policy',
      ),
    );
    weeks.add(currentWeek);
    await _flush();
    expect(controller.slatePublished, isTrue);
    expect(
      controller.catalogPresentation.attributionText,
      'Published neutral policy',
    );

    pendingCatalog.complete(
      SportsCatalogResult(
        provider: 'theSportsDbTest',
        games: [_game('late-catalog', const Duration(days: 1))],
        cacheHit: false,
        stale: false,
        delayed: false,
        cachedAt: DateTime.now().toUtc(),
        presentation: CatalogPresentation(
          provider: 'theSportsDbTest',
          attributionText: 'Superseded draft policy',
          allowRemoteLogos: true,
          allowedLogoHosts: const {'r2.thesportsdb.com'},
          allowedLogoQueryParameters: const {},
          logoRightsReviewDate: DateTime.utc(2026, 7, 30),
        ),
      ),
    );
    await _flush();

    expect(controller.catalogGames, isEmpty);
    expect(controller.catalogPresentation.allowRemoteLogos, isFalse);
    expect(
      controller.catalogPresentation.attributionText,
      'Published neutral policy',
    );
  });

  test(
    'external week advance clears prior draft state and discovers anew',
    () async {
      var currentLeague = _leagueSummary();
      late StreamController<LeagueSummary?> leagues;
      leagues = StreamController<LeagueSummary?>.broadcast(
        onListen: () => scheduleMicrotask(() {
          if (!leagues.isClosed) leagues.add(currentLeague);
        }),
      );
      addTearDown(leagues.close);
      final oldGame = _game('week-one-game', const Duration(days: 1));
      final newGame = _game('week-two-game', const Duration(days: 2));
      _stubArena(
        repository,
        catalogGames: [oldGame],
        selectedGames: const [],
        weekStatus: 'draft',
        leagueStream: leagues.stream,
      );
      final weekTwo = _weekSummary(id: 'week-0002', sequentialNumber: 2);
      when(
        () => repository.watchWeek('league-1', 'week-0002'),
      ).thenAnswer((_) => Stream.value(weekTwo));
      when(
        () => repository.watchWeekGames('league-1', 'week-0002'),
      ).thenAnswer((_) => Stream.value(const <Game>[]));
      when(
        () => repository.watchPublicEntries('league-1', 'week-0002'),
      ).thenAnswer((_) => Stream.value(const <EntrySummary>[]));
      when(
        () => repository.watchOwnPrivatePicks('league-1', 'week-0002'),
      ).thenAnswer((_) => Stream.value(const <Pick>[]));
      final weekTwoQuery = _query('baseball', 'mlb', '4424');
      when(
        () => repository.listSportsCatalog(
          leagueId: 'league-1',
          weekId: 'week-0002',
          query: any(named: 'query'),
          timezone: any(named: 'timezone'),
          weekStartAt: any(named: 'weekStartAt'),
          weekEndAt: any(named: 'weekEndAt'),
          forceRefresh: any(named: 'forceRefresh'),
        ),
      ).thenAnswer((_) async => _catalogResult(weekTwoQuery, [newGame]));
      final controller = AppController.connected(
        runtimeMode: AppRuntimeMode.firebaseEmulator,
        repository: repository,
        auth: auth,
      );
      addTearDown(controller.dispose);
      await _flush();

      expect(await controller.joinArena('ABC12345'), isTrue);
      await _flush();
      expect(
        controller.catalogGames.map((game) => game.id),
        contains(oldGame.id),
      );
      controller.toggleSlateGame(oldGame.id);
      expect(controller.selectedGameIds, {oldGame.id});
      expect(controller.draftSyncState, DraftSyncState.dirty);

      currentLeague = _leagueSummary(weekId: 'week-0002');
      leagues.add(currentLeague);
      await _flush();
      await _flush();

      expect(controller.activeWeekId, 'week-0002');
      expect(controller.catalogGames.map((game) => game.id), [newGame.id]);
      expect(controller.selectedGameIds, isEmpty);
      expect(controller.selectedWeekGames, isEmpty);
      expect(controller.picks, isEmpty);
      expect(controller.draftSyncState, isNot(DraftSyncState.dirty));
      verify(
        () => repository.listSportsCatalog(
          leagueId: 'league-1',
          weekId: 'week-0002',
          query: any(named: 'query'),
          timezone: any(named: 'timezone'),
          weekStartAt: any(named: 'weekStartAt'),
          weekEndAt: any(named: 'weekEndAt'),
          forceRefresh: any(named: 'forceRefresh'),
        ),
      ).called(greaterThanOrEqualTo(1));
    },
  );

  test(
    'publish aborts when the active week changes during draft save',
    () async {
      var currentLeague = _leagueSummary();
      late StreamController<LeagueSummary?> leagues;
      leagues = StreamController<LeagueSummary?>.broadcast(
        onListen: () => scheduleMicrotask(() {
          if (!leagues.isClosed) leagues.add(currentLeague);
        }),
      );
      addTearDown(leagues.close);
      final weekOneGame = _game('week-one-publish', const Duration(days: 1));
      final weekTwoGame = _game('week-two-draft', const Duration(days: 2));
      _stubArena(
        repository,
        catalogGames: [weekOneGame],
        selectedGames: const [],
        weekStatus: 'draft',
        leagueStream: leagues.stream,
      );
      final weekOneSave = Completer<int>();
      final weekTwoSave = Completer<int>();
      addTearDown(() {
        if (!weekOneSave.isCompleted) weekOneSave.complete(1);
        if (!weekTwoSave.isCompleted) weekTwoSave.complete(0);
      });
      when(
        () => repository.saveDraftSlate(
          leagueId: any(named: 'leagueId'),
          weekId: any(named: 'weekId'),
          chunkKey: any(named: 'chunkKey'),
          games: any(named: 'games'),
          removeGameIds: any(named: 'removeGameIds'),
          requestId: any(named: 'requestId'),
        ),
      ).thenAnswer((invocation) {
        final weekId = invocation.namedArguments[#weekId] as String;
        return weekId == 'week-0001' ? weekOneSave.future : weekTwoSave.future;
      });
      when(
        () => repository.publishWeeklySlate(
          leagueId: any(named: 'leagueId'),
          weekId: any(named: 'weekId'),
          requestId: any(named: 'requestId'),
        ),
      ).thenAnswer(
        (_) async => const PublishSlateResult(
          eligibleMemberCount: 1,
          selectedGameCount: 1,
        ),
      );
      final weekTwo = _weekSummary(
        id: 'week-0002',
        sequentialNumber: 2,
        status: 'draft',
        selectedGameCount: 1,
      );
      when(
        () => repository.watchWeek('league-1', 'week-0002'),
      ).thenAnswer((_) => Stream.value(weekTwo));
      when(
        () => repository.watchWeekGames('league-1', 'week-0002'),
      ).thenAnswer((_) => Stream.value([weekTwoGame]));
      when(
        () => repository.watchPublicEntries('league-1', 'week-0002'),
      ).thenAnswer((_) => Stream.value(const <EntrySummary>[]));
      when(
        () => repository.watchOwnPrivatePicks('league-1', 'week-0002'),
      ).thenAnswer((_) => Stream.value(const <Pick>[]));
      when(
        () => repository.listSportsCatalog(
          leagueId: 'league-1',
          weekId: 'week-0002',
          query: any(named: 'query'),
          timezone: any(named: 'timezone'),
          weekStartAt: any(named: 'weekStartAt'),
          weekEndAt: any(named: 'weekEndAt'),
          forceRefresh: any(named: 'forceRefresh'),
        ),
      ).thenAnswer((_) async => _catalogResult(null, const []));

      final controller = AppController.connected(
        runtimeMode: AppRuntimeMode.firebaseEmulator,
        repository: repository,
        auth: auth,
      );
      addTearDown(controller.dispose);
      await _flush();
      expect(await controller.joinArena('ABC12345'), isTrue);
      await _flush();
      controller.toggleSlateGame(weekOneGame.id);
      expect(controller.selectedGameIds, {weekOneGame.id});

      final publishing = controller.publishSlate();
      await _flush();
      currentLeague = _leagueSummary(weekId: 'week-0002');
      leagues.add(currentLeague);
      await _flush();
      expect(controller.activeWeekId, 'week-0002');
      expect(controller.weekStatus, 'draft');
      expect(controller.draftSaving, isFalse);
      expect(controller.selectedWeekGames.map((game) => game.id), [
        weekTwoGame.id,
      ]);
      expect(controller.selectedGameIds, {weekTwoGame.id});

      controller.removeSlateGame(weekTwoGame.id);
      expect(controller.selectedGameIds, isEmpty);
      final savingWeekTwo = controller.saveDraftSlate();
      await _flush();
      expect(controller.draftSaving, isTrue);

      weekOneSave.complete(1);
      expect(await publishing, isFalse);
      await _flush();
      expect(controller.draftSaving, isTrue);

      weekTwoSave.complete(0);
      expect(await savingWeekTwo, isTrue);
      await _flush();

      verifyNever(
        () => repository.publishWeeklySlate(
          leagueId: any(named: 'leagueId'),
          weekId: any(named: 'weekId'),
          requestId: any(named: 'requestId'),
        ),
      );
      expect(controller.activeWeekId, 'week-0002');
      expect(controller.weekStatus, 'draft');
      expect(controller.slatePublished, isFalse);
      expect(controller.draftSaving, isFalse);
      expect(controller.selectedWeekGames.map((game) => game.id), [
        weekTwoGame.id,
      ]);
      expect(controller.selectedGameIds, isEmpty);
      expect(controller.serverDraftGameIds, isEmpty);
    },
  );

  test('rapid week transitions retain only the newest subscriptions', () async {
    var currentLeague = _leagueSummary();
    late StreamController<LeagueSummary?> leagues;
    leagues = StreamController<LeagueSummary?>.broadcast(
      onListen: () => scheduleMicrotask(() {
        if (!leagues.isClosed) leagues.add(currentLeague);
      }),
    );
    final releaseWeekOneCancellation = Completer<void>();
    final heldWeekOneGames = StreamController<List<Game>>(
      onCancel: () => releaseWeekOneCancellation.future,
    );
    final weekTwo = StreamController<WeekSummary?>.broadcast();
    final weekTwoGames = StreamController<List<Game>>.broadcast();
    final weekThree = StreamController<WeekSummary?>.broadcast();
    final weekThreeGames = StreamController<List<Game>>.broadcast();
    addTearDown(() async {
      if (!releaseWeekOneCancellation.isCompleted) {
        releaseWeekOneCancellation.complete();
      }
      await Future.wait([
        leagues.close(),
        heldWeekOneGames.close(),
        weekTwo.close(),
        weekTwoGames.close(),
        weekThree.close(),
        weekThreeGames.close(),
      ]);
    });
    _stubArena(
      repository,
      catalogGames: const [],
      selectedGames: const [],
      weekStatus: 'open',
      leagueStream: leagues.stream,
    );
    var weekOneGameWatchCount = 0;
    when(() => repository.watchWeekGames('league-1', 'week-0001')).thenAnswer((
      _,
    ) {
      weekOneGameWatchCount += 1;
      return weekOneGameWatchCount == 1
          ? Stream.value(const <Game>[])
          : heldWeekOneGames.stream;
    });
    when(
      () => repository.watchWeek('league-1', 'week-0002'),
    ).thenAnswer((_) => weekTwo.stream);
    when(
      () => repository.watchWeekGames('league-1', 'week-0002'),
    ).thenAnswer((_) => weekTwoGames.stream);
    when(
      () => repository.watchWeek('league-1', 'week-0003'),
    ).thenAnswer((_) => weekThree.stream);
    when(
      () => repository.watchWeekGames('league-1', 'week-0003'),
    ).thenAnswer((_) => weekThreeGames.stream);
    for (final weekId in ['week-0002', 'week-0003']) {
      when(
        () => repository.watchPublicEntries('league-1', weekId),
      ).thenAnswer((_) => Stream.value(const <EntrySummary>[]));
      when(
        () => repository.watchOwnPrivatePicks('league-1', weekId),
      ).thenAnswer((_) => Stream.value(const <Pick>[]));
    }

    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );
    addTearDown(controller.dispose);
    await _flush();
    expect(await controller.joinArena('ABC12345'), isTrue);
    await _flush();
    expect(heldWeekOneGames.hasListener, isTrue);

    currentLeague = _leagueSummary(weekId: 'week-0002');
    leagues.add(currentLeague);
    currentLeague = _leagueSummary(weekId: 'week-0003');
    leagues.add(currentLeague);
    await _flush();

    expect(controller.activeWeekId, 'week-0003');
    expect(weekTwo.hasListener, isFalse);
    expect(weekTwoGames.hasListener, isFalse);
    expect(weekThree.hasListener, isTrue);
    expect(weekThreeGames.hasListener, isFalse);
    final newestGame = _game('week-three-game', const Duration(days: 3));
    weekThree.add(
      _weekSummary(id: 'week-0003', sequentialNumber: 3, status: 'open'),
    );
    await _flush();
    expect(weekThreeGames.hasListener, isTrue);
    weekThreeGames.add([newestGame]);
    await _flush();
    expect(controller.weekLabel, 'Week 3');
    expect(controller.selectedWeekGames.map((game) => game.id), [
      newestGame.id,
    ]);

    releaseWeekOneCancellation.complete();
    await _flush();
    final staleGame = _game('stale-week-two-game', const Duration(days: 2));
    weekTwo.add(
      _weekSummary(id: 'week-0002', sequentialNumber: 2, status: 'review'),
    );
    weekTwoGames.add([staleGame]);
    await _flush();

    expect(controller.activeWeekId, 'week-0003');
    expect(controller.weekLabel, 'Week 3');
    expect(controller.selectedWeekGames.map((game) => game.id), [
      newestGame.id,
    ]);
    verifyNever(() => repository.watchWeek('league-1', 'week-0002'));
  });

  test('next week defers to the server-authoritative rotation', () async {
    var currentLeague = _leagueSummary(pickerUid: 'member-b');
    late StreamController<LeagueSummary?> leagues;
    leagues = StreamController<LeagueSummary?>.broadcast(
      onListen: () => scheduleMicrotask(() {
        if (!leagues.isClosed) leagues.add(currentLeague);
      }),
    );
    addTearDown(leagues.close);
    final weekOne = _weekSummary(
      status: 'finalized',
      nextPickerUid: 'member-b',
    );
    _stubArena(
      repository,
      catalogGames: const [],
      selectedGames: const [],
      weekStatus: 'finalized',
      leagueStream: leagues.stream,
      weekSummary: weekOne,
    );
    final now = DateTime.now().toUtc();
    final members = [
      LeagueMember(
        uid: 'owner',
        displayName: 'Connected Owner',
        role: LeagueRole.owner,
        status: MemberStatus.active,
        rotationOrder: 0,
        joinedAt: now,
      ),
      LeagueMember(
        uid: 'member-b',
        displayName: 'Member B',
        role: LeagueRole.member,
        status: MemberStatus.active,
        rotationOrder: 1,
        joinedAt: now,
      ),
      LeagueMember(
        uid: 'member-c',
        displayName: 'Member C',
        role: LeagueRole.member,
        status: MemberStatus.active,
        rotationOrder: 2,
        joinedAt: now,
      ),
    ];
    when(
      () => repository.watchMembers('league-1'),
    ).thenAnswer((_) => Stream.value(members));
    final weekTwo = _weekSummary(
      id: 'week-0002',
      sequentialNumber: 2,
      pickerUid: 'member-b',
      status: 'finalized',
      nextPickerUid: 'member-c',
    );
    when(
      () => repository.watchWeek('league-1', 'week-0002'),
    ).thenAnswer((_) => Stream.value(weekTwo));
    when(
      () => repository.watchWeekGames('league-1', 'week-0002'),
    ).thenAnswer((_) => Stream.value(const <Game>[]));
    when(
      () => repository.watchPublicEntries('league-1', 'week-0002'),
    ).thenAnswer((_) => Stream.value(const <EntrySummary>[]));
    when(
      () => repository.watchOwnPrivatePicks('league-1', 'week-0002'),
    ).thenAnswer((_) => Stream.value(const <Pick>[]));
    when(
      () => repository.createNextWeek(
        leagueId: 'league-1',
        sequentialNumber: 3,
        label: 'Week 3',
        startAt: any(named: 'startAt'),
        endAt: any(named: 'endAt'),
        pickerUid: null,
        requestId: any(named: 'requestId'),
      ),
    ).thenAnswer(
      (_) async =>
          const CreatedWeek(weekId: 'week-0003', pickerUid: 'member-c'),
    );
    final weekThree = _weekSummary(
      id: 'week-0003',
      sequentialNumber: 3,
      pickerUid: 'member-c',
    );
    when(
      () => repository.watchWeek('league-1', 'week-0003'),
    ).thenAnswer((_) => Stream.value(weekThree));
    when(
      () => repository.watchWeekGames('league-1', 'week-0003'),
    ).thenAnswer((_) => Stream.value(const <Game>[]));
    when(
      () => repository.watchPublicEntries('league-1', 'week-0003'),
    ).thenAnswer((_) => Stream.value(const <EntrySummary>[]));
    when(
      () => repository.watchOwnPrivatePicks('league-1', 'week-0003'),
    ).thenAnswer((_) => Stream.value(const <Pick>[]));
    when(
      () => repository.listSportsCatalog(
        leagueId: 'league-1',
        weekId: 'week-0003',
        query: any(named: 'query'),
        timezone: any(named: 'timezone'),
        weekStartAt: any(named: 'weekStartAt'),
        weekEndAt: any(named: 'weekEndAt'),
        forceRefresh: any(named: 'forceRefresh'),
      ),
    ).thenAnswer((_) async => _catalogResult(null, const []));

    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );
    addTearDown(controller.dispose);
    await _flush();
    expect(await controller.joinArena('ABC12345'), isTrue);
    await _flush();
    expect(controller.lastNextPickerName, 'Member B');

    currentLeague = _leagueSummary(weekId: 'week-0002', pickerUid: 'member-c');
    leagues.add(currentLeague);
    await _flush();
    await _flush();

    expect(controller.activeWeekId, 'week-0002');
    expect(controller.lastNextPickerName, 'Member C');
    expect(await controller.createNextWeek(), isTrue);

    verify(
      () => repository.createNextWeek(
        leagueId: 'league-1',
        sequentialNumber: 3,
        label: 'Week 3',
        startAt: any(named: 'startAt'),
        endAt: any(named: 'endAt'),
        pickerUid: null,
        requestId: any(named: 'requestId'),
      ),
    ).called(1);
    expect(controller.activeWeekId, 'week-0003');
    expect(controller.currentPickerId, 'member-c');
    expect(controller.lastNextPickerName, isNull);
  });

  test('late finalization response cannot overwrite a newer week', () async {
    var currentLeague = _leagueSummary();
    late StreamController<LeagueSummary?> leagues;
    leagues = StreamController<LeagueSummary?>.broadcast(
      onListen: () => scheduleMicrotask(() {
        if (!leagues.isClosed) leagues.add(currentLeague);
      }),
    );
    addTearDown(leagues.close);
    _stubArena(
      repository,
      catalogGames: const [],
      selectedGames: [_game('finalizing-week-one', const Duration(days: 1))],
      weekStatus: 'review',
      leagueStream: leagues.stream,
    );
    final finalized = Completer<FinalizeResult>();
    addTearDown(() {
      if (!finalized.isCompleted) {
        finalized.complete(
          const FinalizeResult(
            winnerUids: [],
            highScore: null,
            nextPickerUid: 'member-b',
          ),
        );
      }
    });
    when(
      () => repository.finalizeWeek(leagueId: 'league-1', weekId: 'week-0001'),
    ).thenAnswer((_) => finalized.future);
    final weekTwo = _weekSummary(id: 'week-0002', sequentialNumber: 2);
    when(
      () => repository.watchWeek('league-1', 'week-0002'),
    ).thenAnswer((_) => Stream.value(weekTwo));
    when(
      () => repository.watchWeekGames('league-1', 'week-0002'),
    ).thenAnswer((_) => Stream.value(const <Game>[]));
    when(
      () => repository.watchPublicEntries('league-1', 'week-0002'),
    ).thenAnswer((_) => Stream.value(const <EntrySummary>[]));
    when(
      () => repository.watchOwnPrivatePicks('league-1', 'week-0002'),
    ).thenAnswer((_) => Stream.value(const <Pick>[]));
    when(
      () => repository.listSportsCatalog(
        leagueId: 'league-1',
        weekId: 'week-0002',
        query: any(named: 'query'),
        timezone: any(named: 'timezone'),
        weekStartAt: any(named: 'weekStartAt'),
        weekEndAt: any(named: 'weekEndAt'),
        forceRefresh: any(named: 'forceRefresh'),
      ),
    ).thenAnswer((_) async => _catalogResult(null, const []));

    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );
    addTearDown(controller.dispose);
    await _flush();
    expect(await controller.joinArena('ABC12345'), isTrue);
    await _flush();

    final finalizing = controller.finalizeWeek();
    await _flush();
    currentLeague = _leagueSummary(weekId: 'week-0002');
    leagues.add(currentLeague);
    await _flush();
    expect(controller.activeWeekId, 'week-0002');
    expect(controller.weekFinalized, isFalse);

    finalized.complete(
      const FinalizeResult(
        winnerUids: ['owner'],
        highScore: 1,
        nextPickerUid: 'member-b',
      ),
    );
    expect(await finalizing, isFalse);
    await _flush();

    expect(controller.activeWeekId, 'week-0002');
    expect(controller.weekStatus, 'draft');
    expect(controller.weekFinalized, isFalse);
    expect(controller.lastNextPickerName, isNull);
  });

  test('demo seed exposes metadata for every catalog game', () {
    final controller = AppController.demo(signedIn: true, hasLeague: true);
    addTearDown(controller.dispose);
    final sportCodes = controller.catalogSports
        .map((sport) => sport.code)
        .toSet();
    final leagueKeys = controller.catalogLeagues
        .map((league) => '${league.sportCode}:${league.code}')
        .toSet();

    expect(
      controller.catalogAvailability.state,
      CatalogAvailabilityState.available,
    );
    expect(controller.catalogPresentation.allowRemoteLogos, isFalse);
    expect(controller.weekStartAt, isNotNull);
    expect(controller.weekEndAt, isNotNull);
    expect(controller.activeCatalogQuery, isNotNull);
    expect(
      controller.catalogGames.every(
        (game) =>
            sportCodes.contains(game.sportCode) &&
            leagueKeys.contains('${game.sportCode}:${game.leagueCode}') &&
            !game.scheduledAtUtc.isBefore(controller.weekStartAt!) &&
            !game.scheduledAtUtc.isAfter(controller.weekEndAt!),
      ),
      isTrue,
    );
  });

  test(
    'initial catalog load is discovery and stores canonical metadata',
    () async {
      _stubArena(
        repository,
        catalogGames: const [],
        selectedGames: const [],
        weekStatus: 'draft',
      );
      final controller = AppController.connected(
        runtimeMode: AppRuntimeMode.firebaseEmulator,
        repository: repository,
        auth: auth,
      );
      addTearDown(controller.dispose);
      await _flush();

      expect(await controller.joinArena('ABC12345'), isTrue);
      await _flush();

      verify(
        () => repository.listSportsCatalog(
          leagueId: 'league-1',
          weekId: 'week-0001',
          query: null,
          timezone: 'America/Chicago',
          weekStartAt: any(named: 'weekStartAt'),
          weekEndAt: any(named: 'weekEndAt'),
          forceRefresh: false,
        ),
      ).called(greaterThanOrEqualTo(1));
      expect(controller.catalogSports.single.code, 'baseball');
      expect(controller.catalogLeagues.single.code, 'mlb');
      expect(controller.activeCatalogQuery?.leagueCode, 'mlb');
      expect(controller.weekStartAt, isNotNull);
      expect(controller.weekEndAt, isNotNull);
    },
  );

  test('catalog data stays separate from selected week games', () async {
    final catalogGame = _game('catalog-only', const Duration(days: 2));
    final selectedGame = _game('selected-only', const Duration(days: 1));
    _stubArena(
      repository,
      catalogGames: [catalogGame],
      selectedGames: [selectedGame],
      weekStatus: 'draft',
    );
    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );
    addTearDown(controller.dispose);
    await _flush();

    expect(await controller.joinArena('ABC12345'), isTrue);
    await controller.loadCatalog();
    await _flush();

    expect(controller.catalogGames.map((game) => game.id), ['catalog-only']);
    expect(controller.selectedWeekGames.map((game) => game.id), [
      'selected-only',
    ]);
    expect(controller.selectedGameIds, {'selected-only'});
    expect(
      controller.selectedDraftGamesById['selected-only'],
      same(selectedGame),
    );
    expect(controller.serverDraftGameIds, {'selected-only'});
    expect(controller.unsavedDraftChangeCount, 0);
  });

  test(
    'selected game snapshots persist across queries and reconcile exactly',
    () async {
      final baseball = _game(
        'baseball-one',
        const Duration(days: 1),
        sportCode: 'baseball',
        leagueCode: 'mlb',
        leagueName: 'MLB',
      );
      final basketball = _game(
        'basketball-one',
        const Duration(days: 2),
        sportCode: 'basketball',
        leagueCode: 'nba',
        leagueName: 'NBA',
      );
      _stubArena(
        repository,
        catalogGames: const [],
        selectedGames: const [],
        weekStatus: 'draft',
      );
      final savedGames = <String>[];
      final removedGames = <String>[];
      when(
        () => repository.saveDraftSlate(
          leagueId: any(named: 'leagueId'),
          weekId: any(named: 'weekId'),
          chunkKey: any(named: 'chunkKey'),
          games: any(named: 'games'),
          removeGameIds: any(named: 'removeGameIds'),
          requestId: any(named: 'requestId'),
        ),
      ).thenAnswer((invocation) async {
        savedGames.addAll(
          (invocation.namedArguments[#games] as List<Game>).map(
            (game) => game.id,
          ),
        );
        removedGames.addAll(
          invocation.namedArguments[#removeGameIds] as List<String>,
        );
        return savedGames.length - removedGames.length;
      });
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
        if (query == null) return _catalogResult(null, const []);
        return _catalogResult(
          query,
          query.leagueCode == 'mlb' ? [baseball] : [basketball],
        );
      });

      final controller = AppController.connected(
        runtimeMode: AppRuntimeMode.firebaseEmulator,
        repository: repository,
        auth: auth,
      );
      addTearDown(controller.dispose);
      await _flush();
      expect(await controller.joinArena('ABC12345'), isTrue);
      await _flush();

      final baseballQuery = _query('baseball', 'mlb', '4424');
      final basketballQuery = _query('basketball', 'nba', '12');
      await controller.loadCatalog(query: baseballQuery);
      controller.toggleSlateGame(baseball.id);
      expect(controller.selectedDraftGamesById[baseball.id], same(baseball));

      await controller.loadCatalog(query: basketballQuery);
      expect(controller.catalogGames.map((game) => game.id), [basketball.id]);
      expect(controller.selectedGameIds, {baseball.id});
      expect(controller.selectedGames.map((game) => game.id), [baseball.id]);
      controller.toggleSlateGame(basketball.id);
      expect(controller.selectedGameIds, {baseball.id, basketball.id});
      expect(controller.unsavedDraftChangeCount, 2);

      expect(await controller.saveDraftSlate(), isTrue);
      expect(savedGames.toSet(), {baseball.id, basketball.id});
      expect(controller.serverDraftGameIds, {baseball.id, basketball.id});
      expect(controller.unsavedDraftChangeCount, 0);

      controller.removeSlateGame(baseball.id);
      expect(controller.selectedGameIds, {basketball.id});
      expect(controller.unsavedDraftChangeCount, 1);
      expect(await controller.saveDraftSlate(), isTrue);
      expect(removedGames, [baseball.id]);
      expect(controller.serverDraftGameIds, {basketball.id});
      expect(controller.unsavedDraftChangeCount, 0);
    },
  );

  test(
    'canonical provider league correction marks a restored draft dirty',
    () async {
      final legacy = _game(
        'legacy-provider-league',
        const Duration(days: 1),
        sportCode: 'baseball',
        leagueCode: 'mlb',
        leagueName: 'MLB',
      );
      final canonical = legacy.copyWith(providerLeagueId: '4424');
      _stubArena(
        repository,
        catalogGames: [canonical],
        selectedGames: [legacy],
        weekStatus: 'draft',
      );
      List<Game>? savedGames;
      when(
        () => repository.saveDraftSlate(
          leagueId: any(named: 'leagueId'),
          weekId: any(named: 'weekId'),
          chunkKey: any(named: 'chunkKey'),
          games: any(named: 'games'),
          removeGameIds: any(named: 'removeGameIds'),
          requestId: any(named: 'requestId'),
        ),
      ).thenAnswer((invocation) async {
        savedGames = List<Game>.from(invocation.namedArguments[#games] as List);
        return 1;
      });

      final controller = AppController.connected(
        runtimeMode: AppRuntimeMode.firebaseEmulator,
        repository: repository,
        auth: auth,
      );
      addTearDown(controller.dispose);
      await _flush();
      expect(await controller.joinArena('ABC12345'), isTrue);
      await _flush();

      await controller.loadCatalog(query: _query('baseball', 'mlb', '4424'));

      expect(
        controller.selectedDraftGamesById[legacy.id]?.providerLeagueId,
        '4424',
      );
      expect(controller.unsavedDraftChangeCount, 1);
      expect(await controller.saveDraftSlate(), isTrue);
      expect(savedGames, hasLength(1));
      expect(savedGames?.single.providerLeagueId, '4424');
    },
  );

  test('an older catalog response cannot replace a newer query', () async {
    _stubArena(
      repository,
      catalogGames: const [],
      selectedGames: const [],
      weekStatus: 'draft',
    );
    final oldResult = Completer<SportsCatalogResult>();
    final newResult = Completer<SportsCatalogResult>();
    final oldGame = _game('old-game', const Duration(days: 1));
    final newGame = _game('new-game', const Duration(days: 2));
    final oldQuery = _query('baseball', 'mlb', '4424');
    final newQuery = _query('basketball', 'nba', '12');
    var controlled = false;
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
    ).thenAnswer((invocation) {
      final query = invocation.namedArguments[#query] as CatalogQuery?;
      if (!controlled || query == null) {
        return Future.value(_catalogResult(query, const []));
      }
      return query.leagueCode == oldQuery.leagueCode
          ? oldResult.future
          : newResult.future;
    });

    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );
    addTearDown(controller.dispose);
    await _flush();
    expect(await controller.joinArena('ABC12345'), isTrue);
    await _flush();
    controlled = true;

    final olderLoad = controller.loadCatalog(query: oldQuery);
    await _flush();
    final newerLoad = controller.loadCatalog(query: newQuery);
    await _flush();
    newResult.complete(_catalogResult(newQuery, [newGame]));
    await newerLoad;
    oldResult.complete(_catalogResult(oldQuery, [oldGame]));
    await olderLoad;

    expect(controller.catalogGames.map((game) => game.id), [newGame.id]);
    expect(controller.activeCatalogQuery?.leagueCode, newQuery.leagueCode);
    expect(controller.catalogGameCacheById, isNot(contains(oldGame.id)));
  });

  test('a failed new query cannot leave old-query games visible', () async {
    _stubArena(
      repository,
      catalogGames: const [],
      selectedGames: const [],
      weekStatus: 'draft',
    );
    final oldGame = _game('old-visible-game', const Duration(days: 1));
    final oldQuery = _query('baseball', 'mlb', '4424');
    final newQuery = _query('basketball', 'nba', '12');
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
      if (query == null) return _catalogResult(null, const []);
      if (query.leagueCode == newQuery.leagueCode) {
        throw const RepositoryException(
          'unavailable',
          'The new schedule failed.',
        );
      }
      return _catalogResult(query, [oldGame]);
    });
    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );
    addTearDown(controller.dispose);
    await _flush();
    expect(await controller.joinArena('ABC12345'), isTrue);
    await controller.loadCatalog(query: oldQuery);
    expect(controller.catalogGames.map((game) => game.id), [oldGame.id]);

    await controller.loadCatalog(query: newQuery);

    expect(controller.activeCatalogQuery?.leagueCode, newQuery.leagueCode);
    expect(controller.catalogGames, isEmpty);
    expect(controller.catalogError, 'The new schedule failed.');
  });

  test(
    'a reviewed canonical snapshot change becomes an explicit draft update',
    () async {
      final original = _game('changed-snapshot', const Duration(days: 1));
      final refreshed = original.copyWith(
        providerLastUpdatedAt: original.providerLastUpdatedAt.add(
          const Duration(minutes: 1),
        ),
        lastSyncedAt: original.lastSyncedAt.add(const Duration(minutes: 1)),
        resultVersion: 2,
        sourcePayloadHash: List.filled(64, 'b').join(),
      );
      _stubArena(
        repository,
        catalogGames: const [],
        selectedGames: [original],
        weekStatus: 'draft',
      );
      var returnRefreshed = false;
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
        return _catalogResult(query, returnRefreshed ? [refreshed] : const []);
      });
      final saved = <Game>[];
      when(
        () => repository.saveDraftSlate(
          leagueId: any(named: 'leagueId'),
          weekId: any(named: 'weekId'),
          chunkKey: any(named: 'chunkKey'),
          games: any(named: 'games'),
          removeGameIds: any(named: 'removeGameIds'),
          requestId: any(named: 'requestId'),
        ),
      ).thenAnswer((invocation) async {
        saved.addAll(invocation.namedArguments[#games] as List<Game>);
        return 1;
      });
      final controller = AppController.connected(
        runtimeMode: AppRuntimeMode.firebaseEmulator,
        repository: repository,
        auth: auth,
      );
      addTearDown(controller.dispose);
      await _flush();
      expect(await controller.joinArena('ABC12345'), isTrue);
      await _flush();
      expect(controller.unsavedDraftChangeCount, 0);

      returnRefreshed = true;
      await controller.loadCatalog(query: _query('football', 'nfl', '4391'));

      expect(controller.draftSyncState, DraftSyncState.dirty);
      expect(controller.unsavedDraftChangeCount, 1);
      expect(controller.selectedDraftGamesById[original.id], same(refreshed));
      expect(await controller.saveDraftSlate(), isTrue);
      expect(saved, [refreshed]);
      expect(controller.unsavedDraftChangeCount, 0);
    },
  );

  test('catalog selection enforces freshness and active-week bounds', () async {
    final inWeek = _game('in-week', const Duration(days: 2));
    final afterWeek = _game('after-week', const Duration(days: 8));
    var responseGames = <Game>[inWeek];
    var responseStale = true;
    var responseExpiresAt = DateTime.now().toUtc().add(
      const Duration(hours: 1),
    );
    _stubArena(
      repository,
      catalogGames: const [],
      selectedGames: const [],
      weekStatus: 'draft',
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
    ).thenAnswer((invocation) async {
      final query = invocation.namedArguments[#query] as CatalogQuery?;
      return _catalogResult(
        query,
        responseGames,
        stale: responseStale,
        expiresAt: responseExpiresAt,
      );
    });
    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );
    addTearDown(controller.dispose);
    await _flush();
    expect(await controller.joinArena('ABC12345'), isTrue);
    final query = _query('football', 'nfl', '4391');

    await controller.loadCatalog(query: query);
    controller.toggleSlateGame(inWeek.id);
    expect(controller.selectedGameIds, isEmpty);

    responseStale = false;
    await controller.loadCatalog(query: query);
    controller.toggleSlateGame(inWeek.id);
    expect(controller.selectedGameIds, {inWeek.id});

    responseStale = true;
    await controller.loadCatalog(query: query);
    controller.toggleSlateGame(inWeek.id);
    expect(controller.selectedGameIds, isEmpty);
    controller.toggleSlateGame(inWeek.id);
    expect(controller.selectedGameIds, isEmpty);

    responseStale = false;
    responseExpiresAt = DateTime.now().toUtc().subtract(
      const Duration(seconds: 1),
    );
    await controller.loadCatalog(query: query);
    controller.toggleSlateGame(inWeek.id);
    expect(controller.selectedGameIds, isEmpty);

    responseExpiresAt = DateTime.now().toUtc().add(const Duration(hours: 1));
    responseGames = <Game>[afterWeek];
    await controller.loadCatalog(query: query);
    controller.toggleSlateGame(afterWeek.id);
    expect(controller.selectedGameIds, isEmpty);
  });

  test('published selected games use the live week snapshot', () async {
    final catalogGame = _game('shared-game', const Duration(days: 2));
    final selectedGame = catalogGame.copyWith(
      status: GameStatus.finalStatus,
      homeScore: 3,
      awayScore: 1,
      winnerTeamId: catalogGame.homeTeam.id,
      resultVersion: 2,
      pickRevealCompletedAt: DateTime.now().toUtc(),
    );
    _stubArena(
      repository,
      catalogGames: [catalogGame],
      selectedGames: [selectedGame],
      weekStatus: 'review',
    );
    when(
      () => repository.watchRevealedPicks(
        'league-1',
        'week-0001',
        selectedGame.id,
      ),
    ).thenAnswer((_) => Stream.value(const <RevealedPick>[]));
    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );
    addTearDown(controller.dispose);
    await _flush();

    expect(await controller.joinArena('ABC12345'), isTrue);
    await controller.loadCatalog();
    await _flush();

    expect(controller.catalogGames, isEmpty);
    expect(controller.selectedGames.single.status, GameStatus.finalStatus);
    expect(controller.selectedGames.single.homeScore, 3);
    expect(controller.selectedGames.single.pickRevealCompletedAt, isNotNull);
    verifyNever(
      () => repository.listSportsCatalog(
        leagueId: any(named: 'leagueId'),
        weekId: any(named: 'weekId'),
        query: any(named: 'query'),
        timezone: any(named: 'timezone'),
        weekStartAt: any(named: 'weekStartAt'),
        weekEndAt: any(named: 'weekEndAt'),
        forceRefresh: any(named: 'forceRefresh'),
      ),
    );
  });

  test(
    'pick mutation sanitizes its request key and blocks double taps',
    () async {
      final game = _game(
        'theSportsDbTest:baseball:2388513',
        const Duration(days: 1),
      );
      final save = Completer<EntrySaveResult>();
      _stubArena(
        repository,
        catalogGames: const [],
        selectedGames: [game],
        weekStatus: 'open',
      );
      when(
        () => repository.submitOrConfirmEntry(
          leagueId: any(named: 'leagueId'),
          weekId: any(named: 'weekId'),
          picks: any(named: 'picks'),
          requestId: any(named: 'requestId'),
        ),
      ).thenAnswer((_) => save.future);
      final controller = AppController.connected(
        runtimeMode: AppRuntimeMode.firebaseEmulator,
        repository: repository,
        auth: auth,
      );
      addTearDown(controller.dispose);
      await _flush();
      expect(await controller.joinArena('ABC12345'), isTrue);
      await _flush();

      final first = controller.chooseTeam(game, game.awayTeam.id);
      final duplicate = controller.chooseTeam(game, game.homeTeam.id);
      expect(controller.pickRequestInFlight(game.id), isTrue);
      final requestIds = verify(
        () => repository.submitOrConfirmEntry(
          leagueId: 'league-1',
          weekId: 'week-0001',
          picks: {game.id: game.awayTeam.id},
          requestId: captureAny(named: 'requestId'),
        ),
      ).captured;
      expect(requestIds, hasLength(1));
      expect(requestIds.single, matches(RegExp(r'^[A-Za-z0-9_-]{8,128}$')));
      expect(requestIds.single, isNot(contains(':')));
      save.complete(
        const EntrySaveResult(
          savedPickCount: 1,
          totalRequiredPickCount: 1,
          completionState: 'complete',
        ),
      );
      await Future.wait([first, duplicate]);

      expect(controller.picks[game.id], game.awayTeam.id);
      expect(controller.syncStateFor(game.id), PickSyncState.synced);
    },
  );

  test(
    'private pick stream retains the authoritative graded outcome',
    () async {
      final scheduledGame = _game('graded-pick', const Duration(days: -1));
      final game = scheduledGame.copyWith(
        status: GameStatus.finalStatus,
        homeScore: 4,
        awayScore: 2,
        winnerTeamId: scheduledGame.homeTeam.id,
        resultVersion: 3,
      );
      final pick = Pick(
        gameId: game.id,
        selectedTeamId: game.homeTeam.id,
        selectedAt: game.scheduledAtUtc.subtract(const Duration(hours: 2)),
        updatedAt: game.scheduledAtUtc,
        serverConfirmedAt: game.scheduledAtUtc.subtract(
          const Duration(hours: 2),
        ),
        lockAtSnapshot: game.effectiveLockAtUtc,
        lockedAt: game.effectiveLockAtUtc,
        outcome: PickOutcome.correct,
        points: 1,
        outcomeVersion: 3,
      );
      _stubArena(
        repository,
        catalogGames: const [],
        selectedGames: [game],
        weekStatus: 'review',
        ownPicks: [pick],
      );
      when(
        () => repository.watchRevealedPicks('league-1', 'week-0001', game.id),
      ).thenAnswer((_) => Stream.value(const <RevealedPick>[]));

      final controller = AppController.connected(
        runtimeMode: AppRuntimeMode.firebaseEmulator,
        repository: repository,
        auth: auth,
      );
      addTearDown(controller.dispose);
      await _flush();
      expect(await controller.joinArena('ABC12345'), isTrue);
      await _flush();

      expect(controller.pickFor(game.id), same(pick));
      expect(controller.pickFor(game.id)?.outcome, PickOutcome.correct);
      expect(controller.pickFor(game.id)?.outcomeVersion, 3);
    },
  );

  test('reveal processing hydrates even with a stale client lock', () async {
    // The callable is authoritative. The browser may still hold the pre-lock
    // game snapshot for a moment when the server has already revealed it.
    final game = _game('server-locked-client-stale', const Duration(days: 1));
    final revealedPick = RevealedPick(
      uid: 'member-1',
      displayName: 'Connected Member',
      selectedTeamId: game.awayTeam.id,
      outcome: PickOutcome.correct,
      points: 1,
    );
    _stubArena(
      repository,
      catalogGames: const [],
      selectedGames: [game],
      weekStatus: 'open',
    );
    when(
      () => repository.revealLockedGamePicks(
        leagueId: 'league-1',
        weekId: 'week-0001',
      ),
    ).thenAnswer(
      (_) async => RevealResult(
        revealedGameCount: 1,
        revealsByGame: {
          game.id: [revealedPick],
        },
      ),
    );

    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );
    addTearDown(controller.dispose);
    await _flush();
    expect(await controller.joinArena('ABC12345'), isTrue);
    await _flush();

    expect(await controller.processLockedPicks(), isTrue);
    expect(
      controller.revealsFor(game.id).map((pick) => pick.selectedTeamId),
      contains(game.awayTeam.id),
    );
  });

  test('successful reveal retry clears the previous server error', () async {
    final game = _game('reveal-retry', const Duration(days: 1));
    var attempts = 0;
    _stubArena(
      repository,
      catalogGames: const [],
      selectedGames: [game],
      weekStatus: 'open',
    );
    when(
      () => repository.revealLockedGamePicks(
        leagueId: 'league-1',
        weekId: 'week-0001',
      ),
    ).thenAnswer((_) async {
      attempts += 1;
      if (attempts == 1) {
        throw const RepositoryException(
          'unavailable',
          'Reveal processing is temporarily unavailable.',
        );
      }
      return const RevealResult(revealedGameCount: 0, revealsByGame: {});
    });

    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );
    addTearDown(controller.dispose);
    await _flush();
    expect(await controller.joinArena('ABC12345'), isTrue);
    await _flush();

    expect(await controller.processLockedPicks(), isFalse);
    expect(controller.errorMessage, isNotNull);
    expect(await controller.processLockedPicks(), isTrue);
    expect(controller.errorMessage, isNull);
  });

  test('draft save reconciles additions and removals exactly', () async {
    final kept = _game('kept', const Duration(days: 1));
    final removed = _game('removed', const Duration(days: 2));
    final added = _game('added', const Duration(days: 3));
    _stubArena(
      repository,
      catalogGames: [kept, added],
      selectedGames: [kept, removed],
      weekStatus: 'draft',
    );
    final calls = <({List<Game> games, List<String> removals})>[];
    when(
      () => repository.saveDraftSlate(
        leagueId: any(named: 'leagueId'),
        weekId: any(named: 'weekId'),
        chunkKey: any(named: 'chunkKey'),
        games: any(named: 'games'),
        removeGameIds: any(named: 'removeGameIds'),
        requestId: any(named: 'requestId'),
      ),
    ).thenAnswer((invocation) async {
      calls.add((
        games: invocation.namedArguments[#games] as List<Game>,
        removals: invocation.namedArguments[#removeGameIds] as List<String>,
      ));
      return 2;
    });
    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );
    addTearDown(controller.dispose);
    await _flush();
    expect(await controller.joinArena('ABC12345'), isTrue);
    await controller.loadCatalog();
    await _flush();

    controller.toggleSlateGame(removed.id);
    controller.toggleSlateGame(added.id);
    expect(await controller.saveDraftSlate(), isTrue);

    expect(
      calls.expand((call) => call.games).map((game) => game.id),
      contains(added.id),
    );
    expect(
      calls.expand((call) => call.games).map((game) => game.id),
      isNot(contains(kept.id)),
    );
    expect(calls.expand((call) => call.removals), contains(removed.id));
    expect(controller.draftSyncState, DraftSyncState.saved);
  });

  test('draft save persists removal of the final selected game', () async {
    final onlyGame = _game('only-game', const Duration(days: 1));
    final games = StreamController<List<Game>>.broadcast();
    addTearDown(games.close);
    _stubArena(
      repository,
      catalogGames: [onlyGame],
      selectedGames: [onlyGame],
      weekStatus: 'draft',
    );
    when(
      () => repository.watchWeekGames('league-1', 'week-0001'),
    ).thenAnswer((_) => games.stream);
    final removals = <String>[];
    when(
      () => repository.saveDraftSlate(
        leagueId: any(named: 'leagueId'),
        weekId: any(named: 'weekId'),
        chunkKey: any(named: 'chunkKey'),
        games: any(named: 'games'),
        removeGameIds: any(named: 'removeGameIds'),
        requestId: any(named: 'requestId'),
      ),
    ).thenAnswer((invocation) async {
      expect(invocation.namedArguments[#games], isEmpty);
      removals.addAll(
        invocation.namedArguments[#removeGameIds] as List<String>,
      );
      return 0;
    });
    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );
    addTearDown(controller.dispose);
    await _flush();
    final join = controller.joinArena('ABC12345');
    await _flush();
    games.add([onlyGame]);
    expect(await join, isTrue);
    await _flush();

    controller.toggleSlateGame(onlyGame.id);
    expect(controller.selectedGameIds, isEmpty);
    expect(await controller.saveDraftSlate(), isTrue);
    expect(removals, [onlyGame.id]);
    expect(controller.draftSyncState, DraftSyncState.saved);

    games.add(const []);
    await _flush();
    expect(controller.selectedWeekGames, isEmpty);
    expect(controller.selectedGameIds, isEmpty);
  });

  test('manual game retry keeps one idempotency request ID', () async {
    _stubArena(
      repository,
      catalogGames: const [],
      selectedGames: const [],
      weekStatus: 'draft',
    );
    var attempts = 0;
    when(
      () => repository.createManualGame(
        leagueId: any(named: 'leagueId'),
        weekId: any(named: 'weekId'),
        sportCode: any(named: 'sportCode'),
        leagueCode: any(named: 'leagueCode'),
        leagueName: any(named: 'leagueName'),
        season: any(named: 'season'),
        scheduledAt: any(named: 'scheduledAt'),
        homeTeam: any(named: 'homeTeam'),
        awayTeam: any(named: 'awayTeam'),
        venueName: any(named: 'venueName'),
        neutralSite: any(named: 'neutralSite'),
        requestId: any(named: 'requestId'),
      ),
    ).thenAnswer((_) async {
      attempts += 1;
      if (attempts == 1) {
        throw const RepositoryException(
          'unavailable',
          'The first response was lost.',
        );
      }
      return 'manual:custom:stable-game';
    });
    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );
    addTearDown(controller.dispose);
    await _flush();
    expect(await controller.joinArena('ABC12345'), isTrue);
    await _flush();

    final scheduledAt = DateTime.now().add(const Duration(days: 1));
    expect(
      await controller.addManualGame(
        homeName: 'Home Club',
        awayName: 'Away Club',
        leagueName: 'Test League',
        scheduledAt: scheduledAt,
        venueName: 'Test Park',
      ),
      isFalse,
    );
    expect(
      await controller.addManualGame(
        homeName: 'Home Club',
        awayName: 'Away Club',
        leagueName: 'Test League',
        scheduledAt: scheduledAt,
        venueName: 'Test Park',
      ),
      isTrue,
    );

    final requestIds = verify(
      () => repository.createManualGame(
        leagueId: 'league-1',
        weekId: 'week-0001',
        sportCode: 'custom',
        leagueCode: 'test-league',
        leagueName: 'Test League',
        season: '${scheduledAt.year}',
        scheduledAt: scheduledAt,
        homeTeam: any(named: 'homeTeam'),
        awayTeam: any(named: 'awayTeam'),
        venueName: 'Test Park',
        neutralSite: false,
        requestId: captureAny(named: 'requestId'),
      ),
    ).captured.cast<String>();
    expect(requestIds, hasLength(2));
    expect(requestIds.toSet(), hasLength(1));
    expect(requestIds.first, matches(RegExp(r'^[A-Za-z0-9_-]{8,128}$')));
  });

  test('scoped refresh retains the authoritative delayed result', () async {
    final game = _game('refresh-game', const Duration(hours: 2));
    _stubArena(
      repository,
      catalogGames: const [],
      selectedGames: [game],
      weekStatus: 'open',
    );
    const refreshResult = RefreshResult(updatedGameCount: 0, delayed: true);
    when(
      () => repository.refreshSelectedGames(
        leagueId: 'league-1',
        weekId: 'week-0001',
        forceRefresh: true,
        gameId: game.id,
      ),
    ).thenAnswer((_) async => refreshResult);
    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );
    addTearDown(controller.dispose);
    await _flush();
    expect(await controller.joinArena('ABC12345'), isTrue);
    await _flush();

    final result = await controller.refreshWeekResults(gameId: game.id);

    expect(result, same(refreshResult));
    expect(controller.latestRefreshResult, same(refreshResult));
  });

  test('non-final override clears scores and forwards corrected UTC', () async {
    final scheduled = _game('override-game', const Duration(hours: 2));
    final game = scheduled.copyWith(
      status: GameStatus.finalStatus,
      homeScore: 3,
      awayScore: 1,
      winnerTeamId: scheduled.homeTeam.id,
    );
    final correctedAt = game.scheduledAtUtc.add(const Duration(days: 8));
    _stubArena(
      repository,
      catalogGames: const [],
      selectedGames: [game],
      weekStatus: 'open',
    );
    when(
      () => repository.overrideGameResult(
        leagueId: 'league-1',
        weekId: 'week-0001',
        gameId: game.id,
        status: GameStatus.postponed,
        homeScore: null,
        awayScore: null,
        winnerTeamId: null,
        reason: 'Official postponement notice',
        scheduledAtUtc: correctedAt,
      ),
    ).thenAnswer((_) async => 'version-2');
    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );
    addTearDown(controller.dispose);
    await _flush();
    expect(await controller.joinArena('ABC12345'), isTrue);
    await _flush();

    expect(
      await controller.recordOverride(
        game.id,
        'Official postponement notice',
        status: GameStatus.postponed,
        scheduledAtUtc: correctedAt,
      ),
      isTrue,
    );
    verify(
      () => repository.overrideGameResult(
        leagueId: 'league-1',
        weekId: 'week-0001',
        gameId: game.id,
        status: GameStatus.postponed,
        homeScore: null,
        awayScore: null,
        winnerTeamId: null,
        reason: 'Official postponement notice',
        scheduledAtUtc: correctedAt,
      ),
    ).called(1);
  });
}

LeagueSummary _leagueSummary({
  String weekId = 'week-0001',
  String pickerUid = 'owner',
  int standingsEpoch = 0,
  int standingsBuiltEpoch = 0,
  int? standingsBuiltMemberCount,
}) => LeagueSummary(
  id: 'league-1',
  name: 'Connected Arena',
  timezone: 'America/Chicago',
  currentWeekId: weekId,
  currentPickerUid: pickerUid,
  pickerParticipatesInPicks: false,
  pickLockPolicy: PickLockPolicy.perGame,
  standingsEpoch: standingsEpoch,
  standingsBuiltEpoch: standingsBuiltEpoch,
  standingsBuiltMemberCount: standingsBuiltMemberCount,
);

Standing _standing(String uid, {int standingsEpoch = 0}) => Standing(
  uid: uid,
  displayName: 'Member $uid',
  totalPoints: 1,
  totalCorrect: 1,
  totalIncorrect: 0,
  totalVoid: 0,
  totalGraded: 1,
  eligibleWeeks: 1,
  pickerWeeks: 0,
  weeklyTitles: 0,
  bestWeekPoints: 1,
  currentRank: 1,
  standingsEpoch: standingsEpoch,
);

WeekSummary _weekSummary({
  String id = 'week-0001',
  int sequentialNumber = 1,
  String pickerUid = 'owner',
  String status = 'draft',
  int selectedGameCount = 0,
  String? nextPickerUid,
  CatalogPresentation catalogPresentation =
      const CatalogPresentation.disabled(),
}) => WeekSummary(
  id: id,
  sequentialNumber: sequentialNumber,
  label: 'Week $sequentialNumber',
  pickerUid: pickerUid,
  status: status,
  startAt: DateTime.now().toUtc(),
  endAt: DateTime.now().toUtc().add(const Duration(days: 7)),
  finalizedAt: null,
  winnerUids: const [],
  highScore: null,
  pickerParticipatesInPicks: false,
  lockPolicy: PickLockPolicy.perGame,
  selectedGameCount: selectedGameCount,
  eligibleMemberCount: 0,
  nextPickerUid: nextPickerUid,
  catalogPresentation: catalogPresentation,
);

void _stubArena(
  _MockLeagueRepository repository, {
  required List<Game> catalogGames,
  required List<Game> selectedGames,
  required String weekStatus,
  String memberUid = 'owner',
  LeagueRole memberRole = LeagueRole.owner,
  String pickerUid = 'owner',
  CatalogPresentation catalogPresentation =
      const CatalogPresentation.disabled(),
  LeagueSummary? leagueSummary,
  WeekSummary? weekSummary,
  Stream<LeagueSummary?>? leagueStream,
  Stream<WeekSummary?>? weekStream,
  List<Standing> standings = const <Standing>[],
  Stream<List<Standing>>? standingsStream,
  List<Pick> ownPicks = const <Pick>[],
}) {
  final league = leagueSummary ?? _leagueSummary(pickerUid: pickerUid);
  final week =
      weekSummary ??
      _weekSummary(
        pickerUid: pickerUid,
        status: weekStatus,
        selectedGameCount: selectedGames.length,
        catalogPresentation: catalogPresentation,
      );
  final member = LeagueMember(
    uid: memberUid,
    displayName: memberUid == 'owner' ? 'Connected Owner' : 'Connected Member',
    role: memberRole,
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
  ).thenAnswer((_) => leagueStream ?? Stream.value(league));
  when(
    () => repository.watchMembers('league-1'),
  ).thenAnswer((_) => Stream.value([member]));
  when(
    () => repository.watchStandings('league-1'),
  ).thenAnswer((_) => standingsStream ?? Stream.value(standings));
  when(
    () => repository.watchFinalizedWeeks('league-1'),
  ).thenAnswer((_) => Stream.value(const <WeekSummary>[]));
  when(
    () => repository.watchWeek('league-1', 'week-0001'),
  ).thenAnswer((_) => weekStream ?? Stream.value(week));
  when(
    () => repository.watchWeekGames('league-1', 'week-0001'),
  ).thenAnswer((_) => Stream.value(selectedGames));
  when(
    () => repository.watchPublicEntries('league-1', 'week-0001'),
  ).thenAnswer((_) => Stream.value(const <EntrySummary>[]));
  when(
    () => repository.watchOwnPrivatePicks('league-1', 'week-0001'),
  ).thenAnswer((_) => Stream.value(ownPicks));
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
          providerLeagueId: '4424',
          season: '2026',
        ),
      ],
      games: catalogGames,
      cacheHit: false,
      stale: false,
      delayed: false,
      cachedAt: DateTime.now().toUtc(),
      effectiveQuery:
          query?.snapshot ??
          CatalogQuerySnapshot(
            sportCode: 'baseball',
            leagueCode: 'mlb',
            providerLeagueId: '4424',
            season: '2026',
            from: DateTime.utc(2026, 7, 31),
            to: DateTime.utc(2026, 8, 6),
            timezone: 'America/Chicago',
          ),
      availability: CatalogAvailability(
        state: catalogGames.isEmpty
            ? CatalogAvailabilityState.noGames
            : CatalogAvailabilityState.available,
      ),
    );
  });
}

CatalogQuery _query(String sportCode, String leagueCode, String providerId) {
  final today = DateTime.now().toUtc();
  return CatalogQuery(
    sportCode: sportCode,
    leagueCode: leagueCode,
    providerLeagueId: providerId,
    season: '${today.year}',
    from: DateTime.utc(today.year, today.month, today.day),
    to: DateTime.utc(
      today.year,
      today.month,
      today.day,
    ).add(const Duration(days: 6)),
    timezone: 'America/Chicago',
  );
}

SportsCatalogResult _catalogResult(
  CatalogQuery? query,
  List<Game> games, {
  bool stale = false,
  DateTime? expiresAt,
}) => SportsCatalogResult(
  provider: 'theSportsDbTest',
  supportedSports: query == null
      ? const []
      : [CatalogSport(code: query.sportCode, displayName: query.sportCode)],
  supportedLeagues: query == null
      ? const []
      : [
          CatalogLeague(
            code: query.leagueCode,
            displayName: query.leagueCode.toUpperCase(),
            sportCode: query.sportCode,
            providerLeagueId: query.providerLeagueId,
            season: query.season,
          ),
        ],
  games: games,
  cacheHit: false,
  stale: stale,
  delayed: false,
  cachedAt: DateTime.now().toUtc(),
  expiresAt: expiresAt,
  effectiveQuery: query?.snapshot,
  availability: CatalogAvailability(
    state: games.isEmpty
        ? CatalogAvailabilityState.noGames
        : CatalogAvailabilityState.available,
  ),
);

Game _game(
  String id,
  Duration startsIn, {
  String sportCode = 'football',
  String leagueCode = 'nfl',
  String leagueName = 'Test League',
}) {
  final start = DateTime.now().toUtc().add(startsIn);
  return Game(
    id: id,
    provider: 'theSportsDbTest',
    providerGameId: id,
    sportCode: sportCode,
    leagueCode: leagueCode,
    leagueName: leagueName,
    season: '${start.year}',
    scheduledAtUtc: start,
    publishedScheduledAtUtc: start,
    effectiveLockAtUtc: start,
    homeTeam: Team(
      id: '$id-home',
      name: '$id Home',
      shortName: 'Home',
      abbreviation: 'H',
    ),
    awayTeam: Team(
      id: '$id-away',
      name: '$id Away',
      shortName: 'Away',
      abbreviation: 'A',
    ),
    status: GameStatus.scheduled,
    providerLastUpdatedAt: DateTime.now().toUtc(),
    lastSyncedAt: DateTime.now().toUtc(),
    resultVersion: 1,
    sourcePayloadHash: List.filled(64, 'a').join(),
  );
}

Future<void> _flush() => Future<void>.delayed(const Duration(milliseconds: 20));
