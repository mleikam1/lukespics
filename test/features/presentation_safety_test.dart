import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/app/app.dart';
import 'package:lukespics/app/bootstrap.dart';
import 'package:lukespics/data/demo/demo_repository.dart';
import 'package:lukespics/data/models/game.dart';
import 'package:lukespics/data/repositories/league_repository.dart';
import 'package:lukespics/features/legal/legal_screen.dart';
import 'package:lukespics/features/settings/settings_screen.dart';
import 'package:lukespics/features/standings/standings_screen.dart';
import 'package:mocktail/mocktail.dart';

class _MockFirebaseAuth extends Mock implements FirebaseAuth {}

class _MockLeagueRepository extends Mock implements LeagueRepository {}

void main() {
  Future<void> setViewport(WidgetTester tester, Size size) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }

  Future<void> pumpDemoApp(WidgetTester tester, {required Size size}) async {
    await setViewport(tester, size);
    await tester.pumpWidget(
      LukesPicksApp(
        bootstrap: const BootstrapResult(mode: AppRuntimeMode.demo),
        controller: AppController.demo(signedIn: true, hasLeague: true),
        initialLocation: '/dashboard',
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('shell remains usable at mobile, tablet, and desktop widths', (
    tester,
  ) async {
    await pumpDemoApp(tester, size: const Size(390, 844));
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(tester.takeException(), isNull);

    tester.view.physicalSize = const Size(768, 600);
    await tester.pumpAndSettle();
    expect(find.byType(NavigationRail), findsOneWidget);
    expect(
      tester.widget<NavigationRail>(find.byType(NavigationRail)).scrollable,
      isTrue,
    );
    expect(tester.takeException(), isNull);

    tester.view.physicalSize = const Size(1440, 900);
    await tester.pumpAndSettle();
    expect(find.byType(NavigationRail), findsOneWidget);
    expect(
      tester.widget<NavigationRail>(find.byType(NavigationRail)).extended,
      isTrue,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('owner settings hydrate authoritative week rules and timezone', (
    tester,
  ) async {
    await setViewport(tester, const Size(390, 1200));
    final controller = AppController.demo(signedIn: true, hasLeague: true)
      ..assumeDemoPersona('luke');

    await tester.pumpWidget(
      ProviderScope(
        overrides: [appControllerProvider.overrideWith((ref) => controller)],
        child: MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(2)),
            child: child!,
          ),
          home: const Scaffold(body: SettingsScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.byKey(const Key('picker-participation-setting')),
      300,
      scrollable: find
          .ancestor(
            of: find.text('Settings'),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    final pickerSetting = tester.widget<SwitchListTile>(
      find.byKey(const Key('picker-participation-setting')),
    );
    final lockSetting = tester.widget<SwitchListTile>(
      find.byKey(const Key('pick-lock-policy-setting')),
    );

    expect(pickerSetting.value, controller.pickerParticipatesInCurrentWeek);
    expect(
      lockSetting.value,
      controller.weekLockPolicy == PickLockPolicy.firstGame,
    );
    expect(find.text(controller.leagueTimezone), findsOneWidget);
    expect(find.textContaining('Current week snapshot'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('empty connected standings never substitute demo rows', (
    tester,
  ) async {
    await setViewport(tester, const Size(1440, 900));
    final auth = _MockFirebaseAuth();
    final repository = _MockLeagueRepository();
    when(() => auth.currentUser).thenReturn(null);
    when(() => auth.authStateChanges()).thenAnswer((_) => const Stream.empty());
    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [appControllerProvider.overrideWith((ref) => controller)],
        child: const MaterialApp(home: Scaffold(body: StandingsScreen())),
      ),
    );
    await tester.pump();

    expect(find.text('No standings yet'), findsOneWidget);
    expect(find.byType(DataTable), findsNothing);
    expect(find.text('Mia Flores'), findsNothing);
    expect(find.text('Alex Morgan'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('legal copy distinguishes test data and logo policy', (
    tester,
  ) async {
    await setViewport(tester, const Size(390, 844));
    await tester.pumpWidget(
      const MaterialApp(home: LegalScreen(page: 'data-sources')),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('Pre-release notice'), findsOneWidget);
    await tester.scrollUntilVisible(find.textContaining('testing-only'), 240);
    expect(find.textContaining('testing-only'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.textContaining('ESPN-hosted artwork'),
      240,
    );
    expect(find.textContaining('ESPN-hosted artwork'), findsOneWidget);
    expect(find.textContaining('July 2026'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
