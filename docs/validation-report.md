# Validation report

Baseline validation date: 2026-07-27

Connected preview release record updated: 2026-07-31

This report separates local/emulator evidence, the guarded connected-preview
release, and still-deferred provider/store behavior. A passing preview is not a
claim that the connected product is ready for live Hosting or app stores.

## Connected-flow release and preview — 2026-07-30/31

### Current identity and runtimes

| Component | Verified value |
|---|---|
| Firebase project | `lukes-picks` / `Lukes-picks` / `271408880910` |
| Firestore | Native `(default)`, `us-central1` |
| Web app | `1:271408880910:web:b7e8b5aa9d2cbc1314cb5f` |
| Android app | `1:271408880910:android:a99dd01fb4d5bb8114cb5f`; package `com.mleikam.lukespics` |
| iOS app | `1:271408880910:ios:dd22577f5d50ef1f14cb5f`; bundle `com.mleikam.lukespics` |
| Flutter / Dart | Flutter 3.44.4 / Dart 3.12.2 |
| Functions runtime | Node 22.23.1 / npm 11.9.0 |
| Emulator runtime | Java 21.0.9 |
| Firebase CLI | Repository CLI 15.24.0; global CLI 15.9.0 |
| Browser | Installed system Chrome 151 |

### Verified connected implementation

- The actual Flutter UI and Firebase backend passed
  `./scripts/test_browser_e2e.sh` against Auth, Firestore, Functions, and Hosting
  emulators under `demo-lukes-picks-local`.
- The passing lifecycle used three isolated users and covered create/join,
  explicit sign-out/re-sign-in and refresh restoration, a live documented
  TheSportsDB internal schedule, exact select/save/remove/publish behavior,
  changed picks, pre-lock privacy, authoritative lock and late rejection,
  reveal, manual results, finalization, standings, one rotation, next-week
  creation, and picker participation disabled and enabled.
- A settings-patch regression was fixed and covered by a focused unit test plus
  the Week 2 browser path: toggling future picker participation preserves
  omitted settings instead of injecting defaults that reset provider policy.
- The local Functions manifest exports 29 Gen 2 Functions: 28 callable
  Functions and the scheduled `scheduledResultSync`.
- Production defaults to `manual`. `mock` and `theSportsDbTest` fail closed in
  `lukes-picks`; API-Sports remains disabled without an approved existing key.
- TheSportsDB is restricted to the exact emulator project plus
  `ALLOW_THESPORTSDB_TEST_PROVIDER=true`. Sanitized fixtures, normalization,
  cache/rate/retry/host policy, attribution, and production rejection have
  passing automated and browser evidence.
- Production team marks remain neutral initials because no production logo
  publication rights were approved. Manual result handling is browser-proven;
  the production preview smoke covered the manual catalog and corrected empty
  state, not a complete production manual-game lifecycle.

### Final local validation matrix

| Command or layer | Result | Evidence |
|---|---|---|
| `dart format --output=none --set-exit-if-changed .` | Pass | 51 files checked; 0 changed |
| `flutter analyze` | Pass | No issues found |
| `flutter test` | Pass | 57/57 tests |
| Fresh `flutter build web --release` and release scans | Pass | Connected release attestation present; source, secret, stale-artifact, forbidden-host/project, symlink/control-path, source-map, and all-file artifact gates passed |
| Android debug and iOS simulator builds | Pass | Final-tree Android build completed in 31.0 seconds on Java 21; final-tree Xcode simulator build completed in 414.0 seconds; no store build was published |
| Functions lint, typecheck, unit tests, and build under Node 22 | Pass | 25/25 unit/contract tests |
| Firestore rules under Java 21 | Pass | 10/10 tests |
| Functions emulator integration | Pass | 2/2 lifecycle/concurrency tests |
| Connected browser-to-emulator lifecycle | Pass | Three users, both picker-participation settings, privacy/lock/reveal/results/rotation/next-week and restoration |
| npm audits | Reviewed | Recorded audit runs contain no critical advisory; no forced upgrade applied |

Earlier backend, rules, provider-fixture, emulator, responsive, native, and
audit evidence remains valid and is preserved in the dated sections below.

### Guarded cloud release and handoff

| Item | Status |
|---|---|
| Final documentation-stable validation matrix | Passed as recorded above |
| Pre-write cloud resource reinspection | Completed against `lukes-picks` / `271408880910`; guard used before every write |
| Required Google API enablement | Completed for the reviewed manifest |
| `INVITE_CODE_PEPPER` | Secret Manager version 1 created; value never printed or recorded |
| Firestore rules | Active ruleset `projects/lukes-picks/rulesets/93614c6a-add3-47ad-88df-b9d9e18a00fb` |
| Firestore rollback | Prior ruleset `projects/lukes-picks/rulesets/5628e0a8-ee8b-4dd9-b8c2-5fbac9fd3213` |
| Firestore indexes | Five composite indexes, all `READY` |
| Functions deployment and deletion review | All 29 Functions `ACTIVE` and Cloud Run ready; no unexpected deletion |
| Scheduled processing | `scheduledResultSync` enabled every 30 minutes UTC |
| `connected-picker-flow` Hosting preview | <https://lukes-picks--connected-picker-flow-wfrwr4gp.web.app> |
| Preview expiry | Firebase output: `2026-08-07 07:50:46` |
| Preview bundle | `main.dart.js` SHA-256 `e8e786d69bb5aee5587ad7038e4b0ccddc340b0ce0ae354d5ec5c7be3c1416da` |
| Live Hosting | Untouched; no live deployment |
| Production browser smoke | Google sign-in, reload/session/membership restore, arena/dashboard, manual catalog, corrected empty state, explicit sign-out, and repeat sign-in passed |
| Production smoke data | Two empty manual-provider arenas, each with one draft week, one active owner, and no selected games, retained because deletion was not authorized |
| Final commit, push, and draft pull request | Implementation commit `9df0d38` pushed; [draft PR #1](https://github.com/mleikam1/lukespics/pull/1) opened against `codex/lukes-picks-mvp` |

The Functions deployment command returned exit 1 solely because the CLI could
not configure an automatic Artifact Registry cleanup policy after all 29
Functions had succeeded. Repository `gcf-artifacts` currently has no automatic
cleanup policy. The functions themselves are active/Run ready; cleanup remains
an operational retention/cost warning.

The successful production smoke had no console warning or error. The automated
repeat popup was slow to settle, but a clean reload restored the authenticated
arena, so explicit sign-out and repeat sign-in/session restoration are recorded
as passed. The full picker lifecycle remains proven in the isolated
browser/emulator test because production sports mode intentionally remains
`manual`.

The repository handoff is complete in draft PR #1. Deferred public production
and store gates still include App Check valid-token
monitoring/enforcement, production sports-data and logo rights, accessibility,
physical devices, legal review, operational alerting, release signing, and app
store publication. Ownership transfer also remains unsupported; the backend
prevents an active owner from leaving or deleting their account.

No deployment targeted `demo-lukes-picks-local`; no access or modification was
made to `wingman-interactive-live`; ESPN was not scraped or hotlinked; no live
Hosting or app-store build was published; and no secret value is included here.

## Historical pre-release read-only audit — 2026-07-30

This audit was read-only. It did not deploy, configure Auth, enable APIs, set
secrets, or run a new full build/test matrix.

### Authorized project evidence

| Check | Observed result |
|---|---|
| Active account | `matthewleikam@gmail.com`; owner binding observed |
| Project identity | `lukes-picks` / `Lukes-picks` / `271408880910`; ACTIVE |
| Billing | Enabled |
| Firebase apps | Web, Android, and iOS registrations exist; native IDs are `com.mleikam.lukespics` |
| Firestore | Native `(default)` database in `us-central1`; no cloud composite indexes listed |
| Hosting | Site exists; only `live` channel listed; URL returned 404; no connected preview |
| Functions and secrets | Functions listing failed because the Functions API was disabled; Secret Manager was enabled with no secrets |
| Supporting APIs | Run, Artifact Registry, Cloud Build, Eventarc, and Cloud Scheduler were disabled or not listed; Pub/Sub was enabled |
| Auth/rules inspection | Sanitized read attempts returned 403; Google provider and deployed rules remain unverified |

Firestore delete protection and point-in-time recovery were both observed
disabled. Changing either setting was outside the read-only audit.

### Historical local safety checks

The following commands were run against the shared tree:

| Command | Result |
|---|---|
| `flutter doctor -v` | Pass; no issues; Chrome 151 was observed |
| `scripts/assert_firebase_project.sh lukes-picks` | Pass after verifying both CLI accounts, project identity, and owner role |
| `scripts/check_secrets.sh` | Pass at the time run |
| `npm audit --prefix functions --omit=dev` | 12 advisories: 5 high, 7 moderate, 0 critical |
| `npm audit --prefix functions` | 27 advisories: 18 high, 8 moderate, 1 low, 0 critical |

The new public source/build scans were added after this audit. A passing fresh
connected build scan must be recorded separately; the existing July 27
`build/web` artifact is stale and contains demo-mode text, so it is not
deployable.

At that audit, the then-uncommitted tree added a TheSportsDB internal adapter,
sanitized fixture, runtime provider policy, and provider-hardening tests. That
pre-release section did not treat their presence as a pass result.

### Historical pre-release no-go reasons

These bullets describe the audit at that time. Current passes and deployments
that supersede them are recorded in the 2026-07-30/31 section above.

- The required browser-to-emulator Flutter workflow has no recorded pass.
- Provider production/test gates and TheSportsDB sanitized fixtures have no
  recorded pass.
- Production must remain manual mode; API-Sports has no authorized key.
- Required Functions infrastructure and `INVITE_CODE_PEPPER` are not verified.
- Google Auth, App Check, Analytics, and Crashlytics are not connected-preview
  or device verified.
- The Firestore index file has not been compared through a production deploy.
- No `connected-picker-flow` preview exists.

The sections below preserve the 2026-07-27 baseline evidence. They must not be
read as results for later uncommitted changes.

## Historical 2026-07-27 environment

| Component | Observed version or target |
|---|---|
| Host | macOS 15.7.4, Apple silicon |
| Flutter / Dart | Flutter 3.44.4 stable / Dart 3.12.2 |
| Node / npm | Node 22.23.1 selected for Functions / npm 11.9.0 |
| Host Node | Node 24.14.0; not used as the Functions validation runtime |
| Firebase CLI | Global 15.9.0; Functions dev dependency 15.24.0 |
| Java | Java 21.0.9 selected for emulators; host default Java 17.0.18 |
| Apple | Xcode 26.3, CocoaPods 1.16.2, iOS 15.0 target |
| Android | SDK/API 36; Android 16 arm64 emulator available |
| Browser | Chrome 150 available |

The project sets `flutter.config.enable-swift-package-manager: false` and uses
CocoaPods for iOS. This is a project-specific fallback for invalid local Swift
Package Manager symlinks observed after `flutter clean` with Flutter 3.44.4.
Current Firebase Apple packages also require the checked-in iOS 15 deployment
target.

## Historical 2026-07-27 Flutter command matrix

| Command | Result | Evidence |
|---|---|---|
| `dart format --output=none --set-exit-if-changed .` | Pass | 40 Dart files checked; no formatting change required |
| `flutter analyze` | Pass | No analyzer issues |
| `flutter test` | Pass | 30 tests: 18 domain/unit and 12 UI/controller |
| `flutter build web --release` | Pass | Final-tree build completed in 25.5 seconds; release output in `build/web`; Flutter’s Wasm compatibility dry run reported no issues |
| `flutter build apk --debug` | Pass with warning | Debug APK in `build/app/outputs/flutter-apk/app-debug.apk`; Flutter emitted a non-blocking future Kotlin Gradle Plugin migration warning |
| `flutter build ios --simulator` | Pass | Final-tree Xcode build completed in 18.7 seconds; simulator app in `build/ios/iphonesimulator/Runner.app` |

The native rows are compile/build evidence. They do not include store signing,
store submission, physical-device testing, Google sign-in, push notifications,
or a live Firebase smoke test.

## Historical 2026-07-27 Functions and emulator matrix

Functions commands were run under Node 22. Rules, integration, and seed commands
used Java 21 with the synthetic project ID `demo-lukes-picks-local`.

The static suite was invoked from the repository root with:

```bash
npx --yes --package=node@22 --call \
  'node --version && npm --prefix functions run lint && npm --prefix functions run typecheck && npm --prefix functions test && npm --prefix functions run build'
```

For emulator commands, `JAVA_HOME` and the front of `PATH` selected Android
Studio’s Java 21 runtime before running the corresponding npm script under the
same temporary Node 22 runner.

| Command | Result | Evidence |
|---|---|---|
| `npm --prefix functions run lint` | Pass | ESLint completed with zero allowed warnings |
| `npm --prefix functions run typecheck` | Pass | TypeScript no-emit check completed |
| `npm --prefix functions test` | Pass | 8 unit/contract tests |
| `npm --prefix functions run build` | Pass | Node 22 Functions TypeScript compiled |
| `npm --prefix functions run test:rules` | Pass | 10 Firestore rules tests |
| `npm --prefix functions run test:integration` | Pass | 1 full emulator lifecycle test; 29 Function definitions loaded |
| `npm --prefix functions run seed` under `firebase emulators:exec` | Pass | 4 users, one demo arena, rotation, finalized/draft weeks, and 8 games created in Auth/Firestore emulators |

The integration test covers create/join, mock catalog and cache behavior,
privileged refresh denial, pre-lock pick isolation, reveal, manual final result,
scoring, duplicate finalization, correction, standings rebuild effects, and a
single idempotent rotation advance.

Expected emulator warnings were observed: Application Default Credentials were
present on the host, synthetic `demo-` secret lookups could not resolve, App
Check enforcement was not active, and the scheduled Pub/Sub trigger was not
executed. No non-emulated service was intentionally mutated.

## Historical 2026-07-27 other checks

| Check | Result | Scope |
|---|---|---|
| `npm audit --prefix functions --omit=dev` | Review required | 12 transitive production-dependency advisories: 5 high, 7 moderate, 0 critical |
| `npm audit --prefix functions` | Review required | 27 advisories including development tooling: 18 high, 8 moderate, 1 low, 0 critical |
| Secret-name/value scan | Pass with scope caveat | A direct source-tree scan (excluding dependency/build output) found no high-confidence credential values or blocked credential filenames; `scripts/check_secrets.sh` scans tracked files and must be rerun after all intended files are staged |
| Deterministic mock provider | Pass | Unit and emulator integration paths; no network |
| Responsive screenshots at 390 / 768 / 1440 | Pass for dashboard layout | True-PNG demo dashboard captures were visually reviewed with responsive mobile bottom navigation and tablet/desktop side navigation; no visible overflow was found and the browser console had 0 warnings/errors |
| Real Firebase project in the July 27 baseline | Not run | No project had been selected for that baseline |
| Cloud deployment in the July 27 baseline | Not run | No cloud resources were modified |
| Google Auth / App Check / Analytics / Crashlytics | Not run — blocked | Requires an authorized Firebase project and platform registrations |
| API-Sports authenticated spike | Not run — blocked | No existing server-side provider key was available |
| CFBD authenticated fallback spike | Not run — blocked | No existing bearer key was available |

The audit count is recorded, not accepted as production risk. Do not use
`npm audit fix --force` without reviewing Firebase compatibility and rerunning
the complete suite.

## Historical 2026-07-27 connected Flutter gaps

At that baseline, the in-memory demo was polished enough for screen review and
the backend had a passing emulator lifecycle. The connected implementation then
had these release gaps:

- Active membership restoration and subscriptions exist for league, week,
  members, standings, games, entries, private picks, reveals, and finalized
  weeks. Results and history now consume those connected snapshots.
- The Flutter layer and backend lifecycle each had automated coverage, but there
  was no full browser-to-emulator or live-cloud end-to-end test.
- Core commissioner publish/refresh/manual-game/override/finalize actions were
  connected. Explicit next-week creation/assignment and some recovery callables
  remained backend-only.
- Account anonymization exists, but owner self-deletion/ownership transfer needs
  an explicit supported workflow and connected UI validation.

These gaps block a production-readiness claim even though the local build and
test commands pass.

## Historical 2026-07-27 reliability and release limitations

- Multi-document publish/finalize failure recovery and concurrent retry behavior
  still need production-scale concurrency and fault-injection testing. Publish
  batches are recoverable rather than globally atomic and may leave draft-only
  artifacts until retry or the five-minute claim expiry.
- Finalization commits the core result before audit/standings/rotation
  follow-ups. A later `finalizeWeek` retry recovers those follow-ups, but no
  background sweeper currently repairs them if nobody retries.
- Stale catalog documents remain physically cached after
  `catalogEligibleUntil`; server validation makes them unselectable.
- Real provider league discovery, fixture fields, free-tier entitlement, quota
  headers, and all eight target competitions remain unvalidated.
- App Check is staged for monitoring, not proven or enforced.
- Client display time uses the configured league timezone, but device-clock
  skew still requires QA; server time remains authoritative for pick acceptance.
- Android’s current Kotlin Gradle Plugin version emits a non-blocking future
  Flutter-support migration warning and should be upgraded through a reviewed
  toolchain change.
- Legal copy needs counsel review. Android release signing, App Store/Play Store
  distribution, billing decisions, and store compliance remain manual work.

## Historical next validation milestone

1. Explicitly identify an authorized Luke’s Picks Firebase project and inspect
   its existing resources without changing billing.
2. Add a browser-to-emulator test covering restored membership and the complete
   mock/manual weekly lifecycle through Flutter.
3. Surface explicit next-week creation/assignment in Flutter and add UI tests
   for both picker-participation settings.
4. Review npm advisories and rerun all local/CI checks.
5. Configure Google Auth and required `INVITE_CODE_PEPPER`, deploy only a
   Hosting preview, and smoke-test all three clients with App Check monitored.
6. If an existing API-Sports key is supplied server-side, run the authenticated
   coverage/quota spike and save only sanitized fixtures.
