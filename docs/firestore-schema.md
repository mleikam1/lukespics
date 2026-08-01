# Firestore schema

All timestamps are UTC Firestore timestamps. Historical weeks snapshot mutable
league rules and display names.

| Path | Purpose | Client access |
|---|---|---|
| `users/{uid}` | Private identity, email, login/account state | Own read and limited update |
| `leagues/{leagueId}` | Arena metadata and settings | Active members read; privileged writes via Functions |
| `leagues/{leagueId}/members/{uid}` | League-safe profile, role/status, rotation order | Active members read |
| `leagues/{leagueId}/private/invite` | Hashed invite configuration | Server only |
| `leagues/{leagueId}/weeks/{weekId}` | Explicit week, picker, snapshots, status, winners | Active members read |
| `.../weeks/{weekId}/games/{gameId}` | Canonical selected-game snapshot and result | Active members read; server writes |
| `.../weeks/{weekId}/entries/{uid}` | Public completion and graded summary | Active members read; server writes |
| `.../entries/{uid}/picks/{gameId}` | Private pre-lock team choice | Matching entry user (`uid`) only before lock; arena owners/commissioners denied |
| `.../weeks/{weekId}/reveals/{gameId}/picks/{uid}` | Post-lock reveal copy | Members after server reveal |
| `leagues/{leagueId}/standings/{uid}` | Rebuilt aggregate snapshot | Active members read |
| `leagues/{leagueId}/auditLogs/{id}` | Safe immutable admin trail | Owner/commissioner read |
| `sportsCache/{key}` | Normalized provider cache/content hash | Server only |
| `sportsCache/{key}/items/{gameId}` | Normalized cached query item | Server only |
| `sportsCatalogGames/{gameId}` | Canonical catalog eligibility snapshot used to validate a draft | Server only |
| `providerUsage/{provider}` | Budget, health, quota and breaker | Server only |
| `providerLocks/{key}` | Distributed refresh lease | Server only |
| `providerManualRefreshLimits/{id}` | Server-side manual refresh throttle | Server only |
| `joinCodeMappings/{hash}` | Non-queryable join lookup | Server only |
| `joinAttemptLimits/{id}` | Hashed join-attempt throttle state | Server only |
| `systemConfig/apiSportsCatalog` | Validated API-Sports leagues and fail-closed presentation policy | Server only |
| `systemConfig/theSportsDbTestCatalog` | Emulator/internal-test provider catalog | Server only |
| `systemConfig/{id}` | Other server-only runtime configuration | Server only |

## Canonical game

The game snapshot includes `provider`, `providerGameId`, canonical
`providerLeagueId`, sport/league/season, optional round, scheduled/published/lock
timestamps, venue/neutral status, typed teams, normalized status,
scores/winner, provider and sync timestamps, override data, result version, and
source payload hash. The provider league ID and season are persisted so later
result refresh can reproduce the exact provider query without guessing from a
display league code.

Canonical IDs use `{provider}:{sportCode}:{providerGameId}`. Lock timestamps are
monotonic once the server has locked or revealed the game.

Catalog documents are not week selections. Draft save validates their
eligibility, then writes a week-owned canonical snapshot. Deselecting a draft
game must delete that week snapshot during desired-set reconciliation.
Publishing grades and displays only the final week snapshots.

When a slate is published, the trusted backend writes
`catalogProviderSnapshot` and `catalogPresentationSnapshot` atomically with the
week's `open` status. The presentation snapshot contains only provider name,
attribution, the remote-logo enable flag, exact allowed hosts/query keys, and
the rights-review date. It contains no credential, provider endpoint, or raw
payload. Active members can read it through the existing week rule, but all
week writes remain server-only. The client requires the two provider fields to
match; missing or malformed legacy snapshots fail closed to neutral badges.

Multi-step publish, result-sync, reveal, and finalization-follow-up operations
use unique per-invocation claim IDs plus started/heartbeat timestamps on the
week. Transactional chunks verify the current claim before every side effect;
cleanup deletes only the caller's claim. Finalization follow-up completion is
versioned by `finalizationFollowUpsResultVersion`, while `rotationAdvancedAt`
and `nextPickerUid` make picker advancement idempotent. These fields are
operational metadata, never credentials.

The league's monotonic `standingsEpoch` changes atomically with every
finalized/reopened week transition. Standings chunks commit only while that
epoch is unchanged; `standingsBuiltEpoch` is written after the final chunk.
Concurrent cross-week changes therefore restart from the newest finalized-week
set instead of publishing a stale aggregate. Clients show the standings
generation only when the two epochs match; legacy arenas treat missing values
as `0/0`. `previousRank` is derived from the same finalized input set with its
latest week excluded rather than from mutable standings documents.
When an incomplete follow-up repair starts with equal current and built epochs,
claim acquisition increments `standingsEpoch` in the same transaction. A retry
inherits that dirty generation until it is successfully published.

Every standing snapshot carries its generation's `standingsEpoch`; the league
completion marker also records `standingsBuiltMemberCount`. Clients require the
epoch on every document and the expected count, so a league-marker event that
arrives before the final standings-query event still cannot reveal a partial
generation. Rebuilds delete obsolete standing documents under the same fence.

## Provider catalog configuration

`systemConfig/apiSportsCatalog` is read only by trusted Functions through the
Admin SDK. Firestore rules deny all client reads and writes. Its implemented
shape is:

- `leagues`: validated entries containing `sportCode`, `leagueCode`,
  `leagueName`, `providerLeagueId`, `season`, allowlisted `baseUrl`,
  `gamesPath`, and `finalStatuses`;
- `presentation`: optional `attributionText`, `allowRemoteLogos`, exact
  `allowedLogoHosts`, exact `allowedLogoQueryParameters`, and
  `logoRightsReviewDate`.

Duplicate sport/league identities, non-allowlisted API-Sports product hosts,
and incomplete remote-logo policies fail validation. When presentation is
missing, remote logos default to disabled. Source code and sanitized fixtures
do not prove that a production document exists; creating or updating one is a
separately authorized guarded operation after live credential and contract
validation.

The catalog callable returns only the enabled server-discovered sports and
leagues. Cache keys incorporate provider, canonical provider league ID, season,
date window, and timezone. Provider candidates remain in server-only catalog
and cache collections until draft save copies an exact canonical snapshot into
the week.

## Entries and picks

The public entry stores eligibility, completion counts, grade totals, points,
accuracy, rank, winner flag, and last server sync. It never stores a team choice.
Each private pick stores one selected team, server-confirmation and lock
snapshots, outcome, points, and the result version used for grading.

The client may cache an unconfirmed offline choice locally, but no Firestore
document or completion count changes until the server accepts the write before
lock.

## Indexes

`firestore.indexes.json` contains queries for ordered weeks, rotation, game
status/lock, and provider cache expiration. Add indexes only from observed query
needs; avoid broad collection-group indexes over private pick fields.

At the pre-release 2026-07-30 audit the cloud composite-index listing was empty.
The guarded `lukes-picks` deployment created the five reviewed composite
indexes, and all five reached `READY`. The prior cloud state had no composite
indexes, so rollback requires an explicit deletion review rather than an
automatic destructive command.
