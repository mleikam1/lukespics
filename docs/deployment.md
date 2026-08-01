# Deployment and rollback

This project has no automatic deploy. A passing CI run does not authorize a
cloud write.

## Dormant sports catalog release — 2026-08-01

The typed server catalog, normalized schedule/result model, slate/pick UI,
rules fence, recovery controls, and isolated eight-league ESPN adapter are
deployed. The provider itself is not activated: every deployed Function has
`ALLOW_ESPN_PROVIDER=false` and `ALLOW_API_SPORTS_PROVIDER=false`, both active
arenas remain `manual`, and neither production provider activation document
exists. No live ESPN request or remote-logo publication was made or claimed.

The ESPN endpoints are unofficial, unsupported, have no SLA or published rate
limit, and may change schema without notice. Technical access is not production
permission. Do not activate the adapter until dated written ESPN/Disney
authorization covers the intended automated access, caching, storage, and
commercial distribution and legal/product approval is recorded. Team and
league mark rights are an independent gate.

The source has two fail-closed technical gates in addition to that external
authorization:

- `ALLOW_ESPN_PROVIDER` is a deploy-time boolean that defaults to `false` and
  is accepted only for the exact `lukes-picks` production runtime; and
- the Admin-only `systemConfig/espnCatalog` document must exist, parse, and have
  `enabled: true`, a bounded `authorizationReference`, and an ISO
  `authorizationReviewedAt` date identifying the retained approval record; it
  also owns fail-closed presentation/logo policy. Store no secret or legal
  document contents there.

The eight league identities, ESPN slugs, groups/limits, and tie policies are
static server configuration. Flutter cannot supply a provider URL or parse the
raw response. Missing or malformed configuration keeps the provider
unavailable, and remote logos remain off without a separate rights review date
and exact host/query allowlist.

Catalog requests use the arena's stored IANA timezone, must remain within the
active week, and may span at most seven inclusive calendar days. Remote logos
remain off unless a separate rights review supplies a review date and exact
host/query allowlists. Without that policy, normalization and Flutter both use
neutral initials even if the provider returns a URL.

After written authorization, validate all eight live response contracts with
bounded cache-first requests and sanitized fixtures. Then require a fresh
project assertion immediately before every cloud read/write, the full
local/CI/browser matrix, source and fresh-build scans, an authenticated guarded
preview smoke test, and separate authorization before any exact-artifact live
promotion. Keep the provider in manual mode throughout validation.

The 2026-08-01 dormant release completed its guarded preview and exact-artifact
live promotion:

- the actual Flutter UI and backend passed the isolated three-user browser
  lifecycle with picker participation disabled and enabled;
- production bootstrap is pinned to `lukes-picks`;
- production provider mode is `manual`, with neutral team badges;
- mock and TheSportsDB test modes fail closed in production, while ESPN and
  API-Sports deploy flags are explicitly false;
- the local manifest contains 29 Gen 2 exports: 28 callables and one scheduled
  Function;
- every cloud write used the project guard and explicitly targeted
  `lukes-picks` (`271408880910`).

Recorded release state:

| Release item | Status |
|---|---|
| Pre-write cloud reinspection | Completed against `lukes-picks`; guard required before every write |
| `INVITE_CODE_PEPPER` | Secret Manager version 1 created; value never printed or recorded |
| Firestore rules | Active ruleset `projects/lukes-picks/rulesets/aa52ec56-c549-4e8e-880a-372474e4feeb` |
| Firestore indexes | Five composite indexes, all `READY` |
| Functions and deletion review | 29 Node 22 Functions `ACTIVE`; no unexpected addition or deletion; provider flags both `false` |
| Scheduled processing | `scheduledResultSync` enabled every 30 minutes UTC |
| `connected-picker-flow` preview | <https://lukes-picks--connected-picker-flow-wfrwr4gp.web.app> |
| Hosting version | Preview and live both `projects/lukes-picks/sites/lukes-picks/versions/b58df6678863654a` |
| Preview release/expiry | Released `2026-08-01T13:52:25.814Z`; expires `2026-08-08T13:52:18.443Z` |
| Preview bundle | `main.dart.js` SHA-256 `411062a988bf5b8d798b317f118b505966c0d80f9fd07a4f4f4e4762842a1ed6`, identical to the locally scanned build |
| Live promotion | Exact preview cloned to `lukes-picks:live` at `2026-08-01T13:52:56.156Z` |
| Permanent live URLs | <https://lukes-picks.web.app> and <https://lukes-picks.firebaseapp.com>; both HTTP 200 |
| Live bundle | `main.dart.js` SHA-256 `411062a988bf5b8d798b317f118b505966c0d80f9fd07a4f4f4e4762842a1ed6`, identical to preview |
| Live security headers | CSP; COOP `same-origin-allow-popups`; HSTS; `nosniff`; `SAMEORIGIN`; Permissions Policy; Referrer Policy; no preview `noindex` header |
| Production data recheck | Two active `America/Chicago` arenas remain `manual`; `systemConfig/espnCatalog` and `systemConfig/apiSportsCatalog` are absent |
| Firestore rollback input | Prior ruleset `projects/lukes-picks/rulesets/93614c6a-add3-47ad-88df-b9d9e18a00fb` |

The Functions CLI returned exit 1 only because it could not configure an
automatic cleanup policy after every Function deployment had succeeded. The
`gcf-artifacts` repository currently has no automatic cleanup policy. This is
an operational cost/retention warning, not a failed Function rollout.

App Check enforcement, production sports-data and logo rights, accessibility,
physical devices, legal approval, operational alerts, release signing, and
store publication remain separate production/store gates. The recorded dormant
web release does not satisfy or waive them, and it does not authorize future
provider activation or live Hosting writes.

## Release gates

Before any future provider activation, require all of the following on the
final reviewed tree. The dormant code release above does not satisfy these
activation gates:

1. The complete Flutter, Functions, rules, emulator, provider-fixture, secret,
   and fresh-build matrix passes on the reviewed tree or intended commit.
2. The three-user browser-to-emulator picker flow passes with picker
   participation disabled and enabled.
3. Connected startup uses `lukes-picks`, loads no demo state, and never connects
   a public build to emulators.
4. Mock and TheSportsDB test modes are server-rejected in `lukes-picks`. ESPN
   remains rejected unless the exact project, explicit default-false deploy
   parameter, enabled Admin-only document, and written-authorization gate pass.
5. Google Auth and authorized domains are verified.
6. Required Firebase APIs are enabled and `INVITE_CODE_PEPPER` exists without
   exposing its value. No ESPN credential or user-supplied provider URL is
   introduced.
7. Written ESPN/Disney authorization and legal/product approval are retained;
   all eight schedule/final/anomaly contracts and conservative request behavior
   are validated; and the reviewed `systemConfig/espnCatalog` document remains
   fail-closed for presentation.
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

For this candidate, creating or updating `systemConfig/espnCatalog` and setting
`ALLOW_ESPN_PROVIDER` are separate changes. Each requires written authorization,
its own reviewed target, explicit user authority, and an immediately adjacent
project guard. Do not combine provider activation with an otherwise routine
Functions or rules rollout. Never enter credentials or unrestricted provider
payloads into a command line, source file, Firestore document, log, screenshot,
or report.

## Allowed release commands

The wrapper accepts exactly four actions and no project override:

```bash
./scripts/release_firebase.sh rules-indexes
./scripts/release_firebase.sh functions
./scripts/release_firebase.sh preview
./scripts/release_firebase.sh hosting-live
```

They resolve to explicit commands targeting `--project lukes-picks`. The
preview action uses only channel `connected-picker-flow`; `hosting-live` can
only clone that fixed channel to the fixed `lukes-picks:live` channel. It cannot
upload independent bytes or accept a site/project override. The recorded clone
was separately authorized and does not authorize a future live update.

The wrapper:

- refuses unsupported actions;
- cannot accept the emulator or forbidden project;
- verifies gcloud and Firebase CLI use the same account;
- verifies project ID, display name, number, lifecycle state, and owner role;
- runs source/build scans before preview or live clone;
- places the identity guard immediately before the Firebase write.

Do not bypass the wrapper with `firebase use`, aliases, or a hand-written deploy
command.

## Recorded preview and live smoke — 2026-08-01

The preview returned HTTP 200, exposed the expected preview `noindex` header,
and served bundle SHA-256
`411062a988bf5b8d798b317f118b505966c0d80f9fd07a4f4f4e4762842a1ed6`,
identical to the scanned local release. The exact preview Hosting version
`b58df6678863654a` was then cloned to live. Both permanent URLs returned HTTP
200 and served that same digest. Live responses included Content Security
Policy, COOP `same-origin-allow-popups`, HSTS, `nosniff`, `SAMEORIGIN`,
Permissions Policy, and Referrer Policy, without the preview `noindex` header.

The full schedule/selection/review/pick/privacy/lock/reveal/result/finalization/
standings lifecycle passed in a real browser against isolated Firebase
emulators with three users and sanitized fixtures. That is application-flow
evidence, not an authenticated live-provider or production-data lifecycle.
Current live authenticated Google sign-in was not rerun, so it remains a manual
handoff check. The public site must remain manual-provider with neutral badges
until the external data and mark-rights gates pass.

## Rollback

Recorded rollback inputs include active ruleset
`projects/lukes-picks/rulesets/aa52ec56-c549-4e8e-880a-372474e4feeb`, prior
ruleset `projects/lukes-picks/rulesets/93614c6a-add3-47ad-88df-b9d9e18a00fb`,
five `READY` composite indexes, the 29-Function manifest, prior live Hosting
version `27fb98c01124200f`, current exact preview/live version
`b58df6678863654a`, both permanent URLs, and the bundle digest above.

- Hosting preview: let the preview channel expire by default. Deleting it is a
  destructive cloud action that requires explicit authorization.
- Live Hosting: any rollback or replacement is a separate cloud write requiring
  explicit authorization, a fresh project guard, and the exact reviewed
  artifact/source target. Do not infer rollback authority from this release
  record.
- Functions: redeploy only a specifically reviewed backward-compatible source
  revision. Never roll back by deleting Firestore documents.
- ESPN provider: first set `ALLOW_ESPN_PROVIDER=false`, return affected arenas
  to `manual`, and stop provider-backed preview promotion. Disable
  `systemConfig/espnCatalog` as defense in depth only through a separately
  authorized guarded write. Preserve normalized cache, historical week
  snapshots, picks, results, audits, and standings.
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
- enabling `ALLOW_ESPN_PROVIDER` or `systemConfig/espnCatalog.enabled` before
  written authorization, contract, schema, request-behavior, presentation, and
  runtime-project gates pass;
- creating a production provider catalog from guessed or stale league IDs,
  seasons, response shapes, or hosts;
- treating the lack of an ESPN credential as permission to automate access;
- deploying or promoting an artifact that claims ESPN-backed schedules while
  either technical gate remains closed;
- publishing Android or iOS store builds.
