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
| `.../entries/{uid}/picks/{gameId}` | Private pre-lock team choice | Owner read/write before lock |
| `.../weeks/{weekId}/reveals/{gameId}/picks/{uid}` | Post-lock reveal copy | Members after server reveal |
| `leagues/{leagueId}/standings/{uid}` | Rebuilt aggregate snapshot | Active members read |
| `leagues/{leagueId}/auditLogs/{id}` | Safe immutable admin trail | Owner/commissioner read |
| `sportsCache/{key}` | Normalized provider cache/content hash | Server only |
| `providerUsage/{provider}` | Budget, health, quota and breaker | Server only |
| `providerLocks/{key}` | Distributed refresh lease | Server only |
| `joinCodeMappings/{hash}` | Non-queryable join lookup | Server only |

## Canonical game

The game snapshot includes provider identifiers, sport/league/season, optional
round, scheduled/published/lock timestamps, venue/neutral status, typed teams,
normalized status, scores/winner, provider and sync timestamps, override data,
result version, and source payload hash.

Canonical IDs use `{provider}:{sportCode}:{providerGameId}`. Lock timestamps are
monotonic once the server has locked or revealed the game.

## Entries and picks

The public entry stores eligibility, completion counts, grade totals, points,
accuracy, rank, winner flag, and last server sync. It never stores a team choice.
Each private pick stores one selected team, server-confirmation and lock
snapshots, outcome, points, and the result version used for grading.

## Indexes

`firestore.indexes.json` contains queries for ordered weeks, rotation, game
status/lock, and provider cache expiration. Add indexes only from observed query
needs; avoid broad collection-group indexes over private pick fields.
