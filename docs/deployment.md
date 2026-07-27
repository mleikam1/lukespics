# Deployment

## Safety gates

Deployment is blocked until an owner identifies an unambiguous Luke’s Picks
Firebase/GCP project. Once identified:

1. Inspect existing resources/data and confirm additive compatibility.
2. Verify tests and web/mobile builds.
3. Verify billing already exists if Functions require it; do not add billing.
4. Configure server secrets and Google Auth.
5. Deploy a Hosting preview channel.
6. Smoke-test bootstrap, routes, sign-in, create/join, dashboard, schedule,
   saving/rejection, and responsive layouts.
7. Deploy rules/indexes, then Functions, then Hosting.
8. Verify the live URL and logs.
9. Keep App Check unenforced until valid platform tokens are observed.

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
of scope.

## Rollback

Hosting can roll back to a prior release. Function releases should remain
backward-compatible with stored documents. Rules changes require emulator tests
and a reviewed rollback version. Never delete production documents to roll back.
