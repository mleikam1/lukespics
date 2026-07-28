import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';

/// Stages optional Firebase client services without ever enabling hard
/// enforcement. Console enforcement remains a separate release checklist step.
abstract final class FirebaseServiceBootstrap {
  static Future<void> configureProductionServices() async {
    const enableAppCheck = bool.fromEnvironment('ENABLE_APP_CHECK');
    const enableAnalytics = bool.fromEnvironment('ENABLE_ANALYTICS');
    const enableCrashlytics = bool.fromEnvironment('ENABLE_CRASHLYTICS');
    const recaptchaSiteKey = String.fromEnvironment(
      'FIREBASE_APP_CHECK_WEB_SITE_KEY',
    );

    if (enableAppCheck) {
      await FirebaseAppCheck.instance.activate(
        providerWeb: recaptchaSiteKey.isEmpty
            ? null
            : ReCaptchaV3Provider(recaptchaSiteKey),
        providerAndroid: kDebugMode
            ? const AndroidDebugProvider()
            : const AndroidPlayIntegrityProvider(),
        providerApple: kDebugMode
            ? const AppleDebugProvider()
            : const AppleAppAttestWithDeviceCheckFallbackProvider(),
      );
      await FirebaseAppCheck.instance.setTokenAutoRefreshEnabled(true);
    }

    await FirebaseAnalytics.instance.setAnalyticsCollectionEnabled(
      enableAnalytics,
    );

    if (!kIsWeb) {
      await FirebaseCrashlytics.instance.setCrashlyticsCollectionEnabled(
        enableCrashlytics,
      );
      if (enableCrashlytics) {
        FlutterError.onError =
            FirebaseCrashlytics.instance.recordFlutterFatalError;
        PlatformDispatcher.instance.onError = (error, stack) {
          FirebaseCrashlytics.instance.recordError(error, stack, fatal: true);
          return true;
        };
      }
    }
  }
}
