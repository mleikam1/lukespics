# Changelog

## Unreleased — 2026-08-27

- Added owner-created, expiring arena invitation links with independent
  revocation, bounded use, secure hashed storage, and retry-safe issuance.
- Added mobile/web platform sharing so owners can send an invitation through
  Messages or another installed app, with a clipboard fallback.
- Added invitation deep links that survive Google sign-in, prefill the exact
  case-sensitive code, require confirmation, and scrub the code after joining.
- Enforced one active arena per user and kept join retries idempotent at the
  invite use limit.

## 1.0.0-mvp — 2026-07-27

- Added the responsive Luke’s Picks Flutter experience for web, iOS, and Android.
- Added mock/demo operation with a complete weekly pick’em journey.
- Added typed game, member, week, pick, entry, and standings models.
- Added one-point scoring, void handling, co-winners, picker eligibility,
  monotonic locking, rotation, corrections, and full standings rebuilds.
- Added Firebase Functions, Firestore rules/indexes, emulator seeds, and tests.
- Added server-side provider abstraction, cache, quota guard, refresh lock, and
  API-Sports integration boundary.
- Added original brand assets, legal starter pages, CI, and operating docs.
