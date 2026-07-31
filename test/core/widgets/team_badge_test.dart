import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/core/widgets/ui.dart';
import 'package:lukespics/data/models/game.dart';

void main() {
  const permittedPolicy = TeamLogoPolicy.provider(
    provider: 'testProvider',
    logoRightsVerified: true,
    allowedHosts: {'logos.example.test'},
  );

  group('TeamLogoPolicy', () {
    test('requires an explicit rights gate and exact HTTPS allowlist', () {
      final candidate = Uri.parse('https://logos.example.test/team/harbor.png');

      expect(const TeamLogoPolicy.disabled().permittedUri(candidate), isNull);
      expect(
        const TeamLogoPolicy.provider(
          provider: 'testProvider',
          logoRightsVerified: false,
          allowedHosts: {'logos.example.test'},
        ).permittedUri(candidate),
        isNull,
      );
      expect(permittedPolicy.permittedUri(candidate), candidate);
      expect(
        permittedPolicy.permittedUri(
          Uri.parse('http://logos.example.test/team/harbor.png'),
        ),
        isNull,
      );
      expect(
        permittedPolicy.permittedUri(
          Uri.parse('https://other.example.test/team/harbor.png'),
        ),
        isNull,
      );
      expect(
        permittedPolicy.permittedUri(
          Uri.parse('https://cdn.logos.example.test/team/harbor.png'),
        ),
        isNull,
      );
    });

    test('blocks ESPN hosts even when a caller allowlists one', () {
      const mistakenPolicy = TeamLogoPolicy.provider(
        provider: 'testProvider',
        logoRightsVerified: true,
        allowedHosts: {'a.espncdn.com'},
      );

      expect(
        mistakenPolicy.permittedUri(
          Uri.parse('https://a.espncdn.com/i/teamlogos/harbor.png'),
        ),
        isNull,
      );
    });

    test('blocks URLs that may expose credentials', () {
      expect(
        permittedPolicy.permittedUri(
          Uri.parse(
            'https://logos.example.test/team/harbor.png?access_token=secret',
          ),
        ),
        isNull,
      );
      expect(
        permittedPolicy.permittedUri(
          Uri.parse('https://user:password@logos.example.test/harbor.png'),
        ),
        isNull,
      );
      expect(
        permittedPolicy.permittedUri(
          Uri.parse(
            'https://logos.example.test/team/harbor.png?X-Goog-Signature=secret',
          ),
        ),
        isNull,
      );
    });

    test('requires query parameters to be explicitly identified as safe', () {
      final candidate = Uri.parse(
        'https://logos.example.test/team/harbor.png?size=tiny',
      );
      const queryPolicy = TeamLogoPolicy.provider(
        provider: 'testProvider',
        logoRightsVerified: true,
        allowedHosts: {'logos.example.test'},
        allowedQueryParameters: {'size'},
      );

      expect(permittedPolicy.permittedUri(candidate), isNull);
      expect(queryPolicy.permittedUri(candidate), candidate);
    });
  });

  group('TeamBadge', () {
    testWidgets('uses fixed dimensions and an accessible neutral fallback', (
      tester,
    ) async {
      final semantics = tester.ensureSemantics();
      try {
        await _pumpBadge(tester, team: _team());

        expect(find.text('HH'), findsOneWidget);
        expect(find.bySemanticsLabel('Harbor Hawks team mark'), findsOneWidget);
        expect(
          tester.getSize(find.byKey(const Key('team-badge'))),
          const Size(52, 52),
        );
        expect(find.byType(Image), findsNothing);
      } finally {
        semantics.dispose();
      }
    });

    for (final blockedCase in <(String, String)>[
      ('HTTP', 'http://logos.example.test/team/harbor.png'),
      ('disallowed host', 'https://other.example.test/team/harbor.png'),
      ('ESPN host', 'https://a.espncdn.com/i/teamlogos/harbor.png'),
    ]) {
      testWidgets('${blockedCase.$1} logo falls back without loading it', (
        tester,
      ) async {
        final policy = blockedCase.$1 == 'ESPN host'
            ? const TeamLogoPolicy.provider(
                provider: 'testProvider',
                logoRightsVerified: true,
                allowedHosts: {'a.espncdn.com'},
              )
            : permittedPolicy;
        await _pumpBadge(
          tester,
          team: _team(logoUrl: blockedCase.$2),
          policy: policy,
        );

        expect(find.text('HH'), findsOneWidget);
        expect(find.byType(Image), findsNothing);
      });
    }

    testWidgets(
      'permitted logo uses BoxFit.contain and a fixed loading placeholder',
      (tester) async {
        await _pumpBadge(
          tester,
          team: _team(logoUrl: 'https://logos.example.test/team/harbor.png'),
          policy: permittedPolicy,
          imageProviderBuilder: (_) =>
              MemoryImage(Uint8List.fromList(const <int>[0, 1, 2])),
        );

        final image = tester.widget<Image>(find.byType(Image));
        expect(image.fit, BoxFit.contain);
        expect(image.width, 52);
        expect(image.height, 52);
        expect(
          tester.getSize(find.byKey(const Key('team-badge'))),
          const Size(52, 52),
        );
        expect(find.text('HH'), findsOneWidget);
      },
    );

    testWidgets('broken permitted logo falls back to neutral initials', (
      tester,
    ) async {
      await _pumpBadge(
        tester,
        team: _team(logoUrl: 'https://logos.example.test/team/broken.png'),
        policy: permittedPolicy,
        imageProviderBuilder: (_) =>
            MemoryImage(Uint8List.fromList(const <int>[0, 1, 2, 3])),
      );
      await tester.pumpAndSettle();

      expect(find.text('HH'), findsOneWidget);
      expect(tester.takeException(), isNull);
      expect(
        tester.getSize(find.byKey(const Key('team-badge'))),
        const Size(52, 52),
      );
    });
  });
}

Future<void> _pumpBadge(
  WidgetTester tester, {
  required Team team,
  TeamLogoPolicy policy = const TeamLogoPolicy.disabled(),
  TeamLogoImageProviderBuilder? imageProviderBuilder,
}) {
  return tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Center(
          child: TeamBadge(
            key: const Key('team-badge'),
            team: team,
            size: 52,
            logoPolicy: policy,
            imageProviderBuilder: imageProviderBuilder,
          ),
        ),
      ),
    ),
  );
}

Team _team({String? logoUrl}) => Team(
  id: 'harbor-hawks',
  name: 'Harbor Hawks',
  shortName: 'Hawks',
  abbreviation: 'HH',
  logoUrl: logoUrl == null ? null : Uri.parse(logoUrl),
);
