import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../core/responsive/breakpoints.dart';
import '../../core/widgets/ui.dart';
import '../../data/demo/demo_repository.dart';
import '../../data/models/game.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  late final TextEditingController _nickname;
  bool _pickerParticipates = false;
  bool _firstGameLock = false;
  bool _savingArenaRules = false;

  @override
  void initState() {
    super.initState();
    final controller = ref.read(appControllerProvider);
    _nickname = TextEditingController(text: controller.displayName);
    _pickerParticipates = controller.pickerParticipatesInFutureWeeks;
    _firstGameLock =
        controller.futureWeekLockPolicy == PickLockPolicy.firstGame;
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
                      readOnly: !controller.isDemo,
                      decoration: InputDecoration(
                        labelText: controller.isDemo
                            ? 'Arena nickname'
                            : 'Google profile name',
                        helperText: controller.isDemo
                            ? null
                            : 'Connected names come from the signed-in '
                                  'Google account.',
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton(
                  onPressed: controller.isDemo
                      ? () {
                          controller.updateNickname(_nickname.text);
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Nickname updated.')),
                          );
                        }
                      : null,
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
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: SegmentedButton<ThemeMode>(
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
                            if (!context.mounted) return;
                            if (rotated) {
                              _showSuccess(
                                context,
                                'Invite code rotated. The prior code is invalid.',
                              );
                            } else {
                              _showFailure(
                                context,
                                controller,
                                'The invite code could not be rotated.',
                              );
                            }
                          },
                          icon: const Icon(Icons.refresh_rounded),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                ],
                _RuleSnapshot(
                  pickerParticipates:
                      controller.pickerParticipatesInCurrentWeek,
                  firstGameLock:
                      controller.weekLockPolicy == PickLockPolicy.firstGame,
                ),
                const SizedBox(height: 8),
                SwitchListTile(
                  key: const Key('picker-participation-setting'),
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Picker participates in future weeks'),
                  subtitle: const Text(
                    'Sets the default for weeks created after this one. '
                    'Published-week eligibility does not change.',
                  ),
                  value: _pickerParticipates,
                  onChanged: _savingArenaRules
                      ? null
                      : (value) => _setPickerParticipation(controller, value),
                ),
                SwitchListTile(
                  key: const Key('pick-lock-policy-setting'),
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Use first-game lock in future weeks'),
                  subtitle: const Text(
                    'When off, each game locks separately. This changes only '
                    'the default for newly created weeks.',
                  ),
                  value: _firstGameLock,
                  onChanged: _savingArenaRules
                      ? null
                      : (value) => _setLockPolicy(controller, value),
                ),
                if (_savingArenaRules)
                  Semantics(
                    label: 'Saving arena rules',
                    liveRegion: true,
                    child: const LinearProgressIndicator(),
                  ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.public_rounded),
                  title: const Text('League timezone'),
                  subtitle: Text(controller.leagueTimezone),
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
        title: Text('Leave ${controller.leagueName}?'),
        content: Text(
          'Your finalized history will remain so past standings stay accurate.'
          '${controller.currentRole.name == 'owner' ? ' Owners cannot leave '
                    'an active arena because ownership transfer is not '
                    'available in this release.' : ''}',
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
      if (!context.mounted) return;
      if (left) {
        context.go('/arena');
      } else {
        _showFailure(
          context,
          controller,
          'The arena could not be left. Try again.',
        );
      }
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
    if (!context.mounted) return;
    if (deleted) {
      context.go('/sign-in');
    } else {
      _showFailure(
        context,
        controller,
        'The account could not be deleted. Try again.',
      );
    }
  }

  Future<void> _setPickerParticipation(
    AppController controller,
    bool value,
  ) async {
    final previous = _pickerParticipates;
    setState(() {
      _pickerParticipates = value;
      _savingArenaRules = true;
    });
    controller.clearError();
    final saved = await controller.updateLeagueSettings({
      'pickerParticipatesInPicks': value,
    });
    if (!mounted) return;
    setState(() {
      _savingArenaRules = false;
      if (!saved) _pickerParticipates = previous;
    });
    if (saved) {
      _showSuccess(
        context,
        'Future-week picker participation saved. The current week is unchanged.',
      );
    } else {
      _showFailure(
        context,
        controller,
        'Picker participation could not be saved.',
      );
    }
  }

  Future<void> _setLockPolicy(AppController controller, bool value) async {
    final previous = _firstGameLock;
    setState(() {
      _firstGameLock = value;
      _savingArenaRules = true;
    });
    controller.clearError();
    final saved = await controller.updateLeagueSettings({
      'pickLockPolicy': value ? 'firstGame' : 'perGame',
    });
    if (!mounted) return;
    setState(() {
      _savingArenaRules = false;
      if (!saved) _firstGameLock = previous;
    });
    if (saved) {
      _showSuccess(
        context,
        'Future-week lock policy saved. The current week is unchanged.',
      );
    } else {
      _showFailure(context, controller, 'Lock policy could not be saved.');
    }
  }
}

class _RuleSnapshot extends StatelessWidget {
  const _RuleSnapshot({
    required this.pickerParticipates,
    required this.firstGameLock,
  });

  final bool pickerParticipates;
  final bool firstGameLock;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.lock_clock_outlined, color: colors.primary),
          const SizedBox(width: 11),
          Expanded(
            child: Text(
              'Current week snapshot: picker '
              '${pickerParticipates ? 'included' : 'excluded'} · '
              '${firstGameLock ? 'entire slate locks at the first game' : 'each game locks separately'}. '
              'These published rules stay fixed.',
            ),
          ),
        ],
      ),
    );
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

void _showSuccess(BuildContext context, String message) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
}

void _showFailure(
  BuildContext context,
  AppController controller,
  String fallback,
) {
  final message = controller.errorMessage?.trim();
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(message == null || message.isEmpty ? fallback : message),
    ),
  );
}

String _initials(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((part) => part.isNotEmpty);
  final initials = parts
      .take(2)
      .map((part) => part.characters.first.toUpperCase())
      .join();
  return initials.isEmpty ? '?' : initials;
}
