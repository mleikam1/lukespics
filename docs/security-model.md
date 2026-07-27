# Security model

## Principles

- Deny by default.
- Authenticate and authorize every protected callable on the server.
- Do not trust role, points, time, outcome, or eligibility supplied by a client.
- Keep provider keys and invite hashing on the server.
- Separate private picks from post-lock reveal documents.
- Log safe identifiers and error codes, never emails, tokens, invite codes,
  secrets, or raw provider payloads.

## Firestore rules

Active membership gates league reads. Private user documents permit only the
owner and backend. Direct client mutation is denied for settings, members,
scores, outcomes, rankings, standings, audit logs, provider state, and rotation.

An eligible member may create/update only their own pick when:

1. membership is active;
2. the entry is eligible;
3. the week is open/in progress;
4. the game is selected;
5. `request.time` is before the effective per-game or first-game lock;
6. the selected ID equals one canonical team ID; and
7. only client-owned selection/timestamp fields change.

Commissioner status does not grant pre-lock access to another user’s private
pick. Reveal documents are backend-written and member-readable after reveal.

## Callable functions

Protected functions require Firebase Auth. Sensitive operations also require
owner/commissioner membership. Join attempts use hashed lookup, input
normalization, per-identity/IP-safe throttling where available, and generic
failure messages. Provider refreshes use role checks and quota guards.

App Check support is built in but hard enforcement must be staged after valid
tokens are observed for each platform.

## Secrets

Only secret names are documented:

- `API_SPORTS_KEY`
- `COLLEGE_FOOTBALL_DATA_KEY`
- `INVITE_CODE_PEPPER`

No service-account file is needed in source control. Local emulator credentials
use the Firebase emulators and ignored files.

## Account deletion

Deletion removes or anonymizes private identity and photo data, revokes active
membership, and substitutes an anonymous historical display label when removing
the historical record would corrupt finalized competition results.
