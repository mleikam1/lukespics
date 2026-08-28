# Luke’s Picks

Luke’s Picks is a private, cross-platform weekly sports pick’em arena. One
designated picker chooses the slate, eligible arena members choose straight-up
winners, picks stay private until lock, and final results update weekly and
overall standings.

> Status as of 2026-08-27: commit
> `0adbfa2f2e38a95e310551a58e2e383906f1f8db` is deployed only to the guarded
> Firebase project `lukes-picks` (`271408880910`). Firestore Rules and indexes
> deployed successfully, and all 32 Functions are `ACTIVE` on Node 22. Hosting
> version `cc6cb19ea8f74056` was deployed to the
> `connected-picker-flow` preview and cloned to live at
> <https://lukes-picks.web.app>. Live returns HTTP 200 and serves
> `main.dart.js` SHA-256
> `6e8a4aa8b42db5bb084e2be1260074cfaad9de7edae003cabc79daa1f8a57541`.
>
> The shared release contains the dormant SportsDataIO adapter, but production
> arenas remain `manual` for that provider. Its kill switch and entitlement gate
> are off, no key is present in this checkout, and no authenticated SportsDataIO
> smoke or activation was performed. Its integration remains deterministic-
> fixture complete only. Remote provider marks remain off.
>
> The server-only `cbsSports` schedule integration is enabled for 2026 FBS
> regular-season Week 1 with automatic refresh and parser 1.2.0. At
> `2026-08-27T21:24:28.753Z`, one permitted post-cooldown request returned HTTP
> 200 and refreshed 99 normalized games: all 99 have confirmed UTC kickoffs and
> effective lock instants, and zero are TBD. A fresh production browser tab
> restored the existing Google session without a prompt; the completed entry
> displayed scheduled local times, `Saved and locked`, and disabled choices.
> The remaining CBS acceptance boundary is a real completed game through final
> result, grading, and standings.

## Product contract

- One designated picker per explicit week.
- At least one selected game and no artificial maximum.
- Picker participation is configurable and defaults to disabled.
- Per-game lock is the default; server time is authoritative.
- A member can change an open pick only until every weekly pick is saved. The
  completed entry is then permanently locked, including before kickoff.
- Pre-lock choices are private even from owners and commissioners.
- One correct pick is one point; missing or incorrect is zero.
- Void and canceled games are excluded from the denominator.
- Ties without a valid winner require review or a void decision.
- Postponed, suspended, and unresolved games block finalization.
- Co-winners are supported.
- Finalization, standings rebuild, and picker rotation are idempotent.
- Inactive members retain history and are skipped by future rotation.
- Owners can send private, expiring arena links through Messages or another
  sharing app. Invitees sign in, confirm the join, and enter the member/picker
  pool at the end of the rotation.
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
configured server providers. `settings.providerName` remains the arena default,
while `settings.providerBySport` can route one sport independently—for example,
`NCAAF` to `cbsSports` without changing NFL or MLB. Its typed response includes
sports, leagues, canonical provider league/season metadata, games, cache and
availability state, presentation policy, the server-effective query, and
active-week bounds.
Flutter keeps the current query result, its cross-query game cache, the desired
draft selection, and the authoritative week-game stream as separate state, so
changing sport, league, or date does not discard already selected games.

See:

- [Architecture](docs/architecture.md)
- [Firestore schema](docs/firestore-schema.md)
- [Security model](docs/security-model.md)
- [Commissioner runbook](docs/admin-runbook.md)
- [CBS college-football provider](docs/cbs-college-football.md)

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

SportsDataIO requires a future server-only `SPORTSDATAIO_API_KEY` Secret Manager
binding; the CBS release does not provision or bind it.
The provider is fail-closed unless the runtime is the exact authorized project,
`ALLOW_SPORTSDATAIO_PROVIDER=true`, `SPORTSDATAIO_ACCESS_MODE=production`,
`SPORTSDATAIO_ENTITLEMENT_VERIFIED=true`, and the Admin-only
`systemConfig/sportsDataIoCatalog` document is enabled and valid. No secret or
contract contents belong in Firestore. Only reviewed NFL/MLB season definitions
live there; Flutter never receives vendor configuration or credentials.

CBS college football uses no credential or browser-side request. Trusted
Functions read the fail-closed `systemConfig/cbsCollegeFootball` document and
may request only the exact server-constructed HTTPS FBS scoreboard URL for the
configured active season/type/week. Redirect and page identity must remain exact;
inactive identities are cache-only and are not exposed as alternate Flutter
choices. CBS normalized week caches and provider-global rolling attempt/circuit
accounting remain private at
`sportsProviderCache/cbs_ncaaf_FBS_{season}_{seasonType}_{week}` and
`providerUsage/cbsSports_rolling24h`. Keep `enabled` and
`autoRefreshEnabled` false until the guarded deployment, emulator checks, and
one-arena validation are separately authorized and completed.

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
| `cbsSports` | Server-only public CBS NCAAF/FBS scoreboard adapter; default-off, cache-first, and configurable only as the `NCAAF` per-sport override |
| `apiSports` | Dormant alternative adapter retained for replaceability; not the active production provider |

The SportsDataIO catalog supports NFL and MLB only. NFL uses server-side Teams,
SchedulesBasic, and ScoresByDate feeds; MLB uses teams and GamesByDate. Dates
are queried as US Eastern calendar days and canonical schedule/lock instants are
stored in UTC. A true time-TBD game can appear in the commissioner catalog but
cannot be selected or published until it has a real UTC instant. Selected
results reconcile through the existing centralized 30-minute job. Stale or
partial refreshes never create a graded final.

The CBS catalog is a separate conservative weekly-scoreboard path. It constructs
one exact public FBS scoreboard page from validated season, season type, and
week fields; it never accepts a URL from Flutter. The UI exposes only that exact
active season/type/week. Every outbound request, retry, or redirect hop counts
against the provider-global 12-attempt rolling cap, and the circuit breaker is
provider-global. Parser-version changes force an unconditional reparse, while
zero-game or unexplained smaller parses retain the last good schedule. Missing
or timezone-ambiguous kickoffs remain TBD with no schedule or lock instant, so
they cannot enter a published slate. The parser may retain an in-card logo URL
from the two exact CBS image hosts. Flutter still requires reviewed presentation
metadata before displaying a remote mark and otherwise fails closed to initials.

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
scans inspect regular files rather than trusting names. The exact CBS
scoreboard/logo hosts are likewise allowed only in the reviewed server parser,
provider, and schedule service and are rejected from Flutter and the public
build.

CI runs the static suites and these scans without deployment credentials. It
does not deploy.

## Deployment

The completed-entry lock, remembered Google session behavior, automatic CBS
kickoff parser/cache, Rules, Functions, and Hosting release are live. The
SportsDataIO integration remains inactive. Before any SportsDataIO-backed
preview or live release, confirm the key/contract covers the exact NFL and MLB
schedule, team, and score feeds plus the intended display and result-grading
use. Keep `ALLOW_SPORTSDATAIO_PROVIDER=false`, access mode `fixture`, entitlement
verification false, and the provider catalog absent/disabled until then. Logo
rights are a separate gate; neutral initials remain production-safe.

The current production release record is:

- implementation commit:
  `0adbfa2f2e38a95e310551a58e2e383906f1f8db`;
- successful CI: <https://github.com/mleikam1/lukespics/actions/runs/33112892405>;
- preview: <https://lukes-picks--connected-picker-flow-9abhuudi.web.app>;
- live: <https://lukes-picks.web.app>;
- Hosting version: `cc6cb19ea8f74056`, cloned live at
  `2026-08-27T20:27:35.519Z`;
- deployed `main.dart.js` SHA-256:
  `6e8a4aa8b42db5bb084e2be1260074cfaad9de7edae003cabc79daa1f8a57541`;
- Functions: 32/32 `ACTIVE`, all Node 22;
- CBS cache: parser 1.2.0, 99/99 scheduled kickoffs, 99/99 effective lock
  instants, zero TBD, last successful fetch `2026-08-27T21:24:28.753Z`;
- scheduler: enabled hourly in UTC; the verified forced run made one outbound
  request, received HTTP 200, and completed successfully; and
- authenticated UI: fresh-tab session restoration reached the connected
  dashboard without a Google prompt, then the Week 1 entry showed local game
  times and permanently disabled saved choices.

The CBS implementation requires no new composite Firestore index. See
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

- The active 2026 FBS Week 1 CBS schedule is live with 99 confirmed kickoffs and
  zero TBD games. The production UI and completed-entry lock are verified, but
  no real CBS game has yet completed the live result/scoring/standings flow.
- The 2026-08-25 dependency audit found 0 vulnerabilities in the Functions
  production graph, but 8 in the complete graph (4 high, 4 moderate).
  `flutter pub outdated` also reported 25 locked packages that can be upgraded
  and 2 constraints behind otherwise resolvable versions. These findings need
  review before upgrades; they are not production-acceptance evidence.
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
  restoration, explicit sign-out, and repeat sign-in passed. Production
  fresh-tab restoration on `lukes-picks.web.app` also reused the existing
  signed-in session without opening a Google prompt.
- Live unauthenticated smoke passed on desktop and a `390x844` phone-size
  viewport, including Privacy, Terms, and Data sources, with zero warning/error
  console logs. A subsequent authenticated production check restored the
  connected dashboard and locked entry without requiring a new Google login.
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
