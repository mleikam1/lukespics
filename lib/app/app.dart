import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/demo/demo_repository.dart';
import 'bootstrap.dart';
import 'router.dart';
import 'theme/app_theme.dart';

class LukesPicksApp extends StatefulWidget {
  const LukesPicksApp({
    super.key,
    required this.bootstrap,
    this.controller,
    this.initialLocation = '/',
  });

  final BootstrapResult bootstrap;
  final AppController? controller;
  final String initialLocation;

  @override
  State<LukesPicksApp> createState() => _LukesPicksAppState();
}

class _LukesPicksAppState extends State<LukesPicksApp> {
  late final AppController _controller =
      widget.controller ??
      AppController.demo(
        runtimeMode: widget.bootstrap.mode,
        bootstrapMessage: widget.bootstrap.message,
      );

  @override
  Widget build(BuildContext context) {
    return ProviderScope(
      overrides: [appControllerProvider.overrideWith((ref) => _controller)],
      child: _AppView(initialLocation: widget.initialLocation),
    );
  }
}

class _AppView extends ConsumerStatefulWidget {
  const _AppView({required this.initialLocation});

  final String initialLocation;

  @override
  ConsumerState<_AppView> createState() => _AppViewState();
}

class _AppViewState extends ConsumerState<_AppView> {
  late final GoRouter _router = createAppRouter(
    ref.read(appControllerProvider),
    initialLocation: widget.initialLocation,
  );

  @override
  void dispose() {
    _router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final themeMode = ref.watch(
      appControllerProvider.select((controller) => controller.themeMode),
    );
    return MaterialApp.router(
      debugShowCheckedModeBanner: false,
      title: 'Luke’s Picks',
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: themeMode,
      routerConfig: _router,
      builder: (context, child) {
        return MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: MediaQuery.textScalerOf(
              context,
            ).clamp(minScaleFactor: 0.85, maxScaleFactor: 2.0),
          ),
          child: child ?? const SizedBox.shrink(),
        );
      },
    );
  }
}
