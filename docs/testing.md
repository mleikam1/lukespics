# Testing

## Test layers

- Flutter unit (18 tests): scoring, missing/void picks, co-winners, weighted
  accuracy, picker eligibility, rotation, retry/correction behavior, locks, and
  Chicago DST.
- Flutter widget (10 tests): auth/demo states, create/join, dashboard variants,
  slate selection validation, exclusive team choices, sync/lock states,
  standings breakpoints, co-winners, semantics, and route guards.
- Functions unit (8 tests): authoritative scoring, eligibility, deterministic
  retries, result-version normalization, tie review, deterministic mock
  provider output, and stale/future catalog eligibility.
- Firestore rules: unauthenticated/nonmember/cross-league denial, private pick
  isolation, post-lock reveal, late/invalid pick denial, score/role manipulation,
  picker/admin boundaries, and server-internal collection denial (9 tests).
- Emulator integration (1 lifecycle test): create/join, cached catalog,
  privileged refresh denial, private pre-lock pick denial, reveal, scoring,
  duplicate finalization, correction, standings, and single rotation advance.
- Seed smoke test: four Auth users plus a deterministic league, rotation,
  finalized/draft weeks, and eight games.
- Responsive visual QA: dashboard captures at 390, 768, and 1440 logical-pixel
  widths were visually reviewed without visible overflow. This must not be
  inferred from widget tests and does not replace accessibility/device QA. The
  capture session browser console reported 0 warnings/errors.

## Commands

```bash
dart format --output=none --set-exit-if-changed .
flutter analyze
flutter test
flutter build web --release
npm --prefix functions ci
npm --prefix functions run lint
npm --prefix functions run typecheck
npm --prefix functions test
npm --prefix functions run test:rules
npm --prefix functions run test:integration
```

Functions are configured for Node 22. The Firebase Emulator Suite was verified
with Java 21; use that runtime for rules, integration, and seed commands. The
iOS simulator build requires iOS 15 and the project’s CocoaPods fallback.

Provider tests use sanitized fixtures only. Test reports must distinguish a
passed command from a command blocked by an unavailable browser/device/runtime.
No authenticated provider contract test, real Firebase test, or cloud smoke test
has been run.

See [validation-report.md](validation-report.md) for the dated command/result
matrix, build artifacts, npm advisory count, and known limitations.
