# Deployment and rollback

This project has no automatic deploy. A passing local or CI run does not
authorize a cloud write.

## Current SportsDataIO branch status — 2026-08-01

This branch adds a server-only SportsDataIO integration for NFL and MLB. It has
not been deployed to Firebase Hosting, Cloud Functions, Firestore, or Secret
Manager. The previously deployed web application remains the dated manual-data
artifact recorded below; none of that evidence applies to this branch.

The branch was validated only with sanitized, secret-free fixtures. No API key
was supplied, read, created, rotated, or used; no authenticated SportsDataIO
request or live smoke test was run; and no account feed entitlement, quota,
rate limit, schema stability, service level, or logo right was established.
The repository contains only an empty secret placeholder. Current cloud secret
state was not inspected and must not be inferred from source.

Production arenas must remain `manual`. Do not describe the current live site
as SportsDataIO-backed until an authorized deployment and the complete
activation process below have both passed.

## Exact provider surface

The client permits only `https://api.sportsdata.io`, HTTPS, no query string,
validated season/date path components, and these runtime paths:

| League | Exact path | Intended feed use |
|---|---|---|
| NFL | `GET /v3/nfl/scores/json/Teams` | Stable team identity and neutral display text |
| NFL | `GET /v3/nfl/scores/json/SchedulesBasic/{season}` | Schedule, week, stable IDs, TBD and reschedule metadata |
| NFL | `GET /v3/nfl/scores/json/ScoresByDate/{YYYY-MMM-DD}` | Live/final state and scores for one Eastern day |
| MLB | `GET /v3/mlb/scores/json/teams` | Stable team identity and neutral display text |
| MLB | `GET /v3/mlb/scores/json/GamesByDate/{YYYY-MMM-DD}` | Schedule, exception state, stable IDs, and scores for one Eastern day |

No browser code holds the key, builds a provider URL, or parses raw provider
JSON. NFL and MLB requests use `America/New_York` calendar buckets and are
bounded to seven inclusive days. The implementation does not call a
season-wide MLB feed, box-score feed, final-only feed, or an arbitrary URL.

Team presentation is neutral. SportsDataIO normalization deliberately discards
remote logo and color fields, and both the server and Flutter presentation
policy keep remote logos disabled. Schedule/result entitlement does not grant
team-mark rights.

## Activation gates

Every gate is fail-closed and all must pass before automatic data can be used:

1. The runtime project is exactly `lukes-picks` and is not an emulator.
2. `ALLOW_SPORTSDATAIO_PROVIDER=true` is set in an explicitly reviewed
   deployment; it defaults to `false` and is the immediate technical kill
   switch.
3. `SPORTSDATAIO_ACCESS_MODE=production`; the safe default is `fixture`, and
   `trial` or `discovery` cannot activate production access.
4. `SPORTSDATAIO_ENTITLEMENT_VERIFIED=true`; the safe default is `false`.
5. Server-only `systemConfig/sportsDataIoCatalog` exists, parses strictly, has
   `enabled: true`, has `accessMode: production`, and contains a new cache
   revision plus reviewed NFL/MLB season definitions.
6. The catalog records `entitlementVerified: true`, a bounded
   `entitlementReference`, and an ISO `entitlementReviewedAt` date. Each enabled
   league records verified Teams, Schedule, and Live & Final feed access.
7. `SPORTSDATAIO_API_KEY` is available through Secret Manager to only
   `listSportsCatalog`, `refreshSelectedGames`, `syncSelectedGameResults`, and
   `scheduledResultSync`.
8. The actual account and agreement are reviewed for every exact endpoint and
   the intended caching, public display, historical storage, pick grading, and
   redistribution use.
9. A bounded, authenticated non-production endpoint smoke test succeeds, raw
   responses are not retained, and the sanitized fixtures are regenerated and
   reviewed.
10. The complete local, Functions, rules, emulator, browser, scan, and fresh
    web-build matrix passes on the exact release artifact.
11. One authorized test arena passes catalog, TBD, publication, refresh,
    final-result, anomaly, manual-override, and rollback checks before scope is
    expanded.

Passing fixture tests alone satisfies none of gates 7–11. There is currently no
evidence that any activation gate requiring a key, entitlement, live response,
or cloud write has passed.

## Guarded prerequisite writes

Before each authorized write, inspect the existing cloud state and run:

```bash
./scripts/assert_firebase_project.sh lukes-picks
```

The guard must be immediately adjacent to that write. An earlier guard result
does not authorize a later command.

Creating or rotating `SPORTSDATAIO_API_KEY`, deploying the new secret binding,
changing the three provider parameters, creating or enabling
`systemConfig/sportsDataIoCatalog`, changing an arena from `manual`, deploying
Functions, deploying a preview, and promoting Hosting are separate mutations.
Each needs its own reviewed target and user authorization. Never put a key or
raw provider response in a command line, source file, Firestore document, log,
screenshot, fixture, or report.

## Release gates

Before deploying this branch:

- review the exact Function addition/change/deletion plan, especially the four
  secret-bearing provider entry points;
- confirm mock and internal test providers remain production-rejected;
- confirm all production arenas remain `manual` during deployment and smoke
  testing;
- confirm the SportsDataIO parameters remain `false`, `fixture`, and `false`
  unless a separately authorized activation is being performed;
- inspect Firestore rules, indexes, Functions, secrets, scheduled jobs, and
  Hosting versions for additive compatibility;
- run source, secret, and fresh-build scans on the intended artifact;
- use only sanitized fixtures in normal tests and CI;
- retain neutral initials regardless of schedule/result activation; and
- stop if a command proposes deleting an unexpected Function, index, site,
  release, secret, document, or other resource.

## Allowed release commands

The wrapper accepts four fixed actions and no project override:

```bash
./scripts/release_firebase.sh rules-indexes
./scripts/release_firebase.sh functions
./scripts/release_firebase.sh preview
./scripts/release_firebase.sh hosting-live
```

They explicitly target `lukes-picks`. The preview action uses only
`connected-picker-flow`; `hosting-live` clones that reviewed channel to the
fixed live channel. Do not bypass the wrapper with aliases or a handwritten
deploy command. A prior deployment authorization does not authorize a new
preview or live promotion.

## Historical manual release evidence — 2026-08-01

The following is retained as dated rollback and provenance evidence for the
previous manual-data artifact. It is not evidence that this SportsDataIO branch
was deployed, activated, authenticated, or smoke-tested.

| Historical release item | Recorded state |
|---|---|
| Target | `lukes-picks` / project number `271408880910` |
| Provider mode | Two active `America/Chicago` arenas remained `manual` |
| Firestore rules | `projects/lukes-picks/rulesets/aa52ec56-c549-4e8e-880a-372474e4feeb` |
| Firestore indexes | Five composite indexes recorded `READY` |
| Functions | 29 Node 22 Functions recorded `ACTIVE`; 28 callable and one 30-minute scheduled job |
| Preview | `connected-picker-flow`, released `2026-08-01T13:52:25.814Z`, recorded expiry `2026-08-08T13:52:18.443Z` |
| Hosting version | Preview and live both `b58df6678863654a` |
| Bundle | `main.dart.js` SHA-256 `411062a988bf5b8d798b317f118b505966c0d80f9fd07a4f4f4e4762842a1ed6` |
| Live promotion | Exact preview cloned at `2026-08-01T13:52:56.156Z` |
| URLs | `https://lukes-picks.web.app` and `https://lukes-picks.firebaseapp.com` returned HTTP 200 at validation time |
| Prior rules rollback input | `projects/lukes-picks/rulesets/93614c6a-add3-47ad-88df-b9d9e18a00fb` |

The prior Functions command recorded an exit code of 1 only after Function
deployment succeeded, when automatic Artifact Registry cleanup policy setup
failed. `gcf-artifacts` had no automatic cleanup policy at that time. That is a
historical retention/cost warning, not current branch deployment evidence.

The prior browser/emulator lifecycle used sanitized fixtures and manual result
handling. A historical authenticated preview smoke covered the earlier manual
artifact. Neither is a live-provider test for this branch.

## Rollback

If this branch has not been deployed, there is no SportsDataIO cloud rollback
to perform. Keep production in `manual` and preserve the historical artifact.

If a future authorized activation misbehaves:

1. set `ALLOW_SPORTSDATAIO_PROVIDER=false` through a guarded Functions
   deployment;
2. return every affected arena to `manual`;
3. stop provider-backed preview/live promotion and scheduled provider refresh;
4. disable `systemConfig/sportsDataIoCatalog.enabled` as defense in depth only
   through a separately authorized guarded write; and
5. preserve normalized caches, provider-qualified IDs, published week
   snapshots, picks, results, audits, overrides, and standings.

A replacement provider game ID never silently replaces a published selection.
Use the audited commissioner correction/void workflow. Do not roll back by
deleting Firestore documents.

Platform rollback remains separate:

- let a preview expire unless deletion is explicitly authorized;
- clone or restore only an exact reviewed Hosting version;
- redeploy only a reviewed backward-compatible Functions revision;
- restore a reviewed prior ruleset only after emulator validation;
- avoid removing indexes until query and deletion impact are inspected; and
- rotate or disable a secret version without printing or copying its value.

If deployment partially succeeds, stop and inspect actual state before an
idempotent retry.

## Prohibited actions

- claiming this branch is deployed or live-provider-backed before exact cloud
  state and authenticated behavior are verified;
- enabling automatic access without the exact project, parameter, catalog,
  secret, entitlement, endpoint-smoke, and release gates;
- using trial, discovery, or scrambled data as production evidence;
- storing or exposing a key or raw provider payload;
- adding user-supplied provider URLs or a browser-side provider call;
- enabling remote team marks from schedule/result access;
- creating a catalog from guessed seasons, IDs, response fields, or hosts;
- unreviewed or unguarded Hosting, Functions, Firestore, secret, IAM, billing,
  DNS, or domain changes;
- deploying to `demo-lukes-picks-local` or accessing an unrelated project;
- force-deleting unexpected cloud resources; or
- publishing Android or iOS store builds as part of this web-only release.
