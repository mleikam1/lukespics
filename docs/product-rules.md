# Product rules

This document is authoritative for the MVP.

## Weekly contest

- The arena uses explicit sequential weeks with UTC `startAt` and `endAt`
  timestamps and a league timezone (default `America/Chicago`).
- One weekly picker selects at least one game. There is no product-level maximum.
- Catalog candidates are not selected games. Members see only the picker’s
  exact published week snapshots.
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
- Saving the final required pick permanently seals the whole weekly entry.
  Exact retries are harmless, but no selection can be changed after completion.
- An offline choice is an unconfirmed local draft. Arrival after lock is
  rejected.

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
- Finalization advances the picker exactly once when manual finalization is
  complete.
- An authorized administrator creates the next sequential week and assigns the
  proposed rotated picker.
- Leaving/inactivation preserves historical results.
- An owner cannot leave or delete their account while still owning an active
  arena.

## Roles

- Owner: all league settings, role assignment, invites, members, rotation,
  overrides, reopening, and finalization.
- Commissioner: week/member/rotation/provider/manual result operations, but not
  ownership transfer/deletion.
- Member: own eligible picks and member-visible results.
- Weekly picker: a temporary week responsibility; can edit only the draft slate.

## Provider and team-mark rules

- Production uses manual schedules/results until a production provider passes
  coverage, quota, terms, and publication-rights review.
- Mock and TheSportsDB test schedules are emulator/internal-test-only.
- SportsDataIO automatic schedules/results are server-only and limited to NFL
  and MLB. They remain default-off until the exact feeds, intended display and
  grading use, key, access mode, and entitlement are verified.
- Trial/Dev data cannot grade real picks. Discovery access cannot be presented
  as real-time. Flutter never calls the provider directly.
- A known day with no confirmed UTC start remains time-TBD and cannot be
  selected or published; no synthetic kickoff or lock is allowed.
- Team marks require permitted rights and an allowlisted HTTPS host; otherwise
  the UI uses a neutral initials badge.

## Explicit exclusions

No odds, point spreads, confidence points, wagers, fees, payments, betting
language, chat, play-by-play, fantasy rosters, ads, subscriptions, or AI
predictions.
