# Security model

## Principles

- Deny by default.
- Authenticate and authorize every protected callable on the server.
- Do not trust role, points, time, outcome, or eligibility supplied by a client.
- Keep provider keys and invite hashing on the server.
- Separate private picks from post-lock reveal documents.
- Log safe identifiers and error codes, never emails, tokens, invite codes,
  secrets, or raw provider payloads.
- Fail closed on Firebase project identity and runtime mode.
- Treat sports-provider and logo permissions as server-side release gates.

## Project isolation

The only cloud project is `lukes-picks` (`271408880910`). Production bootstrap
must reject another project. Emulator bootstrap must reject anything other than
`demo-lukes-picks-local`.

Rules/indexes, Functions, and Hosting-preview deployments use
`scripts/release_firebase.sh`; it has no project override and no live Hosting
action. Immediately before deploying it confirms the gcloud and Firebase CLI
accounts match, project identity is exact, lifecycle is active, and the account
is an owner. Separately authorized prerequisite writes, such as enabling a
reviewed API or setting `INVITE_CODE_PEPPER`, must run the same project guard
immediately before an explicit `lukes-picks` write.

The public source/build scans reject the forbidden Wingman project, emulator
markers, ESPN hosts, internal-test-provider markers, and likely secrets from a
public release.

The live-catalog source candidate has not been deployed. Its Functions manifest
references `API_SPORTS_KEY`, which does not currently have an approved Secret
Manager value, so no Functions, preview, or live release of that candidate is
authorized or claimed.

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

Catalog/provider calls that consume quota require the designated picker or an
administrator. Catalog access is limited to a draft week. The backend derives
membership, role, picker identity, eligibility, selected-game membership, lock
time, results, points, and server timestamps; none are trusted from Flutter.

Flutter may submit a server-discovered sport, league, provider league ID,
season, and date window, but Functions re-resolve that identity against the
provider's server-owned catalog. The arena's stored IANA timezone is
authoritative. Both catalog dates must be present together, the inclusive range
cannot exceed seven days, and it must remain inside the active week. Provider
base URLs, request paths, final-status lists, and presentation policy are never
accepted from the client.

Mock and TheSportsDB test providers must be rejected in `lukes-picks`.
TheSportsDB test access is allowed only with its explicit flag plus an
emulator/internal condition. API-Sports requires all of the following:

- non-emulator runtime project exactly `lukes-picks`;
- deploy-time `ALLOW_API_SPORTS_PROVIDER=true`, whose default is `false`;
- an approved `API_SPORTS_KEY` secret value;
- a matching validated entry in the server-only
  `systemConfig/apiSportsCatalog` document; and
- the existing authorization, cache, quota, timeout, retry, and circuit-breaker
  controls.

The boolean flag, secret binding, and catalog document are independent gates;
one cannot substitute for another.

## Secrets

The previously deployed manual-provider release binds
`INVITE_CODE_PEPPER`, which is required for production invite-code hashing.

The current source candidate additionally declares `API_SPORTS_KEY` with
`defineSecret` and binds it only to provider-bearing Functions:

- `listSportsCatalog`;
- `refreshSelectedGames`;
- `syncSelectedGameResults`; and
- `scheduledResultSync`.

Unrelated account, membership, slate, pick, scoring, and administration
Functions do not receive the provider secret. `COLLEGE_FOOTBALL_DATA_KEY`
remains a future name only and is not declared or bound. The approved
`API_SPORTS_KEY` value is currently absent, making the candidate Functions
deployment a release blocker. Emulator-only defaults and sanitized fixtures are
not production secret substitutes.

No service-account file is needed in source control. Local emulator credentials
use the Firebase emulators and ignored files.

Generated Firebase client API keys identify public apps and are not server
credentials. They do not authorize Firestore or Functions access; Auth, rules,
App Check, and server authorization remain mandatory.

## Account deletion

Deletion removes or anonymizes private identity and photo data, revokes active
membership, and substitutes an anonymous historical display label when removing
the historical record would corrupt finalized competition results.

An active owner cannot leave an arena or delete their account in this release.
Ownership transfer remains deferred, and a client-only confirmation cannot
bypass the server-authoritative prevention.

## Team marks

Remote marks require HTTPS, a reviewed host allowlist, and confirmed use rights.
API-Sports presentation defaults to `allowRemoteLogos=false`; enabling it also
requires a rights-review date and exact permitted query-parameter names in the
server-owned catalog. Provider normalization strips unapproved URLs, and the
Flutter policy independently requires the response provider to match the game,
rechecks HTTPS/host/query restrictions, and permanently denies ESPN hosts. Do
not store credential-bearing image query strings or log image URLs. Missing,
broken, mismatched, or unapproved images fall back to a neutral initials badge.
At slate publication, Functions persist only that safe policy metadata and its
provider identity on the server-owned week document. Ordinary members consume
the immutable snapshot through their existing week read permission; they do
not receive catalog authorization, provider configuration, endpoints, or a
secret. Legacy or mismatched snapshots stay disabled. Because a publish-time
snapshot does not inherit future policy revocation, an approved revocation must
include a trusted update of affected published week snapshots.
