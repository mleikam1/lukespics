import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/domain/game_presentation.dart';
import '../../core/domain/league_time.dart';
import '../../core/responsive/breakpoints.dart';
import '../../core/widgets/catalog_logo_policy.dart';
import '../../core/widgets/ui.dart';
import '../../data/demo/demo_repository.dart';
import '../../data/models/game.dart';
import '../../data/models/sports_catalog.dart';
import 'catalog_date_window.dart';

class CatalogScreen extends ConsumerStatefulWidget {
  const CatalogScreen({super.key});

  @override
  ConsumerState<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends ConsumerState<CatalogScreen> {
  final _searchController = TextEditingController();
  String? _selectedSportCode;
  String? _selectedLeagueCode;
  String? _selectedCollegeFootballSeason;
  String? _selectedCollegeFootballSeasonType;
  int? _selectedCollegeFootballWeek;
  CatalogDateMode _dateMode = CatalogDateMode.allDates;
  DateTimeRange? _customDateRange;
  bool _hasLocalQuerySelection = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(appControllerProvider).loadCatalog();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = ref.watch(appControllerProvider);
    final selectedSportCode = _resolvedSportCode(controller);
    final leagues = controller.catalogLeagues
        .where((league) => league.sportCode == selectedSportCode)
        .toList(growable: false);
    final selectedLeague = _resolvedLeague(controller, leagues);
    final games = _search(controller.catalogGames);
    final activeQuery = controller.activeCatalogQuery;
    final isCollegeFootball =
        selectedLeague != null && _isCbsCollegeFootball(selectedLeague);
    final selectedProvider = selectedLeague == null
        ? controller.catalogProvider
        : _providerForLeague(controller, selectedLeague);
    final selectedCollegeFootballSeason = isCollegeFootball
        ? _collegeFootballSeason(activeQuery, selectedLeague)
        : null;
    final selectedCollegeFootballSeasonType = isCollegeFootball
        ? _collegeFootballSeasonType(activeQuery, selectedLeague)
        : null;
    final selectedCollegeFootballWeek = isCollegeFootball
        ? _collegeFootballWeek(activeQuery, selectedLeague)
        : null;
    final visibleDateMode = _hasLocalQuerySelection
        ? _dateMode
        : activeQuery?.dateMode ?? _dateMode;
    final visibleCustomRange = _hasLocalQuerySelection
        ? _customDateRange
        : activeQuery?.dateMode == CatalogDateMode.custom
        ? DateTimeRange(start: activeQuery!.from, end: activeQuery.to)
        : _customDateRange;
    final visibleDateWindow = _dateWindow(
      controller,
      mode: visibleDateMode,
      customDateRange: visibleCustomRange,
      provider: selectedProvider,
    );
    final hasDateWindow = visibleDateWindow != null;

    if (controller.slatePublished) {
      return ListView(
        padding: AppBreakpoints.pagePadding(context),
        children: [
          PageHeader(
            eyebrow: '${controller.weekLabel} · Published slate',
            title: 'This slate is read-only',
            description:
                'The slate has already been published. Games can no longer '
                'be added, removed, or replaced.',
          ),
          const SizedBox(height: 24),
          EmptyState(
            icon: Icons.lock_rounded,
            title: 'Slate editing is closed',
            message:
                'Open Make picks or Results to continue with the published '
                'week.',
            action: FilledButton(
              onPressed: () => context.go('/dashboard'),
              child: const Text('Back to dashboard'),
            ),
          ),
        ],
      );
    }

    final compactLayout = MediaQuery.sizeOf(context).width < 600;
    // College football adds season, season-type, and week controls above the
    // results. On laptop-height desktop windows those controls can otherwise
    // consume the entire Column and leave the Expanded game list with no
    // usable viewport. Let the complete CBS picker surface scroll as one unit.
    final scrollableLayout = compactLayout || isCollegeFootball;
    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PageHeader(
          eyebrow: '${controller.weekLabel} · Weekly picker tools',
          title: 'Build the ${controller.weekLabel} slate',
          description:
              'You’re this week’s picker. Choose at least one open game; '
              'there is no maximum.',
          action: StatusPill(
            label: _providerStatus(controller),
            icon: controller.catalogLoading
                ? Icons.sync_rounded
                : controller.catalogDelayed
                ? Icons.schedule_rounded
                : controller.catalogStale
                ? Icons.cloud_off_rounded
                : Icons.cloud_done_outlined,
            tone:
                controller.catalogDelayed ||
                    controller.catalogStale ||
                    controller.catalogAvailability.state !=
                        CatalogAvailabilityState.available
                ? StatusTone.warning
                : StatusTone.success,
          ),
        ),
        const SizedBox(height: 20),
        if (controller.canDraftSlate && !controller.slatePublished) ...[
          Wrap(
            alignment: WrapAlignment.end,
            spacing: 10,
            runSpacing: 10,
            children: [
              OutlinedButton.icon(
                key: const Key('refresh-catalog-button'),
                onPressed: controller.catalogLoading
                    ? null
                    : () => controller.loadCatalog(
                        query: controller.activeCatalogQuery?.copyWith(
                          forceRefresh: true,
                        ),
                        forceRefresh: true,
                      ),
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Refresh schedule'),
              ),
              OutlinedButton.icon(
                onPressed: () => _showManualGameDialog(context, controller),
                icon: const Icon(Icons.add_circle_outline_rounded),
                label: const Text('Add manual game'),
              ),
            ],
          ),
          if (controller.catalogCachedAt != null) ...[
            const SizedBox(height: 8),
            Text(
              'Last updated: '
              '${formatLeagueTime(controller.catalogCachedAt!, controller.leagueTimezone, 'MMM d, h:mm a')}',
              textAlign: TextAlign.right,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
          const SizedBox(height: 14),
        ],
        if (controller.catalogError != null && games.isNotEmpty) ...[
          SectionCard(
            color: Theme.of(context).colorScheme.errorContainer,
            child: Row(
              children: [
                const Icon(Icons.error_outline_rounded),
                const SizedBox(width: 12),
                Expanded(child: Text(controller.catalogError!)),
                TextButton(
                  onPressed: controller.catalogLoading
                      ? null
                      : () => controller.loadCatalog(
                          query: controller.activeCatalogQuery,
                        ),
                  child: const Text('Retry'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
        ],
        if (controller.catalogSports.isNotEmpty) ...[
          TextField(
            key: const Key('catalog-team-search'),
            controller: _searchController,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: 'Search teams in these results',
              hintText: 'Try a team name',
              prefixIcon: const Icon(Icons.search_rounded),
              suffixIcon: _searchController.text.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'Clear search',
                      onPressed: () {
                        _searchController.clear();
                        setState(() {});
                      },
                      icon: const Icon(Icons.close_rounded),
                    ),
            ),
          ),
          const SizedBox(height: 14),
          _FilterRow(
            keyPrefix: 'sport-filter',
            choices: [
              for (final sport in controller.catalogSports)
                _FilterChoice(id: sport.code, label: sport.displayName),
            ],
            selectedId: selectedSportCode,
            onSelected: (sportCode) {
              final matchingLeagues = controller.catalogLeagues
                  .where((league) => league.sportCode == sportCode)
                  .toList(growable: false);
              if (matchingLeagues.isEmpty) return;
              unawaited(
                _requestCatalog(
                  controller,
                  sportCode: sportCode,
                  league: matchingLeagues.first,
                  dateMode: visibleDateMode,
                ),
              );
            },
          ),
          if (leagues.isNotEmpty) ...[
            const SizedBox(height: 10),
            _FilterRow(
              keyPrefix: 'league-filter',
              choices: [
                for (final league in leagues)
                  _FilterChoice(id: league.code, label: league.displayName),
              ],
              selectedId: selectedLeague?.code,
              onSelected: (leagueCode) {
                final league = leagues.firstWhere(
                  (candidate) => candidate.code == leagueCode,
                );
                unawaited(
                  _requestCatalog(
                    controller,
                    sportCode: league.sportCode,
                    league: league,
                    dateMode: visibleDateMode,
                  ),
                );
              },
            ),
          ],
          if (isCollegeFootball) ...[
            const SizedBox(height: 16),
            Text(
              'Choose season',
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const SizedBox(height: 8),
            _FilterRow(
              keyPrefix: 'cbs-season-filter',
              choices: [
                for (final season in _collegeFootballSeasons(
                  activeQuery,
                  selectedLeague,
                ))
                  _FilterChoice(id: season, label: season),
              ],
              selectedId: selectedCollegeFootballSeason,
              onSelected: (season) => unawaited(
                _requestCatalog(
                  controller,
                  sportCode: selectedLeague.sportCode,
                  league: selectedLeague,
                  dateMode: visibleDateMode,
                  season: season,
                ),
              ),
            ),
            const SizedBox(height: 12),
            Text('Season type', style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 8),
            _FilterRow(
              keyPrefix: 'cbs-season-type-filter',
              choices: [
                for (final seasonType in _collegeFootballSeasonTypes(
                  activeQuery,
                  selectedLeague,
                ))
                  _FilterChoice(
                    id: seasonType,
                    label: seasonType == 'postseason'
                        ? 'Postseason'
                        : 'Regular season',
                  ),
              ],
              selectedId: selectedCollegeFootballSeasonType,
              onSelected: (seasonType) => unawaited(
                _requestCatalog(
                  controller,
                  sportCode: selectedLeague.sportCode,
                  league: selectedLeague,
                  dateMode: visibleDateMode,
                  seasonType: seasonType,
                ),
              ),
            ),
            const SizedBox(height: 12),
            Text('Choose week', style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 8),
            _FilterRow(
              keyPrefix: 'cbs-week-filter',
              choices: [
                for (final week in _collegeFootballWeeks(
                  activeQuery,
                  selectedLeague,
                ))
                  _FilterChoice(id: '$week', label: 'Week $week'),
              ],
              selectedId: selectedCollegeFootballWeek == null
                  ? null
                  : '$selectedCollegeFootballWeek',
              onSelected: (week) => unawaited(
                _requestCatalog(
                  controller,
                  sportCode: selectedLeague.sportCode,
                  league: selectedLeague,
                  dateMode: visibleDateMode,
                  week: int.parse(week),
                ),
              ),
            ),
          ],
          const SizedBox(height: 10),
          _FilterRow(
            keyPrefix: 'date-filter',
            choices: const [
              _FilterChoice(id: 'today', label: 'Today'),
              _FilterChoice(id: 'tomorrow', label: 'Tomorrow'),
              _FilterChoice(id: 'later', label: 'Later'),
              _FilterChoice(id: 'allDates', label: 'All dates'),
            ],
            selectedId: visibleDateMode.name,
            onSelected: (value) {
              if (selectedLeague == null) return;
              final mode = CatalogDateMode.values.firstWhere(
                (candidate) => candidate.name == value,
              );
              unawaited(
                _requestCatalog(
                  controller,
                  sportCode: selectedLeague.sportCode,
                  league: selectedLeague,
                  dateMode: mode,
                ),
              );
            },
          ),
          const SizedBox(height: 6),
          Align(
            alignment: Alignment.centerLeft,
            child: Wrap(
              spacing: 10,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (selectedLeague != null && visibleDateWindow != null)
                  _SingleDayNavigator(
                    date: visibleDateWindow.from,
                    previousDate: _steppedDate(
                      controller,
                      visibleDateWindow.from,
                      -1,
                      provider: selectedProvider,
                    ),
                    nextDate: _steppedDate(
                      controller,
                      visibleDateWindow.from,
                      1,
                      provider: selectedProvider,
                    ),
                    loading: controller.catalogLoading,
                    onSelectDate: (date) => unawaited(
                      _requestSingleDayCatalog(
                        controller,
                        league: selectedLeague,
                        date: date,
                      ),
                    ),
                  ),
                TextButton.icon(
                  key: const Key('custom-date-range-button'),
                  onPressed: selectedLeague == null
                      ? null
                      : () => _chooseDateRange(
                          context,
                          controller,
                          selectedLeague,
                        ),
                  icon: const Icon(Icons.date_range_rounded),
                  label: Text(
                    visibleCustomRange == null
                        ? 'Choose date range'
                        : _isSameCalendarDate(
                            visibleCustomRange.start,
                            visibleCustomRange.end,
                          )
                        ? DateFormat('MMM d').format(visibleCustomRange.start)
                        : '${DateFormat('MMM d').format(visibleCustomRange.start)} – '
                              '${DateFormat('MMM d').format(visibleCustomRange.end)}',
                  ),
                ),
                Text(
                  'Up to 7 days within ${controller.weekLabel}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 14),
        if (controller.catalogLoading && games.isNotEmpty) ...[
          const _CatalogRefreshingIndicator(),
          const SizedBox(height: 12),
        ],
        if ((controller.catalogStale || controller.catalogDelayed) &&
            games.isNotEmpty) ...[
          _CatalogWarning(controller: controller),
          const SizedBox(height: 12),
        ],
        if (scrollableLayout)
          _catalogResults(
            controller: controller,
            selectedLeague: selectedLeague,
            games: games,
            hasDateWindow: hasDateWindow,
            compactLayout: true,
            groupByDate: isCollegeFootball,
          )
        else
          Expanded(
            child: _catalogResults(
              controller: controller,
              selectedLeague: selectedLeague,
              games: games,
              hasDateWindow: hasDateWindow,
              compactLayout: false,
              groupByDate: isCollegeFootball,
            ),
          ),
        if (controller.catalogPresentation.attributionText.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(
            controller.catalogPresentation.attributionText,
            textAlign: TextAlign.right,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
        const SizedBox(height: 14),
        _SelectionBar(controller: controller),
      ],
    );
    return Padding(
      padding: AppBreakpoints.pagePadding(context),
      child: scrollableLayout ? SingleChildScrollView(child: content) : content,
    );
  }

  Widget _catalogResults({
    required AppController controller,
    required CatalogLeague? selectedLeague,
    required List<Game> games,
    required bool hasDateWindow,
    required bool compactLayout,
    required bool groupByDate,
  }) {
    if (controller.catalogLoading && games.isEmpty) {
      return _CatalogLoading(
        leagueName:
            selectedLeague?.displayName ??
            controller.activeCatalogQuery?.leagueCode.toUpperCase() ??
            'sports',
      );
    }
    if (!hasDateWindow && controller.catalogSports.isNotEmpty) {
      return const EmptyState(
        icon: Icons.event_busy_rounded,
        title: 'This date is outside the active week',
        message: 'Choose another date within the current weekly slate.',
      );
    }
    if (games.isEmpty) {
      return _CatalogEmptyState(
        controller: controller,
        leagueName: selectedLeague?.displayName ?? 'This league',
        searchActive: _searchController.text.trim().isNotEmpty,
      );
    }
    final items = <Widget>[];
    void addGame(Game game) {
      // Kickoff confirmation creates a manually verified game, so keep this
      // escape hatch available when the provider is serving last-known-good
      // cached matchups. The picker still has to enter a trusted future time.
      final canConfirmKickoff =
          !controller.selectedGameIds.contains(game.id) &&
          (game.timeTbd || game.scheduledAtUtc == null) &&
          (game.status == GameStatus.scheduled ||
              game.status == GameStatus.delayed);
      items.add(
        _CatalogGameCard(
          game: game,
          selected: controller.selectedGameIds.contains(game.id),
          enabled:
              controller.selectedGameIds.contains(game.id) ||
              (!controller.catalogStale &&
                  controller.isCatalogGameSelectable(game)),
          disabledReason: _disabledReason(controller, game),
          logoPolicy: catalogTeamLogoPolicy(
            presentation: controller.catalogPresentation,
            game: game,
          ),
          leagueTimezone: groupByDate ? controller.leagueTimezone : null,
          onChanged: () => controller.toggleSlateGame(game.id),
          onConfirmKickoff: canConfirmKickoff
              ? () =>
                    _showManualGameDialog(context, controller, sourceGame: game)
              : null,
        ),
      );
    }

    if (groupByDate) {
      final gamesByDate = <String, List<Game>>{};
      final labelsByDate = <String, String>{};
      for (final game in games) {
        final heading = _catalogDateHeading(game, controller.leagueTimezone);
        gamesByDate.putIfAbsent(heading.$1, () => <Game>[]).add(game);
        labelsByDate[heading.$1] = heading.$2;
      }
      final dates = gamesByDate.keys.toList(growable: false)..sort();
      for (final date in dates) {
        items.add(
          _CatalogDateHeader(
            key: Key('catalog-date-header-$date'),
            label: labelsByDate[date]!,
          ),
        );
        for (final game in gamesByDate[date]!) {
          addGame(game);
        }
      }
    } else {
      for (final game in games) {
        addGame(game);
      }
    }
    return ListView.separated(
      key: const Key('catalog-game-list'),
      shrinkWrap: compactLayout,
      physics: compactLayout ? const NeverScrollableScrollPhysics() : null,
      itemCount: items.length,
      separatorBuilder: (context, index) => const SizedBox(height: 12),
      itemBuilder: (context, index) => items[index],
    );
  }

  List<Game> _search(List<Game> source) {
    final query = _searchController.text.trim().toLowerCase();
    return source.where((game) {
      if (query.isNotEmpty &&
          !game.homeTeam.name.toLowerCase().contains(query) &&
          !game.homeTeam.abbreviation.toLowerCase().contains(query) &&
          !game.awayTeam.name.toLowerCase().contains(query) &&
          !game.awayTeam.abbreviation.toLowerCase().contains(query)) {
        return false;
      }
      return true;
    }).toList()..sort(_compareCatalogGames);
  }

  int _compareCatalogGames(Game left, Game right) {
    final leftTime = left.scheduledAtUtc;
    final rightTime = right.scheduledAtUtc;
    if (leftTime != null && rightTime != null) {
      final byTime = leftTime.compareTo(rightTime);
      return byTime == 0 ? left.id.compareTo(right.id) : byTime;
    }
    if (leftTime != null) return -1;
    if (rightTime != null) return 1;
    final byDay = (left.scheduledDayEastern ?? '').compareTo(
      right.scheduledDayEastern ?? '',
    );
    return byDay == 0 ? left.id.compareTo(right.id) : byDay;
  }

  String? _resolvedSportCode(AppController controller) {
    final available = controller.catalogSports
        .map((sport) => sport.code)
        .toSet();
    if (available.contains(_selectedSportCode)) return _selectedSportCode;
    final effective = controller.activeCatalogQuery?.sportCode;
    if (available.contains(effective)) return effective;
    return controller.catalogSports.isEmpty
        ? null
        : controller.catalogSports.first.code;
  }

  CatalogLeague? _resolvedLeague(
    AppController controller,
    List<CatalogLeague> leagues,
  ) {
    if (leagues.isEmpty) return null;
    for (final league in leagues) {
      if (league.code == _selectedLeagueCode) return league;
    }
    final effective = controller.activeCatalogQuery?.leagueCode;
    for (final league in leagues) {
      if (league.code == effective) return league;
    }
    return leagues.first;
  }

  bool _isCbsCollegeFootball(CatalogLeague league) {
    if (league.provider != null) return league.provider == 'cbsSports';
    final sport = league.sportCode.toLowerCase();
    return league.code.toLowerCase() == 'ncaaf' ||
        sport == 'ncaaf' ||
        sport == 'college-football' ||
        sport == 'college_football';
  }

  String _providerForLeague(AppController controller, CatalogLeague league) =>
      league.provider ??
      (_isCbsCollegeFootball(league)
          ? 'cbsSports'
          : controller.catalogProvider);

  String _collegeFootballSeason(
    CatalogQuery? activeQuery,
    CatalogLeague league,
  ) =>
      _selectedCollegeFootballSeason ??
      (activeQuery?.leagueCode == league.code ? activeQuery?.season : null) ??
      league.season;

  String _collegeFootballSeasonType(
    CatalogQuery? activeQuery,
    CatalogLeague league,
  ) =>
      _selectedCollegeFootballSeasonType ??
      (activeQuery?.leagueCode == league.code
          ? activeQuery?.seasonType
          : null) ??
      league.seasonType ??
      activeQuery?.collegeFootball?.activeSeasonType ??
      'regular';

  int _collegeFootballWeek(CatalogQuery? activeQuery, CatalogLeague league) =>
      _selectedCollegeFootballWeek ??
      (activeQuery?.leagueCode == league.code ? activeQuery?.week : null) ??
      league.week ??
      activeQuery?.collegeFootball?.activeWeek ??
      1;

  List<String> _collegeFootballSeasons(
    CatalogQuery? activeQuery,
    CatalogLeague league,
  ) {
    final seasons = <String>{
      for (final season
          in activeQuery?.collegeFootball?.seasons ?? const <int>[])
        '$season',
      _collegeFootballSeason(activeQuery, league),
    }.toList(growable: false);
    seasons.sort((left, right) => right.compareTo(left));
    return seasons;
  }

  List<String> _collegeFootballSeasonTypes(
    CatalogQuery? activeQuery,
    CatalogLeague league,
  ) {
    final configuredTypes = activeQuery?.collegeFootball?.seasonTypes;
    final types = <String>{
      ...?configuredTypes,
      _collegeFootballSeasonType(activeQuery, league),
    };
    final ordered = <String>[
      for (final type in const ['regular', 'postseason'])
        if (types.contains(type)) type,
    ];
    return ordered;
  }

  Iterable<int> _collegeFootballWeeks(
    CatalogQuery? activeQuery,
    CatalogLeague league,
  ) sync* {
    final metadata = activeQuery?.collegeFootball;
    final configuredWeek = _collegeFootballWeek(activeQuery, league);
    final minimum = metadata?.minimumWeek ?? configuredWeek;
    final maximum = metadata?.maximumWeek ?? configuredWeek;
    for (var week = minimum; week <= maximum; week += 1) {
      yield week;
    }
  }

  CatalogDateWindow? _dateWindow(
    AppController controller, {
    CatalogDateMode? mode,
    DateTimeRange? customDateRange,
    String? provider,
  }) {
    final weekStartAt = controller.weekStartAt;
    final weekEndAt = controller.weekEndAt;
    if (weekStartAt == null || weekEndAt == null) return null;
    final queryTimezone = catalogQueryTimezone(
      provider: provider ?? controller.catalogProvider,
      arenaTimezone: controller.leagueTimezone,
    );
    return catalogDateWindow(
      mode: mode ?? _dateMode,
      nowUtc: DateTime.now().toUtc(),
      timezone: queryTimezone,
      weekStartAt: weekStartAt,
      weekEndAt: weekEndAt,
      customFrom: (customDateRange ?? _customDateRange)?.start,
      customTo: (customDateRange ?? _customDateRange)?.end,
    );
  }

  DateTime? _steppedDate(
    AppController controller,
    DateTime currentDate,
    int dayDelta, {
    required String provider,
  }) {
    final weekStartAt = controller.weekStartAt;
    final weekEndAt = controller.weekEndAt;
    if (weekStartAt == null || weekEndAt == null) return null;
    final queryTimezone = catalogQueryTimezone(
      provider: provider,
      arenaTimezone: controller.leagueTimezone,
    );
    return catalogSteppedDate(
      currentDate: currentDate,
      dayDelta: dayDelta,
      timezone: queryTimezone,
      weekStartAt: weekStartAt,
      weekEndAt: weekEndAt,
    );
  }

  Future<void> _requestSingleDayCatalog(
    AppController controller, {
    required CatalogLeague league,
    required DateTime date,
  }) async {
    setState(() {
      _customDateRange = DateTimeRange(start: date, end: date);
    });
    await _requestCatalog(
      controller,
      sportCode: league.sportCode,
      league: league,
      dateMode: CatalogDateMode.custom,
    );
  }

  Future<void> _requestCatalog(
    AppController controller, {
    required String sportCode,
    required CatalogLeague league,
    required CatalogDateMode dateMode,
    String? season,
    String? seasonType,
    int? week,
  }) async {
    final isCollegeFootball = _isCbsCollegeFootball(league);
    final targetProvider = _providerForLeague(controller, league);
    final activeQuery = controller.activeCatalogQuery;
    final requestedCustomRange = dateMode == CatalogDateMode.custom
        ? _customDateRange ??
              (activeQuery?.dateMode == CatalogDateMode.custom
                  ? DateTimeRange(start: activeQuery!.from, end: activeQuery.to)
                  : null)
        : null;
    final selectedSeason = isCollegeFootball
        ? season ?? _collegeFootballSeason(activeQuery, league)
        : league.season;
    final selectedSeasonType = isCollegeFootball
        ? seasonType ?? _collegeFootballSeasonType(activeQuery, league)
        : null;
    final selectedWeek = isCollegeFootball
        ? week ?? _collegeFootballWeek(activeQuery, league)
        : null;
    final selectedDivision = isCollegeFootball
        ? (activeQuery?.leagueCode == league.code
                  ? activeQuery?.division
                  : null) ??
              league.division ??
              activeQuery?.collegeFootball?.division ??
              'FBS'
        : null;
    setState(() {
      _selectedSportCode = sportCode;
      _selectedLeagueCode = league.code;
      _selectedCollegeFootballSeason = isCollegeFootball
          ? selectedSeason
          : null;
      _selectedCollegeFootballSeasonType = isCollegeFootball
          ? selectedSeasonType
          : null;
      _selectedCollegeFootballWeek = isCollegeFootball ? selectedWeek : null;
      _dateMode = dateMode;
      _hasLocalQuerySelection = true;
      _customDateRange = requestedCustomRange;
    });
    final window = _dateWindow(
      controller,
      provider: targetProvider,
      customDateRange: requestedCustomRange,
    );
    final weekStartAt = controller.weekStartAt;
    final weekEndAt = controller.weekEndAt;
    if (window == null || weekStartAt == null || weekEndAt == null) return;
    if (dateMode == CatalogDateMode.custom && mounted) {
      setState(() {
        _customDateRange = DateTimeRange(start: window.from, end: window.to);
      });
    }
    await controller.loadCatalog(
      query: CatalogQuery(
        sportCode: sportCode,
        leagueCode: league.code,
        providerLeagueId: league.providerLeagueId,
        season: selectedSeason,
        seasonType: selectedSeasonType,
        week: selectedWeek,
        division: selectedDivision,
        collegeFootball: isCollegeFootball
            ? activeQuery?.collegeFootball
            : null,
        from: window.from,
        to: window.to,
        timezone: catalogQueryTimezone(
          provider: targetProvider,
          arenaTimezone: controller.leagueTimezone,
        ),
        dateMode: dateMode,
        weekStartAt: weekStartAt,
        weekEndAt: weekEndAt,
      ),
    );
  }

  Future<void> _chooseDateRange(
    BuildContext context,
    AppController controller,
    CatalogLeague league,
  ) async {
    final weekStartAt = controller.weekStartAt;
    final weekEndAt = controller.weekEndAt;
    if (weekStartAt == null || weekEndAt == null) return;
    final queryTimezone = catalogQueryTimezone(
      provider: _providerForLeague(controller, league),
      arenaTimezone: controller.leagueTimezone,
    );
    final first = catalogCalendarDate(weekStartAt, queryTimezone);
    final last = catalogCalendarDate(weekEndAt, queryTimezone);
    if (last.isBefore(first)) return;
    final activeQuery = controller.activeCatalogQuery;
    final initialRange =
        _customDateRange ??
        (activeQuery?.dateMode == CatalogDateMode.custom
            ? DateTimeRange(start: activeQuery!.from, end: activeQuery.to)
            : null);
    final validInitialRange =
        initialRange != null &&
            !initialRange.start.isBefore(first) &&
            !initialRange.end.isAfter(last)
        ? initialRange
        : null;
    final range = await showDateRangePicker(
      context: context,
      firstDate: DateTime(first.year, first.month, first.day),
      lastDate: DateTime(last.year, last.month, last.day),
      initialDateRange: validInitialRange,
      helpText: 'Choose up to 7 days in ${controller.weekLabel}',
    );
    if (range != null && mounted) {
      setState(() {
        _customDateRange = range;
        _dateMode = CatalogDateMode.custom;
      });
      await _requestCatalog(
        controller,
        sportCode: league.sportCode,
        league: league,
        dateMode: CatalogDateMode.custom,
      );
    }
  }

  String _providerStatus(AppController controller) {
    if (controller.catalogLoading) {
      return controller.catalogGames.isEmpty
          ? 'Loading cached schedule'
          : 'Refreshing schedule';
    }
    if (controller.isDemo) return 'Explicit demo schedule';
    if (controller.catalogProvider == 'theSportsDbTest') {
      return 'Internal test · TheSportsDB';
    }
    if (controller.catalogProvider == 'mock') {
      return 'Emulator fixture schedule';
    }
    if (controller.catalogStale) return 'Using cached schedule';
    if (controller.catalogDelayed) return 'Refresh delayed';
    if (controller.catalogProvider == 'manual') return 'Manual games';
    if (controller.catalogCacheHit) return 'Using cached schedule';
    if (controller.catalogProvider == 'unknown') return 'Schedule unavailable';
    return 'Schedule updated';
  }

  String? _disabledReason(AppController controller, Game game) {
    if (controller.selectedGameIds.contains(game.id)) return null;
    if (controller.catalogStale) {
      return 'Refresh this stale schedule before adding the game.';
    }
    final now = DateTime.now().toUtc();
    final expiresAt = controller.catalogExpiresAt;
    if (expiresAt != null && !expiresAt.isAfter(now)) {
      return 'This schedule has expired. Refresh it before adding the game.';
    }
    if (game.timeTbd || game.scheduledAtUtc == null) {
      return 'A confirmed start time is required before this game can be added.';
    }
    if (game.effectiveLockAtUtc == null) {
      return 'A confirmed pick deadline is required before this game can be added.';
    }
    if (game.selectable == false) {
      return game.selectionReason ??
          'This game is not available for selection.';
    }
    final scheduledAt = game.scheduledAtUtc!;
    final effectiveLockAt = game.effectiveLockAtUtc!;
    final weekStartAt = controller.weekStartAt;
    final weekEndAt = controller.weekEndAt;
    if ((weekStartAt != null && scheduledAt.isBefore(weekStartAt.toUtc())) ||
        (weekEndAt != null && scheduledAt.isAfter(weekEndAt.toUtc()))) {
      return 'This game is outside the active week.';
    }
    if (!scheduledAt.isAfter(now) || !effectiveLockAt.isAfter(now)) {
      return 'This game is already locked.';
    }
    return switch (game.status) {
      GameStatus.scheduled || GameStatus.delayed => null,
      GameStatus.live => 'This game is already live.',
      GameStatus.finalStatus => 'This game is final.',
      GameStatus.postponed => 'This game is postponed.',
      GameStatus.suspended => 'This game is suspended.',
      GameStatus.cancelled => 'This game is canceled.',
      GameStatus.voided => 'This game is void.',
      GameStatus.reviewRequired => 'This game requires provider review.',
    };
  }

  Future<void> _showManualGameDialog(
    BuildContext context,
    AppController controller, {
    Game? sourceGame,
  }) async {
    final home = TextEditingController(text: sourceGame?.homeTeam.name);
    final away = TextEditingController(text: sourceGame?.awayTeam.name);
    final league = TextEditingController(
      text: sourceGame?.leagueName ?? 'Community Sports',
    );
    final venue = TextEditingController(text: sourceGame?.venueName);
    final sourceDay = sourceGame?.scheduledDayEastern == null
        ? null
        : DateTime.tryParse('${sourceGame!.scheduledDayEastern}T12:00:00');
    var scheduledAt = sourceDay ?? DateTime.now().add(const Duration(days: 1));
    var kickoffConfirmed = sourceGame == null;
    String? validation;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: Text(
            sourceGame == null
                ? 'Add a manual game'
                : 'Confirm kickoff and add',
          ),
          content: SizedBox(
            width: 520,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    sourceGame == null
                        ? 'Use neutral team names for a schedule that does not '
                              'come from the configured provider.'
                        : 'CBS published this matchup without a trustworthy '
                              'server-side kickoff. Verify the start from a '
                              'trusted schedule; Luke’s Picks will use it as '
                              'the pick deadline.',
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: away,
                    decoration: const InputDecoration(labelText: 'Away team'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: home,
                    decoration: const InputDecoration(labelText: 'Home team'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: league,
                    decoration: const InputDecoration(
                      labelText: 'League or competition',
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: venue,
                    decoration: const InputDecoration(
                      labelText: 'Venue (optional)',
                    ),
                  ),
                  const SizedBox(height: 12),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.event_rounded),
                    title: const Text('Scheduled start'),
                    subtitle: Text(
                      sourceGame != null && !kickoffConfirmed
                          ? 'Tap to enter the verified kickoff'
                          : DateFormat(
                              'EEE, MMM d · h:mm a',
                            ).format(scheduledAt),
                    ),
                    trailing: const Icon(Icons.edit_calendar_rounded),
                    onTap: () async {
                      final date = await showDatePicker(
                        context: dialogContext,
                        firstDate: DateTime.now(),
                        lastDate: DateTime.now().add(const Duration(days: 730)),
                        initialDate: scheduledAt,
                      );
                      if (date == null || !dialogContext.mounted) return;
                      final time = await showTimePicker(
                        context: dialogContext,
                        initialTime: TimeOfDay.fromDateTime(scheduledAt),
                      );
                      if (time == null) return;
                      setDialogState(() {
                        scheduledAt = DateTime(
                          date.year,
                          date.month,
                          date.day,
                          time.hour,
                          time.minute,
                        );
                        kickoffConfirmed = true;
                        validation = null;
                      });
                    },
                  ),
                  if (validation != null)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        validation!,
                        style: TextStyle(
                          color: Theme.of(dialogContext).colorScheme.error,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () async {
                if (!kickoffConfirmed) {
                  setDialogState(
                    () => validation =
                        'Confirm the published kickoff date and time first.',
                  );
                  return;
                }
                final saved = await controller.addManualGame(
                  homeName: home.text,
                  awayName: away.text,
                  leagueName: league.text,
                  scheduledAt: scheduledAt,
                  sportCode: sourceGame?.sportCode ?? 'custom',
                  venueName: venue.text,
                );
                if (!dialogContext.mounted) return;
                if (saved) {
                  Navigator.pop(dialogContext);
                } else {
                  setDialogState(
                    () => validation =
                        controller.errorMessage ??
                        'Check the game details and try again.',
                  );
                }
              },
              child: const Text('Add to slate'),
            ),
          ],
        ),
      ),
    );
    home.dispose();
    away.dispose();
    league.dispose();
    venue.dispose();
  }
}

class _SingleDayNavigator extends StatelessWidget {
  const _SingleDayNavigator({
    required this.date,
    required this.previousDate,
    required this.nextDate,
    required this.loading,
    required this.onSelectDate,
  });

  final DateTime date;
  final DateTime? previousDate;
  final DateTime? nextDate;
  final bool loading;
  final ValueChanged<DateTime> onSelectDate;

  @override
  Widget build(BuildContext context) {
    final formattedDate = DateFormat('EEE, MMM d').format(date);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton.outlined(
          key: const Key('catalog-previous-day-button'),
          tooltip: 'Previous day',
          onPressed: loading || previousDate == null
              ? null
              : () => onSelectDate(previousDate!),
          icon: const Icon(Icons.chevron_left_rounded),
        ),
        const SizedBox(width: 10),
        Semantics(
          label: 'Single-day schedule for $formattedDate',
          child: Text(
            formattedDate,
            key: const Key('catalog-single-day-label'),
            style: Theme.of(context).textTheme.titleSmall,
          ),
        ),
        const SizedBox(width: 10),
        IconButton.outlined(
          key: const Key('catalog-next-day-button'),
          tooltip: 'Next day',
          onPressed: loading || nextDate == null
              ? null
              : () => onSelectDate(nextDate!),
          icon: const Icon(Icons.chevron_right_rounded),
        ),
      ],
    );
  }
}

bool _isSameCalendarDate(DateTime first, DateTime second) =>
    first.year == second.year &&
    first.month == second.month &&
    first.day == second.day;

class _FilterRow extends StatelessWidget {
  const _FilterRow({
    required this.keyPrefix,
    required this.choices,
    required this.selectedId,
    required this.onSelected,
  });

  final String keyPrefix;
  final List<_FilterChoice> choices;
  final String? selectedId;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final choice in choices) ...[
            ChoiceChip(
              key: Key('$keyPrefix-${choice.id}'),
              label: Text(choice.label),
              selected: selectedId == choice.id,
              onSelected: (_) => onSelected(choice.id),
            ),
            const SizedBox(width: 8),
          ],
        ],
      ),
    );
  }
}

final class _FilterChoice {
  const _FilterChoice({required this.id, required this.label});

  final String id;
  final String label;
}

class _CatalogRefreshingIndicator extends StatelessWidget {
  const _CatalogRefreshingIndicator();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      label: 'Refreshing schedule while cached games remain visible',
      child: Row(
        key: const Key('catalog-refreshing-indicator'),
        children: [
          const SizedBox.square(
            dimension: 18,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: 10),
          Text(
            'Refreshing schedule…',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}

class _CatalogDateHeader extends StatelessWidget {
  const _CatalogDateHeader({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      header: true,
      child: Text(
        label,
        style: Theme.of(
          context,
        ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w900),
      ),
    );
  }
}

class _CatalogLoading extends StatelessWidget {
  const _CatalogLoading({required this.leagueName});

  final String leagueName;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Semantics(
        liveRegion: true,
        label: 'Loading the $leagueName schedule',
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: 16),
            Text(
              'Loading the $leagueName schedule…',
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ],
        ),
      ),
    );
  }
}

class _CatalogWarning extends StatelessWidget {
  const _CatalogWarning({required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final stale = controller.catalogStale;
    return SectionCard(
      color: Theme.of(context).colorScheme.tertiaryContainer,
      padding: const EdgeInsets.all(14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(stale ? Icons.cloud_off_rounded : Icons.schedule_rounded),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              stale
                  ? 'Showing the most recently saved schedule. Games remain '
                        'visible, but cannot be added until a trusted refresh '
                        'succeeds.'
                  : 'Refresh is delayed by provider quota protection. The '
                        'existing cached schedule remains visible.',
            ),
          ),
        ],
      ),
    );
  }
}

class _CatalogEmptyState extends StatelessWidget {
  const _CatalogEmptyState({
    required this.controller,
    required this.leagueName,
    required this.searchActive,
  });

  final AppController controller;
  final String leagueName;
  final bool searchActive;

  @override
  Widget build(BuildContext context) {
    if (searchActive && controller.catalogGames.isNotEmpty) {
      return const EmptyState(
        icon: Icons.search_off_rounded,
        title: 'No teams match this search',
        message:
            'Search only checks the teams in the currently loaded schedule.',
      );
    }
    final (
      title,
      message,
      retry,
    ) = switch (controller.catalogAvailability.state) {
      CatalogAvailabilityState.noGames => (
        'No $leagueName games are scheduled for this date.',
        'Choose another date within the active week.',
        false,
      ),
      CatalogAvailabilityState.offSeason => (
        '$leagueName does not have games scheduled in this selected range.',
        'Choose another supported league or return during its season.',
        false,
      ),
      CatalogAvailabilityState.providerNotConfigured => (
        'Live sports data has not been configured.',
        'An authorized picker can still add a trustworthy manual game.',
        false,
      ),
      CatalogAvailabilityState.providerConfigurationRequired =>
        controller.canAdmin
            ? (
                'Live sports data needs administrator configuration.',
                'Have the Firebase project administrator verify the '
                    'server-side SportsDataIO key and league feed '
                    'entitlement. Manual game entry remains available.',
                false,
              )
            : (
                'Live sports data is unavailable.',
                'Ask an arena commissioner to add the slate manually. '
                    'Published games and picks are unaffected.',
                false,
              ),
      CatalogAvailabilityState.providerUnavailable => (
        'The schedule could not be loaded.',
        'Retry the current sport, league, and date query.',
        true,
      ),
      CatalogAvailabilityState.quotaDelayed => (
        'Schedule refresh is delayed.',
        'Provider quota protection is active. Retry after a short wait.',
        true,
      ),
      CatalogAvailabilityState.unauthorized => (
        'Schedule access is unavailable.',
        'Only the weekly picker or an authorized arena administrator can '
            'browse provider schedules.',
        false,
      ),
      CatalogAvailabilityState.available || CatalogAvailabilityState.unknown =>
        controller.catalogProvider == 'manual'
            ? (
                'Live sports data has not been configured.',
                'An authorized picker can still add a trustworthy manual game.',
                false,
              )
            : (
                'No $leagueName games are scheduled for this date.',
                'Choose another date within the active week.',
                false,
              ),
    };
    return EmptyState(
      icon: retry ? Icons.cloud_off_rounded : Icons.event_busy_rounded,
      title: title,
      message: message,
      action: retry
          ? FilledButton.icon(
              onPressed: controller.catalogLoading
                  ? null
                  : () => controller.loadCatalog(
                      query: controller.activeCatalogQuery,
                    ),
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Retry'),
            )
          : null,
    );
  }
}

(String, String) _catalogDateHeading(Game game, String timezone) {
  DateTime? date;
  final scheduledAt = game.scheduledAtUtc;
  if (scheduledAt != null) {
    date = catalogCalendarDate(scheduledAt, timezone);
  } else if (game.scheduledDayEastern case final scheduledDay?) {
    date = DateTime.tryParse('${scheduledDay}T00:00:00.000Z');
  }
  if (date == null) {
    return ('z-date-tbd', game.dateHeading ?? 'Date to be announced');
  }
  final key = DateFormat('yyyy-MM-dd').format(date);
  return (key, DateFormat('EEEE, MMMM d').format(date));
}

class _CatalogGameCard extends StatelessWidget {
  const _CatalogGameCard({
    required this.game,
    required this.selected,
    required this.enabled,
    required this.disabledReason,
    required this.logoPolicy,
    this.leagueTimezone,
    required this.onChanged,
    this.onConfirmKickoff,
  });

  final Game game;
  final bool selected;
  final bool enabled;
  final String? disabledReason;
  final TeamLogoPolicy logoPolicy;
  final String? leagueTimezone;
  final VoidCallback onChanged;
  final VoidCallback? onConfirmKickoff;

  @override
  Widget build(BuildContext context) {
    final time = _catalogGameTimeLabel(game, timezone: leagueTimezone);
    final detail = gameDetailSummary(game);
    final broadcast = gameBroadcastSummary(game);
    final broadcastSummary = broadcast == null ? null : 'Broadcast: $broadcast';
    final reschedule = _rescheduleSummary(game);
    final contextParts = <String>[?detail, ?broadcastSummary, ?reschedule];
    final contextSummary = contextParts.isEmpty
        ? null
        : contextParts.join(' · ');
    final scoreSummary = _scoreSummary(game);
    return Semantics(
      container: true,
      button: enabled,
      checked: selected,
      label:
          '${game.awayTeam.name} at ${game.homeTeam.name}. '
          '$time. '
          '${scoreSummary == null ? '' : '$scoreSummary. '}'
          '${selected ? 'Included' : 'Not included'} in the slate.'
          '${disabledReason == null ? '' : ' $disabledReason'}',
      child: Tooltip(
        message:
            disabledReason ?? (selected ? 'Remove from slate' : 'Add to slate'),
        child: Card(
          color: selected
              ? Theme.of(context).colorScheme.secondaryContainer
              : null,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
            side: BorderSide(
              color: selected
                  ? Theme.of(context).colorScheme.tertiary
                  : Theme.of(context).dividerColor,
              width: selected ? 2 : 1,
            ),
          ),
          child: InkWell(
            onTap: enabled ? onChanged : null,
            excludeFromSemantics: !enabled,
            borderRadius: BorderRadius.circular(20),
            child: Padding(
              padding: const EdgeInsets.all(17),
              child: Row(
                children: [
                  if (onConfirmKickoff != null)
                    ExcludeSemantics(
                      child: Checkbox(
                        key: Key('catalog-checkbox-${game.id}'),
                        value: selected,
                        onChanged: null,
                      ),
                    )
                  else
                    Checkbox(
                      key: Key('catalog-checkbox-${game.id}'),
                      value: selected,
                      onChanged: enabled ? (_) => onChanged() : null,
                      semanticLabel:
                          '${selected ? 'Remove' : 'Include'} '
                          '${game.awayTeam.name} at ${game.homeTeam.name}',
                    ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Wrap(
                          spacing: 8,
                          runSpacing: 6,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            Text(
                              game.leagueName,
                              style: Theme.of(context).textTheme.labelLarge,
                            ),
                            StatusPill(
                              label: gameStatusLabel(game.status),
                              tone: gameStatusTone(game.status),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        _CatalogTeamLine(
                          team: game.awayTeam,
                          score: game.awayScore,
                          scoreKey: Key('catalog-away-score-${game.id}'),
                          logoPolicy: logoPolicy,
                        ),
                        const Padding(
                          padding: EdgeInsets.only(left: 50, top: 3, bottom: 3),
                          child: Text(
                            'AT',
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 1,
                            ),
                          ),
                        ),
                        _CatalogTeamLine(
                          team: game.homeTeam,
                          score: game.homeScore,
                          scoreKey: Key('catalog-home-score-${game.id}'),
                          logoPolicy: logoPolicy,
                        ),
                        const SizedBox(height: 10),
                        Text(
                          key: Key('catalog-game-time-${game.id}'),
                          [
                            time,
                            if (game.venueName != null) game.venueName!,
                          ].join(' · '),
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(
                                color: Theme.of(
                                  context,
                                ).colorScheme.onSurfaceVariant,
                              ),
                        ),
                        if (contextSummary != null) ...[
                          const SizedBox(height: 5),
                          Text(
                            contextSummary,
                            key: Key('catalog-game-context-${game.id}'),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodySmall
                                ?.copyWith(
                                  color: Theme.of(
                                    context,
                                  ).colorScheme.onSurfaceVariant,
                                  fontWeight: FontWeight.w600,
                                ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  SizedBox(
                    width: onConfirmKickoff == null ? 72 : 96,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          selected
                              ? Icons.remove_circle_outline_rounded
                              : enabled
                              ? Icons.add_circle_outline_rounded
                              : onConfirmKickoff != null
                              ? Icons.schedule_rounded
                              : Icons.block_rounded,
                          color: selected
                              ? Theme.of(context).colorScheme.tertiary
                              : Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          selected
                              ? 'Remove'
                              : enabled
                              ? 'Add'
                              : onConfirmKickoff != null
                              ? 'Set kickoff'
                              : 'Unavailable',
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.labelSmall,
                        ),
                        if (onConfirmKickoff != null) ...[
                          const SizedBox(height: 6),
                          OutlinedButton(
                            key: Key('catalog-confirm-time-${game.id}'),
                            onPressed: onConfirmKickoff,
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 6,
                              ),
                              minimumSize: const Size(88, 34),
                            ),
                            child: const Text('Choose time'),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CatalogTeamLine extends StatelessWidget {
  const _CatalogTeamLine({
    required this.team,
    required this.score,
    required this.scoreKey,
    required this.logoPolicy,
  });

  final Team team;
  final int? score;
  final Key scoreKey;
  final TeamLogoPolicy logoPolicy;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        TeamBadge(team: team, size: 40, logoPolicy: logoPolicy),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            team.name,
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
        ),
        Text(
          team.abbreviation,
          style: TextStyle(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
            fontWeight: FontWeight.w800,
          ),
        ),
        if (score != null) ...[
          const SizedBox(width: 10),
          Text(
            '$score',
            key: scoreKey,
            style: Theme.of(
              context,
            ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w900),
          ),
        ],
      ],
    );
  }
}

String _catalogGameTimeLabel(Game game, {String? timezone}) {
  final scheduledAt = game.scheduledAtUtc;
  if (game.timeTbd || scheduledAt == null) {
    final day = game.scheduledDayEastern;
    final kickoff = game.kickoffDisplayText?.trim();
    final hasDiagnosticKickoff =
        kickoff != null &&
        kickoff.isNotEmpty &&
        !const {'tbd', 'tba'}.contains(kickoff.toLowerCase());
    final tbdLabel = timezone == null
        ? (hasDiagnosticKickoff ? kickoff : 'Time TBD')
        : hasDiagnosticKickoff
        ? 'Time TBD (source shows $kickoff; timezone unconfirmed)'
        : 'Time TBD';
    if (day == null) {
      return timezone == null ? '$tbdLabel (Eastern)' : tbdLabel;
    }
    final parsed = DateTime.tryParse('${day}T00:00:00.000Z');
    if (parsed == null) {
      return timezone == null ? '$tbdLabel (Eastern)' : tbdLabel;
    }
    return '${DateFormat('EEE, MMM d').format(parsed)} · $tbdLabel'
        '${timezone == null ? ' (Eastern)' : ''}';
  }
  if (timezone != null) {
    final zone = inLeagueTimezone(scheduledAt, timezone).timeZoneName.trim();
    final suffix = zone.isEmpty ? timezone : zone;
    return '${formatLeagueTime(scheduledAt, timezone, 'EEE, MMM d · h:mm a')} '
        '$suffix';
  }
  final local = scheduledAt.toLocal();
  final zone = local.timeZoneName.trim();
  final suffix = zone.isEmpty ? 'local time' : zone;
  return '${DateFormat('EEE, MMM d · h:mm a').format(local)} $suffix';
}

String? _scoreSummary(Game game) {
  final awayScore = game.awayScore;
  final homeScore = game.homeScore;
  if (awayScore == null || homeScore == null) return null;
  return '${game.awayTeam.abbreviation} $awayScore, '
      '${game.homeTeam.abbreviation} $homeScore';
}

String? _rescheduleSummary(Game game) {
  final movedTo = game.rescheduledToLeagueGameId;
  final movedFrom = game.rescheduledFromLeagueGameId;
  if (movedTo != null) {
    return 'Rescheduled to game $movedTo; this selection is not replaced automatically';
  }
  if (movedFrom != null) return 'Rescheduled from game $movedFrom';
  return null;
}

class _SelectionBar extends StatelessWidget {
  const _SelectionBar({required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final count = controller.selectedGameIds.length;
    final unsaved = controller.unsavedDraftChangeCount;
    final summary = Semantics(
      liveRegion: true,
      label: '$count games selected, $unsaved unsaved changes',
      child: Text(
        [
          count == 1 ? '1 game selected' : '$count games selected',
          switch (controller.draftSyncState) {
            DraftSyncState.dirty =>
              unsaved == 1 ? '1 unsaved change' : '$unsaved unsaved changes',
            DraftSyncState.saving => 'Saving draft…',
            DraftSyncState.saved => 'Draft saved',
            DraftSyncState.error => 'Save failed',
            DraftSyncState.pristine => 'Draft matches saved slate',
          },
        ].join(' · '),
        style: const TextStyle(fontWeight: FontWeight.w900),
      ),
    );
    final actions = Wrap(
      alignment: WrapAlignment.end,
      spacing: 8,
      runSpacing: 8,
      children: [
        OutlinedButton(
          key: const Key('save-draft-button'),
          onPressed:
              controller.draftSaving || !controller.hasUnsavedDraftChanges
              ? null
              : controller.saveDraftSlate,
          child: Text(controller.draftSaving ? 'Saving…' : 'Save draft'),
        ),
        FilledButton.icon(
          key: const Key('review-slate-button'),
          onPressed: count == 0 ? null : () => context.go('/slate/review'),
          icon: const Icon(Icons.arrow_forward_rounded),
          label: const Text('Review slate'),
        ),
      ],
    );
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Theme.of(context).dividerColor),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 18,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          if (constraints.maxWidth < 620) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [summary, const SizedBox(height: 12), actions],
            );
          }
          return Row(
            children: [
              Expanded(child: summary),
              const SizedBox(width: 16),
              actions,
            ],
          );
        },
      ),
    );
  }
}
