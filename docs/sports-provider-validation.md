# SportsDataIO provider validation

## Current state

The `sportsDataIo` provider is implemented for NFL and MLB, but it is not
activated in production. The repository contains no API-key value, no live API
response, and no claim that the current account is entitled to the required
feeds. Production arenas must remain on `manual` until the activation checklist
below is completed and an authorized deployment is approved.

The implementation is fixture-tested and fail-closed. A missing key, a disabled
kill switch, a non-production access mode, an unverified entitlement, an
emulator runtime, or any Firebase project other than `lukes-picks` prevents the
provider from being constructed.

## Server-side flow

```text
Flutter commissioner catalog
  -> authenticated/App Check callable
  -> week and commissioner authorization
  -> provider factory and production gates
  -> Firestore cache, coalescing lock, quota, circuit breaker
  -> SportsDataIO client and NFL/MLB adapter
  -> provider-neutral NormalizedGame records
  -> exact desired-set draft reconciliation
  -> immutable publication snapshot

Selected pending games
  -> authenticated refresh or 30-minute scheduled sync
  -> one date bucket per league/day through the same gateway
  -> verified closed result only
  -> grading and standings
```

Flutter never receives the API key, constructs a SportsDataIO URL, or parses a
vendor response. It receives only normalized catalog fields and safe provider
health/cache state.

## Exact runtime endpoints and feeds

The client permits only `https://api.sportsdata.io`, HTTPS, the paths below,
validated season/date parameters, no query string, and no redirects to another
host. Authentication uses the `Ocp-Apim-Subscription-Key` request header.

| League | Runtime endpoint | Feed dependency | Purpose |
|---|---|---|---|
| NFL | `GET /v3/nfl/scores/json/Teams` | Teams / player metadata | Stable team identity and neutral display text |
| NFL | `GET /v3/nfl/scores/json/SchedulesBasic/{season}` | Schedules & Game Day Information | Season schedule, week, stable IDs, TBD/reschedule metadata |
| NFL | `GET /v3/nfl/scores/json/ScoresByDate/{date}` | Live & Final Scores | Date-bucket state and scores |
| MLB | `GET /v3/mlb/scores/json/teams` | Teams / player metadata | Stable team identity and neutral display text |
| MLB | `GET /v3/mlb/scores/json/GamesByDate/{date}` | Live & Final Scores | Schedule, exception status, stable IDs, and scores |

No `CurrentSeason`, `CurrentWeek`, season-wide MLB game feed, box-score feed, or
final-only feed is called by this implementation. NFL seasons are reviewed in
server configuration, and week context is derived from `SchedulesBasic`.
MLB `GamesByDate` remains the settlement source because a final-only feed would
omit postponed, suspended, canceled, and `NotNecessary` states.

The provider date formatter currently emits `YYYY-MMM-DD`, for example
`2026-AUG-01`, matching the official OpenAPI path examples. The discrepancy
with official input hints that show `YYYY-MM-DD` is encapsulated in one client
method and covered by contract tests. Confirm the accepted form with a bounded,
authenticated, non-production smoke test before activation.

## Configuration

`systemConfig/sportsDataIoCatalog` is server-readable only. It contains the
enabled flag, NFL/MLB league/season definitions, and bounded operational
settings; it never contains a key or contract document. Only NFL and MLB are
valid automatic-provider entries. Other sports remain manual.

The production path requires every gate:

- Firebase project is exactly `lukes-picks` and the Functions emulator is off.
- `ALLOW_SPORTSDATAIO_PROVIDER=true`.
- `SPORTSDATAIO_ACCESS_MODE=production`.
- `SPORTSDATAIO_ENTITLEMENT_VERIFIED=true` after the operator checks the actual
  key and contract against every endpoint and intended display/grading use.
- `systemConfig/sportsDataIoCatalog.enabled=true` with reviewed NFL/MLB season
  entries.
- `SPORTSDATAIO_API_KEY` is available to the provider-bearing Function.

The safe defaults are `false`, `fixture`, and `false`. Turning
`ALLOW_SPORTSDATAIO_PROVIDER` off is the immediate server-side kill switch.
Returning an arena's `providerName` to `manual` is the application fallback.

Valid access-mode names are `fixture`, `trial`, `discovery`, and `production`.
Only `production` can pass the production provider gate. Trial and Dev data may
be scrambled or display-restricted. Discovery data is delayed and has its own
personal/hobby and redistribution limits. The mode flag records an operator's
decision; it does not expand contractual rights.

## Secret handling and rotation

Create or rotate `SPORTSDATAIO_API_KEY` only after running the repository's
project guard for `lukes-picks`, using Firebase/Google Secret Manager's normal
secret-version workflow. Never pass the value on a command line that will be
saved, paste it into source or documentation, or store it in Firestore, Remote
Config, Hosting, Flutter defines, fixtures, screenshots, analytics, or logs.

The secret is bound only to:

- `listSportsCatalog`;
- `refreshSelectedGames`;
- `syncSelectedGameResults`;
- `scheduledResultSync`.

After rotation, deploy only those Functions through
`scripts/release_firebase.sh functions` in an explicitly authorized release.
Keep the old secret version until the guarded deployment and smoke checks pass,
then disable or destroy it according to the account's rotation policy. Never
print either version during verification.

## Normalization and identity

NFL and MLB use separate decoders. They tolerate unknown additive fields and
nullable optional fields, but reject records without enough identity and team
data to be a real game. Canonical IDs remain provider-qualified. Persisted
metadata can include score, league-game, global-game, game-key, team, global-
team, closure, and reschedule IDs when the endpoint supplies them.

MLB doubleheaders are never deduplicated by matchup/date; each `GameID` remains
distinct. A nullable basic-record ID is skipped only when the record cannot be
identified as a real game.

A known Eastern calendar day with no real `DateTimeUTC` is stored as
`timeTbd: true`, with nullable schedule/publication/lock instants. It is visible
in the commissioner catalog but cannot be selected or published. Luke's Picks
does not invent midnight, noon, or a lock deadline.

`DateTimeUTC` is parsed explicitly as UTC even when the source omits a suffix.
SportsDataIO query buckets use `America/New_York`; the server derives them from
the commissioner's intended Eastern date. Flutter converts the stored UTC
instant to the browser's timezone only for display. DST and late-night cases
are fixture-tested.

## Status and settlement policy

| Upstream condition | Luke's Picks state | Settlement behavior |
|---|---|---|
| `Scheduled` | `scheduled` | Not settled |
| `InProgress` or equivalent flags | `live` | Not settled |
| `Delayed` | `delayed` | Not settled |
| `Postponed` | `postponed` | Not settled |
| `Suspended` | `suspended` | Not settled; may resume under the same ID |
| `Canceled` / MLB `NotNecessary` | `cancelled` | Existing pool rule voids/excludes it |
| `Final` / NFL `F/OT` and `IsClosed == true`, scores present | `final` | Winner or tie policy applied |
| Final text with `IsClosed != true` | `reviewRequired` | Never graded |
| Forfeit, unknown state, closed missing scores, malformed ambiguity | `reviewRequired` | Manual review/override required |

NFL uses `HomeScore`/`AwayScore`; MLB uses
`HomeTeamRuns`/`AwayTeamRuns`. Equal or missing scores never default to the home
team. NFL ties remain explicit and require the existing tie/push decision.
Stale, delayed, or partial refresh data never becomes a newly graded result.

Manual overrides remain versioned and authoritative. Provider refresh skips an
overridden game. Same-ID schedule changes can update catalog observations but
cannot rewrite the published schedule/lock snapshot. Reschedule links are
stored and surfaced, but a replacement ID never silently replaces a published
selection; the commissioner uses the audited correction workflow.

## Cache, synchronization, and transport

The provider uses the existing Firestore cache, cache lock/request coalescing,
soft quota, circuit breaker, and stale fallback. Cache identity includes
provider, sport, league, season, Eastern date range, and request type.

- Teams are retained inside a provider instance and fetched only when needed.
- Future catalog games cache for 60 minutes.
- Games two to 24 hours away cache for 30 minutes.
- Games within two hours cache for 15 minutes.
- Live games cache for 10 minutes.
- Valid empty/off-season buckets cache for 30 minutes.
- Selected terminal games remain recheckable for corrections.
- The scheduled result job remains a centralized 30-minute poll.

This cadence is intentionally slower than the published minimum call intervals
for live feeds. MLB selected-game refresh fetches each necessary
`GamesByDate` bucket once and filters by stable ID; it does not fan out per game
or per browser.

Transport has an 8-second request timeout, a 5 MB response limit, and at most
three attempts. Network failures, timeouts, `429`, and transient `5xx` may retry
with bounded exponential backoff, jitter, and bounded `Retry-After`. Normal
`4xx` responses do not retry. Errors are normalized; raw bodies, full URLs,
headers, and keys are not logged or returned.

## Team marks

The app uses its own neutral abbreviation/initial badges in light and dark
themes. It does not consume provider Wikipedia-logo or team-color fields and
does not hotlink, download, cache, or rehost third-party marks.

Remote marks may be enabled only after the owner confirms entitlement to one
exact documented image operation and its display/cache/redistribution rights.
That later change must add a narrow server and UI allowlist plus tests. Logo
rights are independent of schedule/result activation.

## Local verification

Normal tests use sanitized, secret-free NFL and MLB fixtures and never call the
internet:

```bash
npm --prefix functions run lint
npm --prefix functions run typecheck
npm --prefix functions test
npm --prefix functions run test:rules
npm --prefix functions run test:integration
dart format --output=none --set-exit-if-changed .
flutter analyze
flutter test
./scripts/test_browser_e2e.sh
flutter build web --release
./scripts/check_public_source.sh
./scripts/check_public_build.sh build/web
```

The source/build scanners enforce that the key/header/host remain server-only,
that retired provider code is absent, and that blocked third-party logo hosts,
secrets, test flags, and source maps do not enter Hosting output.

An authenticated smoke test is optional and must not run in CI. It is allowed
only when a valid non-production key and explicit entitlement are already
available. Make at most one request to each required endpoint, record only the
HTTP outcome/schema compatibility, and never save the raw response or key. A
successful trial/discovery smoke does not satisfy the production gate.

## Safe activation and rollback

1. Confirm the account is entitled to both leagues' exact schedule, team, and
   live/final feeds, plus the intended public display and pick-grading use.
2. Keep neutral marks unless the separate image rights review passes.
3. Create/rotate `SPORTSDATAIO_API_KEY` in `lukes-picks` Secret Manager without
   exposing the value.
4. Run the bounded non-production smoke and the complete deterministic suite.
5. Review and create `systemConfig/sportsDataIoCatalog` with `enabled: false`
   and correct NFL/MLB season entries.
6. In an explicitly authorized release, set access mode to `production`, mark
   entitlement verified, deploy through the guarded wrapper, and inspect logs.
7. Enable the catalog document, then change one test arena from `manual` to
   `sportsDataIo`. Validate catalog, publication, refresh, and settlement before
   expanding scope.
8. Monitor cache state, error categories, request budget, and unresolved games.

To roll back, disable `ALLOW_SPORTSDATAIO_PROVIDER` and return affected arenas
to `manual`. Do not delete selected games, picks, audit records, or old provider
provenance. Already-published slates remain immutable and readable.

## Historical compatibility

The retired provider name may remain only as a persisted historical provenance
value so old published weeks continue to parse and display neutral badges. It
is not in the active provider union, cannot be configured, and has no client,
factory branch, URL, DTO, fixture, or network path. No data migration is
required.

## References

- [SportsDataIO Getting Started](https://sportsdata.io/developers/apis#getting-started)
- [League API](https://sportsdata.io/league-api)
- [NFL API documentation](https://sportsdata.io/developers/api-documentation/nfl)
- [NFL OpenAPI](https://cdn.sportsdata.io/openapi/NFL-openapi-3.1.json)
- [NFL workflow guide](https://sportsdata.io/developers/workflow-guide/nfl)
- [MLB API documentation](https://sportsdata.io/developers/api-documentation/mlb)
- [MLB OpenAPI](https://cdn.sportsdata.io/openapi/MLB-openapi-3.1.json)
- [MLB workflow guide](https://sportsdata.io/developers/workflow-guide/mlb)
- [Scrambled-data explanation](https://sportsdata.io/help/scrambled-data)
- [API FAQ](https://sportsdata.io/help/faq)
- [Service status](https://status.sportsdata.io/)
