# ADR-0007 — Decisions are first-class objects with traces and memory

**Status:** accepted

**Decision:** Every recommendation is a `decision` row: structured trace (evidence → hypothesis → reasoning → action), confidence (base + calibration + memory prior), expected outcome, status lifecycle, context embedding. New decisions similarity-match past evaluated decisions (cosine ≥0.75) and surface the prior.

**Why:** This is the moat. Analytics tools report; this engine remembers what worked and gets more confident about repeats of winners and more skeptical about repeats of losers.

**Consequences:** One embedding per decision (L1, free) and modest storage. Memory quality depends on recorded outcomes — which the dashboard makes a one-click habit.
