import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/core/invites/arena_invite.dart';

void main() {
  const code = 'K7M4PX9R';
  const legacyCode = 'AbCdEfGhIjKlMnOpQrStUvWx';

  test('builds a canonical fragment invite without sending token to host', () {
    final uri = buildArenaInviteUri(code);

    expect(uri.scheme, 'https');
    expect(uri.host, 'lukes-picks.web.app');
    expect(uri.path, '/arena/join');
    expect(uri.query, isEmpty);
    expect(uri.fragment, 'invite=$code');
    expect(inviteCodeFromUri(uri), code);
  });

  test('short codes are case-insensitive and canonicalized to uppercase', () {
    final uri = Uri.parse(
      'https://lukes-picks.web.app/arena/join#invite=${code.toLowerCase()}',
    );

    expect(inviteCodeFromUri(uri), code);
    expect(normalizeArenaInviteCode(code.toLowerCase()), code);
  });

  test('parses legacy query links and preserves exact case', () {
    final uri = Uri.parse(
      'https://lukes-picks.web.app/arena/join?code=$legacyCode',
    );

    expect(inviteCodeFromUri(uri), legacyCode);
    expect(
      normalizeArenaInviteCode(legacyCode.toLowerCase()),
      legacyCode.toLowerCase(),
    );
  });

  test('rejects malformed, short, and oversized invite values', () {
    expect(normalizeArenaInviteCode('ABC123'), isNull);
    expect(normalizeArenaInviteCode('ABCDEFGHI'), isNull);
    expect(normalizeArenaInviteCode('ABCD-234'), isNull);
    expect(normalizeArenaInviteCode('$code!?'), isNull);
    expect(normalizeArenaInviteCode(List.filled(65, 'A').join()), isNull);
    expect(
      inviteCodeFromUri(
        Uri.parse('https://lukes-picks.web.app/arena/join#invite=bad'),
      ),
      isNull,
    );
  });

  test('share message contains only the canonical destination and invite', () {
    final message = buildArenaInviteMessage(
      arenaName: 'Friends & Family 🏈',
      inviteCode: code,
    );

    expect(message, contains('Friends & Family 🏈'));
    expect(message, contains('https://lukes-picks.web.app/arena/join#'));
    expect(message, contains('Code: $code'));
    expect(message, isNot(contains('uid=')));
    expect(message, isNot(contains('@')));
  });
}
