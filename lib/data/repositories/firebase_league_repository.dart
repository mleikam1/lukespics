// ignore_for_file: prefer_function_declarations_over_variables, use_null_aware_elements

import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../models/game.dart';
import '../models/member.dart';
import '../models/pick.dart';
import '../models/standing.dart';
import 'league_repository.dart';

final class FirebaseLeagueRepository implements LeagueRepository {
  FirebaseLeagueRepository({
    FirebaseAuth? auth,
    FirebaseFirestore? firestore,
    FirebaseFunctions? functions,
  }) : _auth = auth ?? FirebaseAuth.instance,
       _firestore = firestore ?? FirebaseFirestore.instance,
       _functions = functions ?? FirebaseFunctions.instance;

  final FirebaseAuth _auth;
  final FirebaseFirestore _firestore;
  final FirebaseFunctions _functions;
  final Random _random = Random.secure();
  final Map<String, String> _wireResultVersions = {};

  @override
  Future<String> ensureUserProfile({String? displayName, Uri? photoUrl}) async {
    final result = await _call('ensureUserProfile', {
      if (displayName != null) 'displayName': displayName,
      if (photoUrl != null) 'photoUrl': photoUrl.toString(),
    });
    return _string(result, 'uid');
  }

  @override
  Future<List<String>> findActiveLeagueIds() async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) {
      throw const RepositoryException(
        'unauthenticated',
        'Please sign in again.',
      );
    }
    try {
      final memberships = await _firestore
          .collectionGroup('members')
          .where('uid', isEqualTo: uid)
          .where('status', isEqualTo: 'active')
          .get();
      final leagueIds =
          memberships.docs
              .map((document) => document.reference.parent.parent?.id)
              .whereType<String>()
              .toSet()
              .toList(growable: false)
            ..sort();
      return leagueIds;
    } on FirebaseException catch (error) {
      throw RepositoryException(
        error.code,
        'Your arena memberships could not be restored. You can still join '
        'with a current invite code.',
      );
    }
  }

  @override
  Future<CreatedLeague> createLeague({
    required String name,
    required String timezone,
    required Map<String, Object?> settings,
  }) async {
    final result = await _call('createLeague', {
      'name': name,
      'timezone': timezone,
      'settings': settings,
    });
    return CreatedLeague(
      leagueId: _string(result, 'leagueId'),
      inviteCode: _string(result, 'inviteCode'),
    );
  }

  @override
  Future<String> joinLeagueByCode({
    required String inviteCode,
    String? nickname,
  }) async {
    final result = await _call('joinLeagueByCode', {
      'inviteCode': inviteCode,
      if (nickname != null) 'nickname': nickname,
    });
    return _string(result, 'leagueId');
  }

  @override
  Future<String> rotateInviteCode({required String leagueId}) async {
    final result = await _call('rotateInviteCode', {
      'leagueId': leagueId,
      'expiresAt': null,
      'maxUses': null,
    });
    return _string(result, 'inviteCode');
  }

  @override
  Future<void> updateLeagueSettings({
    required String leagueId,
    required Map<String, Object?> settings,
  }) async {
    await _call('updateLeagueSettings', {
      'leagueId': leagueId,
      'settings': settings,
    });
  }

  @override
  Future<void> updateMember({
    required String leagueId,
    required String memberUid,
    LeagueRole? role,
    MemberStatus? status,
  }) async {
    await _call('updateMemberRoleOrStatus', {
      'leagueId': leagueId,
      'memberUid': memberUid,
      if (role != null) 'role': role.name,
      if (status != null)
        'status': status == MemberStatus.left ? 'removed' : status.name,
    });
  }

  @override
  Future<void> reorderPickerRotation({
    required String leagueId,
    required List<String> orderedMemberUids,
  }) async {
    await _call('reorderPickerRotation', {
      'leagueId': leagueId,
      'orderedMemberUids': orderedMemberUids,
    });
  }

  @override
  Future<void> leaveLeague(String leagueId) async {
    await _call('leaveLeague', {'leagueId': leagueId});
  }

  @override
  Future<int> rebuildStandings(String leagueId) async {
    final result = await _call('rebuildStandings', {'leagueId': leagueId});
    return _int(result, 'memberCount');
  }

  @override
  Future<void> deleteOrAnonymizeAccount() async {
    await _call('deleteOrAnonymizeAccount', const {'confirmation': 'DELETE'});
  }

  @override
  Future<CreatedWeek> createDraftWeek({
    required String leagueId,
    required int sequentialNumber,
    required String label,
    required DateTime startAt,
    required DateTime endAt,
    String? pickerUid,
  }) async {
    final result = await _call('createDraftWeek', {
      'leagueId': leagueId,
      'sequentialNumber': sequentialNumber,
      'label': label,
      'startAt': startAt.toUtc().toIso8601String(),
      'endAt': endAt.toUtc().toIso8601String(),
      if (pickerUid != null) 'pickerUid': pickerUid,
    });
    return CreatedWeek(
      weekId: _string(result, 'weekId'),
      pickerUid: _string(result, 'pickerUid'),
    );
  }

  @override
  Future<SportsCatalogResult> listSportsCatalog({
    required String leagueId,
    required CatalogQuery query,
  }) async {
    final date = (DateTime value) =>
        value.toUtc().toIso8601String().substring(0, 10);
    final result = await _call('listSportsCatalog', {
      'leagueId': leagueId,
      'sportCode': query.sportCode,
      'leagueCode': query.leagueCode,
      'leagueIdForProvider': query.providerLeagueId,
      'season': query.season,
      'from': date(query.from),
      'to': date(query.to),
      'forceRefresh': query.forceRefresh,
    });
    final rawGames = result['games'];
    final games = rawGames is List
        ? [
            for (final value in rawGames)
              if (value is Map)
                _gameFromJson(
                  '${value['id'] ?? ''}',
                  _map(value),
                  wireResultVersions: _wireResultVersions,
                ),
          ]
        : <Game>[];
    final cache = result['cache'] is Map
        ? _map(result['cache'])
        : const <String, Object?>{};
    return SportsCatalogResult(
      provider: result['provider'] as String? ?? 'unknown',
      games: games,
      cacheHit: cache['hit'] as bool? ?? false,
      stale: cache['stale'] as bool? ?? false,
      delayed: cache['delayed'] as bool? ?? false,
      cachedAt: _dateOrNull(cache['cachedAt']),
    );
  }

  @override
  Future<int> saveDraftSlate({
    required String leagueId,
    required String weekId,
    required String chunkKey,
    required List<Game> games,
    List<String> removeGameIds = const [],
  }) async {
    final result = await _call('saveDraftSlate', {
      'leagueId': leagueId,
      'weekId': weekId,
      'chunkKey': chunkKey,
      'games': games
          .map(
            (game) => _gameToJson(
              game,
              wireResultVersion:
                  _wireResultVersions[game.id] ?? game.sourcePayloadHash,
            ),
          )
          .toList(growable: false),
      'removeGameIds': removeGameIds,
    });
    return _int(result, 'selectedGameCount');
  }

  @override
  Future<PublishSlateResult> publishWeeklySlate({
    required String leagueId,
    required String weekId,
  }) async {
    final result = await _call('publishWeeklySlate', {
      'leagueId': leagueId,
      'weekId': weekId,
    });
    return PublishSlateResult(
      eligibleMemberCount: _int(result, 'eligibleMemberCount'),
      selectedGameCount: _int(result, 'selectedGameCount'),
    );
  }

  @override
  Future<String> createManualGame({
    required String leagueId,
    required String weekId,
    required String sportCode,
    required String leagueCode,
    required String leagueName,
    required String season,
    required DateTime scheduledAt,
    required Team homeTeam,
    required Team awayTeam,
    String? venueName,
    bool neutralSite = false,
  }) async {
    final result = await _call('createManualGame', {
      'leagueId': leagueId,
      'weekId': weekId,
      'sportCode': sportCode,
      'leagueCode': leagueCode,
      'leagueName': leagueName,
      'season': season,
      'scheduledAtUtc': scheduledAt.toUtc().toIso8601String(),
      'venueName': venueName,
      'neutralSite': neutralSite,
      'homeTeam': {
        'id': homeTeam.id,
        'name': homeTeam.name,
        'shortName': homeTeam.shortName,
        'abbreviation': homeTeam.abbreviation,
      },
      'awayTeam': {
        'id': awayTeam.id,
        'name': awayTeam.name,
        'shortName': awayTeam.shortName,
        'abbreviation': awayTeam.abbreviation,
      },
    });
    return _string(result, 'gameId');
  }

  @override
  Future<EntrySaveResult> submitOrConfirmEntry({
    required String leagueId,
    required String weekId,
    required Map<String, String> picks,
  }) async {
    final result = await _call('submitOrConfirmEntry', {
      'leagueId': leagueId,
      'weekId': weekId,
      'picks': [
        for (final pick in picks.entries)
          {'gameId': pick.key, 'selectedTeamId': pick.value},
      ],
    });
    return EntrySaveResult(
      savedPickCount: _int(result, 'savedPickCount'),
      totalRequiredPickCount: _int(result, 'totalRequiredPickCount'),
      completionState: _string(result, 'completionState'),
    );
  }

  @override
  Future<RefreshResult> refreshSelectedGames({
    required String leagueId,
    required String weekId,
    bool forceRefresh = false,
  }) async {
    final result = await _call('refreshSelectedGames', {
      'leagueId': leagueId,
      'weekId': weekId,
      'forceRefresh': forceRefresh,
    });
    return RefreshResult(
      updatedGameCount: _int(result, 'updatedGameCount'),
      delayed: result['delayed'] == true,
    );
  }

  @override
  Future<FinalizeResult> finalizeWeek({
    required String leagueId,
    required String weekId,
  }) async {
    final result = await _call('finalizeWeek', {
      'leagueId': leagueId,
      'weekId': weekId,
    });
    return FinalizeResult(
      winnerUids: _stringList(result, 'winnerUids'),
      highScore: result['highScore'] is num
          ? (result['highScore'] as num).toInt()
          : null,
      nextPickerUid: result['nextPickerUid'] as String?,
    );
  }

  @override
  Future<String> overrideGameResult({
    required String leagueId,
    required String weekId,
    required String gameId,
    required GameStatus status,
    required int? homeScore,
    required int? awayScore,
    required String? winnerTeamId,
    required String reason,
  }) async {
    final result = await _call('overrideGameResult', {
      'leagueId': leagueId,
      'weekId': weekId,
      'gameId': gameId,
      'status': _overrideStatus(status),
      'homeScore': homeScore,
      'awayScore': awayScore,
      'winnerTeamId': winnerTeamId,
      'reason': reason,
    });
    return _string(result, 'resultVersion');
  }

  @override
  Future<void> reopenWeek({
    required String leagueId,
    required String weekId,
    required String reason,
  }) async {
    await _call('reopenWeek', {
      'leagueId': leagueId,
      'weekId': weekId,
      'reason': reason,
    });
  }

  @override
  Stream<LeagueSummary?> watchLeague(String leagueId) {
    return _firestore.collection('leagues').doc(leagueId).snapshots().map((
      snapshot,
    ) {
      final data = snapshot.data();
      if (data == null) return null;
      final settings = data['settings'] is Map
          ? _map(data['settings'])
          : const <String, Object?>{};
      return LeagueSummary(
        id: snapshot.id,
        name: data['name'] as String? ?? 'Luke’s Picks Arena',
        timezone: data['timezone'] as String? ?? 'America/Chicago',
        currentWeekId: data['currentWeekId'] as String?,
        currentPickerUid: data['currentPickerUid'] as String?,
        pickerParticipatesInPicks:
            settings['pickerParticipatesInPicks'] as bool? ?? false,
      );
    });
  }

  @override
  Stream<WeekSummary?> watchWeek(String leagueId, String weekId) {
    return _firestore
        .collection('leagues')
        .doc(leagueId)
        .collection('weeks')
        .doc(weekId)
        .snapshots()
        .map((snapshot) {
          final data = snapshot.data();
          return data == null ? null : _weekFromJson(snapshot.id, data);
        });
  }

  @override
  Stream<List<WeekSummary>> watchFinalizedWeeks(String leagueId) {
    return _firestore
        .collection('leagues')
        .doc(leagueId)
        .collection('weeks')
        .where('status', isEqualTo: 'finalized')
        .orderBy('sequentialNumber', descending: true)
        .limit(25)
        .snapshots()
        .map(
          (snapshot) => snapshot.docs
              .map((document) => _weekFromJson(document.id, document.data()))
              .toList(growable: false),
        );
  }

  @override
  Stream<List<LeagueMember>> watchMembers(String leagueId) {
    return _firestore
        .collection('leagues')
        .doc(leagueId)
        .collection('members')
        .orderBy('rotationOrder')
        .snapshots()
        .map(
          (snapshot) => snapshot.docs
              .map((document) => _memberFromJson(document.id, document.data()))
              .toList(growable: false),
        );
  }

  @override
  Stream<List<Standing>> watchStandings(String leagueId) {
    return _firestore
        .collection('leagues')
        .doc(leagueId)
        .collection('standings')
        .orderBy('currentRank')
        .snapshots()
        .map(
          (snapshot) => snapshot.docs
              .map(
                (document) => _standingFromJson(document.id, document.data()),
              )
              .toList(growable: false),
        );
  }

  @override
  Stream<List<Game>> watchWeekGames(String leagueId, String weekId) {
    return _firestore
        .collection('leagues')
        .doc(leagueId)
        .collection('weeks')
        .doc(weekId)
        .collection('games')
        .orderBy('effectiveLockAtUtc')
        .snapshots()
        .map(
          (snapshot) => snapshot.docs
              .map(
                (document) => _gameFromJson(
                  document.id,
                  document.data(),
                  wireResultVersions: _wireResultVersions,
                ),
              )
              .toList(growable: false),
        );
  }

  @override
  Stream<List<EntrySummary>> watchPublicEntries(
    String leagueId,
    String weekId,
  ) {
    return _firestore
        .collection('leagues')
        .doc(leagueId)
        .collection('weeks')
        .doc(weekId)
        .collection('entries')
        .snapshots()
        .map(
          (snapshot) => snapshot.docs
              .map((document) {
                final data = document.data();
                return EntrySummary(
                  uid: document.id,
                  eligible: data['eligible'] as bool? ?? false,
                  savedPickCount: _number(data['savedPickCount']),
                  totalRequiredPickCount: _number(
                    data['totalRequiredPickCount'],
                  ),
                  completionState:
                      data['completionState'] as String? ?? 'notStarted',
                  points: _number(data['points']),
                  correctCount: _number(data['correctCount']),
                  incorrectCount: _number(data['incorrectCount']),
                  voidCount: _number(data['voidCount']),
                  weeklyRank: data['weeklyRank'] is num
                      ? (data['weeklyRank'] as num).toInt()
                      : null,
                  isWeeklyWinner: data['isWeeklyWinner'] as bool? ?? false,
                );
              })
              .toList(growable: false),
        );
  }

  @override
  Stream<List<Pick>> watchOwnPrivatePicks(String leagueId, String weekId) {
    final uid = _auth.currentUser?.uid;
    if (uid == null) {
      return Stream<List<Pick>>.error(
        const RepositoryException('unauthenticated', 'Please sign in again.'),
      );
    }
    return _firestore
        .collection('leagues')
        .doc(leagueId)
        .collection('weeks')
        .doc(weekId)
        .collection('entries')
        .doc(uid)
        .collection('picks')
        .snapshots()
        .map(
          (snapshot) => snapshot.docs
              .map((document) => _pickFromJson(document.id, document.data()))
              .toList(growable: false),
        );
  }

  @override
  Stream<List<RevealedPick>> watchRevealedPicks(
    String leagueId,
    String weekId,
    String gameId,
  ) {
    return _firestore
        .collection('leagues')
        .doc(leagueId)
        .collection('weeks')
        .doc(weekId)
        .collection('reveals')
        .doc(gameId)
        .collection('picks')
        .snapshots()
        .map(
          (snapshot) => snapshot.docs
              .map((document) {
                final data = document.data();
                return RevealedPick(
                  uid: document.id,
                  displayName: data['displayName'] as String? ?? 'Member',
                  selectedTeamId: data['selectedTeamId'] as String? ?? '',
                  outcome: _pickOutcome(data['outcome'] as String?),
                  points: _number(data['points']),
                );
              })
              .toList(growable: false),
        );
  }

  Future<Map<String, Object?>> _call(
    String name,
    Map<String, Object?> payload,
  ) async {
    try {
      final response = await _functions.httpsCallable(name).call<Object?>({
        'requestId': _requestId(),
        ...payload,
      });
      final envelope = _map(response.data);
      if (envelope['ok'] != true) {
        throw const RepositoryException(
          'invalid-response',
          'The server returned an unexpected response.',
        );
      }
      return _map(envelope['result']);
    } on FirebaseFunctionsException catch (error) {
      throw RepositoryException(error.code, _safeFunctionsMessage(error.code));
    }
  }

  String _requestId() =>
      '${DateTime.now().microsecondsSinceEpoch}_${_random.nextInt(1 << 32)}';
}

Map<String, Object?> _map(Object? value) {
  if (value is Map<String, Object?>) return value;
  if (value is Map) {
    return value.map((key, item) => MapEntry('$key', item));
  }
  throw const RepositoryException(
    'invalid-response',
    'The server returned an unexpected response.',
  );
}

String _string(Map<String, Object?> data, String key) {
  final value = data[key];
  if (value is String && value.isNotEmpty) return value;
  throw const RepositoryException(
    'invalid-response',
    'The server returned incomplete data.',
  );
}

int _int(Map<String, Object?> data, String key) {
  final value = data[key];
  if (value is num) return value.toInt();
  throw const RepositoryException(
    'invalid-response',
    'The server returned incomplete data.',
  );
}

List<String> _stringList(Map<String, Object?> data, String key) {
  final value = data[key];
  if (value is List) return value.whereType<String>().toList(growable: false);
  return const [];
}

int _number(Object? value) => value is num ? value.toInt() : 0;

String _safeFunctionsMessage(String code) => switch (code) {
  'unauthenticated' => 'Please sign in again.',
  'permission-denied' => 'You do not have permission to do that.',
  'resource-exhausted' =>
    'Sports data refresh is temporarily delayed. Cached data is still available.',
  'deadline-exceeded' ||
  'unavailable' => 'The service is temporarily unavailable. Try again shortly.',
  'failed-precondition' => 'This action is not available in the current state.',
  _ => 'The action could not be completed. Try again.',
};

Map<String, Object?> _gameToJson(
  Game game, {
  required String wireResultVersion,
}) => {
  'id': game.id,
  'provider': game.provider,
  'providerGameId': game.providerGameId,
  'sportCode': game.sportCode,
  'leagueCode': game.leagueCode,
  'leagueName': game.leagueName,
  'season': game.season,
  'weekOrRound': game.weekOrRound,
  'scheduledAtUtc': game.scheduledAtUtc.toIso8601String(),
  'publishedScheduledAtUtc': game.publishedScheduledAtUtc.toIso8601String(),
  'effectiveLockAtUtc': game.effectiveLockAtUtc.toIso8601String(),
  'venueName': game.venueName,
  'neutralSite': game.neutralSite,
  'homeTeam': game.homeTeam.toJson(),
  'awayTeam': game.awayTeam.toJson(),
  'status': _gameStatus(game.status),
  'homeScore': game.homeScore,
  'awayScore': game.awayScore,
  'winnerTeamId': game.winnerTeamId,
  'providerLastUpdatedAt': game.providerLastUpdatedAt.toIso8601String(),
  'lastSyncedAt': game.lastSyncedAt.toIso8601String(),
  'resultVersion': wireResultVersion,
  'sourcePayloadHash': game.sourcePayloadHash,
};

Game _gameFromJson(
  String id,
  Map<String, Object?> data, {
  required Map<String, String> wireResultVersions,
}) {
  final scheduled = _date(data['scheduledAtUtc']);
  final wireVersion = data['resultVersion'] as String? ?? '';
  if (wireVersion.isNotEmpty) {
    wireResultVersions[data['id'] as String? ?? id] = wireVersion;
  }
  return Game(
    id: data['id'] as String? ?? id,
    provider: data['provider'] as String? ?? 'unknown',
    providerGameId: data['providerGameId'] as String? ?? id,
    sportCode: data['sportCode'] as String? ?? 'unknown',
    leagueCode: data['leagueCode'] as String? ?? 'unknown',
    leagueName: data['leagueName'] as String? ?? 'Sports',
    season: '${data['season'] ?? ''}',
    weekOrRound: data['weekOrRound'] as String?,
    scheduledAtUtc: scheduled,
    publishedScheduledAtUtc:
        _dateOrNull(data['publishedScheduledAtUtc']) ?? scheduled,
    effectiveLockAtUtc: _dateOrNull(data['effectiveLockAtUtc']) ?? scheduled,
    venueName: data['venueName'] as String?,
    neutralSite: data['neutralSite'] as bool? ?? false,
    homeTeam: _team(_map(data['homeTeam'])),
    awayTeam: _team(_map(data['awayTeam'])),
    status: _parseGameStatus(data['status'] as String?),
    homeScore: data['homeScore'] is num
        ? (data['homeScore'] as num).toInt()
        : null,
    awayScore: data['awayScore'] is num
        ? (data['awayScore'] as num).toInt()
        : null,
    winnerTeamId: data['winnerTeamId'] as String?,
    providerLastUpdatedAt:
        _dateOrNull(data['providerLastUpdatedAt']) ?? scheduled,
    lastSyncedAt: _dateOrNull(data['lastSyncedAt']) ?? scheduled,
    manualOverride: data['manualOverride'] as bool? ?? false,
    manualOverrideReason: data['manualOverrideReason'] as String?,
    manualOverrideBy: data['manualOverrideBy'] as String?,
    resultVersion: _versionNumber(wireVersion),
    sourcePayloadHash: data['sourcePayloadHash'] as String? ?? '',
    pickRevealCompletedAt: _dateOrNull(data['pickRevealCompletedAt']),
  );
}

Team _team(Map<String, Object?> data) => Team(
  id: data['id'] as String? ?? '',
  name: data['name'] as String? ?? 'Unknown team',
  shortName: data['shortName'] as String? ?? data['name'] as String? ?? 'Team',
  abbreviation: data['abbreviation'] as String? ?? '—',
  logoUrl: Uri.tryParse(data['logoUrl'] as String? ?? ''),
);

LeagueMember _memberFromJson(String uid, Map<String, Object?> data) =>
    LeagueMember(
      uid: uid,
      displayName:
          data['displayName'] as String? ??
          data['nickname'] as String? ??
          'Member',
      photoUrl: Uri.tryParse(data['photoUrl'] as String? ?? ''),
      role: LeagueRole.values.firstWhere(
        (value) => value.name == data['role'],
        orElse: () => LeagueRole.member,
      ),
      status: MemberStatus.values.firstWhere(
        (value) => value.name == data['status'],
        orElse: () => MemberStatus.active,
      ),
      rotationOrder: _number(data['rotationOrder']),
      joinedAt:
          _dateOrNull(data['joinedAt']) ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      eligibleFromWeekId: data['eligibleFromWeekId'] as String?,
    );

Standing _standingFromJson(String uid, Map<String, Object?> data) => Standing(
  uid: uid,
  displayName: data['displayName'] as String? ?? 'Member',
  totalPoints: _number(data['totalPoints']),
  totalCorrect: _number(data['totalCorrect']),
  totalIncorrect: _number(data['totalIncorrect']),
  totalVoid: _number(data['totalVoid']),
  totalGraded: _number(data['totalGraded']),
  eligibleWeeks: _number(data['eligibleWeeks']),
  pickerWeeks: _number(data['pickerWeeks']),
  weeklyTitles: _number(data['weeklyTitles']),
  bestWeekPoints: _number(data['bestWeekPoints']),
  currentRank: _number(data['currentRank']),
);

WeekSummary _weekFromJson(String id, Map<String, Object?> data) => WeekSummary(
  id: id,
  sequentialNumber: _number(data['sequentialNumber']),
  label: data['label'] as String? ?? 'Week',
  pickerUid: data['pickerUid'] as String? ?? '',
  status: data['status'] as String? ?? 'draft',
  startAt: _dateOrNull(data['startAt']),
  endAt: _dateOrNull(data['endAt']),
  finalizedAt: _dateOrNull(data['finalizedAt']),
  winnerUids: data['winnerUids'] is List
      ? (data['winnerUids'] as List).whereType<String>().toList(growable: false)
      : const [],
  highScore: data['highScore'] is num
      ? (data['highScore'] as num).toInt()
      : null,
);

Pick _pickFromJson(String gameId, Map<String, Object?> data) {
  final selectedAt = _dateOrNull(data['selectedAt']) ?? DateTime.now().toUtc();
  return Pick(
    gameId: data['gameId'] as String? ?? gameId,
    selectedTeamId: data['selectedTeamId'] as String? ?? '',
    selectedAt: selectedAt,
    updatedAt: _dateOrNull(data['updatedAt']) ?? selectedAt,
    serverConfirmedAt: _dateOrNull(data['serverConfirmedAt']),
    lockAtSnapshot: _dateOrNull(data['lockAtSnapshot']) ?? selectedAt,
    lockedAt: _dateOrNull(data['lockedAt']),
    outcome: _pickOutcome(data['outcome'] as String?),
    points: _number(data['points']),
    outcomeVersion: _number(data['outcomeVersion']),
  );
}

DateTime _date(Object? value) =>
    _dateOrNull(value) ?? DateTime.fromMillisecondsSinceEpoch(0, isUtc: true);

DateTime? _dateOrNull(Object? value) {
  if (value is Timestamp) return value.toDate().toUtc();
  if (value is DateTime) return value.toUtc();
  if (value is String) return DateTime.tryParse(value)?.toUtc();
  return null;
}

String _gameStatus(GameStatus status) => switch (status) {
  GameStatus.finalStatus => 'final',
  GameStatus.voided => 'void',
  _ => status.name,
};

String _overrideStatus(GameStatus status) => switch (status) {
  GameStatus.finalStatus => 'final',
  GameStatus.voided || GameStatus.cancelled => 'void',
  _ => 'reviewRequired',
};

GameStatus _parseGameStatus(String? value) => switch (value) {
  'scheduled' => GameStatus.scheduled,
  'delayed' => GameStatus.delayed,
  'live' => GameStatus.live,
  'final' || 'finalStatus' => GameStatus.finalStatus,
  'postponed' => GameStatus.postponed,
  'suspended' => GameStatus.suspended,
  'cancelled' => GameStatus.cancelled,
  'void' || 'voided' => GameStatus.voided,
  _ => GameStatus.reviewRequired,
};

PickOutcome _pickOutcome(String? value) => switch (value) {
  'correct' => PickOutcome.correct,
  'incorrect' => PickOutcome.incorrect,
  'void' || 'voided' => PickOutcome.voided,
  _ => PickOutcome.pending,
};

int _versionNumber(String value) {
  if (value.isEmpty) return 0;
  final prefix = value.length >= 7 ? value.substring(0, 7) : value;
  return int.tryParse(prefix, radix: 16) ?? value.hashCode.abs();
}
