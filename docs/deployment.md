# Deployment and rollback

This project has no automatic deploy. A passing CI run does not authorize a
cloud write.

## Connected preview release — 2026-07-31

The connected implementation completed its guarded preview release:

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
| Live Hosting | Untouched |
| Browser smoke | Google sign-in, reload/session/membership restore, arena/dashboard, manual catalog, empty-state fix, and explicit sign-out passed |
| Firestore rollback input | Prior ruleset `projects/lukes-picks/rulesets/5628e0a8-ee8b-4dd9-b8c2-5fbac9fd3213` |
| Commit, push, and draft PR | Pending |

The Functions CLI returned exit 1 only because it could not configure an
automatic cleanup policy after every Function deployment had succeeded. The
`gcf-artifacts` repository currently has no automatic cleanup policy. This is
an operational cost/retention warning, not a failed Function rollout.

App Check enforcement, production sports-data and logo rights, accessibility,
physical devices, legal approval, operational
alerts, release signing, and store publication remain separate production/store
gates and do not authorize a live Hosting release.

## Release gates

Do not deploy until all of the following are recorded:

1. The complete Flutter, Functions, rules, emulator, provider-fixture, secret,
   and fresh-build matrix passes on the reviewed tree or intended commit.
2. The three-user browser-to-emulator picker flow passes with picker
   participation disabled and enabled.
3. Connected startup uses `lukes-picks`, loads no demo state, and never connects
   a public build to emulators.
4. Production provider mode is `manual`; mock and TheSportsDB test modes are
   server-rejected in `lukes-picks`.
5. Google Auth and authorized domains are verified.
6. Required APIs are enabled, `INVITE_CODE_PEPPER` exists, and no unavailable
   API-Sports key is bound as a deployment requirement.
7. Existing Firestore data, rules, indexes, Functions, and Hosting releases are
   inspected for additive compatibility.
8. The npm advisories are reviewed without a forced upgrade.
9. The source and fresh public-build scans pass.

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

## Allowed release commands

The wrapper accepts exactly three actions and no project override:

```bash
./scripts/release_firebase.sh rules-indexes
./scripts/release_firebase.sh functions
./scripts/release_firebase.sh preview
```

They resolve to explicit commands targeting `--project lukes-picks`. The
preview action uses only channel `connected-picker-flow`. There is deliberately
no live Hosting action.

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

## Rollback

Recorded rollback inputs include the active ruleset
`projects/lukes-picks/rulesets/93614c6a-add3-47ad-88df-b9d9e18a00fb`, the prior
ruleset `projects/lukes-picks/rulesets/5628e0a8-ee8b-4dd9-b8c2-5fbac9fd3213`,
five `READY` composite indexes, the 29-Function manifest, and the preview URL
and bundle digest above.

- Hosting preview: let the preview channel expire by default. Deleting it is a
  destructive cloud action that requires explicit authorization. Do not change
  the live channel.
- Functions: redeploy only a specifically reviewed backward-compatible source
  revision. The final commit/PR is still pending, so complete that handoff
  before treating the current deployed source as a reproducible rollback
  target. Never roll back by deleting Firestore documents.
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

- live Hosting deployment;
- any deployment to `demo-lukes-picks-local`;
- any access or write to `wingman-interactive-live`;
- force deployment that deletes unexpected resources;
- billing, payment, DNS, domain, IAM, or Firestore-location changes;
- enabling a public TheSportsDB test provider;
- publishing Android or iOS store builds.
