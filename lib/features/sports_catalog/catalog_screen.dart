import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../app/bootstrap.dart';
import '../../core/domain/league_time.dart';
import '../../core/responsive/breakpoints.dart';
import '../../core/widgets/ui.dart';
import '../../data/demo/demo_repository.dart';
import '../../data/models/game.dart';

class CatalogScreen extends ConsumerStatefulWidget {
  const CatalogScreen({super.key});

  @override
  ConsumerState<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends ConsumerState<CatalogScreen> {
  final _searchController = TextEditingController();
  String _sport = 'All';
  String _league = 'All leagues';
  String _day = 'All dates';
  DateTimeRange? _dateRange;

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
    final games = _filtered(controller.games, controller.leagueTimezone);
    final leagues =
        <String>{
          'All leagues',
          ...controller.games.map((game) => game.leagueName),
        }.toList()..sort((a, b) {
          if (a == 'All leagues') return -1;
          if (b == 'All leagues') return 1;
          return a.compareTo(b);
        });
    if (!leagues.contains(_league)) _league = 'All leagues';
    return Padding(
      padding: AppBreakpoints.pagePadding(context),
      child: Column(
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
              icon: controller.catalogDelayed
                  ? Icons.schedule_rounded
                  : controller.catalogStale
                  ? Icons.cloud_off_rounded
                  : Icons.cloud_done_outlined,
              tone: controller.catalogDelayed || controller.catalogStale
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
                      : () => controller.loadCatalog(forceRefresh: true),
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
                'Schedule cached ${DateFormat('MMM d, h:mm a').format(controller.catalogCachedAt!.toLocal())}',
                textAlign: TextAlign.right,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            const SizedBox(height: 14),
          ],
          if (controller.catalogError != null) ...[
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
                        : () => controller.loadCatalog(),
                    child: const Text('Retry'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
          ],
          TextField(
            controller: _searchController,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: 'Search teams',
              hintText: 'Try “Hawks”',
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
            values: const [
              'All',
              'Football',
              'Basketball',
              'Baseball',
              'Hockey',
            ],
            selected: _sport,
            onSelected: (value) => setState(() => _sport = value),
          ),
          const SizedBox(height: 10),
          _FilterRow(
            values: leagues,
            selected: _league,
            onSelected: (value) => setState(() => _league = value),
          ),
          const SizedBox(height: 10),
          _FilterRow(
            values: const ['All dates', 'Today', 'Tomorrow', 'Later'],
            selected: _day,
            onSelected: (value) => setState(() => _day = value),
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => _chooseDateRange(context),
              icon: const Icon(Icons.date_range_rounded),
              label: Text(
                _dateRange == null
                    ? 'Choose date range'
                    : '${DateFormat('MMM d').format(_dateRange!.start)} – '
                          '${DateFormat('MMM d').format(_dateRange!.end)}',
              ),
            ),
          ),
          const SizedBox(height: 14),
          Expanded(
            child: controller.catalogLoading && controller.games.isEmpty
                ? const Center(child: CircularProgressIndicator())
                : games.isEmpty
                ? EmptyState(
                    icon: Icons.event_busy_rounded,
                    title: controller.catalogProvider == 'manual'
                        ? 'Manual schedule is ready'
                        : 'No games match these filters',
                    message: controller.catalogProvider == 'manual'
                        ? 'Production sports data remains manual until a '
                              'provider is approved. Add a trustworthy game '
                              'above.'
                        : 'Try another sport, league, date, or team name. '
                              'Off-season leagues may not have a schedule.',
                  )
                : ListView.separated(
                    key: const Key('catalog-game-list'),
                    itemCount: games.length,
                    separatorBuilder: (context, index) =>
                        const SizedBox(height: 12),
                    itemBuilder: (context, index) {
                      final game = games[index];
                      return _CatalogGameCard(
                        game: game,
                        selected: controller.selectedGameIds.contains(game.id),
                        enabled: controller.isCatalogGameSelectable(game),
                        timezone: controller.leagueTimezone,
                        logoPolicy: _logoPolicy(controller, game),
                        onChanged: () => controller.toggleSlateGame(game.id),
                      );
                    },
                  ),
          ),
          const SizedBox(height: 14),
          _SelectionBar(controller: controller),
        ],
      ),
    );
  }

  List<Game> _filtered(List<Game> source, String timezone) {
    final query = _searchController.text.trim().toLowerCase();
    final now = DateTime.now().toUtc();
    return source.where((game) {
      if (_sport != 'All' &&
          game.sportCode.toLowerCase() != _sport.toLowerCase()) {
        return false;
      }
      if (_league != 'All leagues' && game.leagueName != _league) return false;
      if (_dateRange != null) {
        final local = game.scheduledAtUtc.toLocal();
        final day = DateTime(local.year, local.month, local.day);
        final start = DateTime(
          _dateRange!.start.year,
          _dateRange!.start.month,
          _dateRange!.start.day,
        );
        final end = DateTime(
          _dateRange!.end.year,
          _dateRange!.end.month,
          _dateRange!.end.day,
          23,
          59,
          59,
        );
        if (day.isBefore(start) || day.isAfter(end)) return false;
      }
      final dayDelta = leagueDayDelta(game.scheduledAtUtc, now, timezone);
      if (_day == 'Today' && dayDelta != 0) return false;
      if (_day == 'Tomorrow' && dayDelta != 1) return false;
      if (_day == 'Later' && dayDelta < 2) return false;
      if (query.isNotEmpty &&
          !game.homeTeam.name.toLowerCase().contains(query) &&
          !game.awayTeam.name.toLowerCase().contains(query)) {
        return false;
      }
      return true;
    }).toList()..sort((a, b) => a.scheduledAtUtc.compareTo(b.scheduledAtUtc));
  }

  Future<void> _chooseDateRange(BuildContext context) async {
    final now = DateTime.now();
    final range = await showDateRangePicker(
      context: context,
      firstDate: now.subtract(const Duration(days: 1)),
      lastDate: now.add(const Duration(days: 730)),
      initialDateRange: _dateRange,
    );
    if (range != null && mounted) {
      setState(() {
        _dateRange = range;
        _day = 'All dates';
      });
    }
  }

  String _providerStatus(AppController controller) {
    if (controller.isDemo) return 'Explicit demo schedule';
    if (controller.catalogProvider == 'theSportsDbTest') {
      return 'Internal test · TheSportsDB';
    }
    if (controller.catalogProvider == 'manual') return 'Manual schedule';
    if (controller.catalogCacheHit) return 'Cached schedule';
    return 'Provider schedule';
  }

  TeamLogoPolicy _logoPolicy(AppController controller, Game game) {
    if (controller.runtimeMode != AppRuntimeMode.firebaseEmulator ||
        game.provider != 'theSportsDbTest') {
      return const TeamLogoPolicy.disabled();
    }
    return const TeamLogoPolicy.provider(
      provider: 'theSportsDbTest',
      logoRightsVerified: true,
      allowedHosts: {'r2.thesportsdb.com'},
    );
  }

  Future<void> _showManualGameDialog(
    BuildContext context,
    AppController controller,
  ) async {
    final home = TextEditingController();
    final away = TextEditingController();
    final league = TextEditingController(text: 'Community Sports');
    final venue = TextEditingController();
    var scheduledAt = DateTime.now().add(const Duration(days: 1));
    String? validation;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: const Text('Add a manual game'),
          content: SizedBox(
            width: 520,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text(
                    'Use neutral team names for a schedule that does not come '
                    'from the configured provider.',
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
                      DateFormat('EEE, MMM d · h:mm a').format(scheduledAt),
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
                final saved = await controller.addManualGame(
                  homeName: home.text,
                  awayName: away.text,
                  leagueName: league.text,
                  scheduledAt: scheduledAt,
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

class _FilterRow extends StatelessWidget {
  const _FilterRow({
    required this.values,
    required this.selected,
    required this.onSelected,
  });

  final List<String> values;
  final String selected;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final value in values) ...[
            ChoiceChip(
              label: Text(value),
              selected: selected == value,
              onSelected: (_) => onSelected(value),
            ),
            const SizedBox(width: 8),
          ],
        ],
      ),
    );
  }
}

class _CatalogGameCard extends StatelessWidget {
  const _CatalogGameCard({
    required this.game,
    required this.selected,
    required this.enabled,
    required this.timezone,
    required this.logoPolicy,
    required this.onChanged,
  });

  final Game game;
  final bool selected;
  final bool enabled;
  final String timezone;
  final TeamLogoPolicy logoPolicy;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final time = formatLeagueTime(
      game.scheduledAtUtc,
      timezone,
      'EEE, MMM d · h:mm a',
    );
    return Semantics(
      container: true,
      button: enabled,
      checked: selected,
      label:
          '${game.awayTeam.name} at ${game.homeTeam.name}. '
          '${selected ? 'Included' : 'Not included'} in the slate.',
      child: Card(
        child: InkWell(
          onTap: enabled ? onChanged : null,
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: const EdgeInsets.all(17),
            child: Row(
              children: [
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
                        logoPolicy: logoPolicy,
                      ),
                      const SizedBox(height: 10),
                      Text(
                        [
                          time,
                          if (game.venueName != null) game.venueName!,
                        ].join(' · '),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Icon(
                  selected
                      ? Icons.check_circle_rounded
                      : Icons.add_circle_outline_rounded,
                  color: selected
                      ? Theme.of(context).colorScheme.tertiary
                      : Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CatalogTeamLine extends StatelessWidget {
  const _CatalogTeamLine({required this.team, required this.logoPolicy});

  final Team team;
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
      ],
    );
  }
}

class _SelectionBar extends StatelessWidget {
  const _SelectionBar({required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final count = controller.selectedGameIds.length;
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
      child: Row(
        children: [
          Expanded(
            child: Semantics(
              liveRegion: true,
              label: '$count games selected',
              child: Text(
                [
                  count == 1 ? '1 game selected' : '$count games selected',
                  switch (controller.draftSyncState) {
                    DraftSyncState.dirty => 'Not saved',
                    DraftSyncState.saving => 'Saving draft…',
                    DraftSyncState.saved => 'Draft saved',
                    DraftSyncState.error => 'Save failed',
                    DraftSyncState.pristine => 'Not saved',
                  },
                ].join(' · '),
                style: const TextStyle(fontWeight: FontWeight.w900),
              ),
            ),
          ),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton(
                key: const Key('save-draft-button'),
                onPressed:
                    controller.draftSaving ||
                        controller.draftSyncState == DraftSyncState.saved
                    ? null
                    : controller.saveDraftSlate,
                child: Text(controller.draftSaving ? 'Saving…' : 'Save draft'),
              ),
              FilledButton.icon(
                key: const Key('review-slate-button'),
                onPressed: count == 0
                    ? null
                    : () => context.go('/slate/review'),
                icon: const Icon(Icons.arrow_forward_rounded),
                label: const Text('Review slate'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
