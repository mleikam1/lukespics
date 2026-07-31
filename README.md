# Luke’s Picks

Luke’s Picks is a private, cross-platform weekly sports pick’em arena. One
designated picker chooses the slate, eligible arena members choose straight-up
winners, picks stay private until lock, and final results update weekly and
overall standings.

> Status as of 2026-07-31: the guarded backend release and Hosting preview are
> deployed only to the authorized `lukes-picks` project
> (`271408880910`). Firestore rules/indexes, 29 Gen 2 Functions, and the
> `connected-picker-flow` preview were verified; live Hosting was untouched.
> Production Google sign-in, reload/session/membership restoration, the arena
> dashboard, and the manual-catalog empty state passed a real-browser smoke
> test. The branch is pushed and tracked in
> [draft PR #1](https://github.com/mleikam1/lukespics/pull/1). This is not a
> public production or app-store readiness claim.

## Product contract

- One designated picker per explicit week.
- At least one selected game and no artificial maximum.
- Picker participation is configurable and defaults to disabled.
- Per-game lock is the default; server time is authoritative.
- A member can change an open pick but never a locked pick.
- Pre-lock choices are private even from owners and commissioners.
- One correct pick is one point; missing or incorrect is zero.
- Void and canceled games are excluded from the denominator.
- Ties without a valid winner require review or a void decision.
- Postponed, suspended, and unresolved games block finalization.
- Co-winners are supported.
- Finalization, standings rebuild, and picker rotation are idempotent.
- Inactive members retain history and are skipped by future rotation.
- No odds, spreads, wagering, payments, or advanced scoring.

The complete intended sequence is documented in
[connected-weekly-picker.md](docs/connected-weekly-picker.md).

## Architecture

Flutter uses Riverpod and `go_router`. Firestore streams member-visible state;
callable Functions are the server-authoritative mutation boundary. Private
picks live under each member entry, while separate reveal documents become
member-readable only after lock.

The backend includes the weekly lifecycle, scoring, correction, standings,
rotation, manual-game fallback, provider cache, quota controls, and scheduled
result/reveal processing. A passing browser-to-emulator release test exercises
the connected Flutter client and backend together with three isolated users.

See:

- [Architecture](docs/architecture.md)
- [Firestore schema](docs/firestore-schema.md)
- [Security model](docs/security-model.md)
- [Commissioner runbook](docs/admin-runbook.md)

## Firebase isolation

The only authorized cloud project is:

| Field | Value |
|---|---|
| Project ID | `lukes-picks` |
| Display name | `Lukes-picks` |
| Project number | `271408880910` |
| Firestore location | `us-central1` |

Registered apps:

- Web: `1:271408880910:web:b7e8b5aa9d2cbc1314cb5f`
- Android: `1:271408880910:android:a99dd01fb4d5bb8114cb5f`
  (`com.mleikam.lukespics`)
- iOS: `1:271408880910:ios:dd22577f5d50ef1f14cb5f`
  (`com.mleikam.lukespics`)

Aliases are intentionally fail-closed:

- `default -> demo-lukes-picks-local`
- `prod -> lukes-picks`

`demo-lukes-picks-local` is emulator-only and must never receive a cloud
deployment. `wingman-interactive-live` belongs to another product and must
never be targeted, read, or modified.

Every rules/indexes, Functions, or Hosting-preview deployment must go through
[release_firebase.sh](scripts/release_firebase.sh). The wrapper accepts only the
authorized project and confirms both CLI accounts and project ownership
immediately before the write. Prerequisite mutations that the wrapper does not
perform—such as enabling a reviewed API or setting `INVITE_CODE_PEPPER`—must run
`./scripts/assert_firebase_project.sh lukes-picks` immediately before their own
explicitly targeted write. Never record a secret value.

## Toolchain

The established versions are:

- Flutter 3.44.4 / Dart 3.12.2
- Node.js 22.23.1 for Functions
- npm 11.9.0
- Java 21.0.9 for Firebase emulators
- Firebase CLI 15.24.0 from the Functions development dependencies
- Chrome 151 for the connected browser lifecycle
- Xcode 26.3 / CocoaPods 1.16.2
- iOS 15.0 minimum target
- Android SDK 36.1

The host may default to Node 24 and Java 17. Select Node 22 and the Android
Studio Java 21 runtime explicitly; do not upgrade project dependencies merely
to match host defaults.

## Run modes

### Explicit local demo

Demo is opt-in:

```bash
flutter run -d chrome \
  --dart-define=LUKE_PICKS_PUBLIC_RELEASE=false \
  --dart-define=USE_DEMO=true
```

It is a UI showcase only. Demo screenshots and widget tests do not prove the
Firebase-connected path.

### Firebase emulators

```bash
npm --prefix functions ci
npm --prefix functions run build
ALLOW_THESPORTSDB_TEST_PROVIDER=true firebase emulators:start \
  --project demo-lukes-picks-local \
  --only auth,firestore,functions,hosting
```

In another terminal:

```bash
npm --prefix functions run seed
flutter run -d chrome \
  --dart-define=LUKE_PICKS_PUBLIC_RELEASE=false \
  --dart-define=USE_FIREBASE_EMULATORS=true \
  --dart-define=FIREBASE_PROJECT_ID=demo-lukes-picks-local
```

The emulator project ID is enforced by the client and seed script. Emulator
tests may use deterministic mock data and the gated TheSportsDB internal-test
mode. The sanitized fixtures, provider-policy tests, production rejection, and
connected internal-schedule browser lifecycle are recorded as passing.

The automated three-user browser flow runs the actual Flutter UI against the
isolated emulator stack:

```bash
npm --prefix functions ci
./scripts/test_browser_e2e.sh
```

It verifies refresh plus explicit sign-out/re-sign-in restoration. The script
leaves an emulator-configured release in `build/web`, so run a fresh production
`flutter build web --release` afterward before the public-build scan or preview.

### Connected production configuration

Normal builds use `DefaultFirebaseOptions.currentPlatform` for `lukes-picks`.
Configuration or connection failure must show an error and retry action; it
must not fall back to demo state. `web/index.html` must not contain a second
Firebase JavaScript initialization.

## Provider and logo policy

| Mode | Policy |
|---|---|
| `mock` | Emulator and automated tests only |
| `manual` | Valid production fallback and required production mode today |
| `theSportsDbTest` | Internal/emulator only; requires an explicit flag and hard production rejection |
| `apiSports` | Disabled until a pre-existing key, coverage, quota, contract shapes, terms, and publication rights are verified |

No provider credential is exposed to Flutter or Hosting. Do not create,
purchase, or register a provider account from this workflow. Do not scrape or
hotlink ESPN pages, APIs, JSON, or images.

Remote team marks are shown only when their host and use rights are permitted.
Provider access alone is not a logo license. Production uses neutral initials
badges until rights are confirmed. See
[sports-provider-validation.md](docs/sports-provider-validation.md) and
[asset-sources.md](docs/asset-sources.md).

## Validation commands

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

The public-build scan requires a fresh connected release. It rejects stale
artifacts, a missing production or present non-public attestation, active
emulator/test flags, the forbidden project, ESPN hosts, source maps, symbolic
links, control-character paths, or likely secrets. It scans every deployed
regular file rather than trusting its extension.

CI runs the static suites and these scans without deployment credentials. It
does not deploy.

## Deployment

The connected implementation has passed its three-user browser-to-emulator
release gate and its guarded Firebase preview release. The active preview is:

- URL:
  <https://lukes-picks--connected-picker-flow-wfrwr4gp.web.app>
- Firebase-displayed expiry: `2026-08-07 07:50:46`
- deployed `main.dart.js` SHA-256:
  `e8e786d69bb5aee5587ad7038e4b0ccddc340b0ce0ae354d5ec5c7be3c1416da`

The active Firestore ruleset is
`projects/lukes-picks/rulesets/93614c6a-add3-47ad-88df-b9d9e18a00fb`, all five
composite indexes are `READY`, `INVITE_CODE_PEPPER` version 1 exists without
its value being recorded, and all 29 Functions are active/Cloud Run ready.
`scheduledResultSync` runs every 30 minutes on UTC time. Live Hosting was not
deployed. See [release-checklist.md](docs/release-checklist.md) and
[deployment.md](docs/deployment.md) for evidence and rollback identifiers.

For any future guarded update, use only:

```bash
./scripts/release_firebase.sh rules-indexes
./scripts/release_firebase.sh functions
./scripts/release_firebase.sh preview
```

The preview action deploys only the `connected-picker-flow` channel after source
and fresh-build scans. The wrapper has no live Hosting action.

## Known limitations

- API-Sports has no authorized key or authenticated coverage/quota validation.
- Production must remain manual-provider mode with neutral team badges.
- TheSportsDB is proven only for the explicitly gated emulator/internal test
  path and must remain disabled in `lukes-picks`.
- Manual result handling is browser-proven; manual-game creation remains a
  separate end-to-end validation item.
- Production Google popup sign-in, reload/session/membership restoration,
  explicit sign-out, and repeat sign-in passed. The automated repeat popup was
  slow to settle, but a clean reload restored the authenticated arena with no
  console warning or error.
- App Check valid-token monitoring, Analytics/Crashlytics production operation,
  and operational alerting remain deferred production gates.
- Ownership transfer is not supported; an active owner is prevented from
  leaving or deleting their account.
- Accessibility, physical-device behavior, legal copy, release signing, and
  store publication require separate review.
- Two empty production smoke arenas created by the browser retries remain
  intentionally in place for inspection. Each is manual-provider, Week 1
  draft, one active owner, and has no selected games; deletion was not
  authorized.
- All Functions deployed successfully, but `gcf-artifacts` has no automatic
  cleanup policy; the CLI’s resulting exit-1 retention warning is documented
  separately from Function health.
- Implementation commit `9df0d38` is pushed on
  `codex/connected-picker-flow`; handoff is tracked in
  [draft PR #1](https://github.com/mleikam1/lukespics/pull/1).

No app-store build or live Hosting release is part of this workflow.
