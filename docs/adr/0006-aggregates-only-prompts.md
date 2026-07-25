# ADR-0006 — LLMs never see raw records

**Status:** accepted

**Decision:** Prompt builders accept only the typed `Aggregates` object (~50 numbers + short labels). There is no API that passes observations, people, or payloads to a model. Free text is PII-redacted (emails, phones) as a second layer.

**Why:** Cost (50 numbers vs 100k rows), privacy (no PII reaches a third party), and groundedness (the model can only restate the aggregates it was given; evidence IDs are attached from SQL afterwards, so citations cannot be hallucinated).

**Consequences:** The model's fluency is capped by the quality of aggregation — improving insight means improving the L0 aggregates, which is exactly where the effort should go.
