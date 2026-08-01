# Testing

Test evidence must identify the exact reviewed tree or commit and record the
command, runtime version, exit code, test count, warnings, and whether each
warning blocks release. The live web artifact records source commit
`c38136070082a0895c6cca0f118841bb0972520e`.

The dated evidence below belongs to the previously deployed manual-provider
release. The current `codex/live-sports-catalog-and-slate` source is a new,
undeployed candidate; existing green counts and browser evidence must not be
used to claim that its API-Sports path is released or production-connected.

## Live-catalog candidate validation

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
- `API_SPORTS_KEY` declaration and binding only to
  `listSportsCatalog`, `refreshSelectedGames`,
  `syncSelectedGameResults`, and `scheduledResultSync`; and
- default-false `ALLOW_API_SPORTS_PROVIDER` runtime policy plus emulator and
  production provider rejection paths.

Relevant focused files are
`test/data/sports_catalog_parsing_test.dart`,
`test/features/catalog_date_window_test.dart`,
`test/core/widgets/catalog_logo_policy_test.dart`,
`test/data/connected_controller_test.dart`,
`functions/test/provider-hardening.test.ts`, and
`functions/test/emulator.integration.test.ts`.

There is currently no approved `API_SPORTS_KEY`, so authenticated provider
status/quota, current MLB discovery, and live response-contract checks cannot
run. Sanitized fixtures are permitted for parser coverage but cannot satisfy
that production gate. The missing secret also blocks deployment of the
candidate Functions manifest.

## Live-catalog candidate local matrix — 2026-07-31

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

## Connected release evidence — 2026-07-30/31

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

## Authenticated production preview smoke — 2026-07-31

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

## Live Hosting smoke — 2026-07-31

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
- API-Sports baseball root response shape, canonical provider league/season,
  final winner derivation, response drift, and incomplete pagination;
- TheSportsDB event/team normalization and malformed responses;
- HTTPS and host allowlists;
- schedule/team cache freshness and duplicate suppression;
- timeout, bounded retry, rate limit, and raw-response hash;
- production rejection of `mock` and `theSportsDbTest`;
- API-Sports default-false deploy flag, exact project restriction, selective
  secret bindings, absent-secret behavior, and server-catalog rejection;
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
- no Wingman or ESPN runtime host;
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
