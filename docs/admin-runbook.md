# Commissioner runbook

This is the intended operating contract. It is not evidence that every action
is currently surfaced or browser-validated. Track observed readiness in
[validation-report.md](validation-report.md) and the full state model in
[connected-weekly-picker.md](connected-weekly-picker.md).

## Weekly operation

1. Confirm the next sequential draft, boundaries, timezone, and designated
   picker.
2. Confirm production provider mode is `manual` until SportsDataIO's exact NFL
   and MLB feeds, intended display/grading use, API key, access mode, entitlement
   verification, configuration, and authorized deployment have all passed.
   Remote team-mark rights are an independent review.
3. Picker queries the catalog or enters a trustworthy manual game, selects at
   least one game, removes unwanted games, and reviews the exact saved set.
4. Publish once; participant and picker-participation settings are snapshotted.
5. Monitor completion counts, never private pre-lock team choices.
6. Refresh results only when cache/quota health permits. Use the one-game force
   refresh for diagnosis; do not repeatedly refresh an entire slate.
7. Resolve `reviewRequired`, delayed, postponed, suspended, rescheduled, or
   canceled games. A commissioner may correct a start time without widening a
   published pick lock, correct a final score/winner, or void a game. Every
   override requires a confirmation and reason and writes before/after audit
   data. A corrected start may cross the arena week boundary but must remain
   within the inclusive 366-day window on either side of the immutable
   published start. It can tighten an existing lock but never reopen picks.
8. When every game is final or void, review provisional scores and finalize.
9. Confirm winner/co-winners, standings, and exactly one rotation advance.
10. Create the next sequential week and assign the proposed rotated picker.

The picker may not silently edit a published slate. A member’s local/offline
choice is not accepted until the server confirms it before lock.

## Provider delay

Do not repeatedly force refresh. Inspect cache age, last success/failure, quota
remaining, and breaker state. Continue with cached schedules. Create/grade a
manual game only from a trustworthy result source and record the source/reason
in the audit event.

## Corrections

Reopen a finalized week with a required reason, update/void the affected game,
run the explicit provisional regrade, inspect the new result version, rebuild
standings, and finalize again. Repeating the same calculation version is a
no-op. Reopening a finalized week is a correction workflow; a published draft
slate is not reopened for ordinary picker edits.

## Recovery

- `Recalculate week`: full authoritative entry recomputation
- `Rebuild standings`: full aggregate recomputation from finalized weeks
- `Rotate invite code`: invalidates the old join lookup
- Member deactivation: preserves history and skips future rotation

Never modify score or standing documents manually in production.

## Membership and ownership

Deactivating or removing a member preserves finalized history and skips them in
future rotation. An owner cannot leave or delete their account while they own
an active arena. Ownership transfer is not available in this release; do not
work around the server-authoritative guard with direct Firestore edits.

## Privacy incident check

Owners and commissioners can inspect completion counts and post-lock reveals,
not private pre-lock picks. If a client, rule, log, or export exposes a pre-lock
choice, stop the release, preserve evidence without copying the pick value into
chat or tickets, and investigate the authorization boundary.
