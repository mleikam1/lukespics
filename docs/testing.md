# Testing

Test evidence must identify the exact reviewed tree or commit and record the
command, runtime version, exit code, test count, warnings, and whether each
warning blocks release.

## Dormant-provider release validation — 2026-08-01

The final 2026-08-01 release deploys the reviewed provider-capable code while
keeping both production provider gates false. It does not activate ESPN or
API-Sports, permit remote ESPN logos, or establish a live ESPN contract.

### Final local and emulator matrix

- `dart format --output=none --set-exit-if-changed .` checked 62 files
  with 0 changes; `flutter analyze` was clean; `flutter test` passed 105/105.
- Functions lint, typecheck, build, and the sanitized unit/contract suite
  passed under Node 22; the suite passed 84/84.
- Firestore rules passed 11/11 under Java 21, and the Auth/Firestore/Functions
  emulator integration suite passed 8/8.
- The connected browser-to-emulator lifecycle passed 13 checkpoints with three
  isolated users. This is emulator evidence, not an authenticated live
  lifecycle claim.
- Android debug and iOS simulator builds passed. No store build was published.
- The fresh public source/build scans passed. The released `main.dart.js`
  SHA-256 is
  `411062a988bf5b8d798b317f118b505966c0d80f9fd07a4f4f4e4762842a1ed6`.
- `npm audit --omit=dev` reported 0 production vulnerabilities. The full audit
  reported three moderate development-only findings; no forced dependency
  change was applied.

### Guarded cloud release evidence

- All 29 Functions deployed with `ALLOW_API_SPORTS_PROVIDER=false` and
  `ALLOW_ESPN_PROVIDER=false`. The deploy command exited 1 only after every
  Function succeeded because the CLI could not configure the optional Artifact
  Registry cleanup policy.
- Firestore ruleset
  `projects/lukes-picks/rulesets/aa52ec56-c549-4e8e-880a-372474e4feeb` is
  active; prior ruleset
  `projects/lukes-picks/rulesets/93614c6a-add3-47ad-88df-b9d9e18a00fb` is the
  recorded rollback input. Five composite indexes are `READY`.
- `scheduledResultSync` is enabled every 30 minutes UTC.
- Preview and live serve the same Hosting version `b58df6678863654a`.
  The preview is
  <https://lukes-picks--connected-picker-flow-wfrwr4gp.web.app>; its release
  time was `2026-08-01T13:52:25.814Z`, with expiry
  `2026-08-08T13:52:18Z`; live release time was
  `2026-08-01T13:52:56.156Z`. Both permanent live URLs,
  <https://lukes-picks.web.app> and <https://lukes-picks.firebaseapp.com>,
  returned HTTP 200 and served the exact recorded bundle hash.
- The two retained production arenas remain configured for `manual`. Both
  `systemConfig/espnCatalog` and `systemConfig/apiSportsCatalog` are absent.
  `API_SPORTS_KEY` is not declared or bound in the deployed Functions manifest;
  that absence does not block this dormant-provider deployment.

### Provider validation boundary

Fixture/emulator coverage includes:

- all eight centralized sport/league slugs and college `groups`/`limit`
  parameters, date formatting, and rejection of arbitrary URL/query input;
- nullable nested response parsing, missing competitors/logos/venues, event-ID
  canonicalization, duplicate IDs/doubleheaders, malformed event skipping, and
  unknown status handling;
- scheduled, live, delayed, postponed, suspended, canceled, final, overtime,
  tied, and contradictory non-tie-league final results;
- cache freshness, stale fallback, bounded retry/timeout, request throttling,
  overlap locks, content hashing, and 30-minute scheduled reconciliation;
- default-false `ALLOW_ESPN_PROVIDER`, exact-project enforcement, missing or
  disabled `systemConfig/espnCatalog`, and fail-closed presentation policy;
- ordinary-member denial for draft week-game get/list, picker and
  owner/commissioner success, post-publication member access, and client denial
  for ESPN catalog/cache/config/lock/throttle collections;
- schedule loading and date changes, selection persistence/add/remove/review,
  missing-logo fallback, per-game picks and lock state, final result display,
  and weekly/overall standings; and
- source policy allowing only the literal reviewed scoreboard origin and exact
  rights-gated logo hostname in `functions/src/providers/espn.ts`, plus the
  unchanged public-build ban on every ESPN host.

Sanitized fixtures establish parser and application behavior only. The release
made no live ESPN call and did not validate live league coverage, a published
rate limit, an SLA, response contracts, data/logo rights, or permission for
automated/commercial use. ESPN activation, remote logos, and legal
authorization remain blocked. The two technical activation gates must remain
off until the external checklist is complete.

## Historical API-Sports candidate validation — 2026-07-31

The candidate adds testable coverage for:

- typed Flutter parsing of server-discovered sports, leagues, canonical
  provider league/season metadata, cache/availability state, presentation
  policy, effective query, and week bounds;
- controller separation of current query results, cross-query canonical cache,
  desired draft selections, persisted draft IDs, and live week games, including
  out-of-order query responses and selection persistence across filters;
- Today, Tomorrow, Later, All dates, and custom ranges in the arena timezone,
  with active-week clamping and a seven-inclusive-day maximum;
- shared logo policy requiring a matching provider, reviewed rights date,
  HTTPS, exact hosts/query keys, and neutral fallback;
- publish-time week presentation snapshots that hydrate for ordinary members
  without granting them picker-only catalog access, with legacy and provider
  mismatch cases failing closed;
- publication invalidating late draft-catalog responses, external week changes
  clearing prior week state before fresh discovery, stale save/publish actions
  aborting across week boundaries, rapid transition subscriptions retaining only
  the newest week, and publish retries remaining idempotent throughout
  post-publication statuses;
- next-week creation waiting for the finalized server rotation marker, rejecting
  stale picker overrides, consuming the authoritative next picker, and
  transactionally skipping that picker if the member becomes inactive;
- finalized-only follow-up repair coordinating with reopen, plus stale publish
  takeover responses returning the stored authoritative game/member counts;
- league-wide standings epoch fencing so a delayed repair cannot restore points
  from a different week that was concurrently reopened;
- sanitized API-Sports baseball normalization, unknown/malformed result
  handling, config/response drift rejection, bounded requests, and default-off
  presentation;
- server-side week/range validation, canonical catalog resolution, forged
  metadata rejection, and timezone/provider metadata cache separation;
- an earlier proposal for selective `API_SPORTS_KEY` binding; the final
  2026-08-01 dormant-provider release declares and binds no API provider key;
  and
- default-false `ALLOW_API_SPORTS_PROVIDER` runtime policy plus emulator and
  production provider rejection paths.

Relevant focused files are
`test/data/sports_catalog_parsing_test.dart`,
`test/features/catalog_date_window_test.dart`,
`test/core/widgets/catalog_logo_policy_test.dart`,
`test/data/connected_controller_test.dart`,
`functions/test/provider-hardening.test.ts`, and
`functions/test/emulator.integration.test.ts`.

There is no approved API-Sports key, so authenticated provider status/quota,
current MLB discovery, and live response-contract checks did not run. Sanitized
fixtures cannot satisfy that activation gate. The absent key does not block the
deployed dormant-provider manifest because no API provider secret is currently
declared or bound.

## Historical live-catalog candidate local matrix — 2026-07-31

The settled candidate passed locally under Flutter 3.44.4 / Dart 3.12.2,
Node 22.23.2, Java 21.0.12, Firebase CLI 15.24.0, and Chrome 151.0.7922.71:

- dependency resolution passed; formatting checked 58 source Dart files with zero
  changes; analysis reported no issues; and Flutter passed 91/91 tests;
- release web, Android debug, and iOS simulator builds passed;
- Functions clean install, lint, typecheck, and build passed; the unit/contract
  suite passed 54/54 tests, including 37 provider-hardening cases;
- Firestore rules passed 10/10 and the Auth/Firestore/Functions emulator
  integration suite passed 8/8, including manual MLB fallback creation,
  publication while a connected provider was configured, publish/entry
  contention, finalized follow-up repair/reopen coordination, legacy repair
  generation retry, league-wide standings epoch restart, and rotation healing;
- the connected browser lifecycle passed all 13 checkpoints with three isolated
  users: Baseball/MLB date queries, cross-query selection retention, exact
  add/remove reconciliation, reload restoration, review removal, one-game
  publication, member picks, privacy, lock/reveal, manual result, finalization,
  standings, rotation, Week 2, and browser/network diagnostics;
- shell syntax, repository secret/source scans, the fresh production web-bundle
  scan, and `git diff --check` passed; and
- the production dependency audit found zero vulnerabilities. The full audit
  remains nonzero with three moderate development-only findings inherited from
  Firebase CLI through `@google-cloud/pubsub`/`@opentelemetry/core`; npm offers
  only a forced breaking Firebase CLI downgrade, which was not applied. There
  are no remaining high or critical audit findings.

The first unsuppressed analysis invocation reported no code issues but then
failed while sending optional Google Analytics telemetry. Re-running with
`FLUTTER_SUPPRESS_ANALYTICS=true` exited successfully; this was a tooling
telemetry failure, not an application diagnostic. Android also emitted Flutter's
forward-looking Kotlin-plugin migration warning; the APK build succeeded.

This matrix validates the local candidate and sanitized/emulated provider
contracts only. It is not authenticated API-Sports, preview, or production
evidence.

## Historical connected release evidence — 2026-07-30/31

`./scripts/test_browser_e2e.sh` passed under Flutter 3.44.4 / Dart 3.12.2,
Node 22.23.1, Java 21.0.9, Firebase CLI 15.24.0, and installed system Chrome.
It exercised one complete connected lifecycle with three isolated browser users
against Auth, Firestore, Functions, and Hosting emulators.

The passing scenario covered create/join, explicit sign-out/re-sign-in and
refresh restoration, a documented TheSportsDB internal schedule, exact draft
addition/removal, publication, changed picks, picker exclusion by default,
pre-lock privacy, server lock and late rejection, reveal, manual results,
finalization, standings, a single rotation, next-week creation, and picker
participation enabled in Week 2. Browser console, page, and local failed-response
diagnostics were release assertions.

The run also proved the settings-patch regression fix. Updating only
`pickerParticipatesInPicks` no longer injects default values for omitted
settings or resets provider policy; the Week 2 picker could still load the
TheSportsDB internal catalog after the setting changed. A focused schema unit
test covers the same patch behavior.

The local backend manifest contains 29 Gen 2 exports: 28 callables and one
scheduled Function. TheSportsDB fixture/policy coverage proves documented
normalization, bounded provider behavior, attribution, the exact emulator/flag
gate, and rejection in `lukes-picks`. Production remains `manual`.

The documentation-stable final matrix passed: formatting checked 51 files with
0 changes, analysis found no issues, Flutter passed 57/57 tests, Functions
passed 25/25 unit/contract tests, rules passed 10/10, emulator integration
passed 2/2, Android debug and iOS simulator builds passed, and a fresh connected
web release passed the source/secret/public-artifact scans. Exact layers and
historical audit evidence are recorded in
[validation-report.md](validation-report.md).

## Historical authenticated production preview smoke — 2026-07-31

The guarded preview-only deployment targets only `lukes-picks`
(`271408880910`) and is available at
<https://lukes-picks--connected-picker-flow-wfrwr4gp.web.app>. Firebase
displayed expiry `2026-08-07 07:50:46`. The deployed `main.dart.js` SHA-256 is
`e8e786d69bb5aee5587ad7038e4b0ccddc340b0ce0ae354d5ec5c7be3c1416da`.

The real-browser smoke verified production Google popup sign-in, reload with
the same authenticated session and arena membership restored, arena/dashboard
loading, production manual-catalog behavior, the corrected useful empty state,
explicit sign-out, and repeat sign-in/session restoration. The repeat popup was
slow to settle, but a clean reload restored the authenticated arena without a
console warning or error. Two empty manual-provider smoke arenas created by the
browser retries remain intentionally for inspection; deletion was not
authorized.

This was not a production sports-provider lifecycle test. Production remains
`manual`, TheSportsDB remains emulator-only, API-Sports remains deferred, and
neutral team badges remain required. This exact artifact was later cloned to
live, so its authenticated preview evidence remains relevant because the bundle
digest is identical. No mobile store build was published.

## Historical live Hosting smoke — 2026-07-31

At Firebase CLI time `18:10:14`, the exact `connected-picker-flow` preview
channel was cloned to `lukes-picks:live`. Both permanent URLs,
<https://lukes-picks.web.app> and <https://lukes-picks.firebaseapp.com>,
returned HTTP 200. The live `main.dart.js` SHA-256 is
`e8e786d69bb5aee5587ad7038e4b0ccddc340b0ce0ae354d5ec5c7be3c1416da`,
identical to the authenticated, browser-tested preview, from source commit
`c38136070082a0895c6cca0f118841bb0972520e`.

Live responses verified Content Security Policy, COOP
`same-origin-allow-popups`, HSTS, `nosniff`, `SAMEORIGIN`, Permissions Policy,
and Referrer Policy. The preview-only `noindex` header is absent on live. The
sign-in screen rendered on desktop and a `390x844` phone-size viewport;
Privacy, Terms, and Data sources passed; and the console recorded zero warnings
or errors.

Firebase configuration was independently verified: both permanent domains are
authorized, the Google provider is enabled/configured, and the auth handlers
return HTTP 200. The automated in-app browser could not complete the live Google
popup, so this is not a live authenticated-smoke claim. Manual Google sign-in
on a permanent live URL remains the user handoff check. Authenticated preview
smoke passed on the identical artifact.

## Baseline automated layers

The 2026-07-27 committed baseline contained:

- 18 Flutter domain/unit tests;
- 12 Flutter widget/controller tests, all using demo state;
- 8 Functions unit/contract tests;
- 10 Firestore rules tests;
- 1 direct SDK/callable emulator lifecycle test using three anonymous users;
- an emulator seed smoke test;
- demo dashboard screenshots at 390, 768, and 1440 pixels.

The emulator lifecycle covers create/join, catalog caching, a privileged refresh
denial, stale catalog rejection, save/publish contention, pre-lock privacy,
reveal, manual result, scoring, duplicate finalization repair, correction,
standings, and one rotation advance.

It bypasses the Flutter UI. `integration_test/` was empty at the pre-release
audit. The connected release candidate adds the local Playwright Core target
described below; it launches an installed system Chrome and does not download a
browser.

## Required connected browser test

Run Flutter web against Auth, Firestore, Functions, and Hosting emulators under
`demo-lukes-picks-local` with at least three users:

1. Owner creates an arena.
2. Members join and membership restores after refresh.
3. The designated picker opens a sanitized real-schedule test catalog.
4. The picker selects multiple games and removes one.
5. The exact desired slate is saved and published.
6. A member sees only the final selected games.
7. The member makes and changes an open pick.
8. The picker is excluded when participation is disabled.
9. Other users, including the owner, cannot read pre-lock choices.
10. Authoritative emulator state advances past one lock.
11. A late change is rejected while a later open game remains editable.
12. Picks reveal.
13. Results are applied and the week finalizes.
14. Standings update and rotation advances once.
15. The next week is created and assigned.
16. Refresh, sign-out, and sign-in restore the same state.
17. Repeat relevant assertions with picker participation enabled.

Across the browser target plus the Flutter/controller, rules, and Functions
integration suites, the combined matrix must also exercise optimistic rollback,
duplicate taps, offline local draft/retry, exact draft removal, idempotent
publish/finalize, and owner leave/account-deletion prevention.

### Local Playwright Core target

Run the connected browser lifecycle from the repository root:

```bash
npm --prefix functions ci
./scripts/test_browser_e2e.sh
```

The script requires Node 22, Java 21, Flutter, and system Chrome/Chromium
(`CHROME_PATH` may select a nonstandard executable). It hard-gates
`demo-lukes-picks-local` and the loopback Auth 9099, Firestore 8080, Functions
5001, and Hosting 5002 ports. It builds an emulator-only Flutter web release,
starts only those four emulators, seeds the internal provider configuration,
and never invokes deployment. Because `build/web` then contains emulator
defines, rebuild the production release before running the public-build scan or
deploying.

The browser drives three isolated contexts through sign-in, owner creation, two
joins, explicit sign-out/re-sign-in and refresh restoration, live TheSportsDB
catalog attribution and selection/save/removal/publish, member pick
creation/change, default picker exclusion, reveal, manual void results,
future-participation setting, finalize, standings, rotation, next-week creation,
and an enabled picker publishing and submitting a Week 2 pick. Semantic
role/name locators are used after enabling Flutter web accessibility.

Two security assertions deliberately use the browser users' captured emulator
ID tokens outside the rendered UI: Firestore REST proves owner/peer denial of a
pre-lock private pick, and a direct callable proves authoritative late-pick
rejection after the server lock. Firebase Admin is pointed only at the
emulators; its writes are limited to advancing selected-game lock timestamps.
Admin reads verify exact draft size, authoritative snapshots, standings,
rotation, and Week 2 eligibility. Manual results, reveal, finalization, and
next-week creation remain UI-driven.

This target intentionally uses the documented current-season MLB test schedule
from TheSportsDB, so outbound network access and at least three future games in
the seven-day window are prerequisites. Fixture normalization remains covered
by unit tests; there is no runtime fixture-injection path. Browser console/page
errors and local failed responses fail the run. The only ignored request noise
is a Firestore listen aborted by browser navigation and failed provider artwork
that exercises the documented initials fallback.

## Provider and logo tests

Sanitized fixtures—not live calls—must cover:

- the server-discovered catalog response and malformed optional metadata;
- ESPN scoreboard normalization for all eight centralized configurations,
  nullable/malformed events, status variants, ties, and doubleheaders;
- API-Sports baseball root response shape, canonical provider league/season,
  final winner derivation, response drift, and incomplete pagination;
- TheSportsDB event/team normalization and malformed responses;
- HTTPS and host allowlists;
- schedule/team cache freshness and duplicate suppression;
- timeout, bounded retry, rate limit, and raw-response hash;
- production rejection of `mock` and `theSportsDbTest`;
- API-Sports default-false deploy flag, exact project restriction, absence of
  an `API_SPORTS_KEY` declaration/binding in the dormant manifest, and
  server-catalog rejection;
- arena-timezone queries inside the active week with an inclusive seven-day
  maximum and canonical provider metadata in the cache key;
- missing, broken, and disallowed logos falling back to neutral initials;
- production logo-rights gate and TheSportsDB attribution.

No provider key or unrestricted provider payload belongs in a fixture.

## Full local matrix

Use Node 22 for Functions and Java 21 for emulators.

```bash
flutter doctor -v
flutter pub get
dart format --output=none --set-exit-if-changed .
flutter analyze
flutter test
flutter build apk --debug
flutter build ios --simulator

npm --prefix functions ci
npm --prefix functions run lint
npm --prefix functions run typecheck
npm --prefix functions test
npm --prefix functions run build
npm --prefix functions run test:rules
npm --prefix functions run test:integration
npm audit --prefix functions --omit=dev
npm audit --prefix functions

./scripts/test_browser_e2e.sh

flutter build web --release
bash -n scripts/*.sh
./scripts/check_public_source.sh
./scripts/check_public_build.sh build/web
```

Do not use `npm audit fix --force`.

## Release scans

`check_public_source.sh` verifies:

- exact fail-closed aliases;
- the authorized Flutter project/app number;
- production and emulator bootstrap project checks;
- no duplicate web Firebase initialization;
- no Wingman runtime reference and no ESPN runtime host except the exact HTTPS
  scoreboard origin and rights-gated logo hostname in
  `functions/src/providers/espn.ts`;
- no likely tracked secret.

`check_public_build.sh` requires a nonempty fresh web release, rejects source
files newer than the main bundle, confirms the authorized project number,
requires the connected-production compile-time attestation, and rejects a
non-public attestation, active emulator/test flags, forbidden project or ESPN
hosts, source maps, symbolic links, control-character paths, and likely secret
markers. It scans every deployed regular file—including wasm, images, and
fonts—rather than trusting file extensions. The preview wrapper scans before
and after a metadata-preserving copy, then deploys the read-only staged bytes.
The bootstrap pairs that attestation with a fail-closed invariant that prevents
a public release from entering demo or emulator mode.

Firebase client API keys in generated Flutter options are public identifiers,
not server secrets. The scan intentionally permits them while rejecting
service-account material, provider keys, invite peppers, and private keys.

## CI

Pull requests and pushes to `codex/lukes-picks-mvp` or
`codex/connected-picker-flow` run:

- Flutter dependency resolution, format, analysis, tests, web build, source
  scan, and fresh public-build scan;
- Node 22 / Java 21 Functions install, critical-threshold audit reporting,
  lint, typecheck, unit tests, rules tests, emulator integration, and build.

CI has no deployment credentials and performs no cloud write. Native builds and
the browser-to-emulator test remain required local/release evidence unless a
dedicated runner is added.
