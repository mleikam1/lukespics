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
| `systemConfig/{id}` | Server-only provider configuration | Server only |

## Canonical game

The game snapshot includes provider identifiers, sport/league/season, optional
round, scheduled/published/lock timestamps, venue/neutral status, typed teams,
normalized status, scores/winner, provider and sync timestamps, override data,
result version, and source payload hash.

Canonical IDs use `{provider}:{sportCode}:{providerGameId}`. Lock timestamps are
monotonic once the server has locked or revealed the game.

Catalog documents are not week selections. Draft save validates their
eligibility, then writes a week-owned canonical snapshot. Deselecting a draft
game must delete that week snapshot during desired-set reconciliation.
Publishing grades and displays only the final week snapshots.

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
