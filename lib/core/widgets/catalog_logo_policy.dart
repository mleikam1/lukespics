import '../../data/models/game.dart';
import '../../data/models/sports_catalog.dart';
import 'ui.dart';

/// Builds the one presentation policy used by every game-card surface.
///
/// Server metadata is necessary but never sufficient on its own: the
/// provider must match the game and the underlying [TeamLogoPolicy] still
/// enforces HTTPS, exact hosts, safe query keys, and the permanent ESPN deny
/// list for every individual URL.
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
