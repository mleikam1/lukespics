# Luke’s Picks

Luke’s Picks is a private, cross-platform sports pick’em arena for rotating
weekly game selection, straight-up winner picks, live results, and transparent
standings. It is built with Flutter and Firebase and remains fully demonstrable
with deterministic mock data when no sports-provider key or production Firebase
project is available.

> Status: production-oriented MVP implementation. The legal text is starter
> copy and needs attorney review before a public commercial launch.

## What is included

- Responsive Flutter web, iOS, and Android experience
- Google authentication integration point plus a safe local demo mode
- Create/join arena, dashboard, picker catalog, picks, results, standings,
  history, member rotation, administration, settings, and legal pages
- Pure, tested scoring and rotation domain logic
- Firebase Functions v2 backend with server-only provider adapters
- Deny-by-default Firestore rules and emulator tests
- Mock/manual sports providers and an API-Sports adapter boundary
- Firestore caching, quota headroom, refresh locking, and circuit-breaker state
- GitHub Actions validation without production deployment credentials

## Architecture

Flutter uses a feature-first structure with Riverpod for state and `go_router`
for URL-safe navigation. Firebase callable functions form the mutation boundary
for privileged operations. Firestore keeps private picks under each entry and
publishes separate reveal documents only after the corresponding lock.

See [architecture](docs/architecture.md), [Firestore schema](docs/firestore-schema.md),
and [security model](docs/security-model.md).

## Prerequisites

Validated development environment:

- Flutter 3.44.4 / Dart 3.12.2
- Node.js 22 for Functions (Node 24 may run tooling locally but is not the
  configured Functions runtime)
- npm 11+
- Firebase CLI 15+
- Java 17+ for emulators
- Xcode 26+ and CocoaPods for iOS
- Android SDK 36+ and Java 17/21 for Android

Do not upgrade global tools solely for this repository.

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
on-screen demo controls to walk through the complete product.

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
- `INVITE_CODE_PEPPER` (optional additional hashing pepper)

Set a secret only after selecting the authorized project:

```bash
firebase functions:secrets:set API_SPORTS_KEY --project YOUR_AUTHORIZED_PROJECT_ID
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

# Rules and integration tests
npm --prefix functions run test:rules
npm --prefix functions run test:integration
```

Run provider contract tests only against sanitized fixtures. Live provider calls
are never part of CI.

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
- API-Sports live coverage/quota cannot be validated without an existing key;
  mock/manual modes remain fully usable.
- Legal pages require professional review.
- Store submission, push notifications, chat, odds, payments, and AI predictions
  are outside this MVP.
- Android release signing and App Store/Play Store distribution are not
  configured in source control.

## Troubleshooting

- If Functions report an unsupported runtime, use Node 22.
- If Firestore emulator startup requires a newer Java, point `JAVA_HOME` at the
  installed Java 21 runtime for that command.
- If the app reports “Demo mode,” provide a complete authorized Firebase
  configuration or run with the emulator defines above.
- If a late offline pick fails, the server lock is authoritative; reopen the
  slate to view the rejected local draft, but it cannot be counted.
- If sports refresh is delayed, use cached schedules or commissioner manual
  entry and inspect provider health before forcing another request.

Further operating detail lives in [local development](docs/local-development.md),
[testing](docs/testing.md), and the [admin runbook](docs/admin-runbook.md).
