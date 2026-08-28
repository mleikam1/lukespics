import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/invites/arena_invite.dart';
import '../../core/invites/invite_share_gateway.dart';
import '../../core/widgets/ui.dart';
import '../../data/demo/demo_repository.dart';

class ArenaInviteCard extends ConsumerStatefulWidget {
  const ArenaInviteCard({super.key, required this.controller});

  final AppController controller;

  @override
  ConsumerState<ArenaInviteCard> createState() => _ArenaInviteCardState();
}

class _ArenaInviteCardState extends ConsumerState<ArenaInviteCard> {
  bool _issuing = false;
  bool _revoking = false;

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final inviteCode = controller.activeInviteId == null || _inviteHasExpired
        ? null
        : normalizeArenaInviteCode(controller.inviteCode);
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                Icons.group_add_rounded,
                color: Theme.of(context).colorScheme.primary,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Invite people',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 5),
                    Text(
                      'Send a private link by Messages or any sharing app. '
                      'New members are added to this arena’s picker pool.',
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                        height: 1.4,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          if (inviteCode == null)
            FilledButton.icon(
              key: const Key('create-arena-invite'),
              onPressed: _issuing ? null : _issueInvite,
              icon: _issuing
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.add_link_rounded),
              label: Text(_issuing ? 'Creating invite…' : 'Create invite'),
            )
          else ...[
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primaryContainer,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'PRIVATE INVITE',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 1,
                    ),
                  ),
                  const SizedBox(height: 5),
                  SelectableText(
                    inviteCode,
                    key: const Key('arena-invite-code'),
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w900,
                      letterSpacing: 2,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _invitePolicy(controller),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                Builder(
                  builder: (buttonContext) => FilledButton.icon(
                    key: const Key('share-arena-invite'),
                    onPressed: () => _shareInvite(buttonContext, inviteCode),
                    icon: const Icon(Icons.ios_share_rounded),
                    label: const Text('Text or share invite'),
                  ),
                ),
                OutlinedButton.icon(
                  key: const Key('copy-arena-invite'),
                  onPressed: () => _copyInvite(inviteCode),
                  icon: const Icon(Icons.copy_rounded),
                  label: const Text('Copy invite'),
                ),
                OutlinedButton.icon(
                  key: const Key('create-another-arena-invite'),
                  onPressed: _issuing || _revoking ? null : _issueInvite,
                  icon: const Icon(Icons.add_link_rounded),
                  label: const Text('Create another'),
                ),
                if (controller.activeInviteId != null)
                  TextButton.icon(
                    key: const Key('revoke-arena-invite'),
                    onPressed: _revoking || _issuing ? null : _confirmRevoke,
                    icon: const Icon(Icons.link_off_rounded),
                    label: Text(_revoking ? 'Disabling…' : 'Disable link'),
                  ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              'Anyone with this link can join this arena. Do not post it '
              'publicly. Creating another invite does not disable links you '
              'already sent.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
                height: 1.4,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _issueInvite() async {
    setState(() => _issuing = true);
    final created = await widget.controller.issueArenaInvite();
    if (!mounted) return;
    setState(() => _issuing = false);
    final message = created
        ? 'Invite ready to send.'
        : widget.controller.errorMessage ?? 'The invite could not be created.';
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _shareInvite(
    BuildContext buttonContext,
    String inviteCode,
  ) async {
    if (_inviteHasExpired) {
      _showExpiredInvite();
      return;
    }
    final message = _message(inviteCode);
    final renderBox = buttonContext.findRenderObject() as RenderBox?;
    final origin = renderBox == null || !renderBox.hasSize
        ? const Rect.fromLTWH(0, 0, 1, 1)
        : renderBox.localToGlobal(Offset.zero) & renderBox.size;
    try {
      await ref
          .read(inviteShareGatewayProvider)
          .share(
            text: message,
            title: 'Join ${widget.controller.leagueName} on Luke’s Picks',
            origin: origin,
          );
    } on Object {
      final copied = await _tryCopy(message);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            copied
                ? 'Sharing is unavailable here. Invite copied instead.'
                : 'Sharing and copying are unavailable here. Select the '
                      'invite code above to copy it.',
          ),
        ),
      );
    }
  }

  Future<void> _copyInvite(String inviteCode) async {
    if (_inviteHasExpired) {
      _showExpiredInvite();
      return;
    }
    final copied = await _tryCopy(_message(inviteCode));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          copied
              ? 'Invite link and code copied.'
              : 'Copying is unavailable here. Select the invite code above '
                    'to copy it.',
        ),
      ),
    );
  }

  Future<bool> _tryCopy(String message) async {
    try {
      await Clipboard.setData(ClipboardData(text: message));
      return true;
    } on Object {
      return false;
    }
  }

  bool get _inviteHasExpired {
    final expiresAt = widget.controller.inviteExpiresAt;
    return expiresAt != null && !DateTime.now().toUtc().isBefore(expiresAt);
  }

  void _showExpiredInvite() {
    if (!mounted) return;
    setState(() {});
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('This invite expired. Create a new one.')),
    );
  }

  Future<void> _confirmRevoke() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Disable this invite?'),
        content: const Text(
          'People who have not joined yet will no longer be able to use this '
          'link. Existing arena members are not affected.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep invite'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Disable invite'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _revoking = true);
    final revoked = await widget.controller.revokeArenaInvite();
    if (!mounted) return;
    setState(() => _revoking = false);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          revoked
              ? 'Invite disabled.'
              : widget.controller.errorMessage ??
                    'The invite could not be disabled.',
        ),
      ),
    );
  }

  String _message(String code) => buildArenaInviteMessage(
    arenaName: widget.controller.leagueName,
    inviteCode: code,
  );
}

String _invitePolicy(AppController controller) {
  final expiresAt = controller.inviteExpiresAt;
  final maxUses = controller.inviteMaxUses;
  if (expiresAt == null && maxUses == null) {
    return 'Keep this invite private.';
  }
  final parts = <String>[];
  if (expiresAt != null) {
    parts.add('Expires ${DateFormat('MMM d, y').format(expiresAt.toLocal())}');
  }
  if (maxUses != null) parts.add('up to $maxUses joins');
  return parts.join(' · ');
}
