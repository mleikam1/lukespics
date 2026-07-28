import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/domain/league_time.dart';
import '../../core/responsive/breakpoints.dart';
import '../../core/widgets/ui.dart';
import '../../data/demo/demo_repository.dart';
import '../../data/models/member.dart';

class MembersScreen extends ConsumerWidget {
  const MembersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.watch(appControllerProvider);
    final members = controller.members;
    return ListView(
      padding: AppBreakpoints.pagePadding(context),
      children: [
        const PageHeader(
          eyebrow: 'Arena management',
          title: 'Members and rotation',
          description:
              'The ordered rotation advances after finalization and skips '
              'inactive members. New members join at the end.',
        ),
        const SizedBox(height: 20),
        const SectionCard(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.history_toggle_off_rounded),
              SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Deactivating or removing a member preserves finalized '
                  'results. Historical identity may be anonymized after an '
                  'account deletion, but scores remain intact.',
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        for (var index = 0; index < members.length; index += 1) ...[
          _MemberCard(
            member: members[index],
            position: index,
            total: members.length,
            isCurrentPicker: members[index].uid == controller.currentPickerId,
            canManage: controller.canAdmin,
            timezone: controller.leagueTimezone,
            onMove: (direction) =>
                controller.moveMember(members[index].uid, direction),
            onToggleStatus: () =>
                controller.toggleMemberStatus(members[index].uid),
          ),
          const SizedBox(height: 12),
        ],
      ],
    );
  }
}

class _MemberCard extends StatelessWidget {
  const _MemberCard({
    required this.member,
    required this.position,
    required this.total,
    required this.isCurrentPicker,
    required this.canManage,
    required this.timezone,
    required this.onMove,
    required this.onToggleStatus,
  });

  final LeagueMember member;
  final int position;
  final int total;
  final bool isCurrentPicker;
  final bool canManage;
  final String timezone;
  final ValueChanged<int> onMove;
  final VoidCallback onToggleStatus;

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      padding: const EdgeInsets.all(16),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final identity = Row(
            children: [
              CircleAvatar(
                radius: 23,
                child: Text(_initials(member.displayName)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: 7,
                      runSpacing: 5,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          member.displayName,
                          style: const TextStyle(fontWeight: FontWeight.w900),
                        ),
                        if (isCurrentPicker)
                          const StatusPill(
                            label: 'Current picker',
                            tone: StatusTone.warning,
                          ),
                        if (!member.isActive)
                          const StatusPill(label: 'Inactive'),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${_roleLabel(member.role)} · Joined '
                      '${formatLeagueTime(member.joinedAt, timezone, 'MMM yyyy')}',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          );
          final controls = Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              IconButton(
                tooltip: 'Move ${member.displayName} earlier',
                onPressed: !canManage || position == 0
                    ? null
                    : () => onMove(-1),
                icon: const Icon(Icons.arrow_upward_rounded),
              ),
              IconButton(
                tooltip: 'Move ${member.displayName} later',
                onPressed: !canManage || position == total - 1
                    ? null
                    : () => onMove(1),
                icon: const Icon(Icons.arrow_downward_rounded),
              ),
              const SizedBox(width: 4),
              OutlinedButton(
                onPressed: !canManage || isCurrentPicker
                    ? null
                    : onToggleStatus,
                child: Text(member.isActive ? 'Deactivate' : 'Activate'),
              ),
            ],
          );
          if (constraints.maxWidth < 620) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                identity,
                const SizedBox(height: 12),
                Align(alignment: Alignment.centerRight, child: controls),
              ],
            );
          }
          return Row(
            children: [
              Expanded(child: identity),
              const SizedBox(width: 16),
              controls,
            ],
          );
        },
      ),
    );
  }
}

String _initials(String name) =>
    name.split(' ').take(2).map((part) => part[0]).join();

String _roleLabel(LeagueRole role) => switch (role) {
  LeagueRole.owner => 'Owner',
  LeagueRole.commissioner => 'Commissioner',
  LeagueRole.member => 'Member',
};
