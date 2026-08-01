import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/domain/league_time.dart';
import '../../core/responsive/breakpoints.dart';
import '../../core/widgets/ui.dart';
import '../../data/demo/demo_repository.dart';
import '../../data/models/game.dart';

class AdminReviewScreen extends ConsumerStatefulWidget {
  const AdminReviewScreen({super.key});

  @override
  ConsumerState<AdminReviewScreen> createState() => _AdminReviewScreenState();
}

class _AdminReviewScreenState extends ConsumerState<AdminReviewScreen> {
  bool _refreshing = false;
  bool _finalizing = false;
  bool _processing = false;
  bool _creatingNext = false;
  final Set<String> _refreshingGameIds = {};

  @override
  Widget build(BuildContext context) {
    final controller = ref.watch(appControllerProvider);
    return ListView(
      padding: AppBreakpoints.pagePadding(context),
      children: [
        PageHeader(
          eyebrow: 'Commissioner tools',
          title: 'Review and finalize ${controller.weekLabel}',
          description:
              'Resolve every unfinished or anomalous game, preserve an audit '
              'reason, then finalize once the slate is ready.',
          action: controller.weekFinalized
              ? const StatusPill(
                  label: 'Finalized',
                  icon: Icons.verified_rounded,
                  tone: StatusTone.success,
                )
              : StatusPill(
                  label: controller.canFinalizeWeek
                      ? 'Ready to finalize'
                      : 'Review required',
                  icon: Icons.rule_rounded,
                  tone: controller.canFinalizeWeek
                      ? StatusTone.success
                      : StatusTone.warning,
                ),
        ),
        if (controller.errorMessage != null) ...[
          const SizedBox(height: 16),
          SectionCard(
            color: Theme.of(context).colorScheme.errorContainer,
            child: Text(controller.errorMessage!),
          ),
        ],
        const SizedBox(height: 20),
        _ProviderHealth(
          provider: controller.catalogProvider,
          isDemo: controller.isDemo,
          refreshing: _refreshing || _refreshingGameIds.isNotEmpty,
          onRefresh: controller.weekFinalized
              ? null
              : () async {
                  setState(() => _refreshing = true);
                  if (controller.isDemo) {
                    await controller.simulateFinalResults();
                  } else {
                    await controller.refreshWeekResults();
                  }
                  if (mounted) setState(() => _refreshing = false);
                },
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            OutlinedButton.icon(
              onPressed: controller.weekFinalized || _processing
                  ? null
                  : () async {
                      setState(() => _processing = true);
                      await controller.processLockedPicks();
                      if (mounted) setState(() => _processing = false);
                    },
              icon: const Icon(Icons.visibility_rounded),
              label: const Text('Process locked pick reveals'),
            ),
            OutlinedButton.icon(
              onPressed: controller.weekFinalized || _processing
                  ? null
                  : () async {
                      setState(() => _processing = true);
                      await controller.calculateProvisionalResults();
                      if (mounted) setState(() => _processing = false);
                    },
              icon: const Icon(Icons.calculate_rounded),
              label: const Text('Calculate provisional results'),
            ),
            if (!controller.weekFinalized)
              OutlinedButton.icon(
                onPressed: () => _showPickerDialog(context, controller),
                icon: const Icon(Icons.person_pin_circle_outlined),
                label: const Text('Assign weekly picker'),
              ),
          ],
        ),
        if (controller.proposedNextPicker != null) ...[
          const SizedBox(height: 10),
          Text(
            'Proposed next picker: '
            '${controller.proposedNextPicker!.displayName}',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
        const SizedBox(height: 18),
        Text('Selected games', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 10),
        for (final game in controller.selectedGames) ...[
          _AdminGameCard(
            game: game,
            overrideReason:
                controller.overrideReasons[game.id] ??
                game.manualOverrideReason,
            manuallyOverridden:
                game.manualOverride ||
                controller.overrideReasons.containsKey(game.id),
            refreshing: _refreshingGameIds.contains(game.id),
            onForceRefresh:
                controller.weekFinalized ||
                    game.provider == 'manual' ||
                    _refreshing ||
                    _refreshingGameIds.isNotEmpty
                ? null
                : () => _forceRefreshGame(controller, game),
            onOverride: controller.weekFinalized
                ? null
                : () => _showOverrideDialog(context, controller, game),
          ),
          const SizedBox(height: 12),
        ],
        const SizedBox(height: 10),
        if (controller.weekFinalized)
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              OutlinedButton.icon(
                onPressed: () => _showReopenDialog(context, controller),
                icon: const Icon(Icons.lock_open_rounded),
                label: const Text('Reopen week with reason'),
              ),
              FilledButton.icon(
                key: const Key('create-next-week-button'),
                onPressed: _creatingNext
                    ? null
                    : () async {
                        setState(() => _creatingNext = true);
                        final created = await controller.createNextWeek();
                        if (!context.mounted) return;
                        setState(() => _creatingNext = false);
                        if (created) context.go('/catalog');
                      },
                icon: const Icon(Icons.skip_next_rounded),
                label: Text(
                  _creatingNext ? 'Creating…' : 'Create and assign next week',
                ),
              ),
            ],
          )
        else
          FilledButton.icon(
            key: const Key('finalize-week-button'),
            onPressed: !controller.canFinalizeWeek || _finalizing
                ? null
                : () async {
                    setState(() => _finalizing = true);
                    final finalized = await controller.finalizeWeek();
                    if (!context.mounted) return;
                    setState(() => _finalizing = false);
                    if (finalized) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(
                            'Week finalized. Rotation advanced to '
                            '${controller.lastNextPickerName ?? 'the next active member'}.',
                          ),
                        ),
                      );
                      context.go('/results');
                    }
                  },
            icon: const Icon(Icons.verified_rounded),
            label: Text(
              _finalizing
                  ? 'Finalizing…'
                  : controller.canFinalizeWeek
                  ? 'Finalize ${controller.weekLabel}'
                  : 'Finalize after all games resolve',
            ),
          ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: () async {
            final rebuilt = await controller.rebuildStandingsFromSnapshots();
            if (!context.mounted || !rebuilt) return;
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text(
                  'Standings rebuilt idempotently from week snapshots.',
                ),
              ),
            );
          },
          icon: const Icon(Icons.replay_rounded),
          label: const Text('Rebuild scoring and standings'),
        ),
      ],
    );
  }

  Future<void> _forceRefreshGame(AppController controller, Game game) async {
    if (_refreshingGameIds.contains(game.id)) return;
    setState(() => _refreshingGameIds.add(game.id));
    final result = await controller.refreshWeekResults(gameId: game.id);
    if (!mounted) return;
    setState(() => _refreshingGameIds.remove(game.id));
    if (result != null) {
      final matchup =
          '${game.awayTeam.shortName} at ${game.homeTeam.shortName}';
      final updates =
          '${result.updatedGameCount} '
          'update${result.updatedGameCount == 1 ? '' : 's'}';
      final message = switch ((result.delayed, result.updatedGameCount)) {
        (true, > 0) =>
          'Provider refresh was delayed; applied $updates from cached data '
              'for $matchup.',
        (true, _) =>
          'Provider refresh was delayed; cached data remains for $matchup.',
        (false, > 0) => 'Provider refreshed $matchup ($updates).',
        (false, _) => 'Provider refresh found no changes for $matchup.',
      };
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(message)));
    }
  }

  Future<void> _showPickerDialog(
    BuildContext context,
    AppController controller,
  ) async {
    var selectedUid = controller.currentPickerId;
    final active = controller.members
        .where((member) => member.isActive)
        .toList(growable: false);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: Text('Assign picker for ${controller.weekLabel}'),
          content: DropdownButtonFormField<String>(
            initialValue: active.any((member) => member.uid == selectedUid)
                ? selectedUid
                : null,
            decoration: const InputDecoration(labelText: 'Active member'),
            items: [
              for (final member in active)
                DropdownMenuItem(
                  value: member.uid,
                  child: Text(member.displayName),
                ),
            ],
            onChanged: (value) {
              if (value != null) {
                setDialogState(() => selectedUid = value);
              }
            },
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: selectedUid.isEmpty
                  ? null
                  : () => Navigator.pop(dialogContext, true),
              child: const Text('Assign picker'),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true) return;
    await controller.assignCurrentWeekPicker(selectedUid);
  }

  Future<void> _showOverrideDialog(
    BuildContext context,
    AppController controller,
    Game game,
  ) async {
    final reasonController = TextEditingController();
    final homeScoreController = TextEditingController(
      text: game.homeScore?.toString() ?? '',
    );
    final awayScoreController = TextEditingController(
      text: game.awayScore?.toString() ?? '',
    );
    var overrideStatus = switch (game.status) {
      GameStatus.scheduled ||
      GameStatus.delayed ||
      GameStatus.postponed ||
      GameStatus.suspended ||
      GameStatus.finalStatus ||
      GameStatus.voided ||
      GameStatus.reviewRequired => game.status,
      GameStatus.cancelled => GameStatus.voided,
      GameStatus.live => GameStatus.reviewRequired,
    };
    String? winnerTeamId = overrideStatus == GameStatus.finalStatus
        ? game.winnerTeamId
        : null;
    final leagueScheduledAt = inLeagueTimezone(
      game.scheduledAtUtc,
      controller.leagueTimezone,
    );
    var correctedDate = DateTime(
      leagueScheduledAt.year,
      leagueScheduledAt.month,
      leagueScheduledAt.day,
    );
    var correctedTime = TimeOfDay(
      hour: leagueScheduledAt.hour,
      minute: leagueScheduledAt.minute,
    );
    final earliestCorrectionUtc = game.publishedScheduledAtUtc.toUtc().subtract(
      gameRescheduleSanityWindow,
    );
    final latestCorrectionUtc = game.publishedScheduledAtUtc.toUtc().add(
      gameRescheduleSanityWindow,
    );
    final earliestCorrection = inLeagueTimezone(
      earliestCorrectionUtc,
      controller.leagueTimezone,
    );
    final latestCorrection = inLeagueTimezone(
      latestCorrectionUtc,
      controller.leagueTimezone,
    );
    final firstDate = DateTime(
      earliestCorrection.year,
      earliestCorrection.month,
      earliestCorrection.day,
    );
    final lastDate = DateTime(
      latestCorrection.year,
      latestCorrection.month,
      latestCorrection.day,
    );
    var correctScheduledAt = false;
    var confirmed = false;
    String? validation;
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: Text(
            'Override ${game.awayTeam.shortName} at ${game.homeTeam.shortName}',
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Choose a trustworthy state or result and preserve the '
                  'reason in the server audit trail.',
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<GameStatus>(
                  key: const Key('override-status-dropdown'),
                  initialValue: overrideStatus,
                  decoration: const InputDecoration(labelText: 'Game state'),
                  items: const [
                    DropdownMenuItem(
                      value: GameStatus.scheduled,
                      child: Text('Scheduled'),
                    ),
                    DropdownMenuItem(
                      value: GameStatus.delayed,
                      child: Text('Delayed'),
                    ),
                    DropdownMenuItem(
                      value: GameStatus.postponed,
                      child: Text('Postponed'),
                    ),
                    DropdownMenuItem(
                      value: GameStatus.suspended,
                      child: Text('Suspended'),
                    ),
                    DropdownMenuItem(
                      value: GameStatus.voided,
                      child: Text('Void / canceled'),
                    ),
                    DropdownMenuItem(
                      value: GameStatus.finalStatus,
                      child: Text('Final with winner'),
                    ),
                    DropdownMenuItem(
                      value: GameStatus.reviewRequired,
                      child: Text('Review required'),
                    ),
                  ],
                  onChanged: (value) {
                    if (value == null) return;
                    setDialogState(() {
                      overrideStatus = value;
                      validation = null;
                      if (value != GameStatus.finalStatus) {
                        winnerTeamId = null;
                      }
                    });
                  },
                ),
                if (overrideStatus == GameStatus.finalStatus) ...[
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    key: const Key('override-winner-dropdown'),
                    initialValue: winnerTeamId,
                    decoration: const InputDecoration(labelText: 'Winner'),
                    items: [
                      DropdownMenuItem(
                        value: game.awayTeam.id,
                        child: Text(game.awayTeam.name),
                      ),
                      DropdownMenuItem(
                        value: game.homeTeam.id,
                        child: Text(game.homeTeam.name),
                      ),
                    ],
                    onChanged: (value) => setDialogState(() {
                      winnerTeamId = value;
                      validation = null;
                    }),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          key: const Key('override-away-score'),
                          controller: awayScoreController,
                          keyboardType: TextInputType.number,
                          decoration: InputDecoration(
                            labelText: '${game.awayTeam.shortName} score',
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: TextField(
                          key: const Key('override-home-score'),
                          controller: homeScoreController,
                          keyboardType: TextInputType.number,
                          decoration: InputDecoration(
                            labelText: '${game.homeTeam.shortName} score',
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 12),
                CheckboxListTile(
                  key: const Key('override-correct-start-checkbox'),
                  contentPadding: EdgeInsets.zero,
                  value: correctScheduledAt,
                  title: const Text('Correct the scheduled start'),
                  subtitle: Text(
                    formatLeagueTime(
                      game.scheduledAtUtc,
                      controller.leagueTimezone,
                      'EEE, MMM d · h:mm a',
                    ),
                  ),
                  onChanged: (value) => setDialogState(() {
                    correctScheduledAt = value ?? false;
                    validation = null;
                  }),
                ),
                if (correctScheduledAt) ...[
                  Text(
                    'Enter arena-local time (${controller.leagueTimezone}). '
                    'The date must remain within 366 days of the published '
                    'start. A correction can tighten but never reopen the '
                    'pick lock.',
                    style: Theme.of(dialogContext).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      OutlinedButton.icon(
                        key: const Key('override-date-button'),
                        onPressed: () async {
                          final selected = await showDatePicker(
                            context: dialogContext,
                            initialDate: correctedDate,
                            firstDate: firstDate,
                            lastDate: lastDate,
                          );
                          if (selected != null) {
                            setDialogState(() {
                              correctedDate = selected;
                              validation = null;
                            });
                          }
                        },
                        icon: const Icon(Icons.calendar_today_outlined),
                        label: Text(
                          DateFormat('MMM d, yyyy').format(correctedDate),
                        ),
                      ),
                      OutlinedButton.icon(
                        key: const Key('override-time-button'),
                        onPressed: () async {
                          final selected = await showTimePicker(
                            context: dialogContext,
                            initialTime: correctedTime,
                          );
                          if (selected != null) {
                            setDialogState(() {
                              correctedTime = selected;
                              validation = null;
                            });
                          }
                        },
                        icon: const Icon(Icons.schedule_outlined),
                        label: Text(correctedTime.format(dialogContext)),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 16),
                TextField(
                  key: const Key('override-reason-field'),
                  controller: reasonController,
                  maxLines: 3,
                  onChanged: (_) => setDialogState(() => validation = null),
                  decoration: InputDecoration(
                    labelText: 'Required audit reason',
                    errorText: validation,
                  ),
                ),
                const SizedBox(height: 8),
                CheckboxListTile(
                  key: const Key('override-confirmation-checkbox'),
                  contentPadding: EdgeInsets.zero,
                  value: confirmed,
                  title: const Text(
                    'I confirm this correction is supported by a trustworthy '
                    'source.',
                  ),
                  onChanged: (value) =>
                      setDialogState(() => confirmed = value ?? false),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              key: const Key('save-override-button'),
              onPressed: !confirmed
                  ? null
                  : () async {
                      final reason = reasonController.text.trim();
                      if (reason.length < 10) {
                        setDialogState(
                          () => validation = 'Enter at least 10 characters.',
                        );
                        return;
                      }
                      final homeScore = int.tryParse(homeScoreController.text);
                      final awayScore = int.tryParse(awayScoreController.text);
                      if (overrideStatus == GameStatus.finalStatus &&
                          (winnerTeamId == null ||
                              homeScore == null ||
                              awayScore == null)) {
                        setDialogState(
                          () => validation =
                              'Choose the winner and enter both final scores.',
                        );
                        return;
                      }
                      if (overrideStatus == GameStatus.finalStatus &&
                          (homeScore! < 0 || awayScore! < 0)) {
                        setDialogState(
                          () => validation =
                              'Final scores must be non-negative integers.',
                        );
                        return;
                      }
                      if (overrideStatus == GameStatus.finalStatus &&
                          homeScore == awayScore) {
                        setDialogState(
                          () => validation = 'Final scores cannot be tied.',
                        );
                        return;
                      }
                      if (overrideStatus == GameStatus.finalStatus) {
                        final expectedWinner = homeScore! > awayScore!
                            ? game.homeTeam.id
                            : game.awayTeam.id;
                        if (winnerTeamId != expectedWinner) {
                          setDialogState(
                            () => validation =
                                'The winner must match the final scores.',
                          );
                          return;
                        }
                      }
                      DateTime? scheduledAtUtc;
                      if (correctScheduledAt) {
                        scheduledAtUtc = leagueWallTimeToUtc(
                          date: correctedDate,
                          hour: correctedTime.hour,
                          minute: correctedTime.minute,
                          timezone: controller.leagueTimezone,
                        );
                        if (scheduledAtUtc == null) {
                          setDialogState(
                            () => validation =
                                'Choose a valid time in the arena timezone.',
                          );
                          return;
                        }
                        if (!isWithinGameRescheduleWindow(
                          publishedScheduledAtUtc: game.publishedScheduledAtUtc,
                          correctedScheduledAtUtc: scheduledAtUtc,
                        )) {
                          setDialogState(
                            () => validation =
                                'The corrected time must remain within 366 days '
                                'of the published start.',
                          );
                          return;
                        }
                      }
                      final didSave = await controller.recordOverride(
                        game.id,
                        reason,
                        status: overrideStatus,
                        homeScore: homeScore,
                        awayScore: awayScore,
                        winnerTeamId: winnerTeamId,
                        scheduledAtUtc: scheduledAtUtc,
                      );
                      if (!dialogContext.mounted) return;
                      if (!didSave) {
                        setDialogState(
                          () => validation =
                              controller.errorMessage ??
                              'The override could not be saved.',
                        );
                        return;
                      }
                      Navigator.pop(dialogContext, true);
                    },
              child: const Text('Save override'),
            ),
          ],
        ),
      ),
    );
    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Override saved to the audit trail.')),
      );
    }
    // showDialog completes when the route pops, before its reverse animation
    // has necessarily detached every text field listener.
    await Future<void>.delayed(const Duration(milliseconds: 300));
    reasonController.dispose();
    homeScoreController.dispose();
    awayScoreController.dispose();
  }

  Future<void> _showReopenDialog(
    BuildContext context,
    AppController controller,
  ) async {
    final reason = TextEditingController();
    String? validation;
    final shouldReopen = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text('Reopen ${controller.weekLabel}?'),
          content: TextField(
            controller: reason,
            maxLines: 3,
            decoration: InputDecoration(
              labelText: 'Required reason',
              hintText: 'Describe the provider correction',
              errorText: validation,
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                if (reason.text.trim().length < 10) {
                  setDialogState(
                    () => validation = 'Enter at least 10 characters.',
                  );
                  return;
                }
                Navigator.pop(context, true);
              },
              child: const Text('Reopen and recalculate'),
            ),
          ],
        ),
      ),
    );
    if (shouldReopen == true) {
      await controller.reopenWeek(reason: reason.text);
    }
    reason.dispose();
  }
}

class _ProviderHealth extends StatelessWidget {
  const _ProviderHealth({
    required this.provider,
    required this.isDemo,
    required this.refreshing,
    required this.onRefresh,
  });

  final String provider;
  final bool isDemo;
  final bool refreshing;
  final VoidCallback? onRefresh;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      child: LayoutBuilder(
        builder: (context, constraints) {
          final info = Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Sports data health',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  StatusPill(
                    label: isDemo
                        ? 'Explicit demo provider'
                        : provider == 'manual'
                        ? 'Manual production mode'
                        : '$provider provider',
                    icon: Icons.check_circle_outline_rounded,
                    tone: StatusTone.success,
                  ),
                  const StatusPill(label: 'Server-authoritative refresh'),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                'Manual refresh respects cache freshness, distributed locks, '
                'and the daily quota guard.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          );
          final button = OutlinedButton.icon(
            onPressed: refreshing ? null : onRefresh,
            icon: refreshing
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.sync_rounded),
            label: Text(
              refreshing ? 'Refreshing…' : 'Refresh selected game results',
            ),
          );
          if (constraints.maxWidth < 700) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [info, const SizedBox(height: 16), button],
            );
          }
          return Row(
            children: [
              Expanded(child: info),
              const SizedBox(width: 18),
              button,
            ],
          );
        },
      ),
    );
  }
}

class _AdminGameCard extends StatelessWidget {
  const _AdminGameCard({
    required this.game,
    required this.overrideReason,
    required this.manuallyOverridden,
    required this.refreshing,
    required this.onForceRefresh,
    required this.onOverride,
  });

  final Game game;
  final String? overrideReason;
  final bool manuallyOverridden;
  final bool refreshing;
  final VoidCallback? onForceRefresh;
  final VoidCallback? onOverride;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      padding: const EdgeInsets.all(16),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final details = Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${game.awayTeam.shortName} at ${game.homeTeam.shortName}',
                style: const TextStyle(fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 5),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  StatusPill(
                    label: gameStatusLabel(game.status),
                    tone: gameStatusTone(game.status),
                  ),
                  if (manuallyOverridden)
                    StatusPill(
                      key: Key('admin-manual-override-${game.id}'),
                      label: 'Manual override',
                      icon: Icons.edit_note_rounded,
                      tone: StatusTone.warning,
                    ),
                ],
              ),
              if (overrideReason != null) ...[
                const SizedBox(height: 6),
                Text(
                  overrideReason!,
                  key: Key('admin-override-reason-${game.id}'),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ],
          );
          final actions = Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              Tooltip(
                message: game.provider == 'manual'
                    ? 'Manual games do not have a provider result to refresh.'
                    : 'Bypass fresh cache for this game only.',
                child: OutlinedButton.icon(
                  key: Key('admin-force-refresh-${game.id}'),
                  onPressed: refreshing ? null : onForceRefresh,
                  icon: refreshing
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.refresh_rounded),
                  label: Text(refreshing ? 'Refreshing…' : 'Force refresh'),
                ),
              ),
              OutlinedButton(
                key: Key('admin-override-${game.id}'),
                onPressed: onOverride,
                child: const Text('Override'),
              ),
            ],
          );
          if (constraints.maxWidth < 620) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [details, const SizedBox(height: 12), actions],
            );
          }
          return Row(
            children: [
              Expanded(child: details),
              const SizedBox(width: 12),
              actions,
            ],
          );
        },
      ),
    );
  }
}
