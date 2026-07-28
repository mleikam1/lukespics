import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/responsive/breakpoints.dart';
import '../../core/widgets/ui.dart';
import '../../data/demo/demo_repository.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  late final TextEditingController _nickname;
  bool _pickerParticipates = false;
  bool _firstGameLock = false;

  @override
  void initState() {
    super.initState();
    _nickname = TextEditingController(
      text: ref.read(appControllerProvider).displayName,
    );
  }

  @override
  void dispose() {
    _nickname.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = ref.watch(appControllerProvider);
    return ListView(
      padding: AppBreakpoints.pagePadding(context),
      children: [
        const PageHeader(
          eyebrow: 'Your account',
          title: 'Settings',
          description:
              'Manage your profile, appearance, arena rules, and privacy choices.',
        ),
        const SizedBox(height: 20),
        SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Profile', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 18),
              Row(
                children: [
                  CircleAvatar(
                    radius: 29,
                    child: Text(_initials(controller.displayName)),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: TextField(
                      controller: _nickname,
                      decoration: const InputDecoration(
                        labelText: 'Arena nickname',
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton(
                  onPressed: () {
                    controller.updateNickname(_nickname.text);
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Nickname updated.')),
                    );
                  },
                  child: const Text('Save profile'),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Appearance', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 16),
              SegmentedButton<ThemeMode>(
                showSelectedIcon: false,
                segments: const [
                  ButtonSegment(
                    value: ThemeMode.system,
                    icon: Icon(Icons.brightness_auto_rounded),
                    label: Text('System'),
                  ),
                  ButtonSegment(
                    value: ThemeMode.light,
                    icon: Icon(Icons.light_mode_rounded),
                    label: Text('Light'),
                  ),
                  ButtonSegment(
                    value: ThemeMode.dark,
                    icon: Icon(Icons.dark_mode_rounded),
                    label: Text('Dark'),
                  ),
                ],
                selected: {controller.themeMode},
                onSelectionChanged: (values) =>
                    controller.setThemeMode(values.first),
              ),
            ],
          ),
        ),
        if (controller.currentRole.name == 'owner') ...[
          const SizedBox(height: 16),
          SectionCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Owner settings',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 8),
                if (controller.inviteCode != null) ...[
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.primaryContainer,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'CURRENT INVITE CODE',
                                style: TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w900,
                                  letterSpacing: 1,
                                ),
                              ),
                              const SizedBox(height: 4),
                              SelectableText(
                                controller.inviteCode!,
                                style: Theme.of(context).textTheme.titleLarge,
                              ),
                            ],
                          ),
                        ),
                        IconButton(
                          tooltip: 'Copy invite code',
                          onPressed: () async {
                            await Clipboard.setData(
                              ClipboardData(text: controller.inviteCode!),
                            );
                            if (!context.mounted) return;
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Invite code copied.'),
                              ),
                            );
                          },
                          icon: const Icon(Icons.copy_rounded),
                        ),
                        IconButton(
                          tooltip: 'Rotate invite code',
                          onPressed: () async {
                            final rotated = await controller.rotateInviteCode();
                            if (!context.mounted || !rotated) return;
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text(
                                  'Invite code rotated. The prior code is invalid.',
                                ),
                              ),
                            );
                          },
                          icon: const Icon(Icons.refresh_rounded),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                ],
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Weekly picker participates'),
                  subtitle: const Text(
                    'Off by default. Picker weeks are excluded from accuracy.',
                  ),
                  value: _pickerParticipates,
                  onChanged: (value) {
                    setState(() => _pickerParticipates = value);
                    unawaited(
                      controller.updateLeagueSettings({
                        'pickerParticipatesInPicks': value,
                      }),
                    );
                  },
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Lock entire slate at first game'),
                  subtitle: const Text('Per-game locking is the default.'),
                  value: _firstGameLock,
                  onChanged: (value) {
                    setState(() => _firstGameLock = value);
                    unawaited(
                      controller.updateLeagueSettings({
                        'pickLockPolicy': value ? 'firstGame' : 'perGame',
                      }),
                    );
                  },
                ),
                const ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.public_rounded),
                  title: Text('League timezone'),
                  subtitle: Text('America/Chicago'),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 16),
        SectionCard(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Column(
            children: [
              _LinkTile(
                icon: Icons.source_outlined,
                title: 'Data sources & non-affiliation',
                onTap: () => context.go('/legal/data-sources'),
              ),
              _LinkTile(
                icon: Icons.privacy_tip_outlined,
                title: 'Privacy notice',
                onTap: () => context.go('/legal/privacy'),
              ),
              _LinkTile(
                icon: Icons.gavel_outlined,
                title: 'Terms',
                onTap: () => context.go('/legal/terms'),
              ),
              _LinkTile(
                icon: Icons.person_remove_outlined,
                title: 'Account deletion details',
                onTap: () => context.go('/legal/account-deletion'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              OutlinedButton.icon(
                onPressed: () async {
                  await controller.signOut();
                  if (context.mounted) context.go('/sign-in');
                },
                icon: const Icon(Icons.logout_rounded),
                label: const Text('Sign out'),
              ),
              const SizedBox(height: 10),
              TextButton(
                onPressed: () => _confirmLeave(context, controller),
                child: const Text('Leave this arena'),
              ),
              TextButton(
                onPressed: () => _confirmDelete(context, controller),
                child: Text(
                  'Delete account',
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _confirmLeave(
    BuildContext context,
    AppController controller,
  ) async {
    final leave = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Leave Luke’s Picks Arena?'),
        content: const Text(
          'Your finalized history will remain so past standings stay accurate. '
          'The owner must transfer ownership before leaving.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Leave arena'),
          ),
        ],
      ),
    );
    if (leave == true) {
      final left = await controller.leaveArena();
      if (context.mounted && left) context.go('/arena');
    }
  }

  Future<void> _confirmDelete(
    BuildContext context,
    AppController controller,
  ) async {
    final shouldDelete = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete your account?'),
        content: const Text(
          'Private profile data will be removed. Finalized competition '
          'records may retain an anonymized identity so standings remain valid.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete and anonymize'),
          ),
        ],
      ),
    );
    if (shouldDelete != true) return;
    final deleted = await controller.deleteAccount();
    if (context.mounted && deleted) context.go('/sign-in');
  }
}

class _LinkTile extends StatelessWidget {
  const _LinkTile({
    required this.icon,
    required this.title,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
      trailing: const Icon(Icons.chevron_right_rounded),
      onTap: onTap,
    );
  }
}

String _initials(String name) =>
    name.split(' ').take(2).map((part) => part[0]).join();
