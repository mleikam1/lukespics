# Deployment

## Safety gates

Deployment is blocked until an owner identifies an unambiguous Luke’s Picks
Firebase/GCP project. No Hosting site, Function, Firestore rule/index, Auth
provider, secret, or other cloud resource was modified during implementation.

Project identification alone does not make the current client production-ready.
The connected Flutter repository and live routes must first close the gaps in
[validation-report.md](validation-report.md). Once those gates are complete:

1. Inspect existing resources/data and confirm additive compatibility.
2. Add connected browser-to-emulator coverage, surface required next-week
   administration, and fix picker-participation behavior.
3. Verify tests, responsive visual QA, and web/mobile builds.
4. Review npm dependency advisories without forcing incompatible upgrades.
5. Verify billing already exists if Functions require it; do not add billing.
6. Configure server secrets and Google Auth. `INVITE_CODE_PEPPER` is mandatory
   for production; configure `API_SPORTS_KEY` only when enabling API-Sports.
7. Deploy a Hosting preview channel.
8. Smoke-test bootstrap, routes, sign-in, create/join, dashboard, schedule,
   saving/rejection, and responsive layouts.
9. Deploy rules/indexes, then Functions, then Hosting.
10. Verify the live URL and logs.
11. Keep App Check unenforced until valid platform tokens are observed.

## Commands

```bash
flutter build web --release
firebase hosting:channel:deploy mvp-review \
  --project YOUR_AUTHORIZED_PROJECT_ID
firebase deploy --only firestore:rules,firestore:indexes \
  --project YOUR_AUTHORIZED_PROJECT_ID
firebase deploy --only functions --project YOUR_AUTHORIZED_PROJECT_ID
firebase deploy --only hosting --project YOUR_AUTHORIZED_PROJECT_ID
```

There is no automatic production deploy in CI. Mobile store submission is out
of scope. The checked-in `demo-lukes-picks-local` alias is reserved for
emulators and must never be used as a cloud deployment target.

## Rollback

Hosting can roll back to a prior release. Function releases should remain
backward-compatible with stored documents. Rules changes require emulator tests
and a reviewed rollback version. Never delete production documents to roll back.
