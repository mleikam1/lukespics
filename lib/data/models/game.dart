enum GameStatus {
  scheduled,
  delayed,
  live,
  finalStatus,
  postponed,
  suspended,
  cancelled,
  voided,
  reviewRequired,
}

enum PickLockPolicy { perGame, firstGame }

const Object _copyWithUnset = Object();

final class Team {
  const Team({
    required this.id,
    required this.name,
    required this.shortName,
    required this.abbreviation,
    this.logoUrl,
    this.color,
    this.providerTeamId,
    this.providerGlobalTeamId,
  });

  final String id;
  final String name;
  final String shortName;
  final String abbreviation;
  final Uri? logoUrl;
  final String? color;
  final String? providerTeamId;
  final String? providerGlobalTeamId;

  Map<String, Object?> toJson() => {
    'id': id,
    'name': name,
    'shortName': shortName,
    'abbreviation': abbreviation,
    'logoUrl': logoUrl?.toString(),
    'color': color,
    'providerTeamId': providerTeamId,
    'providerGlobalTeamId': providerGlobalTeamId,
  };
}

final class Game {
  const Game({
    required this.id,
    required this.provider,
    required this.providerGameId,
    this.providerScoreId,
    this.providerLeagueGameId,
    this.providerGlobalGameId,
    this.providerGameKey,
    required this.sportCode,
    required this.leagueCode,
    String? providerLeagueId,
    required this.leagueName,
    required this.season,
    this.seasonType,
    required this.scheduledAtUtc,
    required this.publishedScheduledAtUtc,
    required this.effectiveLockAtUtc,
    this.scheduledDayEastern,
    this.timeTbd = false,
    required this.homeTeam,
    required this.awayTeam,
    required this.status,
    this.statusDetail,
    this.isClosed,
    this.rescheduledFromLeagueGameId,
    this.rescheduledToLeagueGameId,
    required this.providerLastUpdatedAt,
    required this.lastSyncedAt,
    required this.resultVersion,
    required this.sourcePayloadHash,
    this.resultVersionToken = '',
    this.rawResponseVersion = 1,
    this.weekOrRound,
    this.venueName,
    this.neutralSite = false,
    this.homeScore,
    this.awayScore,
    this.winnerTeamId,
    this.broadcast,
    this.eventDetail,
    this.manualOverride = false,
    this.manualOverrideReason,
    this.manualOverrideBy,
    this.pickRevealCompletedAt,
    this.selectable,
    this.selectionReason,
  }) : providerLeagueId = providerLeagueId ?? leagueCode;

  final String id;
  final String provider;
  final String providerGameId;
  final String? providerScoreId;
  final String? providerLeagueGameId;
  final String? providerGlobalGameId;
  final String? providerGameKey;
  final String sportCode;
  final String leagueCode;
  final String providerLeagueId;
  final String leagueName;
  final String season;
  final String? seasonType;
  final String? weekOrRound;
  final DateTime? scheduledAtUtc;
  final DateTime? publishedScheduledAtUtc;
  final DateTime? effectiveLockAtUtc;
  final String? scheduledDayEastern;
  final bool timeTbd;
  final String? venueName;
  final bool neutralSite;
  final Team homeTeam;
  final Team awayTeam;
  final GameStatus status;
  final String? statusDetail;
  final bool? isClosed;
  final String? rescheduledFromLeagueGameId;
  final String? rescheduledToLeagueGameId;
  final int? homeScore;
  final int? awayScore;
  final String? winnerTeamId;
  final String? broadcast;
  final String? eventDetail;
  final DateTime providerLastUpdatedAt;
  final DateTime lastSyncedAt;
  final bool manualOverride;
  final String? manualOverrideReason;
  final String? manualOverrideBy;
  final int resultVersion;

  /// The exact server-issued result version used by catalog trust checks.
  ///
  /// [resultVersion] remains the compact numeric value used by local scoring
  /// comparisons; this token must travel with its own immutable game snapshot
  /// so concurrent repository streams cannot pair versions from two snapshots.
  final String resultVersionToken;
  final int rawResponseVersion;
  final String sourcePayloadHash;
  final DateTime? pickRevealCompletedAt;
  final bool? selectable;
  final String? selectionReason;

  bool get hasConfirmedSchedule =>
      !timeTbd &&
      scheduledAtUtc != null &&
      publishedScheduledAtUtc != null &&
      effectiveLockAtUtc != null;

  bool isLockedAt(DateTime serverTime, {DateTime? slateLockAt}) {
    final gameLockAt = effectiveLockAtUtc;
    if (gameLockAt == null || timeTbd) return true;
    final lockAt = slateLockAt == null || gameLockAt.isBefore(slateLockAt)
        ? gameLockAt
        : slateLockAt;
    return !serverTime.toUtc().isBefore(lockAt);
  }

  bool get isVoid =>
      status == GameStatus.voided || status == GameStatus.cancelled;

  bool get isGradable =>
      isVoid ||
      (status == GameStatus.finalStatus && winnerTeamId != null) ||
      status == GameStatus.reviewRequired;

  bool acceptsTeam(String teamId) =>
      teamId == homeTeam.id || teamId == awayTeam.id;

  /// Schedule changes may move an unlocked game, but never reopen a game whose
  /// original lock has passed or whose picks have already been revealed.
  Game withRescheduledStart(DateTime nextStartUtc, DateTime serverTime) {
    final nextStart = nextStartUtc.toUtc();
    final currentLockAt = effectiveLockAtUtc;
    final wasExposed =
        pickRevealCompletedAt != null ||
        (currentLockAt != null && !serverTime.toUtc().isBefore(currentLockAt));
    final protectedLockAt = currentLockAt == null
        ? nextStart
        : nextStart.isBefore(currentLockAt)
        ? nextStart
        : currentLockAt;
    return copyWith(
      scheduledAtUtc: nextStart,
      publishedScheduledAtUtc: publishedScheduledAtUtc ?? nextStart,
      timeTbd: false,
      effectiveLockAtUtc: wasExposed ? currentLockAt : protectedLockAt,
    );
  }

  Game copyWith({
    String? providerLeagueId,
    String? seasonType,
    Object? scheduledAtUtc = _copyWithUnset,
    Object? publishedScheduledAtUtc = _copyWithUnset,
    Object? effectiveLockAtUtc = _copyWithUnset,
    Object? scheduledDayEastern = _copyWithUnset,
    bool? timeTbd,
    GameStatus? status,
    String? statusDetail,
    bool? isClosed,
    String? rescheduledFromLeagueGameId,
    String? rescheduledToLeagueGameId,
    int? homeScore,
    int? awayScore,
    String? winnerTeamId,
    String? broadcast,
    String? eventDetail,
    DateTime? providerLastUpdatedAt,
    DateTime? lastSyncedAt,
    bool? manualOverride,
    String? manualOverrideReason,
    String? manualOverrideBy,
    int? resultVersion,
    String? resultVersionToken,
    int? rawResponseVersion,
    String? sourcePayloadHash,
    DateTime? pickRevealCompletedAt,
    bool? selectable,
    String? selectionReason,
  }) => Game(
    id: id,
    provider: provider,
    providerGameId: providerGameId,
    providerScoreId: providerScoreId,
    providerLeagueGameId: providerLeagueGameId,
    providerGlobalGameId: providerGlobalGameId,
    providerGameKey: providerGameKey,
    sportCode: sportCode,
    leagueCode: leagueCode,
    providerLeagueId: providerLeagueId ?? this.providerLeagueId,
    leagueName: leagueName,
    season: season,
    seasonType: seasonType ?? this.seasonType,
    weekOrRound: weekOrRound,
    scheduledAtUtc: identical(scheduledAtUtc, _copyWithUnset)
        ? this.scheduledAtUtc
        : scheduledAtUtc as DateTime?,
    publishedScheduledAtUtc: identical(publishedScheduledAtUtc, _copyWithUnset)
        ? this.publishedScheduledAtUtc
        : publishedScheduledAtUtc as DateTime?,
    effectiveLockAtUtc: identical(effectiveLockAtUtc, _copyWithUnset)
        ? this.effectiveLockAtUtc
        : effectiveLockAtUtc as DateTime?,
    scheduledDayEastern: identical(scheduledDayEastern, _copyWithUnset)
        ? this.scheduledDayEastern
        : scheduledDayEastern as String?,
    timeTbd: timeTbd ?? this.timeTbd,
    venueName: venueName,
    neutralSite: neutralSite,
    homeTeam: homeTeam,
    awayTeam: awayTeam,
    status: status ?? this.status,
    statusDetail: statusDetail ?? this.statusDetail,
    isClosed: isClosed ?? this.isClosed,
    rescheduledFromLeagueGameId:
        rescheduledFromLeagueGameId ?? this.rescheduledFromLeagueGameId,
    rescheduledToLeagueGameId:
        rescheduledToLeagueGameId ?? this.rescheduledToLeagueGameId,
    homeScore: homeScore ?? this.homeScore,
    awayScore: awayScore ?? this.awayScore,
    winnerTeamId: winnerTeamId ?? this.winnerTeamId,
    broadcast: broadcast ?? this.broadcast,
    eventDetail: eventDetail ?? this.eventDetail,
    providerLastUpdatedAt: providerLastUpdatedAt ?? this.providerLastUpdatedAt,
    lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
    manualOverride: manualOverride ?? this.manualOverride,
    manualOverrideReason: manualOverrideReason ?? this.manualOverrideReason,
    manualOverrideBy: manualOverrideBy ?? this.manualOverrideBy,
    resultVersion: resultVersion ?? this.resultVersion,
    resultVersionToken: resultVersionToken ?? this.resultVersionToken,
    rawResponseVersion: rawResponseVersion ?? this.rawResponseVersion,
    sourcePayloadHash: sourcePayloadHash ?? this.sourcePayloadHash,
    pickRevealCompletedAt: pickRevealCompletedAt ?? this.pickRevealCompletedAt,
    selectable: selectable ?? this.selectable,
    selectionReason: selectionReason ?? this.selectionReason,
  );
}
