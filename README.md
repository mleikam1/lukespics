# Luke’s Picks

Luke’s Picks is a private, cross-platform sports pick’em arena for rotating
weekly game selection, straight-up winner picks, results, and transparent
standings. It includes a deterministic Flutter showcase and an emulator-tested
Firebase backend, so development does not require a cloud project or
sports-provider credential.

> Status: MVP implementation for local evaluation, not a production release.
> The connected Flutter/Firebase experience still has integration work listed
> under [Known limitations](#known-limitations), and the legal text is starter
> copy that needs attorney review.

## What is included

- Responsive Flutter web, iOS, and Android experience
- Google authentication integration point plus a safe in-memory demo mode
- Create/join arena, dashboard, picker catalog, picks, results, standings,
  history, member rotation, administration, settings, and legal pages
- Pure, tested scoring and rotation domain logic
- Firebase Functions v2 backend with server-only provider adapters
- Deny-by-default Firestore rules and emulator tests
- Mock/manual sports providers and an API-Sports adapter boundary
- Firestore caching, quota headroom, refresh locking, and circuit-breaker state
- GitHub Actions validation without production deployment credentials

The in-memory demo and emulator-tested backend have separate validation
evidence. Flutter connects the core create/join/publish/pick/result operations,
but it does not yet expose every mock/manual backend operation as one connected
end-to-end workflow.

## Architecture

Flutter uses a feature-first structure with Riverpod for state and `go_router`
for URL-safe navigation. Firebase callable functions form the mutation boundary
for privileged operations. Firestore keeps private picks under each entry and
publishes separate reveal documents only after the corresponding lock.

See [architecture](docs/architecture.md), [Firestore schema](docs/firestore-schema.md),
and [security model](docs/security-model.md).

## Prerequisites

Validated development environment on 2026-07-27:

- Flutter 3.44.4 / Dart 3.12.2
- Node.js 22.23.1 for Functions (the host had Node 24.14.0, but Node 22 is the
  configured and verified Functions runtime)
- npm 11.9.0 and Firebase CLI 15.9.0
- Java 21.0.9 for Firebase Emulator Suite validation
- Xcode 26.3 and CocoaPods 1.16.2
- iOS 15.0 minimum deployment target
- Android SDK 36.1; Android Studio’s Java 21 runtime was used where required

The Flutter Swift Package Manager integration is disabled for this project
because Flutter 3.44.4 generated invalid local package symlinks after a clean.
iOS uses the supported CocoaPods fallback. Do not upgrade global tools solely
for this repository.

## Firebase project selection

No accessible Firebase/GCP project was selected during implementation because
none had an ID or display name that unambiguously belonged to Luke’s Picks.
The checked-in alias uses the synthetic emulator-only project ID
`demo-lukes-picks-local`. It is intentionally not deployable.

Before live setup, an owner must create or explicitly identify a Luke’s Picks
Firebase project. Never substitute another existing project. Follow
[firebase-setup.md](docs/firebase-setup.md).

## Quick start: demo app

```bash
flutter pub get
flutter run -d chrome
```

Demo mode requires no Google account, provider key, or cloud project. Use the
on-screen persona controls to review representative member, picker, and
commissioner screens. This is a UI showcase; it does not prove the connected
Firebase repository path.

## Quick start: emulators

Install Functions dependencies and compile:

```bash
npm --prefix functions ci
npm --prefix functions run build
```

Start the Firebase Emulator Suite:

```bash
firebase emulators:start --project demo-lukes-picks-local
```

Seed local demo documents in a separate terminal:

```bash
npm --prefix functions run seed
```

Then start Flutter against the emulators:

```bash
flutter run -d chrome \
  --dart-define=USE_FIREBASE_EMULATORS=true \
  --dart-define=FIREBASE_PROJECT_ID=demo-lukes-picks-local
```

## Firebase configuration

For an authorized live project, generate platform app registrations with:

```bash
flutterfire configure \
  --project YOUR_AUTHORIZED_PROJECT_ID \
  --platforms web,android,ios \
  --android-package-name com.mleikam.lukespics \
  --ios-bundle-id com.mleikam.lukespics
```

The app can also consume compile-time Firebase values documented in
`lib/core/firebase/firebase_bootstrap.dart`. Never commit service-account JSON,
OAuth client secrets, signing files, or provider keys.

Expected server secret names:

- `API_SPORTS_KEY`
- `COLLEGE_FOOTBALL_DATA_KEY` (optional adapter)
- `INVITE_CODE_PEPPER` (required for a production deployment)

Set a secret only after selecting the authorized project:

```bash
firebase functions:secrets:set API_SPORTS_KEY --project YOUR_AUTHORIZED_PROJECT_ID
firebase functions:secrets:set INVITE_CODE_PEPPER \
  --project YOUR_AUTHORIZED_PROJECT_ID
```

The safe template is `.env.example`; it contains names only.

## Sports-provider modes

| Mode | Purpose | Key required |
|---|---|---|
| `mock` | Deterministic schedules/results for demos and tests | No |
| `manual` | Commissioner-created games and outcomes | No |
| `apiSports` | Server-side API-Sports schedule/result adapter | Yes |

No provider request is made directly from Flutter. No ESPN undocumented
endpoint, scraping, league artwork, odds, wagers, or betting feature is used.
Mock behavior is covered by unit and emulator integration tests. Manual
operations exist as callable backend functions, but the Flutter UI does not yet
wire the entire manual lifecycle end to end.
Provider status is documented in
[sports-provider-validation.md](docs/sports-provider-validation.md).

## Common commands

```bash
# Formatting and analysis
dart format --output=none --set-exit-if-changed .
flutter analyze

# Flutter tests and build
flutter test
flutter build web --release
flutter build apk --debug
flutter build ios --simulator

# Functions
npm --prefix functions ci
npm --prefix functions run lint
npm --prefix functions run typecheck
npm --prefix functions test
npm --prefix functions run build

# Rules and integration tests
npm --prefix functions run test:rules
npm --prefix functions run test:integration
```

Run Functions commands under Node 22. Run Firebase emulator tests under Java 21.
See [local development](docs/local-development.md) for version-selection
examples and [the validation report](docs/validation-report.md) for observed
results and counts.

Run provider contract tests only against sanitized fixtures. Live provider calls
are never part of CI.

## Responsive evidence

The deterministic dashboard was visually reviewed at the requested widths:

- [Mobile — 390 × 844](docs/screenshots/mobile-dashboard-390x844.png)
- [Tablet — 768 × 1024](docs/screenshots/tablet-dashboard-768x1024.png)
- [Desktop — 1440 × 900](docs/screenshots/desktop-dashboard-1440x900.png)

These captures verify responsive layout and navigation presentation in demo
mode. They are not evidence of a real Firebase, provider, accessibility, or
physical-device smoke test.

## Deployment

Deployment is intentionally manual and additive. Validate a Hosting preview
channel before any production release:

```bash
flutter build web --release
firebase hosting:channel:deploy mvp-review \
  --project YOUR_AUTHORIZED_PROJECT_ID
```

Rules, indexes, Functions, and Hosting may be deployed only after the project,
billing posture, secrets, and existing resources have been inspected. App Check
enforcement remains in monitored mode until valid tokens have been observed on
web, Android, and iOS. See [deployment.md](docs/deployment.md).

## Known limitations

- A real Firebase project and Google provider registration were not selected.
- Nothing was deployed to Firebase Hosting, Functions, Firestore, Auth, Secret
  Manager, or another cloud resource.
- The connected Flutter repository restores membership and streams the core
  league/week/game/entry/pick/reveal/standing/history data, but it has not been
  exercised as a full browser-to-emulator or live-cloud end-to-end test.
- Some administrative callables are not surfaced in Flutter, notably explicit
  next-week creation/assignment after finalization.
- API-Sports coverage, fixture shape, and authenticated quota behavior could not
  be validated without a pre-existing key. No live provider call was made.
- Google sign-in, App Check tokens/enforcement, Analytics, and Crashlytics were
  not validated against a real project.
- `npm audit --omit=dev` reported 12 transitive production-dependency
  advisories (5 high, 7 moderate, 0 critical). Including development tooling,
  `npm audit` reported 27 (18 high, 8 moderate, 1 low, 0 critical). They were
  not force-upgraded because compatibility needs review.
- Legal pages require professional review.
- Store submission, push notifications, chat, odds, payments, and AI predictions
  are outside this MVP.
- Android release signing and App Store/Play Store distribution are not
  configured in source control.
- Keyboard-only navigation, screen-reader output, text scaling, and physical
  device layouts still need dedicated manual QA beyond the captured responsive
  dashboard widths.

## Troubleshooting

- If Functions report an unsupported runtime, use Node 22.
- For Firestore emulator work, point `JAVA_HOME` and `PATH` at an installed
  Java 21 runtime.
- If `flutter build ios --simulator` attempts Swift Package Manager resolution,
  confirm the project-specific `flutter.config.enable-swift-package-manager:
  false` setting remains in `pubspec.yaml`, run `flutter pub get`, and use
  CocoaPods. The deployment target must remain iOS 15 or newer for the current
  Firebase packages.
- If the app reports “Demo mode,” provide a complete authorized Firebase
  configuration or run with the emulator defines above.
- If a late offline pick fails, the server lock is authoritative; reopen the
  slate to view the rejected local draft, but it cannot be counted.
- If sports refresh is delayed, use cached schedules or commissioner manual
  entry and inspect provider health before forcing another request.

Further operating detail lives in [local development](docs/local-development.md),
[testing](docs/testing.md), and the [admin runbook](docs/admin-runbook.md).
