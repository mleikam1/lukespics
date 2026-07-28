// ignore_for_file: prefer_initializing_formals

import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/bootstrap.dart';
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

final class AppController extends ChangeNotifier {
  AppController.demo({
    this.runtimeMode = AppRuntimeMode.demo,
    this.bootstrapMessage,
    bool signedIn = false,
    bool hasLeague = false,
    bool offline = false,
  }) : _signedIn = signedIn,
       _hasLeague = hasLeague,
       _offline = offline,
       _repository = runtimeMode == AppRuntimeMode.demo
           ? null
           : FirebaseLeagueRepository(),
       _telemetry = AppTelemetry(
         enabled: runtimeMode == AppRuntimeMode.firebase,
       ) {
    _seed();
    if (_hasLeague && isDemo) _inviteCode = 'DEMO-7H3K';
    if (_repository != null) {
      final currentUser = FirebaseAuth.instance.currentUser;
      if (currentUser != null) {
        _signedIn = true;
        _currentUserId = currentUser.uid;
        _displayName = currentUser.displayName ?? _displayName;
        unawaited(_resumeExistingSession());
      }
      _authSubscription = FirebaseAuth.instance.authStateChanges().listen(
        _handleAuthStateChange,
      );
    }
  }

  final AppRuntimeMode runtimeMode;
  final String? bootstrapMessage;
  final LeagueRepository? _repository;
  final AppTelemetry _telemetry;

  bool _signedIn;
  bool _hasLeague;
  bool _authBusy = false;
  bool _offline;
  bool _slatePublished = false;
  bool _demoReviewReady = false;
  bool _weekFinalized = false;
  bool _restoringSession = false;
  bool _pickerParticipatesInPicks = false;
  ThemeMode _themeMode = ThemeMode.system;
  String _displayName = 'Alex Morgan';
  String _currentUserId = 'alex';
  String _currentPickerId = 'luke';
  String _leagueName = 'Luke’s Picks Arena';
  String _leagueTimezone = 'America/Chicago';
  String _weekLabel = 'Week 9';
  String _weekStatus = 'open';
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

  final Set<String> _selectedGameIds = {};
  final Map<String, String> _pickTeamIds = {};
  final Map<String, PickSyncState> _pickSyncStates = {};
  final Map<String, String> _overrideReasons = {};
  final Map<String, List<RevealedPick>> _revealedPicks = {};
  final List<EntrySummary> _entries = [];
  final List<WeekSummary> _historyWeeks = [];
  late final List<Game> _games;
  late final List<LeagueMember> _members;
  late final List<Standing> _standings;

  bool get signedIn => _signedIn;
  bool get hasLeague => _hasLeague;
  bool get authBusy => _authBusy;
  bool get offline => _offline;
  bool get slatePublished => _slatePublished;
  bool get demoReviewReady => _demoReviewReady;
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

  LeagueMember get currentMember => _members.firstWhere(
    (member) => member.uid == _currentUserId,
    orElse: () => _members.first,
  );
  LeagueRole get currentRole => currentMember.role;
  bool get canAdmin =>
      currentRole == LeagueRole.owner || currentRole == LeagueRole.commissioner;
  bool get isCurrentUserPicker => _currentUserId == currentPickerId;
  bool get canDraftSlate => isCurrentUserPicker;
  bool get canMakePicks => !isCurrentUserPicker || _pickerParticipatesInPicks;

  List<Game> get games => List.unmodifiable(_games);
  List<Game> get selectedGames =>
      _games.where((game) => _selectedGameIds.contains(game.id)).toList()
        ..sort((a, b) => a.scheduledAtUtc.compareTo(b.scheduledAtUtc));
  Set<String> get selectedGameIds => Set.unmodifiable(_selectedGameIds);
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

  bool isGameLocked(Game game) => _isLocked(game);

  bool _isLocked(Game game) => game.isLockedAt(DateTime.now().toUtc());

  Future<void> signIn() async {
    if (_authBusy) return;
    _authBusy = true;
    _errorMessage = null;
    notifyListeners();
    try {
      if (runtimeMode == AppRuntimeMode.firebase) {
        final provider = GoogleAuthProvider();
        final credential = kIsWeb
            ? await FirebaseAuth.instance.signInWithPopup(provider)
            : await FirebaseAuth.instance.signInWithProvider(provider);
        _displayName = credential.user?.displayName?.trim().isNotEmpty == true
            ? credential.user!.displayName!.trim()
            : _displayName;
        await _repository?.ensureUserProfile(displayName: _displayName);
      } else if (runtimeMode == AppRuntimeMode.firebaseEmulator) {
        final credential = await FirebaseAuth.instance.signInAnonymously();
        await credential.user?.updateDisplayName(_displayName);
        await _repository?.ensureUserProfile(displayName: _displayName);
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

  Future<void> signOut() async {
    if (_repository != null) {
      await FirebaseAuth.instance.signOut();
    }
    await _cancelLeagueSubscriptions();
    _signedIn = false;
    _hasLeague = false;
    _activeLeagueId = null;
    _activeWeekId = null;
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
            'providerName': 'mock',
          },
        );
        _activeLeagueId = created.leagueId;
        _inviteCode = created.inviteCode;
        final now = DateTime.now().toUtc();
        final week = await _repository.createDraftWeek(
          leagueId: created.leagueId,
          sequentialNumber: 1,
          label: 'Week 1',
          startAt: now,
          endAt: now.add(const Duration(days: 7)),
        );
        _activeWeekId = week.weekId;
        _currentPickerId = week.pickerUid;
        final currentIndex = _members.indexWhere(
          (member) => member.uid == _currentUserId,
        );
        if (currentIndex >= 0) {
          final member = _members[currentIndex];
          _members[currentIndex] = LeagueMember(
            uid: member.uid,
            displayName: member.displayName,
            role: LeagueRole.owner,
            status: member.status,
            rotationOrder: member.rotationOrder,
            joinedAt: member.joinedAt,
            photoUrl: member.photoUrl,
            eligibleFromWeekId: member.eligibleFromWeekId,
          );
        }
        final catalog = await _repository.listSportsCatalog(
          leagueId: created.leagueId,
          query: CatalogQuery(
            sportCode: 'football',
            leagueCode: 'demo-football',
            providerLeagueId: 'demo-football',
            season: 'demo',
            from: now,
            to: now.add(const Duration(days: 7)),
          ),
        );
        _games
          ..clear()
          ..addAll(catalog.games);
        _selectedGameIds.clear();
        _pickTeamIds.clear();
        _pickSyncStates.clear();
        await _hydrateMembersAndStandings(created.leagueId);
        await _startLeagueSubscriptions(created.leagueId);
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
        _activeLeagueId = await _repository.joinLeagueByCode(
          inviteCode: inviteCode.trim(),
          nickname: _displayName,
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
    if (_slatePublished) return;
    if (!_selectedGameIds.remove(gameId)) {
      _selectedGameIds.add(gameId);
    }
    notifyListeners();
  }

  void removeSlateGame(String gameId) {
    if (_slatePublished) return;
    _selectedGameIds.remove(gameId);
    notifyListeners();
  }

  Future<bool> publishSlate() async {
    if (_selectedGameIds.isEmpty) return false;
    _errorMessage = null;
    try {
      if (_repository != null) {
        final leagueId = _activeLeagueId;
        if (leagueId == null) {
          throw const RepositoryException(
            'no-league',
            'Open or create an arena before publishing.',
          );
        }
        const chunkSize = 100;
        final selected = selectedGames;
        for (var offset = 0; offset < selected.length; offset += chunkSize) {
          final end = offset + chunkSize < selected.length
              ? offset + chunkSize
              : selected.length;
          await _repository.saveDraftSlate(
            leagueId: leagueId,
            weekId: _requireWeekId(),
            chunkKey: 'games-${offset ~/ chunkSize}',
            games: selected.sublist(offset, end),
          );
        }
        await _repository.publishWeeklySlate(
          leagueId: leagueId,
          weekId: _requireWeekId(),
        );
      }
      _slatePublished = true;
      unawaited(_telemetry.log('slate_published'));
      notifyListeners();
      return true;
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
      notifyListeners();
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
        _games.add(game);
        _selectedGameIds.add(game.id);
      } else {
        await _repository.createManualGame(
          leagueId: _activeLeagueId!,
          weekId: _requireWeekId(),
          sportCode: _slug(sportCode),
          leagueCode: _slug(trimmedLeague),
          leagueName: trimmedLeague,
          season: '${scheduledAt.year}',
          scheduledAt: scheduledAt,
          homeTeam: home,
          awayTeam: away,
          venueName: venueName,
        );
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
    if (_isLocked(game) || !game.acceptsTeam(teamId)) return;
    _pickTeamIds[game.id] = teamId;
    if (_offline) {
      _pickSyncStates[game.id] = PickSyncState.offline;
      notifyListeners();
      return;
    }
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
          picks: _pickTeamIds,
        );
      }
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
      _pickSyncStates[game.id] = PickSyncState.rejected;
      notifyListeners();
      return;
    }
    if (_isLocked(game)) {
      _pickSyncStates[game.id] = PickSyncState.rejected;
    } else {
      _pickSyncStates[game.id] = PickSyncState.synced;
      unawaited(_telemetry.log('pick_saved'));
    }
    notifyListeners();
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
      return true;
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
      notifyListeners();
      return false;
    }
  }

  Future<void> simulateFinalResults() async {
    _errorMessage = null;
    try {
      if (_repository != null && _activeLeagueId != null) {
        await _repository.refreshSelectedGames(
          leagueId: _activeLeagueId!,
          weekId: _requireWeekId(),
          forceRefresh: true,
        );
      }
      _demoReviewReady = true;
    } on RepositoryException catch (error) {
      _errorMessage = error.safeMessage;
    } finally {
      notifyListeners();
    }
  }

  Future<bool> recordOverride(String gameId, String reason) async {
    final trimmed = reason.trim();
    if (trimmed.length < 10) return false;
    final game = _games.firstWhere((item) => item.id == gameId);
    try {
      if (_repository != null && _activeLeagueId != null) {
        await _repository.overrideGameResult(
          leagueId: _activeLeagueId!,
          weekId: _requireWeekId(),
          gameId: gameId,
          status: GameStatus.voided,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
          winnerTeamId: null,
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
    if (!_demoReviewReady) return false;
    try {
      if (_repository != null && _activeLeagueId != null) {
        await _repository.finalizeWeek(
          leagueId: _activeLeagueId!,
          weekId: _requireWeekId(),
        );
      }
      _weekFinalized = true;
      unawaited(_telemetry.log('week_finalized'));
      notifyListeners();
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
    _activeLeagueId = null;
    _activeWeekId = null;
    _inviteCode = null;
    await _cancelLeagueSubscriptions();
    notifyListeners();
    return true;
  }

  Future<bool> deleteAccount() async {
    try {
      await _repository?.deleteOrAnonymizeAccount();
      if (_repository != null) await FirebaseAuth.instance.signOut();
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

  void _handleAuthStateChange(User? user) {
    if (user == null) {
      _signedIn = false;
      _hasLeague = false;
      _activeLeagueId = null;
      _activeWeekId = null;
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
        _activeLeagueId = null;
        _activeWeekId = null;
        await _cancelLeagueSubscriptions();
        return;
      }
      final preferred = _activeLeagueId;
      final leagueId = preferred != null && leagueIds.contains(preferred)
          ? preferred
          : leagueIds.first;
      _activeLeagueId = leagueId;
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
    await _cancelLeagueSubscriptions();
    _leagueSubscription = repository.watchLeague(leagueId).listen((league) {
      if (league == null) return;
      _leagueName = league.name;
      _leagueTimezone = league.timezone;
      _pickerParticipatesInPicks = league.pickerParticipatesInPicks;
      if (league.currentPickerUid != null) {
        _currentPickerId = league.currentPickerUid!;
      }
      final nextWeekId = league.currentWeekId;
      if (nextWeekId != null && nextWeekId != _activeWeekId) {
        _activeWeekId = nextWeekId;
        unawaited(_startWeekSubscriptions(leagueId, nextWeekId));
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
      notifyListeners();
    }, onError: _handleLiveStreamError);
    _standingsSubscription = repository.watchStandings(leagueId).listen((
      standings,
    ) {
      _standings
        ..clear()
        ..addAll(standings);
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
    await _cancelWeekSubscriptions();
    _weekSubscription = repository.watchWeek(leagueId, weekId).listen((week) {
      if (week == null) return;
      _weekLabel = week.label;
      _weekStatus = week.status;
      _weekFinalized = week.isFinalized;
      _slatePublished = week.status != 'draft';
      if (week.pickerUid.isNotEmpty) _currentPickerId = week.pickerUid;
      notifyListeners();
    }, onError: _handleLiveStreamError);
    _gamesSubscription = repository.watchWeekGames(leagueId, weekId).listen((
      games,
    ) {
      _games
        ..clear()
        ..addAll(games);
      _selectedGameIds
        ..clear()
        ..addAll(games.map((game) => game.id));
      _syncRevealSubscriptions(leagueId, weekId, games);
      notifyListeners();
    }, onError: _handleLiveStreamError);
    _entriesSubscription = repository
        .watchPublicEntries(leagueId, weekId)
        .listen((entries) {
          _entries
            ..clear()
            ..addAll(entries);
          notifyListeners();
        }, onError: _handleLiveStreamError);
    _ownPicksSubscription = repository
        .watchOwnPrivatePicks(leagueId, weekId)
        .listen((picks) {
          _pickTeamIds
            ..clear()
            ..addEntries(
              picks.map((pick) => MapEntry(pick.gameId, pick.selectedTeamId)),
            );
          _pickSyncStates
            ..clear()
            ..addEntries(
              picks.map(
                (pick) => MapEntry(
                  pick.gameId,
                  pick.serverConfirmedAt == null
                      ? PickSyncState.saving
                      : PickSyncState.synced,
                ),
              ),
            );
          notifyListeners();
        }, onError: _handleLiveStreamError);
  }

  void _syncRevealSubscriptions(
    String leagueId,
    String weekId,
    List<Game> games,
  ) {
    final repository = _repository;
    if (repository == null) return;
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
          .listen((picks) {
            _revealedPicks[gameId] = picks;
            notifyListeners();
          }, onError: _handleLiveStreamError);
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
    await Future.wait([
      if (_leagueSubscription != null) _leagueSubscription!.cancel(),
      if (_membersSubscription != null) _membersSubscription!.cancel(),
      if (_standingsSubscription != null) _standingsSubscription!.cancel(),
      if (_historySubscription != null) _historySubscription!.cancel(),
    ]);
    _leagueSubscription = null;
    _membersSubscription = null;
    _standingsSubscription = null;
    _historySubscription = null;
    await _cancelWeekSubscriptions();
  }

  Future<void> _cancelWeekSubscriptions() async {
    await Future.wait([
      if (_weekSubscription != null) _weekSubscription!.cancel(),
      if (_gamesSubscription != null) _gamesSubscription!.cancel(),
      if (_entriesSubscription != null) _entriesSubscription!.cancel(),
      if (_ownPicksSubscription != null) _ownPicksSubscription!.cancel(),
      ..._revealSubscriptions.values.map(
        (subscription) => subscription.cancel(),
      ),
    ]);
    _weekSubscription = null;
    _gamesSubscription = null;
    _entriesSubscription = null;
    _ownPicksSubscription = null;
    _revealSubscriptions.clear();
    _revealedPicks.clear();
  }

  Future<void> _hydrateJoinedLeague(String leagueId) async {
    final league = await _repository
        ?.watchLeague(leagueId)
        .first
        .timeout(const Duration(seconds: 6));
    if (league != null) {
      _leagueName = league.name;
      _leagueTimezone = league.timezone;
      _pickerParticipatesInPicks = league.pickerParticipatesInPicks;
    }
    _activeWeekId = league?.currentWeekId;
    if (league?.currentPickerUid != null) {
      _currentPickerId = league!.currentPickerUid!;
    }
    await _hydrateMembersAndStandings(leagueId);
    final weekId = _activeWeekId;
    if (weekId != null) {
      final liveGames = await _repository
          ?.watchWeekGames(leagueId, weekId)
          .first
          .timeout(const Duration(seconds: 6));
      if (liveGames != null) {
        _games
          ..clear()
          ..addAll(liveGames);
        _selectedGameIds
          ..clear()
          ..addAll(liveGames.map((game) => game.id));
      }
    }
  }

  Future<void> _hydrateMembersAndStandings(String leagueId) async {
    final liveMembers = await _repository
        ?.watchMembers(leagueId)
        .first
        .timeout(const Duration(seconds: 6));
    if (liveMembers != null && liveMembers.isNotEmpty) {
      _members
        ..clear()
        ..addAll(liveMembers);
      final authUid = FirebaseAuth.instance.currentUser?.uid;
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
    if (liveStandings != null) {
      _standings
        ..clear()
        ..addAll(liveStandings);
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

    _games = [
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
    _selectedGameIds.addAll([
      'football-1',
      'football-2',
      'basketball-1',
      'basketball-2',
      'hockey-1',
      'baseball-2',
      'basketball-3',
    ]);
    _pickTeamIds
      ..['basketball-2'] = 'forge'
      ..['hockey-1'] = 'bears';
    _pickSyncStates
      ..['basketball-2'] = PickSyncState.synced
      ..['hockey-1'] = PickSyncState.synced;

    final joined = now.subtract(const Duration(days: 180));
    _members = [
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
    ];
    _standings = const [
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
    ];
  }
}
