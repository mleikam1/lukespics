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
| Provider cache/usage | server collections | Schedule/results and quota safety | Backend |
| Analytics events | Firebase Analytics | Product reliability/usage | Authorized operators |

Analytics never include raw email, invite code, API key, or private team choice.
Logs use request/function/league/week/provider identifiers and safe error codes.

Account deletion removes private identity where possible and anonymizes
historical identity where deletion would corrupt finalized league records. The
UI explains this integrity-preserving behavior before confirmation.

Data retention and formal deletion timelines require owner/legal approval before
public launch.
