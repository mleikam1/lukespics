# API quota and caching

The free provider request budget is a hard constraint. Flutter never calls a
sports provider.

Production currently uses manual mode. These controls apply to internal
TheSportsDB tests, the default-off SportsDataIO adapter, and API-Sports only
after the corresponding production gate passes. A regular member cannot force a provider
refresh; quota-consuming catalog requests require the weekly picker or an
administrator, and every forced refresh is administrator-only.

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

## Budget guard

Daily `providerUsage` documents keep request count/reset period and
provider-reported remaining quota. `providerCircuitStates/{provider}` keeps
last success/failure and the circuit deadline independently of the UTC quota
day, so midnight cannot bypass an unexpired outage circuit. A soft reserve
prevents nonessential calls from consuming the last portion of daily quota.

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
