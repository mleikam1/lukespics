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

final class Team {
  const Team({
    required this.id,
    required this.name,
    required this.shortName,
    required this.abbreviation,
    this.logoUrl,
  });

  final String id;
  final String name;
  final String shortName;
  final String abbreviation;
  final Uri? logoUrl;

  Map<String, Object?> toJson() => {
    'id': id,
    'name': name,
    'shortName': shortName,
    'abbreviation': abbreviation,
    'logoUrl': logoUrl?.toString(),
  };
}

final class Game {
  const Game({
    required this.id,
    required this.provider,
    required this.providerGameId,
    required this.sportCode,
    required this.leagueCode,
    String? providerLeagueId,
    required this.leagueName,
    required this.season,
    required this.scheduledAtUtc,
    required this.publishedScheduledAtUtc,
    required this.effectiveLockAtUtc,
    required this.homeTeam,
    required this.awayTeam,
    required this.status,
    required this.providerLastUpdatedAt,
    required this.lastSyncedAt,
    required this.resultVersion,
    required this.sourcePayloadHash,
    this.resultVersionToken = '',
    this.weekOrRound,
    this.venueName,
    this.neutralSite = false,
    this.homeScore,
    this.awayScore,
    this.winnerTeamId,
    this.manualOverride = false,
    this.manualOverrideReason,
    this.manualOverrideBy,
    this.pickRevealCompletedAt,
  }) : providerLeagueId = providerLeagueId ?? leagueCode;

  final String id;
  final String provider;
  final String providerGameId;
  final String sportCode;
  final String leagueCode;
  final String providerLeagueId;
  final String leagueName;
  final String season;
  final String? weekOrRound;
  final DateTime scheduledAtUtc;
  final DateTime publishedScheduledAtUtc;
  final DateTime effectiveLockAtUtc;
  final String? venueName;
  final bool neutralSite;
  final Team homeTeam;
  final Team awayTeam;
  final GameStatus status;
  final int? homeScore;
  final int? awayScore;
  final String? winnerTeamId;
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
  final String sourcePayloadHash;
  final DateTime? pickRevealCompletedAt;

  bool isLockedAt(DateTime serverTime, {DateTime? slateLockAt}) {
    final lockAt =
        slateLockAt == null || effectiveLockAtUtc.isBefore(slateLockAt)
        ? effectiveLockAtUtc
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
    final wasExposed =
        pickRevealCompletedAt != null ||
        !serverTime.toUtc().isBefore(effectiveLockAtUtc);
    return copyWith(
      scheduledAtUtc: nextStartUtc.toUtc(),
      effectiveLockAtUtc: wasExposed
          ? effectiveLockAtUtc
          : nextStartUtc.toUtc(),
    );
  }

  Game copyWith({
    String? providerLeagueId,
    DateTime? scheduledAtUtc,
    DateTime? effectiveLockAtUtc,
    GameStatus? status,
    int? homeScore,
    int? awayScore,
    String? winnerTeamId,
    DateTime? providerLastUpdatedAt,
    DateTime? lastSyncedAt,
    bool? manualOverride,
    String? manualOverrideReason,
    String? manualOverrideBy,
    int? resultVersion,
    String? resultVersionToken,
    String? sourcePayloadHash,
    DateTime? pickRevealCompletedAt,
  }) => Game(
    id: id,
    provider: provider,
    providerGameId: providerGameId,
    sportCode: sportCode,
    leagueCode: leagueCode,
    providerLeagueId: providerLeagueId ?? this.providerLeagueId,
    leagueName: leagueName,
    season: season,
    weekOrRound: weekOrRound,
    scheduledAtUtc: scheduledAtUtc ?? this.scheduledAtUtc,
    publishedScheduledAtUtc: publishedScheduledAtUtc,
    effectiveLockAtUtc: effectiveLockAtUtc ?? this.effectiveLockAtUtc,
    venueName: venueName,
    neutralSite: neutralSite,
    homeTeam: homeTeam,
    awayTeam: awayTeam,
    status: status ?? this.status,
    homeScore: homeScore ?? this.homeScore,
    awayScore: awayScore ?? this.awayScore,
    winnerTeamId: winnerTeamId ?? this.winnerTeamId,
    providerLastUpdatedAt: providerLastUpdatedAt ?? this.providerLastUpdatedAt,
    lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
    manualOverride: manualOverride ?? this.manualOverride,
    manualOverrideReason: manualOverrideReason ?? this.manualOverrideReason,
    manualOverrideBy: manualOverrideBy ?? this.manualOverrideBy,
    resultVersion: resultVersion ?? this.resultVersion,
    resultVersionToken: resultVersionToken ?? this.resultVersionToken,
    sourcePayloadHash: sourcePayloadHash ?? this.sourcePayloadHash,
    pickRevealCompletedAt: pickRevealCompletedAt ?? this.pickRevealCompletedAt,
  );
}
