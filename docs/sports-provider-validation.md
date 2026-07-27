# Sports provider validation

Validation date: 2026-07-27

Status: official documentation validation is complete. Authenticated live
coverage validation is blocked because no existing provider key was available.
No current league ID, live entitlement, fixture, or observed quota is asserted.

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

## Exact blocker

A pre-existing API-Sports key, supplied only through Firebase Functions secret
configuration, is required to:

1. call all four `/status` endpoints;
2. discover current IDs through `/leagues`;
3. verify free-plan access for every target;
4. fetch an upcoming schedule and recent final per enabled competition;
5. verify canonical fields and mappings; and
6. save sanitized test fixtures.

If API-Sports fails NCAA football coverage, a separate CFBD bearer key is then
required. Until then, mock/manual modes are the supported end-to-end path.

## Fallback behavior

- Disable unvalidated targets in real-provider mode.
- Continue with mock/manual schedules and results.
- Serve cached data through quota/provider failures.
- Permit commissioner manual games and results with audit reasons.
- Never fall back to undocumented ESPN endpoints or scraping.
- Never expose provider credentials to Flutter clients.

## Remaining authenticated validation

- [ ] Capture sanitized status output for all API-Sports products
- [ ] Discover current league IDs
- [ ] Verify free-plan entitlement for every target
- [ ] Capture upcoming and final fixtures
- [ ] Confirm timestamps, statuses, team metadata, scores, and winner logic
- [ ] Add redacted contract fixtures and adapter tests
- [ ] Evaluate CFBD only if NCAA football remains unsupported

## Official sources

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
