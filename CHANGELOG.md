# Changelog

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
