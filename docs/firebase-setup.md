# Firebase setup

## Authorized project

The only authorized cloud project is:

- ID: `lukes-picks`
- display name: `Lukes-picks`
- number: `271408880910`
- owner account observed on 2026-07-30: `matthewleikam@gmail.com`
- Firestore: `(default)`, Native mode, `us-central1`

Billing was observed enabled. Do not change billing, payment methods, Firestore
location, DNS, IAM, or existing data as part of routine setup.

The project has registered:

- web: `1:271408880910:web:b7e8b5aa9d2cbc1314cb5f`;
- Android: `1:271408880910:android:a99dd01fb4d5bb8114cb5f`, package
  `com.mleikam.lukespics`;
- iOS: `1:271408880910:ios:dd22577f5d50ef1f14cb5f`, bundle
  `com.mleikam.lukespics`.

`lib/firebase_options.dart` is the single Flutter initialization source; do not
add a JavaScript initialization to `web/index.html`.

## Isolation

`.firebaserc` must remain exactly:

- `default -> demo-lukes-picks-local`
- `prod -> lukes-picks`

The default alias is deliberately emulator-only. It must never receive a cloud
deployment. Never target `wingman-interactive-live`.

Before every cloud write:

```bash
./scripts/assert_firebase_project.sh lukes-picks
```

For rules/indexes, Functions, and Hosting-preview deployments use
`scripts/release_firebase.sh`, which runs that guard immediately before an
explicit `--project lukes-picks` command. API enablement and secret setup are
separate prerequisite writes and must run the same guard immediately before
their own explicitly targeted commands.

## Historical pre-release cloud snapshot

At the 2026-07-30 read-only audit:

- Firebase apps and the Hosting site existed.
- Firestore existed, but no cloud composite indexes were listed.
- the only Hosting channel listed was `live`; its URL returned 404;
- no connected preview channel was present;
- Secret Manager was enabled but contained no secrets. Cloud Functions, Cloud
  Run, Artifact Registry, Cloud Build, Eventarc, and Cloud Scheduler remained
  disabled or not listed.
- Google sign-in was enabled after the audit. Deployed rules still require an
  explicit release comparison.

That snapshot is retained for provenance and was superseded by the guarded
2026-08-01 release record below. Do not use it as the current cloud state.

## Guarded cloud deployment record — 2026-08-01

| Item | Status |
|---|---|
| Required API enablement | Completed for the reviewed 29-Function manifest |
| `INVITE_CODE_PEPPER` | Secret Manager version 1 created; value never recorded |
| Rules | Active ruleset `projects/lukes-picks/rulesets/aa52ec56-c549-4e8e-880a-372474e4feeb` |
| Rules rollback | Prior ruleset `projects/lukes-picks/rulesets/93614c6a-add3-47ad-88df-b9d9e18a00fb` |
| Indexes | Five composite indexes, all `READY` |
| 29-function deployment | All 29 `ACTIVE` and Cloud Run ready |
| Scheduled Function | `scheduledResultSync`, every 30 minutes UTC |
| Unexpected deletion review | Completed; no unexpected deletion |
| `connected-picker-flow` preview | <https://lukes-picks--connected-picker-flow-wfrwr4gp.web.app> |
| Preview expiry | Firebase output: `2026-08-08 13:52:18 UTC` |
| Hosting version | Preview/live both `b58df6678863654a` |
| Preview bundle | `main.dart.js` SHA-256 `411062a988bf5b8d798b317f118b505966c0d80f9fd07a4f4f4e4762842a1ed6` |
| Browser lifecycle | Three-user schedule-to-standings flow passed against Firebase emulators and sanitized fixtures |
| Live promotion | Exact preview channel cloned to `lukes-picks:live` at `2026-08-01T13:52:56.156Z` |
| Permanent live URLs | <https://lukes-picks.web.app> and <https://lukes-picks.firebaseapp.com>; both HTTP 200 |
| Live bundle | Preview-identical SHA-256 `411062a988bf5b8d798b317f118b505966c0d80f9fd07a4f4f4e4762842a1ed6` |
| Live response verification | CSP, COOP `same-origin-allow-popups`, HSTS, `nosniff`, `SAMEORIGIN`, Permissions Policy, and Referrer Policy present; no preview `noindex` header |
| Current live smoke boundary | HTTP, security headers, and exact bundle identity verified; current browser/authenticated lifecycle not rerun |

The exact preview artifact was promoted to live as recorded above. Both
provider deploy flags remained false, both arenas remained manual, and neither
provider activation document existed after release. The
Functions CLI returned exit 1 solely for its post-deployment cleanup-policy
prompt after all 29 Functions had deployed successfully. Artifact Registry
repository `gcf-artifacts` has no automatic cleanup policy; that retention/cost
warning should be handled separately and must not be “fixed” by deleting
unreviewed images.

## Current production release — 2026-08-27

The exact project guard passed for `lukes-picks` (`271408880910`) before each
cloud write. Commit `9ed851575918ff5f499cafc93915e4edff077e37` passed both CI
jobs in <https://github.com/mleikam1/lukespics/actions/runs/33134634949>.
Firestore Rules and all five composite indexes deployed, all 34 Functions are
`ACTIVE` on Node 22, and the new owner-only `issueArenaInvite` and
`revokeArenaInvite` Functions are active.

The fixed preview and live channels both reference finalized Hosting version
`4b9185befb59b39b`. Live was promoted at `2026-08-28T02:10:30.514Z`, returns
HTTP 200, and serves `main.dart.js` SHA-256
`c931e4b2abb6f09462074db5714371df583acaf6ace758ad753f7d227343cd44`,
exactly matching the scanned local build and preview. The Functions command's
only nonzero condition was the existing optional Artifact Registry cleanup-
policy prompt after all Functions had deployed; independent readback confirmed
all 34 active revisions. No cleanup policy was created and no images were
deleted.

The private CBS cache remained parser 1.2.0 with 99 scheduled Week 1 games and
zero TBD games after its successful automatic refresh at
`2026-08-28T01:24:19.701Z`. A read-only post-promotion check also found the
existing completed entry retained scheduled games. No production invitation,
slate, entry, or pick was created or changed during verification.

## Authentication and platform status

Google sign-in is enabled with the Luke’s Picks public name and configured
support email. Authorized domains include both `lukes-picks.web.app` and
`lukes-picks.firebaseapp.com`, the Google provider is enabled/configured, and
the auth handlers return HTTP 200. On the immediately preceding
`0adbfa2f2e38a95e310551a58e2e383906f1f8db` live artifact, a fresh production
tab restored the authenticated session and arena membership without opening a
Google prompt; it also showed the completed entry's local times and locked
choices. After the invitation promotion, the local Mac was locked, so a second
authenticated visual pass was not possible. The exact new live bytes and
read-only server state were verified, but the post-promotion owner invitation
screen is not claimed as a direct production browser observation.

The Android debug SHA-1 is registered. The Firebase app IDs and native
package/bundle identifiers match the checked-in Flutter configuration. Add only
known Android SHA-1/SHA-256 fingerprints, do not replace signing material, and
continue to verify the iOS URL scheme and physical-device authentication during
a separate store-readiness review.

The web-preview checks are not evidence of Android/iOS physical-device behavior,
release signing, or store readiness.

## Secrets and APIs

`INVITE_CODE_PEPPER` is required outside emulators. Secret Manager version 1
was created for `lukes-picks`; only the secret name and version are recorded.
Never print, retrieve into documentation, or commit the value.

`API_SPORTS_KEY` must not be created, guessed, or set unless an existing
authorized key and production plan are supplied. API-Sports remains disabled
until its full gate passes. TheSportsDB test mode does not use production
Secret Manager and must be rejected by `lukes-picks`.

SportsDataIO requires the `SPORTSDATAIO_API_KEY` Secret Manager secret, but the
CBS production release neither creates nor binds it. Only after entitlement and
a separately authorized SportsDataIO activation, add the narrow Function
bindings, run the exact project guard immediately before the interactive secret
command, and redeploy those reviewed Functions:

```bash
./scripts/assert_firebase_project.sh lukes-picks
firebase functions:secrets:set SPORTSDATAIO_API_KEY --project lukes-picks
```

Do not put the value on the command line or record terminal input/output. A
future activation may bind the secret only to the catalog, two result-refresh,
and scheduled-sync Functions. Rotation creates a new version; retain the
previous version until a guarded Functions deployment and smoke verification
succeed.

Activation separately requires `ALLOW_SPORTSDATAIO_PROVIDER=true`, both
environment and catalog access mode `production`, both entitlement-verification
gates true, and an enabled Admin-only `systemConfig/sportsDataIoCatalog` with
reviewed NFL/MLB seasons and feed flags. Store only bounded entitlement review
metadata in Firestore, not a key or contract contents.

The CBS release deliberately keeps the unprovisioned SportsDataIO binding out of
its manifest. No unavailable SportsDataIO, API-Sports, or CFBD secret is a CBS
deployment requirement.

Enabling required Google APIs is a cloud mutation. The APIs needed by the
reviewed manifest were enabled under the guarded `lukes-picks` release; all 29
Functions are active/Cloud Run ready and `scheduledResultSync` is enabled every
30 minutes UTC. For future changes, confirm the exact target and enabled billing
again, record the action without secret values, and enable only APIs required by
the reviewed manifest.

## App Check rollout

- Web: reCAPTCHA Enterprise provider.
- Android: Play Integrity; debug provider only for local development.
- iOS: App Attest with supported fallback; debug provider only locally.

First send and observe valid tokens on all platforms. Enforce only after
monitoring proves legitimate traffic will not be locked out. App Check does not
replace Firebase Auth or server authorization.

## Emulator isolation

Ports are declared in `firebase.json`. Use:

```bash
firebase emulators:start \
  --project demo-lukes-picks-local \
  --only auth,firestore,functions,hosting
```

The seed script requires both a `demo-*` project ID and an emulator host. Never
use `firebase deploy` with the emulator project.
