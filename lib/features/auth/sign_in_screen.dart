import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme/app_theme.dart';
import '../../core/widgets/brand_mark.dart';
import '../../core/widgets/ui.dart';
import '../../data/demo/demo_repository.dart';

class SignInScreen extends ConsumerWidget {
  const SignInScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.watch(appControllerProvider);
    final form = _SignInPanel(controller: controller);
    final hero = const _WelcomeHero();

    return Scaffold(
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            if (constraints.maxWidth >= 900) {
              return Row(
                children: [
                  Expanded(flex: 11, child: hero),
                  Expanded(
                    flex: 9,
                    child: Center(
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.all(48),
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 480),
                          child: form,
                        ),
                      ),
                    ),
                  ),
                ],
              );
            }
            return SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 28, 20, 36),
              child: Column(
                children: [
                  const SizedBox(
                    height: 330,
                    child: _WelcomeHero(compact: true),
                  ),
                  const SizedBox(height: 24),
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 520),
                    child: form,
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _WelcomeHero extends StatelessWidget {
  const _WelcomeHero({this.compact = false});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: BrandColors.navy,
      padding: EdgeInsets.all(compact ? 24 : 40),
      child: Stack(
        children: [
          Positioned(
            right: -70,
            top: -80,
            child: Container(
              width: 260,
              height: 260,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: BrandColors.blue.withValues(alpha: 0.27),
              ),
            ),
          ),
          Positioned(
            left: -60,
            bottom: -90,
            child: Container(
              width: 260,
              height: 260,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: BrandColors.gold.withValues(alpha: 0.14),
              ),
            ),
          ),
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 620),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  BrandMark(size: compact ? 54 : 68, onDark: true),
                  SizedBox(height: compact ? 24 : 36),
                  Text(
                    'Make the call.\nOwn the week.',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: compact ? 34 : 44,
                      height: 1.02,
                      fontWeight: FontWeight.w900,
                      letterSpacing: -1.4,
                    ),
                  ),
                  if (!compact) ...[
                    const SizedBox(height: 18),
                    Text(
                      'A private, straight-up sports pick’em arena for your '
                      'favorite people. No odds. No wagers. Just bragging rights.',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.78),
                        fontSize: 17,
                        height: 1.55,
                      ),
                    ),
                    const SizedBox(height: 28),
                    const Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        StatusPill(
                          label: '1 point per correct pick',
                          icon: Icons.check_rounded,
                          tone: StatusTone.success,
                        ),
                        StatusPill(
                          label: 'Private arenas',
                          icon: Icons.lock_outline_rounded,
                          tone: StatusTone.info,
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SignInPanel extends ConsumerWidget {
  const _SignInPanel({required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Welcome to the arena',
          style: Theme.of(context).textTheme.headlineMedium,
        ),
        const SizedBox(height: 10),
        Text(
          controller.isDemo
              ? 'Explore the full product with safe local demo data.'
              : 'Sign in with the Google account you want to use for your arena.',
          style: TextStyle(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
            height: 1.45,
          ),
        ),
        if (controller.bootstrapMessage != null) ...[
          const SizedBox(height: 18),
          MaterialBanner(
            content: Text(controller.bootstrapMessage!),
            leading: const Icon(Icons.info_outline_rounded),
            actions: const [SizedBox.shrink()],
          ),
        ],
        if (controller.errorMessage != null) ...[
          const SizedBox(height: 18),
          Text(
            controller.errorMessage!,
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ],
        const SizedBox(height: 28),
        Semantics(
          label: controller.isDemo
              ? 'Continue with Google in demo mode'
              : 'Continue with Google',
          button: true,
          child: FilledButton.icon(
            key: const Key('google-sign-in-button'),
            onPressed: controller.authBusy ? null : controller.signIn,
            icon: controller.authBusy
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.account_circle_outlined),
            label: Text(
              controller.authBusy
                  ? 'Signing in…'
                  : controller.isDemo
                  ? 'Continue with Google · Demo'
                  : 'Continue with Google',
            ),
          ),
        ),
        const SizedBox(height: 16),
        Text(
          controller.isDemo
              ? 'Demo mode does not contact Google or Firebase. Compile-time '
                    'Firebase values enable the configured sign-in flow.'
              : 'Your email stays private and is never shown to arena members.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
            height: 1.4,
          ),
        ),
        const SizedBox(height: 28),
        Wrap(
          alignment: WrapAlignment.center,
          children: [
            TextButton(
              onPressed: () => context.go('/legal/privacy'),
              child: const Text('Privacy'),
            ),
            TextButton(
              onPressed: () => context.go('/legal/terms'),
              child: const Text('Terms'),
            ),
            TextButton(
              onPressed: () => context.go('/legal/data-sources'),
              child: const Text('Data sources'),
            ),
          ],
        ),
      ],
    );
  }
}
