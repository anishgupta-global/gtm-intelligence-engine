# ADR-0003 — Virtual identity clusters; merges are memberships, not row merges

**Status:** accepted

**Decision:** A Person is a virtual cluster of identifier keys held by membership rows carrying confidence, method, evidence, engine version, and status. Thresholds: ≥0.90 auto-merge, 0.70–0.90 human review queue, <0.70 separate person. Splits = membership retraction; nothing is ever physically merged or deleted.

**Why:** Probabilistic resolution WILL eventually merge two different people with the same name. When it does, retraction cleanly restores both — and provenance on downstream artifacts bounds the recompute.

**Consequences:** Person queries join through memberships (acceptable at v1 scale; a materialized person view is the scaling lever). The review queue makes the human override a feature, not an apology.
