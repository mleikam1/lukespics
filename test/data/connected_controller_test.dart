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

    expect(controller.catalogGames.single.status, GameStatus.scheduled);
    expect(controller.selectedGames.single.status, GameStatus.finalStatus);
    expect(controller.selectedGames.single.homeScore, 3);
    expect(controller.selectedGames.single.pickRevealCompletedAt, isNotNull);
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
}

void _stubArena(
  _MockLeagueRepository repository, {
  required List<Game> catalogGames,
  required List<Game> selectedGames,
  required String weekStatus,
}) {
  final league = const LeagueSummary(
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
    status: weekStatus,
    startAt: DateTime.now().toUtc(),
    endAt: DateTime.now().toUtc().add(const Duration(days: 7)),
    finalizedAt: null,
    winnerUids: const [],
    highScore: null,
    pickerParticipatesInPicks: false,
    lockPolicy: PickLockPolicy.perGame,
    selectedGameCount: selectedGames.length,
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
  ).thenAnswer((_) => Stream.value(selectedGames));
  when(
    () => repository.watchPublicEntries('league-1', 'week-0001'),
  ).thenAnswer((_) => Stream.value(const <EntrySummary>[]));
  when(
    () => repository.watchOwnPrivatePicks('league-1', 'week-0001'),
  ).thenAnswer((_) => Stream.value(const <Pick>[]));
  when(
    () => repository.listSportsCatalog(
      leagueId: 'league-1',
      weekId: 'week-0001',
      query: any(named: 'query'),
    ),
  ).thenAnswer(
    (_) async => SportsCatalogResult(
      provider: 'theSportsDbTest',
      games: catalogGames,
      cacheHit: false,
      stale: false,
      delayed: false,
      cachedAt: DateTime.now().toUtc(),
    ),
  );
}

Game _game(String id, Duration startsIn) {
  final start = DateTime.now().toUtc().add(startsIn);
  return Game(
    id: id,
    provider: 'theSportsDbTest',
    providerGameId: id,
    sportCode: 'football',
    leagueCode: 'nfl',
    leagueName: 'Test League',
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
