# Release checklist

This checklist records the arena-invitation and CBS/entry-lock production
release plus the independent SportsDataIO NFL/MLB activation boundary as of
2026-08-27. Checked items state their evidence boundary explicitly.

## Current release boundary

- [x] The branch is web-focused and keeps all provider calls server-side.
- [x] Production-safe defaults are `manual`,
      `ALLOW_SPORTSDATAIO_PROVIDER=false`,
      `SPORTSDATAIO_ACCESS_MODE=fixture`, and
      `SPORTSDATAIO_ENTITLEMENT_VERIFIED=false`.
- [x] Normal validation uses sanitized, secret-free NFL and MLB fixtures.
- [x] The shared release branch is deployed to Functions, Firestore, and
      Hosting; SportsDataIO remains disabled and unprovisioned.
- [ ] A SportsDataIO key was supplied, read, created, rotated, or tested for
      this branch.
- [ ] An authenticated provider endpoint smoke test was run.
- [ ] Required NFL and MLB feed entitlement and intended-use rights were
      verified.
- [ ] A live catalog, live final-result synchronization, quota behavior, SLA,
      or anomaly contract was validated.
- [ ] Remote team-mark rights were approved. Neutral initials remain required.

Production must stay `manual` while any unchecked activation item remains.

## Arena invitation release — 2026-08-27

- [x] Only an arena owner can issue or revoke a modern invitation.
- [x] Raw 144-bit bearer codes are returned only in the owner's issuance
      response, including an idempotent retry, never stored or logged, and are
      represented server-side only by HMAC lookup and bounded metadata.
- [x] The first modern invitation atomically retires the original legacy code;
      later modern links remain independent and expire after 14 days or 50
      successful joins by default.
- [x] Join is explicit, case-sensitive, idempotent for the same member, and
      rejects a second active-arena membership.
- [x] Web links keep the bearer token in a fragment, survive authentication and
      arena restoration, prefill the form, and scrub the fragment after join.
- [x] The platform share sheet exposes Messages without storing phone numbers
      or requesting SMS permission; clipboard fallback remains available.
- [x] Flutter 152/152, Functions 208/208, Rules 12/12, Functions integration
      15/15, and the connected emulator-backed three-user browser lifecycle
      pass.
- [x] The exact invite release commit passed both CI jobs in run `33134634949`.
- [x] Rules, 34 Functions, preview Hosting, and exact preview-to-live promotion
      have completed through the guarded release wrapper.
- [x] Preview and live reference the same finalized Hosting version, and their
      `main.dart.js` hash exactly matches the scanned local release build;
      private cache and completed-entry state were reverified without changing
      a slate or pick.
- [ ] The authenticated live owner invitation UI has been visually rerun after
      promotion. The local Mac was locked; the immediately preceding live
      artifact remains the latest direct session/time/locked-entry browser proof.

## Short invitation-code follow-up — 2026-08-28

- [x] New Flutter clients explicitly request version-2 eight-character codes
      drawn from the human-safe 32-character alphabet; lowercase entry is
      canonicalized to uppercase.
- [x] Cached clients that omit a format version continue to receive the original
      version-1 24-character code, and existing long codes remain exact-case
      compatible at the join boundary.
- [x] Four deterministic HMAC candidates provide transactional collision
      fallback without persisting or logging a raw code. The existing pepper,
      invite ID derivation, expiry, use limit, authorization, and one-arena
      policy remain unchanged.
- [x] Flutter 156/156, Functions 209/209, Rules 12/12, Functions integration
      18/18, and the connected emulator-backed three-user browser lifecycle
      pass. The integration suite covers collision fallback, a pre-deployment
      version-1 retry, lowercase join, the five-attempt per-account throttle,
      and ten distinct members joining from one shared network.
- [x] The production web build, source scan, build scan, whitespace check, and
      production dependency audit pass; the latter reports zero production
      vulnerabilities. The full development graph retains the recorded four
      high and four moderate toolchain findings.
- [ ] The exact short-code implementation commit has passed both CI jobs.
- [ ] The guarded Functions-first, preview, and exact preview-to-live release has
      completed, with live asset identity and read-only production state
      reverified afterward.

## CBS additive release boundary — 2026-08-27

- [x] `cbsSports` is server-only and scoped to `NCAAF` / `ncaaf` / `FBS`.
- [x] Arena routing uses `settings.providerBySport.NCAAF`; the legacy
      `providerName` remains the default for every other sport.
- [x] Configuration, normalized weekly cache, and rolling attempt ledger are
      private at `systemConfig/cbsCollegeFootball`, `sportsProviderCache`, and
      `providerUsage/cbsSports_rolling24h`.
- [x] Only the configured active season/type/week can make a CBS request or
      appear as a picker choice; inactive identities cannot become a historical
      crawler.
- [x] Each outbound fetch, including retry and redirect hops, consumes the
      provider-global rolling cap; the provider-global circuit spans cache
      identities.
- [x] Exact redirect/page identity, parser-version unconditional reparse, and
      suspicious-shrink last-good retention fail closed.
- [x] The branch adds two callables plus one hourly scheduled Function; the
      existing 30-minute result sync remains separate.
- [x] Firestore Rules add the new private-cache denial and
      `firestore.indexes.json` has no CBS-related change.
- [x] The complete deterministic, rules, emulator, browser, and public-build
      matrix has passed after all CBS edits settle.
- [x] Blaze billing, Cloud Scheduler API, scheduler service-agent permission,
      and the exact additive Function manifest have been rechecked.
- [ ] Historical evidence that the CBS config was first created with both
      switches false was not established during this release; current verified
      state is enabled with automatic refresh.
- [x] Rules, indexes, 34 Node 22 Functions, preview Hosting, and live Hosting
      were deployed through the exact guarded project scripts.
- [x] A connected production arena loaded a published CBS Week 1 slate with
      confirmed kickoff times; its already-completed entry restored as saved
      and permanently locked with disabled team choices.
- [ ] A live CBS game has completed result, scoring, and standings verification.
- [x] CBS parser 1.2.0 was deployed, the private config parser version was
      changed to `1.2.0`, and one forced active-week refresh confirmed that all
      99 cached games have cross-validated UTC kickoffs without retaining raw
      HTML or preloaded-state fields.
- [x] The hourly Scheduler is enabled; the verified post-cooldown run made one
      outbound request, returned HTTP 200, and left 99 effective lock instants
      with zero TBD games.
- [x] A fresh live browser tab restored the existing Google-authenticated
      session without opening a new Google prompt.
- [x] The current Functions production dependency graph reports 0
      vulnerabilities.
- [ ] The full Functions graph's 8 vulnerabilities (4 high, 4 moderate) and
      Flutter's 25 locked upgrades/2 behind constraints have been reviewed and
      dispositioned; the observed inventory does not itself authorize upgrades.

Unchecked result-to-standings items block a claim of complete live CBS lifecycle
acceptance; they do not invalidate the verified schedule integration. Rollback
remains config-first: disable both switches, remove/restore only
`providerBySport.NCAAF`, preserve cache and historical game/pick/result data,
and redeploy prior Functions only if still necessary.

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
- [ ] Functions manifest and deletion plan reviewed; a future SportsDataIO
      release may bind its secret only to the four provider-bearing Functions.
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

## Recorded pre-invitation CBS-tree deterministic validation — 2026-08-27

- [x] Flutter format and analyze passed; unit/widget tests passed 136/136.
- [x] The Flutter web release build completed and the fresh public-build scan
      passed.
- [x] Functions lint, typecheck, and build passed; unit/contract tests passed
      205/205.
- [x] Firestore Rules passed 12/12 and emulator integration passed 10/10,
      including the authenticated cache-backed CBS lifecycle and capacity
      boundary without a CBS network request.
- [x] The connected browser-to-emulator lifecycle passed with safe provider
      flags.
- [x] Source policy, secret, public-build, and changed-tree whitespace checks
      passed on that CBS release tree.
- [ ] An authenticated live CBS game completed the production picker-to-results
      flow. This remains deliberately incomplete.

## Recorded pre-CBS deterministic validation — 2026-08-01

- [x] `flutter analyze` passed on the recorded pre-CBS tree.
- [x] `flutter test` passed 111/111 tests on the recorded pre-CBS tree.
- [x] `flutter build web --release` completed successfully on the recorded
      pre-CBS tree, including Flutter's Wasm compatibility dry run.
- [x] Final Functions lint, typecheck, 109/109 unit/contract tests in 5 files,
      and TypeScript build passed under Node 22 on that settled tree.

These historical counts do not validate CBS; the dated current-tree section
above records the completed branch matrix separately.

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
