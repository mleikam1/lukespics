import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/app/app.dart';
import 'package:lukespics/app/bootstrap.dart';
import 'package:lukespics/data/demo/demo_repository.dart';
import 'package:lukespics/data/repositories/league_repository.dart';
import 'package:mocktail/mocktail.dart';

class _MockLeagueRepository extends Mock implements LeagueRepository {}

class _MockFirebaseAuth extends Mock implements FirebaseAuth {}

class _MockUser extends Mock implements User {}

const _inviteCode = 'AbCdEfGhIjKlMnOpQrStUvWx';

void main() {
  Future<void> pumpDemo(
    WidgetTester tester, {
    required AppController controller,
    required String initialLocation,
  }) async {
    await tester.pumpWidget(
      LukesPicksApp(
        bootstrap: const BootstrapResult(mode: AppRuntimeMode.demo),
        controller: controller,
        initialLocation: initialLocation,
      ),
    );
    await tester.pumpAndSettle();
  }

  TextField inviteField(WidgetTester tester) => tester.widget<TextField>(
    find.byKey(const Key('arena-invite-code-field')),
  );

  testWidgets('fragment invite survives sign-in and prefills without joining', (
    tester,
  ) async {
    final controller = AppController.demo();
    await pumpDemo(
      tester,
      controller: controller,
      initialLocation: '/arena/join#invite=$_inviteCode',
    );

    expect(find.text('Welcome to the arena'), findsOneWidget);
    expect(find.byKey(const Key('arena-invite-code-field')), findsNothing);

    await tester.tap(find.byKey(const Key('google-sign-in-button')));
    await tester.pumpAndSettle();

    expect(find.text('Join an arena'), findsOneWidget);
    expect(inviteField(tester).controller!.text, _inviteCode);
    expect(controller.hasLeague, isFalse);
  });

  testWidgets(
    'join field preserves invite case and disables smart transforms',
    (tester) async {
      await pumpDemo(
        tester,
        controller: AppController.demo(signedIn: true),
        initialLocation: '/arena/join#invite=$_inviteCode',
      );

      final field = inviteField(tester);
      expect(field.controller!.text, _inviteCode);
      expect(field.textCapitalization, TextCapitalization.none);
      expect(field.autocorrect, isFalse);
      expect(field.enableSuggestions, isFalse);
      expect(field.smartDashesType, SmartDashesType.disabled);
      expect(field.smartQuotesType, SmartQuotesType.disabled);
    },
  );

  testWidgets('successful invite confirmation navigates to a scrubbed route', (
    tester,
  ) async {
    final controller = AppController.demo(signedIn: true);
    await pumpDemo(
      tester,
      controller: controller,
      initialLocation: '/arena/join#invite=$_inviteCode',
    );

    await tester.tap(find.text('Join arena'));
    await tester.pumpAndSettle();

    expect(controller.hasLeague, isTrue);
    expect(find.byKey(const Key('dashboard-scroll')), findsOneWidget);
    expect(find.byKey(const Key('arena-invite-code-field')), findsNothing);
  });

  for (final parameter in ['code', 'invite']) {
    testWidgets('accepts compatible $parameter query invite', (tester) async {
      await pumpDemo(
        tester,
        controller: AppController.demo(signedIn: true),
        initialLocation: '/arena/join?$parameter=$_inviteCode',
      );

      expect(inviteField(tester).controller!.text, _inviteCode);
    });
  }

  for (final invalidValue in ['short', List<String>.filled(65, 'A').join()]) {
    testWidgets('ignores invalid deep-link invite ${invalidValue.length}', (
      tester,
    ) async {
      await pumpDemo(
        tester,
        controller: AppController.demo(signedIn: true),
        initialLocation: '/arena/join#invite=$invalidValue',
      );

      expect(inviteField(tester).controller!.text, isEmpty);
    });
  }

  testWidgets('restoring arena handoff retains the invite fragment', (
    tester,
  ) async {
    final memberships = Completer<List<String>>();
    final repository = _MockLeagueRepository();
    final auth = _MockFirebaseAuth();
    final user = _MockUser();
    when(() => user.uid).thenReturn('invited-member');
    when(() => user.displayName).thenReturn('Invited Member');
    when(() => auth.currentUser).thenReturn(user);
    when(auth.authStateChanges).thenAnswer((_) => const Stream.empty());
    when(repository.findActiveLeagueIds).thenAnswer((_) => memberships.future);
    final controller = AppController.connected(
      runtimeMode: AppRuntimeMode.firebaseEmulator,
      repository: repository,
      auth: auth,
    );

    await tester.pumpWidget(
      LukesPicksApp(
        bootstrap: const BootstrapResult(mode: AppRuntimeMode.firebaseEmulator),
        controller: controller,
        initialLocation: '/arena/join#invite=$_inviteCode',
      ),
    );
    await tester.pump();

    expect(find.text('Restoring your arena…'), findsOneWidget);

    memberships.complete(const []);
    await tester.pumpAndSettle();

    expect(find.text('Join an arena'), findsOneWidget);
    expect(inviteField(tester).controller!.text, _inviteCode);
  });
}
