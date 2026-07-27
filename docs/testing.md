# Testing

## Test layers

- Flutter unit: scoring, missing/void picks, co-winners, weighted accuracy,
  picker eligibility, rotation, retry/correction, locks, and Chicago DST.
- Flutter widget: auth/demo states, create/join, dashboard variants, slate
  selection validation, exclusive team choices, sync/lock states, standings
  breakpoints, co-winners, semantics, and empty/error states.
- Functions unit: authorization, validation, normalization, cache, quota, locks,
  idempotent finalization, rotation, and rebuild.
- Firestore rules: unauthenticated/nonmember/cross-league denial, private pick
  isolation, post-lock reveal, late/invalid pick denial, score/role manipulation,
  and picker/admin boundaries.
- Emulator integration: owner creation through correction/rebuild.
- Responsive visual QA: 390, 768, and 1440 logical-pixel widths.

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

Provider tests use sanitized fixtures only. Test reports must distinguish a
passed command from a command blocked by an unavailable browser/device/runtime.
