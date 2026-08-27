import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart' show kIsWeb, visibleForTesting;
import 'package:flutter/material.dart';

import '../core/widgets/brand_mark.dart';
import '../core/firebase/firebase_bootstrap.dart';
import '../firebase_options.dart';
import 'app.dart';
import 'build_profile.dart';
import 'theme/app_theme.dart';

enum AppRuntimeMode { demo, firebaseEmulator, firebase, configurationError }

final class BootstrapResult {
  const BootstrapResult({required this.mode, this.message});

  final AppRuntimeMode mode;
  final String? message;
}

@visibleForTesting
Future<void> waitForInitialAuthState(
  Stream<User?> authStateChanges, {
  Duration timeout = const Duration(seconds: 6),
}) async {
  await authStateChanges.first.timeout(timeout);
}

final class AppBootstrap {
  const AppBootstrap._();

  static Future<BootstrapResult> initialize() async {
    if (requestedPublicRelease && !isConnectedPublicRelease) {
      return const BootstrapResult(
        mode: AppRuntimeMode.configurationError,
        message:
            'A public release must be a release build with demo, Firebase '
            'emulator, and browser-test authentication disabled.',
      );
    }
    if (!requestedPublicRelease && !useDemoRuntime && !useFirebaseEmulators) {
      return const BootstrapResult(
        mode: AppRuntimeMode.configurationError,
        message:
            'A non-public build must explicitly select demo or Firebase '
            'emulator mode.',
      );
    }
    if (useDemoRuntime && useFirebaseEmulators) {
      return const BootstrapResult(
        mode: AppRuntimeMode.configurationError,
        message:
            'Conflicting runtime flags were supplied. Choose either the '
            'explicit demo or Firebase emulator runtime.',
      );
    }
    if (useDemoRuntime) {
      return const BootstrapResult(mode: AppRuntimeMode.demo);
    }
    if (useFirebaseEmulators) {
      return _initializeEmulators();
    }

    try {
      final options = DefaultFirebaseOptions.currentPlatform;
      if (options.projectId != 'lukes-picks') {
        return const BootstrapResult(
          mode: AppRuntimeMode.configurationError,
          message:
              'This build is not configured for the authorized Luke’s Picks '
              'Firebase project.',
        );
      }
      await Firebase.initializeApp(
        options: options,
      ).timeout(const Duration(seconds: 6));
      if (Firebase.app().options.projectId != 'lukes-picks') {
        return const BootstrapResult(
          mode: AppRuntimeMode.configurationError,
          message:
              'Firebase initialized with an unexpected project. No app data '
              'was loaded.',
        );
      }
      // Wait for Firebase Auth to finish hydrating its durable browser state
      // before the router decides whether this visit needs a sign-in screen.
      // Without this gate, a returning web user can briefly look signed out
      // while IndexedDB restoration is still in progress.
      await waitForInitialAuthState(FirebaseAuth.instance.authStateChanges());
      await FirebaseServiceBootstrap.configureProductionServices();
      return const BootstrapResult(mode: AppRuntimeMode.firebase);
    } on Object {
      return const BootstrapResult(
        mode: AppRuntimeMode.configurationError,
        message:
            'Luke’s Picks could not connect to Firebase. Check your network '
            'and retry. Demo data has not been loaded.',
      );
    }
  }

  static Future<BootstrapResult> _initializeEmulators() async {
    const projectId = String.fromEnvironment(
      'FIREBASE_PROJECT_ID',
      defaultValue: 'demo-lukes-picks-local',
    );
    const host = String.fromEnvironment(
      'FIREBASE_EMULATOR_HOST',
      defaultValue: '127.0.0.1',
    );
    const authPort = int.fromEnvironment(
      'FIREBASE_AUTH_EMULATOR_PORT',
      defaultValue: 9099,
    );
    const firestorePort = int.fromEnvironment(
      'FIRESTORE_EMULATOR_PORT',
      defaultValue: 8080,
    );
    const functionsPort = int.fromEnvironment(
      'FIREBASE_FUNCTIONS_EMULATOR_PORT',
      defaultValue: 5001,
    );
    if (projectId != 'demo-lukes-picks-local') {
      return const BootstrapResult(
        mode: AppRuntimeMode.configurationError,
        message:
            'Firebase emulators must use the isolated '
            'demo-lukes-picks-local project.',
      );
    }
    try {
      await Firebase.initializeApp(
        options: const FirebaseOptions(
          apiKey: 'demo-api-key',
          appId: '1:1234567890:web:lukespics-demo',
          messagingSenderId: '1234567890',
          projectId: projectId,
          authDomain: '$projectId.firebaseapp.com',
        ),
      ).timeout(const Duration(seconds: 6));
      await FirebaseAuth.instance.useAuthEmulator(host, authPort);
      if (kIsWeb) {
        // Normal emulator sessions mirror production's durable browser
        // identity. The strict browser-E2E build uses its own loopback-only
        // session marker and NONE here: restoring a dummy-key LOCAL Firebase
        // session can contact Identity Toolkit before useAuthEmulator applies.
        await FirebaseAuth.instance.setPersistence(
          enableBrowserE2eAuth ? Persistence.NONE : Persistence.LOCAL,
        );
      }
      FirebaseFirestore.instance.useFirestoreEmulator(host, firestorePort);
      FirebaseFunctions.instance.useFunctionsEmulator(host, functionsPort);
      return const BootstrapResult(mode: AppRuntimeMode.firebaseEmulator);
    } on Object {
      return const BootstrapResult(
        mode: AppRuntimeMode.configurationError,
        message:
            'The isolated Firebase emulators are unavailable. Start them and '
            'retry; demo data has not been loaded.',
      );
    }
  }
}

class LukesPicksBootstrap extends StatefulWidget {
  const LukesPicksBootstrap({super.key});

  @override
  State<LukesPicksBootstrap> createState() => _LukesPicksBootstrapState();
}

class _LukesPicksBootstrapState extends State<LukesPicksBootstrap> {
  late Future<BootstrapResult> _bootstrap = AppBootstrap.initialize();

  void _retry() {
    setState(() {
      _bootstrap = AppBootstrap.initialize();
    });
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<BootstrapResult>(
      future: _bootstrap,
      builder: (context, snapshot) {
        if (snapshot.hasData) {
          final result = snapshot.data!;
          if (result.mode == AppRuntimeMode.configurationError) {
            return _ConfigurationErrorApp(
              message: result.message ?? 'Firebase configuration failed.',
              onRetry: _retry,
            );
          }
          return LukesPicksApp(bootstrap: result);
        }
        return MaterialApp(
          debugShowCheckedModeBanner: false,
          title: 'Luke’s Picks',
          theme: AppTheme.light,
          darkTheme: AppTheme.dark,
          home: const _SplashScreen(),
        );
      },
    );
  }
}

class _ConfigurationErrorApp extends StatelessWidget {
  const _ConfigurationErrorApp({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Luke’s Picks',
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      home: Scaffold(
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const BrandMark(size: 88, showWordmark: false),
                    const SizedBox(height: 24),
                    Text(
                      'Connection required',
                      style: Theme.of(context).textTheme.headlineSmall,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 12),
                    Text(message, textAlign: TextAlign.center),
                    const SizedBox(height: 20),
                    FilledButton.icon(
                      key: const Key('firebase-bootstrap-retry'),
                      onPressed: onRetry,
                      icon: const Icon(Icons.refresh_rounded),
                      label: const Text('Retry connection'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Semantics(
          label: 'Loading Luke’s Picks',
          liveRegion: true,
          child: const Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              BrandMark(size: 88, showWordmark: false),
              SizedBox(height: 24),
              Text(
                'LUKE’S PICKS',
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.8,
                ),
              ),
              SizedBox(height: 20),
              SizedBox(
                width: 32,
                height: 32,
                child: CircularProgressIndicator(strokeWidth: 3),
              ),
              SizedBox(height: 12),
              Text('Setting the arena…'),
            ],
          ),
        ),
      ),
    );
  }
}
