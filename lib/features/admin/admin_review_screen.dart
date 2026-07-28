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

  @override
  Widget build(BuildContext context) {
    final controller = ref.watch(appControllerProvider);
    return ListView(
      padding: AppBreakpoints.pagePadding(context),
      children: [
        PageHeader(
          eyebrow: 'Commissioner tools',
          title: 'Review and finalize Week 9',
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
                  label: controller.demoReviewReady
                      ? 'Ready to finalize'
                      : 'Review required',
                  icon: Icons.rule_rounded,
                  tone: controller.demoReviewReady
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
          refreshing: _refreshing,
          onRefresh: controller.weekFinalized
              ? null
              : () async {
                  setState(() => _refreshing = true);
                  await controller.simulateFinalResults();
                  if (mounted) setState(() => _refreshing = false);
                },
        ),
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
          OutlinedButton.icon(
            onPressed: () => _showReopenDialog(context, controller),
            icon: const Icon(Icons.lock_open_rounded),
            label: const Text('Reopen week with reason'),
          )
        else
          FilledButton.icon(
            key: const Key('finalize-week-button'),
            onPressed: !controller.demoReviewReady || _finalizing
                ? null
                : () async {
                    setState(() => _finalizing = true);
                    final finalized = await controller.finalizeWeek();
                    if (!context.mounted) return;
                    setState(() => _finalizing = false);
                    if (finalized) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text(
                            'Week finalized. Rotation advanced to Mia.',
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
                  : controller.demoReviewReady
                  ? 'Finalize Week 9'
                  : 'Finalize after all games resolve',
            ),
          ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: controller.weekFinalized
              ? null
              : () async {
                  final rebuilt = await controller
                      .rebuildStandingsFromSnapshots();
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

  Future<void> _showOverrideDialog(
    BuildContext context,
    AppController controller,
    Game game,
  ) async {
    final reasonController = TextEditingController();
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
                'This demo override marks the game void. Production supports '
                'a final winner or review-required state.',
              ),
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
                final didSave = await controller.recordOverride(
                  game.id,
                  reasonController.text,
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
          title: const Text('Reopen Week 9?'),
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
  const _ProviderHealth({required this.refreshing, required this.onRefresh});

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
              const Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  StatusPill(
                    label: 'Mock provider healthy',
                    icon: Icons.check_circle_outline_rounded,
                    tone: StatusTone.success,
                  ),
                  StatusPill(label: 'Demo cache snapshot'),
                  StatusPill(label: 'Circuit · closed'),
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
              refreshing ? 'Refreshing…' : 'Refresh / load demo finals',
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
