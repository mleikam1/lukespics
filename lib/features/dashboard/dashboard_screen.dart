// ignore_for_file: use_null_aware_elements

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme/app_theme.dart';
import '../../core/domain/league_time.dart';
import '../../core/responsive/breakpoints.dart';
import '../../core/widgets/ui.dart';
import '../../data/demo/demo_repository.dart';
import '../../data/models/member.dart';
import '../../data/models/standing.dart';
import '../../data/repositories/league_repository.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.watch(appControllerProvider);
    final currentStanding = controller.standings.firstWhere(
      (standing) => standing.uid == controller.currentUserId,
      orElse: () => Standing(
        uid: controller.currentUserId,
        displayName: controller.displayName,
        totalPoints: 0,
        totalCorrect: 0,
        totalIncorrect: 0,
        totalVoid: 0,
        totalGraded: 0,
        eligibleWeeks: 0,
        pickerWeeks: 0,
        weeklyTitles: 0,
        bestWeekPoints: 0,
        currentRank: 0,
      ),
    );
    return ListView(
      key: const Key('dashboard-scroll'),
      padding: AppBreakpoints.pagePadding(context),
      children: [
        PageHeader(
          eyebrow: controller.leagueName,
          title: 'Good call, ${controller.displayName.split(' ').first}.',
          description:
              '${controller.weekLabel} is '
              '${_weekStatusLabel(controller.weekStatus).toLowerCase()}. '
              'Lock times use ${controller.leagueTimezone}; configured '
              'sessions confirm accepted actions with the backend.',
          action: StatusPill(
            label: controller.offline
                ? 'Offline · cached'
                : controller.isDemo
                ? 'Demo snapshot'
                : 'Connected',
            icon: controller.offline
                ? Icons.cloud_off_rounded
                : Icons.cloud_done_rounded,
            tone: controller.offline ? StatusTone.warning : StatusTone.success,
          ),
        ),
        if (controller.bootstrapMessage != null) ...[
          const SizedBox(height: 18),
          _NoticeBanner(message: controller.bootstrapMessage!),
        ],
        const SizedBox(height: 24),
        _WeekHero(controller: controller),
        const SizedBox(height: 20),
        _StatGrid(
          standing: currentStanding,
          latestWeekRecord: controller.latestWeekRecord,
        ),
        const SizedBox(height: 20),
        LayoutBuilder(
          builder: (context, constraints) {
            final standings = _StandingsPreview(
              standings: controller.standings,
            );
            final rotation = _RotationCard(
              members: controller.members,
              currentPickerId: controller.currentPickerId,
            );
            if (constraints.maxWidth >= 920) {
              return Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(flex: 7, child: standings),
                  const SizedBox(width: 20),
                  Expanded(flex: 5, child: rotation),
                ],
              );
            }
            return Column(
              children: [standings, const SizedBox(height: 20), rotation],
            );
          },
        ),
        const SizedBox(height: 20),
        LayoutBuilder(
          builder: (context, constraints) {
            final arena = _ArenaMembers(members: controller.members);
            final recent = _RecentWeek(controller: controller);
            if (constraints.maxWidth >= 920) {
              return Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(flex: 7, child: recent),
                  const SizedBox(width: 20),
                  const Expanded(flex: 5, child: _ArenaMembersFromProvider()),
                ],
              );
            }
            return Column(
              children: [arena, const SizedBox(height: 20), recent],
            );
          },
        ),
      ],
    );
  }
}

class _NoticeBanner extends StatelessWidget {
  const _NoticeBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      color: Theme.of(context).colorScheme.secondaryContainer,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline_rounded),
          const SizedBox(width: 12),
          Expanded(child: Text(message)),
        ],
      ),
    );
  }
}

class _WeekHero extends StatelessWidget {
  const _WeekHero({required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final selected = controller.selectedGames.length;
    final firstLock = controller.selectedGames.isEmpty
        ? null
        : controller.selectedGames
              .map((game) => game.effectiveLockAtUtc)
              .reduce((left, right) => left.isBefore(right) ? left : right);
    final lockLabel = firstLock == null
        ? 'No games selected'
        : 'First pick locks ${formatLeagueTime(firstLock, controller.leagueTimezone, 'EEE h:mm a')}';
    final status = _weekStatusLabel(controller.weekStatus);
    final shouldBuildSlate =
        controller.canDraftSlate && !controller.slatePublished;
    final actionPath = shouldBuildSlate
        ? '/catalog'
        : controller.canMakePicks
        ? '/picks'
        : '/results';
    final actionLabel = shouldBuildSlate
        ? 'Build the weekly slate'
        : controller.canMakePicks
        ? 'Make your picks'
        : 'Follow weekly results';
    return Semantics(
      container: true,
      label:
          '${controller.weekLabel} $status. '
          '${controller.currentPickerName} is weekly picker. '
          '$selected games selected.',
      child: Container(
        decoration: BoxDecoration(
          color: BrandColors.navy,
          borderRadius: BorderRadius.circular(24),
          boxShadow: [
            BoxShadow(
              color: BrandColors.navy.withValues(alpha: 0.2),
              blurRadius: 24,
              offset: const Offset(0, 12),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(24),
          child: Stack(
            children: [
              Positioned(
                right: -42,
                top: -72,
                child: Container(
                  width: 240,
                  height: 240,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: BrandColors.blue.withValues(alpha: 0.3),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(26),
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    final info = Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        StatusPill(
                          label:
                              '${controller.weekLabel.toUpperCase()} · '
                              '${status.toUpperCase()}',
                          icon: Icons.lock_open_rounded,
                          tone: controller.weekFinalized
                              ? StatusTone.success
                              : StatusTone.info,
                        ),
                        const SizedBox(height: 18),
                        const Text(
                          'Your picks are on the clock.',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 28,
                            fontWeight: FontWeight.w900,
                            letterSpacing: -0.5,
                          ),
                        ),
                        const SizedBox(height: 9),
                        Text(
                          '$selected games · $lockLabel',
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.76),
                            fontSize: 15,
                          ),
                        ),
                      ],
                    );
                    final action = Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            CircleAvatar(
                              backgroundColor: BrandColors.gold,
                              foregroundColor: BrandColors.navy,
                              child: Text(
                                _initials(controller.currentPickerName),
                                style: const TextStyle(
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'THIS WEEK’S PICKER',
                                    style: TextStyle(
                                      color: Colors.white.withValues(
                                        alpha: 0.62,
                                      ),
                                      fontSize: 10,
                                      fontWeight: FontWeight.w900,
                                      letterSpacing: 1,
                                    ),
                                  ),
                                  Text(
                                    controller.currentPickerName,
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 18),
                        FilledButton.icon(
                          onPressed: () => context.go(actionPath),
                          style: FilledButton.styleFrom(
                            backgroundColor: BrandColors.gold,
                            foregroundColor: BrandColors.navy,
                          ),
                          icon: Icon(
                            shouldBuildSlate
                                ? Icons.playlist_add_check_circle_rounded
                                : controller.canMakePicks
                                ? Icons.task_alt_rounded
                                : Icons.scoreboard_rounded,
                          ),
                          label: Text(actionLabel),
                        ),
                      ],
                    );
                    if (constraints.maxWidth < 720) {
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [info, const SizedBox(height: 24), action],
                      );
                    }
                    return Row(
                      children: [
                        Expanded(flex: 3, child: info),
                        const SizedBox(width: 32),
                        SizedBox(width: 290, child: action),
                      ],
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatGrid extends StatelessWidget {
  const _StatGrid({required this.standing, this.latestWeekRecord = '5 / 7'});

  final Standing standing;
  final String latestWeekRecord;

  @override
  Widget build(BuildContext context) {
    final accuracy = standing.overallAccuracy;
    final items = [
      ('Overall rank', '#${standing.currentRank}', Icons.emoji_events_outlined),
      ('Total points', '${standing.totalPoints}', Icons.sports_score_rounded),
      (
        'Overall accuracy',
        accuracy == null ? '—' : '${(accuracy * 100).round()}%',
        Icons.track_changes_rounded,
      ),
      ('Latest week', latestWeekRecord, Icons.calendar_view_week_rounded),
      (
        'Weekly titles',
        '${standing.weeklyTitles}',
        Icons.workspace_premium_outlined,
      ),
    ];
    return LayoutBuilder(
      builder: (context, constraints) {
        final count = constraints.maxWidth >= 1050
            ? 5
            : constraints.maxWidth >= 620
            ? 3
            : 2;
        const gap = 12.0;
        final width = (constraints.maxWidth - gap * (count - 1)) / count;
        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: [
            for (final item in items)
              SizedBox(
                width: width,
                child: _StatCard(label: item.$1, value: item.$2, icon: item.$3),
              ),
          ],
        );
      },
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.label,
    required this.value,
    required this.icon,
  });

  final String label;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      padding: const EdgeInsets.all(16),
      child: Semantics(
        label: '$label: $value',
        child: ExcludeSemantics(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                icon,
                size: 20,
                color: Theme.of(context).colorScheme.tertiary,
              ),
              const SizedBox(height: 14),
              Text(
                value,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StandingsPreview extends StatelessWidget {
  const _StandingsPreview({required this.standings});

  final List<Standing> standings;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      child: Column(
        children: [
          _SectionTitle(
            title: 'Overall standings',
            action: TextButton(
              onPressed: () => context.go('/standings'),
              child: const Text('View all'),
            ),
          ),
          const SizedBox(height: 8),
          if (standings.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 18),
              child: Text('Standings will appear after the first graded week.'),
            ),
          for (final standing in standings.take(4))
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 9),
              child: Row(
                children: [
                  Semantics(
                    label: 'Rank ${standing.currentRank}',
                    child: SizedBox(
                      width: 34,
                      child: Text(
                        '${standing.currentRank}',
                        style: const TextStyle(fontWeight: FontWeight.w900),
                      ),
                    ),
                  ),
                  CircleAvatar(
                    radius: 18,
                    child: Text(_initials(standing.displayName)),
                  ),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Text(
                      standing.displayName,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                  Text(
                    '${standing.totalPoints} pts',
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

class _RotationCard extends StatelessWidget {
  const _RotationCard({required this.members, required this.currentPickerId});

  final List<LeagueMember> members;
  final String currentPickerId;

  @override
  Widget build(BuildContext context) {
    final ordered = members.where((member) => member.isActive).toList()
      ..sort(
        (left, right) => left.rotationOrder.compareTo(right.rotationOrder),
      );
    final currentIndex = ordered.indexWhere(
      (member) => member.uid == currentPickerId,
    );
    final active = currentIndex <= 0
        ? ordered
        : [...ordered.skip(currentIndex), ...ordered.take(currentIndex)];
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _SectionTitle(
            title: 'Picker rotation',
            action: IconButton(
              tooltip: 'Manage rotation',
              onPressed: () => context.go('/members'),
              icon: const Icon(Icons.arrow_forward_rounded),
            ),
          ),
          const SizedBox(height: 14),
          for (var index = 0; index < active.length; index += 1)
            Padding(
              padding: const EdgeInsets.only(bottom: 13),
              child: Row(
                children: [
                  Container(
                    width: 28,
                    height: 28,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: index == 0
                          ? BrandColors.gold
                          : Theme.of(
                              context,
                            ).colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(9),
                    ),
                    child: Text(
                      index == 0 ? 'NOW' : '${index + 1}',
                      style: TextStyle(
                        color: index == 0 ? BrandColors.navy : null,
                        fontSize: index == 0 ? 8 : 12,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Text(
                      active[index].displayName,
                      style: TextStyle(
                        fontWeight: index == 0
                            ? FontWeight.w900
                            : FontWeight.w600,
                      ),
                    ),
                  ),
                  if (index == 0)
                    const StatusPill(label: 'Picker', tone: StatusTone.warning),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _RecentWeek extends StatelessWidget {
  const _RecentWeek({required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final liveWeek = controller.historyWeeks.isEmpty
        ? null
        : controller.historyWeeks.first;
    final label = liveWeek?.label ?? 'Week 8';
    final winnerNames = liveWeek == null
        ? 'Mia & Alex'
        : _winnerNames(liveWeek, controller.members);
    final points = liveWeek?.highScore ?? 6;
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _SectionTitle(title: '$label recap'),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: BrandColors.gold.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.emoji_events_rounded,
                  color: BrandColors.goldDark,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    '${liveWeek?.winnerUids.length == 1 ? 'Winner' : 'Co-winners'}: '
                    '$winnerNames',
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                ),
                Text(
                  '$points pts',
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Text(
            liveWeek == null
                ? 'Both leaders went 6–1. Shared first place gives each '
                      'member one weekly-title credit.'
                : 'Finalized results are preserved with their original '
                      'picker, rules, and eligibility snapshot.',
          ),
          const SizedBox(height: 12),
          TextButton.icon(
            onPressed: () => context.go('/history/${liveWeek?.id ?? 'week-8'}'),
            icon: const Icon(Icons.history_rounded),
            label: const Text('See full week'),
          ),
        ],
      ),
    );
  }
}

class _ArenaMembers extends StatelessWidget {
  const _ArenaMembers({required this.members});

  final List<LeagueMember> members;

  @override
  Widget build(BuildContext context) {
    final active = members.where((member) => member.isActive).toList();
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _SectionTitle(
            title: 'Arena members',
            action: Text('${active.length} active'),
          ),
          const SizedBox(height: 18),
          Wrap(
            spacing: 20,
            runSpacing: 18,
            children: [
              for (final member in active)
                SizedBox(
                  width: 76,
                  child: Column(
                    children: [
                      CircleAvatar(
                        radius: 25,
                        child: Text(_initials(member.displayName)),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        member.displayName.split(' ').first,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ArenaMembersFromProvider extends ConsumerWidget {
  const _ArenaMembersFromProvider();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return _ArenaMembers(members: ref.watch(appControllerProvider).members);
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title, this.action});

  final String title;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(title, style: Theme.of(context).textTheme.titleLarge),
        ),
        if (action != null) action!,
      ],
    );
  }
}

String _winnerNames(WeekSummary week, List<LeagueMember> members) {
  return week.winnerUids
      .map((uid) {
        final matches = members.where((member) => member.uid == uid);
        return matches.isEmpty ? 'Member' : matches.first.displayName;
      })
      .join(' & ');
}

String _weekStatusLabel(String status) => switch (status) {
  'inProgress' => 'In progress',
  'review' => 'Review',
  'reopened' => 'Reopened',
  'finalized' => 'Finalized',
  'draft' => 'Draft',
  _ => 'Open',
};

String _initials(String name) =>
    name.trim().split(RegExp(r'\s+')).take(2).map((part) => part[0]).join();
