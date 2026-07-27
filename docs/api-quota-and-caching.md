# API quota and caching

The free provider request budget is a hard constraint. Flutter never calls a
sports provider.

## Cache keys

Keys include provider, product/sport, league, season, normalized UTC date/range,
and request type. Stored records include normalized content, content hash,
fetch/expiry timestamps, quota observations, and safe error state.

## Freshness

| Event distance/state | Target freshness |
|---|---|
| More than 24 hours away | About 12 hours |
| 2–24 hours away | About 2 hours |
| Active game window | No more than every 15 minutes |
| Expected final but pending | 15–60 minutes with backoff |
| Final | Indefinite unless correction refresh requested |
| Team/league metadata | Several days |

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

When quota is unavailable, users continue with cached or manual data and see
“Sports data refresh is temporarily delayed.” Commissioners can enter results;
the picks workflow remains intact.
