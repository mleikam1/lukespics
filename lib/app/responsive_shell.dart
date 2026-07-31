import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/responsive/breakpoints.dart';
import '../core/widgets/brand_mark.dart';
import '../core/widgets/ui.dart';
import '../data/demo/demo_repository.dart';

final class _NavItem {
  const _NavItem(this.label, this.icon, this.path);

  final String label;
  final IconData icon;
  final String path;
}

const _primaryNav = [
  _NavItem('Home', Icons.home_rounded, '/dashboard'),
  _NavItem('Make picks', Icons.task_alt_rounded, '/picks'),
  _NavItem('Results', Icons.scoreboard_rounded, '/results'),
  _NavItem('Standings', Icons.leaderboard_rounded, '/standings'),
];

const _allNav = [
  _NavItem('Dashboard', Icons.home_rounded, '/dashboard'),
  _NavItem('Draft slate', Icons.playlist_add_check_circle_rounded, '/catalog'),
  _NavItem('Make picks', Icons.task_alt_rounded, '/picks'),
  _NavItem('Results', Icons.scoreboard_rounded, '/results'),
  _NavItem('Standings', Icons.leaderboard_rounded, '/standings'),
  _NavItem('History', Icons.history_rounded, '/history'),
  _NavItem('Members', Icons.groups_rounded, '/members'),
  _NavItem('Admin review', Icons.rule_rounded, '/admin'),
  _NavItem('Settings', Icons.settings_rounded, '/settings'),
];

class ResponsiveShell extends ConsumerWidget {
  const ResponsiveShell({
    super.key,
    required this.currentLocation,
    required this.child,
  });

  final String currentLocation;
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final windowClass = AppBreakpoints.of(context);
    final controller = ref.watch(appControllerProvider);
    final fullNav = _navigationFor(controller);
    final content = Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: AppBreakpoints.maxContent),
        child: child,
      ),
    );

    if (windowClass == WindowClass.mobile) {
      final selectedIndex = _mobileIndex(currentLocation);
      return Scaffold(
        appBar: AppBar(
          titleSpacing: 16,
          title: const BrandMark(size: 34),
          actions: [
            if (controller.isDemo) _DemoPersonaMenu(controller: controller),
            IconButton(
              tooltip: 'Open settings',
              onPressed: () => context.go('/settings'),
              icon: CircleAvatar(
                radius: 17,
                child: Text(_initials(controller.displayName)),
              ),
            ),
            const SizedBox(width: 8),
          ],
        ),
        body: content,
        bottomNavigationBar: NavigationBar(
          selectedIndex: selectedIndex,
          onDestinationSelected: (index) {
            if (index == _primaryNav.length) {
              context.go('/more');
            } else {
              context.go(_primaryNav[index].path);
            }
          },
          destinations: [
            for (final item in _primaryNav)
              NavigationDestination(
                icon: Icon(item.icon),
                selectedIcon: Icon(item.icon),
                label: item.label,
              ),
            const NavigationDestination(
              icon: Icon(Icons.more_horiz_rounded),
              label: 'More',
            ),
          ],
        ),
      );
    }

    final extended = windowClass == WindowClass.desktop;
    return Scaffold(
      body: SafeArea(
        child: Row(
          children: [
            Container(
              width: extended ? 252 : 82,
              decoration: BoxDecoration(
                color: Theme.of(context).brightness == Brightness.dark
                    ? const Color(0xFF0B1726)
                    : Colors.white,
                border: Border(
                  right: BorderSide(color: Theme.of(context).dividerColor),
                ),
              ),
              child: Column(
                children: [
                  Padding(
                    padding: EdgeInsets.fromLTRB(
                      extended ? 20 : 17,
                      20,
                      extended ? 20 : 17,
                      16,
                    ),
                    child: BrandMark(size: 46, showWordmark: extended),
                  ),
                  if (controller.isDemo && extended)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: _DemoPersonaMenu(controller: controller),
                    ),
                  Expanded(
                    child: NavigationRail(
                      extended: extended,
                      scrollable: true,
                      minWidth: 80,
                      minExtendedWidth: 248,
                      backgroundColor: Colors.transparent,
                      selectedIndex: _fullIndex(currentLocation, fullNav),
                      labelType: NavigationRailLabelType.none,
                      onDestinationSelected: (index) =>
                          context.go(fullNav[index].path),
                      destinations: [
                        for (final item in fullNav)
                          NavigationRailDestination(
                            icon: Icon(item.icon),
                            selectedIcon: Icon(item.icon),
                            label: Text(item.label),
                            padding: const EdgeInsets.symmetric(vertical: 3),
                          ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(14),
                    child: extended
                        ? Material(
                            color: Colors.transparent,
                            child: ListTile(
                              contentPadding: const EdgeInsets.symmetric(
                                horizontal: 8,
                              ),
                              leading: CircleAvatar(
                                child: Text(_initials(controller.displayName)),
                              ),
                              title: Text(
                                controller.displayName,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              subtitle: Text(
                                controller.isCurrentUserPicker
                                    ? 'Weekly picker'
                                    : _roleLabel(controller.currentRole.name),
                              ),
                              onTap: () => context.go('/settings'),
                            ),
                          )
                        : IconButton.filledTonal(
                            tooltip: 'Profile and settings',
                            onPressed: () => context.go('/settings'),
                            icon: Text(_initials(controller.displayName)),
                          ),
                  ),
                ],
              ),
            ),
            Expanded(child: content),
          ],
        ),
      ),
    );
  }

  int _mobileIndex(String location) {
    for (var index = 0; index < _primaryNav.length; index += 1) {
      if (location.startsWith(_primaryNav[index].path)) return index;
    }
    return _primaryNav.length;
  }

  int _fullIndex(String location, List<_NavItem> navigation) {
    for (var index = 0; index < navigation.length; index += 1) {
      if (location.startsWith(navigation[index].path)) return index;
    }
    if (location.startsWith('/slate')) {
      final draftIndex = navigation.indexWhere(
        (item) => item.path == '/catalog',
      );
      if (draftIndex >= 0) return draftIndex;
    }
    return 0;
  }
}

List<_NavItem> _navigationFor(AppController controller) => [
  for (final item in _allNav)
    if ((item.path != '/catalog' || controller.canDraftSlate) &&
        (item.path != '/admin' || controller.canAdmin))
      item,
];

class _DemoPersonaMenu extends StatelessWidget {
  const _DemoPersonaMenu({required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      tooltip: 'Switch demo persona',
      onSelected: controller.assumeDemoPersona,
      itemBuilder: (context) => const [
        PopupMenuItem(
          value: 'alex',
          child: ListTile(
            leading: Icon(Icons.person_rounded),
            title: Text('Alex · member'),
            contentPadding: EdgeInsets.zero,
          ),
        ),
        PopupMenuItem(
          value: 'luke',
          child: ListTile(
            leading: Icon(Icons.sports_rounded),
            title: Text('Luke · owner & picker'),
            contentPadding: EdgeInsets.zero,
          ),
        ),
        PopupMenuItem(
          value: 'mia',
          child: ListTile(
            leading: Icon(Icons.admin_panel_settings_rounded),
            title: Text('Mia · commissioner'),
            contentPadding: EdgeInsets.zero,
          ),
        ),
      ],
      child: const Padding(
        padding: EdgeInsets.all(8),
        child: StatusPill(
          label: 'Demo',
          icon: Icons.science_outlined,
          tone: StatusTone.info,
        ),
      ),
    );
  }
}

String _initials(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty);
  final initials = parts
      .take(2)
      .map((part) => part.characters.first.toUpperCase())
      .join();
  return initials.isEmpty ? '?' : initials;
}

String _roleLabel(String role) =>
    role.isEmpty ? 'Member' : '${role[0].toUpperCase()}${role.substring(1)}';
