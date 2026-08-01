// ignore_for_file: prefer_initializing_formals

import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/bootstrap.dart';
import '../../core/firebase/browser_e2e_location.dart';
import '../../core/firebase/app_telemetry.dart';
import '../models/game.dart';
import '../models/member.dart';
import '../models/pick.dart';
import '../models/standing.dart';
import '../repositories/firebase_league_repository.dart';
import '../repositories/league_repository.dart';

final appControllerProvider = ChangeNotifierProvider<AppController>(
  (ref) => AppController.demo(),
);

enum PickSyncState { idle, saving, synced, offline, rejected }

enum DraftSyncState { pristine, dirty, saving, saved, error }

final class AppController extends ChangeNotifier {
  AppController.demo({
    this.bootstrapMessage,
    bool signedIn = false,
    bool hasLeague = false,
    bool offline = false,
  }) : runtimeMode = AppRuntimeMode.demo,
       _signedIn = signedIn,
       _hasLeague = hasLeague,
       _offline = offline,
       _repository = null,
       _auth = null,
       _browserE2eAlias = null,
       _telemetry = AppTelemetry(enabled: false) {
    _seed();
    if (_hasLeague) _inviteCode = 'DEMO-7H3K';
  }

  AppController.connected({
    required this.runtimeMode,
    this.bootstrapMessage,
    LeagueRepository? repository,
    FirebaseAuth? auth,
  }) : assert(
         runtimeMode == AppRuntimeMode.firebase ||
             runtimeMode == AppRuntimeMode.firebaseEmulator,
       ),
       _signedIn = false,
       _hasLeague = false,
       _offline = false,
       _repository = repository ?? FirebaseLeagueRepository(),
       _auth = auth ?? FirebaseAuth.instance,
       _browserE2eAlias = _resolveBrowserE2eAlias(runtimeMode),
       _telemetry = AppTelemetry(
         enabled: runtimeMode == AppRuntimeMode.firebase,
       ) {
    final currentUser = _auth!.currentUser;
    if (currentUser != null) {
      _signedIn = true;
      _currentUserId = currentUser.uid;
      _displayName = _connectedDisplayName(currentUser.displayName);
      unawaited(_resumeExistingSession());
    }
    _authSubscription = _auth.authStateChanges().listen(_handleAuthStateChange);
    final browserE2eAlias = _browserE2eAlias;
    if (currentUser == null &&
        browserE2eAlias != null &&
        browserE2eSessionMatches(browserE2eAlias)) {
      unawaited(_restoreBrowserE2eSession(browserE2eAlias));
    }
  }

  final AppRuntimeMode runtimeMode;
  final String? bootstrapMessage;
  final LeagueRepository? _repository;
  final FirebaseAuth? _auth;
  final String? _browserE2eAlias;
  final AppTelemetry _telemetry;

  bool _signedIn;
  bool _hasLeague;
  bool _authBusy = false;
  bool _browserE2eAccountCreated = false;
  bool _offline;
  bool _slatePublished = false;
  bool _demoReviewReady = false;
  bool _weekFinalized = false;
  bool _restoringSession = false;
  bool _pickerParticipatesInPicks = false;
  PickLockPolicy _pickLockPolicy = PickLockPolicy.perGame;
  bool _weekPickerParticipatesInPicks = false;
  PickLockPolicy _weekLockPolicy = PickLockPolicy.perGame;
  bool _catalogLoading = false;
  bool _draftSaving = false;
  ThemeMode _themeMode = ThemeMode.system;
  String _displayName = 'Member';
  String _currentUserId = '';
  String _currentPickerId = '';
  String _leagueName = 'Luke’s Picks Arena';
  String _leagueTimezone = 'UTC';
  String _weekLabel = 'Current week';
  String _weekStatus = 'draft';
  int _weekSequentialNumber = 0;
  int _eligibleMemberCount = 0;
  String _catalogProvider = 'manual';
  bool _catalogCacheHit = false;
  bool _catalogStale = false;
  bool _catalogDelayed = false;
  DateTime? _catalogCachedAt;
  DateTime? _catalogExpiresAt;
  String? _catalogError;
  DateTime? _lastCatalogRefreshAt;
  DateTime? _weekStartAt;
  DateTime? _weekEndAt;
  CatalogQuery? _activeCatalogQuery;
  int _catalogRequestGeneration = 0;
  int _activeContextGeneration = 0;
  int _weekSubscriptionGeneration = 0;
  int _draftSaveGeneration = 0;
  int _standingsContextGeneration = 0;
  int _standingsEpoch = 0;
  int _standingsBuiltEpoch = 0;
  int? _standingsBuiltMemberCount;
  List<CatalogSport> _catalogSports = const <CatalogSport>[];
  List<CatalogLeague> _catalogLeagues = const <CatalogLeague>[];
  CatalogPresentation _catalogPresentation =
      const CatalogPresentation.disabled();
  CatalogAvailability _catalogAvailability =
      const CatalogAvailability.unknown();
  DraftSyncState _draftSyncState = DraftSyncState.pristine;
  String? _draftOperationId;
  String? _manualGameOperationKey;
  String? _manualGameRequestId;
  String? _publishRequestId;
  String? _lastNextPickerUid;
  String? _errorMessage;
  String? _activeLeagueId;
  String? _activeWeekId;
  String? _inviteCode;
  StreamSubscription<User?>? _authSubscription;
  StreamSubscription<LeagueSummary?>? _leagueSubscription;
  StreamSubscription<WeekSummary?>? _weekSubscription;
  StreamSubscription<List<LeagueMember>>? _membersSubscription;
  StreamSubscription<List<Standing>>? _standingsSubscription;
  StreamSubscription<List<Game>>? _gamesSubscription;
  StreamSubscription<List<EntrySummary>>? _entriesSubscription;
  StreamSubscription<List<Pick>>? _ownPicksSubscription;
  StreamSubscription<List<WeekSummary>>? _historySubscription;
  final Map<String, StreamSubscription<List<RevealedPick>>>
  _revealSubscriptions = {};

  final Set<String> _serverDraftGameIds = {};
  final Map<String, Game> _serverDraftGamesById = {};
  final Map<String, String> _pickTeamIds = {};
  final Map<String, String> _confirmedPickTeamIds = {};
  final Map<String, PickSyncState> _pickSyncStates = {};
  final Map<String, String> _pickErrors = {};
  final Set<String> _pickRequestsInFlight = {};
  final Map<String, String> _overrideReasons = {};
  final Map<String, List<RevealedPick>> _revealedPicks = {};
  final List<EntrySummary> _entries = [];
  final List<WeekSummary> _historyWeeks = [];
  final Map<String, Game> _currentCatalogResultsById = {};
  final Map<String, Game> _catalogGameCacheById = {};
  final Map<String, Game> _selectedDraftGamesById = {};
  final List<Game> _selectedWeekGames = [];
  final List<LeagueMember> _members = [];
  final List<Standing> _latestStandingsSnapshot = [];
  final List<Standing> _standings = [];

  bool get signedIn => _signedIn;
  bool get hasLeague => _hasLeague;
  bool get authBusy => _authBusy;
  bool get offline => _offline;
  bool get slatePublished => _slatePublished;
  bool get catalogLoading => _catalogLoading;
  String? get catalogError => _catalogError;
  String get catalogProvider => _catalogProvider;
  bool get catalogCacheHit => _catalogCacheHit;
  bool get catalogStale => _catalogStale;
  bool get catalogDelayed => _catalogDelayed;
  DateTime? get catalogCachedAt => _catalogCachedAt;
  DateTime? get catalogExpiresAt => _catalogExpiresAt;
  List<CatalogSport> get catalogSports => List.unmodifiable(_catalogSports);
  List<CatalogLeague> get catalogLeagues => List.unmodifiable(_catalogLeagues);
  CatalogPresentation get catalogPresentation => _catalogPresentation;
  CatalogAvailability get catalogAvailability => _catalogAvailability;
  CatalogQuery? get activeCatalogQuery => _activeCatalogQuery;
  DateTime? get weekStartAt => _weekStartAt;
  DateTime? get weekEndAt => _weekEndAt;
  DraftSyncState get draftSyncState => _draftSyncState;
  bool get draftSaving => _draftSaving;
  int get eligibleMemberCount => _eligibleMemberCount;
  int get prospectiveEligibleMemberCount {
    if (_eligibleMemberCount > 0) return _eligibleMemberCount;
    final active = _members.where((member) => member.isActive).length;
    return _weekPickerParticipatesInPicks
        ? active
        : (active - 1).clamp(0, active);
  }

  int get weekSequentialNumber => _weekSequentialNumber;
  PickLockPolicy get weekLockPolicy => _weekLockPolicy;
  PickLockPolicy get futureWeekLockPolicy => _pickLockPolicy;
  bool get pickerParticipatesInFutureWeeks => _pickerParticipatesInPicks;
  bool get pickerParticipatesInCurrentWeek => _weekPickerParticipatesInPicks;
  bool get demoReviewReady => _demoReviewReady;
  bool get canFinalizeWeek {
    if (isDemo) return _demoReviewReady;
    if (_selectedWeekGames.isEmpty || _weekFinalized) return false;
    return _selectedWeekGames.every(
      (game) =>
          game.pickRevealCompletedAt != null &&
          (game.isVoid ||
              (game.status == GameStatus.finalStatus &&
                  game.winnerTeamId != null)),
    );
  }

  bool get weekFinalized => _weekFinalized;
  ThemeMode get themeMode => _themeMode;
  String get displayName => _displayName;
  String? get errorMessage => _errorMessage;
  String? get activeLeagueId => _activeLeagueId;
  String? get activeWeekId => _activeWeekId;
  String? get inviteCode => _inviteCode;
  bool get isDemo => runtimeMode == AppRuntimeMode.demo;
  String get currentUserId => _currentUserId;
  String get currentPickerId => _currentPickerId;
  String get leagueName => _leagueName;
  String get leagueTimezone => _leagueTimezone;
  String get weekLabel => _weekLabel;
  String get weekStatus => _weekStatus;
  String get currentPickerName {
    final matches = _members.where((member) => member.uid == _currentPickerId);
    return matches.isEmpty ? 'Weekly picker' : matches.first.displayName;
  }

  LeagueMember? get proposedNextPicker =>
      PickerRotation(_members).nextAfter(_currentPickerId);

  String? get lastNextPickerName {
    final uid = _lastNextPickerUid;
    if (uid == null) return null;
    final matches = _members.where((member) => member.uid == uid);
    return matches.isEmpty
        ? 'the next active member'
        : matches.first.displayName;
  }

  LeagueMember get currentMember => _members.firstWhere(
    (member) => member.uid == _currentUserId,
    orElse: () => LeagueMember(
      uid: _currentUserId,
      displayName: _displayName,
      role: LeagueRole.member,
      status: MemberStatus.active,
      rotationOrder: _members.length,
      joinedAt: DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
    ),
  );
  LeagueRole get currentRole => currentMember.role;
  bool get canAdmin =>
      currentRole == LeagueRole.owner || currentRole == LeagueRole.commissioner;
  bool get isCurrentUserPicker => _currentUserId == currentPickerId;
  bool get canDraftSlate => isCurrentUserPicker || canAdmin;
  bool get canMakePicks =>
      !isCurrentUserPicker ||
      (_activeWeekId == null
          ? _pickerParticipatesInPicks
          : _weekPickerParticipatesInPicks);

  List<Game> get games =>
      List<Game>.unmodifiable(_currentCatalogResultsById.values);
  List<Game> get catalogGames => games;
  Map<String, Game> get currentCatalogResultsById =>
      Map.unmodifiable(_currentCatalogResultsById);
  Map<String, Game> get catalogGameCacheById =>
      Map.unmodifiable(_catalogGameCacheById);
  Map<String, Game> get selectedDraftGamesById =>
      Map.unmodifiable(_selectedDraftGamesById);
  Set<String> get serverDraftGameIds => Set.unmodifiable(_serverDraftGameIds);
  List<Game> get selectedWeekGames => List.unmodifiable(_selectedWeekGames);
  List<Game> get selectedGames {
    if (_slatePublished) {
      return List<Game>.of(_selectedWeekGames)
        ..sort((a, b) => a.scheduledAtUtc.compareTo(b.scheduledAtUtc));
    }
    return List<Game>.of(_selectedDraftGamesById.values)
      ..sort((a, b) => a.scheduledAtUtc.compareTo(b.scheduledAtUtc));
  }

  Set<String> get selectedGameIds =>
      Set.unmodifiable(_selectedDraftGamesById.keys);
  int get unsavedDraftChangeCount {
    final desiredIds = _selectedDraftGamesById.keys.toSet();
    final changedIds = desiredIds.intersection(_serverDraftGameIds).where((id) {
      final desired = _selectedDraftGamesById[id];
      final server = _serverDraftGamesById[id];
      return desired == null ||
          server == null ||
          !_sameDraftSnapshot(desired, server);
    });
    return desiredIds.difference(_serverDraftGameIds).length +
        _serverDraftGameIds.difference(desiredIds).length +
        changedIds.length;
  }

  bool get hasUnsavedDraftChanges => unsavedDraftChangeCount > 0;
  Map<String, String> get picks => Map.unmodifiable(_pickTeamIds);
  List<LeagueMember> get members => List.unmodifiable(_members);
  List<Standing> get standings => List.unmodifiable(_standings);
  List<EntrySummary> get entries => List.unmodifiable(_entries);
  List<WeekSummary> get historyWeeks => List.unmodifiable(_historyWeeks);
  Map<String, String> get overrideReasons => Map.unmodifiable(_overrideReasons);
  List<RevealedPick> revealsFor(String gameId) =>
      List.unmodifiable(_revealedPicks[gameId] ?? const []);

  Stream<List<EntrySummary>> watchEntriesForWeek(String weekId) {
    final leagueId = _activeLeagueId;
    final repository = _repository;
    if (leagueId == null || repository == null) {
      return Stream.value(const []);
    }
    return repository.watchPublicEntries(leagueId, weekId);
  }

  Stream<List<Game>> watchGamesForWeek(String weekId) {
    final leagueId = _activeLeagueId;
    final repository = _repository;
    if (leagueId == null || repository == null) {
      return Stream.value(const []);
    }
    return repository.watchWeekGames(leagueId, weekId);
  }

  EntrySummary? get currentEntry {
    final matches = _entries.where((entry) => entry.uid == _currentUserId);
    return matches.isEmpty ? null : matches.first;
  }

  String get latestWeekRecord {
    if (isDemo) return '5 / 7';
    final entry = currentEntry;
    if (entry == null) return '—';
    return '${entry.correctCount} / '
        '${entry.correctCount + entry.incorrectCount}';
  }

  int get confirmedPickCount => selectedGames.where((game) {
    final state = _pickSyncStates[game.id];
    return _pickTeamIds.containsKey(game.id) && state == PickSyncState.synced;
  }).length;

  int get requiredPickCount =>
      selectedGames.where((game) => !_isLocked(game)).length;

  PickSyncState syncStateFor(String gameId) =>
      _pickSyncStates[gameId] ?? PickSyncState.idle;
  String? pickErrorFor(String gameId) => _pickErrors[gameId];
  bool pickRequestInFlight(String gameId) =>
      _pickRequestsInFlight.contains(gameId);

  bool isGameLocked(Game game) => _isLocked(game);

  bool _isLocked(Game game) => game.isLockedAt(DateTime.now().toUtc());

  static String _connectedDisplayName(String? value) {
    final trimmed = value?.trim() ?? '';
    return trimmed.isEmpty ? 'Member' : trimmed;
  }

  Future<void> signIn() async {
    if (_authBusy) return;
    _authBusy = true;
    _errorMessage = null;
    notifyListeners();
    try {
      if (runtimeMode == AppRuntimeMode.firebase) {
        final provider = GoogleAuthProvider();
        final credential = kIsWeb
            ? await _auth!.signInWithPopup(provider)
            : await _auth!.signInWithProvider(provider);
        _displayName = credential.user?.displayName?.trim().isNotEmpty == true
            ? credential.user!.displayName!.trim()
            : _displayName;
        await _repository?.ensureUserProfile(displayName: _displayName);
      } else if (runtimeMode == AppRuntimeMode.firebaseEmulator) {
        final alias = _browserE2eAlias;
        final credential = alias == null
            ? await _auth!.signInAnonymously()
            : await _signInBrowserE2eUser(alias);
        if (alias != null) {
          _displayName = _browserE2eDisplayName(alias);
        }
        await credential.user?.updateDisplayName(_displayName);
        await _repository?.ensureUserProfile(displayName: _displayName);
        if (alias != null) browserE2eRememberSession(alias);
      } else {
        await Future<void>.delayed(const Duration(milliseconds: 180));
      }
      _signedIn = true;
      unawaited(_telemetry.log('login_completed'));
    } on FirebaseAuthException catch (error) {
      _errorMessage = error.code == 'popup-closed-by-user'
          ? 'Sign-in was cancelled.'
          : 'Google sign-in could not be completed. Try again.';
    } on Object {
      _errorMessage = 'Sign-in could not be completed. Try again.';
    } finally {
      _authBusy = false;
      notifyListeners();
    }
  }

  static String? _resolveBrowserE2eAlias(AppRuntimeMode runtimeMode) {
    const enabled = bool.fromEnvironment('ENABLE_BROWSER_E2E_AUTH');
    if (!enabled || runtimeMode != AppRuntimeMode.firebaseEmulator) return null;
    if (!kIsWeb) {
      throw StateError('Browser E2E auth is web-only.');
    }
    final base = browserE2eDocumentUri();
    if (base.scheme != 'http' ||
        base.host != '127.0.0.1' ||
        base.port != 5002) {
      throw StateError(
        'Browser E2E auth requires the loopback Hosting emulator.',
      );
    }
    final alias = base.queryParameters['e2eUser'] ?? browserE2eStoredAlias();
    if (!const {'owner', 'member-a', 'member-b'}.contains(alias)) {
      throw StateError('Browser E2E auth requires an approved user alias.');
    }
    return alias;
  }

  Future<UserCredential> _signInBrowserE2eUser(String alias) async {
    if (_browserE2eAccountCreated) {
      return _auth!.signInWithEmailAndPassword(
        email: _browserE2eEmail(alias),
        password: _browserE2ePassword,
      );
    }
    try {
      final credential = await _auth!.createUserWithEmailAndPassword(
        email: _browserE2eEmail(alias),
        password: _browserE2ePassword,
      );
      _browserE2eAccountCreated = true;
      return credential;
    } on FirebaseAuthException catch (error) {
      if (error.code != 'email-already-in-use') rethrow;
      _browserE2eAccountCreated = true;
      return _auth!.signInWithEmailAndPassword(
        email: _browserE2eEmail(alias),
        password: _browserE2ePassword,
      );
    }
  }

  Future<void> _restoreBrowserE2eSession(String alias) async {
    try {
      // Firebase Auth finishes its IndexedDB initialization asynchronously on
      // a full Flutter web reload. Let the normal LOCAL session win first;
      // only use the deterministic emulator credential if it is still absent.
      await Future<void>.delayed(const Duration(milliseconds: 750));
      if (_auth!.currentUser != null) return;
      // Persistence was already configured during emulator bootstrap. Calling
      // setPersistence again while Firebase Auth is restoring its initial
      // state can race the credential request in Flutter web, so this strict
      // test-only fallback performs only the deterministic re-authentication.
      await _auth.signInWithEmailAndPassword(
        email: _browserE2eEmail(alias),
        password: _browserE2ePassword,
      );
      _browserE2eAccountCreated = true;
      _displayName = _browserE2eDisplayName(alias);
    } on FirebaseAuthException catch (error) {
      browserE2eForgetSession();
      _errorMessage =
          'The browser E2E session could not be restored (${error.code}).';
      notifyListeners();
    } on Object catch (error) {
      browserE2eForgetSession();
      _errorMessage =
          'The browser E2E session could not be restored '
          '(${error.runtimeType}).';
      notifyListeners();
    }
  }

  static String _browserE2eEmail(String alias) =>
      'browser-e2e-$alias@demo-lukes-picks-local.test';

  static const _browserE2ePassword = 'Browser-E2E-Emulator-Only-2026!';

  static String _browserE2eDisplayName(String alias) => switch (alias) {
    'owner' => 'Browser Owner',
    'member-a' => 'Browser Member A',
    'member-b' => 'Browser Member B',
    _ => throw StateError('Unsupported browser E2E user alias.'),
  };

  Future<void> signOut() async {
    if (_browserE2eAlias != null) browserE2eForgetSession();
    if (_repository != null) {
      await _auth!.signOut();
    }
    await _cancelLeagueSubscriptions();
    _signedIn = false;
    _hasLeague = false;
    _setActiveLeagueId(null);
    _setActiveWeekId(null);
    _clearCatalogState();
    _selectedWeekGames.clear();
    _selectedDraftGamesById.clear();
    _serverDraftGameIds.clear();
    _serverDraftGamesById.clear();
    _pickTeamIds.clear();
    _confirmedPickTeamIds.clear();
    _pickSyncStates.clear();
    _members.clear();
    _resetStandingsState();
    _entries.clear();
    _historyWeeks.clear();
    notifyListeners();
  }

  Future<void> createArena({
    required String name,
    bool pickerParticipatesInPicks = false,
  }) async {
    _errorMessage = null;
    try {
      if (_repository == null) {
        await Future<void>.delayed(const Duration(milliseconds: 140));
        _pickerParticipatesInPicks = pickerParticipatesInPicks;
      } else {
        final created = await _repository.createLeague(
          name: name.trim().isEmpty ? 'Luke’s Picks Arena' : name.trim(),
          timezone: 'America/Chicago',
          settings: {
            'pickerParticipatesInPicks': pickerParticipatesInPicks,
            'pickLockPolicy': 'perGame',
            'weekStartDay': 1,
            'weekStartTime': '00:00',
            'manualFinalizationRequired': true,
            'providerName': runtimeMode == AppRuntimeMode.firebaseEmulator
                ? 'theSportsDbTest'
                : 'manual',
          },
        );
        _setActiveLeagueId(created.leagueId);
        _inviteCode = created.inviteCode;
        _hasLeague = true;
        final now = DateTime.now().toUtc();
        final week = await _repository.createDraftWeek(
          leagueId: created.leagueId,
          sequentialNumber: 1,
          label: 'Week 1',
          startAt: now,
          endAt: now.add(const Duration(days: 7)),
        );
        _setActiveWeekId(week.weekId);
        _currentPickerId = week.pickerUid;
        _weekSequentialNumber = 1;
        _weekLabel = 'Week 1';
        _weekStatus = 'draft';
        _weekPickerParticipatesInPicks = pickerParticipatesInPicks;
        _clearCatalogState();
        _selectedWeekGames.clear();
        _selectedDraftGamesById.clear();
        _serverDraftGameIds.clear();
        _serverDraftGamesById.clear();
        _pickTeamIds.clear();
        _confirmedPickTeamIds.clear();
        _pickSyncStates.clear();
        await _hydrateMembersAndStandings(created.leagueId);
        await _startLeagueSubscriptions(created.leagueId);
        await loadCatalog();
      }
      _hasLeague = true;
      unawaited(_telemetry.log('league_created'));
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
    } finally {
      notifyListeners();
    }
  }

  Future<bool> joinArena(String inviteCode) async {
    if (inviteCode.trim().length < 6) {
      _errorMessage = 'Enter the full invite code.';
      notifyListeners();
      return false;
    }
    try {
      if (_repository == null) {
        await Future<void>.delayed(const Duration(milliseconds: 140));
      } else {
        _setActiveLeagueId(
          await _repository.joinLeagueByCode(
            inviteCode: inviteCode.trim(),
            nickname: _displayName,
          ),
        );
        await _hydrateJoinedLeague(_activeLeagueId!);
        await _startLeagueSubscriptions(_activeLeagueId!);
      }
      _hasLeague = true;
      unawaited(_telemetry.log('league_joined'));
      _errorMessage = null;
      notifyListeners();
      return true;
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
      notifyListeners();
      return false;
    }
  }

  void clearError() {
    _errorMessage = null;
    notifyListeners();
  }

  void toggleSlateGame(String gameId) {
    if (_slatePublished || !canDraftSlate || _draftSaving) return;
    if (_selectedDraftGamesById.remove(gameId) != null) {
      _markDraftDirty();
      notifyListeners();
      return;
    }
    final game = _currentCatalogResultsById[gameId];
    if (game == null || !isCatalogGameSelectable(game)) return;
    _catalogGameCacheById[game.id] = game;
    _selectedDraftGamesById[game.id] = game;
    _markDraftDirty();
    notifyListeners();
  }

  void removeSlateGame(String gameId) {
    if (_slatePublished || !canDraftSlate || _draftSaving) return;
    if (_selectedDraftGamesById.remove(gameId) != null) _markDraftDirty();
    notifyListeners();
  }

  bool isCatalogGameSelectable(Game game) {
    if (_slatePublished || !canDraftSlate || _draftSaving) return false;
    final now = DateTime.now().toUtc();
    if (_catalogStale ||
        (_catalogExpiresAt != null && !_catalogExpiresAt!.isAfter(now))) {
      return false;
    }
    final weekStartAt = _weekStartAt;
    final weekEndAt = _weekEndAt;
    if ((weekStartAt != null &&
            game.scheduledAtUtc.isBefore(weekStartAt.toUtc())) ||
        (weekEndAt != null && game.scheduledAtUtc.isAfter(weekEndAt.toUtc()))) {
      return false;
    }
    if (!game.scheduledAtUtc.isAfter(now) ||
        !game.effectiveLockAtUtc.isAfter(now)) {
      return false;
    }
    return game.status == GameStatus.scheduled ||
        game.status == GameStatus.delayed;
  }

  void _markDraftDirty() {
    _draftSyncState = DraftSyncState.dirty;
    _draftOperationId = null;
  }

  void _clearCatalogState() {
    _catalogRequestGeneration += 1;
    _catalogLoading = false;
    _currentCatalogResultsById.clear();
    _catalogGameCacheById.clear();
    _catalogSports = const <CatalogSport>[];
    _catalogLeagues = const <CatalogLeague>[];
    _catalogPresentation = const CatalogPresentation.disabled();
    _catalogAvailability = const CatalogAvailability.unknown();
    _activeCatalogQuery = null;
    _catalogProvider = 'manual';
    _catalogCacheHit = false;
    _catalogStale = false;
    _catalogDelayed = false;
    _catalogCachedAt = null;
    _catalogExpiresAt = null;
    _catalogError = null;
    _lastCatalogRefreshAt = null;
    _weekStartAt = null;
    _weekEndAt = null;
  }

  void _resetForExternalWeekChange() {
    _clearCatalogState();
    _selectedWeekGames.clear();
    _selectedDraftGamesById.clear();
    _serverDraftGameIds.clear();
    _serverDraftGamesById.clear();
    _draftSyncState = DraftSyncState.pristine;
    _draftOperationId = null;
    _manualGameOperationKey = null;
    _manualGameRequestId = null;
    _publishRequestId = null;
    _pickTeamIds.clear();
    _confirmedPickTeamIds.clear();
    _pickSyncStates.clear();
    _pickErrors.clear();
    _pickRequestsInFlight.clear();
    _overrideReasons.clear();
    _entries.clear();
    _revealedPicks.clear();
    _eligibleMemberCount = 0;
    _weekFinalized = false;
    _lastNextPickerUid = null;
    _slatePublished = true;
    _weekStatus = 'loading';
  }

  Future<void> loadCatalog({
    CatalogQuery? query,
    bool forceRefresh = false,
    String? sportCode,
    String? leagueCode,
    String? providerLeagueId,
    String? season,
    DateTime? from,
    DateTime? to,
    String? timezone,
    CatalogDateMode? dateMode,
  }) async {
    if (_repository == null || !canDraftSlate || _slatePublished) return;
    final leagueId = _activeLeagueId;
    final weekId = _activeWeekId;
    if (leagueId == null || weekId == null) return;
    final now = DateTime.now().toUtc();
    var requestedQuery = query ?? _activeCatalogQuery;
    final hasLegacyOverride =
        sportCode != null ||
        leagueCode != null ||
        providerLeagueId != null ||
        season != null ||
        from != null ||
        to != null ||
        timezone != null ||
        dateMode != null;
    if (requestedQuery == null && hasLegacyOverride) {
      if (sportCode == null ||
          leagueCode == null ||
          providerLeagueId == null ||
          season == null ||
          from == null ||
          to == null) {
        _catalogError =
            'Choose a supported sport, league, and date range before loading.';
        notifyListeners();
        return;
      }
      requestedQuery = CatalogQuery(
        sportCode: sportCode,
        leagueCode: leagueCode,
        providerLeagueId: providerLeagueId,
        season: season,
        from: from,
        to: to,
        timezone: timezone ?? _leagueTimezone,
        dateMode: dateMode ?? CatalogDateMode.custom,
        weekStartAt: _weekStartAt,
        weekEndAt: _weekEndAt,
      );
    } else if (requestedQuery != null) {
      requestedQuery = requestedQuery.copyWith(
        sportCode: sportCode,
        leagueCode: leagueCode,
        providerLeagueId: providerLeagueId,
        season: season,
        from: from,
        to: to,
        timezone: timezone,
        dateMode: dateMode,
        weekStartAt: requestedQuery.weekStartAt ?? _weekStartAt,
        weekEndAt: requestedQuery.weekEndAt ?? _weekEndAt,
      );
    }
    final shouldForceRefresh = forceRefresh || query?.forceRefresh == true;
    requestedQuery = requestedQuery?.copyWith(forceRefresh: shouldForceRefresh);
    if (_catalogLoading &&
        !shouldForceRefresh &&
        ((requestedQuery == null && _activeCatalogQuery == null) ||
            (requestedQuery != null &&
                _activeCatalogQuery?.sameVisibleQuery(requestedQuery) ==
                    true))) {
      return;
    }
    if (shouldForceRefresh &&
        _lastCatalogRefreshAt != null &&
        now.difference(_lastCatalogRefreshAt!) < const Duration(seconds: 15)) {
      _catalogError =
          'A catalog refresh just ran. Wait a few seconds before retrying.';
      notifyListeners();
      return;
    }
    final requestGeneration = ++_catalogRequestGeneration;
    final changesVisibleQuery =
        requestedQuery != null &&
        (_activeCatalogQuery == null ||
            !_activeCatalogQuery!.sameVisibleQuery(requestedQuery));
    if (changesVisibleQuery) {
      _currentCatalogResultsById.clear();
    }
    if (requestedQuery != null) {
      _activeCatalogQuery = requestedQuery.copyWith(forceRefresh: false);
    }
    _catalogLoading = true;
    _catalogError = null;
    if (shouldForceRefresh) _lastCatalogRefreshAt = now;
    notifyListeners();
    try {
      final result = await _repository.listSportsCatalog(
        leagueId: leagueId,
        weekId: weekId,
        query: requestedQuery,
        timezone: requestedQuery?.timezone ?? _leagueTimezone,
        weekStartAt: requestedQuery?.weekStartAt ?? _weekStartAt,
        weekEndAt: requestedQuery?.weekEndAt ?? _weekEndAt,
        forceRefresh: shouldForceRefresh,
      );
      if (requestGeneration != _catalogRequestGeneration) return;
      _applyCatalogResult(result, requestedQuery);
    } on RepositoryException catch (error) {
      if (requestGeneration != _catalogRequestGeneration) return;
      _catalogError = error.safeMessage;
      _catalogAvailability = CatalogAvailability(
        state: switch (error.code) {
          'unauthenticated' ||
          'permission-denied' => CatalogAvailabilityState.unauthorized,
          'resource-exhausted' => CatalogAvailabilityState.quotaDelayed,
          'failed-precondition' =>
            CatalogAvailabilityState.providerNotConfigured,
          _ => CatalogAvailabilityState.providerUnavailable,
        },
        message: error.safeMessage,
      );
    } on Object {
      if (requestGeneration != _catalogRequestGeneration) return;
      _catalogError = 'The sports schedule could not be loaded. Try again.';
      _catalogAvailability = const CatalogAvailability(
        state: CatalogAvailabilityState.providerUnavailable,
        message: 'The sports schedule could not be loaded. Try again.',
      );
    } finally {
      if (requestGeneration == _catalogRequestGeneration) {
        _catalogLoading = false;
        notifyListeners();
      }
    }
  }

  void _applyCatalogResult(
    SportsCatalogResult result,
    CatalogQuery? requestedQuery,
  ) {
    if (_slatePublished) return;
    final current = <String, Game>{};
    var selectedSnapshotChanged = false;
    for (final game in result.games) {
      final canonical = _newerGame(_catalogGameCacheById[game.id], game);
      _catalogGameCacheById[game.id] = canonical;
      current[game.id] = canonical;
      if (_selectedDraftGamesById.containsKey(game.id)) {
        final previous = _selectedDraftGamesById[game.id]!;
        _selectedDraftGamesById[game.id] = canonical;
        selectedSnapshotChanged =
            selectedSnapshotChanged || !_sameDraftSnapshot(previous, canonical);
      }
    }
    if (selectedSnapshotChanged && !_slatePublished) _markDraftDirty();
    _currentCatalogResultsById
      ..clear()
      ..addAll(current);
    _catalogSports = List<CatalogSport>.unmodifiable(result.supportedSports);
    _catalogLeagues = List<CatalogLeague>.unmodifiable(result.supportedLeagues);
    _catalogPresentation = result.presentation;
    _catalogAvailability = result.availability;
    _catalogProvider = result.provider;
    _catalogCacheHit = result.cacheHit;
    _catalogStale = result.stale;
    _catalogDelayed = result.delayed;
    _catalogCachedAt = result.cachedAt;
    _catalogExpiresAt = result.expiresAt;
    _weekStartAt = result.weekStartAt ?? _weekStartAt;
    _weekEndAt = result.weekEndAt ?? _weekEndAt;
    final effectiveQuery = result.effectiveQuery ?? requestedQuery?.snapshot;
    if (effectiveQuery != null) {
      _activeCatalogQuery = effectiveQuery.toQuery(forceRefresh: false);
    }
    _offline = false;
  }

  Game _newerGame(Game? existing, Game candidate) {
    if (existing == null) return candidate;
    return candidate.providerLastUpdatedAt.isBefore(
          existing.providerLastUpdatedAt,
        )
        ? existing
        : candidate;
  }

  bool _sameIds(Set<String> left, Set<String> right) =>
      left.length == right.length && left.containsAll(right);

  bool _sameDraftSnapshot(Game left, Game right) =>
      left.id == right.id &&
      left.provider == right.provider &&
      left.providerGameId == right.providerGameId &&
      left.sportCode == right.sportCode &&
      left.leagueCode == right.leagueCode &&
      left.providerLeagueId == right.providerLeagueId &&
      left.season == right.season &&
      left.scheduledAtUtc.toUtc() == right.scheduledAtUtc.toUtc() &&
      left.effectiveLockAtUtc.toUtc() == right.effectiveLockAtUtc.toUtc() &&
      left.status == right.status &&
      left.homeScore == right.homeScore &&
      left.awayScore == right.awayScore &&
      left.winnerTeamId == right.winnerTeamId &&
      left.resultVersionToken == right.resultVersionToken &&
      left.sourcePayloadHash == right.sourcePayloadHash;

  bool _draftSnapshotNeedsSave(Game game) {
    final server = _serverDraftGamesById[game.id];
    return !_serverDraftGameIds.contains(game.id) ||
        server == null ||
        !_sameDraftSnapshot(game, server);
  }

  Future<bool> saveDraftSlate() async {
    if (_draftSaving) return false;
    if (_repository == null) {
      _serverDraftGameIds
        ..clear()
        ..addAll(_selectedDraftGamesById.keys);
      _serverDraftGamesById
        ..clear()
        ..addAll(_selectedDraftGamesById);
      _draftSyncState = DraftSyncState.saved;
      notifyListeners();
      return true;
    }
    final leagueId = _activeLeagueId;
    if (leagueId == null) return false;
    final weekId = _requireWeekId();
    final contextGeneration = _activeContextGeneration;
    final saveGeneration = ++_draftSaveGeneration;
    _draftSaving = true;
    _draftSyncState = DraftSyncState.saving;
    _errorMessage = null;
    _draftOperationId ??=
        'draft_${weekId}_${DateTime.now().microsecondsSinceEpoch}';
    final operationId = _draftOperationId!;
    notifyListeners();
    try {
      const chunkSize = 75;
      final desiredIds = _selectedDraftGamesById.keys.toSet();
      // Submit additions plus provider snapshots the picker explicitly saw
      // change during a catalog refresh. Unseen server-side changes must remain
      // publish blockers until the picker reviews the refreshed game. Manual
      // games use their own trusted creation action.
      final canonicalWrites = _selectedDraftGamesById.values
          .where(
            (game) =>
                game.provider != 'manual' && _draftSnapshotNeedsSave(game),
          )
          .toList(growable: false);
      final removals = _serverDraftGameIds
          .difference(desiredIds)
          .toList(growable: false);
      var chunk = 0;
      for (
        var offset = 0;
        offset < canonicalWrites.length;
        offset += chunkSize
      ) {
        final end = (offset + chunkSize).clamp(0, canonicalWrites.length);
        final values = canonicalWrites.sublist(offset, end);
        await _repository.saveDraftSlate(
          leagueId: leagueId,
          weekId: weekId,
          chunkKey: '${operationId}_add_$chunk',
          games: values,
          removeGameIds: const [],
          requestId: '${operationId}_add_$chunk',
        );
        if (!_isActiveWeekContext(
          leagueId: leagueId,
          weekId: weekId,
          generation: contextGeneration,
        )) {
          return false;
        }
        _serverDraftGameIds.addAll(values.map((game) => game.id));
        _serverDraftGamesById.addEntries(
          values.map((game) => MapEntry(game.id, game)),
        );
        chunk += 1;
      }
      chunk = 0;
      for (var offset = 0; offset < removals.length; offset += chunkSize) {
        final end = (offset + chunkSize).clamp(0, removals.length);
        final values = removals.sublist(offset, end);
        await _repository.saveDraftSlate(
          leagueId: leagueId,
          weekId: weekId,
          chunkKey: '${operationId}_remove_$chunk',
          games: const [],
          removeGameIds: values,
          requestId: '${operationId}_remove_$chunk',
        );
        if (!_isActiveWeekContext(
          leagueId: leagueId,
          weekId: weekId,
          generation: contextGeneration,
        )) {
          return false;
        }
        _serverDraftGameIds.removeAll(values);
        for (final id in values) {
          _serverDraftGamesById.remove(id);
        }
        chunk += 1;
      }
      assert(_sameIds(_serverDraftGameIds, desiredIds));
      _draftSyncState = DraftSyncState.saved;
      _draftOperationId = null;
      unawaited(_telemetry.log('slate_draft_saved'));
      return true;
    } on RepositoryException catch (error) {
      if (_isActiveWeekContext(
        leagueId: leagueId,
        weekId: weekId,
        generation: contextGeneration,
      )) {
        _draftSyncState = DraftSyncState.error;
        _errorMessage = error.safeMessage;
      }
      return false;
    } finally {
      if (_draftSaveGeneration == saveGeneration) {
        _draftSaving = false;
      }
      notifyListeners();
    }
  }

  Future<bool> publishSlate() async {
    if (_selectedDraftGamesById.isEmpty) return false;
    _errorMessage = null;
    final leagueId = _activeLeagueId;
    final weekId = _activeWeekId;
    final contextGeneration = _activeContextGeneration;
    try {
      if (_repository != null) {
        if (leagueId == null || weekId == null) {
          throw const RepositoryException(
            'no-league',
            'Open or create an arena before publishing.',
          );
        }
        if (!await saveDraftSlate()) return false;
        if (!_isActiveWeekContext(
          leagueId: leagueId,
          weekId: weekId,
          generation: contextGeneration,
        )) {
          return false;
        }
        _publishRequestId ??=
            'publish_${weekId}_'
            '${DateTime.now().microsecondsSinceEpoch}';
        final requestId = _publishRequestId;
        await _repository.publishWeeklySlate(
          leagueId: leagueId,
          weekId: weekId,
          requestId: requestId,
        );
        if (!_isActiveWeekContext(
          leagueId: leagueId,
          weekId: weekId,
          generation: contextGeneration,
        )) {
          return false;
        }
      }
      _catalogRequestGeneration += 1;
      _catalogLoading = false;
      if (!_slatePublished) {
        _catalogPresentation = const CatalogPresentation.disabled();
      }
      _slatePublished = true;
      _publishRequestId = null;
      unawaited(_telemetry.log('slate_published'));
      notifyListeners();
      return true;
    } on RepositoryException catch (error) {
      if (_repository == null ||
          (leagueId != null &&
              weekId != null &&
              _isActiveWeekContext(
                leagueId: leagueId,
                weekId: weekId,
                generation: contextGeneration,
              ))) {
        _errorMessage = error.safeMessage;
        notifyListeners();
      }
      return false;
    }
  }

  Future<bool> addManualGame({
    required String homeName,
    required String awayName,
    required String leagueName,
    required DateTime scheduledAt,
    String sportCode = 'custom',
    String? venueName,
  }) async {
    final trimmedHome = homeName.trim();
    final trimmedAway = awayName.trim();
    final trimmedLeague = leagueName.trim();
    if (trimmedHome.isEmpty ||
        trimmedAway.isEmpty ||
        trimmedLeague.isEmpty ||
        trimmedHome.toLowerCase() == trimmedAway.toLowerCase() ||
        !scheduledAt.isAfter(DateTime.now())) {
      _errorMessage =
          'Enter two different teams, a league name, and a future start time.';
      notifyListeners();
      return false;
    }
    final home = _manualTeam(trimmedHome);
    final away = _manualTeam(trimmedAway);
    try {
      if (_repository == null) {
        final now = DateTime.now().toUtc();
        final id =
            'manual:${_slug(sportCode)}:'
            '${now.microsecondsSinceEpoch}';
        final game = Game(
          id: id,
          provider: 'manual',
          providerGameId: id.split(':').last,
          sportCode: _slug(sportCode),
          leagueCode: _slug(trimmedLeague),
          leagueName: trimmedLeague,
          season: '${scheduledAt.year}',
          scheduledAtUtc: scheduledAt.toUtc(),
          publishedScheduledAtUtc: scheduledAt.toUtc(),
          effectiveLockAtUtc: scheduledAt.toUtc(),
          venueName: venueName?.trim().isEmpty == true
              ? null
              : venueName?.trim(),
          homeTeam: home,
          awayTeam: away,
          status: GameStatus.scheduled,
          providerLastUpdatedAt: now,
          lastSyncedAt: now,
          resultVersion: 1,
          sourcePayloadHash: 'manual-demo-$id',
        );
        _currentCatalogResultsById[game.id] = game;
        _catalogGameCacheById[game.id] = game;
        _selectedWeekGames.add(game);
        _selectedDraftGamesById[game.id] = game;
        _serverDraftGameIds.add(game.id);
        _serverDraftGamesById[game.id] = game;
        _draftSyncState = DraftSyncState.saved;
      } else {
        final leagueId = _activeLeagueId!;
        final weekId = _requireWeekId();
        final normalizedVenue = venueName?.trim();
        final operationKey = [
          leagueId,
          weekId,
          _slug(sportCode),
          _slug(trimmedLeague),
          trimmedLeague,
          scheduledAt.toUtc().toIso8601String(),
          home.id,
          away.id,
          normalizedVenue ?? '',
        ].join('\u001f');
        if (_manualGameOperationKey != operationKey) {
          _manualGameOperationKey = operationKey;
          _manualGameRequestId =
              'manual_${_requestIdSegment(weekId)}_'
              '${DateTime.now().microsecondsSinceEpoch}';
        }
        await _repository.createManualGame(
          leagueId: leagueId,
          weekId: weekId,
          sportCode: _slug(sportCode),
          leagueCode: _slug(trimmedLeague),
          leagueName: trimmedLeague,
          season: '${scheduledAt.year}',
          scheduledAt: scheduledAt,
          homeTeam: home,
          awayTeam: away,
          venueName: normalizedVenue,
          neutralSite: false,
          requestId: _manualGameRequestId,
        );
        _manualGameOperationKey = null;
        _manualGameRequestId = null;
        _draftSyncState = DraftSyncState.saved;
      }
      _errorMessage = null;
      unawaited(_telemetry.log('slate_draft_saved'));
      notifyListeners();
      return true;
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
      notifyListeners();
      return false;
    }
  }

  Future<void> chooseTeam(Game game, String teamId) async {
    if (_isLocked(game) ||
        !game.acceptsTeam(teamId) ||
        _pickRequestsInFlight.contains(game.id)) {
      return;
    }
    _pickTeamIds[game.id] = teamId;
    _pickErrors.remove(game.id);
    if (_offline) {
      _pickSyncStates[game.id] = PickSyncState.offline;
      notifyListeners();
      return;
    }
    _pickRequestsInFlight.add(game.id);
    _pickSyncStates[game.id] = PickSyncState.saving;
    notifyListeners();
    try {
      if (_repository == null) {
        await Future<void>.delayed(const Duration(milliseconds: 220));
      } else {
        final leagueId = _activeLeagueId;
        if (leagueId == null) {
          throw const RepositoryException(
            'no-league',
            'Open your arena before saving picks.',
          );
        }
        await _repository.submitOrConfirmEntry(
          leagueId: leagueId,
          weekId: _requireWeekId(),
          picks: {game.id: teamId},
          requestId:
              'pick_${_requestIdSegment(game.id)}_'
              '${DateTime.now().microsecondsSinceEpoch}',
        );
      }
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
      _pickErrors[game.id] = error.safeMessage;
      if (_isRetryableRepositoryError(error.code)) {
        _pickSyncStates[game.id] = PickSyncState.offline;
        _offline = true;
      } else {
        final confirmed = _confirmedPickTeamIds[game.id];
        if (confirmed == null) {
          _pickTeamIds.remove(game.id);
        } else {
          _pickTeamIds[game.id] = confirmed;
        }
        _pickSyncStates[game.id] = PickSyncState.rejected;
      }
      _pickRequestsInFlight.remove(game.id);
      notifyListeners();
      return;
    } on Object {
      _pickErrors[game.id] =
          'The pick is still a local draft. Retry while the game is open.';
      _pickSyncStates[game.id] = PickSyncState.offline;
      _offline = true;
      _pickRequestsInFlight.remove(game.id);
      notifyListeners();
      return;
    }
    _confirmedPickTeamIds[game.id] = teamId;
    _pickTeamIds[game.id] = teamId;
    _pickSyncStates[game.id] = PickSyncState.synced;
    _pickRequestsInFlight.remove(game.id);
    _offline = false;
    unawaited(_telemetry.log('pick_saved'));
    notifyListeners();
  }

  String _requestIdSegment(String value) {
    final safe = value.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    return safe.length <= 64 ? safe : safe.substring(0, 64);
  }

  bool _isRetryableRepositoryError(String code) => const {
    'aborted',
    'cancelled',
    'deadline-exceeded',
    'internal',
    'resource-exhausted',
    'unavailable',
    'unknown',
  }.contains(code);

  Future<void> retryPick(Game game) async {
    final teamId = _pickTeamIds[game.id];
    if (teamId == null || _isLocked(game)) {
      _pickErrors[game.id] =
          'This game is locked. The local draft was not accepted.';
      _pickSyncStates[game.id] = PickSyncState.rejected;
      notifyListeners();
      return;
    }
    _offline = false;
    await chooseTeam(game, teamId);
  }

  void setOffline(bool value) {
    _offline = value;
    notifyListeners();
  }

  void setThemeMode(ThemeMode value) {
    _themeMode = value;
    notifyListeners();
  }

  void updateNickname(String value) {
    final trimmed = value.trim();
    if (trimmed.isNotEmpty) _displayName = trimmed;
    notifyListeners();
  }

  void assumeDemoPersona(String uid) {
    if (!isDemo) return;
    final matches = _members.where((item) => item.uid == uid);
    if (matches.isEmpty || !matches.first.isActive) return;
    _currentUserId = uid;
    _displayName = matches.first.displayName;
    notifyListeners();
  }

  void moveMember(String uid, int direction) {
    final index = _members.indexWhere((member) => member.uid == uid);
    final target = index + direction;
    if (index < 0 || target < 0 || target >= _members.length) return;
    final item = _members.removeAt(index);
    _members.insert(target, item);
    notifyListeners();
    final leagueId = _activeLeagueId;
    if (_repository != null && leagueId != null) {
      unawaited(
        _guardRepositoryAction(
          _repository.reorderPickerRotation(
            leagueId: leagueId,
            orderedMemberUids: _members.map((member) => member.uid).toList(),
          ),
        ),
      );
    }
  }

  void toggleMemberStatus(String uid) {
    final index = _members.indexWhere((member) => member.uid == uid);
    if (index < 0 || uid == currentPickerId) return;
    final member = _members[index];
    _members[index] = member.copyWith(
      status: member.isActive ? MemberStatus.inactive : MemberStatus.active,
    );
    notifyListeners();
    final leagueId = _activeLeagueId;
    if (_repository != null && leagueId != null) {
      unawaited(
        _guardRepositoryAction(
          _repository.updateMember(
            leagueId: leagueId,
            memberUid: uid,
            status: _members[index].status,
          ),
        ),
      );
    }
  }

  Future<bool> rotateInviteCode() async {
    final leagueId = _activeLeagueId;
    if (_repository == null) {
      _inviteCode =
          'DEMO-${DateTime.now().second.toString().padLeft(2, '0')}XP';
      notifyListeners();
      return true;
    }
    if (leagueId == null) return false;
    try {
      _inviteCode = await _repository.rotateInviteCode(leagueId: leagueId);
      notifyListeners();
      return true;
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
      notifyListeners();
      return false;
    }
  }

  Future<bool> updateLeagueSettings(Map<String, Object?> settings) async {
    final leagueId = _activeLeagueId;
    if (_repository == null) return true;
    if (leagueId == null) return false;
    try {
      await _repository.updateLeagueSettings(
        leagueId: leagueId,
        settings: settings,
      );
      if (settings['pickerParticipatesInPicks'] case final bool value) {
        _pickerParticipatesInPicks = value;
      }
      if (settings['pickLockPolicy'] case final String value) {
        _pickLockPolicy = value == 'firstGame'
            ? PickLockPolicy.firstGame
            : PickLockPolicy.perGame;
      }
      notifyListeners();
      return true;
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
      notifyListeners();
      return false;
    }
  }

  Future<void> simulateFinalResults() async {
    if (!isDemo) {
      await refreshWeekResults();
      return;
    }
    _errorMessage = null;
    _demoReviewReady = true;
    notifyListeners();
  }

  Future<bool> refreshWeekResults() async {
    final leagueId = _activeLeagueId;
    if (_repository == null || leagueId == null) return false;
    _errorMessage = null;
    try {
      await _repository.refreshSelectedGames(
        leagueId: leagueId,
        weekId: _requireWeekId(),
        forceRefresh: true,
      );
      return true;
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
      return false;
    } finally {
      notifyListeners();
    }
  }

  Future<bool> processLockedPicks() async {
    final leagueId = _activeLeagueId;
    if (_repository == null || leagueId == null) return isDemo;
    _errorMessage = null;
    notifyListeners();
    try {
      final weekId = _requireWeekId();
      final result = await _repository.revealLockedGamePicks(
        leagueId: leagueId,
        weekId: weekId,
      );
      for (final entry in result.revealsByGame.entries) {
        _revealedPicks[entry.key] = entry.value;
      }
      _errorMessage = null;
      notifyListeners();
      return true;
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
      notifyListeners();
      return false;
    }
  }

  Future<bool> calculateProvisionalResults() async {
    final leagueId = _activeLeagueId;
    if (_repository == null || leagueId == null) {
      _demoReviewReady = true;
      notifyListeners();
      return true;
    }
    try {
      await _repository.calculateProvisionalWeekResults(
        leagueId: leagueId,
        weekId: _requireWeekId(),
      );
      return true;
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
      notifyListeners();
      return false;
    }
  }

  Future<bool> recordOverride(
    String gameId,
    String reason, {
    GameStatus status = GameStatus.voided,
    int? homeScore,
    int? awayScore,
    String? winnerTeamId,
  }) async {
    final trimmed = reason.trim();
    if (trimmed.length < 10) return false;
    final game = selectedGames.firstWhere((item) => item.id == gameId);
    try {
      if (_repository != null && _activeLeagueId != null) {
        await _repository.overrideGameResult(
          leagueId: _activeLeagueId!,
          weekId: _requireWeekId(),
          gameId: gameId,
          status: status,
          homeScore: homeScore ?? game.homeScore,
          awayScore: awayScore ?? game.awayScore,
          winnerTeamId: winnerTeamId,
          reason: trimmed,
        );
      }
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
      notifyListeners();
      return false;
    }
    _overrideReasons[gameId] = trimmed;
    notifyListeners();
    return true;
  }

  Future<bool> finalizeWeek() async {
    if (isDemo && !_demoReviewReady) return false;
    final repository = _repository;
    final leagueId = _activeLeagueId;
    final weekId = _activeWeekId;
    final contextGeneration = _activeContextGeneration;
    try {
      if (repository != null) {
        if (leagueId == null || weekId == null) return false;
        final result = await repository.finalizeWeek(
          leagueId: leagueId,
          weekId: weekId,
        );
        if (!_isActiveWeekContext(
          leagueId: leagueId,
          weekId: weekId,
          generation: contextGeneration,
        )) {
          return false;
        }
        _lastNextPickerUid = result.nextPickerUid;
      }
      _weekFinalized = true;
      unawaited(_telemetry.log('week_finalized'));
      notifyListeners();
      return true;
    } on RepositoryException catch (error) {
      if (repository == null ||
          (leagueId != null &&
              weekId != null &&
              _isActiveWeekContext(
                leagueId: leagueId,
                weekId: weekId,
                generation: contextGeneration,
              ))) {
        _errorMessage = error.safeMessage;
        notifyListeners();
      }
      return false;
    }
  }

  Future<bool> assignCurrentWeekPicker(String pickerUid) async {
    final leagueId = _activeLeagueId;
    if (_repository == null || leagueId == null) return false;
    try {
      await _repository.assignWeeklyPicker(
        leagueId: leagueId,
        weekId: _requireWeekId(),
        pickerUid: pickerUid,
      );
      return true;
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
      notifyListeners();
      return false;
    }
  }

  Future<bool> createNextWeek() async {
    final leagueId = _activeLeagueId;
    if (!_weekFinalized || _repository == null || leagueId == null) {
      return false;
    }
    final nextNumber = _weekSequentialNumber + 1;
    final start = DateTime.now().toUtc();
    try {
      final created = await _repository.createNextWeek(
        leagueId: leagueId,
        sequentialNumber: nextNumber,
        label: 'Week $nextNumber',
        startAt: start,
        endAt: start.add(const Duration(days: 7)),
        // The server owns rotation and reads the authoritative picker advanced
        // by finalization. A client cache must never override that value.
        pickerUid: null,
        requestId:
            'next_${leagueId}_$nextNumber'
            '_${DateTime.now().microsecondsSinceEpoch}',
      );
      _setActiveWeekId(created.weekId);
      _currentPickerId = created.pickerUid;
      _weekSequentialNumber = nextNumber;
      _weekLabel = 'Week $nextNumber';
      _weekStatus = 'draft';
      _weekFinalized = false;
      _lastNextPickerUid = null;
      _slatePublished = false;
      _clearCatalogState();
      _selectedWeekGames.clear();
      _selectedDraftGamesById.clear();
      _serverDraftGameIds.clear();
      _serverDraftGamesById.clear();
      _draftSyncState = DraftSyncState.pristine;
      await _startWeekSubscriptions(leagueId, created.weekId);
      await loadCatalog();
      return true;
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
      notifyListeners();
      return false;
    }
  }

  Future<bool> reopenWeek({String reason = 'Commissioner review'}) async {
    if (reason.trim().length < 10) return false;
    try {
      if (_repository != null && _activeLeagueId != null) {
        await _repository.reopenWeek(
          leagueId: _activeLeagueId!,
          weekId: _requireWeekId(),
          reason: reason.trim(),
        );
      }
      _weekFinalized = false;
      notifyListeners();
      return true;
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
      notifyListeners();
      return false;
    }
  }

  Future<bool> leaveArena() async {
    final leagueId = _activeLeagueId;
    try {
      if (_repository != null && leagueId != null) {
        await _repository.leaveLeague(leagueId);
      }
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
      notifyListeners();
      return false;
    }
    _hasLeague = false;
    _setActiveLeagueId(null);
    _setActiveWeekId(null);
    _inviteCode = null;
    await _cancelLeagueSubscriptions();
    notifyListeners();
    return true;
  }

  Future<bool> deleteAccount() async {
    try {
      await _repository?.deleteOrAnonymizeAccount();
      if (_repository != null) await _auth!.signOut();
      await _cancelLeagueSubscriptions();
      _signedIn = false;
      _hasLeague = false;
      notifyListeners();
      return true;
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
      notifyListeners();
      return false;
    }
  }

  Future<bool> rebuildStandingsFromSnapshots() async {
    final leagueId = _activeLeagueId;
    if (_repository == null) return true;
    if (leagueId == null) return false;
    try {
      await _repository.rebuildStandings(leagueId);
      return true;
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
      notifyListeners();
      return false;
    }
  }

  String _requireWeekId() {
    final weekId = _activeWeekId;
    if (weekId == null) {
      throw const RepositoryException(
        'no-week',
        'Create or open a draft week before continuing.',
      );
    }
    return weekId;
  }

  void _setActiveLeagueId(String? leagueId) {
    if (_activeLeagueId == leagueId) return;
    _activeLeagueId = leagueId;
    _activeContextGeneration += 1;
    _draftSaveGeneration += 1;
    _standingsContextGeneration += 1;
    _draftSaving = false;
    _resetStandingsState();
  }

  bool _isActiveStandingsContext(String leagueId, int generation) =>
      _activeLeagueId == leagueId && _standingsContextGeneration == generation;

  void _applyStandingsFence(LeagueSummary league) {
    _standingsEpoch = league.standingsEpoch;
    _standingsBuiltEpoch = league.standingsBuiltEpoch;
    _standingsBuiltMemberCount = league.standingsBuiltMemberCount;
    _refreshVisibleStandings();
  }

  void _retainStandingsSnapshot(List<Standing> standings) {
    _latestStandingsSnapshot
      ..clear()
      ..addAll(standings);
    _refreshVisibleStandings();
  }

  void _refreshVisibleStandings() {
    _standings.clear();
    final expectedCount = _standingsBuiltMemberCount;
    final snapshotIsComplete =
        _standingsBuiltEpoch == _standingsEpoch &&
        _latestStandingsSnapshot.every(
          (standing) => standing.standingsEpoch == _standingsEpoch,
        ) &&
        (expectedCount == null ||
            expectedCount == _latestStandingsSnapshot.length);
    if (snapshotIsComplete) {
      _standings.addAll(_latestStandingsSnapshot);
    }
  }

  void _resetStandingsState() {
    _standingsEpoch = 0;
    _standingsBuiltEpoch = 0;
    _standingsBuiltMemberCount = null;
    _latestStandingsSnapshot.clear();
    _standings.clear();
  }

  void _setActiveWeekId(String? weekId) {
    if (_activeWeekId == weekId) return;
    _activeWeekId = weekId;
    _activeContextGeneration += 1;
    _draftSaveGeneration += 1;
    _draftSaving = false;
  }

  bool _isActiveWeekContext({
    required String leagueId,
    required String weekId,
    required int generation,
  }) =>
      _activeLeagueId == leagueId &&
      _activeWeekId == weekId &&
      _activeContextGeneration == generation;

  void _handleAuthStateChange(User? user) {
    if (user == null) {
      _signedIn = false;
      _hasLeague = false;
      _setActiveLeagueId(null);
      _setActiveWeekId(null);
      _clearCatalogState();
      _selectedWeekGames.clear();
      _selectedDraftGamesById.clear();
      _serverDraftGameIds.clear();
      _serverDraftGamesById.clear();
      _pickTeamIds.clear();
      _confirmedPickTeamIds.clear();
      _pickSyncStates.clear();
      _members.clear();
      _resetStandingsState();
      _entries.clear();
      unawaited(_cancelLeagueSubscriptions());
      notifyListeners();
      return;
    }
    _signedIn = true;
    _currentUserId = user.uid;
    _displayName = user.displayName?.trim().isNotEmpty == true
        ? user.displayName!.trim()
        : _displayName;
    unawaited(_resumeExistingSession());
    notifyListeners();
  }

  Future<void> _resumeExistingSession() async {
    final repository = _repository;
    if (repository == null || _restoringSession) return;
    _restoringSession = true;
    try {
      final leagueIds = await repository.findActiveLeagueIds();
      if (leagueIds.isEmpty) {
        _hasLeague = false;
        _setActiveLeagueId(null);
        _setActiveWeekId(null);
        await _cancelLeagueSubscriptions();
        return;
      }
      final preferred = _activeLeagueId;
      final leagueId = preferred != null && leagueIds.contains(preferred)
          ? preferred
          : leagueIds.first;
      _setActiveLeagueId(leagueId);
      await _hydrateJoinedLeague(leagueId);
      await _startLeagueSubscriptions(leagueId);
      _hasLeague = true;
      _errorMessage = null;
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
    } on Object {
      _errorMessage =
          'Your arena could not be restored. You can still join with a '
          'current invite code.';
    } finally {
      _restoringSession = false;
      notifyListeners();
    }
  }

  Future<void> _startLeagueSubscriptions(String leagueId) async {
    final repository = _repository;
    if (repository == null) return;
    final standingsContextGeneration = _standingsContextGeneration;
    await _cancelLeagueSubscriptions();
    if (!_isActiveStandingsContext(leagueId, standingsContextGeneration)) {
      return;
    }
    _leagueSubscription = repository.watchLeague(leagueId).listen((league) {
      if (!_isActiveStandingsContext(leagueId, standingsContextGeneration)) {
        return;
      }
      if (league == null) return;
      _leagueName = league.name;
      _leagueTimezone = league.timezone;
      _pickerParticipatesInPicks = league.pickerParticipatesInPicks;
      _pickLockPolicy = league.pickLockPolicy;
      _applyStandingsFence(league);
      if (league.currentPickerUid != null) {
        _currentPickerId = league.currentPickerUid!;
      }
      final nextWeekId = league.currentWeekId;
      if (nextWeekId != null && nextWeekId != _activeWeekId) {
        _resetForExternalWeekChange();
        _setActiveWeekId(nextWeekId);
        unawaited(_startWeekSubscriptions(leagueId, nextWeekId));
      }
      if (canDraftSlate &&
          !_slatePublished &&
          _currentCatalogResultsById.isEmpty &&
          !_catalogLoading) {
        unawaited(loadCatalog());
      }
      notifyListeners();
    }, onError: _handleLiveStreamError);
    _membersSubscription = repository.watchMembers(leagueId).listen((members) {
      _members
        ..clear()
        ..addAll(members);
      final current = members.where((member) => member.uid == _currentUserId);
      if (current.isNotEmpty) {
        _displayName = current.first.displayName;
      }
      if (canDraftSlate &&
          !_slatePublished &&
          _currentCatalogResultsById.isEmpty &&
          !_catalogLoading) {
        unawaited(loadCatalog());
      }
      notifyListeners();
    }, onError: _handleLiveStreamError);
    _standingsSubscription = repository.watchStandings(leagueId).listen((
      standings,
    ) {
      if (!_isActiveStandingsContext(leagueId, standingsContextGeneration)) {
        return;
      }
      _retainStandingsSnapshot(standings);
      notifyListeners();
    }, onError: _handleLiveStreamError);
    _historySubscription = repository.watchFinalizedWeeks(leagueId).listen((
      weeks,
    ) {
      _historyWeeks
        ..clear()
        ..addAll(weeks);
      notifyListeners();
    }, onError: _handleLiveStreamError);
    final weekId = _activeWeekId;
    if (weekId != null) {
      await _startWeekSubscriptions(leagueId, weekId);
    }
  }

  Future<void> _startWeekSubscriptions(String leagueId, String weekId) async {
    final repository = _repository;
    if (repository == null) return;
    final subscriptionGeneration = ++_weekSubscriptionGeneration;
    await _cancelWeekSubscriptions();
    if (!_isActiveWeekSubscription(
      leagueId: leagueId,
      weekId: weekId,
      generation: subscriptionGeneration,
    )) {
      return;
    }
    _weekSubscription = repository
        .watchWeek(leagueId, weekId)
        .listen(
          (week) {
            if (week == null ||
                !_isActiveWeekSubscription(
                  leagueId: leagueId,
                  weekId: weekId,
                  generation: subscriptionGeneration,
                )) {
              return;
            }
            final published = week.status != 'draft';
            if (published) {
              _catalogRequestGeneration += 1;
              _catalogLoading = false;
            }
            _weekLabel = week.label;
            _weekStatus = week.status;
            _weekSequentialNumber = week.sequentialNumber;
            _eligibleMemberCount = week.eligibleMemberCount;
            _weekPickerParticipatesInPicks = week.pickerParticipatesInPicks;
            _weekLockPolicy = week.lockPolicy;
            _weekFinalized = week.isFinalized;
            _lastNextPickerUid = week.isFinalized ? week.nextPickerUid : null;
            _slatePublished = published;
            _weekStartAt = week.startAt;
            _weekEndAt = week.endAt;
            if (published) {
              _catalogPresentation = week.catalogPresentation;
            }
            if (week.pickerUid.isNotEmpty) _currentPickerId = week.pickerUid;
            if (!published &&
                canDraftSlate &&
                _activeCatalogQuery == null &&
                !_catalogLoading) {
              unawaited(loadCatalog());
            }
            notifyListeners();
          },
          onError: (Object error, StackTrace stackTrace) {
            if (_isActiveWeekSubscription(
              leagueId: leagueId,
              weekId: weekId,
              generation: subscriptionGeneration,
            )) {
              _handleLiveStreamError(error, stackTrace);
            }
          },
        );
    _gamesSubscription = repository
        .watchWeekGames(leagueId, weekId)
        .listen(
          (games) {
            if (!_isActiveWeekSubscription(
              leagueId: leagueId,
              weekId: weekId,
              generation: subscriptionGeneration,
            )) {
              return;
            }
            _selectedWeekGames
              ..clear()
              ..addAll(games);
            _serverDraftGameIds
              ..clear()
              ..addAll(games.map((game) => game.id));
            _serverDraftGamesById
              ..clear()
              ..addEntries(games.map((game) => MapEntry(game.id, game)));
            for (final game in games) {
              final canonical = _newerGame(
                _catalogGameCacheById[game.id],
                game,
              );
              _catalogGameCacheById[game.id] = canonical;
              if (_selectedDraftGamesById.containsKey(game.id)) {
                _selectedDraftGamesById[game.id] = canonical;
              }
            }
            if (_draftSyncState != DraftSyncState.dirty &&
                _draftSyncState != DraftSyncState.error &&
                !_draftSaving) {
              _selectedDraftGamesById
                ..clear()
                ..addEntries(
                  games.map(
                    (game) => MapEntry(
                      game.id,
                      _catalogGameCacheById[game.id] ?? game,
                    ),
                  ),
                );
              _draftSyncState = DraftSyncState.saved;
            }
            _syncRevealSubscriptions(
              leagueId,
              weekId,
              games,
              subscriptionGeneration,
            );
            notifyListeners();
          },
          onError: (Object error, StackTrace stackTrace) {
            if (_isActiveWeekSubscription(
              leagueId: leagueId,
              weekId: weekId,
              generation: subscriptionGeneration,
            )) {
              _handleLiveStreamError(error, stackTrace);
            }
          },
        );
    _entriesSubscription = repository
        .watchPublicEntries(leagueId, weekId)
        .listen(
          (entries) {
            if (!_isActiveWeekSubscription(
              leagueId: leagueId,
              weekId: weekId,
              generation: subscriptionGeneration,
            )) {
              return;
            }
            _entries
              ..clear()
              ..addAll(entries);
            notifyListeners();
          },
          onError: (Object error, StackTrace stackTrace) {
            if (_isActiveWeekSubscription(
              leagueId: leagueId,
              weekId: weekId,
              generation: subscriptionGeneration,
            )) {
              _handleLiveStreamError(error, stackTrace);
            }
          },
        );
    _ownPicksSubscription = repository
        .watchOwnPrivatePicks(leagueId, weekId)
        .listen(
          (picks) {
            if (!_isActiveWeekSubscription(
              leagueId: leagueId,
              weekId: weekId,
              generation: subscriptionGeneration,
            )) {
              return;
            }
            final serverIds = <String>{};
            for (final pick in picks) {
              serverIds.add(pick.gameId);
              _confirmedPickTeamIds[pick.gameId] = pick.selectedTeamId;
              if (!_pickRequestsInFlight.contains(pick.gameId) &&
                  _pickSyncStates[pick.gameId] != PickSyncState.offline) {
                _pickTeamIds[pick.gameId] = pick.selectedTeamId;
                _pickSyncStates[pick.gameId] = pick.serverConfirmedAt == null
                    ? PickSyncState.saving
                    : PickSyncState.synced;
              }
            }
            for (final gameId in _confirmedPickTeamIds.keys.toList()) {
              if (serverIds.contains(gameId)) continue;
              _confirmedPickTeamIds.remove(gameId);
              if (!_pickRequestsInFlight.contains(gameId) &&
                  _pickSyncStates[gameId] != PickSyncState.offline) {
                _pickTeamIds.remove(gameId);
                _pickSyncStates.remove(gameId);
              }
            }
            _offline = false;
            notifyListeners();
          },
          onError: (Object error, StackTrace stackTrace) {
            if (_isActiveWeekSubscription(
              leagueId: leagueId,
              weekId: weekId,
              generation: subscriptionGeneration,
            )) {
              _handleLiveStreamError(error, stackTrace);
            }
          },
        );
  }

  bool _isActiveWeekSubscription({
    required String leagueId,
    required String weekId,
    required int generation,
  }) =>
      _activeLeagueId == leagueId &&
      _activeWeekId == weekId &&
      _weekSubscriptionGeneration == generation;

  void _syncRevealSubscriptions(
    String leagueId,
    String weekId,
    List<Game> games,
    int subscriptionGeneration,
  ) {
    final repository = _repository;
    if (repository == null ||
        !_isActiveWeekSubscription(
          leagueId: leagueId,
          weekId: weekId,
          generation: subscriptionGeneration,
        )) {
      return;
    }
    final revealable = games
        .where((game) => game.pickRevealCompletedAt != null)
        .map((game) => game.id)
        .toSet();
    for (final gameId in _revealSubscriptions.keys.toList()) {
      if (revealable.contains(gameId)) continue;
      unawaited(_revealSubscriptions.remove(gameId)?.cancel());
      _revealedPicks.remove(gameId);
    }
    for (final gameId in revealable) {
      if (_revealSubscriptions.containsKey(gameId)) continue;
      _revealSubscriptions[gameId] = repository
          .watchRevealedPicks(leagueId, weekId, gameId)
          .listen(
            (picks) {
              if (!_isActiveWeekSubscription(
                leagueId: leagueId,
                weekId: weekId,
                generation: subscriptionGeneration,
              )) {
                return;
              }
              _revealedPicks[gameId] = picks;
              notifyListeners();
            },
            onError: (Object error, StackTrace stackTrace) {
              if (_isActiveWeekSubscription(
                leagueId: leagueId,
                weekId: weekId,
                generation: subscriptionGeneration,
              )) {
                _handleLiveStreamError(error, stackTrace);
              }
            },
          );
    }
  }

  void _handleLiveStreamError(Object error, StackTrace stackTrace) {
    debugPrint('Live Firestore stream paused: ${error.runtimeType}');
    if (kDebugMode) debugPrintStack(stackTrace: stackTrace);
    _offline = true;
    _errorMessage =
        'Live updates are temporarily unavailable. Cached content remains '
        'visible.';
    notifyListeners();
  }

  Future<void> _cancelLeagueSubscriptions() async {
    final leagueSubscription = _leagueSubscription;
    final membersSubscription = _membersSubscription;
    final standingsSubscription = _standingsSubscription;
    final historySubscription = _historySubscription;
    _leagueSubscription = null;
    _membersSubscription = null;
    _standingsSubscription = null;
    _historySubscription = null;
    _weekSubscriptionGeneration += 1;
    final cancelWeekSubscriptions = _cancelWeekSubscriptions();
    await Future.wait([
      if (leagueSubscription != null) leagueSubscription.cancel(),
      if (membersSubscription != null) membersSubscription.cancel(),
      if (standingsSubscription != null) standingsSubscription.cancel(),
      if (historySubscription != null) historySubscription.cancel(),
      cancelWeekSubscriptions,
    ]);
  }

  Future<void> _cancelWeekSubscriptions() async {
    final weekSubscription = _weekSubscription;
    final gamesSubscription = _gamesSubscription;
    final entriesSubscription = _entriesSubscription;
    final ownPicksSubscription = _ownPicksSubscription;
    final revealSubscriptions = _revealSubscriptions.values.toList();
    _weekSubscription = null;
    _gamesSubscription = null;
    _entriesSubscription = null;
    _ownPicksSubscription = null;
    _revealSubscriptions.clear();
    _revealedPicks.clear();
    await Future.wait([
      if (weekSubscription != null) weekSubscription.cancel(),
      if (gamesSubscription != null) gamesSubscription.cancel(),
      if (entriesSubscription != null) entriesSubscription.cancel(),
      if (ownPicksSubscription != null) ownPicksSubscription.cancel(),
      ...revealSubscriptions.map((subscription) => subscription.cancel()),
    ]);
  }

  Future<void> _hydrateJoinedLeague(String leagueId) async {
    final standingsContextGeneration = _standingsContextGeneration;
    final league = await _repository
        ?.watchLeague(leagueId)
        .first
        .timeout(const Duration(seconds: 6));
    if (!_isActiveStandingsContext(leagueId, standingsContextGeneration)) {
      return;
    }
    if (league != null) {
      _leagueName = league.name;
      _leagueTimezone = league.timezone;
      _pickerParticipatesInPicks = league.pickerParticipatesInPicks;
      _pickLockPolicy = league.pickLockPolicy;
      _applyStandingsFence(league);
    }
    _setActiveWeekId(league?.currentWeekId);
    if (league?.currentPickerUid != null) {
      _currentPickerId = league!.currentPickerUid!;
    }
    await _hydrateMembersAndStandings(
      leagueId,
      standingsContextGeneration: standingsContextGeneration,
    );
    if (!_isActiveStandingsContext(leagueId, standingsContextGeneration)) {
      return;
    }
    final weekId = _activeWeekId;
    if (weekId != null) {
      final liveWeek = await _repository
          ?.watchWeek(leagueId, weekId)
          .first
          .timeout(const Duration(seconds: 6));
      if (liveWeek != null) {
        _weekLabel = liveWeek.label;
        _weekStatus = liveWeek.status;
        _weekSequentialNumber = liveWeek.sequentialNumber;
        _eligibleMemberCount = liveWeek.eligibleMemberCount;
        _weekPickerParticipatesInPicks = liveWeek.pickerParticipatesInPicks;
        _weekLockPolicy = liveWeek.lockPolicy;
        _weekFinalized = liveWeek.isFinalized;
        _lastNextPickerUid = liveWeek.isFinalized
            ? liveWeek.nextPickerUid
            : null;
        _slatePublished = liveWeek.status != 'draft';
        _weekStartAt = liveWeek.startAt;
        _weekEndAt = liveWeek.endAt;
        if (liveWeek.status != 'draft') {
          _catalogPresentation = liveWeek.catalogPresentation;
        }
        if (liveWeek.pickerUid.isNotEmpty) {
          _currentPickerId = liveWeek.pickerUid;
        }
      }
      final liveGames = await _repository
          ?.watchWeekGames(leagueId, weekId)
          .first
          .timeout(const Duration(seconds: 6));
      if (liveGames != null) {
        _selectedWeekGames
          ..clear()
          ..addAll(liveGames);
        _serverDraftGameIds
          ..clear()
          ..addAll(liveGames.map((game) => game.id));
        _serverDraftGamesById
          ..clear()
          ..addEntries(liveGames.map((game) => MapEntry(game.id, game)));
        _catalogGameCacheById.addEntries(
          liveGames.map((game) => MapEntry(game.id, game)),
        );
        _selectedDraftGamesById
          ..clear()
          ..addEntries(liveGames.map((game) => MapEntry(game.id, game)));
        _draftSyncState = DraftSyncState.saved;
      }
    }
  }

  Future<void> _hydrateMembersAndStandings(
    String leagueId, {
    int? standingsContextGeneration,
  }) async {
    final contextGeneration =
        standingsContextGeneration ?? _standingsContextGeneration;
    final liveMembers = await _repository
        ?.watchMembers(leagueId)
        .first
        .timeout(const Duration(seconds: 6));
    if (!_isActiveStandingsContext(leagueId, contextGeneration)) return;
    if (liveMembers != null && liveMembers.isNotEmpty) {
      _members
        ..clear()
        ..addAll(liveMembers);
      final authUid = _auth?.currentUser?.uid;
      final current = liveMembers.where((member) => member.uid == authUid);
      if (current.isNotEmpty) {
        _currentUserId = current.first.uid;
        _displayName = current.first.displayName;
      }
    }
    final liveStandings = await _repository
        ?.watchStandings(leagueId)
        .first
        .timeout(const Duration(seconds: 6));
    if (!_isActiveStandingsContext(leagueId, contextGeneration)) return;
    if (liveStandings != null) {
      _retainStandingsSnapshot(liveStandings);
    }
  }

  Future<void> _guardRepositoryAction(Future<void> action) async {
    try {
      await action;
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
      notifyListeners();
    }
  }

  Team _manualTeam(String name) {
    final words = name.split(RegExp(r'\s+'));
    final abbreviation = words
        .take(3)
        .map((word) => word.substring(0, 1).toUpperCase())
        .join();
    return Team(
      id: _slug(name),
      name: name,
      shortName: words.last,
      abbreviation: abbreviation,
    );
  }

  String _slug(String value) {
    final normalized = value
        .trim()
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
        .replaceAll(RegExp(r'^-+|-+$'), '');
    return normalized.isEmpty ? 'custom' : normalized;
  }

  @override
  void dispose() {
    unawaited(_authSubscription?.cancel());
    unawaited(_cancelLeagueSubscriptions());
    super.dispose();
  }

  void _seed() {
    final now = DateTime.now().toUtc();
    _displayName = 'Alex Morgan';
    _currentUserId = 'alex';
    _currentPickerId = 'luke';
    _leagueName = 'Luke’s Picks Arena';
    _leagueTimezone = 'America/Chicago';
    _weekLabel = 'Week 9';
    _weekStatus = 'open';
    _weekSequentialNumber = 9;
    _eligibleMemberCount = 3;
    _weekPickerParticipatesInPicks = false;
    _catalogProvider = 'mock';
    Team team(String id, String name, String abbreviation) => Team(
      id: id,
      name: name,
      shortName: name.split(' ').last,
      abbreviation: abbreviation,
    );

    Game game({
      required String id,
      required String sport,
      required String league,
      required Team away,
      required Team home,
      required Duration startOffset,
      GameStatus status = GameStatus.scheduled,
      int? awayScore,
      int? homeScore,
      String? winner,
      String? venue,
    }) {
      final start = now.add(startOffset);
      return Game(
        id: id,
        provider: 'mock',
        providerGameId: id,
        sportCode: sport,
        leagueCode: league.toLowerCase().replaceAll(' ', '-'),
        leagueName: league,
        season: '${now.year}',
        weekOrRound: 'Demo round',
        scheduledAtUtc: start,
        publishedScheduledAtUtc: start,
        effectiveLockAtUtc: start,
        venueName: venue,
        homeTeam: home,
        awayTeam: away,
        status: status,
        homeScore: homeScore,
        awayScore: awayScore,
        winnerTeamId: winner,
        providerLastUpdatedAt: now.subtract(const Duration(minutes: 8)),
        lastSyncedAt: now.subtract(const Duration(minutes: 4)),
        resultVersion: 1,
        sourcePayloadHash: 'demo-$id-v1',
        pickRevealCompletedAt: startOffset.isNegative ? now : null,
      );
    }

    final seededGames = <Game>[
      game(
        id: 'football-1',
        sport: 'Football',
        league: 'Pro Football',
        away: team('comets', 'Cedar Comets', 'CC'),
        home: team('hawks', 'Harbor Hawks', 'HH'),
        startOffset: const Duration(hours: 5),
        venue: 'Harbor Field',
      ),
      game(
        id: 'football-2',
        sport: 'Football',
        league: 'College Football',
        away: team('foxes', 'Prairie Foxes', 'PF'),
        home: team('owls', 'Summit Owls', 'SO'),
        startOffset: const Duration(days: 1, hours: 2),
        venue: 'Summit Stadium',
      ),
      game(
        id: 'basketball-1',
        sport: 'Basketball',
        league: 'Women’s Basketball',
        away: team('waves', 'Coastal Waves', 'CW'),
        home: team('stars', 'Metro Stars', 'MS'),
        startOffset: const Duration(days: 2),
      ),
      game(
        id: 'baseball-1',
        sport: 'Baseball',
        league: 'Pro Baseball',
        away: team('pines', 'North Pines', 'NP'),
        home: team('caps', 'River Capitals', 'RC'),
        startOffset: const Duration(days: 3),
        venue: 'River Park',
      ),
      game(
        id: 'basketball-2',
        sport: 'Basketball',
        league: 'Pro Basketball',
        away: team('bolts', 'Lake Bolts', 'LB'),
        home: team('forge', 'City Forge', 'CF'),
        startOffset: const Duration(hours: -1),
        status: GameStatus.live,
        awayScore: 71,
        homeScore: 74,
      ),
      game(
        id: 'hockey-1',
        sport: 'Hockey',
        league: 'Pro Hockey',
        away: team('aurora', 'Aurora Blades', 'AB'),
        home: team('bears', 'Granite Bears', 'GB'),
        startOffset: const Duration(days: -1),
        status: GameStatus.finalStatus,
        awayScore: 2,
        homeScore: 4,
        winner: 'bears',
      ),
      game(
        id: 'baseball-2',
        sport: 'Baseball',
        league: 'Pro Baseball',
        away: team('gulls', 'Bay Gulls', 'BG'),
        home: team('rails', 'Union Rails', 'UR'),
        startOffset: const Duration(days: 4),
        status: GameStatus.postponed,
      ),
      game(
        id: 'basketball-3',
        sport: 'Basketball',
        league: 'College Basketball',
        away: team('oaks', 'Western Oaks', 'WO'),
        home: team('kings', 'Eastern Kings', 'EK'),
        startOffset: const Duration(days: -2),
        status: GameStatus.voided,
      ),
    ];
    final weekStartDate = DateTime.utc(
      now.year,
      now.month,
      now.day,
    ).subtract(const Duration(days: 2));
    final weekEndDate = weekStartDate.add(const Duration(days: 7));
    final queryFrom = DateTime.utc(now.year, now.month, now.day);
    _weekStartAt = weekStartDate;
    _weekEndAt = weekEndDate;
    _catalogSports = const <CatalogSport>[
      CatalogSport(code: 'Football', displayName: 'Football'),
      CatalogSport(code: 'Basketball', displayName: 'Basketball'),
      CatalogSport(code: 'Baseball', displayName: 'Baseball'),
      CatalogSport(code: 'Hockey', displayName: 'Hockey'),
    ];
    _catalogLeagues = <CatalogLeague>[
      CatalogLeague(
        code: 'pro-football',
        displayName: 'Pro Football',
        sportCode: 'Football',
        providerLeagueId: 'pro-football',
        season: '${now.year}',
      ),
      CatalogLeague(
        code: 'college-football',
        displayName: 'College Football',
        sportCode: 'Football',
        providerLeagueId: 'college-football',
        season: '${now.year}',
      ),
      CatalogLeague(
        code: 'women’s-basketball',
        displayName: 'Women’s Basketball',
        sportCode: 'Basketball',
        providerLeagueId: 'women’s-basketball',
        season: '${now.year}',
      ),
      CatalogLeague(
        code: 'pro-basketball',
        displayName: 'Pro Basketball',
        sportCode: 'Basketball',
        providerLeagueId: 'pro-basketball',
        season: '${now.year}',
      ),
      CatalogLeague(
        code: 'college-basketball',
        displayName: 'College Basketball',
        sportCode: 'Basketball',
        providerLeagueId: 'college-basketball',
        season: '${now.year}',
      ),
      CatalogLeague(
        code: 'pro-baseball',
        displayName: 'Pro Baseball',
        sportCode: 'Baseball',
        providerLeagueId: 'pro-baseball',
        season: '${now.year}',
      ),
      CatalogLeague(
        code: 'pro-hockey',
        displayName: 'Pro Hockey',
        sportCode: 'Hockey',
        providerLeagueId: 'pro-hockey',
        season: '${now.year}',
      ),
    ];
    _activeCatalogQuery = CatalogQuery(
      sportCode: 'Football',
      leagueCode: 'pro-football',
      providerLeagueId: 'pro-football',
      season: '${now.year}',
      from: queryFrom,
      to: weekEndDate,
      timezone: _leagueTimezone,
      dateMode: CatalogDateMode.allDates,
      weekStartAt: weekStartDate,
      weekEndAt: weekEndDate,
    );
    _catalogAvailability = const CatalogAvailability(
      state: CatalogAvailabilityState.available,
    );
    _catalogPresentation = const CatalogPresentation.disabled(
      provider: 'mock',
      attributionText: 'Synthetic demo schedule',
    );
    _currentCatalogResultsById.addEntries(
      seededGames.map((game) => MapEntry(game.id, game)),
    );
    _catalogGameCacheById.addAll(_currentCatalogResultsById);
    const selectedIds = <String>{
      'football-1',
      'football-2',
      'basketball-1',
      'basketball-2',
      'hockey-1',
      'baseball-2',
      'basketball-3',
    };
    _selectedDraftGamesById.addEntries(
      selectedIds.map((id) => MapEntry(id, _currentCatalogResultsById[id]!)),
    );
    _serverDraftGameIds.addAll(_selectedDraftGamesById.keys);
    _serverDraftGamesById.addAll(_selectedDraftGamesById);
    _draftSyncState = DraftSyncState.saved;
    _pickTeamIds
      ..['basketball-2'] = 'forge'
      ..['hockey-1'] = 'bears';
    _confirmedPickTeamIds.addAll(_pickTeamIds);
    _pickSyncStates
      ..['basketball-2'] = PickSyncState.synced
      ..['hockey-1'] = PickSyncState.synced;

    final joined = now.subtract(const Duration(days: 180));
    _members.addAll([
      LeagueMember(
        uid: 'luke',
        displayName: 'Luke Carter',
        role: LeagueRole.owner,
        status: MemberStatus.active,
        rotationOrder: 0,
        joinedAt: joined,
      ),
      LeagueMember(
        uid: 'mia',
        displayName: 'Mia Flores',
        role: LeagueRole.commissioner,
        status: MemberStatus.active,
        rotationOrder: 1,
        joinedAt: joined.add(const Duration(days: 2)),
      ),
      LeagueMember(
        uid: 'alex',
        displayName: 'Alex Morgan',
        role: LeagueRole.member,
        status: MemberStatus.active,
        rotationOrder: 2,
        joinedAt: joined.add(const Duration(days: 4)),
      ),
      LeagueMember(
        uid: 'jordan',
        displayName: 'Jordan Lee',
        role: LeagueRole.member,
        status: MemberStatus.active,
        rotationOrder: 3,
        joinedAt: joined.add(const Duration(days: 8)),
      ),
      LeagueMember(
        uid: 'sam',
        displayName: 'Sam Rivera',
        role: LeagueRole.member,
        status: MemberStatus.inactive,
        rotationOrder: 4,
        joinedAt: joined.add(const Duration(days: 10)),
      ),
    ]);
    _standings.addAll(const [
      Standing(
        uid: 'mia',
        displayName: 'Mia Flores',
        totalPoints: 41,
        totalCorrect: 41,
        totalIncorrect: 19,
        totalVoid: 2,
        totalGraded: 60,
        eligibleWeeks: 8,
        pickerWeeks: 2,
        weeklyTitles: 3,
        bestWeekPoints: 7,
        currentRank: 1,
      ),
      Standing(
        uid: 'alex',
        displayName: 'Alex Morgan',
        totalPoints: 38,
        totalCorrect: 38,
        totalIncorrect: 22,
        totalVoid: 2,
        totalGraded: 60,
        eligibleWeeks: 8,
        pickerWeeks: 1,
        weeklyTitles: 2,
        bestWeekPoints: 6,
        currentRank: 2,
      ),
      Standing(
        uid: 'luke',
        displayName: 'Luke Carter',
        totalPoints: 35,
        totalCorrect: 35,
        totalIncorrect: 17,
        totalVoid: 1,
        totalGraded: 52,
        eligibleWeeks: 7,
        pickerWeeks: 2,
        weeklyTitles: 2,
        bestWeekPoints: 7,
        currentRank: 3,
      ),
      Standing(
        uid: 'jordan',
        displayName: 'Jordan Lee',
        totalPoints: 31,
        totalCorrect: 31,
        totalIncorrect: 29,
        totalVoid: 2,
        totalGraded: 60,
        eligibleWeeks: 8,
        pickerWeeks: 1,
        weeklyTitles: 1,
        bestWeekPoints: 6,
        currentRank: 4,
      ),
    ]);
  }
}
