import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme/app_theme.dart';
import '../../core/widgets/brand_mark.dart';
import '../../data/demo/demo_repository.dart';

enum ArenaMode { choose, create, join }

class ArenaGatewayScreen extends ConsumerStatefulWidget {
  const ArenaGatewayScreen({super.key, this.initialMode = ArenaMode.choose});

  final ArenaMode initialMode;

  @override
  ConsumerState<ArenaGatewayScreen> createState() => _ArenaGatewayScreenState();
}

class _ArenaGatewayScreenState extends ConsumerState<ArenaGatewayScreen> {
  late ArenaMode _mode = widget.initialMode;
  final _arenaName = TextEditingController(text: 'Luke’s Picks Arena');
  final _inviteCode = TextEditingController();
  bool _pickerParticipates = false;
  bool _busy = false;

  @override
  void dispose() {
    _arenaName.dispose();
    _inviteCode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = ref.watch(appControllerProvider);
    return Scaffold(
      appBar: AppBar(
        leading: _mode == ArenaMode.choose
            ? null
            : IconButton(
                tooltip: 'Back to arena choices',
                onPressed: () => setState(() => _mode = ArenaMode.choose),
                icon: const Icon(Icons.arrow_back_rounded),
              ),
        title: const BrandMark(size: 36),
        actions: [
          TextButton(
            onPressed: controller.signOut,
            child: const Text('Sign out'),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 820),
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 180),
              child: switch (_mode) {
                ArenaMode.choose => _choices(context),
                ArenaMode.create => _createForm(context, controller),
                ArenaMode.join => _joinForm(context, controller),
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _choices(BuildContext context) {
    return Column(
      key: const ValueKey('arena-choices'),
      children: [
        Text(
          'Your next rivalry starts here.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.headlineLarge,
        ),
        const SizedBox(height: 12),
        Text(
          'Create a private arena for your group or enter a secure invite code.',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
            fontSize: 16,
          ),
        ),
        const SizedBox(height: 32),
        LayoutBuilder(
          builder: (context, constraints) {
            final cards = [
              _ChoiceCard(
                icon: Icons.add_circle_outline_rounded,
                title: 'Create an arena',
                description:
                    'You’ll become owner and start the weekly picker rotation.',
                buttonLabel: 'Create Luke’s Picks Arena',
                onTap: () => setState(() => _mode = ArenaMode.create),
              ),
              _ChoiceCard(
                icon: Icons.key_rounded,
                title: 'Join with invite code',
                description:
                    'Invite codes are private. There is no public arena directory.',
                buttonLabel: 'Enter invite code',
                onTap: () => setState(() => _mode = ArenaMode.join),
              ),
            ];
            if (constraints.maxWidth < 680) {
              return Column(
                children: [cards.first, const SizedBox(height: 16), cards.last],
              );
            }
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: cards.first),
                const SizedBox(width: 18),
                Expanded(child: cards.last),
              ],
            );
          },
        ),
      ],
    );
  }

  Widget _createForm(BuildContext context, AppController controller) {
    return Card(
      key: const ValueKey('create-arena'),
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Create your arena',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 8),
            const Text(
              'These defaults can be changed later by the arena owner.',
            ),
            const SizedBox(height: 24),
            TextField(
              controller: _arenaName,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(
                labelText: 'Arena name',
                prefixIcon: Icon(Icons.stadium_outlined),
              ),
            ),
            const SizedBox(height: 14),
            const TextField(
              readOnly: true,
              decoration: InputDecoration(
                labelText: 'League timezone',
                hintText: 'America/Chicago',
                prefixIcon: Icon(Icons.schedule_rounded),
              ),
            ),
            const SizedBox(height: 14),
            SwitchListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 4),
              title: const Text('Weekly picker also makes picks'),
              subtitle: const Text(
                'Off by default. Picker weeks won’t count as missed weeks.',
              ),
              value: _pickerParticipates,
              onChanged: (value) => setState(() => _pickerParticipates = value),
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _busy
                  ? null
                  : () async {
                      setState(() => _busy = true);
                      await controller.createArena(
                        name: _arenaName.text,
                        pickerParticipatesInPicks: _pickerParticipates,
                      );
                      if (!context.mounted) return;
                      setState(() => _busy = false);
                      if (controller.hasLeague) context.go('/dashboard');
                    },
              child: Text(_busy ? 'Creating arena…' : 'Create arena'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _joinForm(BuildContext context, AppController controller) {
    return Card(
      key: const ValueKey('join-arena'),
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Join an arena',
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 8),
            const Text('Ask the owner or commissioner for the current code.'),
            const SizedBox(height: 24),
            TextField(
              controller: _inviteCode,
              textCapitalization: TextCapitalization.characters,
              autocorrect: false,
              decoration: const InputDecoration(
                labelText: 'Invite code',
                hintText: 'LUKE-7H3K',
                prefixIcon: Icon(Icons.key_rounded),
              ),
            ),
            if (controller.errorMessage != null) ...[
              const SizedBox(height: 10),
              Text(
                controller.errorMessage!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _busy
                  ? null
                  : () async {
                      setState(() => _busy = true);
                      final joined = await controller.joinArena(
                        _inviteCode.text,
                      );
                      if (!context.mounted) return;
                      setState(() => _busy = false);
                      if (joined) context.go('/dashboard');
                    },
              child: Text(_busy ? 'Checking code…' : 'Join arena'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ChoiceCard extends StatelessWidget {
  const _ChoiceCard({
    required this.icon,
    required this.title,
    required this.description,
    required this.buttonLabel,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String description;
  final String buttonLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: BrandColors.blue.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(icon, color: Theme.of(context).colorScheme.tertiary),
            ),
            const SizedBox(height: 22),
            Text(title, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text(
              description,
              style: TextStyle(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(onPressed: onTap, child: Text(buttonLabel)),
            ),
          ],
        ),
      ),
    );
  }
}
