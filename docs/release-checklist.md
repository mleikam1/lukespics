# Release checklist

Checked items are verified preview/live release facts as of 2026-07-31.
Unchecked handoff or production/store items remain pending or deferred and do
not erase the passing connected-flow, authenticated-preview, and live
unauthenticated-smoke evidence. Those checked facts describe the prior
manual-provider artifact; they do not verify or deploy the current
`codex/live-sports-catalog-and-slate` source candidate.

## Live sports catalog candidate

Implemented and directly testable in the current source:

- [x] `listSportsCatalog` returns server-discovered sports and leagues,
      canonical provider league/season metadata, games, cache/availability,
      presentation policy, effective query, and active-week bounds
- [x] Flutter keeps current query results, cross-query game cache, desired
      draft selections, persisted draft IDs, and authoritative week games as
      separate state
- [x] Sport, league, and date changes issue a new catalog request without
      dropping previously selected game objects
- [x] Today, Tomorrow, Later, All dates, and custom windows use the arena
      timezone, stay inside the active week, and cap at seven inclusive days
- [x] `systemConfig/apiSportsCatalog` is parsed only on the server and owns
      validated provider hosts, paths, league IDs, seasons, final statuses, and
      presentation policy
- [x] `API_SPORTS_KEY` is declared and bound only to
      `listSportsCatalog`, `refreshSelectedGames`,
      `syncSelectedGameResults`, and `scheduledResultSync`
- [x] `ALLOW_API_SPORTS_PROVIDER` is a deploy-time boolean defaulting to false;
      production also requires the exact `lukes-picks` runtime
- [x] Remote logos default off and require reviewed server metadata plus
      independent Flutter provider/HTTPS/host/query checks; neutral initials
      remain the fallback

Local release evidence:

- [x] Final Flutter, Functions, rules, emulator, browser, native-build,
      production-dependency-audit, source-scan, and fresh-public-build matrix
      recorded in `docs/testing.md`
- [ ] Full development dependency audit exits cleanly. It currently reports
      three moderate Firebase CLI dependency-chain findings and offers only a
      forced breaking CLI downgrade; production dependencies report zero
      vulnerabilities

External release evidence still required:

- [ ] `API_SPORTS_KEY` approved secret exists without its value appearing in
      source, Firestore, local plaintext, commands, logs, screenshots, or notes
- [ ] Authenticated provider status/quota, current MLB league ID and season,
      schedule, completed result, and response contract validated
- [ ] Reviewed `systemConfig/apiSportsCatalog` production document matches the
      authenticated evidence
- [ ] Keep `ALLOW_API_SPORTS_PROVIDER=false` until every credential, contract,
      quota, configuration, terms, and project gate passes
- [ ] Production sports-data terms approved
- [ ] Production logo publication rights approved, or retain neutral initials
- [ ] Candidate Functions deployed through the restricted wrapper
- [ ] Candidate preview deployed and authenticated smoke-tested
- [ ] Exact tested candidate artifact separately authorized for live promotion

Current blocker:

`MATT_ACTION_REQUIRED: Add an approved API-Sports key to the API_SPORTS_KEY Firebase secret for project lukes-picks.`

## Project isolation

- [x] Authorized project identified as `lukes-picks` / `Lukes-picks` /
      `271408880910`
- [x] Owner account observed
- [x] Billing observed enabled
- [x] Fail-closed aliases declared
- [x] Web, Android, and iOS Firebase apps registered
- [x] Android and iOS identifiers match `com.mleikam.lukespics`
- [x] Project guard and restricted release wrapper added
- [x] Guard and wrapper reviewed on the release-candidate tree
- [x] Existing cloud data/resources reinspected immediately before writes
- [x] Confirm no runtime configuration or deployment command targets
      `wingman-interactive-live`, and no cloud access to it occurred
- [x] Confirm no cloud deployment went to `demo-lukes-picks-local`

## Connected product

- [x] Production startup uses `DefaultFirebaseOptions` for `lukes-picks`
- [x] Production configuration failure shows retry and loads no demo state
- [x] Catalog and selected-week state remain separate
- [x] Restored/late-assigned picker can query the catalog
- [x] Exact desired slate reconciliation handles additions, removals, chunks,
      retries, and duplicate publication
- [x] Changed-pick-only saving handles rollback, duplicate taps, offline retry,
      and later games after an earlier lock
- [x] Owner cannot read private picks before lock
- [x] Automatic reveal is proven without screen navigation
- [x] Results, standings, correction, rotation, and next-week creation are
      connected
- [x] Owner leave/account deletion prevention is connected
- [x] Picker participation disabled and enabled are both proven
- [x] Settings updates remain patches and do not reset omitted provider policy

## Provider and marks

- [x] Production defaults to `manual`
- [x] `mock` is rejected in `lukes-picks`
- [x] TheSportsDB test adapter uses only documented API endpoints and sanitized
      fixtures
- [x] `ALLOW_THESPORTSDB_TEST_PROVIDER=true` plus emulator/internal condition is
      required
- [x] TheSportsDB test mode is rejected in `lukes-picks`
- [x] Previously deployed release remains manual; API-Sports is not enabled
- [x] No ESPN host, endpoint, image, or hotlink appears in runtime source or the
      public build; denylist documentation/tests are expected
- [x] TheSportsDB documentation and terms reviewed for internal testing
- [ ] Production provider/logo publication rights approved
- [x] Missing, broken, or unapproved marks use neutral initials
- [x] TheSportsDB attribution appears in internal tests

## Validation

- [x] `flutter doctor -v`
- [x] Flutter dependency, format, analysis, and all tests; final formatter
      checked 51 files with 0 changes, analyzer found no issues, and 57/57
      Flutter tests passed
- [x] Fresh web release, Android debug, and iOS simulator builds
- [x] Functions install, lint, typecheck, unit tests, and build under Node 22
- [x] Rules and integration tests under Java 21
- [x] Three-user browser-to-emulator lifecycle
- [x] Provider sanitized-fixture tests
- [x] Both npm audits reviewed; no critical advisory
- [x] Source/secret scan
- [x] Fresh public-build scan
- [x] Responsive UI at approximately 390, 768, and 1440 pixels

## Cloud release readiness

- [x] Google Auth provider and registered app identities verified
- [x] Authenticated preview popup sign-in, reload/session, and membership
      restoration verified
- [x] Functions, Secret Manager, Run, Build, Artifact Registry, Eventarc,
      Pub/Sub, and Scheduler state verified
- [x] `INVITE_CODE_PEPPER` version 1 stored without printing its value
- [x] Prior deployed manual-provider manifest did not require the unavailable
      API-Sports secret; the current candidate now does and is blocked above
- [x] Local Firestore rules/index diff reviewed
- [x] Cloud rules/index compatibility and deployment reviewed; active ruleset
      `projects/lukes-picks/rulesets/93614c6a-add3-47ad-88df-b9d9e18a00fb`
      and five composite indexes `READY`
- [x] Unexpected Function/resource deletion check completed; 29 Functions are
      `ACTIVE`/Cloud Run ready and `scheduledResultSync` runs every 30m UTC

## Preview, live promotion, and handoff

- [x] Rules/indexes deployed through the restricted wrapper
- [x] Functions deployed through the restricted wrapper; CLI exit 1 was solely
      the post-success cleanup-policy warning, and `gcf-artifacts` has no
      automatic cleanup policy
- [x] `connected-picker-flow` preview deployed
- [x] Preview smoke-tested in a real browser at
      <https://lukes-picks--connected-picker-flow-wfrwr4gp.web.app>
- [x] Preview expiry recorded as Firebase output `2026-08-07 07:50:46`
- [x] Deployed `main.dart.js` SHA-256 recorded as
      `e8e786d69bb5aee5587ad7038e4b0ccddc340b0ce0ae354d5ec5c7be3c1416da`
- [x] Authenticated preview Google sign-in/reload, explicit sign-out, and repeat
      sign-in passed; the slow repeat popup settled after a clean reload with
      no console warning or error
- [x] Exact `connected-picker-flow` preview channel cloned to
      `lukes-picks:live` at Firebase CLI time `18:10:14` on 2026-07-31
- [x] <https://lukes-picks.web.app> and
      <https://lukes-picks.firebaseapp.com> both returned HTTP 200
- [x] Live `main.dart.js` SHA-256 matches the browser-tested preview:
      `e8e786d69bb5aee5587ad7038e4b0ccddc340b0ce0ae354d5ec5c7be3c1416da`
- [x] Live artifact source commit recorded as
      `c38136070082a0895c6cca0f118841bb0972520e`
- [x] Live CSP, COOP `same-origin-allow-popups`, HSTS, `nosniff`, `SAMEORIGIN`,
      Permissions Policy, and Referrer Policy verified; preview `noindex` is
      absent on live
- [x] Live desktop and `390x844` phone-size sign-in screen rendered; Privacy,
      Terms, and Data sources passed with zero warning/error console logs
- [x] Live Firebase Auth configuration independently verified: both permanent
      domains authorized, Google provider enabled/configured, auth handlers
      HTTP 200
- [x] Rollback inputs recorded, including prior ruleset
      `projects/lukes-picks/rulesets/5628e0a8-ee8b-4dd9-b8c2-5fbac9fd3213`
- [x] Documentation and validation report match observed results
- [x] Complete diff and secret scan reviewed
- [x] Implementation commit `9df0d38` merged by
      [PR #1](https://github.com/mleikam1/lukespics/pull/1) into
      `codex/lukes-picks-mvp` as merge commit
      `c38136070082a0895c6cca0f118841bb0972520e`
- [x] No Android/iOS store build published

## Operational follow-up

- [ ] Complete a manual Google sign-in on a permanent live URL. The automated
      in-app browser could not complete the popup, so live authenticated smoke
      is not claimed; the authenticated preview smoke passed on the identical
      artifact.
- Review the two empty manual-provider production smoke arenas before any
  separately authorized cleanup; deletion is intentionally not part of this
  release.
- Decide separately whether to configure an Artifact Registry cleanup policy
  for `gcf-artifacts`; do not delete unreviewed images.

## Deferred production and store readiness

- [ ] App Check valid-token monitoring succeeds on all platforms
- [ ] Conservative runtime limits and operational alerts reviewed
- [ ] Keyboard, screen reader, text scale, and physical-device review
- [ ] Production sports-data and team-logo publication rights
- [ ] Ownership-transfer workflow
- [ ] Legal, release-signing, store-compliance, and store-publication review
