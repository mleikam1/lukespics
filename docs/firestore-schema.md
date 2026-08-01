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
| `.../weeks/{weekId}/games/{gameId}` | Canonical selected-game snapshot and result | While the week is `draft`: assigned picker and owner/commissioner only; afterward active members read; server writes |
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
| `systemConfig/espnCatalog` | Default-off ESPN activation and fail-closed presentation policy | Server only |
| `systemConfig/apiSportsCatalog` | Validated API-Sports leagues and fail-closed presentation policy | Server only |
| `systemConfig/theSportsDbTestCatalog` | Emulator/internal-test provider catalog | Server only |
| `systemConfig/{id}` | Other server-only runtime configuration | Server only |

## Canonical game

The game snapshot includes `provider`, `providerGameId`, canonical
`providerLeagueId`, sport/league/season, optional round, scheduled/published/lock
timestamps, venue/neutral status, typed teams, normalized status,
status detail, scores/winner, broadcast/event detail, provider raw-schema
version, provider and sync timestamps, override data, result version, and source
payload hash. Teams may include a normalized color and a rights-gated remote
logo URL. The provider league ID and season are persisted so later
result refresh can reproduce the exact provider query without guessing from a
display league code.

Canonical IDs use `{provider}:{sportCode}:{providerGameId}`. ESPN documents use
`espn:{sportCode}:{eventId}`; the ESPN event ID, not team names and date, keeps
doubleheaders and rescheduled games distinct. Lock timestamps are monotonic once
the server has locked or revealed the game.

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

`systemConfig/espnCatalog` is read only by trusted Functions through the Admin
SDK. The exact activation shape is intentionally small:

- `enabled`: must be exactly `true`, in addition to the default-false
  `ALLOW_ESPN_PROVIDER` deploy flag and exact-production-project check;
- `authorizationReference`: a bounded, non-secret identifier for the retained
  written-authorization/legal approval record;
- `authorizationReviewedAt`: the ISO review date for that record; and
- `presentation`: optional fail-closed attribution and remote-logo policy with
  `attributionText`, `allowRemoteLogos`, and `logoRightsReviewDate`. The adapter,
  not Firestore, fixes the only eligible logo hostname to `a.espncdn.com` and
  rejects every query parameter.

The eight sport/league identities, ESPN slugs, optional query parameters, tie
behavior, and enabled defaults are centralized in static server code rather
than accepted from Firestore or Flutter. A missing, disabled, malformed, or
logo-policy-incomplete document leaves the adapter unavailable or remote logos
off. Firestore rules deny all client reads and writes. Creating or enabling the
document is a separately authorized production write and must not occur before
written ESPN/Disney authorization and legal/product approval. Store only the
bounded reference and date—not secret values or the authorization/legal
document contents.

The catalog/cache documents store normalized Luke's Picks data, timestamps, a
content hash, and only bounded diagnostics—not an unrestricted raw ESPN payload.
The raw provider schema is never copied to Flutter. Cache keys include provider,
canonical league identity, date window, and arena timezone; canonical catalog
eligibility documents are server-only and are snapshotted into a week only
after the picker selects them.

The older `systemConfig/apiSportsCatalog` contract remains documented below as
a dormant replaceable-provider option; it is not the ESPN activation document.

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
