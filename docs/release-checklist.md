# Release checklist

This checklist describes the SportsDataIO NFL/MLB branch as of 2026-08-01.
Checked implementation items are source or deterministic-test facts. They are
not deployment or activation claims.

## Current release boundary

- [x] The branch is web-focused and keeps all provider calls server-side.
- [x] Production-safe defaults are `manual`,
      `ALLOW_SPORTSDATAIO_PROVIDER=false`,
      `SPORTSDATAIO_ACCESS_MODE=fixture`, and
      `SPORTSDATAIO_ENTITLEMENT_VERIFIED=false`.
- [x] Normal validation uses sanitized, secret-free NFL and MLB fixtures.
- [ ] This branch is deployed to Functions, Firestore, or Hosting.
- [ ] A SportsDataIO key was supplied, read, created, rotated, or tested for
      this branch.
- [ ] An authenticated provider endpoint smoke test was run.
- [ ] Required NFL and MLB feed entitlement and intended-use rights were
      verified.
- [ ] A live catalog, live final-result synchronization, quota behavior, SLA,
      or anomaly contract was validated.
- [ ] Remote team-mark rights were approved. Neutral initials remain required.

Production must stay `manual` while any unchecked activation item remains.

## Implemented catalog and result behavior

- [x] `listSportsCatalog` returns server-discovered NFL/MLB metadata,
      normalized games, cache/availability state, neutral presentation policy,
      effective query, and active-week bounds.
- [x] Flutter keeps query results, cross-query selected games, persisted draft
      IDs, and authoritative published games as separate state.
- [x] NFL ↔ MLB and date/filter changes retain selected game identities.
- [x] MLB doubleheaders retain separate provider-qualified game IDs.
- [x] SportsDataIO queries use `America/New_York`, remain inside the active
      week, and cap at seven inclusive days.
- [x] A real UTC start displays in the browser/device timezone with an explicit
      timezone label.
- [x] A game with only an Eastern day displays `Time TBD (Eastern)` and cannot
      be selected, published, or given an invented lock.
- [x] Provider score IDs, league/global/game-key IDs, team IDs, closure state,
      scores, and reschedule links survive normalization when supplied.
- [x] Closed final games require complete scores and a defensible winner; ties,
      unknown states, malformed records, and ambiguous finals fail to review.
- [x] A replacement provider ID never silently replaces a published game.
- [x] Manual overrides remain audited and provider refresh cannot overwrite an
      override.

## Exact endpoint boundary

- [x] NFL runtime access is limited to:
  - `/v3/nfl/scores/json/Teams`
  - `/v3/nfl/scores/json/SchedulesBasic/{season}`
  - `/v3/nfl/scores/json/ScoresByDate/{YYYY-MMM-DD}`
- [x] MLB runtime access is limited to:
  - `/v3/mlb/scores/json/teams`
  - `/v3/mlb/scores/json/GamesByDate/{YYYY-MMM-DD}`
- [x] The origin is fixed to `https://api.sportsdata.io`; arbitrary hosts,
      paths, query strings, and browser calls are rejected.
- [x] Authentication is a server-only `Ocp-Apim-Subscription-Key` header.
- [x] Transport enforces an 8-second timeout, 5 MB response bound, at most
      three attempts, bounded retry/backoff, and safe error messages.
- [ ] The provider's accepted date form and every endpoint schema have been
      confirmed with the actual entitled account. Fixture compatibility is the
      only current evidence.

## Activation gates

- [ ] Exact Firebase project `lukes-picks` rechecked immediately before each
      write; emulator off.
- [ ] `SPORTSDATAIO_API_KEY` created or rotated without exposing its value.
- [ ] Actual account reviewed for NFL/MLB Teams, Schedule, and Live & Final
      feeds plus caching, display, storage, grading, and redistribution use.
- [ ] `ALLOW_SPORTSDATAIO_PROVIDER=true` explicitly authorized.
- [ ] `SPORTSDATAIO_ACCESS_MODE=production` explicitly authorized.
- [ ] `SPORTSDATAIO_ENTITLEMENT_VERIFIED=true` backed by retained evidence.
- [ ] Server-only `systemConfig/sportsDataIoCatalog` reviewed with
      `enabled: false`, a new revision, exact seasons, and bounded entitlement
      metadata before deployment.
- [ ] Bounded authenticated non-production smoke completed once per exact
      endpoint; no raw payload retained.
- [ ] Sanitized fixtures regenerated from only fields necessary for tests and
      reviewed for secrets, personal data, and third-party marks.
- [ ] Complete deterministic release matrix passes on the exact commit.
- [ ] Functions manifest and deletion plan reviewed, including secret binding
      only on the four provider-bearing Functions.
- [ ] Catalog document enabled only after the safe deployment succeeds.
- [ ] One authorized test arena changed from `manual` to `sportsDataIo` and
      verified end to end before wider use.

## Provider and marks

- [x] SportsDataIO presentation is neutral by construction:
      `allowRemoteLogos=false`, no hosts, no query parameters, no review date.
- [x] Provider team-logo, wordmark, and color fields are not consumed.
- [x] Flutter independently fails closed to neutral accessible initials.
- [x] Unknown or historical provider presentation cannot restore retired
      attribution or remote artwork.
- [x] Internal mock/test providers remain restricted to the approved emulator.
- [x] API-Sports remains independently default-off.
- [ ] A separate written team-mark entitlement and narrow host operation were
      approved. Until then this must remain unchecked.

## Deterministic validation

- [x] `flutter analyze` passed on the current branch.
- [x] `flutter test` passed 111/111 tests on the current branch.
- [x] `flutter build web --release` completed successfully on the current
      branch, including Flutter's Wasm compatibility dry run.
- [x] Final Functions lint, typecheck, 109/109 unit/contract tests in 5 files,
      and TypeScript build passed under Node 22 on the settled tree.
- [ ] Final Firestore rules and emulator integration matrix rerun after all
      branch edits settle.
- [ ] Final connected browser-to-emulator lifecycle rerun with automatic
      providers disabled.
- [ ] Final source, secret, and fresh public-build scans rerun on the exact
      release artifact.
- [ ] Authenticated SportsDataIO smoke completed. This is intentionally
      separate from deterministic validation.

Only update counts above from actual command output on the current tree. Do not
copy historical test counts into this section.

## Cloud release readiness

- [ ] Existing Functions, Secret Manager versions, Firestore rules/indexes,
      scheduled jobs, Hosting versions, and arena provider settings reinspected
      read-only.
- [ ] No unexpected Function, index, secret, document, Hosting version, or
      other resource deletion proposed.
- [ ] Every mutation preceded immediately by
      `./scripts/assert_firebase_project.sh lukes-picks`.
- [ ] Functions deployed through the restricted wrapper with safe defaults.
- [ ] Guarded preview deployed and the exact tested build digest recorded.
- [ ] Preview smoke confirms manual mode, neutral badges, auth, privacy links,
      catalog fallback, and zero unexpected console errors.
- [ ] Exact preview artifact promoted to live under separate authorization.
- [ ] Live headers, bundle digest, manual provider state, and authenticated
      behavior verified.
- [ ] Rollback target and operator steps recorded before activation.

## Historical manual release record

These checked rows describe the earlier 2026-08-01 manual-data artifact only.
They are retained for provenance and rollback and do not satisfy any unchecked
current-branch item.

- [x] Historical target recorded as `lukes-picks` / `271408880910`.
- [x] Historical ruleset recorded as
      `aa52ec56-c549-4e8e-880a-372474e4feeb`; five indexes recorded `READY`.
- [x] Historical Functions manifest recorded 29 active Functions and a
      30-minute scheduled job.
- [x] Historical preview/live Hosting version recorded as
      `b58df6678863654a`.
- [x] Historical bundle SHA-256 recorded as
      `411062a988bf5b8d798b317f118b505966c0d80f9fd07a4f4f4e4762842a1ed6`.
- [x] Historical live promotion recorded at
      `2026-08-01T13:52:56.156Z`; both permanent URLs returned HTTP 200 then.
- [x] Historical production arenas were recorded in `manual` mode.
- [x] Historical browser/emulator and preview checks used manual or sanitized
      fixture data, not authenticated SportsDataIO responses.

## Rollback readiness

- [ ] Immediate kill-switch procedure rehearsed:
      `ALLOW_SPORTSDATAIO_PROVIDER=false` plus affected arenas back to
      `manual`.
- [ ] Defense-in-depth catalog disable procedure reviewed.
- [ ] Published games, picks, audits, overrides, results, and standings are
      preserved during rollback.
- [ ] Provider cache/provenance retention and cache-revision strategy reviewed.
- [ ] Exact prior Hosting, Functions, and Firestore rules targets recorded for
      the intended deployment.
- [ ] Monitoring covers safe provider error categories, unresolved finals,
      request budget, circuit state, cache staleness, and scheduled sync.

## Deferred product readiness

- [ ] App Check valid-token monitoring/enforcement reviewed for web.
- [ ] Keyboard, screen-reader, text-scale, and accessibility review completed.
- [ ] Legal/product review completed for the intended hobby use and actual
      provider agreement.
- [ ] Ownership-transfer workflow completed.
- [ ] Operational alerting and incident ownership assigned.
- [ ] Android/iOS release signing and store work remain out of scope for this
      web-only release.
