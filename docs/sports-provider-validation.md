# Sports provider validation

## ESPN Site API candidate — default-off

Research date: 2026-08-01.

The deployed code isolates the ESPN Site API v2 scoreboard behind the
server-side provider interface, but the adapter is not production-enabled. On
2026-08-01 every deployed Function had `ALLOW_ESPN_PROVIDER=false`, both arenas
remained `manual`, and `systemConfig/espnCatalog` was absent. No live ESPN
request was made. The reference documentation describes these endpoints as
unofficial and unsupported, says they may change without notice, and reports no
official rate limit. There is no SLA, stability commitment, commercial license,
or logo license associated with unauthenticated technical access.

The applicable Disney terms also restrict commercial/business use and access,
copying, or extraction by automated means for data mining or compiling a data
collection/database without express written permission. This repository does
not interpret a technically public response as that permission. Before any
production activation, retain written ESPN/Disney authorization that expressly
covers the intended schedule/result requests, cache, normalized Firestore
storage, historical snapshots, and commercial distribution, then record legal
and product approval. Logo use is a separate rights decision.

The only implemented route is:

```text
GET https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard
    ?dates=YYYYMMDD[-YYYYMMDD]&{allowlistedLeagueParameters}
```

No Flutter code constructs this URL or parses ESPN JSON. The server accepts a
centralized league identity and date, constructs the URL itself, validates the
response defensively, and returns only the normalized Luke's Picks contract.
It is not an open proxy and does not scrape HTML.

### Centralized league configuration

The static server catalog is the authority for these eight entries:

| Internal league | ESPN sport/league slugs | Extra query parameters | Ties possible |
|---|---|---|---|
| NFL | `football/nfl` | `limit=100` | Yes |
| MLB | `baseball/mlb` | `limit=100` | No |
| NBA | `basketball/nba` | `limit=100` | No |
| NHL | `hockey/nhl` | `limit=100` | No |
| WNBA | `basketball/wnba` | `limit=100` | No |
| NCAA football | `football/college-football` | `groups=80`, `limit=500` | No |
| NCAA men's basketball | `basketball/mens-college-basketball` | `groups=50`, `limit=500` | No |
| NCAA women's basketball | `basketball/womens-college-basketball` | `groups=50`, `limit=500` | No |

All use date-based scoreboard discovery. League strings, groups, limits, tie
policy, enabled defaults, and fallback icon policy must be changed in this one
server catalog and its tests—not in Flutter. A terminal tied response for a
league configured without ties is anomalous and remains `reviewRequired`; it
never produces a guessed winner.

### Runtime, cache, and schema gates

`ALLOW_ESPN_PROVIDER` defaults to `false`, applies only to the exact
`lukes-picks` production runtime, and is insufficient by itself. Trusted code
also requires `systemConfig/espnCatalog.enabled == true`. The document is
Admin-only, requires bounded `authorizationReference` and ISO
`authorizationReviewedAt` metadata identifying the retained approval record,
and owns fail-closed presentation/logo policy. No secret or legal-document body
belongs in Firestore. A missing or malformed document keeps the adapter
unavailable. Both activation gates remain closed until the written-authorization
gate above passes.

Schedule reads are cache-first and protected by the shared lease, throttling,
timeout, retry, and circuit-breaker boundary. Valid empty ESPN responses cache
for 30 minutes. ESPN live games cache for 10 minutes; games within two hours of
start for 15 minutes; games two to 24 hours out for 30 minutes; farther games
for one hour; and unresolved anomaly states for one hour. Terminal catalog data is
retained long-term, while selected terminal games reconcile after 12 hours. A
bounded refresh failure may return an existing stale cache with an explicit
stale/delayed indicator.
The scheduled result sync runs every 30 minutes and refreshes only active
selected games; a distributed lock prevents overlapping provider work.
Selected ESPN events are looked up over an inclusive seven-day window from one
arena-local day before through five days after their stored date. Later moves
outside that deliberately bounded discovery window require an audited
commissioner start-time correction or void.
Adjacent selected-date groups may produce overlapping bounded windows. This is
a documented request-efficiency limitation, not an authorization bypass: every
window stays within the reviewed seven-day maximum, shared leases/cache reduce
duplicates, and the soft request budget still applies.

The adapter allows at most three accounted attempts per scoreboard load, uses
an eight-second default timeout capped at 15 seconds, rejects redirects and
responses above 10 MB, and reserves retry budget before retrying. The internal
`ESPN_SOFT_DAILY_LIMIT` defaults to 500 attempts and is configuration-capped at
20,000. That is a Luke's Picks safety budget, not a claim about an ESPN limit;
the external documentation publishes no official rate limit.

Every ESPN event is parsed independently. Missing or malformed nested data must
not fail the whole schedule: invalid events are skipped with a structured safe
reason, unknown statuses normalize conservatively, and full payloads are not
logged or copied to clients. Canonical IDs are
`espn:{sportCode}:{eventId}`. The event ID distinguishes doubleheaders and
reschedules. Week games snapshot the normalized fields so provider downtime or
later schema changes cannot erase a submitted slate.

### Manual activation gate

Before changing either technical gate:

1. retain written authorization and complete legal/product and separate
   team-mark rights review;
2. validate all eight live contracts without storing unrestricted payloads;
3. capture sanitized fixtures for missing fields, status variants, ties,
   doubleheaders, delays, postponements, cancellations, and finals;
4. run the full Flutter, Functions, rules, emulator, browser, and source/build
   scan matrix on the reviewed tree;
5. inspect and guard the exact `lukes-picks` project immediately before each
   separately authorized configuration or deployment write; and
6. deploy to a preview first, verify cache/sync/manual-fallback behavior, and
   obtain separate authorization for any live promotion.

Rollback begins by setting `ALLOW_ESPN_PROVIDER=false` and returning affected
arenas to `manual`; disabling the server document is defense in depth. Preserve
week snapshots and historical scores. Never delete provider cache, slate, pick,
or standings data as a rollback shortcut.

API-Sports research dates: 2026-07-27 and 2026-07-31.

TheSportsDB internal-path validation date: 2026-07-30.

Status: official documentation validation is complete. Authenticated live
coverage validation is blocked because no existing provider key was available.
No current league ID, live entitlement, fixture, or observed quota is asserted.

## Production-gate recheck — 2026-07-31

The `lukes-picks` project guard passed immediately before inspecting Secret
Manager metadata. An `API_SPORTS_KEY` secret did not exist, and no ignored local
developer credential was present. No secret value was requested or displayed.
The authenticated `/status`, `/leagues`, or `/games` checks therefore were not
attempted, and the production provider remains disabled.

The current official API-BASEBALL coverage page still lists MLB schedule and
historical coverage and documents a 100-request/day free plan. This is public
catalog information only; it is not proof of this project's entitlement, the
current MLB provider league ID or season, response shape, or usable quota.
Those values must still be discovered from authenticated official endpoints and
must not be guessed.

The official API-Sports terms were also rechecked. They state that the provider
does not grant a publication license for its data and does not own the logos,
images, or trademarks returned by the API; third-party authorization may be
required. No MLB or club mark authorization was available in this review.
Consequently:

- production remote logos remain disabled;
- the production allowed-logo-host set is empty;
- neutral initials badges remain the required production fallback; and
- no API-Sports catalog or production arena may be enabled until both the
  authenticated provider gate and the applicable data/mark rights gate pass.

## Release policy update — 2026-07-30

Production provider mode for `lukes-picks` is `manual` until a provider passes
every production gate. `mock` is emulator/test-only. The TheSportsDB adapter is
implemented only as `theSportsDbTest`, with sanitized fixtures and a runtime
policy gate. Its fixture/policy suites and connected three-user browser
lifecycle pass under the isolated emulator project.

TheSportsDB is restricted to Firebase emulator/internal validation. Its official
API documentation and terms were revalidated before implementation. The
documented paths used or permitted by this adapter are:

- `eventsday.php`
- `eventsnextleague.php`
- `eventsseason.php`
- `lookupteam.php`
- `search_all_teams.php`

Requirements:

- official API responses only, never website scraping;
- server-side calls or a fixture importer, never direct Flutter calls;
- `ALLOW_THESPORTSDB_TEST_PROVIDER=true` plus an emulator/internal condition;
- unconditional rejection when the project ID is `lukes-picks`;
- normalized provider/event/team IDs;
- HTTPS, allowlisted hosts, timeout, bounded retry, and quota headroom;
- schedule/team caches, validation, duplicate suppression, timestamps, and a
  raw-response hash;
- sanitized fixtures instead of unrestricted raw payload storage;
- visible attribution and internal-test-only team badges with neutral fallback.

The documented test key mentioned in the task is not production permission. Do
not enable TheSportsDB in a public preview or store build.

## API-Sports product mapping

| App target | API-Sports product | API version | Catalog name | Live validated |
|---|---|---:|---|---|
| NFL | API-NFL & NCAA | v1 | NFL | No |
| NCAA football | API-NFL & NCAA | v1 | NCAA | No |
| NBA | API-BASKETBALL | v1 | NBA | No |
| WNBA | API-BASKETBALL | v1 | NBA W | No |
| NCAA men’s basketball | API-BASKETBALL | v1 | NCAA | No |
| NCAA women’s basketball | API-BASKETBALL | v1 | NCAA Women | No |
| MLB | API-BASEBALL | v1 | MLB | No |
| NHL | API-HOCKEY | v1 | NHL | No |

The public catalog documents schedule and historical coverage for all targets.
That is not proof that each target is exposed by the current free plan.
API-Sports states that free-plan data availability is limited and may change.

## Endpoints

Each product has a separate v1 host:

- `https://v1.american-football.api-sports.io`
- `https://v1.basketball.api-sports.io`
- `https://v1.baseball.api-sports.io`
- `https://v1.hockey.api-sports.io`

Required endpoints per product:

- `GET /status`: subscription/quota health; documented as not consuming quota
- `GET /leagues`: authoritative discovery; never guess or stale-hardcode IDs
- `GET /games`: schedules and final results using product-specific filters
- `GET /teams`: team metadata and optional identifying logo URLs

Documentation examples contain game IDs, timestamps/timezones, league/team
identity, provider status, and scores. Those fields remain documentation-only
until authenticated fixtures are captured. The adapter must not assume a
uniform winner field. It derives a winner only for a terminal status with
unequal final totals; ties and ambiguous statuses require commissioner review.

On the validation date, unauthenticated `/status` and `/leagues` calls to all
four hosts returned HTTP 403 for a missing application key, as expected.

## Quota behavior

API-Sports advertises 100 requests/day **for each API** on the free plan.
Direct-dashboard quotas reset at 00:00 UTC. Authenticated responses document
daily and per-minute limit/remaining headers. The adapter reads reported limits
dynamically and reserves safety headroom rather than assuming exactly 100.

No authenticated quota was observed; “not observed” is distinct from zero.
Only sanitized quota fields may be stored because raw status responses can
contain account identity.

Direct API-Sports access is preferred over RapidAPI so quota exhaustion cannot
trigger RapidAPI overage behavior. No plan purchase or billing action is
authorized.

## Free-tier validation gate

A real competition is enabled only after an authenticated spike confirms:

1. current league ID and season;
2. free-plan entitlement;
3. a usable upcoming schedule when the competition is in season;
4. a recent completed game;
5. stable game/team identifiers, UTC start, status, scores, logo metadata, and
   winner semantics; and
6. sanitized fixtures and contract tests.

## Optional CollegeFootballData fallback

CollegeFootballData REST API v2 is an NCAA-football-only fallback. The current
base is `https://api.collegefootballdata.com`; live OpenAPI metadata reported
service version 5.20.1 on the validation date.

Relevant endpoints are `GET /games`, `/teams` or `/teams/fbs`, `/info`, and
`/info/usage`. The games schema includes stable ID, start date, completion flag,
home/away IDs and names, and scores. Team logos come from team metadata. The
winner is derived only when completed and scores are unequal.

The documented free tier is 1,000 calls per calendar month with no credit card
and covers core/historical endpoints. Live scoreboard capability begins at a
paid tier, so a no-purchase fallback cannot be relied on for rich live,
postponed, cancelled, or suspended semantics. Manual anomaly review remains
mandatory.

No CFBD key was available. Unauthenticated info/usage/games requests returned
HTTP 401. A key request requires the user’s email flow; no account was created.

## API-Sports production gate

A pre-existing API-Sports key, supplied only through Firebase Functions secret
configuration, is required to:

1. call all four `/status` endpoints;
2. discover current IDs through `/leagues`;
3. verify free-plan access for every target;
4. fetch an upcoming schedule and recent final per enabled competition;
5. verify canonical fields and mappings; and
6. save sanitized test fixtures.

If API-Sports fails NCAA football coverage, a separate CFBD bearer key is then
required. Until then, manual mode is the production fallback and mock mode is
the emulator/automated-test fallback. The connected browser scenario passed
manual result handling. The emulator integration suite separately creates and
publishes a manual MLB game under a configured connected provider, proving the
authorized fallback without making a production-provider claim.

## Fallback behavior

- Disable unvalidated targets in real-provider mode.
- Continue with manual schedules/results in production and mock fixtures only
  in emulators/tests.
- Serve cached data through quota/provider failures.
- Permit commissioner manual games and results with audit reasons.
- Use only the reviewed default-off Site API scoreboard adapter after written
  authorization; never add an undocumented fallback endpoint or scrape HTML.
- Never expose provider credentials to Flutter clients.

The optional CollegeFootballData research in this document is not a current
application provider mode and has no authorized key. It must not weaken the
manual-production or TheSportsDB-internal gates above.

## Remaining authenticated validation

- [ ] Capture sanitized status output for all API-Sports products
- [ ] Discover current league IDs
- [ ] Verify free-plan entitlement for every target
- [ ] Capture upcoming and final fixtures
- [ ] Confirm timestamps, statuses, team metadata, scores, and winner logic
- [ ] Add redacted contract fixtures and adapter tests
- [ ] Evaluate CFBD only if NCAA football remains unsupported
- [x] Revalidate TheSportsDB documentation and terms for internal testing
- [x] Add sanitized TheSportsDB schedule/team fixtures
- [x] Prove the emulator-only flag and `lukes-picks` rejection
- [x] Verify test badge hosts, fallbacks, and attribution

## Official sources

- [Unofficial Public ESPN API reference](https://github.com/pseudo-r/Public-ESPN-API)
- [Disney Terms of Use](https://disneytermsofuse.com/english/)

- [TheSportsDB API guide](https://www.thesportsdb.com/docs_api_guide)
- [TheSportsDB terms of use](https://www.thesportsdb.com/docs_terms_of_use.php)
- [API-Sports home and free plan](https://api-sports.io/)
- [API-Sports terms and quota behavior](https://api-sports.io/terms)
- [NFL & NCAA coverage](https://api-sports.io/sports/nfl)
- [Basketball coverage](https://api-sports.io/sports/basketball)
- [Baseball coverage](https://api-sports.io/sports/baseball)
- [Hockey coverage](https://api-sports.io/sports/hockey)
- [NFL v1 documentation](https://api-sports.io/documentation/nfl/v1)
- [Basketball v1 documentation](https://api-sports.io/documentation/basketball/v1)
- [Baseball v1 documentation](https://api-sports.io/documentation/baseball/v1)
- [Hockey v1 documentation](https://api-sports.io/documentation/hockey/v1)
- [CollegeFootballData REST/OpenAPI](https://api.collegefootballdata.com/)
- [CollegeFootballData access tiers](https://collegefootballdata.com/api-tiers)
- [CollegeFootballData free key](https://collegefootballdata.com/key)
- [CollegeFootballData REST v2 announcement](https://blog.collegefootballdata.com/api-v2-is-now-in-general-availability/)
