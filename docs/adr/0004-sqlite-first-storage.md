# ADR-0004 — SQLite-first storage; Postgres/pgvector/Neo4j are swap paths

**Status:** accepted

**Decision:** v1 runs on a single SQLite file via Node's built-in `node:sqlite` — relational tables for the graph (edges + entities), JSON columns for factors/traces, local vectors serialized as JSON. All access goes through repository functions.

**Why:** "Workable locally in 2 minutes" beats a docker-compose of Postgres+Redis+vector-DB for an OSS project whose first job is to be understood. Zero native deps, zero services.

**Consequences:** Multi-hop graph queries and large-scale vector search have a ceiling — documented, not hidden. The swap to Postgres+pgvector (and RLS for tenancy, ADR-0012) changes `db.ts` and repository internals only.
