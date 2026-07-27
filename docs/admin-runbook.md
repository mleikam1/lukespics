# Commissioner runbook

## Weekly operation

1. Confirm the draft week boundaries and designated picker.
2. Picker selects at least one game and reviews lock/participation snapshots.
3. Publish the slate; members receive the open pick experience.
4. Monitor completion counts, not private team choices.
5. Refresh results only when cache/quota health permits.
6. Resolve `reviewRequired`, postponed, or suspended games. Manual overrides
   require a reason.
7. When every game is final or void, review provisional scores and finalize.
8. Confirm winner/co-winners, aggregate standings, and next active picker.

## Provider delay

Do not repeatedly force refresh. Inspect cache age, last success/failure, quota
remaining, and breaker state. Continue with cached schedules. Create/grade a
manual game only from a trustworthy result source and record the source/reason
in the audit event.

## Corrections

Reopen a finalized week with a required reason, update/void the affected game,
run recalculation, inspect the new result version, rebuild standings, and
finalize again. Repeating the same calculation version is a no-op.

## Recovery

- `Recalculate week`: full authoritative entry recomputation
- `Rebuild standings`: full aggregate recomputation from finalized weeks
- `Rotate invite code`: invalidates the old join lookup
- Member deactivation: preserves history and skips future rotation

Never modify score or standing documents manually in production.
