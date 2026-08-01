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
    required String weekId,
    CatalogQuery? query,
    String? timezone,
    DateTime? weekStartAt,
    DateTime? weekEndAt,
    bool forceRefresh = false,
  }) async {
    final date = (DateTime value) =>
        '${value.year.toString().padLeft(4, '0')}-'
        '${value.month.toString().padLeft(2, '0')}-'
        '${value.day.toString().padLeft(2, '0')}';
    final result = await _call('listSportsCatalog', {
      'leagueId': leagueId,
      'weekId': weekId,
      if (query != null) ...{
        'sportCode': query.sportCode,
        'leagueCode': query.leagueCode,
        'leagueIdForProvider': query.providerLeagueId,
        'season': query.season,
        'from': date(query.from),
        'to': date(query.to),
        'dateMode': query.dateMode.name,
      },
      'forceRefresh': query?.forceRefresh ?? forceRefresh,
      'timezone': query?.timezone ?? timezone ?? 'UTC',
      if ((query?.weekStartAt ?? weekStartAt) case final value?)
        'weekStartAt': value.toUtc().toIso8601String(),
      if ((query?.weekEndAt ?? weekEndAt) case final value?)
        'weekEndAt': value.toUtc().toIso8601String(),
      if (query == null) 'discovery': true,
    });
    final rawGames = result['games'];
    final games = rawGames is List
        ? [
            for (final value in rawGames)
              if (value is Map)
                parseGameSnapshot('${value['id'] ?? ''}', _map(value)),
          ]
        : <Game>[];
    return parseSportsCatalogResult(
      result,
      requestedQuery: query,
      games: games,
    );
  }

  @override
  Future<int> saveDraftSlate({
    required String leagueId,
    required String weekId,
    required String chunkKey,
    required List<Game> games,
    List<String> removeGameIds = const [],
    String? requestId,
  }) async {
    final result = await _call('saveDraftSlate', {
      'leagueId': leagueId,
      'weekId': weekId,
      'chunkKey': chunkKey,
      'games': games
          .map(
            (game) => _gameToJson(
              game,
              wireResultVersion: game.resultVersionToken.isNotEmpty
                  ? game.resultVersionToken
                  : game.sourcePayloadHash,
            ),
          )
          .toList(growable: false),
      'removeGameIds': removeGameIds,
    }, requestId: requestId);
    return _int(result, 'selectedGameCount');
  }

  @override
  Future<PublishSlateResult> publishWeeklySlate({
    required String leagueId,
    required String weekId,
    String? requestId,
  }) async {
    final result = await _call('publishWeeklySlate', {
      'leagueId': leagueId,
      'weekId': weekId,
    }, requestId: requestId);
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
    String? requestId,
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
    }, requestId: requestId);
    return _string(result, 'gameId');
  }

  @override
  Future<EntrySaveResult> submitOrConfirmEntry({
    required String leagueId,
    required String weekId,
    required Map<String, String> picks,
    String? requestId,
  }) async {
    final result = await _call('submitOrConfirmEntry', {
      'leagueId': leagueId,
      'weekId': weekId,
      'picks': [
        for (final pick in picks.entries)
          {'gameId': pick.key, 'selectedTeamId': pick.value},
      ],
    }, requestId: requestId);
    return EntrySaveResult(
      savedPickCount: _int(result, 'savedPickCount'),
      totalRequiredPickCount: _int(result, 'totalRequiredPickCount'),
      completionState: _string(result, 'completionState'),
    );
  }

  @override
  Future<CreatedWeek> createNextWeek({
    required String leagueId,
    required int sequentialNumber,
    required String label,
    required DateTime startAt,
    required DateTime endAt,
    String? pickerUid,
    String? requestId,
  }) async {
    final result = await _call('createNextWeek', {
      'leagueId': leagueId,
      'sequentialNumber': sequentialNumber,
      'label': label,
      'startAt': startAt.toUtc().toIso8601String(),
      'endAt': endAt.toUtc().toIso8601String(),
      if (pickerUid != null) 'pickerUid': pickerUid,
    }, requestId: requestId);
    return CreatedWeek(
      weekId: _string(result, 'weekId'),
      pickerUid: _string(result, 'pickerUid'),
    );
  }

  @override
  Future<void> assignWeeklyPicker({
    required String leagueId,
    required String weekId,
    required String pickerUid,
  }) async {
    await _call('assignWeeklyPicker', {
      'leagueId': leagueId,
      'weekId': weekId,
      'pickerUid': pickerUid,
    });
  }

  @override
  Future<RevealResult> revealLockedGamePicks({
    required String leagueId,
    required String weekId,
  }) async {
    const revealPageSize = 200;
    final revealsByGame = <String, Map<String, RevealedPick>>{};
    final visitedCursors = <String>{};
    Map<String, Object?>? cursor;
    var revealedGameCount = 0;
    var payloadTruncated = false;
    while (true) {
      final result = await _call('revealLockedGamePicks', {
        'leagueId': leagueId,
        'weekId': weekId,
        'revealPageSize': revealPageSize,
        if (cursor != null) 'revealCursor': cursor,
      });
      revealedGameCount += _int(result, 'revealedGameCount');
      for (final entry in _mapOrEmpty(result['revealsByGame']).entries) {
        final picksByUid = revealsByGame.putIfAbsent(
          entry.key,
          () => <String, RevealedPick>{},
        );
        final value = entry.value;
        if (value is! List) continue;
        for (final item in value) {
          if (item is! Map) continue;
          final data = _map(item);
          final uid = data['uid'] as String? ?? '';
          if (uid.isEmpty) continue;
          picksByUid[uid] = RevealedPick(
            uid: uid,
            displayName: data['displayName'] as String? ?? 'Member',
            selectedTeamId: data['selectedTeamId'] as String? ?? '',
            outcome: _pickOutcome(data['outcome'] as String?),
            points: _number(data['points']),
          );
        }
      }

      final page = _mapOrEmpty(result['revealPage']);
      final nextCursor = _mapOrEmpty(page['nextCursor']);
      final nextGameId = nextCursor['gameId'] as String?;
      if (nextGameId == null || nextGameId.isEmpty) {
        payloadTruncated = page['truncated'] == true;
        cursor = null;
        break;
      }
      final nextAfterUid = nextCursor['afterUid'] as String?;
      final currentGameId = cursor?['gameId'] as String?;
      final currentAfterUid = cursor?['afterUid'] as String?;
      final cursorAdvances =
          currentGameId == null ||
          nextGameId.compareTo(currentGameId) > 0 ||
          (nextGameId == currentGameId &&
              nextAfterUid != null &&
              (currentAfterUid == null ||
                  nextAfterUid.compareTo(currentAfterUid) > 0));
      if (!cursorAdvances) {
        throw const RepositoryException(
          'invalid-response',
          'The server returned a non-advancing reveal page.',
        );
      }
      final cursorKey = '$nextGameId\u0000${nextAfterUid ?? ''}';
      if (!visitedCursors.add(cursorKey)) {
        throw const RepositoryException(
          'invalid-response',
          'The server returned a repeated reveal page.',
        );
      }
      cursor = {'gameId': nextGameId, 'afterUid': nextAfterUid};
      payloadTruncated = true;
    }
    return RevealResult(
      revealedGameCount: revealedGameCount,
      revealsByGame: Map<String, List<RevealedPick>>.unmodifiable({
        for (final entry in revealsByGame.entries)
          entry.key: List<RevealedPick>.unmodifiable(entry.value.values),
      }),
      payloadTruncated: payloadTruncated,
    );
  }

  @override
  Future<int> calculateProvisionalWeekResults({
    required String leagueId,
    required String weekId,
  }) async {
    final result = await _call('calculateProvisionalWeekResults', {
      'leagueId': leagueId,
      'weekId': weekId,
    });
    final scores = result['scores'];
    return scores is List ? scores.length : 0;
  }

  @override
  Future<RefreshResult> refreshSelectedGames({
    required String leagueId,
    required String weekId,
    bool forceRefresh = false,
    String? gameId,
  }) async {
    final result = await _call('refreshSelectedGames', {
      'leagueId': leagueId,
      'weekId': weekId,
      'forceRefresh': forceRefresh,
      if (gameId != null) 'gameId': gameId,
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
    DateTime? scheduledAtUtc,
  }) async {
    final result = await _call('overrideGameResult', {
      'leagueId': leagueId,
      'weekId': weekId,
      'gameId': gameId,
      if (scheduledAtUtc != null)
        'scheduledAtUtc': scheduledAtUtc.toUtc().toIso8601String(),
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
      return parseLeagueSummary(snapshot.id, data);
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
          return data == null ? null : parseWeekSummary(snapshot.id, data);
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
              .map((document) => parseWeekSummary(document.id, document.data()))
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
              .map((document) => parseStanding(document.id, document.data()))
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
                (document) => parseGameSnapshot(document.id, document.data()),
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
    Map<String, Object?> payload, {
    String? requestId,
  }) async {
    try {
      final response = await _functions.httpsCallable(name).call<Object?>({
        'requestId': requestId ?? _requestId(),
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
      throw RepositoryException(
        error.code,
        _safeFunctionsMessage(error.code, error.message),
        reason: _safeFunctionsReason(error.details),
      );
    }
  }

  String _requestId() =>
      '${DateTime.now().microsecondsSinceEpoch}_${_random.nextInt(0x3fffffff)}';
}

/// Parses the non-game portion of the sports-catalog callable contract.
///
/// Games are parsed by the repository's canonical game decoder before reaching
/// this helper. Optional presentation and discovery metadata is deliberately
/// fail-closed: malformed entries are ignored and remote logos remain disabled.
SportsCatalogResult parseSportsCatalogResult(
  Map<String, Object?> result, {
  CatalogQuery? requestedQuery,
  required List<Game> games,
}) {
  final provider = _nonEmptyString(result['provider']) ?? 'unknown';
  final cache = _mapOrEmpty(result['cache']);
  final cacheHit = cache['hit'] as bool? ?? false;
  final stale = cache['stale'] as bool? ?? false;
  final delayed = cache['delayed'] as bool? ?? false;
  final sports = _catalogSports(result['supportedSports'] ?? result['sports']);
  final leagues = _catalogLeagues(
    result['supportedLeagues'] ?? result['leagues'],
  );
  final presentation = _catalogPresentation(
    result['presentation'],
    attribution: result['attribution'],
    fallbackProvider: provider,
  );
  final effectiveQuery = _catalogQuerySnapshot(
    result['effectiveQuery'] ?? result['query'],
    fallback: requestedQuery,
  );
  final week = _mapOrEmpty(result['week']);
  final weekStartAt =
      _dateOrNull(result['weekStartAt']) ??
      _dateOrNull(week['startAt']) ??
      effectiveQuery?.weekStartAt ??
      requestedQuery?.weekStartAt;
  final weekEndAt =
      _dateOrNull(result['weekEndAt']) ??
      _dateOrNull(week['endAt']) ??
      effectiveQuery?.weekEndAt ??
      requestedQuery?.weekEndAt;
  final availability = _catalogAvailability(
    result['availability'],
    provider: provider,
    games: games,
    delayed: delayed,
  );

  return SportsCatalogResult(
    provider: provider,
    supportedSports: sports,
    supportedLeagues: leagues,
    games: games,
    cacheHit: cacheHit,
    stale: stale,
    delayed: delayed,
    cachedAt: _dateOrNull(cache['cachedAt']),
    expiresAt: _dateOrNull(cache['expiresAt']),
    presentation: presentation,
    effectiveQuery: effectiveQuery == null
        ? null
        : CatalogQuerySnapshot(
            sportCode: effectiveQuery.sportCode,
            leagueCode: effectiveQuery.leagueCode,
            providerLeagueId: effectiveQuery.providerLeagueId,
            season: effectiveQuery.season,
            from: effectiveQuery.from,
            to: effectiveQuery.to,
            timezone: effectiveQuery.timezone,
            dateMode: effectiveQuery.dateMode,
            weekStartAt: weekStartAt,
            weekEndAt: weekEndAt,
          ),
    availability: availability,
    weekStartAt: weekStartAt,
    weekEndAt: weekEndAt,
  );
}

List<CatalogSport> _catalogSports(Object? value) {
  if (value is! List) return const <CatalogSport>[];
  final byCode = <String, CatalogSport>{};
  for (final item in value) {
    if (item is String) {
      final code = item.trim();
      if (code.isEmpty) continue;
      byCode[code] = CatalogSport(code: code, displayName: _displayName(code));
      continue;
    }
    final data = _mapOrEmpty(item);
    final code = _nonEmptyString(
      data['code'] ?? data['sportCode'] ?? data['id'],
    );
    if (code == null) continue;
    byCode[code] = CatalogSport(
      code: code,
      displayName:
          _nonEmptyString(data['displayName'] ?? data['name']) ??
          _displayName(code),
    );
  }
  return List<CatalogSport>.unmodifiable(byCode.values);
}

List<CatalogLeague> _catalogLeagues(Object? value) {
  if (value is! List) return const <CatalogLeague>[];
  final byCode = <String, CatalogLeague>{};
  for (final item in value) {
    final data = _mapOrEmpty(item);
    final code = _nonEmptyString(data['code'] ?? data['leagueCode']);
    final sportCode = _nonEmptyString(data['sportCode']);
    final providerLeagueId = _nonEmptyString(
      data['providerLeagueId'] ??
          data['leagueIdForProvider'] ??
          data['leagueId'],
    );
    final season = _nonEmptyString(data['season']);
    if (code == null ||
        sportCode == null ||
        providerLeagueId == null ||
        season == null) {
      continue;
    }
    byCode['$sportCode:$code'] = CatalogLeague(
      code: code,
      displayName:
          _nonEmptyString(data['displayName'] ?? data['name']) ??
          _displayName(code),
      sportCode: sportCode,
      providerLeagueId: providerLeagueId,
      season: season,
    );
  }
  return List<CatalogLeague>.unmodifiable(byCode.values);
}

const _activePresentationProviders = <String>{
  'manual',
  'mock',
  'theSportsDbTest',
  'apiSports',
  'sportsDataIo',
};

// SportsDataIO remains text/data-only until an explicit artwork entitlement
// is reviewed. Only these configured providers may currently opt in to the
// server-reviewed remote-logo policy.
const _remoteLogoEligibleProviders = <String>{'theSportsDbTest', 'apiSports'};

CatalogPresentation _catalogPresentation(
  Object? value, {
  required Object? attribution,
  required String fallbackProvider,
}) {
  final data = _mapOrEmpty(value);
  final attributionData = _mapOrEmpty(attribution);
  final provider = _nonEmptyString(data['provider']);
  final providerMatchesEnvelope =
      fallbackProvider != 'unknown' && provider == fallbackProvider;
  final activeProvider =
      provider != null && _activePresentationProviders.contains(provider);
  final attributionText =
      _nonEmptyString(data['attributionText']) ??
      _nonEmptyString(attributionData['text']) ??
      '';
  final attributionUrl = Uri.tryParse(
    _nonEmptyString(data['attributionUrl'] ?? attributionData['url']) ?? '',
  );
  final reviewDate = _dateOrNull(
    data['logoRightsReviewDate'] ?? data['logoRightsReviewedAt'],
  );
  final hosts = _stringSet(data['allowedLogoHosts'] ?? data['allowedHosts']);
  final queryParameters = _stringSet(
    data['allowedLogoQueryParameters'] ?? data['allowedQueryParameters'],
  );
  final allowRemoteLogos = data['allowRemoteLogos'] == true;
  if (!providerMatchesEnvelope || !activeProvider) {
    // Unknown and historical providers remain readable through their game
    // snapshots, but stale attribution and remote artwork policy must never
    // become user-visible again.
    return const CatalogPresentation.disabled();
  }
  if (!_remoteLogoEligibleProviders.contains(provider) ||
      !allowRemoteLogos ||
      reviewDate == null ||
      hosts.isEmpty) {
    return CatalogPresentation.disabled(
      provider: provider,
      attributionText: attributionText,
      attributionUrl: attributionUrl?.hasScheme == true ? attributionUrl : null,
    );
  }
  return CatalogPresentation(
    provider: provider,
    attributionText: attributionText,
    attributionUrl: attributionUrl?.hasScheme == true ? attributionUrl : null,
    allowRemoteLogos: true,
    allowedLogoHosts: hosts,
    allowedLogoQueryParameters: queryParameters,
    logoRightsReviewDate: reviewDate,
  );
}

CatalogQuerySnapshot? _catalogQuerySnapshot(
  Object? value, {
  required CatalogQuery? fallback,
}) {
  final data = _mapOrEmpty(value);
  final sportCode = _nonEmptyString(data['sportCode']) ?? fallback?.sportCode;
  final leagueCode =
      _nonEmptyString(data['leagueCode']) ?? fallback?.leagueCode;
  final providerLeagueId =
      _nonEmptyString(
        data['providerLeagueId'] ??
            data['leagueIdForProvider'] ??
            data['leagueId'],
      ) ??
      fallback?.providerLeagueId;
  final season = _nonEmptyString(data['season']) ?? fallback?.season;
  final from = _dateOrNull(data['from']) ?? fallback?.from;
  final to = _dateOrNull(data['to']) ?? fallback?.to;
  if (sportCode == null ||
      leagueCode == null ||
      providerLeagueId == null ||
      season == null ||
      from == null ||
      to == null) {
    return null;
  }
  return CatalogQuerySnapshot(
    sportCode: sportCode,
    leagueCode: leagueCode,
    providerLeagueId: providerLeagueId,
    season: season,
    from: from,
    to: to,
    timezone: _nonEmptyString(data['timezone']) ?? fallback?.timezone ?? 'UTC',
    dateMode:
        _catalogDateMode(data['dateMode']) ??
        fallback?.dateMode ??
        CatalogDateMode.allDates,
    weekStartAt: _dateOrNull(data['weekStartAt']) ?? fallback?.weekStartAt,
    weekEndAt: _dateOrNull(data['weekEndAt']) ?? fallback?.weekEndAt,
  );
}

CatalogAvailability _catalogAvailability(
  Object? value, {
  required String provider,
  required List<Game> games,
  required bool delayed,
}) {
  final data = _mapOrEmpty(value);
  final rawState = value is String
      ? value
      : _nonEmptyString(data['state'] ?? data['code']);
  final inferred = provider == 'manual'
      ? CatalogAvailabilityState.providerNotConfigured
      : delayed
      ? CatalogAvailabilityState.quotaDelayed
      : games.isEmpty
      ? CatalogAvailabilityState.noGames
      : CatalogAvailabilityState.available;
  return CatalogAvailability(
    state: _availabilityState(rawState) ?? inferred,
    message: _nonEmptyString(data['message']),
  );
}

CatalogAvailabilityState? _availabilityState(String? value) => switch (value) {
  'available' || 'success' || 'stale' => CatalogAvailabilityState.available,
  'noGames' ||
  'noGamesScheduled' ||
  'no_games' ||
  'no-games' => CatalogAvailabilityState.noGames,
  'offSeason' ||
  'off_season' ||
  'off-season' => CatalogAvailabilityState.offSeason,
  'providerNotConfigured' ||
  'provider_not_configured' ||
  'provider-not-configured' ||
  'notConfigured' => CatalogAvailabilityState.providerNotConfigured,
  'providerConfigurationRequired' ||
  'provider_configuration_required' ||
  'provider-configuration-required' =>
    CatalogAvailabilityState.providerConfigurationRequired,
  'providerUnavailable' ||
  'provider_unavailable' ||
  'provider-unavailable' ||
  'unavailable' => CatalogAvailabilityState.providerUnavailable,
  'quotaDelayed' ||
  'quota_delayed' ||
  'quota-delayed' ||
  'delayed' => CatalogAvailabilityState.quotaDelayed,
  'unauthorized' ||
  'permissionDenied' ||
  'permission-denied' => CatalogAvailabilityState.unauthorized,
  'unknown' => CatalogAvailabilityState.unknown,
  _ => null,
};

CatalogDateMode? _catalogDateMode(Object? value) => switch (value) {
  'today' => CatalogDateMode.today,
  'tomorrow' => CatalogDateMode.tomorrow,
  'later' => CatalogDateMode.later,
  'allDates' || 'all_dates' || 'all-dates' || 'all' => CatalogDateMode.allDates,
  'custom' => CatalogDateMode.custom,
  _ => null,
};

Set<String> _stringSet(Object? value) {
  if (value is! List) return const <String>{};
  return Set<String>.unmodifiable(
    value
        .whereType<String>()
        .map((item) => item.trim().toLowerCase())
        .where((item) => item.isNotEmpty),
  );
}

String? _nonEmptyString(Object? value) {
  if (value is! String && value is! num) return null;
  final normalized = '$value'.trim();
  return normalized.isEmpty ? null : normalized;
}

String? _calendarDayOrNull(Object? value) {
  final normalized = _nonEmptyString(value);
  if (normalized == null ||
      !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(normalized)) {
    return null;
  }
  final parsed = DateTime.tryParse('${normalized}T00:00:00.000Z');
  return parsed == null ||
          parsed.toIso8601String().substring(0, 10) != normalized
      ? null
      : normalized;
}

String _displayName(String code) => code
    .split(RegExp(r'[-_\s]+'))
    .where((part) => part.isNotEmpty)
    .map(
      (part) => part.length <= 4
          ? part.toUpperCase()
          : '${part[0].toUpperCase()}${part.substring(1).toLowerCase()}',
    )
    .join(' ');

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

Map<String, Object?> _mapOrEmpty(Object? value) {
  if (value is Map<String, Object?>) return value;
  if (value is Map) {
    return value.map((key, item) => MapEntry('$key', item));
  }
  return const {};
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

int _nonNegativeNumber(Object? value) {
  final parsed = _number(value);
  return parsed < 0 ? 0 : parsed;
}

int? _optionalNonNegativeNumber(Object? value) {
  if (value is! num) return null;
  final parsed = value.toInt();
  return parsed < 0 ? null : parsed;
}

String _safeFunctionsMessage(String code, String? serverMessage) {
  final safeServerMessage = serverMessage?.trim();
  if (safeServerMessage != null &&
      safeServerMessage.isNotEmpty &&
      safeServerMessage.length <= 240 &&
      const {
        'failed-precondition',
        'permission-denied',
        'invalid-argument',
        'already-exists',
      }.contains(code)) {
    return safeServerMessage;
  }
  return switch (code) {
    'unauthenticated' => 'Please sign in again.',
    'permission-denied' => 'You do not have permission to do that.',
    'resource-exhausted' =>
      'Sports data refresh is temporarily delayed. Cached data is still available.',
    'deadline-exceeded' || 'unavailable' =>
      'The service is temporarily unavailable. Try again shortly.',
    'failed-precondition' =>
      'This action is not available in the current state.',
    _ => 'The action could not be completed. Try again.',
  };
}

String? _safeFunctionsReason(Object? details) {
  if (details is! Map) return null;
  final reason = details['reason'];
  return reason is String && sportsDataIoConfigurationReasons.contains(reason)
      ? reason
      : null;
}

Map<String, Object?> _gameToJson(
  Game game, {
  required String wireResultVersion,
}) => {
  'id': game.id,
  'provider': game.provider,
  'providerGameId': game.providerGameId,
  'providerScoreId': game.providerScoreId,
  'providerLeagueGameId': game.providerLeagueGameId,
  'providerGlobalGameId': game.providerGlobalGameId,
  'providerGameKey': game.providerGameKey,
  'sportCode': game.sportCode,
  'leagueCode': game.leagueCode,
  'providerLeagueId': game.providerLeagueId,
  'leagueName': game.leagueName,
  'season': game.season,
  'seasonType': game.seasonType,
  'weekOrRound': game.weekOrRound,
  'scheduledAtUtc': game.scheduledAtUtc?.toIso8601String(),
  'publishedScheduledAtUtc': game.publishedScheduledAtUtc?.toIso8601String(),
  'effectiveLockAtUtc': game.effectiveLockAtUtc?.toIso8601String(),
  'scheduledDayEastern': game.scheduledDayEastern,
  'timeTbd': game.timeTbd,
  'venueName': game.venueName,
  'neutralSite': game.neutralSite,
  'homeTeam': game.homeTeam.toJson(),
  'awayTeam': game.awayTeam.toJson(),
  'status': _gameStatus(game.status),
  'statusDetail': game.statusDetail,
  'isClosed': game.isClosed,
  'rescheduledFromLeagueGameId': game.rescheduledFromLeagueGameId,
  'rescheduledToLeagueGameId': game.rescheduledToLeagueGameId,
  'homeScore': game.homeScore,
  'awayScore': game.awayScore,
  'winnerTeamId': game.winnerTeamId,
  'broadcast': game.broadcast,
  'eventDetail': game.eventDetail,
  'providerLastUpdatedAt': game.providerLastUpdatedAt.toIso8601String(),
  'lastSyncedAt': game.lastSyncedAt.toIso8601String(),
  'resultVersion': wireResultVersion,
  'rawResponseVersion': game.rawResponseVersion,
  'sourcePayloadHash': game.sourcePayloadHash,
  'selectable': game.selectable,
  'selectionReason': game.selectionReason,
};

Game parseGameSnapshot(String id, Map<String, Object?> data) {
  final scheduled = _dateOrNull(data['scheduledAtUtc']);
  final timeTbd = data['timeTbd'] == true;
  final observedFallback =
      scheduled ?? DateTime.fromMillisecondsSinceEpoch(0, isUtc: true);
  final wireVersion = data['resultVersion'] as String? ?? '';
  return Game(
    id: data['id'] as String? ?? id,
    provider: data['provider'] as String? ?? 'unknown',
    providerGameId: data['providerGameId'] as String? ?? id,
    providerScoreId: _nonEmptyString(data['providerScoreId']),
    providerLeagueGameId: _nonEmptyString(data['providerLeagueGameId']),
    providerGlobalGameId: _nonEmptyString(data['providerGlobalGameId']),
    providerGameKey: _nonEmptyString(data['providerGameKey']),
    sportCode: data['sportCode'] as String? ?? 'unknown',
    leagueCode: data['leagueCode'] as String? ?? 'unknown',
    providerLeagueId: data['providerLeagueId'] as String?,
    leagueName: data['leagueName'] as String? ?? 'Sports',
    season: '${data['season'] ?? ''}',
    seasonType: _nonEmptyString(data['seasonType']),
    weekOrRound: _nonEmptyString(data['weekOrRound']),
    scheduledAtUtc: scheduled,
    publishedScheduledAtUtc: timeTbd
        ? _dateOrNull(data['publishedScheduledAtUtc'])
        : _dateOrNull(data['publishedScheduledAtUtc']) ?? scheduled,
    effectiveLockAtUtc: timeTbd
        ? _dateOrNull(data['effectiveLockAtUtc'])
        : _dateOrNull(data['effectiveLockAtUtc']) ?? scheduled,
    scheduledDayEastern: _calendarDayOrNull(data['scheduledDayEastern']),
    timeTbd: timeTbd,
    venueName: _nonEmptyString(data['venueName']),
    neutralSite: data['neutralSite'] as bool? ?? false,
    homeTeam: _team(_map(data['homeTeam'])),
    awayTeam: _team(_map(data['awayTeam'])),
    status: _parseGameStatus(data['status'] as String?),
    statusDetail: _nonEmptyString(data['statusDetail']),
    isClosed: switch (data['isClosed']) {
      final bool value => value,
      _ => null,
    },
    rescheduledFromLeagueGameId: _nonEmptyString(
      data['rescheduledFromLeagueGameId'],
    ),
    rescheduledToLeagueGameId: _nonEmptyString(
      data['rescheduledToLeagueGameId'],
    ),
    homeScore: data['homeScore'] is num
        ? (data['homeScore'] as num).toInt()
        : null,
    awayScore: data['awayScore'] is num
        ? (data['awayScore'] as num).toInt()
        : null,
    winnerTeamId: _nonEmptyString(data['winnerTeamId']),
    broadcast: _nonEmptyString(data['broadcast']),
    eventDetail: _nonEmptyString(data['eventDetail']),
    providerLastUpdatedAt:
        _dateOrNull(data['providerLastUpdatedAt']) ?? observedFallback,
    lastSyncedAt: _dateOrNull(data['lastSyncedAt']) ?? observedFallback,
    manualOverride: data['manualOverride'] as bool? ?? false,
    manualOverrideReason: data['manualOverrideReason'] as String?,
    manualOverrideBy: data['manualOverrideBy'] as String?,
    resultVersion: _versionNumber(wireVersion),
    resultVersionToken: wireVersion,
    rawResponseVersion: switch (data['rawResponseVersion']) {
      final num value when value.toInt() > 0 => value.toInt(),
      _ => 1,
    },
    sourcePayloadHash: data['sourcePayloadHash'] as String? ?? '',
    pickRevealCompletedAt: _dateOrNull(data['pickRevealCompletedAt']),
    selectable: switch (data['selectable']) {
      final bool value => value,
      _ => null,
    },
    selectionReason: _nonEmptyString(data['selectionReason']),
  );
}

Team _team(Map<String, Object?> data) => Team(
  id: data['id'] as String? ?? '',
  name: data['name'] as String? ?? 'Unknown team',
  shortName: data['shortName'] as String? ?? data['name'] as String? ?? 'Team',
  abbreviation: data['abbreviation'] as String? ?? '—',
  logoUrl: switch (_nonEmptyString(data['logoUrl'])) {
    final value? => Uri.tryParse(value),
    null => null,
  },
  color: _nonEmptyString(data['color']),
  providerTeamId: _nonEmptyString(data['providerTeamId']),
  providerGlobalTeamId: _nonEmptyString(data['providerGlobalTeamId']),
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

Standing parseStanding(String uid, Map<String, Object?> data) => Standing(
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
  standingsEpoch: _nonNegativeNumber(data['standingsEpoch']),
);

/// Parses the member-readable league contract.
///
/// Leagues created before standings generation fencing do not contain either
/// epoch. Treating both as zero preserves their existing standings while a
/// mismatch on newer leagues safely hides a partial rebuild.
LeagueSummary parseLeagueSummary(String id, Map<String, Object?> data) {
  final settings = data['settings'] is Map
      ? _map(data['settings'])
      : const <String, Object?>{};
  return LeagueSummary(
    id: id,
    name: data['name'] as String? ?? 'Luke’s Picks Arena',
    timezone: data['timezone'] as String? ?? 'America/Chicago',
    currentWeekId: data['currentWeekId'] as String?,
    currentPickerUid: data['currentPickerUid'] as String?,
    pickerParticipatesInPicks:
        settings['pickerParticipatesInPicks'] as bool? ?? false,
    pickLockPolicy: settings['pickLockPolicy'] == 'firstGame'
        ? PickLockPolicy.firstGame
        : PickLockPolicy.perGame,
    standingsEpoch: _nonNegativeNumber(data['standingsEpoch']),
    standingsBuiltEpoch: _nonNegativeNumber(data['standingsBuiltEpoch']),
    standingsBuiltMemberCount: _optionalNonNegativeNumber(
      data['standingsBuiltMemberCount'],
    ),
  );
}

/// Parses the server-owned, member-readable week contract.
///
/// Published presentation metadata is deliberately fail-closed: the policy's
/// provider must match the separate provider snapshot written by the server.
/// Missing metadata on legacy weeks therefore preserves neutral team badges.
WeekSummary parseWeekSummary(String id, Map<String, Object?> data) {
  final catalogProvider = _nonEmptyString(data['catalogProviderSnapshot']);
  return WeekSummary(
    id: id,
    sequentialNumber: _number(data['sequentialNumber']),
    label: data['label'] as String? ?? 'Week',
    pickerUid: data['pickerUid'] as String? ?? '',
    status: data['status'] as String? ?? 'draft',
    startAt: _dateOrNull(data['startAt']),
    endAt: _dateOrNull(data['endAt']),
    finalizedAt: _dateOrNull(data['finalizedAt']),
    winnerUids: data['winnerUids'] is List
        ? (data['winnerUids'] as List).whereType<String>().toList(
            growable: false,
          )
        : const [],
    highScore: data['highScore'] is num
        ? (data['highScore'] as num).toInt()
        : null,
    pickerParticipatesInPicks:
        data['pickerParticipatesSnapshot'] as bool? ?? false,
    lockPolicy: data['lockPolicySnapshot'] == 'firstGame'
        ? PickLockPolicy.firstGame
        : PickLockPolicy.perGame,
    selectedGameCount: _number(data['selectedGameCount']),
    eligibleMemberCount: _number(data['eligibleMemberCount']),
    nextPickerUid: _nonEmptyString(data['nextPickerUid']),
    catalogPresentation: _catalogPresentation(
      data['catalogPresentationSnapshot'],
      attribution: null,
      fallbackProvider: catalogProvider ?? 'unknown',
    ),
  );
}

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
  GameStatus.scheduled => 'scheduled',
  GameStatus.delayed => 'delayed',
  GameStatus.postponed => 'postponed',
  GameStatus.suspended => 'suspended',
  GameStatus.finalStatus => 'final',
  GameStatus.voided || GameStatus.cancelled => 'void',
  GameStatus.reviewRequired || GameStatus.live => 'reviewRequired',
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
