import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/responsive/breakpoints.dart';
import '../../core/widgets/ui.dart';
import '../../data/demo/demo_repository.dart';

class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.watch(appControllerProvider);
    final items = [
      if (controller.canDraftSlate)
        (
          'Draft weekly slate',
          Icons.playlist_add_check_circle_rounded,
          '/catalog',
        ),
      ('Week history', Icons.history_rounded, '/history'),
      ('Members & rotation', Icons.groups_rounded, '/members'),
      if (controller.canAdmin)
        ('Commissioner review', Icons.rule_rounded, '/admin'),
      ('Settings & profile', Icons.settings_rounded, '/settings'),
    ];
    return ListView(
      padding: AppBreakpoints.pagePadding(context),
      children: [
        const PageHeader(
          eyebrow: 'Luke’s Picks Arena',
          title: 'More',
          description:
              'Manage the arena, browse the record book, and get help.',
        ),
        const SizedBox(height: 20),
        SectionCard(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Column(
            children: [
              for (final item in items)
                ListTile(
                  minTileHeight: 60,
                  leading: Icon(item.$2),
                  title: Text(
                    item.$1,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => context.go(item.$3),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
