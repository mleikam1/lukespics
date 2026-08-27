import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/app/app.dart';
import 'package:lukespics/app/bootstrap.dart';
import 'package:lukespics/data/demo/demo_repository.dart';
import 'package:timezone/data/latest.dart' as timezone_data;

void main() {
  setUpAll(timezone_data.initializeTimeZones);

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
    expect(
      tester
          .widget<Text>(find.byKey(const Key('review-game-context-football-1')))
          .data,
      'Prime-time opener · Kickoff scheduled for 7:00 PM',
    );
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
    final pickList = find.descendant(
      of: find.byKey(const Key('pick-game-list')),
      matching: find.byType(Scrollable),
    );
    await tester.scrollUntilVisible(awayChoice, 300, scrollable: pickList);
    await Scrollable.ensureVisible(
      tester.element(awayChoice),
      alignment: 0.3,
      duration: Duration.zero,
    );
    await tester.pumpAndSettle();
    expect(
      find.byKey(const Key('pick-game-context-football-1')),
      findsOneWidget,
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

  testWidgets('completed entry is shown as saved and locked', (tester) async {
    final controller = AppController.demo(
      signedIn: true,
      hasLeague: true,
      entryLocked: true,
    );
    await pumpApp(
      tester,
      controller: controller,
      initialLocation: '/picks',
      size: const Size(900, 1200),
    );

    expect(controller.entryLocked, isTrue);
    expect(
      find.text('All of your picks are saved and locked for this week.'),
      findsOneWidget,
    );
    expect(find.text('Saved and locked'), findsWidgets);
    expect(find.text('Entry locked'), findsWidgets);

    final choice = find.byKey(const Key('team-choice-football-1-comets'));
    await tester.scrollUntilVisible(
      choice,
      250,
      scrollable: find.descendant(
        of: find.byKey(const Key('pick-game-list')),
        matching: find.byType(Scrollable),
      ),
    );
    await tester.pumpAndSettle();

    expect(tester.widget<InkWell>(choice).onTap, isNull);
    expect(tester.getSemantics(choice).label, contains('locked'));
    await controller.chooseTeam(
      controller.selectedGames.firstWhere((game) => game.id == 'football-1'),
      'comets',
    );
    expect(controller.picks['football-1'], isNull);
  });

  testWidgets('pick cards show game status, score, and graded outcome', (
    tester,
  ) async {
    final controller = AppController.demo(signedIn: true, hasLeague: true);
    await pumpApp(
      tester,
      controller: controller,
      initialLocation: '/picks',
      size: const Size(900, 1000),
    );

    final score = find.byKey(const Key('pick-game-score-hockey-1'));
    await tester.scrollUntilVisible(
      score,
      260,
      scrollable: find.descendant(
        of: find.byKey(const Key('pick-game-list')),
        matching: find.byType(Scrollable),
      ),
    );

    expect(find.byKey(const Key('pick-game-status-hockey-1')), findsOneWidget);
    expect(tester.widget<Text>(score).data, 'AB 2 – 4 GB');
    expect(find.byKey(const Key('pick-game-outcome-hockey-1')), findsOneWidget);
    expect(find.text('Correct · +1'), findsOneWidget);
    expect(tester.takeException(), isNull);
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
    final pickList = find.descendant(
      of: find.byKey(const Key('pick-game-list')),
      matching: find.byType(Scrollable),
    );
    await tester.scrollUntilVisible(choice, 300, scrollable: pickList);
    await Scrollable.ensureVisible(
      tester.element(choice),
      alignment: 0.3,
      duration: Duration.zero,
    );
    await tester.pumpAndSettle();
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
    final eventContext = find.byKey(
      const Key('result-game-context-football-1'),
    );
    await tester.scrollUntilVisible(
      eventContext,
      300,
      scrollable: find.byType(Scrollable).last,
    );
    expect(
      tester.widget<Text>(eventContext).data,
      'Prime-time opener · Kickoff scheduled for 7:00 PM',
    );
  });

  testWidgets(
    'admin can force-refresh one game and confirm a reschedule override',
    (tester) async {
      final controller = AppController.demo(signedIn: true, hasLeague: true)
        ..assumeDemoPersona('mia');
      await pumpApp(
        tester,
        controller: controller,
        initialLocation: '/admin',
        size: const Size(900, 5000),
      );

      final persistedReason = find.byKey(
        const Key('admin-override-reason-hockey-1'),
      );
      expect(
        tester.widget<Text>(persistedReason).data,
        'Official score correction after reload.',
      );

      final forceRefresh = find.byKey(
        const Key('admin-force-refresh-football-1'),
      );
      await tester.tap(forceRefresh);
      await tester.pumpAndSettle();
      expect(
        find.textContaining(
          'Provider refresh found no changes for Comets at Hawks',
        ),
        findsOneWidget,
      );

      final override = find.byKey(const Key('admin-override-football-1'));
      await tester.ensureVisible(override);
      await tester.tap(override);
      await tester.pumpAndSettle();

      final save = find.byKey(const Key('save-override-button'));
      expect(tester.widget<FilledButton>(save).onPressed, isNull);
      await tester.tap(find.byKey(const Key('override-status-dropdown')));
      await tester.pumpAndSettle();
      expect(find.text('Delayed'), findsOneWidget);
      expect(find.text('Postponed'), findsWidgets);
      expect(find.text('Suspended'), findsOneWidget);
      await tester.tap(find.text('Delayed'));
      await tester.pumpAndSettle();

      final correctStart = find.byKey(
        const Key('override-correct-start-checkbox'),
      );
      await tester.ensureVisible(correctStart);
      await tester.tap(correctStart);
      await tester.pump();
      expect(find.byKey(const Key('override-date-button')), findsOneWidget);
      expect(find.byKey(const Key('override-time-button')), findsOneWidget);

      await tester.enterText(
        find.byKey(const Key('override-reason-field')),
        'Trusted schedule update',
      );
      final confirmation = find.byKey(
        const Key('override-confirmation-checkbox'),
      );
      await tester.ensureVisible(confirmation);
      await tester.tap(confirmation);
      await tester.pump();
      expect(tester.widget<FilledButton>(save).onPressed, isNotNull);
      await tester.tap(save);
      await tester.pumpAndSettle();

      expect(
        controller.overrideReasons['football-1'],
        'Trusted schedule update',
      );
      expect(tester.takeException(), isNull);
    },
  );

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
