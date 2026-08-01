# API quota and caching

The free provider request budget is a hard constraint. Flutter never calls a
sports provider.

Production currently uses manual mode. These controls apply to internal
TheSportsDB tests, the default-off ESPN adapter, and API-Sports only after the
corresponding production gate passes. A regular member cannot force a provider
refresh; quota-consuming catalog requests require the weekly picker or an
administrator, and every forced refresh is administrator-only.

## Cache keys

Generic keys include provider, product/sport, league, season, normalized
date/range, arena timezone, and request type. ESPN keys deliberately omit
season and timezone because its reviewed scoreboard request uses neither; this
prevents duplicate cache entries for inputs that cannot change the outbound
request. Stored records include normalized content, content hash, fetch/expiry
timestamps, quota observations, and safe error state.

## Freshness

| Event distance/state | ESPN cache target | Other-provider default |
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

`providerUsage` keeps request count/reset period, provider-reported remaining
quota, last success/failure, and circuit state. A soft reserve prevents
nonessential calls from consuming the last portion of daily quota.

Before an outbound request, a transaction acquires a short distributed lease.
Identical concurrent refreshes serve cache or wait rather than multiplying API
calls. Requests use strict timeouts, exponential backoff with jitter, and a
circuit breaker. Only materially changed normalized content is written.

TheSportsDB internal testing must remain below documented limits, cache team
metadata separately, keep sanitized fixtures, and reject the provider entirely
outside the emulator/internal condition. API-Sports reads provider-reported
limits but reserves local headroom rather than treating advertised quota as a
guarantee. ESPN publishes no official quota; Luke's Picks therefore uses a
conservative internal soft budget of 500 attempts per UTC day, capped at 20,000
by configuration. That budget is an application safeguard, not an assertion of
permission or provider capacity.

The recurring result job runs every 30 minutes. Cache freshness prevents it
from making an outbound request for every pass, and selected games are grouped
by provider, league, and a bounded arena-local date range. ESPN uses an
inclusive seven-day discovery window from the stored date minus one day through
plus five days so later-biased reschedules remain discoverable without an
unbounded scan. A one-game force refresh uses the same lease, retry accounting,
circuit breaker, and five-minute administrator/arena throttle as a full-slate
refresh.
Adjacent selected-date groups can yield overlapping seven-day ESPN windows.
This bounded inefficiency is tracked as an optimization opportunity; cache,
leases, and the soft budget still account for every outbound attempt.

The backend is designed to continue with cached or manual data when quota is
unavailable and surface “Sports data refresh is temporarily delayed.”
Commissioners can enter games and results through callable operations. The
connected browser scenario passed manual result handling, and the emulator
integration suite separately creates and publishes a manual MLB game while a
connected provider is configured.
