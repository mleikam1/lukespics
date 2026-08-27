# CBS college-football provider

Luke's Picks uses the public CBS Sports college-football scoreboard HTML only
for its optional `cbsSports` NCAAF/FBS schedule provider. The browser never
requests or parses CBS content. Firebase Functions normalize one weekly page
and share the result through the existing sports catalog, draft, published
slate, picks, results, and standings pipeline.

## Verified public boundary

The route verified on 2026-08-25 was:

```text
https://www.cbssports.com/college-football/scoreboard/FBS/2026/regular/1/
```

The server constructs every URL from validated season, season type, week, and
the fixed `FBS` division. It rejects client-provided URLs. Every request and
manual redirect hop must remain the exact originally constructed HTTPS
scoreboard identity: scheme, host, empty port, path, and empty query/fragment
must all match. At most two redirects are followed. A `200` page is accepted
only when its canonical/`og:url` marker exactly matches that identity, or its
title explicitly confirms the requested season, week, FBS division, and
regular/postseason classification.

At verification time, CBS `robots.txt` did not disallow the scoreboard path
for the wildcard user-agent group. It did disallow `/data/*`, `/component/*`,
login/user paths, and other internal paths. This provider never uses those
paths, alternate CBS hosts, a hidden API, a browser, authentication, cookies,
proxies, or anti-bot workarounds.

Only these facts are normalized when present:

- CBS or deterministic game identifier and an in-card public game URL;
- season, season type, week, and FBS division;
- home and away team names, abbreviations, profile slugs, and in-card logos;
- a confirmed kickoff instant, source display text, and date heading;
- network, venue name/location, neutral-site marker, status, scores, and winner.

The parser deliberately ignores odds, spreads, totals, moneylines, picks,
predictions, articles, headlines, ads, tickets, video, watch links, and page
layout. Raw HTML is parsed in memory and is never written to Firestore, Cloud
Storage, logs, analytics, crash reporting, fixtures, or Git.

## Configuration and activation

Configuration is server-only at `systemConfig/cbsCollegeFootball`. Missing or
invalid configuration fails closed. A reviewed starting document is:

```json
{
  "enabled": false,
  "autoRefreshEnabled": false,
  "activeSeason": 2026,
  "activeSeasonType": "regular",
  "activeWeek": 1,
  "activeWeekStartsAtUtc": "Firestore Timestamp",
  "division": "FBS",
  "minimumRefreshMinutes": 120,
  "defaultRefreshMinutes": 180,
  "maximumRefreshMinutes": 240,
  "parserVersion": "1.0.0",
  "globalDailyRequestLimit": 12
}
```

Keep `enabled` and `autoRefreshEnabled` false through deployment and emulator
validation. Then route only NCAAF to CBS on the intended arena while preserving
its current default provider for every other sport:

```json
{
  "settings.providerBySport.NCAAF": "cbsSports"
}
```

`providerName` remains the backward-compatible default for NFL, MLB, and other
sports. `providerBySport` is owner-controlled through the existing settings
mutation boundary. Direct client access to provider configuration, caches,
leases, counters, and circuit state remains denied by Firestore Rules.

`activeWeekStartsAtUtc` is a trusted provider-week boundary used only to choose
the four-hour future cadence before that instant and the three-hour current
cadence afterward. It is not a game kickoff, is never copied into a game, and
cannot create a lock time.

The configured active season, season type, and week are also the complete CBS
catalog surface. The callables reject a different identity, and Flutter exposes
only those exact three configured choices rather than synthesizing historical
seasons, both season types, or a `0`–`25` week range. Internal cache reads may
return a matching historical entry as stale, but a non-active identity can
never trigger CBS network access.

Turning `enabled` false is the immediate kill switch. It suppresses all CBS
network access while retaining and returning the last known good normalized
cache. Removing the NCAAF mapping (or mapping it back to `manual`) is the arena
rollback; it does not delete published games, picks, results, standings, cache,
or audit history.

## Cache and request policy

The canonical cache identity is season + season type + week + division, not a
picker date. One Thursday-to-Saturday slate therefore shares one weekly CBS
page. Date controls filter the normalized week after cache retrieval.

Private metadata and normalized games are stored under
`sportsProviderCache/cbs_ncaaf_FBS_{season}_{seasonType}_{week}`. The
provider-global rolling-attempt ledger, consecutive-failure counter, and circuit
deadline use `providerUsage/cbsSports_rolling24h`; per-page safe failure metadata
also remains on the cache document. A 90-second Firestore transaction lease
coordinates concurrent Functions. The outbound request and parse always occur
outside the transaction, and the lease is released in a `finally` path.

Production policy is:

- at least 120 minutes between successful requests for one canonical page;
- at most 12 actual outbound CBS attempts across the provider in a rolling
  24-hour window by default and at the configurable maximum;
- two-hour refresh when a game is live or within 24 hours of kickoff;
- three-hour refresh for the configured active week otherwise;
- four-hour refresh while the configured active identity is still before its
  trusted server-side `activeWeekStartsAtUtc` boundary;
- no automatic refresh after every game is terminal;
- one request normally, with at most one retry for a timeout or `5xx`;
- no retry for `403`, `404`, `429`, challenge, CAPTCHA, or access-denied HTML;
- six-hour-or-longer circuit on `403`/`429`, honoring `Retry-After`;
- provider-global six-hour circuit after three consecutive fetch or parser
  failures, in addition to per-page failure state;
- conditional `If-None-Match`/`If-Modified-Since` and successful `304` handling;
- 10-second timeout, 5 MiB body ceiling, at most two exact-identity redirect
  hops, and the stable
  `LukesPicks/1.0 private-noncommercial-schedule-fetcher` user-agent.

Every outbound fetch is reserved before it starts, so the initial request, each
retry, and each redirect hop count separately against the same provider-global
rolling cap. Fresh cache hits and non-active identities make no CBS request.
Lease contention, cooldown, cap, open circuit, kill switch, HTTP failure,
malformed HTML, or a selector regression returns stale normalized data when
available. Changing `parserVersion` makes the cache stale and forces a full,
unconditional fetch and reparse without old ETag/Last-Modified validators. An
empty parse never replaces a good schedule unless the page explicitly says
there are no games, and any unexplained non-empty shrink also retains the last
known good schedule. Unchanged content and valid `304` responses advance
timestamps without rewriting game data.

## Logos and kickoff safety

The parser accepts a logo only from the matching team row, over HTTPS, on
`sports.cbsimg.net` or `sportshub.cbsistatic.com`. It records the URL only; the
backend never downloads, transforms, uploads, rehosts, or separately requests
an image. Flutter reuses the existing bounded network-image policy and loading,
error, and initials fallback. The source note is plain text and does not imply
CBS sponsorship.

Canonical kickoff times are UTC. Flutter displays them in the arena timezone.
A missing or timezone-ambiguous CBS time stays `null`/TBD, carries no lock
instant, remains visible, and cannot be selected until a confirmed timestamp is
available. No browser clock or invented Eastern time can open a pick window.

On 2026-08-25 the verified Week 1 HTML exposed matchups, networks, venues, and
some team logos but no trustworthy date/time. Those games therefore correctly
appear as TBD and require either a later cached CBS observation with a confirmed
time or the existing administrator-reviewed manual-game path before selection.
No CBS deployment or authenticated production picker-to-results flow has been
accepted; deterministic confirmed-time fixtures do not satisfy that gate.

## Local validation

Routine tests mock HTTP and use only small synthetic HTML fragments:

```bash
npm --prefix functions ci
npm --prefix functions run lint
npm --prefix functions run typecheck
npm --prefix functions test
npm --prefix functions run build
npm --prefix functions run test:rules
npm --prefix functions run test:integration

flutter pub get
dart format --output=none --set-exit-if-changed .
flutter analyze
flutter test
flutter build web --release
./scripts/check_public_source.sh
./scripts/check_public_build.sh build/web
```

Start the isolated emulator stack with:

```bash
npm --prefix functions ci
npm --prefix functions run build
firebase emulators:start --project demo-lukes-picks-local \
  --only auth,firestore,functions,hosting
```

No routine test or CI command contacts CBS. Any development smoke command must
be explicitly enabled, run once, respect the same request rules, print only
normalized summaries, and never persist HTML.

## Deployment and rollback

Confirm Blaze billing, Cloud Scheduler API availability, scheduler service
agent permissions, and the exact authorized Firebase project before deploying.
The guarded repository commands are:

```bash
./scripts/release_firebase.sh rules-indexes
./scripts/release_firebase.sh functions
flutter build web --release
./scripts/check_public_build.sh build/web
./scripts/release_firebase.sh preview
# Only after the fixed connected-picker-flow preview is approved:
./scripts/release_firebase.sh hosting-live
```

After authenticated preview and emulator verification, use the existing guarded
Hosting release procedure from `docs/deployment.md`. Do not enable the provider
or scheduler automatically as part of code deployment.

Rollback order:

1. Set `systemConfig/cbsCollegeFootball.enabled` and
   `autoRefreshEnabled` false.
2. Restore `settings.providerBySport.NCAAF` to its prior value or remove it.
3. Redeploy the prior Functions revision only if code rollback is still needed.
4. Preserve all normalized caches and historical league/week/game/pick data.
