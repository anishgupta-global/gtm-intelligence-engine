# ADR-0005 — Cost pyramid with a single ledgered chokepoint

**Status:** accepted

**Decision:** Every computation carries a level: L0 rules/SQL, L1 local embeddings, L2 small LLM, L3 large LLM. All L2/L3 calls pass `guardLlm()` (budget check) and are ledgered with tokens and dollars. Budget modes: full → lean (downgrade model) → exhausted (throw `BudgetExhaustedError`, callers fall back to L0). Target distribution ≥70% L0, asserted in CI.

**Why:** Most AI products die of COGS. Making the pyramid structural — not advisory — is the difference between "we try to be efficient" and "the architecture cannot overspend silently."

**Consequences:** Under budget pressure insight quality degrades to deterministic levels — deliberately and visibly (the ledger and `/api/cost` show it).
