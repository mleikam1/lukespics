import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme/app_theme.dart';
import '../../core/responsive/breakpoints.dart';
import '../../core/widgets/ui.dart';
import '../../data/demo/demo_repository.dart';
import '../../data/models/game.dart';
import '../../data/models/member.dart';
import '../../data/repositories/league_repository.dart';

class HistoryScreen extends ConsumerWidget {
  const HistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.watch(appControllerProvider);
    final isDemo = controller.isDemo;
    const weeks = [
      (8, 'Mia Flores & Alex Morgan', '6', 'Luke Carter'),
      (7, 'Jordan Lee', '7', 'Mia Flores'),
      (6, 'Luke Carter', '5', 'Alex Morgan'),
      (5, 'Mia Flores', '6', 'Jordan Lee'),
      (4, 'Alex Morgan', '7', 'Luke Carter'),
      (3, 'Luke Carter & Jordan Lee', '5', 'Mia Flores'),
    ];
    return ListView(
      padding: AppBreakpoints.pagePadding(context),
      children: [
        const PageHeader(
          eyebrow: 'The record book',
          title: 'Week history',
          description:
              'Finalized weeks preserve their original rules, eligibility, '
              'picker, games, and results.',
        ),
        const SizedBox(height: 22),
        if (!isDemo && controller.historyWeeks.isEmpty)
          const EmptyState(
            icon: Icons.history_rounded,
            title: 'No finalized weeks loaded',
            message:
                'Finalized week snapshots will appear here as the arena '
                'builds its record book.',
          )
        else if (!isDemo)
          for (final week in controller.historyWeeks) ...[
            _LiveHistoryCard(week: week, members: controller.members),
            const SizedBox(height: 12),
          ]
        else
          for (final week in weeks) ...[
            SectionCard(
              padding: const EdgeInsets.all(17),
              child: InkWell(
                onTap: () => context.go('/history/week-${week.$1}'),
                borderRadius: BorderRadius.circular(16),
                child: Padding(
                  padding: const EdgeInsets.all(4),
                  child: Row(
                    children: [
                      Container(
                        width: 54,
                        height: 54,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: BrandColors.navy,
                          borderRadius: BorderRadius.circular(15),
                        ),
                        child: Text(
                          'W${week.$1}',
                          style: const TextStyle(
                            color: BrandColors.gold,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              week.$2,
                              style: const TextStyle(
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Winner${week.$2.contains('&') ? 's' : ''} · '
                              '${week.$3} points · Picker: ${week.$4}',
                              style: Theme.of(context).textTheme.bodySmall
                                  ?.copyWith(
                                    color: Theme.of(
                                      context,
                                    ).colorScheme.onSurfaceVariant,
                                  ),
                            ),
                          ],
                        ),
                      ),
                      const Icon(Icons.chevron_right_rounded),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],
      ],
    );
  }
}

class _LiveHistoryCard extends StatelessWidget {
  const _LiveHistoryCard({required this.week, required this.members});

  final WeekSummary week;
  final List<LeagueMember> members;

  @override
  Widget build(BuildContext context) {
    final winnerNames = _namesFor(week.winnerUids, members);
    final pickerName = _nameFor(week.pickerUid, members);
    return SectionCard(
      padding: const EdgeInsets.all(17),
      child: InkWell(
        onTap: () => context.go('/history/${week.id}'),
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(4),
          child: Row(
            children: [
              Container(
                width: 54,
                height: 54,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: BrandColors.navy,
                  borderRadius: BorderRadius.circular(15),
                ),
                child: Text(
                  'W${week.sequentialNumber}',
                  style: const TextStyle(
                    color: BrandColors.gold,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      winnerNames.isEmpty ? 'No winner recorded' : winnerNames,
                      style: const TextStyle(fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${week.winnerUids.length == 1 ? 'Winner' : 'Winners'} · '
                      '${week.highScore ?? 0} points · Picker: $pickerName',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded),
            ],
          ),
        ),
      ),
    );
  }
}

class HistoryDetailScreen extends ConsumerWidget {
  const HistoryDetailScreen({super.key, required this.weekId});

  final String weekId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.watch(appControllerProvider);
    final matches = controller.historyWeeks.where((week) => week.id == weekId);
    final liveWeek = matches.isEmpty ? null : matches.first;
    if (liveWeek == null && !controller.isDemo) {
      return ListView(
        padding: AppBreakpoints.pagePadding(context),
        children: [
          PageHeader(
            eyebrow: 'Finalized snapshot',
            title: 'Week not found',
            description:
                'This finalized week is unavailable or you no longer have '
                'access to its arena.',
            action: OutlinedButton.icon(
              onPressed: () => context.go('/history'),
              icon: const Icon(Icons.arrow_back_rounded),
              label: const Text('All weeks'),
            ),
          ),
          const SizedBox(height: 22),
          const EmptyState(
            icon: Icons.search_off_rounded,
            title: 'No connected snapshot',
            message: 'No demo winner, picker, or score has been substituted.',
          ),
        ],
      );
    }
    final label = liveWeek?.label ?? weekId.replaceAll('week-', 'Week ');
    final pickerName = liveWeek == null
        ? 'Luke Carter'
        : _nameFor(liveWeek.pickerUid, controller.members);
    final winnerNames = liveWeek == null
        ? 'Mia Flores & Alex Morgan'
        : _namesFor(liveWeek.winnerUids, controller.members);
    final highScore = liveWeek?.highScore ?? 6;
    return ListView(
      padding: AppBreakpoints.pagePadding(context),
      children: [
        PageHeader(
          eyebrow: 'Finalized snapshot',
          title: label,
          description:
              'Picker: $pickerName · Per-game locks · Historical eligibility '
              'preserved · ${controller.leagueTimezone}',
          action: OutlinedButton.icon(
            onPressed: () => context.go('/history'),
            icon: const Icon(Icons.arrow_back_rounded),
            label: const Text('All weeks'),
          ),
        ),
        const SizedBox(height: 22),
        Semantics(
          label:
              '${liveWeek?.winnerUids.length == 1 ? 'Winner' : 'Co-winners'} '
              '$winnerNames with $highScore points',
          child: Container(
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(
              color: BrandColors.gold,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Row(
              children: [
                const Icon(Icons.emoji_events_rounded, color: BrandColors.navy),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    '${liveWeek?.winnerUids.length == 1 ? 'Winner' : 'Co-winners'} '
                    '· $winnerNames',
                    style: const TextStyle(
                      color: BrandColors.navy,
                      fontWeight: FontWeight.w900,
                      fontSize: 17,
                    ),
                  ),
                ),
                Text(
                  '$highScore pts',
                  style: const TextStyle(
                    color: BrandColors.navy,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 18),
        if (controller.isDemo)
          const SectionCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Participant scores',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
                ),
                SizedBox(height: 14),
                _HistoryScore(name: 'Mia Flores', score: '6–1', rank: '1'),
                _HistoryScore(name: 'Alex Morgan', score: '6–1', rank: '1'),
                _HistoryScore(name: 'Jordan Lee', score: '4–3', rank: '3'),
                _HistoryScore(
                  name: 'Luke Carter',
                  score: 'Picker · ineligible',
                  rank: '—',
                ),
              ],
            ),
          )
        else
          _HistoricalEntries(
            stream: controller.watchEntriesForWeek(weekId),
            members: controller.members,
          ),
        const SizedBox(height: 18),
        if (controller.isDemo)
          const EmptyState(
            icon: Icons.inventory_2_outlined,
            title: 'Historical game snapshot',
            message:
                'Configured sessions stream immutable game and revealed pick '
                'snapshots here. Demo mode keeps this summary compact.',
          )
        else
          _HistoricalGames(stream: controller.watchGamesForWeek(weekId)),
      ],
    );
  }
}

class _HistoricalEntries extends StatelessWidget {
  const _HistoricalEntries({required this.stream, required this.members});

  final Stream<List<EntrySummary>> stream;
  final List<LeagueMember> members;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<EntrySummary>>(
      stream: stream,
      builder: (context, snapshot) {
        final entries = [...?snapshot.data]
          ..sort((left, right) {
            final leftRank = left.weeklyRank ?? 1 << 20;
            final rightRank = right.weeklyRank ?? 1 << 20;
            return leftRank.compareTo(rightRank);
          });
        if (entries.isEmpty) {
          return const EmptyState(
            icon: Icons.people_outline_rounded,
            title: 'Participant snapshot unavailable',
            message: 'No public entry summaries were stored for this week.',
          );
        }
        return SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Participant scores',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 14),
              for (final entry in entries)
                _HistoryScore(
                  name: _nameFor(entry.uid, members),
                  score: entry.eligible
                      ? '${entry.correctCount}–${entry.incorrectCount}'
                      : 'Picker · ineligible',
                  rank: entry.weeklyRank?.toString() ?? '—',
                ),
            ],
          ),
        );
      },
    );
  }
}

class _HistoricalGames extends StatelessWidget {
  const _HistoricalGames({required this.stream});

  final Stream<List<Game>> stream;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<Game>>(
      stream: stream,
      builder: (context, snapshot) {
        final games = snapshot.data ?? const [];
        if (games.isEmpty) {
          return const EmptyState(
            icon: Icons.inventory_2_outlined,
            title: 'Historical game snapshot unavailable',
            message: 'No selected game snapshots were stored for this week.',
          );
        }
        return SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Selected games and results',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 12),
              for (final game in games)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 9),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${game.awayTeam.shortName} at '
                          '${game.homeTeam.shortName}',
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ),
                      Text(
                        game.isVoid
                            ? 'Void'
                            : '${game.awayScore ?? '—'}–'
                                  '${game.homeScore ?? '—'}',
                        style: const TextStyle(fontWeight: FontWeight.w900),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _HistoryScore extends StatelessWidget {
  const _HistoryScore({
    required this.name,
    required this.score,
    required this.rank,
  });

  final String name;
  final String score;
  final String rank;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 9),
      child: Row(
        children: [
          SizedBox(
            width: 36,
            child: Text(
              rank == '—' ? rank : '#$rank',
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
          ),
          Expanded(
            child: Text(
              name,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
          Text(score),
        ],
      ),
    );
  }
}

String _nameFor(String uid, List<LeagueMember> members) {
  final matches = members.where((member) => member.uid == uid);
  return matches.isEmpty ? 'Member' : matches.first.displayName;
}

String _namesFor(List<String> uids, List<LeagueMember> members) =>
    uids.map((uid) => _nameFor(uid, members)).join(' & ');
