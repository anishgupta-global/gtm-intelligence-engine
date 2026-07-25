# Evaluation metrics

The evaluation engine computes **expected vs actual** for every executed decision — without it, nobody can objectively say whether the engine is improving. Definitions live in `src/decisions/evaluate.ts`; all surfaced at `GET /api/evaluation`.

## Measured in v1 (honest from day one)

| Metric | Definition |
| --- | --- |
| Attainment | `achieved / expected.target`, capped at 2.0 |
| Verdict | winner ≥ 0.8 · inconclusive 0.4–0.8 · loser < 0.4 |
| Calibration error | `confidence − min(1, attainment)` — positive means overconfident |
| Acceptance rate | accepted+completed ÷ (accepted+completed+dismissed) |
| Success rate | winners ÷ evaluated |
| Mean calibration error | mean absolute calibration error across evaluations |
| Cost per insight | total AI spend ÷ insights generated (from the cost ledger) |

## How learning consumes it

- **Calibration** (`learn.ts`): per decision kind, adjustment = −mean(calibration error) × 0.5 × damping, clamped to ±0.2. Damping = min(1, samples/5) so a single outcome cannot swing future confidence.
- **Memory priors** (`memory.ts`): new decisions retrieve similar past decisions (cosine ≥ 0.75 on the decision-context embedding) and shift confidence: past winner +0.07·sim, past loser −0.12·sim.

## Not measured yet (needs ground truth that doesn't exist early)

- **Decision recall / false negatives** — "what decisions *should* have been made" is unknowable without labeled counterfactuals.
- **Revenue attribution** — outcomes are recorded within an attribution window; correlation, not causal proof, and labeled as such.

These are reported by the API as `notMeasuredYet` — the engine never fabricates a metric it cannot ground. (Principle 11: measure everything; Principle 12: no silent AI.)
