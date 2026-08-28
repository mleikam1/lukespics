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

Rules/indexes, Functions, preview, and exact preview-to-live promotion use
`scripts/release_firebase.sh`; it has no project override. Its live action can
only clone the fixed `connected-picker-flow` preview to the fixed
`lukes-picks:live` channel. Immediately before a write it confirms the gcloud
and Firebase CLI accounts match, project identity is exact, lifecycle is
active, and the account is an owner. Separately authorized prerequisite writes,
such as enabling a reviewed API or setting `INVITE_CODE_PEPPER`, must run the
same project guard immediately before an explicit `lukes-picks` write.

The public source/build scans reject the forbidden Wingman project, emulator
markers, internal-test/provider markers, blocked third-party logo hosts, and
likely secrets. Runtime source permits the exact SportsDataIO API origin and
credential-header name only in the dedicated backend client; Flutter/web and
public artifacts must contain neither.

The SportsDataIO changes on this branch are not deployed or activated. Current
production arenas remain `manual`. No authenticated SportsDataIO request or
remote provider-mark publication is claimed.

## Firestore rules

Active membership gates league reads. Private user documents permit only the
owner and backend. Direct client mutation is denied for settings, members,
scores, outcomes, rankings, standings, audit logs, provider state, and rotation.
While a week is `draft`, its game documents are readable only by the assigned
picker and an active owner/commissioner; ordinary members can read them only
after the trusted backend moves the week out of draft. All week-game writes
remain server-only.

Clients cannot write pick documents directly. An eligible member submits a pick
through the callable, which writes only their own entry when:

1. membership is active;
2. the entry is eligible;
3. the week is open/in progress;
4. the game is selected;
5. `request.time` is before the effective per-game or first-game lock;
6. the selected ID equals one canonical team ID; and
7. the weekly entry has not already been completed and sealed.

Saving the last required pick sets the entry completion marker and permanently
seals every selection in the same transaction. An exact same-selection retry is
an idempotent no-op; a post-completion change is rejected. Firestore rules deny
all direct pick mutations so a client cannot bypass the counter or seal.

Commissioner status does not grant pre-lock access to another user’s private
pick. Reveal documents are backend-written and member-readable after reveal.

## Callable functions

Protected functions require Firebase Auth. Sensitive operations also require
owner/commissioner membership. Invite issuance and revocation are owner-only.
New clients explicitly request version-2 invite codes: deterministic,
eight-character uppercase bearer values drawn from a 32-character alphabet
that omits `0`, `1`, `I`, and `O`. Each value carries 40 bits, and issuance can
select from four deterministic HMAC-derived candidates inside the same
transaction if a lookup mapping is already occupied. Cached clients that omit
the version continue to receive the original version-1 144-bit, 24-character
value, and every previously issued version-1 link remains valid. The raw code
is returned to the owner but is never stored or logged.

Modern links expire after 14 days or 50 successful joins by default, and the
first modern issuance atomically retires the legacy singleton invite. New
eight-character input is case-insensitive and canonicalized to uppercase;
compatible 16- to 64-character legacy input remains exact-case. Join requires
Firebase Auth, uses hashed lookup, permits no more than five attempts per
15-minute window for one authenticated user and 20 attempts for one
privacy-safe network key, returns generic invalid or expired failures, and
enforces one active arena per user. The separate network allowance lets the
intended ten-person group join from one household or shared Wi-Fi while the
per-account guessing limit remains strict. Same-arena retries remain idempotent
even after the final permitted use. Provider refreshes use role checks and
quota guards.

Shared web links put the bearer value in the URL fragment rather than the query
string so Firebase Hosting requests and HTTP referrers do not receive it. The
router preserves a validated fragment through sign-in and removes it after a
successful join. Fragment values can remain in browser history, so analytics
must continue to exclude URLs and invite values.

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

CBS narrows that contract further: the server-owned active season/type/week is
the only identity advertised to Flutter or eligible for network access. The
callables reject a mismatched identity, every redirect must preserve the exact
constructed route, and the returned page must confirm the same canonical/title
identity.

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

SportsDataIO is a separate replaceable provider and requires all of the
following:

- non-emulator runtime project exactly `lukes-picks`;
- deploy-time `ALLOW_SPORTSDATAIO_PROVIDER=true`, default `false`;
- environment `SPORTSDATAIO_ACCESS_MODE=production`;
- environment `SPORTSDATAIO_ENTITLEMENT_VERIFIED=true`;
- an enabled, valid `systemConfig/sportsDataIoCatalog` with matching production
  mode, bounded entitlement review metadata, and verified NFL/MLB feed flags;
- a non-empty `SPORTSDATAIO_API_KEY` Secret Manager value bound only to the four
  provider-bearing entry points in a future, separately authorized
  SportsDataIO deployment (the CBS release carries no such binding); and
- the existing authorization, cache, soft-budget, timeout, retry, lease,
  stale-data, and circuit-breaker controls.

Each gate is independent. Trial/Dev data cannot drive production display or
grading; Discovery access is delayed and cannot be represented as real-time.
No secret or contract contents belong in Firestore.

## Secrets

The deployed dormant-provider release binds `INVITE_CODE_PEPPER`, which is
required for production invite-code hashing.

The SportsDataIO key is declared with `defineSecret` and injected only into the
catalog, two selected-game refresh, and scheduled-result-sync Functions. The
dedicated client sends it only in the `Ocp-Apim-Subscription-Key` header. It is
never accepted from a caller, appended to a URL, returned, or logged.

The dormant API-Sports adapter remains replaceable-provider code, but no
`API_SPORTS_KEY` declaration, binding, or approved value is present. A future
activation must add an explicit Secret Manager binding as a separately reviewed
change.

`COLLEGE_FOOTBALL_DATA_KEY` remains a future name only and is not declared or
bound. Emulator-only defaults and sanitized fixtures are not production
authorization substitutes.

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

Remote marks require HTTPS, an exact reviewed host policy, and confirmed use
rights. SportsDataIO and API-Sports presentation default to
`allowRemoteLogos=false`. SportsDataIO's public team schemas do not establish
image rights for this account, so its adapter ignores logo/wordmark and color
fields and returns neutral badges. Provider normalization strips unapproved
URLs, and the Flutter policy independently requires the response
provider to match the game and rechecks HTTPS/host/query restrictions. Do not
store credential-bearing image query strings or log image URLs. Missing,
broken, mismatched, or unapproved images fall back to a neutral initials badge.
At slate publication, Functions persist only that safe policy metadata and its
provider identity on the server-owned week document. Ordinary members consume
the immutable snapshot through their existing week read permission; they do
not receive catalog authorization, provider configuration, endpoints, or a
secret. Legacy or mismatched snapshots stay disabled. Because a publish-time
snapshot does not inherit future policy revocation, an approved revocation must
include a trusted update of affected published week snapshots.
