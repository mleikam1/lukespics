import 'package:firebase_analytics/firebase_analytics.dart';

final class AppTelemetry {
  const AppTelemetry({required this.enabled});

  final bool enabled;

  Future<void> log(String name, {Map<String, Object>? parameters}) async {
    if (!enabled) return;
    try {
      await FirebaseAnalytics.instance.logEvent(
        name: name,
        parameters: parameters,
      );
    } on Object {
      // Telemetry is best-effort and must never block a user action.
    }
  }
}
