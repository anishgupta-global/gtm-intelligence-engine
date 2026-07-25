# ADR-0012 — Single workspace in v1; multi-tenancy via Postgres RLS in v2

**Status:** accepted

**Decision:** v1 serves one workspace. Every table already carries a `tenant` column and every query filters on it, but there is no tenant management, and SQLite provides no row-level security.

**Why:** The wedge is a single team's weekly decision. Shipping multi-tenancy on SQLite would be isolation theater; shipping Postgres+RLS now would break the 2-minute local story.

**Consequences:** Self-hosters run one instance per workspace (cheap — it's one file). The v2 migration flips `db.ts` to Postgres, adds RLS policies keyed on the existing `tenant` column, and adds hashed org API keys.
