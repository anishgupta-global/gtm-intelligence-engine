# ADR-0002 — Typed signal registry between connectors and observations

**Status:** accepted

**Decision:** Raw source events must map to one of the registered, zod-validated signal types before ingestion. Unknown or malformed events are rejected atomically.

**Why:** Connectors become declarative mappers; scoring and enrichment subscribe to signal *types*, not sources — a new connector emitting existing types needs zero downstream changes.

**Consequences:** Adding a genuinely new behavior requires a registry entry + intent weight; that friction is deliberate (it keeps the taxonomy curated).
