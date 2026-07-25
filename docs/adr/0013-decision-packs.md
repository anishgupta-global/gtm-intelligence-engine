# ADR-0013 — The engine is the product; capabilities ship as decision packs

**Status:** accepted

**Decision:** The core decision loop (observations → identity → evidence → reasoning → decision → evaluation → learning) is the reusable engine and never changes per use case. Product capabilities ship as **decision packs**: sets of decision *kinds* that read the same graph, produce standard decision objects via `persistDecision()`, and share the same evaluation engine, calibration learning, and decision memory. Nothing bypasses the loop.

Pack 1 — **Growth** (`src/decisions/growth-pack.ts` + `reason.ts`), for growing a two-sided motion with data already held:
- `weekly_gtm` — who to talk to this week
- `platform_allocation` — where to invest effort (grounded engagement per source, never follower counts)
- `account_retention` — which account to save before it churns

**Why:** B2B vs B2C is the wrong split — two-sided companies need growth decisions, not two products. Packs keep the wedge discipline (one pack, few kinds) while giving a credible expansion path (audience/content pack, executive cross-side pack, community pack) without ever redesigning the engine. Principle 13 is the gatekeeper: a pack ships decisions, not visualizations.

**Consequences:** Each new kind must define: a grounded generator (input-hash gated against spam), a trace, an expected metric that an outcome can be recorded against, and an embedding for memory. Calibration is learned per kind. Cross-pack executive insights become possible precisely because every pack's decisions land in one shared, evaluated memory.
