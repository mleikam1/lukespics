# Local development

## Toolchain

Use Flutter 3.44.4 / Dart 3.12.2, Node 22.23.1, npm 11.9.0, and Java
21.0.9 for the Firebase emulators. Use the repository Firebase CLI 15.24.0. The
audited host defaulted to Node 24 and Java 17, so do not rely on shell defaults.

The Apple build uses Xcode 26.3, CocoaPods 1.16.2, iOS 15.0, and the
project-specific CocoaPods fallback configured in `pubspec.yaml`.

## Explicit demo

```bash
flutter pub get
flutter run -d chrome \
  --dart-define=LUKE_PICKS_PUBLIC_RELEASE=false \
  --dart-define=USE_DEMO=true
```

Demo mode is a local UI fixture, not a Firebase fallback. Normal builds are
connected builds; a Firebase error must remain visible and retryable.

## Full emulator stack

Install and compile Functions under Node 22:

```bash
npx --yes --package=node@22 --call \
  'npm --prefix functions ci && npm --prefix functions run build'
```

Select Java 21, then start only the isolated project:

```bash
ALLOW_THESPORTSDB_TEST_PROVIDER=true firebase emulators:start \
  --project demo-lukes-picks-local \
  --only auth,firestore,functions,hosting
```

Seed from another terminal:

```bash
npx --yes --package=node@22 --call 'npm --prefix functions run seed'
```

Run Flutter:

```bash
flutter run -d chrome \
  --dart-define=LUKE_PICKS_PUBLIC_RELEASE=false \
  --dart-define=USE_FIREBASE_EMULATORS=true \
  --dart-define=FIREBASE_PROJECT_ID=demo-lukes-picks-local
```

Both the client and seed path must refuse another project ID. Never deploy the
synthetic project.

## Browser-to-emulator lifecycle

After installing Functions dependencies, run the actual Flutter UI through the
three-user emulator lifecycle:

```bash
npm --prefix functions ci
./scripts/test_browser_e2e.sh
```

The harness verifies refresh and explicit sign-out/re-sign-in restoration. It
builds `build/web` with emulator defines, so that artifact is never suitable for
a public preview. Rebuild with `flutter build web --release` before running
`check_public_build.sh` or any preview deployment.

## Provider development

- `mock`: deterministic emulator/automated-test data only.
- `manual`: trustworthy commissioner-entered production fallback.
- `theSportsDbTest`: implemented for internal/emulator use only. It requires
  the explicit allow flag, documented endpoints, attribution, and sanitized
  fixtures.
- `apiSports`: server-only and disabled until an existing key and full
  production gate are available.
- `sportsDataIo`: server-only NFL/MLB League API integration. Its production
  path requires the exact project, kill switch, `production` access mode,
  verified feed/use entitlement, enabled server catalog, and Secret Manager
  key. Fixture/trial/discovery modes cannot activate production grading.

Do not make live SportsDataIO calls in CI or emulator tests. Use the sanitized
NFL/MLB fixtures to test strict path construction, nullable/TBD parsing, status
and closure mapping, reschedules, doubleheaders, UTC/Eastern behavior, and
normalization. Never add a general proxy, put the API host/header/key in
Flutter/web code, or accept a user-provided upstream URL.

## Source and build checks

```bash
bash -n scripts/*.sh
./scripts/check_public_source.sh
flutter build web --release
./scripts/check_public_build.sh build/web
```

The build scan requires the compile-time connected-production attestation and
rejects a non-public runtime attestation, active emulator/test flags, forbidden
hosts/projects, and likely secrets. Dart may retain unreachable strings from
shared local fixtures in a minified bundle, so the attestation is paired with a
fail-closed bootstrap invariant: a public release cannot enter demo or emulator
mode. Generated Firebase client API keys are public app identifiers;
service-account files, provider keys, private keys, and invite peppers remain
prohibited.

The source scan allows the exact SportsDataIO API origin and authentication
header name only in the dedicated server client. Flutter/web and public builds
reject all provider host/header/secret material. Blocked third-party logo hosts
remain denied everywhere except the server's literal denylist. Do not evade a
policy by assembling host strings.

## Cloud safety

Local development does not need production access. If a read-only cloud check
is necessary, always include `--project lukes-picks` and never enumerate or
target unrelated projects.

Only [release_firebase.sh](../scripts/release_firebase.sh) is approved for
rules/indexes, Functions, Hosting preview, and fixed preview-to-live promotion.
It is not a development convenience command. Non-interactive production
Functions deployment requires ignored `functions/.env.lukes-picks` values that
explicitly keep automatic-provider flags false and SportsDataIO mode at
`fixture`; never activate it without the complete external and technical
review. A separately
authorized prerequisite mutation, such as enabling a reviewed API or setting
`INVITE_CODE_PEPPER`, must run `assert_firebase_project.sh lukes-picks`
immediately before its own explicit project-targeted write.

## Historical dependency-advisory snapshot

The pre-release 2026-07-30 audit recorded:

- production graph: 12 advisories (5 high, 7 moderate, 0 critical);
- complete graph: 27 advisories (18 high, 8 moderate, 1 low, 0 critical).

Review compatibility before upgrades and rerun the complete suite. Do not use
`npm audit fix --force`. Current release-candidate audit results belong in
[validation-report.md](validation-report.md).
