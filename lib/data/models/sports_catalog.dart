import 'game.dart';

enum CatalogDateMode { today, tomorrow, later, allDates, custom }

enum CatalogAvailabilityState {
  available,
  noGames,
  offSeason,
  providerNotConfigured,
  providerConfigurationRequired,
  providerUnavailable,
  quotaDelayed,
  unauthorized,
  unknown,
}

final class CatalogSport {
  const CatalogSport({required this.code, required this.displayName});

  final String code;
  final String displayName;
}

final class CatalogLeague {
  const CatalogLeague({
    required this.code,
    required this.displayName,
    required this.sportCode,
    required this.providerLeagueId,
    required this.season,
    this.provider,
    this.seasonType,
    this.week,
    this.division,
  });

  final String code;
  final String displayName;
  final String sportCode;
  final String providerLeagueId;
  final String season;
  final String? provider;
  final String? seasonType;
  final int? week;
  final String? division;
}

/// Server-owned discovery metadata for the CBS college-football catalog.
///
/// This travels with the effective query snapshot so the catalog screen can
/// render bounded controls without duplicating provider configuration in the
/// client. Only the selected season/type/week/division are sent back to the
/// server.
final class CollegeFootballCatalogMetadata {
  const CollegeFootballCatalogMetadata({
    required this.activeSeason,
    required this.activeSeasonType,
    required this.activeWeek,
    required this.division,
    required this.seasons,
    required this.seasonTypes,
    required this.minimumWeek,
    required this.maximumWeek,
  });

  final int activeSeason;
  final String activeSeasonType;
  final int activeWeek;
  final String division;
  final List<int> seasons;
  final List<String> seasonTypes;
  final int minimumWeek;
  final int maximumWeek;
}

final class CatalogPresentation {
  const CatalogPresentation({
    required this.provider,
    required this.attributionText,
    required this.allowRemoteLogos,
    required this.allowedLogoHosts,
    required this.allowedLogoQueryParameters,
    required this.logoRightsReviewDate,
    this.attributionUrl,
  });

  const CatalogPresentation.disabled({
    this.provider = '',
    this.attributionText = '',
    this.attributionUrl,
  }) : allowRemoteLogos = false,
       allowedLogoHosts = const <String>{},
       allowedLogoQueryParameters = const <String>{},
       logoRightsReviewDate = null;

  final String provider;
  final String attributionText;
  final Uri? attributionUrl;
  final bool allowRemoteLogos;
  final Set<String> allowedLogoHosts;
  final Set<String> allowedLogoQueryParameters;
  final DateTime? logoRightsReviewDate;

  /// Provider access and a URL alone are not enough to display a remote mark.
  ///
  /// Presentation metadata is usable only for games from the exact provider
  /// reviewed by the server. The UI's fail-closed URL policy still validates
  /// HTTPS, the exact host, and query parameters.
  bool permitsRemoteLogosForProvider(String gameProvider) =>
      allowRemoteLogos &&
      logoRightsReviewDate != null &&
      allowedLogoHosts.isNotEmpty &&
      provider.trim().isNotEmpty &&
      provider == gameProvider;
}

final class CatalogAvailability {
  const CatalogAvailability({required this.state, this.message});

  const CatalogAvailability.unknown()
    : state = CatalogAvailabilityState.unknown,
      message = null;

  final CatalogAvailabilityState state;
  final String? message;
}

final class CatalogCacheMetadata {
  const CatalogCacheMetadata({
    required this.hit,
    required this.stale,
    required this.delayed,
    required this.cachedAt,
    required this.expiresAt,
  });

  final bool hit;
  final bool stale;
  final bool delayed;
  final DateTime? cachedAt;
  final DateTime? expiresAt;
}

final class CatalogQuerySnapshot {
  const CatalogQuerySnapshot({
    required this.sportCode,
    required this.leagueCode,
    required this.providerLeagueId,
    required this.season,
    required this.from,
    required this.to,
    required this.timezone,
    this.seasonType,
    this.week,
    this.division,
    this.collegeFootball,
    this.dateMode = CatalogDateMode.allDates,
    this.weekStartAt,
    this.weekEndAt,
  });

  final String sportCode;
  final String leagueCode;
  final String providerLeagueId;
  final String season;
  final String? seasonType;
  final int? week;
  final String? division;
  final CollegeFootballCatalogMetadata? collegeFootball;
  final DateTime from;
  final DateTime to;
  final String timezone;
  final CatalogDateMode dateMode;
  final DateTime? weekStartAt;
  final DateTime? weekEndAt;

  CatalogQuery toQuery({bool forceRefresh = false}) => CatalogQuery(
    sportCode: sportCode,
    leagueCode: leagueCode,
    providerLeagueId: providerLeagueId,
    season: season,
    seasonType: seasonType,
    week: week,
    division: division,
    collegeFootball: collegeFootball,
    from: from,
    to: to,
    timezone: timezone,
    dateMode: dateMode,
    weekStartAt: weekStartAt,
    weekEndAt: weekEndAt,
    forceRefresh: forceRefresh,
  );
}

final class CatalogQuery {
  const CatalogQuery({
    required this.sportCode,
    required this.leagueCode,
    required this.providerLeagueId,
    required this.season,
    required this.from,
    required this.to,
    this.timezone = 'UTC',
    this.seasonType,
    this.week,
    this.division,
    this.collegeFootball,
    this.dateMode = CatalogDateMode.allDates,
    this.weekStartAt,
    this.weekEndAt,
    this.forceRefresh = false,
  });

  final String sportCode;
  final String leagueCode;
  final String providerLeagueId;
  final String season;
  final String? seasonType;
  final int? week;
  final String? division;

  /// Discovery-only bounds retained locally with the effective query.
  /// Repository serialization deliberately sends only the selected scalar
  /// fields above.
  final CollegeFootballCatalogMetadata? collegeFootball;
  final DateTime from;
  final DateTime to;
  final String timezone;
  final CatalogDateMode dateMode;
  final DateTime? weekStartAt;
  final DateTime? weekEndAt;
  final bool forceRefresh;

  CatalogQuerySnapshot get snapshot => CatalogQuerySnapshot(
    sportCode: sportCode,
    leagueCode: leagueCode,
    providerLeagueId: providerLeagueId,
    season: season,
    seasonType: seasonType,
    week: week,
    division: division,
    collegeFootball: collegeFootball,
    from: from,
    to: to,
    timezone: timezone,
    dateMode: dateMode,
    weekStartAt: weekStartAt,
    weekEndAt: weekEndAt,
  );

  CatalogQuery copyWith({
    String? sportCode,
    String? leagueCode,
    String? providerLeagueId,
    String? season,
    String? seasonType,
    int? week,
    String? division,
    CollegeFootballCatalogMetadata? collegeFootball,
    DateTime? from,
    DateTime? to,
    String? timezone,
    CatalogDateMode? dateMode,
    DateTime? weekStartAt,
    DateTime? weekEndAt,
    bool? forceRefresh,
  }) => CatalogQuery(
    sportCode: sportCode ?? this.sportCode,
    leagueCode: leagueCode ?? this.leagueCode,
    providerLeagueId: providerLeagueId ?? this.providerLeagueId,
    season: season ?? this.season,
    seasonType: seasonType ?? this.seasonType,
    week: week ?? this.week,
    division: division ?? this.division,
    collegeFootball: collegeFootball ?? this.collegeFootball,
    from: from ?? this.from,
    to: to ?? this.to,
    timezone: timezone ?? this.timezone,
    dateMode: dateMode ?? this.dateMode,
    weekStartAt: weekStartAt ?? this.weekStartAt,
    weekEndAt: weekEndAt ?? this.weekEndAt,
    forceRefresh: forceRefresh ?? this.forceRefresh,
  );

  bool sameVisibleQuery(CatalogQuery other) =>
      sportCode == other.sportCode &&
      leagueCode == other.leagueCode &&
      providerLeagueId == other.providerLeagueId &&
      season == other.season &&
      seasonType == other.seasonType &&
      week == other.week &&
      division == other.division &&
      _sameInstant(from, other.from) &&
      _sameInstant(to, other.to) &&
      timezone == other.timezone &&
      dateMode == other.dateMode &&
      _sameNullableInstant(weekStartAt, other.weekStartAt) &&
      _sameNullableInstant(weekEndAt, other.weekEndAt);
}

final class SportsCatalogResult {
  const SportsCatalogResult({
    required this.provider,
    required this.games,
    required this.cacheHit,
    required this.stale,
    required this.delayed,
    required this.cachedAt,
    this.expiresAt,
    this.supportedSports = const <CatalogSport>[],
    this.supportedLeagues = const <CatalogLeague>[],
    this.presentation = const CatalogPresentation.disabled(),
    this.effectiveQuery,
    this.availability = const CatalogAvailability.unknown(),
    this.collegeFootball,
    this.weekStartAt,
    this.weekEndAt,
  });

  final String provider;
  final List<CatalogSport> supportedSports;
  final List<CatalogLeague> supportedLeagues;
  final List<Game> games;
  final bool cacheHit;
  final bool stale;
  final bool delayed;
  final DateTime? cachedAt;
  final DateTime? expiresAt;
  final CatalogPresentation presentation;
  final CatalogQuerySnapshot? effectiveQuery;
  final CatalogAvailability availability;
  final CollegeFootballCatalogMetadata? collegeFootball;
  final DateTime? weekStartAt;
  final DateTime? weekEndAt;

  CatalogCacheMetadata get cache => CatalogCacheMetadata(
    hit: cacheHit,
    stale: stale,
    delayed: delayed,
    cachedAt: cachedAt,
    expiresAt: expiresAt,
  );
}

bool _sameInstant(DateTime left, DateTime right) =>
    left.toUtc().microsecondsSinceEpoch == right.toUtc().microsecondsSinceEpoch;

bool _sameNullableInstant(DateTime? left, DateTime? right) =>
    left == null || right == null ? left == right : _sameInstant(left, right);
