# Threat model (v1)

Scope: a single-workspace, self-hosted instance. Assets: audience PII (emails, names, employers, behavior), decision history, the AI budget.

| Threat | Vector | Mitigation |
| --- | --- | --- |
| PII exfiltration via LLM | prompts leaking records to a third-party API | Aggregates-only prompt builders (no raw-record code path) + regex PII redaction (ADR-0006); $0 mock mode sends nothing anywhere |
| Unauthorized API access | open REST API | `API_KEY` bearer auth (optional; open demo mode by default and documented as such); bind to localhost by default deployment guidance |
| Malicious connector payloads | webhook ingestion | zod validation with atomic reject; idempotency prevents replay flooding of duplicates; payloads are inert JSON (never executed, never templated into prompts) |
| Identity poisoning | crafted signals engineering a false merge | Deterministic merges require identifier co-occurrence inside a single observation from the source; probabilistic merges cap at review-queue below 0.90 — a human approves cross-person merges |
| Budget drain | forcing repeated LLM calls | Meaningful-change gate + intelligence cache + hard monthly budget with deterministic fallback |
| Supply chain | third-party plugins | None load in v1 (ADR-0011) |
| Data-at-rest exposure | SQLite file theft | Deployment concern in v1 (documented); disk encryption recommended; v2: Postgres + per-tenant credentials + crypto-shredding (ADR-0010) |
| Outbound exfiltration | digest/webhook destinations | Only configured destinations; aggregate content; every send audit-logged |

Report vulnerabilities per [SECURITY.md](../SECURITY.md).
