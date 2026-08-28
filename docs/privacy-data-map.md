# Privacy and data map

Starter operational documentation; not attorney-approved.

| Data | Location | Purpose | Visibility |
|---|---|---|---|
| Google UID, email, name, photo | `users/{uid}` | Authentication/account operation | User and trusted backend |
| League-safe nickname/photo | membership | Arena roster/rotation | Active league members |
| Private team choices | entry picks | Operate contest before lock | Pick owner and backend |
| Revealed choices | reveal docs | Post-lock transparency | Active league members |
| Scores/statistics | entries/standings | Competition results | Active league members |
| Audit events | audit logs | Integrity/admin review | Owner/commissioner |
| Hashed invite lookup and bounded metadata | server-only invite collections | Private arena admission, expiry, use limits, and revocation | Trusted backend only |
| Provider cache/usage | server collections | Schedule/results and quota safety | Backend |
| Unconfirmed offline choice | Device memory/local app state | User-visible retry before lock | Current user only; never counted until server confirmation |
| Team-mark URL | Normalized game/team metadata | Optional team identification | Members only when host/rights gate permits |
| Analytics events | Firebase Analytics | Product reliability/usage when explicitly enabled | Authorized operators |

Analytics collection is compile-time opt-in through `ENABLE_ANALYTICS` and is
disabled by default. When enabled, events never include raw email, invite code,
invite URL/fragment,
API key, or private team choice. Logs use
request/function/league/week/provider identifiers and safe error codes.

Account deletion removes private identity where possible and anonymizes
historical identity where deletion would corrupt finalized league records. The
UI explains this integrity-preserving behavior before confirmation.

An active owner cannot leave or delete their account in this release because
ownership transfer is not yet supported. Completion counts may be public to
arena members, but pre-lock team choices are never analytics or audit fields.

Data retention and formal deletion timelines require owner/legal approval before
public launch.
