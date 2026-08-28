import 'dart:ui';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

abstract interface class InviteShareGateway {
  Future<void> share({
    required String text,
    required String title,
    required Rect origin,
  });
}

final class PlatformInviteShareGateway implements InviteShareGateway {
  const PlatformInviteShareGateway();

  @override
  Future<void> share({
    required String text,
    required String title,
    required Rect origin,
  }) async {
    await SharePlus.instance.share(
      ShareParams(
        text: text,
        title: title,
        subject: title,
        sharePositionOrigin: origin,
      ),
    );
  }
}

final inviteShareGatewayProvider = Provider<InviteShareGateway>(
  (ref) => const PlatformInviteShareGateway(),
);
