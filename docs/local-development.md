# Local development

## Flutter-only demo

```bash
flutter pub get
flutter run -d chrome
```

The default is deterministic demo mode and requires no external state.

## Full local stack

Use Node 22 for Functions, then:

```bash
npm --prefix functions ci
npm --prefix functions run build
firebase emulators:start --project demo-lukes-picks-local
```

Seed only the emulator:

```bash
npm --prefix functions run seed
```

Run the app with emulator compile-time defines shown in the README. Never point
the seed command at a non-`demo-` project ID.

## Configuration

`.env.example` lists secret names without values. Local ignored values are for
emulator adapter development only. Provider contract tests use sanitized
fixtures in `functions/test/fixtures`.

## Code quality

Run formatter, Flutter analysis/tests, Functions lint/typecheck/tests, and rules
tests before committing. Direct Firebase/Firestore access belongs in
repositories; business rules belong in testable domain services.
