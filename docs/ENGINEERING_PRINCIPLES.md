# Engineering principles

The twelve rules this codebase is built by. If a change violates one, the change is wrong or the principle needs an ADR.

1. **AI last.** Rules, SQL, and caching answer first; embeddings second; small models third; large models only for high-value reasoning. Target: ≥70% of operations at L0 (CI-enforced).
2. **Observation first.** Connectors only ever produce observations. Nothing writes to persons, scores, or decisions from the edge.
3. **Evidence before AI.** A model is only consulted after deterministic evidence has been gathered — and its output must cite that evidence.
4. **Immutable events.** Observations and the event log are append-only. Corrections are new records, not mutations. (Exception: DSAR erasure, which is itself audit-logged.)
5. **Incremental computation.** Never recompute what didn't change — input hashes gate scores, enrichments, and recommendations.
6. **Cost awareness.** Every computation is ledgered with its level and dollar cost. Cost per insight is a KPI, not a curiosity.
7. **Plugin everything.** Connectors, providers, and scores sit behind small interfaces so implementations can be swapped without touching the pipeline.
8. **Deterministic before probabilistic.** Exact identifier matches merge automatically; probabilistic matches carry confidence and stop at a human review queue below 0.90.
9. **Human override.** Merges are approvable/rejectable and reversible; decisions are accept/dismiss; automations propose, they don't act on people without a human in the loop.
10. **Reproducible decisions.** Every AI output stores its input hash, model, and version — the same inputs regenerate the same insight (that's also what makes the cache safe).
11. **Measure everything.** Decisions are evaluated expected-vs-actual. Metrics that lack ground truth (decision recall, false negatives) are reported as *not measured yet* — never fabricated.
12. **No silent AI.** Every model call is visible in the ledger; budget exhaustion degrades loudly to deterministic levels; nothing falls back quietly to a guess.
