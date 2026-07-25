# ADR-0010 — DSAR erasure via payload hard-delete + tombstones; crypto-shredding is v2

**Status:** accepted

**Decision:** Erasure deletes observation payloads and identifiers, hashes membership keys, deletes scores/enrichments/edges, and leaves a `[erased]` person tombstone. Export returns everything held about a person. Both are audit-logged.

**Why:** Append-only event logs and the right to erasure conflict; tombstoning resolves it pragmatically at v1 scale while keeping replay consistent.

**Consequences:** Replay over erased persons is intentionally lossy. Per-person encryption keys (crypto-shredding: erase = delete the key) is the cleaner v2 mechanism once multi-tenancy lands.
