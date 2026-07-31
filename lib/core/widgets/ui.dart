import 'package:flutter/material.dart';

import '../../app/theme/app_theme.dart';
import '../../data/models/game.dart';

class PageHeader extends StatelessWidget {
  const PageHeader({
    super.key,
    required this.eyebrow,
    required this.title,
    required this.description,
    this.action,
  });

  final String eyebrow;
  final String title;
  final String description;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final text = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          eyebrow.toUpperCase(),
          style: TextStyle(
            color: Theme.of(context).colorScheme.tertiary,
            fontWeight: FontWeight.w900,
            letterSpacing: 1.4,
            fontSize: 12,
          ),
        ),
        const SizedBox(height: 7),
        Text(title, style: Theme.of(context).textTheme.headlineLarge),
        const SizedBox(height: 8),
        Text(
          description,
          style: Theme.of(context).textTheme.bodyLarge?.copyWith(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
            height: 1.45,
          ),
        ),
      ],
    );
    if (action == null) return text;
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 700) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [text, const SizedBox(height: 18), action!],
          );
        }
        return Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(child: text),
            const SizedBox(width: 24),
            action!,
          ],
        );
      },
    );
  }
}

class SectionCard extends StatelessWidget {
  const SectionCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(20),
    this.color,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: color,
      child: Padding(padding: padding, child: child),
    );
  }
}

class StatusPill extends StatelessWidget {
  const StatusPill({
    super.key,
    required this.label,
    this.icon,
    this.tone = StatusTone.neutral,
  });

  final String label;
  final IconData? icon;
  final StatusTone tone;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final (background, foreground) = switch (tone) {
      StatusTone.success => (
        isDark ? const Color(0xFF123E33) : const Color(0xFFD9F3E8),
        isDark ? const Color(0xFF8CE3C2) : const Color(0xFF075D42),
      ),
      StatusTone.warning => (
        isDark ? const Color(0xFF49350E) : const Color(0xFFFFEDC5),
        isDark ? const Color(0xFFFFD47D) : const Color(0xFF744400),
      ),
      StatusTone.info => (
        isDark ? const Color(0xFF18365E) : const Color(0xFFE1ECFF),
        isDark ? const Color(0xFFAEC9FF) : const Color(0xFF174A9D),
      ),
      StatusTone.danger => (
        isDark ? const Color(0xFF4A211E) : const Color(0xFFFFE0DC),
        isDark ? const Color(0xFFFFB4AB) : BrandColors.danger,
      ),
      StatusTone.neutral => (
        isDark ? const Color(0xFF273344) : const Color(0xFFE9EDF3),
        Theme.of(context).colorScheme.onSurfaceVariant,
      ),
    };
    return Semantics(
      label: 'Status: $label',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, size: 15, color: foreground),
              const SizedBox(width: 5),
            ],
            Flexible(
              child: Text(
                label,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: foreground,
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

enum StatusTone { neutral, success, warning, info, danger }

/// A fail-closed policy for displaying provider-returned team marks.
///
/// Callers must explicitly identify the provider, confirm that display rights
/// have been verified for the current runtime, and list each permitted image
/// host. Hosts are exact matches: allowing `images.example.com` does not also
/// allow arbitrary subdomains. ESPN-owned hosts and credential-bearing URLs
/// are rejected regardless of the supplied allowlist. Query parameters are
/// also fail-closed and must be individually identified as safe.
@immutable
final class TeamLogoPolicy {
  const TeamLogoPolicy.disabled()
    : provider = '',
      logoRightsVerified = false,
      allowedHosts = const <String>{},
      allowedQueryParameters = const <String>{};

  const TeamLogoPolicy.provider({
    required this.provider,
    required this.logoRightsVerified,
    required this.allowedHosts,
    this.allowedQueryParameters = const <String>{},
  });

  final String provider;
  final bool logoRightsVerified;
  final Set<String> allowedHosts;
  final Set<String> allowedQueryParameters;

  Uri? permittedUri(Uri? candidate) {
    if (!logoRightsVerified ||
        provider.trim().isEmpty ||
        candidate == null ||
        candidate.scheme.toLowerCase() != 'https' ||
        candidate.host.isEmpty ||
        candidate.userInfo.isNotEmpty) {
      return null;
    }

    final host = _normalizeLogoHost(candidate.host);
    final permittedQueryKeys = allowedQueryParameters
        .map((key) => key.trim().toLowerCase())
        .toSet();
    if (_isEspnLogoHost(host) ||
        !allowedHosts.any((allowed) => _normalizeLogoHost(allowed) == host) ||
        candidate.queryParameters.keys.any(
          (key) =>
              _isSensitiveLogoQueryKey(key) ||
              !permittedQueryKeys.contains(key.trim().toLowerCase()),
        )) {
      return null;
    }

    // Fragments are not sent to the image host and add no rendering value.
    // Removing them also keeps error diagnostics from carrying irrelevant URL
    // data. This widget never logs the original or resolved URL.
    return candidate.removeFragment();
  }
}

typedef TeamLogoImageProviderBuilder =
    ImageProvider<Object> Function(Uri permittedUri);

class TeamBadge extends StatelessWidget {
  const TeamBadge({
    super.key,
    required this.team,
    this.size = 42,
    this.logoPolicy = const TeamLogoPolicy.disabled(),
    this.imageProviderBuilder,
  });

  final Team team;
  final double size;
  final TeamLogoPolicy logoPolicy;

  /// Primarily useful for deterministic image loading in tests.
  ///
  /// Production callers normally leave this null so a cross-platform
  /// [NetworkImage] is used.
  final TeamLogoImageProviderBuilder? imageProviderBuilder;

  @override
  Widget build(BuildContext context) {
    final permittedLogo = logoPolicy.permittedUri(team.logoUrl);
    final fallback = _TeamBadgeFallback(team: team, size: size);
    final mark = permittedLogo == null
        ? fallback
        : _PermittedTeamLogo(
            uri: permittedLogo,
            size: size,
            fallback: fallback,
            imageProviderBuilder: imageProviderBuilder,
          );
    return Semantics(
      label: '${team.name} team mark',
      image: true,
      child: ExcludeSemantics(
        child: SizedBox.square(dimension: size, child: mark),
      ),
    );
  }
}

class _PermittedTeamLogo extends StatelessWidget {
  const _PermittedTeamLogo({
    required this.uri,
    required this.size,
    required this.fallback,
    this.imageProviderBuilder,
  });

  final Uri uri;
  final double size;
  final Widget fallback;
  final TeamLogoImageProviderBuilder? imageProviderBuilder;

  @override
  Widget build(BuildContext context) {
    final imageProvider =
        imageProviderBuilder?.call(uri) ?? NetworkImage(uri.toString());
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(size * 0.32),
        border: Border.all(color: Theme.of(context).dividerColor),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(size * 0.32),
        child: Image(
          image: imageProvider,
          width: size,
          height: size,
          fit: BoxFit.contain,
          filterQuality: FilterQuality.medium,
          gaplessPlayback: true,
          excludeFromSemantics: true,
          frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
            if (wasSynchronouslyLoaded || frame != null) return child;
            return fallback;
          },
          errorBuilder: (context, error, stackTrace) => fallback,
        ),
      ),
    );
  }
}

class _TeamBadgeFallback extends StatelessWidget {
  const _TeamBadgeFallback({required this.team, required this.size});

  final Team team;
  final double size;

  @override
  Widget build(BuildContext context) {
    final colors = [
      BrandColors.navy,
      const Color(0xFF174A79),
      const Color(0xFF6A3E8E),
      const Color(0xFF76510A),
    ];
    final color =
        colors[team.id.codeUnits.fold(0, (a, b) => a + b) % colors.length];
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(size * 0.32),
        border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
      ),
      child: Text(
        team.abbreviation,
        style: TextStyle(
          color: Colors.white,
          fontSize: size * 0.28,
          fontWeight: FontWeight.w900,
          letterSpacing: 0.4,
        ),
      ),
    );
  }
}

const _sensitiveLogoQueryKeys = <String>{
  'access_token',
  'api-key',
  'api_key',
  'apikey',
  'auth',
  'authorization',
  'credential',
  'key',
  'secret',
  'sig',
  'signature',
  'token',
};

String _normalizeLogoHost(String value) {
  final normalized = value.trim().toLowerCase();
  return normalized.endsWith('.')
      ? normalized.substring(0, normalized.length - 1)
      : normalized;
}

bool _isEspnLogoHost(String host) {
  final labels = host.split('.');
  return labels.any((label) => label == 'espn' || label == 'espncdn');
}

bool _isSensitiveLogoQueryKey(String key) {
  final normalized = key.trim().toLowerCase();
  final compact = normalized.replaceAll(RegExp('[^a-z0-9]'), '');
  return _sensitiveLogoQueryKeys.contains(normalized) ||
      compact.endsWith('apikey') ||
      compact.contains('accesstoken') ||
      compact.contains('accessid') ||
      compact.contains('authorization') ||
      compact.contains('credential') ||
      compact.contains('password') ||
      compact.contains('signature') ||
      compact.contains('token') ||
      compact.contains('secret');
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });

  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final compact =
            constraints.hasBoundedHeight && constraints.maxHeight < 180;
        return SectionCard(
          padding: EdgeInsets.all(compact ? 8 : 20),
          child: Padding(
            padding: EdgeInsets.symmetric(vertical: compact ? 0 : 28),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 440),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (!compact) ...[
                      Icon(
                        icon,
                        size: 44,
                        color: Theme.of(context).colorScheme.tertiary,
                      ),
                      const SizedBox(height: 14),
                    ],
                    Text(
                      title,
                      textAlign: TextAlign.center,
                      style: compact
                          ? Theme.of(context).textTheme.titleSmall
                          : Theme.of(context).textTheme.titleLarge,
                    ),
                    SizedBox(height: compact ? 4 : 8),
                    Text(
                      message,
                      textAlign: TextAlign.center,
                      maxLines: compact ? 2 : null,
                      overflow: compact ? TextOverflow.ellipsis : null,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                        fontSize: compact ? 12 : null,
                        height: compact ? 1.2 : 1.4,
                      ),
                    ),
                    if (action != null) ...[
                      SizedBox(height: compact ? 10 : 20),
                      action!,
                    ],
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

String gameStatusLabel(GameStatus status) => switch (status) {
  GameStatus.scheduled => 'Scheduled',
  GameStatus.delayed => 'Delayed',
  GameStatus.live => 'Live',
  GameStatus.finalStatus => 'Final',
  GameStatus.postponed => 'Postponed',
  GameStatus.suspended => 'Suspended',
  GameStatus.cancelled => 'Cancelled',
  GameStatus.voided => 'Void',
  GameStatus.reviewRequired => 'Review needed',
};

StatusTone gameStatusTone(GameStatus status) => switch (status) {
  GameStatus.finalStatus => StatusTone.success,
  GameStatus.live => StatusTone.danger,
  GameStatus.delayed ||
  GameStatus.postponed ||
  GameStatus.suspended ||
  GameStatus.reviewRequired => StatusTone.warning,
  GameStatus.cancelled || GameStatus.voided => StatusTone.neutral,
  GameStatus.scheduled => StatusTone.info,
};
