# Validation report

Validation date: 2026-07-27

This report separates locally observed evidence from unvalidated cloud,
provider, and production behavior. A passing local command is not a claim that
the connected product is production-ready.

## Environment

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

## Flutter command matrix

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

## Functions and emulator matrix

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

## Other checks

| Check | Result | Scope |
|---|---|---|
| `npm audit --prefix functions --omit=dev` | Review required | 12 transitive production-dependency advisories: 5 high, 7 moderate, 0 critical |
| `npm audit --prefix functions` | Review required | 27 advisories including development tooling: 18 high, 8 moderate, 1 low, 0 critical |
| Secret-name/value scan | Pass with scope caveat | A direct source-tree scan (excluding dependency/build output) found no high-confidence credential values or blocked credential filenames; `scripts/check_secrets.sh` scans tracked files and must be rerun after all intended files are staged |
| Deterministic mock provider | Pass | Unit and emulator integration paths; no network |
| Responsive screenshots at 390 / 768 / 1440 | Pass for dashboard layout | True-PNG demo dashboard captures were visually reviewed with responsive mobile bottom navigation and tablet/desktop side navigation; no visible overflow was found and the browser console had 0 warnings/errors |
| Real Firebase project | Not run — blocked | No accessible project was unambiguously owned by Luke’s Picks |
| Cloud deployment | Not run — blocked | No project selected; no cloud resources modified |
| Google Auth / App Check / Analytics / Crashlytics | Not run — blocked | Requires an authorized Firebase project and platform registrations |
| API-Sports authenticated spike | Not run — blocked | No existing server-side provider key was available |
| CFBD authenticated fallback spike | Not run — blocked | No existing bearer key was available |

The audit count is recorded, not accepted as production risk. Do not use
`npm audit fix --force` without reviewing Firebase compatibility and rerunning
the complete suite.

## Connected Flutter limitations

The in-memory demo is polished enough for screen review, and the backend has a
passing emulator lifecycle. The connected implementation still has these
release gaps:

- Active membership restoration and subscriptions exist for league, week,
  members, standings, games, entries, private picks, reveals, and finalized
  weeks. Results and history now consume those connected snapshots.
- The Flutter layer and backend lifecycle each have automated coverage, but
  there is no full browser-to-emulator or live-cloud end-to-end test.
- Core commissioner publish/refresh/manual-game/override/finalize actions are
  connected. Explicit next-week creation/assignment and some recovery callables
  remain backend-only.
- Account anonymization exists, but owner self-deletion/ownership transfer needs
  an explicit supported workflow and connected UI validation.

These gaps block a production-readiness claim even though the local build and
test commands pass.

## Reliability and release limitations

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

## Required next validation milestone

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
