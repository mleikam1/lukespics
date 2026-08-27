import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/domain/game_presentation.dart';
import '../../core/domain/league_time.dart';
import '../../core/responsive/breakpoints.dart';
import '../../core/widgets/catalog_logo_policy.dart';
import '../../core/widgets/ui.dart';
import '../../data/demo/demo_repository.dart';
import '../../data/models/game.dart';
import '../../data/models/pick.dart';

class PicksScreen extends ConsumerWidget {
  const PicksScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.watch(appControllerProvider);
    final games = controller.isDemo
        ? controller.selectedGames
        : controller.slatePublished
        ? controller.selectedWeekGames
        : const <Game>[];
    final confirmed = games
        .where(
          (game) =>
              controller.picks.containsKey(game.id) &&
              controller.syncStateFor(game.id) == PickSyncState.synced,
        )
        .length;
    final entryLocked = controller.entryLocked;
    return Padding(
      padding: AppBreakpoints.pagePadding(context),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          PageHeader(
            eyebrow: '${controller.weekLabel} · Your entry',
            title: 'Make your picks',
            description: entryLocked
                ? 'All of your picks are saved and locked for this week.'
                : 'Choose exactly one winner per game. Once every pick is '
                      'saved, your entry is locked.',
            action: _ProgressPill(
              done: confirmed,
              total: games.length,
              entryLocked: entryLocked,
            ),
          ),
          if (controller.offline && !entryLocked) ...[
            const SizedBox(height: 16),
            const _SyncWarning(),
          ],
          const SizedBox(height: 20),
          Expanded(
            child: !controller.canMakePicks
                ? const EmptyState(
                    icon: Icons.sports_rounded,
                    title: 'You’re this week’s picker.',
                    message:
                        'The picker is excluded from winner picks for this '
                        'week. Build the slate, then follow results here.',
                  )
                : games.isEmpty
                ? EmptyState(
                    icon: Icons.hourglass_empty_rounded,
                    title: 'The slate is not ready yet',
                    message:
                        'The weekly picker must publish at least one game '
                        'before member picks open.',
                    action: OutlinedButton(
                      onPressed: () => context.go('/dashboard'),
                      child: const Text('Back to dashboard'),
                    ),
                  )
                : ListView.separated(
                    key: const Key('pick-game-list'),
                    itemCount: games.length,
                    separatorBuilder: (context, index) =>
                        const SizedBox(height: 14),
                    itemBuilder: (context, index) {
                      final game = games[index];
                      return _PickGameCard(
                        game: game,
                        selection: controller.picks[game.id],
                        authoritativePick: controller.pickFor(game.id),
                        syncState: controller.syncStateFor(game.id),
                        locked: controller.isGameLocked(game),
                        entryLocked: entryLocked,
                        saving: controller.pickRequestInFlight(game.id),
                        errorMessage: controller.pickErrorFor(game.id),
                        timezone: controller.leagueTimezone,
                        logoPolicy: catalogTeamLogoPolicy(
                          presentation: controller.catalogPresentation,
                          game: game,
                        ),
                        onChoose: (teamId) =>
                            controller.chooseTeam(game, teamId),
                        onRetry: () => controller.retryPick(game),
                      );
                    },
                  ),
          ),
          if (controller.canMakePicks && games.isNotEmpty) ...[
            const SizedBox(height: 14),
            _EntryBar(
              confirmed: confirmed,
              total: games.length,
              entryLocked: entryLocked,
              hasUnsynced: games.any(
                (game) =>
                    controller.picks.containsKey(game.id) &&
                    controller.syncStateFor(game.id) != PickSyncState.synced,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ProgressPill extends StatelessWidget {
  const _ProgressPill({
    required this.done,
    required this.total,
    required this.entryLocked,
  });

  final int done;
  final int total;
  final bool entryLocked;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: entryLocked
          ? 'All picks saved and locked'
          : '$done of $total picks confirmed',
      liveRegion: true,
      child: StatusPill(
        label: entryLocked ? 'Saved and locked' : '$done of $total confirmed',
        icon: entryLocked
            ? Icons.lock_rounded
            : done == total
            ? Icons.check_circle_rounded
            : Icons.pending_actions_rounded,
        tone: entryLocked || done == total
            ? StatusTone.success
            : StatusTone.info,
      ),
    );
  }
}

class _SyncWarning extends StatelessWidget {
  const _SyncWarning();

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      color: Theme.of(context).colorScheme.errorContainer,
      child: const Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.cloud_off_rounded),
          SizedBox(width: 12),
          Expanded(
            child: Text(
              'You’re offline. New choices remain local drafts and are not '
              'confirmed until the server accepts them before lock.',
            ),
          ),
        ],
      ),
    );
  }
}

class _PickGameCard extends StatelessWidget {
  const _PickGameCard({
    required this.game,
    required this.selection,
    required this.authoritativePick,
    required this.syncState,
    required this.locked,
    required this.entryLocked,
    required this.saving,
    required this.errorMessage,
    required this.timezone,
    required this.logoPolicy,
    required this.onChoose,
    required this.onRetry,
  });

  final Game game;
  final String? selection;
  final Pick? authoritativePick;
  final PickSyncState syncState;
  final bool locked;
  final bool entryLocked;
  final bool saving;
  final String? errorMessage;
  final String timezone;
  final TeamLogoPolicy logoPolicy;
  final ValueChanged<String> onChoose;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final selectionLocked = entryLocked || locked;
    final missing = selectionLocked && selection == null;
    final detail = gameDetailSummary(game);
    return SectionCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 8,
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    game.leagueName,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 3),
                  Text(
                    game.effectiveLockAtUtc == null
                        ? 'Pick deadline unavailable · commissioner review required'
                        : formatLeagueTime(
                            game.effectiveLockAtUtc!,
                            timezone,
                            'EEE, MMM d · h:mm a',
                          ),
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
              StatusPill(
                label: entryLocked
                    ? 'Entry locked'
                    : locked
                    ? 'Locked'
                    : 'Open',
                icon: selectionLocked
                    ? Icons.lock_rounded
                    : Icons.lock_open_rounded,
                tone: selectionLocked ? StatusTone.neutral : StatusTone.success,
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              StatusPill(
                key: Key('pick-game-status-${game.id}'),
                label: gameStatusLabel(game.status),
                tone: gameStatusTone(game.status),
              ),
              if (game.awayScore != null || game.homeScore != null)
                Text(
                  '${game.awayTeam.abbreviation} ${game.awayScore ?? '—'} – '
                  '${game.homeScore ?? '—'} ${game.homeTeam.abbreviation}',
                  key: Key('pick-game-score-${game.id}'),
                  style: Theme.of(
                    context,
                  ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w900),
                ),
              if (authoritativePick != null &&
                  authoritativePick!.outcome != PickOutcome.pending)
                _AuthoritativeOutcomePill(
                  key: Key('pick-game-outcome-${game.id}'),
                  pick: authoritativePick!,
                ),
            ],
          ),
          if (detail != null) ...[
            const SizedBox(height: 8),
            Text(
              detail,
              key: Key('pick-game-context-${game.id}'),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
          const SizedBox(height: 16),
          LayoutBuilder(
            builder: (context, constraints) {
              final away = _TeamChoice(
                gameId: game.id,
                team: game.awayTeam,
                selected: selection == game.awayTeam.id,
                enabled: !selectionLocked && !saving,
                logoPolicy: logoPolicy,
                onTap: () => onChoose(game.awayTeam.id),
              );
              final home = _TeamChoice(
                gameId: game.id,
                team: game.homeTeam,
                selected: selection == game.homeTeam.id,
                enabled: !selectionLocked && !saving,
                logoPolicy: logoPolicy,
                onTap: () => onChoose(game.homeTeam.id),
              );
              if (constraints.maxWidth < 580) {
                return Column(
                  children: [
                    away,
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 7),
                      child: Text(
                        'OR',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 1,
                        ),
                      ),
                    ),
                    home,
                  ],
                );
              }
              return Row(
                children: [
                  Expanded(child: away),
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 12),
                    child: Text(
                      'OR',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 1,
                      ),
                    ),
                  ),
                  Expanded(child: home),
                ],
              );
            },
          ),
          const SizedBox(height: 12),
          if (missing)
            const StatusPill(
              label: 'No pick · counted incorrect if graded',
              icon: Icons.remove_circle_outline_rounded,
              tone: StatusTone.danger,
            )
          else
            _SyncLabel(
              state: syncState,
              hasSelection: selection != null,
              entryLocked: entryLocked,
              errorMessage: errorMessage,
            ),
          if (!selectionLocked &&
              selection != null &&
              (syncState == PickSyncState.offline ||
                  syncState == PickSyncState.rejected)) ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                key: Key('retry-pick-${game.id}'),
                onPressed: saving ? null : onRetry,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Retry pick'),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _AuthoritativeOutcomePill extends StatelessWidget {
  const _AuthoritativeOutcomePill({super.key, required this.pick});

  final Pick pick;

  @override
  Widget build(BuildContext context) {
    final (label, tone, icon) = switch (pick.outcome) {
      PickOutcome.correct => (
        'Correct · +${pick.points}',
        StatusTone.success,
        Icons.check_circle_rounded,
      ),
      PickOutcome.incorrect => (
        'Incorrect · ${pick.points}',
        StatusTone.danger,
        Icons.cancel_rounded,
      ),
      PickOutcome.voided => (
        'Void · excluded',
        StatusTone.neutral,
        Icons.block_rounded,
      ),
      PickOutcome.pending => (
        'Grading pending',
        StatusTone.info,
        Icons.schedule_rounded,
      ),
    };
    return StatusPill(label: label, tone: tone, icon: icon);
  }
}

class _TeamChoice extends StatelessWidget {
  const _TeamChoice({
    required this.gameId,
    required this.team,
    required this.selected,
    required this.enabled,
    required this.logoPolicy,
    required this.onTap,
  });

  final String gameId;
  final Team team;
  final bool selected;
  final bool enabled;
  final TeamLogoPolicy logoPolicy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      button: true,
      selected: selected,
      enabled: enabled,
      inMutuallyExclusiveGroup: true,
      label:
          'Pick ${team.name}${selected ? ', currently selected' : ''}'
          '${enabled ? '' : ', locked'}',
      child: InkWell(
        key: Key('team-choice-$gameId-${team.id}'),
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(16),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 140),
          constraints: const BoxConstraints(minHeight: 82),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: selected
                ? scheme.primaryContainer
                : scheme.surfaceContainerLowest,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: selected
                  ? scheme.tertiary
                  : Theme.of(context).dividerColor,
              width: selected ? 2 : 1,
            ),
          ),
          child: Row(
            children: [
              TeamBadge(team: team, size: 46, logoPolicy: logoPolicy),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      team.name,
                      style: const TextStyle(fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      team.abbreviation,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
              Icon(
                selected
                    ? Icons.check_circle_rounded
                    : Icons.radio_button_unchecked_rounded,
                color: selected ? scheme.tertiary : scheme.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SyncLabel extends StatelessWidget {
  const _SyncLabel({
    required this.state,
    required this.hasSelection,
    required this.entryLocked,
    required this.errorMessage,
  });

  final PickSyncState state;
  final bool hasSelection;
  final bool entryLocked;
  final String? errorMessage;

  @override
  Widget build(BuildContext context) {
    if (!hasSelection) {
      return const StatusPill(
        label: 'Pick required',
        icon: Icons.circle_outlined,
      );
    }
    if (entryLocked) {
      return const StatusPill(
        label: 'Saved and locked',
        icon: Icons.lock_rounded,
        tone: StatusTone.success,
      );
    }
    return switch (state) {
      PickSyncState.saving => const StatusPill(
        label: 'Saving…',
        icon: Icons.sync_rounded,
        tone: StatusTone.info,
      ),
      PickSyncState.synced => const StatusPill(
        label: 'Saved and confirmed',
        icon: Icons.cloud_done_rounded,
        tone: StatusTone.success,
      ),
      PickSyncState.offline => const StatusPill(
        label: 'Local draft · not confirmed',
        icon: Icons.cloud_off_rounded,
        tone: StatusTone.warning,
      ),
      PickSyncState.rejected => StatusPill(
        label: errorMessage ?? 'Not accepted by the server',
        icon: Icons.error_outline_rounded,
        tone: StatusTone.danger,
      ),
      PickSyncState.idle => const StatusPill(
        label: 'Not yet confirmed',
        icon: Icons.cloud_upload_outlined,
        tone: StatusTone.warning,
      ),
    };
  }
}

class _EntryBar extends StatelessWidget {
  const _EntryBar({
    required this.confirmed,
    required this.total,
    required this.entryLocked,
    required this.hasUnsynced,
  });

  final int confirmed;
  final int total;
  final bool entryLocked;
  final bool hasUnsynced;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      padding: const EdgeInsets.all(14),
      child: Row(
        children: [
          Expanded(
            child: Text(
              entryLocked
                  ? 'Your picks are saved and locked'
                  : confirmed == total
                  ? hasUnsynced
                        ? 'Selections made · not all confirmed'
                        : 'Your entry is complete'
                  : '$confirmed of $total picks confirmed',
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
          ),
          FilledButton(
            onPressed: () => context.go('/results'),
            child: const Text('Review entry'),
          ),
        ],
      ),
    );
  }
}
