# Testing

Tests must separate deterministic branch evidence from deployment evidence and
from authenticated provider evidence. They are three different claims.

## Current SportsDataIO activation boundary — 2026-08-27

The NFL/MLB integration is tested with sanitized, secret-free fixtures. Normal
tests and CI do not call the internet. The shared source bundle is deployed but
SportsDataIO is not activated: no API key was supplied or used, no authenticated
SportsDataIO request was made, and no feed entitlement, quota, SLA, live schema,
or anomaly behavior was validated.

All browser/emulator tests explicitly keep:

```text
ALLOW_SPORTSDATAIO_PROVIDER=false
SPORTSDATAIO_ACCESS_MODE=fixture
SPORTSDATAIO_ENTITLEMENT_VERIFIED=false
SPORTSDATAIO_API_KEY=
```

That is deliberate. A passing fixture or emulator test is not a live-provider
smoke test.

## CBS college-football boundary — 2026-08-27

CBS parser and cache tests use small synthetic HTML fragments and mocked HTTP.
Routine tests, emulator runs, browser automation, and CI must not contact CBS or
persist a public page. The bounded public-route observation performed during
development is separate evidence: it confirmed matchup markup, but not a
live authenticated product flow. The 2026-08-27 observation also confirmed
that all 99 embedded preloaded-state UTC epochs agreed with their Eastern
display times, abbreviations, and week identity. The parser test reproduces
that bounded shape synthetically; no raw CBS response is checked in. Additional
minimal fixtures cover CBS's year-round `EDT` display label by comparing the
epoch's real New York wall time, plus the live postseason `post` token and its
route-week/internal-week divergence.

The focused deterministic coverage lives in:

- `functions/test/cbs-college-football-provider.test.ts` for strict route
  construction, canonical/title page identity, parsing, normalization, IDs,
  statuses, logos, and conservative kickoff handling, including fail-closed
  visible/preloaded time and date conflicts that remain TBD after merging;
- `functions/test/cbs-college-football-cache.test.ts` for config bounds,
  active-identity-only fetches, exact redirects, canonical cache identity,
  leases, cooldown, per-outbound-attempt rolling cap, parser-version reparse,
  conditional requests, provider-global retry/circuit behavior,
  suspicious-shrink retention, stale fallback, and terminal behavior; and
- `functions/test/cbs-college-football-integration-contract.test.ts` for
  provider policy, per-sport routing, shared-catalog identity, callable/scheduler
  source contracts, and public-source isolation.

Flutter tests exercise NCAAF controls restricted to the configured active
season/type/week, cross-provider calendar ownership, arena-timezone display, TBD
selection blocking, stale/last-updated state, and retention across refresh. A
synthetic confirmed-time fixture proves workflow compatibility. The exact
Functions release, private parser-version bump, post-cooldown refresh, and
authenticated production UI verification completed on 2026-08-27. That is
schedule/session/entry-lock evidence; a real completed CBS game through result,
grading, and standings remains a separate unchecked acceptance gate.

The authenticated emulator flow does prove the local cache-backed boundary: an
owner loads a fresh preseeded CBS game without consuming a provider attempt,
authorization rejects an ordinary member's direct schedule request, the picker
saves and publishes the game, the member reads it, and the member submits a
pick. It does not contact CBS, exercise a live result, or establish production
acceptance.

## Current CBS-tree verification matrix — 2026-08-27

These results were recorded on the current CBS integration tree. The public
source/build scans were rerun after the release build; none of these local,
fixture, cache-backed, or emulator results is a deployment or live-provider
claim.

| Command | Current result | Evidence boundary |
|---|---|---|
| `dart format --output=none --set-exit-if-changed .` | Pass | Flutter source and tests are formatted |
| `flutter analyze --no-pub` | Pass | No analyzer issues on the current Flutter tree |
| `flutter test --no-pub` | Pass — 136/136 | Includes CBS active controls, cross-provider calendar ownership, TBD/stale behavior, completed-entry lock latching, draft add/remove/re-add, and repository parsing |
| `flutter build web --release` | Pass | Current release web artifact compiled successfully |
| `npm --prefix functions run lint` | Pass | ESLint completed with zero allowed warnings |
| `npm --prefix functions run typecheck` | Pass | TypeScript no-emit check completed |
| `npm --prefix functions run build` | Pass | Node 22 Functions TypeScript compiled |
| `npm --prefix functions test` | Pass — 205/205 | CBS parser/cache/contracts plus atomic completed-entry sealing, provider, lifecycle, and scoring coverage |
| `npm --prefix functions run test:rules` | Pass — 12/12 | Firestore emulator confirms CBS config/cache/usage remain client-denied |
| `npm --prefix functions run test:integration` | Pass — 10/10 | Includes authenticated cached-CBS lifecycle, authorization, and capacity checks without CBS network access |
| `./scripts/test_browser_e2e.sh` | Pass | Connected three-user emulator lifecycle completed under safe provider flags |
| `./scripts/check_public_source.sh` | Pass | Credential and public-source policy scan passed |
| `./scripts/check_public_build.sh build/web` | Pass | Fresh public release-build scan passed |
| `git diff --check` | Pass | Final changed-tree whitespace check passed |
| `npm audit --prefix functions --omit=dev` | Pass — 0 vulnerabilities | Production Functions dependency graph only |
| `npm audit --prefix functions` | Review — 8 findings | Full graph has 4 high and 4 moderate dev-tooling findings |
| `flutter pub outdated` | Inventory | 25 locked packages can upgrade; 2 direct constraints trail otherwise resolvable versions |

## Production release verification — 2026-08-27

- The exact Firebase safety check passed for `lukes-picks` project number
  `271408880910`; all 32 deployed Functions report `ACTIVE` on Node 22.
- Code commit `0adbfa2f2e38a95e310551a58e2e383906f1f8db` passed both jobs in
  <https://github.com/mleikam1/lukespics/actions/runs/33112892405>.
- Hosting live version `cc6cb19ea8f74056` returns HTTP 200 and its
  `main.dart.js` SHA-256 is
  `6e8a4aa8b42db5bb084e2be1260074cfaad9de7edae003cabc79daa1f8a57541`.
- The post-cooldown Scheduler execution made one outbound request, received
  HTTP 200, and refreshed the parser-1.2.0 cache at
  `2026-08-27T21:24:28.753Z`: 99 games, 99 scheduled UTC kickoffs, 99 effective
  lock instants, and zero TBD games.
- A fresh production browser tab restored the existing signed-in session
  without a Google prompt. The connected Week 1 entry showed scheduled local
  times, `Saved and locked`, and disabled pick buttons. Verification did not
  mutate a slate, entry, or pick.

## Current dependency audit snapshot — 2026-08-25

The freshly observed dependency checks reported:

- `npm audit --prefix functions --omit=dev`: 0 vulnerabilities in the
  production dependency graph;
- `npm audit --prefix functions`: 8 total vulnerabilities in the full graph
  (4 high and 4 moderate); and
- `flutter pub outdated`: 25 locked packages can be upgraded, and 2 dependency
  constraints are behind versions that the current graph can otherwise resolve.

These are inventory results, not a dependency-upgrade authorization or release
acceptance. Review the development-tool advisories and Flutter compatibility,
then rerun the complete matrix after any approved upgrade.

## Last recorded pre-CBS verified matrix — 2026-08-01

These rows predate the CBS additions and are retained as baseline evidence only.
They must not be cited as results for the current branch. Replace them only with
commands actually rerun after all CBS edits settle.

| Command | Recorded result | Evidence boundary |
|---|---|---|
| `flutter analyze` | Pass | No analyzer issues on the recorded Flutter tree |
| `flutter test` | Pass — 117/117 | Recorded unit, controller, repository, responsive UI, TBD, Eastern date, NFL↔MLB retention, doubleheader, score, and neutral-presentation coverage |
| `flutter build web --release --dart-define=LUKE_PICKS_PUBLIC_RELEASE=true` | Pass | Clean public web release compiled; Flutter's Wasm compatibility dry run also succeeded |
| `npm --prefix functions run lint` | Pass | ESLint completed with zero allowed warnings on the settled tree |
| `npm --prefix functions run typecheck` | Pass | TypeScript no-emit check completed on the settled tree |
| `npm --prefix functions test` | Pass — 122/122 in 5 files | Recorded fixture, provider, gateway, scoring, callable, and contract suite |
| `npm --prefix functions run build` | Pass | Recorded Node 22 Functions TypeScript compiled |
| `npm --prefix functions run test:rules` | Pass — 12/12 | Java 21 emulator run used the isolated synthetic project |
| `npm --prefix functions run test:integration` | Pass — 9/9 | Functions/Auth/Firestore run included first-game lock tightening and sibling lock enforcement |
| `./scripts/test_browser_e2e.sh` | Pass | Three-user connected lifecycle completed with automatic providers disabled |
| Source/secret/fresh-build scans | Pass | Secret, source-policy, and clean public-build scanners passed; `.dart_tool` and `build/web` contained no ESPN text |

## Provider fixture coverage

Sanitized fixtures live under `functions/test/fixtures/`:

- `sportsdataio-nfl-teams.sanitized.json`
- `sportsdataio-nfl-schedule.sanitized.json`
- `sportsdataio-nfl-scores.sanitized.json`
- `sportsdataio-mlb-teams.sanitized.json`
- `sportsdataio-mlb-games.sanitized.json`

They contain only fields needed by normalizers and tests. They are not proof of
the current account's response shape or rights and must never contain a key,
raw headers, personal data, or third-party logo bytes.

Deterministic provider tests cover:

- the fixed `https://api.sportsdata.io` origin and rejection of arbitrary
  hosts, query strings, redirects, seasons, and dates;
- the exact runtime paths:
  - NFL `Teams`;
  - NFL `SchedulesBasic/{season}`;
  - NFL `ScoresByDate/{YYYY-MMM-DD}`;
  - MLB `teams`;
  - MLB `GamesByDate/{YYYY-MMM-DD}`;
- server-only header authentication without key logging;
- 8-second timeout, 5 MB response limit, safe JSON errors, normal `4xx`
  no-retry behavior, and bounded retry/backoff for network, timeout, `429`, and
  transient `5xx` failures;
- separate NFL and MLB decoders, stable provider-qualified IDs, team/global
  IDs, score/league/global/game-key IDs, closure state, and reschedule links;
- Eastern date bucketing across late-night and DST boundaries;
- nullable TBD start/publication/lock values without invented kickoff times;
- MLB doubleheaders remaining separate by `GameID`;
- status mapping for scheduled, live, delayed, postponed, suspended, canceled,
  `NotNecessary`, closed final, tie, forfeit, missing score, and unknown state;
- final-result settlement only when closure, scores, and winner are defensible;
- cache identity/revision, request coalescing, soft budget, circuit breaker,
  stale behavior, selected-game refresh grouping, and bounded request estimate;
- all runtime, mode, entitlement, document, league-feed, and key gates failing
  closed; and
- neutral presentation with no remote-logo host or entitlement claim.

## Flutter coverage

The current Flutter suite includes direct coverage for:

- parsing SportsDataIO provider/game/team identity metadata;
- backward-compatible parsing of historical confirmed schedules;
- catalog-only TBD games with an Eastern day and disabled selection;
- fail-closed pick/admin/dashboard/slate behavior when a schedule or lock is
  missing;
- confirmed UTC starts rendered in browser/device local time with an explicit
  timezone label;
- scores, venue, status, broadcast text, and reschedule context;
- NFL ↔ MLB filter switching without losing selected game objects;
- distinct doubleheader cards and IDs;
- Eastern late-night and spring/fall DST query-day behavior;
- active presentation-provider allowlisting; and
- SportsDataIO and unknown/historical providers using neutral badges.

No Flutter test makes a provider network request or handles a provider key.

## Rules, emulator, and browser expectations

Firestore rules tests must prove:

- clients cannot read or write `systemConfig/sportsDataIoCatalog`;
- clients cannot read or write `systemConfig/cbsCollegeFootball`,
  `sportsProviderCache`, or `providerUsage/cbsSports_rolling24h`;
- catalog cache internals and provider budget/lock/circuit documents are not
  client-readable;
- draft games remain picker/commissioner-only before publication;
- private picks remain owner-only before reveal; and
- public week/game/result documents expose only normalized provider-neutral
  data.

The Functions emulator integration and browser lifecycle use
`demo-lukes-picks-local`, synthetic users, fixture/manual data, and Java 21.
They cover create/join, restoration, selection reconciliation, publication,
picks, privacy, lock rejection, reveal, manual result/override, grading,
standings, rotation, and picker participation both disabled and enabled. They
must not enable SportsDataIO, enable CBS automatic refresh, contact CBS, or
contact a non-emulated Firebase service.

Expected emulator warnings about synthetic secret lookup, App Check, or an
unexecuted scheduler do not prove provider behavior. Review every unexpected
network request and mutation.

## Authenticated provider smoke boundary

No authenticated SportsDataIO smoke has been run for this branch.

A future smoke is optional and requires an already-authorized non-production
key and exact feed/use entitlement. It must be a separately approved operation,
never run in CI, and make at most one bounded request to each required endpoint.
Record only HTTP outcome, timing category, and schema compatibility. Do not
save the key, raw body, full request headers, or unrestricted response.

The smoke must confirm:

- the account can access NFL Teams, SchedulesBasic, and ScoresByDate;
- the account can access MLB teams and GamesByDate;
- the `YYYY-MMM-DD` date form is accepted by both dated endpoints;
- the required IDs, status, UTC/TBD date, closure, and score fields match the
  reviewed decoder assumptions; and
- trial/discovery/scrambled-data restrictions do not conflict with intended
  display, caching, historical storage, or pick grading.

A successful trial or discovery request still does not satisfy the production
entitlement gate.

## Full deterministic command matrix

Run from the repository root after all branch edits settle:

```bash
dart format --output=none --set-exit-if-changed .
flutter analyze
flutter test
flutter build web --release --dart-define=LUKE_PICKS_PUBLIC_RELEASE=true

npm --prefix functions run lint
npm --prefix functions run typecheck
npm --prefix functions test
npm --prefix functions run build

npm --prefix functions run test:rules
npm --prefix functions run test:integration
./scripts/test_browser_e2e.sh

./scripts/check_secrets.sh
./scripts/check_public_source.sh
./scripts/check_public_build.sh build/web
```

Functions commands use Node 22. Rules and emulator commands use Java 21. Do
not use a forced dependency upgrade as a substitute for advisory review.

## Release scans

The source/build scanners must verify that:

- no secret value or forbidden secret file is present;
- `SPORTSDATAIO_API_KEY`, its request header, and the provider origin remain
  server-only;
- CBS scoreboard and logo hosts occur only in the reviewed server parser,
  provider, and schedule service, never in Flutter or public build output;
- no provider URL, test flag, emulator endpoint, source map, or secret name is
  embedded in the Hosting artifact;
- retired provider runtime code and fixtures are absent;
- blocked third-party logo hosts are absent from public output;
- neutral initials remain the default presentation; and
- the scanned build is fresh and tied to the reviewed source tree.

The current 2026-08-25 CBS-tree source-policy and fresh public-build scans pass.
That validates the local artifact boundary only; it does not authorize a preview
or live deployment.

## Historical manual release evidence

### 2026-08-01

The earlier manual-data artifact recorded a passing local/emulator/browser
matrix, a guarded 29-Function deployment, five ready indexes, Hosting version
`b58df6678863654a`, and bundle SHA-256
`411062a988bf5b8d798b317f118b505966c0d80f9fd07a4f4f4e4762842a1ed6`.
Two production arenas remained `manual`. This is deployment evidence for that
artifact only, not for this branch or for authenticated SportsDataIO data.

### 2026-07-30/31

The earlier connected weekly-picker release recorded a three-user
browser-to-emulator lifecycle, a manual authenticated preview smoke, and an
exact preview-to-live clone. Those dated checks remain useful product and
rollback evidence but do not validate this provider implementation.

### 2026-07-27 baseline

The historical baseline recorded Flutter, Functions, rules, emulator, native
build, responsive layout, and audit results for a substantially earlier tree.
Its counts are intentionally omitted here because they are not current-branch
results. Refer to version control if that full baseline record is needed.

## CI

CI should remain deterministic and network-free. It may run fixtures, rules,
emulators, browser automation, scans, and builds. It must not inject a live
SportsDataIO key, switch access mode to production, assert entitlement, mutate
`systemConfig/sportsDataIoCatalog`, change an arena provider, or deploy cloud
resources. It also must not enable CBS, mutate
`systemConfig/cbsCollegeFootball`, add an NCAAF provider override, or make a
CBS request.
