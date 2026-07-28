import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import '../core/widgets/brand_mark.dart';
import '../core/firebase/firebase_bootstrap.dart';
import 'app.dart';
import 'theme/app_theme.dart';

enum AppRuntimeMode { demo, firebaseEmulator, firebase }

final class BootstrapResult {
  const BootstrapResult({required this.mode, this.message});

  final AppRuntimeMode mode;
  final String? message;
}

final class AppBootstrap {
  const AppBootstrap._();

  static Future<BootstrapResult> initialize() async {
    const useFirebase = bool.fromEnvironment('USE_FIREBASE');
    const useEmulators = bool.fromEnvironment('USE_FIREBASE_EMULATORS');
    if (useEmulators) {
      return _initializeEmulators();
    }
    if (!useFirebase) {
      return const BootstrapResult(mode: AppRuntimeMode.demo);
    }

    const apiKey = String.fromEnvironment('FIREBASE_API_KEY');
    const appId = String.fromEnvironment('FIREBASE_APP_ID');
    const messagingSenderId = String.fromEnvironment(
      'FIREBASE_MESSAGING_SENDER_ID',
    );
    const projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
    const authDomain = String.fromEnvironment('FIREBASE_AUTH_DOMAIN');
    const storageBucket = String.fromEnvironment('FIREBASE_STORAGE_BUCKET');
    const measurementId = String.fromEnvironment('FIREBASE_MEASUREMENT_ID');

    if ([
      apiKey,
      appId,
      messagingSenderId,
      projectId,
    ].any((value) => value.isEmpty)) {
      return const BootstrapResult(
        mode: AppRuntimeMode.demo,
        message:
            'Firebase was requested but required compile-time values are '
            'missing. Safe demo mode is active.',
      );
    }

    try {
      await Firebase.initializeApp(
        options: const FirebaseOptions(
          apiKey: apiKey,
          appId: appId,
          messagingSenderId: messagingSenderId,
          projectId: projectId,
          authDomain: authDomain,
          storageBucket: storageBucket,
          measurementId: measurementId,
        ),
      ).timeout(const Duration(seconds: 6));
      await FirebaseServiceBootstrap.configureProductionServices();
      return const BootstrapResult(mode: AppRuntimeMode.firebase);
    } on Object {
      return const BootstrapResult(
        mode: AppRuntimeMode.demo,
        message:
            'Firebase could not be initialized. Your session is using safe '
            'demo data.',
      );
    }
  }

  static Future<BootstrapResult> _initializeEmulators() async {
    const projectId = String.fromEnvironment(
      'FIREBASE_PROJECT_ID',
      defaultValue: 'lukespics-demo',
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
      FirebaseFirestore.instance.useFirestoreEmulator(host, firestorePort);
      FirebaseFunctions.instance.useFunctionsEmulator(host, functionsPort);
      return const BootstrapResult(mode: AppRuntimeMode.firebaseEmulator);
    } on Object {
      return const BootstrapResult(
        mode: AppRuntimeMode.demo,
        message:
            'The Firebase emulators were unavailable. Safe demo mode is '
            'active so the app remains usable.',
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
  late final Future<BootstrapResult> _bootstrap = AppBootstrap.initialize();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<BootstrapResult>(
      future: _bootstrap,
      builder: (context, snapshot) {
        if (snapshot.hasData) {
          return LukesPicksApp(bootstrap: snapshot.data!);
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
