import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/responsive/breakpoints.dart';
import '../../core/widgets/ui.dart';
import '../../data/demo/demo_repository.dart';
import '../../data/models/standing.dart';

class StandingsScreen extends ConsumerWidget {
  const StandingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final standings = ref.watch(appControllerProvider).standings;
    return ListView(
      padding: AppBreakpoints.pagePadding(context),
      children: [
        const PageHeader(
          eyebrow: 'Season race',
          title: 'Overall standings',
          description:
              'Total correct picks determine the order. Accuracy, weekly '
              'titles, and graded opportunities provide context.',
        ),
        const SizedBox(height: 20),
        const _ScoringInfo(),
        const SizedBox(height: 16),
        LayoutBuilder(
          builder: (context, constraints) {
            if (constraints.maxWidth >= 800) {
              return _DesktopStandings(standings: standings);
            }
            return _MobileStandings(standings: standings);
          },
        ),
      ],
    );
  }
}

class _ScoringInfo extends StatelessWidget {
  const _ScoringInfo();

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      tilePadding: const EdgeInsets.symmetric(horizontal: 16),
      childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      leading: const Icon(Icons.info_outline_rounded),
      title: const Text(
        'How standings work',
        style: TextStyle(fontWeight: FontWeight.w800),
      ),
      children: const [
        Text(
          'One correct pick equals one point. Accuracy is correct picks divided '
          'by non-void graded picks. Weekly picker/ineligible weeks are '
          'excluded—not treated as missed entries. Equal competitive metrics '
          'share a rank.',
        ),
      ],
    );
  }
}

class _DesktopStandings extends StatelessWidget {
  const _DesktopStandings({required this.standings});

  final List<Standing> standings;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      padding: const EdgeInsets.all(8),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          columnSpacing: 28,
          columns: const [
            DataColumn(label: Text('Rank')),
            DataColumn(label: Text('Member')),
            DataColumn(label: Text('Points'), numeric: true),
            DataColumn(label: Text('Accuracy'), numeric: true),
            DataColumn(label: Text('Titles'), numeric: true),
            DataColumn(label: Text('Graded'), numeric: true),
            DataColumn(label: Text('Eligible weeks'), numeric: true),
            DataColumn(label: Text('Best week'), numeric: true),
          ],
          rows: [
            for (final standing in standings)
              DataRow(
                cells: [
                  DataCell(
                    Semantics(
                      label: 'Rank ${standing.currentRank}',
                      child: Text(
                        '#${standing.currentRank}',
                        style: const TextStyle(fontWeight: FontWeight.w900),
                      ),
                    ),
                  ),
                  DataCell(
                    Row(
                      children: [
                        CircleAvatar(
                          radius: 16,
                          child: Text(_initials(standing.displayName)),
                        ),
                        const SizedBox(width: 10),
                        Text(
                          standing.displayName,
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ],
                    ),
                  ),
                  DataCell(Text('${standing.totalPoints}')),
                  DataCell(Text(_accuracy(standing))),
                  DataCell(Text('${standing.weeklyTitles}')),
                  DataCell(Text('${standing.totalGraded}')),
                  DataCell(Text('${standing.eligibleWeeks}')),
                  DataCell(Text('${standing.bestWeekPoints}')),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

class _MobileStandings extends StatelessWidget {
  const _MobileStandings({required this.standings});

  final List<Standing> standings;

  @override
  Widget build(BuildContext context) {
    return Column(
      key: const Key('mobile-standings'),
      children: [
        for (final standing in standings) ...[
          SectionCard(
            padding: const EdgeInsets.all(17),
            child: Column(
              children: [
                Row(
                  children: [
                    Container(
                      width: 38,
                      height: 38,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.primaryContainer,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        '#${standing.currentRank}',
                        style: const TextStyle(fontWeight: FontWeight.w900),
                      ),
                    ),
                    const SizedBox(width: 11),
                    Expanded(
                      child: Text(
                        standing.displayName,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                    Text(
                      '${standing.totalPoints} pts',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                  ],
                ),
                const Divider(height: 26),
                Row(
                  children: [
                    Expanded(
                      child: _SmallMetric(
                        label: 'Accuracy',
                        value: _accuracy(standing),
                      ),
                    ),
                    Expanded(
                      child: _SmallMetric(
                        label: 'Weekly titles',
                        value: '${standing.weeklyTitles}',
                      ),
                    ),
                    Expanded(
                      child: _SmallMetric(
                        label: 'Graded picks',
                        value: '${standing.totalGraded}',
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
        ],
      ],
    );
  }
}

class _SmallMetric extends StatelessWidget {
  const _SmallMetric({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(value, style: const TextStyle(fontWeight: FontWeight.w900)),
        const SizedBox(height: 2),
        Text(
          label,
          textAlign: TextAlign.center,
          maxLines: 2,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

String _accuracy(Standing standing) {
  final value = standing.overallAccuracy;
  return value == null ? '—' : '${(value * 100).toStringAsFixed(1)}%';
}

String _initials(String name) =>
    name.split(' ').take(2).map((part) => part[0]).join();
