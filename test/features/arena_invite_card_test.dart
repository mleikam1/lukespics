import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/core/invites/invite_share_gateway.dart';
import 'package:lukespics/data/demo/demo_repository.dart';
import 'package:lukespics/features/members/members_screen.dart';
import 'package:timezone/data/latest.dart' as timezone_data;

final class _RecordingShareGateway implements InviteShareGateway {
  String? text;
  String? title;
  Rect? origin;

  @override
  Future<void> share({
    required String text,
    required String title,
    required Rect origin,
  }) async {
    this.text = text;
    this.title = title;
    this.origin = origin;
  }
}

void main() {
  setUpAll(timezone_data.initializeTimeZones);

  Future<void> pumpMembers(
    WidgetTester tester,
    AppController controller, {
    InviteShareGateway? gateway,
  }) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          appControllerProvider.overrideWith((ref) => controller),
          if (gateway != null)
            inviteShareGatewayProvider.overrideWithValue(gateway),
        ],
        child: const MaterialApp(home: Scaffold(body: MembersScreen())),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('owner can create and share an invite from the member pool', (
    tester,
  ) async {
    final controller = AppController.demo(signedIn: true, hasLeague: true)
      ..assumeDemoPersona('luke');
    final gateway = _RecordingShareGateway();
    await pumpMembers(tester, controller, gateway: gateway);

    expect(find.text('Invite people'), findsOneWidget);
    expect(find.byKey(const Key('create-arena-invite')), findsOneWidget);

    await tester.tap(find.byKey(const Key('create-arena-invite')));
    await tester.pumpAndSettle();
    final codeFinder = find.byKey(const Key('arena-invite-code'));
    expect(codeFinder, findsOneWidget);
    final code = tester.widget<SelectableText>(codeFinder).data!;
    expect(code, matches(RegExp(r'^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$')));

    await tester.tap(find.byKey(const Key('share-arena-invite')));
    await tester.pumpAndSettle();

    expect(gateway.text, contains('lukes-picks.web.app/arena/join#invite='));
    expect(gateway.text, contains('Code: $code'));
    expect(gateway.title, contains('Luke’s Picks Arena'));
    expect(gateway.origin, isNotNull);
    expect(gateway.origin!.isEmpty, isFalse);
    expect(tester.takeException(), isNull);

    final revokeButton = find.byKey(const Key('revoke-arena-invite'));
    await tester.ensureVisible(revokeButton);
    await tester.pumpAndSettle();
    await tester.tap(revokeButton);
    await tester.pumpAndSettle();
    expect(find.text('Disable this invite?'), findsOneWidget);
    await tester.tap(find.text('Disable invite'));
    await tester.pumpAndSettle();

    expect(controller.activeInviteId, isNull);
    await tester.fling(find.byType(ListView), const Offset(0, 500), 1000);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('arena-invite-code')), findsNothing);
    expect(find.byKey(const Key('create-arena-invite')), findsOneWidget);
  });

  testWidgets('ordinary members and commissioners cannot issue invites', (
    tester,
  ) async {
    final member = AppController.demo(signedIn: true, hasLeague: true);
    await pumpMembers(tester, member);
    expect(find.text('Invite people'), findsNothing);

    final commissioner = AppController.demo(signedIn: true, hasLeague: true)
      ..assumeDemoPersona('mia');
    await pumpMembers(tester, commissioner);
    expect(find.text('Invite people'), findsNothing);
  });
}
