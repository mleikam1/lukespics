# Validation report

Date: 2026-08-01

Scope: Luke's Picks web application, SportsDataIO NFL/MLB branch

Status: fixture-validated branch; not deployed or provider-activated

## Executive conclusion

The branch implements a server-only, replaceable SportsDataIO path for NFL and
MLB schedules and results. The Flutter application consumes normalized game
records, renders confirmed starts in browser/device local time, renders
catalog-only TBD games against their Eastern day, retains provider-qualified
identity, and fails closed when a kickoff or lock is not confirmed.

This is not a live-data validation report. The branch has not been deployed.
No API key was supplied, read, created, rotated, or used. No authenticated
SportsDataIO request or endpoint smoke was run. No account feed entitlement,
public-display right, caching/storage right, redistribution right, quota, rate
limit, SLA, live response schema, or anomaly behavior was established.
Production must remain on manual data, and team marks must remain neutral.

## Implemented provider boundary

Runtime requests are fixed to `https://api.sportsdata.io` and only:

| League | Runtime path | Normalized purpose |
|---|---|---|
| NFL | `/v3/nfl/scores/json/Teams` | Team identity and neutral display text |
| NFL | `/v3/nfl/scores/json/SchedulesBasic/{season}` | Schedule/week/TBD/reschedule bridge |
| NFL | `/v3/nfl/scores/json/ScoresByDate/{YYYY-MMM-DD}` | Date-bucket live/final state and score |
| MLB | `/v3/mlb/scores/json/teams` | Team identity and neutral display text |
| MLB | `/v3/mlb/scores/json/GamesByDate/{YYYY-MMM-DD}` | Date-bucket schedule/state/score |

The browser never holds the key, constructs a provider URL, or parses a vendor
payload. Dated requests use `America/New_York` and a maximum of seven inclusive
days. Authentication is a server-only `Ocp-Apim-Subscription-Key` header.

The provider uses separate NFL/MLB decoders, canonical provider-qualified IDs,
nullable TBD instants, stable doubleheader IDs, closure/result checks, bounded
retry and response handling, request coalescing, cache revision, soft budget,
and circuit behavior. It never silently substitutes a rescheduled ID for a
published selection.

## Production gates

The implementation requires all of the following and currently claims none of
the key/live/entitlement gates as complete:

- exact non-emulator project `lukes-picks`;
- `ALLOW_SPORTSDATAIO_PROVIDER=true`;
- `SPORTSDATAIO_ACCESS_MODE=production`;
- `SPORTSDATAIO_ENTITLEMENT_VERIFIED=true`;
- a strict, enabled, server-only `systemConfig/sportsDataIoCatalog` with a new
  revision, production access mode, reviewed entitlement reference/date,
  exact NFL/MLB seasons, and Teams/Schedule/Live & Final feed checks;
- a future `SPORTSDATAIO_API_KEY` binding limited to the four provider-bearing
  Functions; the CBS release does not carry that unprovisioned binding;
- actual account entitlement for every exact endpoint and intended use;
- bounded authenticated endpoint smoke and reviewed sanitized fixtures;
- complete settled-tree deterministic validation and artifact scans; and
- one authorized test-arena catalog/publication/refresh/settlement/rollback
  lifecycle before wider activation.

Safe defaults are `false`, `fixture`, and `false`. Returning arenas to `manual`
and turning the allow parameter off is the immediate rollback path.

## Presentation and marks conclusion

SportsDataIO presentation is neutral by construction. Normalization sets logo
and color fields to null. Server presentation advertises no remote-logo hosts,
query keys, or rights review, and Flutter independently refuses remote marks
for this provider. Unknown or historical provider metadata cannot restore
retired attribution or artwork.

The UI displays neutral accessible initials in light and dark themes. Schedule
and result access would not by itself grant team-mark rights.

## Current deterministic evidence

These results were run on the current branch during this validation. They do
not establish live provider behavior.

| Command or layer | Result | Evidence |
|---|---|---|
| `flutter analyze` | Pass | No issues found |
| `flutter test` | Pass — 117/117 | Includes TBD parsing/disabled selection, browser-local confirmed time, Eastern DST/late-night dates, NFL↔MLB retention, doubleheaders, scores, identity, reschedule, and neutral presentation |
| Public-release Flutter web build | Pass | Clean release compilation with `LUKE_PICKS_PUBLIC_RELEASE=true` and Wasm compatibility dry run succeeded |
| Functions lint/typecheck/unit/build | Pass — 122/122 tests in 5 files | ESLint, TypeScript no-emit, fixture/contract tests, and Node 22 build passed on the settled tree |
| Firestore rules | Pass — 12/12 | Java 21 emulator run used the isolated synthetic project |
| Functions/Auth/Firestore emulator integration | Pass — 9/9 | Isolated integration run included first-game lock tightening after a provider reschedule |
| Connected browser-to-emulator lifecycle | Pass | Three isolated users completed create/join, cross-query draft retention, publish, picks/privacy, late rejection, reveal, manual result, finalization, standings, rotation, and next-week participation with automatic providers disabled |
| Source, secret, and fresh public-build scans | Pass | All three scanners passed against the settled source and clean public-release artifact; no ESPN text remained in `.dart_tool` or `build/web` |
| Authenticated SportsDataIO endpoint smoke | Not run | No key or verified entitlement was available |
| Cloud deployment or live Hosting smoke | Not run for this branch | No cloud write was authorized |

## Fixture evidence and limitations

Secret-free NFL fixtures cover Teams, SchedulesBasic, and ScoresByDate. MLB
fixtures cover teams and GamesByDate. Unit/contract tests exercise:

- exact URL/path/date allowlisting and server-only credential transport;
- retries, timeout, response-size limits, and safe errors;
- nullable fields, additive fields, malformed records, and unknown statuses;
- UTC parsing plus Eastern calendar bucketing across DST and late-night edges;
- TBD games without invented kickoff/publication/lock instants;
- provider/team/game identity, doubleheaders, reschedules, scores, and closure;
- final, tie, cancel, postpone, suspend, `NotNecessary`, forfeit, incomplete
  score, and review-required behavior;
- cache/request bounds, runtime gates, server-owned catalog, and secret scope;
  and
- neutral marks and client presentation fail-closed behavior.

Fixtures show that the decoder behaves against the reviewed samples. They do
not show that the current account can call those feeds, that the samples match
today's live schema, or that the intended use is permitted.

## Required next validation

1. Review the actual SportsDataIO account and agreement for the five exact
   paths, both leagues, and intended display/cache/storage/grading use.
2. Under separate authorization, create or rotate the Secret Manager key
   without exposing it.
3. Run one bounded non-production request per exact endpoint, record only safe
   schema compatibility, and regenerate sanitized fixtures.
4. Review the provider date form, TBD cases, finals, ties, suspensions,
   cancellations, reschedules, doubleheaders, missing fields, unknown states,
   response bounds, and account quota headers.
5. Prepare `systemConfig/sportsDataIoCatalog` disabled first, then deploy with
   safe defaults through the guarded wrapper.
6. Verify the manual/neutral preview and exact artifact digest.
7. Separately authorize activation, enable one test arena, and validate the
   full catalog-to-settlement lifecycle before wider rollout.

Until then, the correct production state is manual schedules/results and
neutral badges.

## Historical manual deployment evidence — 2026-08-01

This table is preserved for provenance and rollback. It describes the earlier
manual-data artifact, not this SportsDataIO branch.

| Historical item | Recorded result |
|---|---|
| Target | `lukes-picks` / `271408880910` |
| Provider state | Two active `America/Chicago` arenas remained `manual` |
| Firestore rules | `projects/lukes-picks/rulesets/aa52ec56-c549-4e8e-880a-372474e4feeb` |
| Firestore indexes | Five composite indexes recorded `READY` |
| Functions | 29 Node 22 Functions recorded `ACTIVE`; one scheduled every 30 minutes UTC |
| Preview | `connected-picker-flow`, released `2026-08-01T13:52:25.814Z`; recorded expiry `2026-08-08T13:52:18.443Z` |
| Hosting version | Preview and live both `b58df6678863654a` |
| Bundle digest | `411062a988bf5b8d798b317f118b505966c0d80f9fd07a4f4f4e4762842a1ed6` |
| Live promotion | Exact preview cloned at `2026-08-01T13:52:56.156Z` |
| URLs | `https://lukes-picks.web.app` and `https://lukes-picks.firebaseapp.com` returned HTTP 200 then |
| Prior rules rollback input | `projects/lukes-picks/rulesets/93614c6a-add3-47ad-88df-b9d9e18a00fb` |

The earlier Functions deployment recorded a post-deploy Artifact Registry
cleanup-policy warning. That historical operational warning and those cloud
IDs remain useful, but they do not prove any current source was deployed.

The earlier browser/emulator lifecycle and authenticated preview smoke used
manual or sanitized fixture data. They are product-flow evidence only.

## Historical connected release — 2026-07-30/31

The prior connected weekly-picker work recorded an isolated three-user
browser/emulator lifecycle, manual catalog/result behavior, Google preview
authentication, exact preview-to-live promotion, and source merge provenance.
Those facts remain dated evidence for the prior artifact. They are not current
SportsDataIO endpoint, entitlement, or deployment evidence.

## Historical pre-release audit — 2026-07-30

The read-only audit identified `lukes-picks` / `271408880910`, observed the
owner binding and platform registrations, and intentionally made no deployment,
secret, Auth, billing, DNS, IAM, or provider mutation. It also recorded that
the then-existing build artifact was stale and not deployable. Later dated
manual-release evidence superseded those specific no-deploy gaps.

## Historical baseline — 2026-07-27

The baseline recorded Flutter, Functions, rules, emulator, responsive, native
build, and dependency-audit results for a substantially earlier source tree.
Its old test counts and provider assumptions are intentionally omitted from
this current report. They can be recovered from version control if an audit of
that exact revision is required.

## Final disposition

The SportsDataIO branch has passed its deterministic release-candidate matrix,
but is not live and does not support an activation claim. Deployment, key
provisioning, entitlement review, authenticated endpoint validation,
test-arena activation, monitoring, and legal/product approval remain explicit
manual gates.
