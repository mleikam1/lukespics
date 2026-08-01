# Luke’s Picks

Luke’s Picks is a private, cross-platform weekly sports pick’em arena. One
designated picker chooses the slate, eligible arena members choose straight-up
winners, picks stay private until lock, and final results update weekly and
overall standings.

> Status as of 2026-07-31: the guarded backend release and
> `connected-picker-flow` Hosting preview were deployed only to the authorized
> `lukes-picks` project (`271408880910`), and that exact preview channel was
> cloned to `lukes-picks:live` at Firebase CLI time `18:10:14`. Both permanent
> URLs, <https://lukes-picks.web.app> and
> <https://lukes-picks.firebaseapp.com>, returned HTTP 200. The live
> `main.dart.js` SHA-256 is
> `e8e786d69bb5aee5587ad7038e4b0ccddc340b0ce0ae354d5ec5c7be3c1416da`,
> identical to the browser-tested preview, from source commit
> `c38136070082a0895c6cca0f118841bb0972520e`.
>
> Authenticated Google sign-in, reload/session/membership restoration, the
> arena dashboard, and the manual-catalog empty state passed on the identical
> preview artifact. Live unauthenticated browser smoke passed on desktop and a
> `390x844` phone-size viewport, including Privacy, Terms, and Data sources,
> with zero warning/error console logs. Google Auth is independently verified
> as enabled/configured, both permanent domains are authorized, and the auth
> handlers return HTTP 200. The automated in-app browser could not complete the
> live Google popup, so manual Google sign-in on a permanent live URL remains a
> user handoff check; live authenticated smoke is not claimed. The implementation
> was merged in [PR #1](https://github.com/mleikam1/lukespics/pull/1) as commit
> `c38136070082a0895c6cca0f118841bb0972520e`.
> This web release is not an app-store or full production-readiness claim.

> Current source candidate: `codex/live-sports-catalog-and-slate` implements a
> server-discovered, typed sports-catalog contract and a hardened API-Sports
> path, but it has not been deployed. There is currently no approved
> `API_SPORTS_KEY` Secret Manager value for `lukes-picks`, so the new Functions
> manifest, a provider-backed preview, and live promotion are blocked. The
> deployed site remains the previously recorded manual-provider release.
> `ALLOW_API_SPORTS_PROVIDER` defaults to `false`, and remote team marks remain
> disabled unless a separate rights review supplies the required server policy.
> The settled local candidate passed 91/91 Flutter tests, 54/54 Functions
> unit/contract tests, 10/10 rules tests, 8/8 emulator integration tests, all 13
> connected browser checkpoints, and web/Android/iOS builds. The production npm
> dependency audit is clean; three moderate Firebase CLI dependency-chain
> findings remain in the full development audit.

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
result/reveal processing. The previously deployed manual-provider release has
dated browser-to-emulator evidence for the connected Flutter client and backend
together with three isolated users.

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

Every rules/indexes, Functions, or Hosting-preview deployment must go through
[release_firebase.sh](scripts/release_firebase.sh). The wrapper accepts only the
authorized project and confirms both CLI accounts and project ownership
immediately before the write. Prerequisite mutations that the wrapper does not
perform—such as enabling a reviewed API or setting `INVITE_CODE_PEPPER`—must run
`./scripts/assert_firebase_project.sh lukes-picks` immediately before their own
explicitly targeted write. Never record a secret value.

Current source declares `API_SPORTS_KEY`, selectively bound only to
`listSportsCatalog`, `refreshSelectedGames`, `syncSelectedGameResults`, and
`scheduledResultSync`. Binding the secret does not enable API-Sports:
`ALLOW_API_SPORTS_PROVIDER` is a separate deploy-time boolean that defaults to
`false`, the runtime must be the authorized production project, and the
server-owned `systemConfig/apiSportsCatalog` document must contain validated
league/season configuration. The secret does not currently exist, so do not
attempt the candidate Functions release.

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
| `apiSports` | Adapter and sanitized contract tests exist; production remains disabled until an approved secret, server catalog, authenticated validation, deploy parameter, and rights gates all pass |

No provider credential is exposed to Flutter or Hosting. Do not create,
purchase, or register a provider account from this workflow. Do not scrape or
hotlink ESPN pages, APIs, JSON, or images.

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
emulator/test flags, the forbidden project, ESPN hosts, source maps, symbolic
links, control-character paths, or likely secrets. It scans every deployed
regular file rather than trusting its extension.

CI runs the static suites and these scans without deployment credentials. It
does not deploy.

## Deployment

The live-catalog source candidate is not deployable in the current no-key
state. Before any Functions, preview, or live release of that candidate, the
authorized user must complete this handoff without exposing the value:

`MATT_ACTION_REQUIRED: Add an approved API-Sports key to the API_SPORTS_KEY Firebase secret for project lukes-picks.`

After that separate action, keep `ALLOW_API_SPORTS_PROVIDER=false` until the
credential, current MLB league/season contract, quota behavior, server-owned
catalog document, and production terms have been validated. Logo rights are an
independent gate: absent an approved review date and exact host/query policy,
the server and Flutter both fall back to neutral initials.

The previously deployed manual-provider implementation passed its three-user
browser-to-emulator release gate, guarded Firebase preview release, and the
authorized clone of that exact preview artifact to live. Its preview record is:

- URL:
  <https://lukes-picks--connected-picker-flow-wfrwr4gp.web.app>
- Firebase-displayed expiry: `2026-08-07 07:50:46`
- deployed `main.dart.js` SHA-256:
  `e8e786d69bb5aee5587ad7038e4b0ccddc340b0ce0ae354d5ec5c7be3c1416da`

The active Firestore ruleset is
`projects/lukes-picks/rulesets/93614c6a-add3-47ad-88df-b9d9e18a00fb`, all five
composite indexes are `READY`, `INVITE_CODE_PEPPER` version 1 exists without
its value being recorded, and all 29 Functions are active/Cloud Run ready.
`scheduledResultSync` runs every 30 minutes on UTC time. At Firebase CLI time
`18:10:14` on 2026-07-31, the exact `connected-picker-flow` preview channel was
cloned to `lukes-picks:live`. Both <https://lukes-picks.web.app> and
<https://lukes-picks.firebaseapp.com> returned HTTP 200, and the live bundle
digest matches the preview digest above. The live artifact records source
commit `c38136070082a0895c6cca0f118841bb0972520e`. See
[release-checklist.md](docs/release-checklist.md) and
[deployment.md](docs/deployment.md) for evidence and rollback identifiers.

For any future guarded update, use only:

```bash
./scripts/release_firebase.sh rules-indexes
./scripts/release_firebase.sh functions
./scripts/release_firebase.sh preview
```

The preview action deploys only the `connected-picker-flow` channel after source
and fresh-build scans. The wrapper has no general live Hosting action. The
recorded live clone was a separately authorized one-time promotion; future live
writes still require explicit authorization and the project guard.

## Known limitations

- The live-catalog source candidate declares and selectively binds
  `API_SPORTS_KEY`, but no approved secret currently exists; authenticated
  coverage/quota validation and candidate deployment are blocked.
- `systemConfig/apiSportsCatalog` is a server-only contract for validated
  leagues and presentation policy; no production entry should be inferred from
  source code or sanitized fixtures.
- `ALLOW_API_SPORTS_PROVIDER` defaults to `false` and must not be enabled until
  every credential, contract, quota, configuration, and terms gate passes.
- Production must remain manual-provider mode with neutral team badges.
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
