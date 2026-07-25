# Contributing

Thanks for considering a contribution. Two documents define how this codebase thinks — read them first:

1. [docs/ENGINEERING_PRINCIPLES.md](docs/ENGINEERING_PRINCIPLES.md) — the 12 rules (AI last, observation first, no silent AI, ...)
2. [docs/PRD.md](docs/PRD.md) — the wedge and the scope rule: *if it doesn't improve "who should I talk to this week, and why", it's not v1.*

## Setup

```bash
npm install        # Node >= 22.13, zero native deps
npm run demo       # end-to-end walkthrough (also your best integration sanity check)
npm test           # 16 tests: identity golden pairs, cost gates, decision loop e2e, DSAR
npm run typecheck
```

## What makes a good PR

- **New connectors** — official APIs or user exports only (never scraping; see PRD audit #1). ~20 lines against `src/connectors/sdk.ts`; map to registered signal types (`docs/SIGNALS.md`); include a fixture + test.
- **New signal types** — registry entry + intent weight + rationale in the PR description.
- **Scoring/enrichment changes** — must keep factor breakdowns and provenance; must not add an LLM call where a rule can answer (confidence gating).
- **Anything touching AI** — must route through the cost router, hit the cache, and respect the Intelligence Law (evidence, provenance, confidence, cost, reproducibility). The CI asserts ≥70% of pipeline ops stay at L0.

## Ground rules

- TypeScript strict; keep modules small and single-purpose.
- Tests accompany behavior changes; `npm test` and `npm run typecheck` must pass.
- Architecture-level changes need a short ADR in `docs/adr/`.
- Be kind in reviews; assume good intent.
