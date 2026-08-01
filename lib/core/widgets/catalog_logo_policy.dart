import '../../data/models/game.dart';
import '../../data/models/sports_catalog.dart';
import 'ui.dart';

/// Builds the one presentation policy used by every game-card surface.
///
/// Server metadata is necessary but never sufficient on its own: the
/// provider must match the game and the underlying [TeamLogoPolicy] still
/// enforces HTTPS, exact hosts, and safe query keys for every individual URL.
/// Provider presentation remains disabled unless the server supplies a
/// reviewed date and an exact host allowlist.
TeamLogoPolicy catalogTeamLogoPolicy({
  required CatalogPresentation presentation,
  required Game game,
}) {
  if (!presentation.permitsRemoteLogosForProvider(game.provider)) {
    return const TeamLogoPolicy.disabled();
  }
  return TeamLogoPolicy.provider(
    provider: presentation.provider,
    logoRightsVerified: true,
    allowedHosts: presentation.allowedLogoHosts,
    allowedQueryParameters: presentation.allowedLogoQueryParameters,
  );
}
