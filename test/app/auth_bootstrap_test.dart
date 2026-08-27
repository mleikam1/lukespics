import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/app/bootstrap.dart';

void main() {
  test('startup waits for the first durable auth state', () async {
    final states = StreamController<User?>();
    var completed = false;

    final restoration = waitForInitialAuthState(
      states.stream,
      timeout: const Duration(seconds: 1),
    ).then((_) => completed = true);

    await Future<void>.delayed(Duration.zero);
    expect(completed, isFalse);

    states.add(null);
    await restoration;

    expect(completed, isTrue);
    await states.close();
  });
}
