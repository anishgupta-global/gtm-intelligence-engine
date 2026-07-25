# ADR-0001 — Connectors produce observations, never mutations

**Status:** accepted

**Decision:** Every connector writes append-only, idempotent observations (unique on tenant+source+external_id+content_hash). No connector may write to persons, entities, scores, or decisions.

**Why:** Replayability, provenance, and debuggability. Any downstream stage can be recomputed from observations; a buggy connector can never corrupt resolved identities.

**Consequences:** Storage grows append-only (retention policy is the counterweight); all intelligence must be derivable from observations, which is exactly the property that makes the Intelligence Law enforceable.
