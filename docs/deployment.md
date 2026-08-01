# Deployment and rollback

This project has no automatic deploy. A passing CI run does not authorize a
cloud write.

## Live sports catalog candidate — not deployed

The current `codex/live-sports-catalog-and-slate` source adds a typed,
server-discovered catalog and a hardened API-Sports path. It is not part of the
recorded preview/live artifact below. The deployed site remains the prior
manual-provider release.

The source now declares `API_SPORTS_KEY` and selectively binds it only to:

- `listSportsCatalog`;
- `refreshSelectedGames`;
- `syncSelectedGameResults`; and
- `scheduledResultSync`.

No approved `API_SPORTS_KEY` currently exists for this release. Because the
candidate Functions manifest references that secret, do not deploy its
Functions and do not deploy or promote a web artifact that claims production
schedules work. Required handoff:

`MATT_ACTION_REQUIRED: Add an approved API-Sports key to the API_SPORTS_KEY Firebase secret for project lukes-picks.`

Secret existence is necessary but not sufficient. `ALLOW_API_SPORTS_PROVIDER`
is a deploy-time boolean with a fail-closed `false` default. Keep it false until
an authenticated key/status/quota check passes, current MLB league ID and
season are discovered from the official provider, sanitized contract fixtures
match, and a reviewed server-only `systemConfig/apiSportsCatalog` document is
ready. That document owns product base URLs, paths, canonical league IDs,
seasons, final-status mappings, and presentation policy; none may come from
Flutter or be guessed during deployment.

Catalog requests use the arena's stored IANA timezone, must remain within the
active week, and may span at most seven inclusive calendar days. Remote logos
remain off unless a separate rights review supplies a review date and exact
host/query allowlists. Without that policy, normalization and Flutter both use
neutral initials even if the provider returns a URL.

After the user supplies the secret, the remaining gates still require a fresh
project assertion immediately before every cloud read/write, authenticated
provider validation without printing the value, full local/CI/browser tests,
source and fresh-build scans, an authenticated guarded preview smoke test, and
separate authorization before any exact-artifact live promotion.

## Connected preview and live web release — 2026-07-31

The previously deployed connected implementation completed its guarded preview
release and the separately authorized promotion of that exact preview artifact
to live:

- the actual Flutter UI and backend passed the isolated three-user browser
  lifecycle with picker participation disabled and enabled;
- production bootstrap is pinned to `lukes-picks`;
- production provider mode is `manual`, with neutral team badges;
- mock and TheSportsDB test modes fail closed in production;
- the local manifest contains 29 Gen 2 exports: 28 callables and one scheduled
  Function;
- every cloud write used the project guard and explicitly targeted
  `lukes-picks` (`271408880910`).

Recorded release state:

| Release item | Status |
|---|---|
| Pre-write cloud reinspection | Completed against `lukes-picks`; guard required before every write |
| `INVITE_CODE_PEPPER` | Secret Manager version 1 created; value never printed or recorded |
| Firestore rules | Active ruleset `projects/lukes-picks/rulesets/93614c6a-add3-47ad-88df-b9d9e18a00fb` |
| Firestore indexes | Five composite indexes, all `READY` |
| Functions and deletion review | 29 Functions `ACTIVE` and Cloud Run ready; no unexpected deletion |
| Scheduled processing | `scheduledResultSync` enabled every 30 minutes UTC |
| `connected-picker-flow` preview | <https://lukes-picks--connected-picker-flow-wfrwr4gp.web.app> |
| Preview expiry | Firebase output: `2026-08-07 07:50:46` |
| Preview bundle | `main.dart.js` SHA-256 `e8e786d69bb5aee5587ad7038e4b0ccddc340b0ce0ae354d5ec5c7be3c1416da` |
| Live promotion | Exact `connected-picker-flow` channel cloned to `lukes-picks:live` at Firebase CLI time `18:10:14` on 2026-07-31 |
| Permanent live URLs | <https://lukes-picks.web.app> and <https://lukes-picks.firebaseapp.com>; both HTTP 200 |
| Live bundle and source | `main.dart.js` SHA-256 `e8e786d69bb5aee5587ad7038e4b0ccddc340b0ce0ae354d5ec5c7be3c1416da`, identical to preview; source commit `c38136070082a0895c6cca0f118841bb0972520e` |
| Live security headers | CSP; COOP `same-origin-allow-popups`; HSTS; `nosniff`; `SAMEORIGIN`; Permissions Policy; Referrer Policy; no preview `noindex` header |
| Live browser smoke | Desktop and `390x844` phone-size sign-in screen rendered; Privacy, Terms, and Data sources passed; zero warning/error console logs |
| Live Auth configuration | Both permanent domains authorized; Google provider enabled/configured; auth handlers HTTP 200 |
| Live authenticated smoke | Not claimed; automated in-app browser could not complete the Google popup, so manual live Google sign-in remains a user handoff check |
| Authenticated preview smoke | Google sign-in, reload/session/membership restore, arena/dashboard, manual catalog, empty-state fix, explicit sign-out, and repeat sign-in passed on the identical artifact |
| Firestore rollback input | Prior ruleset `projects/lukes-picks/rulesets/5628e0a8-ee8b-4dd9-b8c2-5fbac9fd3213` |
| Repository handoff | Implementation commit `9df0d38` merged by [PR #1](https://github.com/mleikam1/lukespics/pull/1) into `codex/lukes-picks-mvp`; merge commit `c38136070082a0895c6cca0f118841bb0972520e` |

The Functions CLI returned exit 1 only because it could not configure an
automatic cleanup policy after every Function deployment had succeeded. The
`gcf-artifacts` repository currently has no automatic cleanup policy. This is
an operational cost/retention warning, not a failed Function rollout.

App Check enforcement, production sports-data and logo rights, accessibility,
physical devices, legal approval, operational
alerts, release signing, and store publication remain separate production/store
gates. The recorded live web promotion does not satisfy or waive them, and it
does not authorize future live Hosting writes.

## Release gates

For a future live-catalog release, do not deploy until all of the following are
recorded on the final reviewed tree. The checked historical release below does
not satisfy these new gates:

1. The complete Flutter, Functions, rules, emulator, provider-fixture, secret,
   and fresh-build matrix passes on the reviewed tree or intended commit.
2. The three-user browser-to-emulator picker flow passes with picker
   participation disabled and enabled.
3. Connected startup uses `lukes-picks`, loads no demo state, and never connects
   a public build to emulators.
4. Mock and TheSportsDB test modes are server-rejected in `lukes-picks`.
   API-Sports remains rejected unless the exact project and explicit
   default-false deploy parameter both pass.
5. Google Auth and authorized domains are verified.
6. Required APIs are enabled, `INVITE_CODE_PEPPER` exists, the approved
   `API_SPORTS_KEY` version exists without exposing its value, and selective
   Function binding is reviewed.
7. Authenticated API-Sports status/quota, current MLB league/season, schedule,
   completed-result shape, and terms are validated; the reviewed
   `systemConfig/apiSportsCatalog` entry matches that evidence.
8. Existing Firestore data, rules, indexes, Functions, and Hosting releases are
   inspected for additive compatibility.
9. The npm advisories are reviewed without a forced upgrade.
10. The source and fresh public-build scans pass.
11. Remote-logo publication remains disabled unless its independent rights and
    exact-host policy gate passes.

Stop if a command proposes deleting an unexpected Function, index, site,
release, secret, or other resource.

## Guarded prerequisite writes

The release wrapper does not enable Google APIs or create secret versions. If a
reviewed Functions manifest requires one of those prerequisite mutations,
inspect the existing state first and run:

```bash
./scripts/assert_firebase_project.sh lukes-picks
```

immediately before each explicit `lukes-picks` write. Record the target and
command without recording secret values. Do not treat an earlier guard result
as authorization for a later command.

For this candidate, adding `API_SPORTS_KEY`, creating or updating
`systemConfig/apiSportsCatalog`, and configuring
`ALLOW_API_SPORTS_PROVIDER` are separate changes. Each requires its own reviewed
target and immediately adjacent guard. Never enter a secret value into a
command line, source file, Firestore document, log, screenshot, or report.

## Allowed release commands

The wrapper accepts exactly three actions and no project override:

```bash
./scripts/release_firebase.sh rules-indexes
./scripts/release_firebase.sh functions
./scripts/release_firebase.sh preview
```

They resolve to explicit commands targeting `--project lukes-picks`. The
preview action uses only channel `connected-picker-flow`. There is deliberately
no general live Hosting action. The recorded `connected-picker-flow` to
`lukes-picks:live` clone was separately authorized as a one-time promotion and
does not authorize a future live update.

The wrapper:

- refuses unsupported actions;
- cannot accept the emulator or forbidden project;
- verifies gcloud and Firebase CLI use the same account;
- verifies project ID, display name, number, lifecycle state, and owner role;
- runs source/build scans before the preview;
- places the identity guard immediately before the Firebase write.

Do not bypass the wrapper with `firebase use`, aliases, or a hand-written deploy
command.

## Recorded preview smoke test

The real-browser pass at the preview URL verified:

- Luke’s Picks branding and `lukes-picks` initialization;
- no demo data, emulator hosts, test-provider markers, or Wingman references;
- production Google popup sign-in;
- reload with the authenticated session and arena membership restored;
- arena and dashboard loading;
- production manual-catalog behavior and the corrected useful empty state;
- explicit sign-out and repeat sign-in/session restoration;
- no fatal console error during the successful sign-in/reload smoke path.

The automated repeat popup was slow to settle, but a clean reload restored the
authenticated arena and no console warning or error was recorded. Two empty
smoke arenas created by the browser retries remain for inspection because
deletion was not authorized. Each uses the manual provider and contains one
draft week, one active owner, and no selected games. The complete picker,
privacy, result, standings, rotation, and next-week lifecycle remains proven
through the isolated emulator browser test, not through production sports data.

The public preview must remain in manual-provider mode with neutral badges
unless production data and logo rights have separately passed review.

## Recorded live promotion and unauthenticated smoke

At Firebase CLI time `18:10:14` on 2026-07-31, the exact
`connected-picker-flow` channel was cloned to `lukes-picks:live`. Both
<https://lukes-picks.web.app> and <https://lukes-picks.firebaseapp.com>
returned HTTP 200. The live `main.dart.js` SHA-256 is
`e8e786d69bb5aee5587ad7038e4b0ccddc340b0ce0ae354d5ec5c7be3c1416da`,
identical to the authenticated, browser-tested preview artifact, and the
recorded source commit is `c38136070082a0895c6cca0f118841bb0972520e`.

The live responses included Content Security Policy, COOP
`same-origin-allow-popups`, HSTS, `nosniff`, `SAMEORIGIN`, Permissions Policy,
and Referrer Policy headers. Unlike the preview, live did not include a
`noindex` header. Desktop and `390x844` phone-size sign-in screens rendered;
Privacy, Terms, and Data sources passed; and the browser recorded zero warning
or error console logs.

Firebase Auth was independently verified: both permanent domains are
authorized, the Google provider is enabled/configured, and the auth handlers
return HTTP 200. The automated in-app browser could not complete the live
Google popup. Manual Google sign-in on a permanent live URL therefore remains
a user handoff check, and this record does not claim live authenticated smoke.
The authenticated preview smoke above remains applicable artifact evidence
because live has the identical bundle digest.

## Rollback

Recorded rollback inputs include the active ruleset
`projects/lukes-picks/rulesets/93614c6a-add3-47ad-88df-b9d9e18a00fb`, the prior
ruleset `projects/lukes-picks/rulesets/5628e0a8-ee8b-4dd9-b8c2-5fbac9fd3213`,
five `READY` composite indexes, the 29-Function manifest, the preview URL, both
permanent live URLs, the bundle digest above, and source commit
`c38136070082a0895c6cca0f118841bb0972520e`.

- Hosting preview: let the preview channel expire by default. Deleting it is a
  destructive cloud action that requires explicit authorization.
- Live Hosting: any rollback or replacement is a separate cloud write requiring
  explicit authorization, a fresh project guard, and the exact reviewed
  artifact/source target. Do not infer rollback authority from this release
  record.
- Functions: redeploy only a specifically reviewed backward-compatible source
  revision. Never roll back by deleting Firestore documents.
- Firestore rules: if an authorized rollback is required, restore the reviewed
  prior ruleset above or redeploy its corresponding reviewed rules file after
  emulator tests. Confirm the exact target with the project guard first.
- Indexes: avoid removing an index until query usage and deletion impact have
  been inspected. An index rollback is not a data rollback.
- Secrets: roll to a previous secret version only through an authorized
  operational decision; never copy values into source or logs.
- Artifact Registry: review and deliberately configure a retention policy for
  `gcf-artifacts` separately if desired; do not delete images as an incidental
  workaround for the Functions CLI warning.

If a deployment partially succeeds, stop, inspect the actual project state, and
use idempotent retries only after the target diff is understood.

## Prohibited actions

- any unreviewed or unguarded live Hosting deployment or update;
- any deployment to `demo-lukes-picks-local`;
- any access or write to `wingman-interactive-live`;
- force deployment that deletes unexpected resources;
- billing, payment, DNS, domain, IAM, or Firestore-location changes;
- enabling a public TheSportsDB test provider;
- enabling `ALLOW_API_SPORTS_PROVIDER` before the credential, contract, quota,
  server-catalog, terms, and runtime-project gates pass;
- creating a production provider catalog from guessed or stale league IDs,
  seasons, response shapes, or hosts;
- deploying the live-catalog Functions manifest while `API_SPORTS_KEY` is
  absent;
- publishing Android or iOS store builds.
