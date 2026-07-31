import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

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
          refreshing: _refreshing,
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
            overrideReason: controller.overrideReasons[game.id],
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
    var overrideStatus = GameStatus.voided;
    String? winnerTeamId;
    String? validation;
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text(
            'Override ${game.awayTeam.shortName} at ${game.homeTeam.shortName}',
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Choose a trustworthy result and preserve the reason in the '
                'server audit trail.',
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<GameStatus>(
                initialValue: overrideStatus,
                decoration: const InputDecoration(labelText: 'Result state'),
                items: const [
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
                    if (value != GameStatus.finalStatus) winnerTeamId = null;
                  });
                },
              ),
              if (overrideStatus == GameStatus.finalStatus) ...[
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
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
                  onChanged: (value) =>
                      setDialogState(() => winnerTeamId = value),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
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
              const SizedBox(height: 16),
              TextField(
                controller: reasonController,
                maxLines: 3,
                decoration: InputDecoration(
                  labelText: 'Required audit reason',
                  errorText: validation,
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () async {
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
                final didSave = await controller.recordOverride(
                  game.id,
                  reasonController.text,
                  status: overrideStatus,
                  homeScore: homeScore,
                  awayScore: awayScore,
                  winnerTeamId: winnerTeamId,
                );
                if (!context.mounted) return;
                if (!didSave) {
                  setDialogState(
                    () => validation = 'Enter at least 10 characters.',
                  );
                  return;
                }
                Navigator.pop(context, true);
              },
              child: const Text('Save override'),
            ),
          ],
        ),
      ),
    );
    reasonController.dispose();
    homeScoreController.dispose();
    awayScoreController.dispose();
    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Override saved to the audit trail.')),
      );
    }
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
    required this.onOverride,
  });

  final Game game;
  final String? overrideReason;
  final VoidCallback? onOverride;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          Expanded(
            child: Column(
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
                    if (overrideReason != null)
                      const StatusPill(
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
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 10),
          OutlinedButton(onPressed: onOverride, child: const Text('Override')),
        ],
      ),
    );
  }
}
