import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/domain/league_time.dart';
import '../../core/responsive/breakpoints.dart';
import '../../core/widgets/ui.dart';
import '../../data/demo/demo_repository.dart';
import '../../data/models/game.dart';

class SlateReviewScreen extends ConsumerWidget {
  const SlateReviewScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.watch(appControllerProvider);
    final games = controller.selectedGames;
    return ListView(
      padding: AppBreakpoints.pagePadding(context),
      children: [
        PageHeader(
          eyebrow: 'Week 9 · Draft',
          title: 'Review and publish',
          description:
              'Publishing opens this slate to 3 eligible participants. Future '
              'edits require commissioner action.',
          action: OutlinedButton.icon(
            onPressed: () => context.go('/catalog'),
            icon: const Icon(Icons.arrow_back_rounded),
            label: const Text('Back to catalog'),
          ),
        ),
        const SizedBox(height: 22),
        if (games.isEmpty)
          EmptyState(
            icon: Icons.playlist_remove_rounded,
            title: 'Select at least one game',
            message:
                'A weekly slate must include at least one game before it can '
                'be published.',
            action: FilledButton(
              onPressed: () => context.go('/catalog'),
              child: const Text('Browse games'),
            ),
          )
        else ...[
          _RulesSummary(gameCount: games.length),
          const SizedBox(height: 18),
          for (final game in games) ...[
            _ReviewGameCard(
              game: game,
              timezone: controller.leagueTimezone,
              onRemove: controller.slatePublished
                  ? null
                  : () => controller.removeSlateGame(game.id),
            ),
            const SizedBox(height: 12),
          ],
          const SizedBox(height: 8),
          FilledButton.icon(
            key: const Key('publish-slate-button'),
            onPressed: controller.slatePublished
                ? null
                : () => _confirmPublish(context, controller),
            icon: const Icon(Icons.publish_rounded),
            label: Text(
              controller.slatePublished
                  ? 'Slate published'
                  : 'Publish ${games.length}-game slate',
            ),
          ),
        ],
      ],
    );
  }

  Future<void> _confirmPublish(
    BuildContext context,
    AppController controller,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        icon: const Icon(Icons.sports_score_rounded),
        title: const Text('Publish Week 9?'),
        content: const Text(
          'Members can begin making picks immediately. Each game locks at its '
          'own effective start time.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep editing'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Publish slate'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    final published = await controller.publishSlate();
    if (!context.mounted || !published) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Week 9 is published and open for picks.')),
    );
    context.go('/dashboard');
  }
}

class _RulesSummary extends StatelessWidget {
  const _RulesSummary({required this.gameCount});

  final int gameCount;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      child: Wrap(
        spacing: 28,
        runSpacing: 16,
        children: [
          _RuleItem(
            icon: Icons.sports_score_rounded,
            label: 'Games',
            value: '$gameCount selected',
          ),
          const _RuleItem(
            icon: Icons.groups_rounded,
            label: 'Participants',
            value: '3 eligible',
          ),
          const _RuleItem(
            icon: Icons.lock_clock_rounded,
            label: 'Lock policy',
            value: 'Per game',
          ),
          const _RuleItem(
            icon: Icons.person_off_outlined,
            label: 'Weekly picker',
            value: 'Does not pick',
          ),
        ],
      ),
    );
  }
}

class _RuleItem extends StatelessWidget {
  const _RuleItem({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 180,
      child: Row(
        children: [
          Icon(icon, color: Theme.of(context).colorScheme.tertiary),
          const SizedBox(width: 10),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label.toUpperCase(),
                style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                  fontSize: 10,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 0.8,
                ),
              ),
              Text(value, style: const TextStyle(fontWeight: FontWeight.w800)),
            ],
          ),
        ],
      ),
    );
  }
}

class _ReviewGameCard extends StatelessWidget {
  const _ReviewGameCard({
    required this.game,
    required this.timezone,
    this.onRemove,
  });

  final Game game;
  final String timezone;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          TeamBadge(team: game.awayTeam, size: 42),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${game.awayTeam.shortName} at ${game.homeTeam.shortName}',
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 3),
                Text(
                  '${game.leagueName} · '
                  '${formatLeagueTime(game.scheduledAtUtc, timezone, 'EEE, MMM d · h:mm a')}',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          TeamBadge(team: game.homeTeam, size: 42),
          if (onRemove != null) ...[
            const SizedBox(width: 8),
            IconButton(
              tooltip: 'Remove ${game.awayTeam.name} at ${game.homeTeam.name}',
              onPressed: onRemove,
              icon: const Icon(Icons.close_rounded),
            ),
          ],
        ],
      ),
    );
  }
}
