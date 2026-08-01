import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/core/widgets/catalog_logo_policy.dart';
import 'package:lukespics/data/models/game.dart';
import 'package:lukespics/data/models/sports_catalog.dart';

void main() {
  final game = _game();

  test('shared catalog logo policy requires matching reviewed metadata', () {
    final policy = catalogTeamLogoPolicy(
      presentation: CatalogPresentation(
        provider: 'apiSports',
        attributionText: '',
        allowRemoteLogos: true,
        allowedLogoHosts: const {'media.example.test'},
        allowedLogoQueryParameters: const {},
        logoRightsReviewDate: DateTime.utc(2026, 7, 31),
      ),
      game: game,
    );

    expect(
      policy.permittedUri(Uri.parse('https://media.example.test/team.png')),
      isNotNull,
    );
  });

  test('provider mismatch and unreviewed rights remain disabled', () {
    final mismatch = catalogTeamLogoPolicy(
      presentation: CatalogPresentation(
        provider: 'other',
        attributionText: '',
        allowRemoteLogos: true,
        allowedLogoHosts: const {'media.example.test'},
        allowedLogoQueryParameters: const {},
        logoRightsReviewDate: DateTime.utc(2026, 7, 31),
      ),
      game: game,
    );
    final unreviewed = catalogTeamLogoPolicy(
      presentation: const CatalogPresentation(
        provider: 'apiSports',
        attributionText: '',
        allowRemoteLogos: true,
        allowedLogoHosts: {'media.example.test'},
        allowedLogoQueryParameters: {},
        logoRightsReviewDate: null,
      ),
      game: game,
    );

    final candidate = Uri.parse('https://media.example.test/team.png');
    expect(mismatch.permittedUri(candidate), isNull);
    expect(unreviewed.permittedUri(candidate), isNull);
  });
}

Game _game() {
  final scheduled = DateTime.utc(2026, 8, 1, 18);
  return Game(
    id: 'apiSports:baseball:test-1',
    provider: 'apiSports',
    providerGameId: 'test-1',
    sportCode: 'baseball',
    leagueCode: 'mlb',
    leagueName: 'MLB',
    season: '2026',
    scheduledAtUtc: scheduled,
    publishedScheduledAtUtc: scheduled,
    effectiveLockAtUtc: scheduled,
    homeTeam: const Team(
      id: 'home',
      name: 'Home Club',
      shortName: 'Home',
      abbreviation: 'HOM',
    ),
    awayTeam: const Team(
      id: 'away',
      name: 'Away Club',
      shortName: 'Away',
      abbreviation: 'AWY',
    ),
    status: GameStatus.scheduled,
    providerLastUpdatedAt: scheduled,
    lastSyncedAt: scheduled,
    resultVersion: 1,
    sourcePayloadHash:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  );
}
