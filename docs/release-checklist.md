# Release checklist

## Product and quality

- [ ] All required Flutter, Functions, rules, and integration tests pass
- [ ] Web release, Android debug, and iOS simulator builds complete
- [ ] 390/768/1440 layouts and keyboard/text scaling reviewed
- [ ] Private picks cannot be queried before lock
- [ ] Corrections/finalization are idempotent
- [ ] Mock/manual flow works without provider credentials

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
- [ ] Original icons and asset-source notes reviewed
- [ ] No ESPN, league, or team branding used as app branding
- [ ] Draft PR evidence and screenshots complete
- [ ] Production URL verified before announcing release
