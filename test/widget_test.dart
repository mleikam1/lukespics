import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/app/app.dart';
import 'package:lukespics/app/bootstrap.dart';
import 'package:lukespics/data/demo/demo_repository.dart';

void main() {
  Future<void> pumpApp(
    WidgetTester tester, {
    required AppController controller,
    String initialLocation = '/',
    Size size = const Size(390, 844),
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      LukesPicksApp(
        bootstrap: const BootstrapResult(mode: AppRuntimeMode.demo),
        controller: controller,
        initialLocation: initialLocation,
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('signed-out state presents branded safe demo sign-in', (
    tester,
  ) async {
    await pumpApp(tester, controller: AppController.demo());

    expect(find.text('Welcome to the arena'), findsOneWidget);
    expect(find.byKey(const Key('google-sign-in-button')), findsOneWidget);
    expect(find.text('Privacy'), findsOneWidget);
    expect(find.textContaining('safe local demo data'), findsOneWidget);
  });

  testWidgets('sign-in reaches the create or join empty state', (tester) async {
    final controller = AppController.demo();
    await pumpApp(tester, controller: controller);

    await tester.tap(find.byKey(const Key('google-sign-in-button')));
    await tester.pumpAndSettle();

    expect(find.text('Your next rivalry starts here.'), findsOneWidget);
    expect(find.text('Create an arena'), findsOneWidget);
    expect(find.text('Join with invite code'), findsOneWidget);
  });

  testWidgets('member dashboard hides picker and commissioner navigation', (
    tester,
  ) async {
    await pumpApp(
      tester,
      controller: AppController.demo(signedIn: true, hasLeague: true),
      initialLocation: '/dashboard',
      size: const Size(1280, 900),
    );

    expect(find.text('Overall standings'), findsOneWidget);
    expect(find.text('Make your picks'), findsWidgets);
    expect(find.text('Draft slate'), findsNothing);
    expect(find.text('Admin review'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('picker catalog requires one game and checkbox is accessible', (
    tester,
  ) async {
    final controller = AppController.demo(signedIn: true, hasLeague: true)
      ..assumeDemoPersona('luke');
    for (final id in controller.selectedGameIds.toList()) {
      controller.toggleSlateGame(id);
    }
    await pumpApp(
      tester,
      controller: controller,
      initialLocation: '/catalog',
      size: const Size(768, 900),
    );

    final review = tester.widget<FilledButton>(
      find.byKey(const Key('review-slate-button')),
    );
    expect(review.onPressed, isNull);
    expect(
      tester
          .widget<OutlinedButton>(find.byKey(const Key('save-draft-button')))
          .onPressed,
      isNotNull,
    );

    final checkbox = find.byKey(const Key('catalog-checkbox-football-1'));
    expect(find.byKey(const Key('catalog-game-list')), findsOneWidget);
    await tester.scrollUntilVisible(
      checkbox,
      240,
      scrollable: find.descendant(
        of: find.byKey(const Key('catalog-game-list')),
        matching: find.byType(Scrollable),
      ),
    );
    await Scrollable.ensureVisible(
      tester.element(checkbox),
      alignment: 0.2,
      duration: Duration.zero,
    );
    await tester.pumpAndSettle();
    expect(checkbox, findsOneWidget);
    final semantics = tester.getSemantics(checkbox);
    expect(semantics.label, contains('Include'));
    await tester.tap(checkbox);
    await tester.pump();
    expect(controller.selectedGameIds, contains('football-1'));
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('review-slate-button')))
          .onPressed,
      isNotNull,
    );
  });

  testWidgets('catalog metadata drives filters without mobile overflow', (
    tester,
  ) async {
    final controller = AppController.demo(signedIn: true, hasLeague: true)
      ..assumeDemoPersona('luke');
    await pumpApp(
      tester,
      controller: controller,
      initialLocation: '/catalog',
      size: const Size(390, 844),
    );

    expect(find.byKey(const Key('sport-filter-Baseball')), findsOneWidget);
    expect(find.byKey(const Key('league-filter-pro-football')), findsOneWidget);
    expect(find.byKey(const Key('date-filter-today')), findsOneWidget);
    expect(find.byKey(const Key('sport-filter-Soccer')), findsNothing);
    expect(find.text('All'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('review shows cross-query games and removes the final game', (
    tester,
  ) async {
    final controller = AppController.demo(signedIn: true, hasLeague: true)
      ..assumeDemoPersona('luke');
    for (final id in controller.selectedGameIds.toList()) {
      controller.toggleSlateGame(id);
    }
    controller.toggleSlateGame('football-1');
    controller.toggleSlateGame('baseball-1');
    expect(controller.selectedGameIds, {'football-1', 'baseball-1'});

    await pumpApp(
      tester,
      controller: controller,
      initialLocation: '/slate/review',
      size: const Size(390, 844),
    );

    expect(find.text('Comets at Hawks'), findsOneWidget);
    expect(find.textContaining('Harbor Field'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Pines at Capitals'),
      200,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('Pines at Capitals'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Publish 2-game slate'),
      200,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('Publish 2-game slate'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.scrollUntilVisible(
      find.byTooltip('Remove Cedar Comets at Harbor Hawks'),
      -200,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.tap(find.byTooltip('Remove Cedar Comets at Harbor Hawks'));
    await tester.pump();
    expect(controller.selectedGameIds, {'baseball-1'});
    await tester.scrollUntilVisible(
      find.text('Publish 1-game slate'),
      200,
      scrollable: find.byType(Scrollable).last,
    );
    expect(find.text('Publish 1-game slate'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.byTooltip('Remove North Pines at River Capitals'),
      -200,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.tap(find.byTooltip('Remove North Pines at River Capitals'));
    await tester.pump();
    expect(controller.selectedGameIds, isEmpty);
    expect(find.text('Select at least one game'), findsOneWidget);
  });

  testWidgets('winner choices are exclusive and become server-confirmed', (
    tester,
  ) async {
    final controller = AppController.demo(signedIn: true, hasLeague: true);
    await pumpApp(
      tester,
      controller: controller,
      initialLocation: '/picks',
      size: const Size(900, 1000),
    );

    final awayChoice = find.byKey(const Key('team-choice-football-1-comets'));
    await tester.scrollUntilVisible(
      awayChoice,
      300,
      scrollable: find.descendant(
        of: find.byKey(const Key('pick-game-list')),
        matching: find.byType(Scrollable),
      ),
    );
    await tester.tap(awayChoice);
    await tester.pump();
    expect(find.text('Saving…'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 260));
    expect(find.text('Saved and confirmed'), findsWidgets);
    expect(controller.picks['football-1'], 'comets');

    final homeChoice = find.byKey(const Key('team-choice-football-1-hawks'));
    await tester.tap(homeChoice);
    await tester.pump(const Duration(milliseconds: 260));
    expect(controller.picks['football-1'], 'hawks');
  });

  testWidgets('offline choice stays an explicitly unconfirmed local draft', (
    tester,
  ) async {
    final controller = AppController.demo(
      signedIn: true,
      hasLeague: true,
      offline: true,
    );
    await pumpApp(
      tester,
      controller: controller,
      initialLocation: '/picks',
      size: const Size(900, 1000),
    );

    final choice = find.byKey(const Key('team-choice-football-1-comets'));
    await tester.scrollUntilVisible(
      choice,
      300,
      scrollable: find.descendant(
        of: find.byKey(const Key('pick-game-list')),
        matching: find.byType(Scrollable),
      ),
    );
    await tester.tap(choice);
    await tester.pump();

    expect(find.text('Local draft · not confirmed'), findsOneWidget);
    expect(controller.syncStateFor('football-1'), PickSyncState.offline);
  });

  testWidgets('locked missing pick is labeled without color-only meaning', (
    tester,
  ) async {
    await pumpApp(
      tester,
      controller: AppController.demo(signedIn: true, hasLeague: true),
      initialLocation: '/picks',
      size: const Size(900, 1200),
    );

    expect(find.text('No pick · counted incorrect if graded'), findsOneWidget);
    expect(find.text('Locked'), findsWidgets);
  });

  testWidgets('weekly picker is excluded when participation is disabled', (
    tester,
  ) async {
    final controller = AppController.demo(signedIn: true, hasLeague: true)
      ..assumeDemoPersona('luke');
    await pumpApp(tester, controller: controller, initialLocation: '/picks');

    expect(find.text('You’re this week’s picker.'), findsOneWidget);
    expect(find.byKey(const Key('pick-game-list')), findsNothing);
  });

  test('weekly picker can pick when participation is enabled', () async {
    final controller = AppController.demo(signedIn: true);
    await controller.createArena(
      name: 'Participation Arena',
      pickerParticipatesInPicks: true,
    );
    controller.assumeDemoPersona('luke');

    expect(controller.isCurrentUserPicker, isTrue);
    expect(controller.canMakePicks, isTrue);
  });

  testWidgets('standings switch between mobile cards and desktop table', (
    tester,
  ) async {
    await pumpApp(
      tester,
      controller: AppController.demo(signedIn: true, hasLeague: true),
      initialLocation: '/standings',
    );
    expect(find.byKey(const Key('mobile-standings')), findsOneWidget);
    expect(find.byType(DataTable), findsNothing);

    tester.view.physicalSize = const Size(1200, 900);
    await tester.pumpAndSettle();
    expect(find.byType(DataTable), findsOneWidget);
  });

  testWidgets('finalized result announces co-winners', (tester) async {
    final controller = AppController.demo(signedIn: true, hasLeague: true);
    await controller.simulateFinalResults();
    await controller.finalizeWeek();
    await pumpApp(
      tester,
      controller: controller,
      initialLocation: '/results',
      size: const Size(900, 1000),
    );

    expect(find.text('WEEK 9 CO-WINNERS'), findsOneWidget);
    expect(find.text('Mia Flores & Alex Morgan'), findsOneWidget);
  });

  testWidgets('direct admin route is guarded for a regular member', (
    tester,
  ) async {
    await pumpApp(
      tester,
      controller: AppController.demo(signedIn: true, hasLeague: true),
      initialLocation: '/admin',
      size: const Size(900, 900),
    );

    expect(find.textContaining('Good call, Alex'), findsOneWidget);
    expect(find.text('Review and finalize Week 9'), findsNothing);
  });
}
