# Release checklist

## Product and quality

- [x] Local Flutter, Functions unit, rules, and emulator integration tests pass
- [x] Web release, Android debug, and iOS simulator builds complete
- [x] Dashboard layout reviewed at 390, 768, and 1440 widths
- [ ] Keyboard-only navigation, screen readers, and text scaling reviewed
- [x] Private picks cannot be queried before lock in rules/integration tests
- [x] Correction and duplicate finalization behavior passes integration tests
- [x] Mock backend lifecycle works without provider credentials in emulator tests
- [ ] Manual and mock flows work end to end through the connected Flutter client

Checked items reflect only the dated local evidence in
[validation-report.md](validation-report.md); they do not imply cloud or
production validation.

## Cloud safety

- [ ] Authorized Luke’s Picks project explicitly identified
- [ ] Existing data/resources inspected; migration is additive
- [ ] Billing posture confirmed without adding/upgrading billing
- [ ] Secret values stored only in Secret Manager
- [ ] Google Auth/platform apps/authorized domains verified
- [ ] Hosting preview smoke-tested
- [ ] App Check token monitoring succeeds on every platform
- [ ] Conservative min/max instances and alerts reviewed

## Legal and release

- [ ] Privacy, terms, data sources, deletion, and non-affiliation copy reviewed
- [ ] Provider license/free-tier coverage confirmed
- [x] Original icons and asset-source notes reviewed
- [x] No ESPN, league, or team branding used as app branding
- [x] Mobile, tablet, and desktop dashboard screenshots captured and reviewed
- [ ] Draft PR evidence complete
- [ ] Production URL verified before announcing release

## Unresolved release blockers

- [ ] Explicitly identify an authorized Luke’s Picks Firebase project
- [ ] Add browser-to-emulator end-to-end coverage
- [ ] Surface explicit next-week creation/assignment in Flutter
- [ ] Honor picker-participation settings in connected client behavior
- [ ] Validate Google Auth, App Check, Analytics, and Crashlytics on that project
- [ ] Validate API-Sports coverage/quota with an existing server-side key
- [ ] Review 12 production npm dependency advisories (5 high, 7 moderate) and
  27 advisories when development tooling is included
