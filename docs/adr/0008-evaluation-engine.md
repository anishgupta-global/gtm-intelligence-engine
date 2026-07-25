# ADR-0008 — Evaluation engine computes expected vs actual; unmeasurable metrics stay unmeasured

**Status:** accepted

**Decision:** Recording an outcome computes attainment, a verdict (winner/inconclusive/loser), and calibration error, persisted per decision. Aggregate metrics: acceptance rate, success rate, mean calibration error, cost per insight. Decision recall and false-negative rate require ground truth that does not exist early — the API reports them as `notMeasuredYet`.

**Why:** Without expected-vs-actual nobody can objectively say the engine is improving. And fabricating precision/recall from nothing would violate the Intelligence Law the moment it shipped.

**Consequences:** Early metrics are sparse; that sparseness is displayed honestly rather than filled with plausible numbers.
