# Changelog

## 1.1.0 — 2026-07-25

The engine becomes explicit: capabilities ship as **decision packs** on one shared decision loop (ADR-0013). Wedge evolved: *where should you invest — and who should you talk to there.*

- **Platform intelligence** (`/api/platforms`): per-source rollups from observed engagement (people, active, signals/week, growth, avg intent, hot-lead yield, quality) + a per-platform call — never follower counts the engine can't ground
- **`platform_allocation` decision kind**: the weekly "invest here, reduce there" call as a real decision with trace, evidence, expected metric, memory, and calibration
- **`account_retention` decision kind**: churn-risk accounts produce spam-gated retention decisions
- **Company intelligence** (`/api/companies`): accounts rolled up from the graph — people, intent, ICP fit, churn risk, observed MRR
- **No hardcoded top-N**: `limit`/`role`/`minIntent`/`company` filters on the leads API + a filter bar in the UI
- **Pack-aware dashboard**: Executive (allocation call + platform comparison) / Business / Audience / Decisions / Cost & health
- Digest now opens with "Where to invest" and includes accounts-to-save; outcome recording calibrates per decision kind
- Principle 13 added: decisions over dashboards — every feature must introduce a new decision, not a visualization
- Demo reset now fails loudly if the DB is held by a running server (was: silent reuse); 4 new growth-pack tests (20 total)

## 1.0.0 — 2026-07-25

Initial release.

- Connector SDK + 5 connectors (CSV CRM, GitHub official API/fixture, newsletter/website/payments fixtures) + universal webhook
- Typed signal registry (12 signal types, zod-validated, consent-tagged)
- Identity resolution: deterministic co-occurrence + probabilistic matching, virtual clusters, human review queue, reversible merges
- Knowledge graph (entities + typed edges with provenance)
- Behavior windows + L0 scores (intent, fading, ICP fit) with factor breakdowns, incremental via input hashes
- Cost engine: L0–L3 pyramid, model router, monthly budget with graceful degradation, intelligence cache, per-operation ledger, cost-per-insight KPI
- Reasoning engine: aggregates-only prompts, structured traces (evidence → hypothesis → reasoning → action → confidence)
- Decision engine: lifecycle, decision memory with similarity priors
- Evaluation engine: expected vs actual, verdicts, calibration error, acceptance/success rates
- Learning engine: damped per-kind confidence calibration
- Weekly GTM digest (+ optional Slack webhook), DSAR export/erasure, audit log
- Dashboard (Leads / People / Decisions / Cost & health) with static-demo fallback
- $0 grounded mock provider + optional Anthropic provider (Haiku for L2, Sonnet for L3)
- 16 tests incl. identity golden pairs, cost-distribution assertion, full decision-loop e2e
