# API quota and caching

The free provider request budget is a hard constraint. Flutter never calls a
sports provider.

Production currently uses manual mode. These controls apply to internal
TheSportsDB tests, the default-off SportsDataIO adapter, and API-Sports only
after the corresponding production gate passes. The default-off `cbsSports`
adapter has a separate, stricter weekly-page cache and rolling request cap. A
regular member cannot force a provider refresh; quota-consuming catalog
requests require the weekly picker or an administrator, and every forced
refresh requires the current picker, owner, or administrator under the
provider-specific throttle.

## Cache keys

Generic keys include provider, product/sport, league, season, normalized
US Eastern date/range, timezone, and request type. Stored records include
normalized content, content hash, fetch/expiry
timestamps, quota observations, and safe error state.

## Freshness

| Event distance/state | SportsDataIO cache target | Other-provider default |
|---|---:|---:|
| More than 24 hours away | 60 minutes | 12 hours |
| 2–24 hours away | 30 minutes | 2 hours |
| Within 2 hours of start | 15 minutes | 15 minutes |
| Live | 10 minutes | 15 minutes |
| Postponed, suspended, or review required | 60 minutes | 60 minutes |
| Empty schedule | 30 minutes | 2 hours |
| Selected terminal game | 12 hours | 12 hours |
| Terminal catalog schedule | Long-term historical retention | Long-term historical retention |

Requests are grouped by provider/product/league/date when supported. The
application does not poll play-by-play.

CBS does not use the generic date-range cache identity. One canonical document,
`sportsProviderCache/cbs_ncaaf_FBS_{season}_{seasonType}_{week}`, represents the
validated FBS weekly scoreboard. Arena-date filters run after that shared cache
is read. The document stores normalized games, content hash, ETag/Last-Modified,
freshness, lease, and bounded failure/circuit metadata; it never stores raw
HTML. Only the single Admin-configured active season/type/week may cause a
network fetch. A non-active identity is cache-only, and the member-facing
callables reject it instead of turning the weekly endpoint into a historical
crawler.

## Budget guard

Daily `providerUsage` documents keep request count/reset period and
provider-reported remaining quota. `providerCircuitStates/{provider}` keeps
last success/failure and the circuit deadline independently of the UTC quota
day, so midnight cannot bypass an unexpired outage circuit. A soft reserve
prevents nonessential calls from consuming the last portion of daily quota.

CBS reserves each actual outbound fetch—including the initial request, its one
permitted retry, and every manual redirect hop—in
`providerUsage/cbsSports_rolling24h`. The default and configurable maximum is 12
attempts across all CBS cache identities in a rolling 24 hours. The same
provider-global document tracks consecutive failures and a circuit deadline, so
three failures on any pages suppress all CBS traffic for at least six hours;
per-page failure metadata remains in each cache document. A 90-second
transaction lease coalesces concurrent refreshes; production also enforces at
least 120 minutes between successful requests for the same weekly page.
Emulator-only forced refresh may bypass that cooldown, but it does not authorize
a routine live CBS test.

Before an outbound request, a transaction acquires a short distributed lease.
Identical concurrent refreshes serve cache or wait rather than multiplying API
calls. Requests use strict timeouts, exponential backoff with jitter, and a
circuit breaker. Only materially changed normalized content is written.

TheSportsDB internal testing must remain below documented limits, cache team
metadata separately, keep sanitized fixtures, and reject the provider entirely
outside the emulator/internal condition. API-Sports reads provider-reported
limits but reserves local headroom rather than treating advertised quota as a
guarantee. SportsDataIO uses a conservative configurable internal soft budget;
it is an application safeguard, not an assertion of account capacity. Each
licensed endpoint's documented call interval is the lower bound. Luke's Picks
polls more slowly: live data caches for 10 minutes and centralized result sync
runs every 30 minutes.

CBS refreshes at most every two hours for a live game or one within 24 hours,
every four hours while the configured identity remains before its trusted
server-side `activeWeekStartsAtUtc` boundary, and every three hours for the
configured current identity otherwise. A non-active identity remains
cache-only. A terminal week stops automatic refresh. The dedicated hourly
`refreshActiveCollegeFootballSchedule` trigger evaluates only the one
configured week, performs no request on a fresh cache, and is a no-op unless
both CBS and automatic refresh are enabled. Timeouts and `5xx` may receive one
retry; `403`, `404`, `429`, challenge pages, and access denial do not retry and
open or extend conservative circuits as appropriate.

A parser-version mismatch bypasses freshness and old conditional validators so
the response is fetched and parsed in full by the new parser. A zero-game parse
without an explicit no-games marker, or any unexplained non-empty shrink from
the last good schedule, is treated as parser failure and cannot replace that
schedule.

The recurring result job runs every 30 minutes. Cache freshness prevents an
outbound request on every pass. Selected games are grouped by provider, league,
season, and Eastern calendar day. NFL and MLB fetch each necessary date bucket
once and filter the normalized response by stable provider ID; they never fan
out once per selected game or unrelated day. A one-game force refresh uses the
same lease, retry accounting, circuit breaker, and five-minute
administrator/arena throttle as a full-slate refresh.

The backend is designed to continue with cached or manual data when quota is
unavailable and surface “Sports data refresh is temporarily delayed.”
Commissioners can enter games and results through callable operations. The
connected browser scenario passed manual result handling, and the emulator
integration suite separately creates and publishes a manual MLB game while a
connected provider is configured.
