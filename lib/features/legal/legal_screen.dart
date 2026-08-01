import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/widgets/brand_mark.dart';

class LegalScreen extends StatelessWidget {
  const LegalScreen({super.key, required this.page});

  final String page;

  @override
  Widget build(BuildContext context) {
    final content = _content[page] ?? _content['privacy']!;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          tooltip: 'Back',
          onPressed: () {
            if (Navigator.canPop(context)) {
              context.pop();
            } else {
              context.go('/sign-in');
            }
          },
          icon: const Icon(Icons.arrow_back_rounded),
        ),
        title: const BrandMark(size: 34),
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 780),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(24, 32, 24, 56),
            children: [
              Text(
                content.title,
                style: Theme.of(context).textTheme.headlineLarge,
              ),
              const SizedBox(height: 10),
              Text(
                'Pre-release notice · Review with qualified counsel before a '
                'public commercial launch.',
                style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 28),
              for (final section in content.sections) ...[
                Text(section.$1, style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 8),
                Text(
                  section.$2,
                  style: const TextStyle(height: 1.55, fontSize: 16),
                ),
                const SizedBox(height: 24),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

final class _LegalContent {
  const _LegalContent(this.title, this.sections);

  final String title;
  final List<(String, String)> sections;
}

const _content = <String, _LegalContent>{
  'privacy': _LegalContent('Privacy notice', [
    (
      'What we store',
      'Luke’s Picks stores the identity supplied by your Google account, your '
          'public arena nickname, league membership, private pre-lock picks, '
          'revealed picks after lock, and competition statistics. Member email '
          'addresses are not shown on the league dashboard.',
    ),
    (
      'How picks are handled',
      'Your team choice is private to you and trusted backend services before '
          'that game locks. After lock, the backend creates a separate reveal '
          'record that league members can view. Completion status may be visible '
          'before lock without revealing the selected team.',
    ),
    (
      'Service providers',
      'Firebase services may process authentication, application data, logs, '
          'analytics, and crash information. Sports schedule and result data may '
          'come from a configured licensed provider or a commissioner.',
    ),
  ]),
  'terms': _LegalContent('Terms of use', [
    (
      'Friendly competition only',
      'Luke’s Picks is a straight-up winner-picking game for private groups. '
          'It does not provide odds, accept wagers, collect entry fees, or '
          'offer prizes. Do not use it for unlawful gambling.',
    ),
    (
      'Results and corrections',
      'Provider data can be delayed or corrected. Commissioners may void or '
          'override a result with an audit reason. Finalized standings may be '
          'recalculated when an authoritative result changes.',
    ),
    (
      'Availability',
      'This MVP is provided without a promise of uninterrupted availability. '
          'Do not rely on it for financial, betting, or time-critical decisions.',
    ),
  ]),
  'data-sources': _LegalContent('Data sources & non-affiliation', [
    (
      'Sports data',
      'Schedules, team identifiers, scores, and final results may be supplied '
          'by a configured authorized server-side provider or by manual '
          'commissioner entry. The backend is SportsDataIO-capable for NFL '
          'and MLB and defaults to manual data until provider access is '
          'configured and authorized. Mock fixtures and internal test providers are '
          'testing-only and are never represented as production data.',
    ),
    (
      'Independent product',
      'Luke’s Picks is an independent fan project and is not affiliated with, '
          'endorsed by, or sponsored by SportsDataIO, any professional '
          'league, conference, team, or broadcaster. Names may be used only '
          'to identify factual sports data.',
    ),
    (
      'Artwork',
      'The Luke’s Picks shield and checkmark are original. The product uses '
          'neutral, accessible team initials by default. Remote artwork is '
          'shown only when the configured server policy records a reviewed '
          'entitlement and explicitly approved image hosts.',
    ),
  ]),
  'account-deletion': _LegalContent('Account deletion', [
    (
      'Requesting deletion',
      'Use the account controls in Settings or contact the operator. Before an '
          'owner can leave or delete their account, a supported ownership '
          'transfer or arena-closure workflow must be available. This release '
          'blocks both owner actions to preserve the arena and its history.',
    ),
    (
      'Historical integrity',
      'Private email, profile image, and active authentication identity can be '
          'removed. Finalized competition records may retain anonymized scores '
          'and picks where deleting them would corrupt rankings or other '
          'members’ historical results.',
    ),
    (
      'Verification',
      'Deletion may require recent authentication. Backups and security logs '
          'may age out according to the service provider’s retention schedule.',
    ),
  ]),
};
