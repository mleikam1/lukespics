# Product rules

This document is authoritative for the MVP.

## Weekly contest

- The arena uses explicit sequential weeks with UTC `startAt` and `endAt`
  timestamps and a league timezone (default `America/Chicago`).
- One weekly picker selects at least one game. There is no product-level maximum.
- The picker is ineligible to make winner picks by default. The
  `pickerParticipatesInPicks` league setting can opt them in; the value is
  snapshotted on publication.
- Eligible participants select exactly one team per selected game.
- Each correct pick is one point. Incorrect and locked-missing picks are zero
  points and count as incorrect. Void/cancelled games are excluded from all
  accuracy denominators.
- Per-game lock is the default. Optional first-game lock closes the entire slate
  at the earliest game lock.
- Server time is authoritative. A lock cannot move later after the game locked
  or picks were revealed.
- Picks are private before each game lock. Completion state is visible, choices
  are not. A server-generated reveal is readable by members after lock.

## Results and ranking

- Completed games use the provider winner, including overtime.
- A true tie without a winner becomes `reviewRequired` and defaults to void after
  commissioner review.
- Postponed/suspended games remain pending. They are never silently incorrect.
- Weekly high score wins. Exact high-score ties create co-winners; no MVP
  tiebreaker exists.
- Overall rank sorts total points descending, then accuracy, then weekly titles.
  Equal competitive metrics share a rank; display name is never a tiebreaker.
- Accuracy is total correct divided by total non-void graded picks. No graded
  picks display an em dash.
- Finalization recomputes the whole week and standings from authoritative data.
  It is idempotent. Corrections increment result versions and trigger rebuilds.

## Rotation and membership

- Rotation is explicitly ordered and skips inactive members.
- New members append to the end and normally become eligible the next week if
  the current slate is already published.
- Finalization advances the picker only when manual finalization is complete.
- Leaving/inactivation preserves historical results.

## Roles

- Owner: all league settings, role assignment, invites, members, rotation,
  overrides, reopening, and finalization.
- Commissioner: week/member/rotation/provider/manual result operations, but not
  ownership transfer/deletion.
- Member: own eligible picks and member-visible results.
- Weekly picker: a temporary week responsibility; can edit only the draft slate.

## Explicit exclusions

No odds, point spreads, confidence points, wagers, fees, payments, betting
language, chat, play-by-play, fantasy rosters, ads, subscriptions, or AI
predictions.
