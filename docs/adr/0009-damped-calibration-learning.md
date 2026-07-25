# ADR-0009 — Learning = damped confidence calibration + memory priors (no RL)

**Status:** accepted

**Decision:** v1 learning has two mechanisms: (1) per-kind confidence calibration, adjustment = −mean(calibration error) × 0.5 × min(1, n/5), clamped ±0.2; (2) similarity-retrieved memory priors (ADR-0007). No reinforcement learning, no trained models.

**Why:** With single-digit outcome counts, anything fancier is fake. Damping guarantees one outcome cannot swing future confidence; the clamp guarantees learning can never dominate evidence.

**Consequences:** Learning is modest early — and provably real: the demo shows a measured outcome shifting the next decision's confidence. Trained models become worthwhile only once outcome history accumulates (v3).
