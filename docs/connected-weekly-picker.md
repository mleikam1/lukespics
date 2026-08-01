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

- `currentCatalogResultsById` contains only the normalized candidates returned
  for the active sport, league, and date query. Each successful query replaces
  this map.
- `catalogGameCacheById` keeps the newest canonical game objects seen across
  queries, allowing a later response or week stream to refresh known data.
- `selectedDraftGamesById` is the local desired draft set and retains complete
  game objects while the picker changes filters.
- `serverDraftGameIds` is the last authoritative saved set used to compute
  exact additions and removals.
- `selectedWeekGames` is the authoritative Firestore stream of week-owned game
  snapshots. It drives published picks/results and restores a clean saved draft
  after reload.

A week subscription must never replace the catalog. Entering or refreshing the
catalog must issue a catalog query for the restored arena and current picker;
catalog loading cannot depend on arena creation. A catalog response may refresh
a selected game's canonical fields, but replacing the current result map must
not remove a selection made under another query.

Only an upcoming, canonical game can be added. There must be at least one game
and there is no product maximum. Publishing freezes the reviewed set and
creates participant entry snapshots.

### Server-discovered catalog contract

The first `listSportsCatalog` request for a draft week may omit sport, league,
season, provider league ID, and dates. The server discovers the enabled choices
from the arena's configured provider and returns:

- `sports`: stable code and display name;
- `leagues`: code, display name, sport code, canonical provider league ID, and
  validated season;
- normalized `games` with selection eligibility;
- cache freshness/delay metadata and availability state;
- provider presentation and attribution policy;
- the server-effective canonical query; and
- active-week start/end bounds.

The client renders only the sports and leagues returned by this contract. A
sport, league, season, or provider league ID supplied on a later query must
resolve to the server's enabled catalog; the client cannot invent support by
sending arbitrary metadata.

When publication succeeds, the backend atomically stores the provider name and
reviewed presentation policy on the week. The week contract is already
readable by active members, so Picks and Results can enforce approved logo
policy without exposing the picker-only catalog callable. Legacy, missing, or
provider-mismatched snapshots deliberately render neutral initials.

All date filters use calendar dates in the arena's stored IANA timezone. The
client offers Today, Tomorrow, Later, All dates, and a custom range, clamps the
window to the active week, and caps it at seven inclusive days. The callable
independently requires `from` and `to` together, enforces the seven-day maximum
and week bounds, and uses the arena timezone rather than trusting a client
timezone. Discovery derives a deterministic remaining-week range of at most
seven days.

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

Follow-up repair has its own short-lived, heartbeat-backed claim and accepts
only a freshly read `finalized` week. Reopen rejects while that claim is active;
after reopen, the repair path fails closed and cannot move the week back to
`finalized`. Claim IDs are unique per invocation, so an expired-worker cleanup
cannot release a newer repair owner.

Every finalized/reopened status transition also increments the arena's
`standingsEpoch`. A rebuild reads that epoch before it reads any week entries,
checks it in every transactional write chunk, and restarts from a fresh snapshot
if another week changes. The completion epoch is recorded only after all chunks
settle, preventing one week's delayed repair from restoring another reopened
week's stale points. Rank movement is recomputed from the same authoritative
snapshot with the latest finalized week excluded; it never reads a partially
written standings generation as its prior-rank source. Clients hide standings
while `standingsBuiltEpoch` trails `standingsEpoch`. A standalone commissioner
rebuild reserves a new epoch before reading so it uses the same publication
fence even when no week status changes. A legacy or interrupted follow-up
repair likewise reserves an epoch only when no dirty generation is already
outstanding, so retrying a failed repair cannot repeatedly advance the epoch.

After finalization, an authorized administrator creates the next sequential
week only after the server-owned rotation marker and next-picker value are
present. The backend derives that picker from the finalized week and rejects a
stale client override. If that recorded member becomes inactive before the next
week is created, the server transaction advances to the next active rotation
member and updates the authoritative marker before creating the draft. Neither
finalization nor refresh may silently create duplicate weeks.

## Provider modes

| Mode | Allowed environment | Current release gate |
|---|---|---|
| `mock` | Automated tests and Firebase emulators only | Must be rejected in `lukes-picks` |
| `manual` | Emulator and production fallback | Required production mode until a provider is approved |
| `theSportsDbTest` | Emulator/internal test only | Requires `ALLOW_THESPORTSDB_TEST_PROVIDER=true`, documented API use, fixtures, and a hard rejection in `lukes-picks` |
| `apiSports` | Production adapter in source | Disabled until an approved secret, validated server catalog, authenticated contract/quota checks, explicit deploy parameter, and terms gate all pass |
| `espn` | Server-only Site API adapter in source | Default-off until written authorization, exact project/flag, enabled authorization record, live contract validation, and separate logo-rights gates pass |

The deployed connected release contains mock, manual, API-Sports, TheSportsDB
test, and dormant ESPN adapters. Its fixture, policy, and three-user browser
evidence verifies the complete sanitized schedule-to-standings flow through the
actual Flutter UI. Production remains `manual`; both external-provider deploy
flags are false and neither activation document exists.

API-Sports remains a dormant alternative with its own default-false flag and
server-only catalog, but the current provider-bearing Function declarations do
not bind `API_SPORTS_KEY`. Flutter never supplies base URLs, request paths,
league identities, result mappings, or logo policy for either adapter.

The API-Sports paragraph above describes a dormant alternative path. The ESPN
candidate binds no provider secret, but must not be enabled or described as an
authorized production schedule until written permission, server authorization
metadata, live contract validation, the full test matrix, guarded preview, and
smoke test are complete.

No client calls a sports provider directly. Only the server adapter may call the
exact allowlisted Site API scoreboard route after activation; no ESPN HTML,
fantasy endpoint, arbitrary JSON endpoint, or user-supplied URL may be scraped
or proxied. ESPN-hosted artwork remains disabled absent separate rights review.

## Team marks

The display order is:

1. a provider-returned mark whose host and use rights are permitted;
2. a documented repository-owned or licensed asset;
3. a neutral initials badge.

Provider access does not establish logo rights. Production uses neutral badges
until rights are confirmed. API-Sports presentation defaults to
`allowRemoteLogos=false`. Enabling remote marks requires a server-reviewed date
and exact host/query-parameter allowlists; provider normalization strips URLs
that do not match, and Flutter independently requires a matching provider,
HTTPS, the exact host, and permitted query keys. ESPN marks additionally require
the adapter's separate rights gate; public bundles contain no ESPN hostname.
Remote images also require fixed dimensions, preserved aspect ratio, a loading
placeholder, an error fallback, and an accessible team-name label.
TheSportsDB image URLs are internal-test-only and require attribution.

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

The live-catalog changes are a new candidate, not part of the previously dated
release evidence. Sanitized API-Sports fixtures, typed response parsing, query
bounds, separate draft/catalog state, selective secret binding, provider
policy, logo fallback, Functions integration, and the browser lifecycle must
all pass on the final reviewed tree before a release claim is made.
