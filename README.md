# Luke’s Picks

Luke’s Picks is a private, cross-platform weekly sports pick’em arena. One
designated picker chooses the slate, eligible arena members choose straight-up
winners, picks stay private until lock, and final results update weekly and
overall standings.

> Status as of 2026-08-01: the reviewed schedule/slate/picks/results release is
> deployed only to `lukes-picks` (`271408880910`). All 29 Node 22 Functions are
> active, Firestore uses ruleset
> `projects/lukes-picks/rulesets/aa52ec56-c549-4e8e-880a-372474e4feeb`, and all
> five composite indexes are `READY`. The exact
> `connected-picker-flow` preview was cloned to live as Hosting version
> `b58df6678863654a`; both permanent URLs return HTTP 200 and serve
> `main.dart.js` SHA-256
> `411062a988bf5b8d798b317f118b505966c0d80f9fd07a4f4f4e4762842a1ed6`.
>
> The live deployment predates the SportsDataIO work on this branch. Production
> arenas remain `manual`, the SportsDataIO kill switch and entitlement gate are
> off, no key is present in this checkout, and no authenticated SportsDataIO
> smoke test or deployment was performed. The new integration is deterministic-
> fixture complete, not production-activated. Remote provider marks remain off.

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
- Interrupted finalization follow-ups repair only finalized weeks and coordinate
  safely with audited reopen; an inactive recorded next picker advances to the
  next active member before Week creation.
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
result/reveal processing. The deployed dormant-provider release passed the
connected Flutter/backend browser-to-emulator lifecycle with three isolated
users and sanitized data; that evidence is not a live-provider test.

The catalog callable now discovers its supported sports and leagues from the
configured server provider. Its typed response includes sports, leagues,
canonical provider league/season metadata, games, cache and availability
state, presentation policy, the server-effective query, and active-week bounds.
Flutter keeps the current query result, its cross-query game cache, the desired
draft selection, and the authoritative week-game stream as separate state, so
changing sport, league, or date does not discard already selected games.

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

Every rules/indexes, Functions, Hosting-preview, or fixed preview-to-live write
must go through [release_firebase.sh](scripts/release_firebase.sh). The wrapper
accepts only the authorized project and confirms both CLI accounts and project
ownership immediately before the write. Prerequisite mutations that the wrapper
does not perform—such as enabling a reviewed API or setting
`INVITE_CODE_PEPPER`—must run
`./scripts/assert_firebase_project.sh lukes-picks` immediately before their own
explicitly targeted write. Never record a secret value.

SportsDataIO uses the server-only `SPORTSDATAIO_API_KEY` Secret Manager secret.
The provider is fail-closed unless the runtime is the exact authorized project,
`ALLOW_SPORTSDATAIO_PROVIDER=true`, `SPORTSDATAIO_ACCESS_MODE=production`,
`SPORTSDATAIO_ENTITLEMENT_VERIFIED=true`, and the Admin-only
`systemConfig/sportsDataIoCatalog` document is enabled and valid. No secret or
contract contents belong in Firestore. Only reviewed NFL/MLB season definitions
live there; Flutter never receives vendor configuration or credentials.

## Toolchain

The established versions are:

- Flutter 3.44.4 / Dart 3.12.2
- Node.js 22.23.2 for Functions
- npm 10.9.8
- Java 21.0.12 for Firebase emulators
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
| `sportsDataIo` | Server-only NFL/MLB League API adapter; default-off pending key, feed/use entitlement verification, smoke test, and authorized deployment |
| `apiSports` | Dormant alternative adapter retained for replaceability; not the active production provider |

The SportsDataIO catalog supports NFL and MLB only. NFL uses server-side Teams,
SchedulesBasic, and ScoresByDate feeds; MLB uses teams and GamesByDate. Dates
are queried as US Eastern calendar days and canonical schedule/lock instants are
stored in UTC. A true time-TBD game can appear in the commissioner catalog but
cannot be selected or published until it has a real UTC instant. Selected
results reconcile through the existing centralized 30-minute job. Stale or
partial refreshes never create a graded final.

No provider credential or URL is exposed to Flutter or Hosting. The server
constructs only exact allowlisted League API paths and sends the key in the
`Ocp-Apim-Subscription-Key` header. Tests use sanitized fixtures and never call
the live service.

Remote team marks are shown only when their host and use rights are permitted.
Provider access alone is not a logo license. Production uses neutral initials
badges until rights are confirmed. See
[sports-provider-validation.md](docs/sports-provider-validation.md) and
[asset-sources.md](docs/asset-sources.md).

At publication, Functions copy only the provider name and reviewed,
non-secret presentation policy onto the member-readable week snapshot. This
lets ordinary members apply the same fail-closed logo policy without granting
them picker-only catalog access. Legacy weeks without that snapshot continue
to show neutral initials.

Catalog dates are arena-local calendar dates. The server treats the arena's
stored IANA timezone as authoritative, requires `from` and `to` together,
limits an inclusive query to seven days, and confines it to the active week.
An initial discovery call derives a deterministic remaining-week range of at
most seven days and returns the canonical query used by later filters and
refreshes.

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
emulator/test/provider flags, the forbidden project, server-only SportsDataIO
host/header/secret material, blocked third-party logo hosts, source maps,
symbolic links, control-character paths, or likely secrets. The source scan
allows the SportsDataIO API host and authentication-header name only inside the
dedicated server client. Flutter and web source remain provider-host-free. Both
scans inspect regular files rather than trusting names.

CI runs the static suites and these scans without deployment credentials. It
does not deploy.

## Deployment

The SportsDataIO branch has not been deployed. Before any provider-backed
preview or live release, confirm the key/contract covers the exact NFL and MLB
schedule, team, and score feeds plus the intended display and result-grading
use. Keep `ALLOW_SPORTSDATAIO_PROVIDER=false`, access mode `fixture`, entitlement
verification false, and the provider catalog absent/disabled until then. Logo
rights are a separate gate; neutral initials remain production-safe.

The current deployed release record below is historical evidence for the prior
manual-provider build, not evidence for this SportsDataIO branch:

- URL:
  <https://lukes-picks--connected-picker-flow-wfrwr4gp.web.app>
- Firebase-displayed expiry: `2026-08-08 13:52:18 UTC`
- deployed `main.dart.js` SHA-256:
  `411062a988bf5b8d798b317f118b505966c0d80f9fd07a4f4f4e4762842a1ed6`

The active Firestore ruleset is
`projects/lukes-picks/rulesets/aa52ec56-c549-4e8e-880a-372474e4feeb`, all five
composite indexes are `READY`, `INVITE_CODE_PEPPER` version 1 exists without
its value being recorded, and all 29 Functions are active/Cloud Run ready.
`scheduledResultSync` runs every 30 minutes on UTC time. At
`2026-08-01T13:52:56.156Z`, the exact `connected-picker-flow` preview channel
was cloned to `lukes-picks:live`. Both <https://lukes-picks.web.app> and
<https://lukes-picks.firebaseapp.com> returned HTTP 200, and the live bundle
digest matches the preview digest above. See
[release-checklist.md](docs/release-checklist.md) and
[deployment.md](docs/deployment.md) for evidence and rollback identifiers.

For any future guarded update, use only:

```bash
./scripts/release_firebase.sh rules-indexes
./scripts/release_firebase.sh functions
./scripts/release_firebase.sh preview
./scripts/release_firebase.sh hosting-live
```

The preview action deploys only the `connected-picker-flow` channel after source
and fresh-build scans. `hosting-live` can only clone that fixed preview to the
fixed `lukes-picks:live` channel; it cannot upload independent bytes or accept a
project override. Future live writes still require explicit authorization and
the project guard.

## Known limitations

- No SportsDataIO key is available in this checkout, so no authenticated smoke
  test established live schema compatibility or feed access.
- The key's NFL/MLB feed entitlement and intended display/grading rights have
  not been verified. Production must remain manual-provider mode.
- The official OpenAPI date examples and other official input hints use two
  date spellings. The implementation isolates `YYYY-MMM-DD`; confirm it once
  with the entitled non-production key before activation.
- Remote team-image rights are unconfirmed, so neutral accessible badges remain
  enabled and no provider/Wikipedia/third-party marks are loaded.
- TheSportsDB is proven only for the explicitly gated emulator/internal test
  path and must remain disabled in `lukes-picks`.
- Manual result handling is browser-proven. The connected emulator integration
  suite also creates and publishes a manual MLB game while another connected
  provider is configured, proving the authorized fallback remains usable.
- Authenticated preview Google popup sign-in, reload/session/membership
  restoration, explicit sign-out, and repeat sign-in passed. The automated
  repeat popup was slow to settle, but a clean reload restored the
  authenticated arena with no console warning or error.
- Live unauthenticated smoke passed on desktop and a `390x844` phone-size
  viewport, including Privacy, Terms, and Data sources, with zero warning/error
  console logs. The automated in-app browser could not complete the live Google
  popup, so manual Google sign-in on a permanent live URL remains required; do
  not treat the preview auth pass as a completed live authenticated smoke.
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
- Implementation commit `9df0d38` was merged from
  `codex/connected-picker-flow` by
  [PR #1](https://github.com/mleikam1/lukespics/pull/1); the default branch
  records merge commit `c38136070082a0895c6cca0f118841bb0972520e`.

No app-store build was published. The live web promotion does not satisfy the
deferred legal, provider-rights, physical-device, signing, or store gates.
