# Release checklist

Checked items are verified preview/live release facts as of 2026-08-01.
Unchecked handoff or production/store items remain pending or deferred and do
not erase the passing local, emulator, browser, native-build, and guarded cloud
evidence. Provider-capable code is deployed but dormant: both production flags
are false, both provider configuration documents are absent, and the two
retained arenas remain manual. No live ESPN contract or authenticated live
lifecycle is claimed.

## Dormant sports-provider release

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
- [x] The ESPN Site API scoreboard is isolated in a replaceable server adapter;
      Flutter neither constructs its URL nor parses its raw JSON
- [x] One static server catalog owns NFL, MLB, NBA, NHL, WNBA, NCAA football,
      and NCAA men's/women's basketball slugs, groups/limits, and tie policy
- [x] `ALLOW_ESPN_PROVIDER` defaults to false; the exact production runtime and
      `systemConfig/espnCatalog.enabled == true` plus bounded authorization
      reference/review-date metadata are also required
- [x] Draft week games are denied to ordinary members and readable only by the
      assigned picker or owner/commissioner until publication
- [x] Remote logos default off and require reviewed server metadata plus
      independent Flutter provider/HTTPS/host/query checks; neutral initials
      remain the fallback

Local release evidence:

- [x] Final Flutter, Functions, rules, emulator, browser, native-build,
      production-dependency-audit, source-scan, and fresh-public-build matrix
      rerun and recorded in `docs/testing.md`
- [x] Production dependency audit reports 0 vulnerabilities; the reviewed full
      audit reports three moderate development-only findings

External release evidence still required:

- [ ] Written ESPN/Disney authorization covers automated schedule/result
      requests, caching, Firestore storage, historical snapshots, and intended
      commercial distribution
- [ ] Legal/product approval recorded for the authorized use
- [ ] All eight live schedule, final-result, and anomaly contracts validated
      with bounded requests and sanitized fixtures
- [ ] Reviewed `systemConfig/espnCatalog` production document is fail-closed and
      matches the approved presentation policy
- [ ] Keep `ALLOW_ESPN_PROVIDER=false` and the document disabled/absent until
      every authorization, contract, schema, configuration, and project gate
      passes
- [ ] Production logo publication rights approved, or retain neutral initials
- [x] Provider-capable Functions deployed through the restricted wrapper with
      both provider flags false and no provider secret binding
- [x] Exact tested dormant-provider artifact deployed to preview and live
- [ ] Authenticated preview/live lifecycle completed for the 2026-08-01
      artifact; no such claim is made

Current blocker: written ESPN/Disney authorization and legal/product approval
for the intended automated and commercial use are not recorded. An unauthenticated
endpoint and passing fixtures do not clear this blocker.

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
- [x] Current deployed release remains manual; ESPN and API-Sports are not
      enabled
- [x] The exact ESPN scoreboard origin and rights-gated logo hostname are
      confined to the server adapter; Flutter, web, all other runtime source,
      and every public build remain ESPN-host-free
- [x] TheSportsDB documentation and terms reviewed for internal testing
- [ ] Production provider/logo publication rights approved
- [x] Missing, broken, or unapproved marks use neutral initials
- [x] TheSportsDB attribution appears in internal tests

## Validation

- [x] `flutter doctor -v`
- [x] Flutter dependency, format, analysis, and all tests; final formatter
      checked 62 files with 0 changes, analyzer found no issues, and 105/105
      Flutter tests passed
- [x] Fresh web release, Android debug, and iOS simulator builds
- [x] Functions install, lint, typecheck, build, and 84/84 unit/contract tests
      under Node 22
- [x] Rules 11/11 and integration 8/8 under Java 21
- [x] Three-user browser-to-emulator lifecycle passed all 13 checkpoints
- [x] Provider sanitized-fixture tests
- [x] Both npm audits reviewed; no critical advisory
- [x] Source/secret scan
- [x] Fresh public-build scan
- [x] Responsive UI at approximately 390, 768, and 1440 pixels

## Cloud release readiness

- [x] Google Auth provider and registered app identities verified
- [x] Historical 2026-07-31 preview popup sign-in, reload/session, and
      membership restoration verified for that prior artifact; this is not
      authentication evidence for the 2026-08-01 artifact
- [x] Functions, Secret Manager, Run, Build, Artifact Registry, Eventarc,
      Pub/Sub, and Scheduler state verified
- [x] `INVITE_CODE_PEPPER` version 1 stored without printing its value
- [x] The deployed dormant-provider manifest does not declare or bind
      `API_SPORTS_KEY`; its absence does not block deployment
- [x] Local Firestore rules/index diff reviewed
- [x] Cloud rules/index compatibility and deployment reviewed; active ruleset
      `projects/lukes-picks/rulesets/aa52ec56-c549-4e8e-880a-372474e4feeb`
      and five composite indexes `READY`
- [x] Unexpected Function/resource deletion check completed; 29 Functions are
      `ACTIVE`/Cloud Run ready and `scheduledResultSync` runs every 30m UTC
- [x] Deployed Function environment has `ALLOW_API_SPORTS_PROVIDER=false` and
      `ALLOW_ESPN_PROVIDER=false`
- [x] `systemConfig/espnCatalog` and `systemConfig/apiSportsCatalog` are absent;
      both retained production arenas remain manual

## Preview, live promotion, and handoff

- [x] Rules/indexes deployed through the restricted wrapper
- [x] Functions deployed through the restricted wrapper; CLI exit 1 was solely
      the post-success cleanup-policy warning, and `gcf-artifacts` has no
      automatic cleanup policy
- [x] `connected-picker-flow` preview deployed
- [x] Preview available at
      <https://lukes-picks--connected-picker-flow-wfrwr4gp.web.app>
- [x] Preview release recorded as `2026-08-01T13:52:25.814Z`, expiring
      `2026-08-08T13:52:18Z`
- [x] Preview and live Hosting version match exactly:
      `b58df6678863654a`
- [x] Deployed `main.dart.js` SHA-256 recorded as
      `411062a988bf5b8d798b317f118b505966c0d80f9fd07a4f4f4e4762842a1ed6`
- [x] Live release recorded as `2026-08-01T13:52:56.156Z`
- [x] <https://lukes-picks.web.app> and
      <https://lukes-picks.firebaseapp.com> both returned HTTP 200
- [x] Both permanent live URLs serve the exact recorded `main.dart.js` hash
- [x] Live CSP, COOP `same-origin-allow-popups`, HSTS, `nosniff`, `SAMEORIGIN`,
      Permissions Policy, and Referrer Policy verified; preview `noindex` is
      absent on live
- [ ] Current 2026-08-01 live browser render, privacy-link, and authenticated
      lifecycle smoke not rerun; only HTTP, headers, and exact bundle identity
      are claimed for this artifact
- [x] Historical Firebase Auth configuration verified on 2026-07-31: both
      permanent domains authorized, Google provider enabled/configured, auth
      handlers HTTP 200; this is retained configuration evidence, not a current
      authenticated lifecycle claim
- [x] Rollback inputs recorded, including prior ruleset
      `projects/lukes-picks/rulesets/93614c6a-add3-47ad-88df-b9d9e18a00fb`
- [x] Documentation and validation report match observed results
- [x] Complete diff and secret scan reviewed
- [x] Historical 2026-07-31 implementation commit `9df0d38` merged by
      [PR #1](https://github.com/mleikam1/lukespics/pull/1) into
      `codex/lukes-picks-mvp` as merge commit
      `c38136070082a0895c6cca0f118841bb0972520e`
- [x] No Android/iOS store build published

## Operational follow-up

- [ ] Complete an authenticated lifecycle on the 2026-08-01 preview or live
      artifact. Local browser/emulator evidence must not be described as live
      authenticated evidence.
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
