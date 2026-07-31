# Connected weekly picker lifecycle

This document is the product and operations contract for the Firebase-connected
weekly flow. It distinguishes intended behavior from validation evidence. A
behavior described here is not considered release-verified until it appears in
the dated matrix in [validation-report.md](validation-report.md).

## Arena and week state

An arena has active members, an ordered picker rotation, one current week, and
one designated picker for that week. A week progresses through these states:

1. `draft`: the picker can build and reconcile the slate.
2. `open`: the published slate accepts eligible picks before each lock.
3. `inProgress`: at least one game is live or locked while later games may
   remain open under per-game locking.
4. `review`: all games are final or void, or an unresolved result needs an
   authorized decision.
5. `finalized`: scores and standings are authoritative and rotation has
   advanced exactly once.

Reopening a finalized week is an audited correction path. It does not erase the
historical week.

## Catalog games and selected games

The catalog and the week slate are different datasets:

- `catalogGames` are normalized, cached provider candidates returned for the
  active picker’s sport, league, and date query.
- `selectedWeekGames` are immutable snapshots under the active week after
  publication.
- Local selection state is a desired draft set. Saving must add missing games
  and remove deselected draft games until the server set exactly matches that
  desired set.

A week subscription must never replace the catalog. Entering or refreshing the
catalog must issue a catalog query for the restored arena and current picker;
catalog loading cannot depend on arena creation.

Only an upcoming, canonical game can be added. There must be at least one game
and there is no product maximum. Publishing freezes the reviewed set and
creates participant entry snapshots.

## Participants and picker settings

Active members are snapshotted when the slate is published. Members who join
after publication normally become eligible with the next week. Inactive and
removed members are skipped by future rotation without deleting their history.

`pickerParticipatesInPicks` is snapshotted for the week:

- `false` is the default. The picker builds the slate but has no pick entry and
  is not counted as missing.
- `true` makes the picker an ordinary eligible participant after publication.

League-setting writes are partial patches. Updating picker participation must
preserve omitted values such as provider mode, lock policy, schedule
configuration, enabled sports, and manual-finalization policy. A regression test
and the connected Week 2 browser path verify that changing participation does
not reset the internal catalog/provider configuration.

Only the weekly picker may edit or publish a draft slate, except for an
explicit owner/commissioner override enforced by the backend.

## Pick saving, locks, and privacy

Each eligible member chooses exactly one of the two canonical teams for every
published game.

- Server time and the stored effective lock are authoritative.
- The default policy locks each game independently.
- A member may change an open game, including a later game after an earlier
  game has locked.
- The client submits only the changed open selection, prevents duplicate taps,
  and reconciles optimistic state with the server response.
- A disconnected choice is a clearly labeled local draft, not an accepted
  pick. Retry remains subject to the server lock.
- A late or otherwise rejected write rolls back or remains visibly rejected
  with an actionable retry message.

Private selections remain only at:

`entries/{uid}/picks/{gameId}`

No other member, owner, or commissioner may read them before lock. After lock,
trusted backend processing writes a separate reveal-safe copy at:

`reveals/{gameId}/picks/{uid}`

Scheduled processing must reveal locked picks without relying on a user opening
a screen. Public entry documents may expose completion counts but never the
pre-lock team choice.

## Results, scoring, and standings

Scoring is straight-up:

- correct pick: one point;
- incorrect or locked-missing pick: zero points;
- void or canceled game: excluded from the graded denominator;
- true tie without a valid winner: `reviewRequired` until voided or resolved;
- postponed, suspended, or unresolved game: blocks finalization.

Weekly high-score ties produce co-winners. Overall standings sort total correct
picks first, then accuracy and weekly titles according to the scoring engine.
The rebuild operation recomputes standings from finalized snapshots rather than
trusting client totals.

## Finalization, correction, and next week

Finalization must be idempotent:

1. Recompute the week from authoritative games and private picks.
2. Write entry grades and weekly winners.
3. Rebuild aggregate standings.
4. Advance rotation exactly once, skipping inactive members.
5. Record the proposed next picker.

If a follow-up fails, retrying the same finalization must repair it without
double-scoring or rotating again. A correction requires an audited reopen,
result override or void reason, recalculation, standings rebuild, and
refinalization.

After finalization, an authorized administrator creates the next sequential
week and assigns the proposed rotated picker. Neither finalization nor refresh
may silently create duplicate weeks.

## Provider modes

| Mode | Allowed environment | Current release gate |
|---|---|---|
| `mock` | Automated tests and Firebase emulators only | Must be rejected in `lukes-picks` |
| `manual` | Emulator and production fallback | Required production mode until a provider is approved |
| `theSportsDbTest` | Emulator/internal test only | Requires `ALLOW_THESPORTSDB_TEST_PROVIDER=true`, documented API use, fixtures, and a hard rejection in `lukes-picks` |
| `apiSports` | Potential production adapter | Disabled until an existing key, coverage, quota, result shapes, terms, and publication/logo rights are verified |

The connected release candidate contains mock, manual, API-Sports, and
TheSportsDB test adapters. Sanitized fixtures and provider-policy tests verify
normalization, retries, caching, rate limits, host restrictions, attribution,
the exact emulator/flag gate, and rejection in `lukes-picks`. The passing
three-user browser lifecycle exercises the internal TheSportsDB schedule through
the actual Flutter UI. Production remains `manual`.

No client calls a sports provider directly. No ESPN website, internal API,
fantasy endpoint, logo host, or undocumented JSON endpoint may be scraped,
proxied, cached, embedded, or hotlinked.

## Team marks

The display order is:

1. a provider-returned mark whose host and use rights are permitted;
2. a documented repository-owned or licensed asset;
3. a neutral initials badge.

Provider access does not establish logo rights. Production uses neutral badges
until rights are confirmed. Remote images require HTTPS, an allowlisted host,
fixed dimensions, preserved aspect ratio, a loading placeholder, an error
fallback, and an accessible team-name label. TheSportsDB image URLs are
internal-test-only and require attribution.

## Required connected validation

The release gate is a browser-driven Flutter test against Auth, Firestore,
Functions, and Hosting emulators under `demo-lukes-picks-local`. It uses at
least three users and covers create/join, restored membership, catalog query,
select/remove/publish, private picks, pre-lock change, late rejection, reveal,
results, finalization, standings, rotation, next-week creation, refresh, and
sign-out/sign-in. The relevant sequence must run with picker participation both
disabled and enabled.

The emulator proof does not authorize a public test provider or replace a
Hosting preview smoke test.
