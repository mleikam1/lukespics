import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/core/widgets/ui.dart';

void main() {
  testWidgets('empty state stays visible in a short list viewport', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: 700,
              height: 96,
              child: EmptyState(
                icon: Icons.event_busy_rounded,
                title: 'Manual schedule is ready',
                message:
                    'Production sports data remains manual until a provider '
                    'is approved.',
              ),
            ),
          ),
        ),
      ),
    );

    expect(find.text('Manual schedule is ready'), findsOneWidget);
    expect(
      find.textContaining('Production sports data remains manual'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}
