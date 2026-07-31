import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/bootstrap.dart';
import '../../app/theme/app_theme.dart';
import '../../core/responsive/breakpoints.dart';
import '../../core/widgets/ui.dart';
import '../../data/demo/demo_repository.dart';
import '../../data/models/game.dart';
import '../../data/models/member.dart';
import '../../data/repositories/league_repository.dart';

class ResultsScreen extends ConsumerWidget {
  const ResultsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.watch(appControllerProvider);
    final games = controller.isDemo
        ? controller.selectedGames
        : controller.selectedWeekGames;
    final finals = games
        .where(
          (game) =>
              game.status == GameStatus.finalStatus ||
              game.status == GameStatus.voided,
        )
        .length;
    final live = games.where((game) => game.status == GameStatus.live).length;
    return ListView(
      padding: AppBreakpoints.pagePadding(context),
      children: [
        PageHeader(
          eyebrow: controller.weekFinalized
              ? '${controller.weekLabel} · Finalized'
              : '${controller.weekLabel} · In progress',
          title: 'Weekly results',
          description:
              'Member choices stay private until each game locks. Results are '
              'provisional until a commissioner finalizes the week.',
          action: controller.weekFinalized
              ? const StatusPill(
                  label: 'Final',
                  icon: Icons.verified_rounded,
                  tone: StatusTone.success,
                )
              : const StatusPill(
                  label: 'Provisional',
                  icon: Icons.hourglass_top_rounded,
                  tone: StatusTone.warning,
                ),
        ),
        const SizedBox(height: 22),
        if (controller.weekFinalized && controller.isDemo)
          const _WinnerBanner()
        else if (controller.weekFinalized &&
            controller.entries.any((entry) => entry.isWeeklyWinner))
          _LiveWinnerBanner(
            entries: controller.entries,
            members: controller.members,
          )
        else
          _ScoreboardSummary(
            weekLabel: controller.weekLabel,
            finalCount: finals,
            liveCount: live,
            total: games.length,
          ),
        const SizedBox(height: 18),
        if (controller.isDemo)
          const _WeeklyLeaderboard()
        else if (controller.entries.isNotEmpty)
          _LiveWeeklyLeaderboard(
            entries: controller.entries,
            members: controller.members,
          )
        else
          const EmptyState(
            icon: Icons.sync_rounded,
            title: 'No public entry summary loaded',
            message:
                'Configured sessions read public entry summaries from '
                'Firestore. Demo names and scores are never substituted.',
          ),
        const SizedBox(height: 18),
        Row(
          children: [
            Expanded(
              child: Text(
                'Game results',
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            if (controller.canAdmin)
              TextButton.icon(
                onPressed: () => context.go('/admin'),
                icon: const Icon(Icons.rule_rounded),
                label: const Text('Commissioner review'),
              ),
          ],
        ),
        const SizedBox(height: 10),
        if (games.isEmpty)
          const EmptyState(
            icon: Icons.scoreboard_outlined,
            title: 'No results yet',
            message: 'Results appear after the weekly slate is published.',
          )
        else
          for (final game in games) ...[
            _ResultGameCard(
              game: game,
              selectedTeamId: controller.picks[game.id],
              locked: controller.isGameLocked(game),
              showDemoReveals: controller.isDemo,
              revealedPicks: controller.revealsFor(game.id),
              logoPolicy: _logoPolicy(controller, game),
            ),
            const SizedBox(height: 12),
          ],
      ],
    );
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
}

class _ScoreboardSummary extends StatelessWidget {
  const _ScoreboardSummary({
    required this.weekLabel,
    required this.finalCount,
    required this.liveCount,
    required this.total,
  });

  final String weekLabel;
  final int finalCount;
  final int liveCount;
  final int total;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: BrandColors.navy,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Wrap(
        spacing: 28,
        runSpacing: 16,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text(
            weekLabel.toUpperCase(),
            style: const TextStyle(
              color: BrandColors.gold,
              fontSize: 20,
              fontWeight: FontWeight.w900,
              letterSpacing: 1.2,
            ),
          ),
          _DarkMetric(label: 'Final / void', value: '$finalCount'),
          _DarkMetric(label: 'Live', value: '$liveCount'),
          _DarkMetric(
            label: 'Scheduled',
            value: '${total - finalCount - liveCount}',
          ),
        ],
      ),
    );
  }
}

class _DarkMetric extends StatelessWidget {
  const _DarkMetric({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          value,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 24,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(width: 7),
        Text(
          label,
          style: TextStyle(color: Colors.white.withValues(alpha: 0.66)),
        ),
      ],
    );
  }
}

class _WinnerBanner extends StatelessWidget {
  const _WinnerBanner();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Week 9 co-winners Mia Flores and Alex Morgan with 5 points',
      child: Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [BrandColors.gold, Color(0xFFFFE29D)],
          ),
          borderRadius: BorderRadius.circular(22),
        ),
        child: const Row(
          children: [
            Icon(Icons.emoji_events_rounded, color: BrandColors.navy, size: 38),
            SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'WEEK 9 CO-WINNERS',
                    style: TextStyle(
                      color: BrandColors.navy,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 1,
                      fontSize: 11,
                    ),
                  ),
                  SizedBox(height: 4),
                  Text(
                    'Mia Flores & Alex Morgan',
                    style: TextStyle(
                      color: BrandColors.navy,
                      fontWeight: FontWeight.w900,
                      fontSize: 21,
                    ),
                  ),
                ],
              ),
            ),
            Text(
              '5 pts',
              style: TextStyle(
                color: BrandColors.navy,
                fontSize: 22,
                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _LiveWinnerBanner extends StatelessWidget {
  const _LiveWinnerBanner({required this.entries, required this.members});

  final List<EntrySummary> entries;
  final List<LeagueMember> members;

  @override
  Widget build(BuildContext context) {
    final winners = entries.where((entry) => entry.isWeeklyWinner).toList();
    final names = winners
        .map((entry) => _memberName(members, entry.uid))
        .join(' & ');
    final highScore = winners.isEmpty
        ? 0
        : winners
              .map((entry) => entry.points)
              .reduce((left, right) => left > right ? left : right);
    return Semantics(
      label:
          '${winners.length > 1 ? 'Co-winners' : 'Winner'} $names with '
          '$highScore points',
      child: Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [BrandColors.gold, Color(0xFFFFE29D)],
          ),
          borderRadius: BorderRadius.circular(22),
        ),
        child: Row(
          children: [
            const Icon(
              Icons.emoji_events_rounded,
              color: BrandColors.navy,
              size: 38,
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    winners.length > 1 ? 'CO-WINNERS' : 'WEEKLY WINNER',
                    style: const TextStyle(
                      color: BrandColors.navy,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 1,
                      fontSize: 11,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    names,
                    style: const TextStyle(
                      color: BrandColors.navy,
                      fontWeight: FontWeight.w900,
                      fontSize: 21,
                    ),
                  ),
                ],
              ),
            ),
            Text(
              '$highScore pts',
              style: const TextStyle(
                color: BrandColors.navy,
                fontSize: 22,
                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _WeeklyLeaderboard extends StatelessWidget {
  const _WeeklyLeaderboard();

  @override
  Widget build(BuildContext context) {
    const rows = [
      ('1', 'Mia Flores', '3–1', '3'),
      ('1', 'Alex Morgan', '3–1', '3'),
      ('3', 'Jordan Lee', '2–2', '2'),
    ];
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Provisional leaderboard',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 12),
          for (final row in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 9),
              child: Row(
                children: [
                  SizedBox(
                    width: 32,
                    child: Text(
                      '#${row.$1}',
                      style: const TextStyle(fontWeight: FontWeight.w900),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      row.$2,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                  Text(row.$3),
                  const SizedBox(width: 20),
                  Text(
                    '${row.$4} pts',
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _LiveWeeklyLeaderboard extends StatelessWidget {
  const _LiveWeeklyLeaderboard({required this.entries, required this.members});

  final List<EntrySummary> entries;
  final List<LeagueMember> members;

  @override
  Widget build(BuildContext context) {
    final rows = [...entries]
      ..sort((left, right) {
        final leftRank = left.weeklyRank ?? 1 << 20;
        final rightRank = right.weeklyRank ?? 1 << 20;
        final rankOrder = leftRank.compareTo(rightRank);
        return rankOrder != 0 ? rankOrder : right.points.compareTo(left.points);
      });
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Provisional leaderboard',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 12),
          for (final entry in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 9),
              child: Row(
                children: [
                  SizedBox(
                    width: 38,
                    child: Text(
                      entry.weeklyRank == null ? '—' : '#${entry.weeklyRank}',
                      style: const TextStyle(fontWeight: FontWeight.w900),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      _memberName(members, entry.uid),
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                  Text(
                    entry.eligible
                        ? '${entry.correctCount}–${entry.incorrectCount}'
                        : 'Ineligible',
                  ),
                  const SizedBox(width: 20),
                  Text(
                    '${entry.points} pts',
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _ResultGameCard extends StatelessWidget {
  const _ResultGameCard({
    required this.game,
    required this.selectedTeamId,
    required this.locked,
    required this.showDemoReveals,
    required this.revealedPicks,
    required this.logoPolicy,
  });

  final Game game;
  final String? selectedTeamId;
  final bool locked;
  final bool showDemoReveals;
  final List<RevealedPick> revealedPicks;
  final TeamLogoPolicy logoPolicy;

  @override
  Widget build(BuildContext context) {
    final hasScore = game.homeScore != null || game.awayScore != null;
    final selectedWinner =
        selectedTeamId != null && selectedTeamId == game.winnerTeamId;
    final outcome = game.isVoid
        ? ('Void · excluded', StatusTone.neutral, Icons.block_rounded)
        : game.status != GameStatus.finalStatus
        ? ('Pending', StatusTone.info, Icons.schedule_rounded)
        : selectedTeamId == null
        ? (
            'Missing · incorrect',
            StatusTone.danger,
            Icons.remove_circle_outline,
          )
        : selectedWinner
        ? ('Correct · +1', StatusTone.success, Icons.check_circle_rounded)
        : ('Incorrect · 0', StatusTone.danger, Icons.cancel_outlined);
    return SectionCard(
      padding: const EdgeInsets.all(18),
      child: Column(
        children: [
          Row(
            children: [
              TeamBadge(team: game.awayTeam, size: 42, logoPolicy: logoPolicy),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  game.awayTeam.shortName,
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ),
              Text(
                hasScore ? '${game.awayScore ?? '—'}' : '—',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 12),
                child: Text('–'),
              ),
              Text(
                hasScore ? '${game.homeScore ?? '—'}' : '—',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  game.homeTeam.shortName,
                  textAlign: TextAlign.end,
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ),
              const SizedBox(width: 10),
              TeamBadge(team: game.homeTeam, size: 42, logoPolicy: logoPolicy),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              StatusPill(
                label: gameStatusLabel(game.status),
                tone: gameStatusTone(game.status),
              ),
              const SizedBox(width: 8),
              StatusPill(label: outcome.$1, tone: outcome.$2, icon: outcome.$3),
            ],
          ),
          const Divider(height: 28),
          if (!locked)
            Row(
              children: [
                const Icon(Icons.visibility_off_outlined, size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Other member picks remain private until lock.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              ],
            )
          else if (showDemoReveals)
            const Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                StatusPill(label: 'Mia · Home', tone: StatusTone.neutral),
                StatusPill(label: 'Alex · Home', tone: StatusTone.neutral),
                StatusPill(label: 'Jordan · Away', tone: StatusTone.neutral),
              ],
            )
          else if (revealedPicks.isNotEmpty)
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final pick in revealedPicks)
                  StatusPill(
                    label:
                        '${pick.displayName} · '
                        '${_teamLabel(game, pick.selectedTeamId)}',
                    tone: StatusTone.neutral,
                  ),
              ],
            )
          else
            const Text('No revealed member picks are available yet.'),
        ],
      ),
    );
  }
}

String _memberName(List<LeagueMember> members, String uid) {
  final matches = members.where((member) => member.uid == uid);
  return matches.isEmpty ? 'Member' : matches.first.displayName;
}

String _teamLabel(Game game, String teamId) {
  if (teamId == game.homeTeam.id) return game.homeTeam.shortName;
  if (teamId == game.awayTeam.id) return game.awayTeam.shortName;
  return 'Selection';
}
