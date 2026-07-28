import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../data/demo/demo_repository.dart';
import '../features/admin/admin_review_screen.dart';
import '../features/auth/sign_in_screen.dart';
import '../features/dashboard/dashboard_screen.dart';
import '../features/history/history_screen.dart';
import '../features/leagues/arena_gateway_screen.dart';
import '../features/legal/legal_screen.dart';
import '../features/members/members_screen.dart';
import '../features/more/more_screen.dart';
import '../features/picks/picks_screen.dart';
import '../features/results/results_screen.dart';
import '../features/settings/settings_screen.dart';
import '../features/sports_catalog/catalog_screen.dart';
import '../features/standings/standings_screen.dart';
import '../features/weekly_slate/slate_review_screen.dart';
import 'responsive_shell.dart';

GoRouter createAppRouter(
  AppController controller, {
  String initialLocation = '/',
}) {
  return GoRouter(
    initialLocation: initialLocation,
    refreshListenable: controller,
    redirect: (context, state) {
      final location = state.matchedLocation;
      final isLegal = location.startsWith('/legal');
      final isSignIn = location == '/sign-in';
      final isArena = location.startsWith('/arena');

      if (!controller.signedIn && !isSignIn && !isLegal) {
        return '/sign-in';
      }
      if (controller.signedIn && isSignIn) {
        return controller.hasLeague ? '/dashboard' : '/arena';
      }
      if (controller.signedIn &&
          !controller.hasLeague &&
          !isArena &&
          !isLegal) {
        return '/arena';
      }
      if (controller.signedIn && controller.hasLeague && isArena) {
        return '/dashboard';
      }
      if (controller.hasLeague &&
          (location == '/catalog' || location.startsWith('/slate')) &&
          !controller.canDraftSlate) {
        return '/dashboard';
      }
      if (controller.hasLeague &&
          location.startsWith('/admin') &&
          !controller.canAdmin) {
        return '/dashboard';
      }
      if (location == '/') {
        return controller.signedIn
            ? (controller.hasLeague ? '/dashboard' : '/arena')
            : '/sign-in';
      }
      return null;
    },
    errorBuilder: (context, state) => _UnknownRoute(error: state.error),
    routes: [
      GoRoute(
        path: '/sign-in',
        builder: (context, state) => const SignInScreen(),
      ),
      GoRoute(
        path: '/arena',
        builder: (context, state) => const ArenaGatewayScreen(),
        routes: [
          GoRoute(
            path: 'create',
            builder: (context, state) =>
                const ArenaGatewayScreen(initialMode: ArenaMode.create),
          ),
          GoRoute(
            path: 'join',
            builder: (context, state) =>
                const ArenaGatewayScreen(initialMode: ArenaMode.join),
          ),
        ],
      ),
      GoRoute(
        path: '/legal/:page',
        builder: (context, state) =>
            LegalScreen(page: state.pathParameters['page'] ?? 'privacy'),
      ),
      ShellRoute(
        builder: (context, state, child) => ResponsiveShell(
          currentLocation: state.matchedLocation,
          child: child,
        ),
        routes: [
          GoRoute(
            path: '/dashboard',
            builder: (context, state) => const DashboardScreen(),
          ),
          GoRoute(
            path: '/catalog',
            builder: (context, state) => const CatalogScreen(),
          ),
          GoRoute(
            path: '/slate/review',
            builder: (context, state) => const SlateReviewScreen(),
          ),
          GoRoute(
            path: '/picks',
            builder: (context, state) => const PicksScreen(),
          ),
          GoRoute(
            path: '/results',
            builder: (context, state) => const ResultsScreen(),
          ),
          GoRoute(
            path: '/standings',
            builder: (context, state) => const StandingsScreen(),
          ),
          GoRoute(
            path: '/history',
            builder: (context, state) => const HistoryScreen(),
            routes: [
              GoRoute(
                path: ':weekId',
                builder: (context, state) => HistoryDetailScreen(
                  weekId: state.pathParameters['weekId'] ?? 'week-8',
                ),
              ),
            ],
          ),
          GoRoute(
            path: '/members',
            builder: (context, state) => const MembersScreen(),
          ),
          GoRoute(
            path: '/admin',
            builder: (context, state) => const AdminReviewScreen(),
          ),
          GoRoute(
            path: '/settings',
            builder: (context, state) => const SettingsScreen(),
          ),
          GoRoute(
            path: '/more',
            builder: (context, state) => const MoreScreen(),
          ),
        ],
      ),
    ],
  );
}

class _UnknownRoute extends StatelessWidget {
  const _UnknownRoute({this.error});

  final Exception? error;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.sports_score_rounded, size: 56),
              const SizedBox(height: 16),
              Text(
                'That page is out of bounds.',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 8),
              const Text('Check the address or head back to your arena.'),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () => context.go('/dashboard'),
                child: const Text('Go to dashboard'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
