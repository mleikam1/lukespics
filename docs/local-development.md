# Local development

## Verified toolchain

The 2026-07-27 validation used Flutter 3.44.4/Dart 3.12.2, Node
22.23.1, npm 11.9.0, Firebase CLI 15.9.0, and Java 21.0.9 for the
Firebase emulators. The host default was Node 24 and Java 17, so Functions and
emulator checks explicitly selected the repository runtimes.

The iOS build used Xcode 26.3, CocoaPods 1.16.2, and an iOS 15.0
minimum deployment target. Flutter Swift Package Manager is disabled for this
project in `pubspec.yaml`; the CocoaPods fallback avoids invalid local package
symlinks observed with Flutter 3.44.4 after `flutter clean`.

## Flutter-only demo

```bash
flutter pub get
flutter run -d chrome
```

The default is deterministic in-memory demo mode and requires no external
state. It is intended for screen and persona review, not connected Firebase
validation.

## Full local stack

Use Node 22 for Functions. On a machine whose default is a different Node
version, a temporary Node 22 runner keeps the global installation unchanged:

```bash
npx --yes --package=node@22 --call \
  'npm --prefix functions ci && npm --prefix functions run build'
```

Use Java 21 for the Emulator Suite, then start the local-only synthetic project:

```bash
firebase emulators:start --project demo-lukes-picks-local
```

Seed only the emulator:

```bash
npx --yes --package=node@22 --call 'npm --prefix functions run seed'
```

Run the app with emulator compile-time defines shown in the README. Never point
the seed command at a non-`demo-` project ID. If Java 21 is not the machine
default, set `JAVA_HOME` and prepend its `bin` directory to `PATH` for each
emulator command.

## Configuration

`.env.example` lists secret names without values. Local ignored values are for
emulator adapter development only. Provider contract tests use sanitized
fixtures only. `INVITE_CODE_PEPPER` is required in a production deployment;
`API_SPORTS_KEY` is required only for real API-Sports mode; the optional CFBD
adapter has its own key.

No real Firebase project or provider credential was selected during
implementation. `demo-lukes-picks-local` is an emulator-only project ID, not a
deployment target.

## Code quality

Run formatter, Flutter analysis/tests, Functions lint/typecheck/tests, and rules
tests before committing. Direct Firebase/Firestore access belongs in
repositories; business rules belong in testable domain services.

The production Functions dependency graph currently reports 12 transitive npm
advisories under `npm audit --omit=dev` (5 high, 7 moderate, 0 critical).
Including development tooling, `npm audit` reports 27 (18 high, 8 moderate,
1 low, 0 critical). Do not use a forced major upgrade as a substitute for
compatibility review and regression testing.

See [validation-report.md](validation-report.md) for the exact verified command
matrix and the current connected-client limitations.
