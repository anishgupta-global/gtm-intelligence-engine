# Signal registry

Every event entering the engine becomes a **typed signal** — connectors map raw source data into one of these; nothing untyped reaches the pipeline. Definitions live in `src/signals/registry.ts` (zod-validated).

## Signal shape

```json
{
  "signalType": "pricing_view",
  "externalId": "ev-123",
  "observedAt": "2026-07-25T09:00:00Z",
  "actor": { "email": "jane@acme.com", "name": "Jane Doe", "company": "Acme", "title": "CTO", "employees": 120, "industry": "software" },
  "props": { "path": "/pricing" },
  "consentBasis": "legitimate_interest"
}
```

- `actor` — identity hints; at least one of email / handle / name. Emails become `email:` identifiers, handles become `handle:<source>:` identifiers.
- `props` — flat scalars only; free of PII by convention (redaction guards the LLM boundary regardless).
- `consentBasis` — `consent` | `contract` | `legitimate_interest` (GDPR Art. 6 categories used).

## Catalog

| Signal type | Typical source | Intent weight |
| --- | --- | --- |
| `crm_contact` | CRM export/import | 0 (profile data, not behavior) |
| `signup` | your own app/newsletter, attributed to the acquiring channel via UTM/referral | 6 |
| `website_visit` | analytics webhook | 4 |
| `pricing_view` | analytics webhook | 25 |
| `docs_view` | analytics webhook | 8 |
| `newsletter_open` / `newsletter_click` | email tool | 2 / 6 |
| `repo_star` / `repo_issue` | GitHub API | 12 / 15 |
| `payment` / `trial_started` | payment processor | 20 / 30 |
| `demo_request` / `form_submit` | forms/website | 30 / 15 |

Weights are the L0 intent-score inputs (`src/config.ts`) — fully explainable, tune them per workspace.

## Adding a connector

A connector is an object with a `name` and a `fetch(since)` that returns signals:

```ts
export function myConnector(): Connector {
  return {
    name: 'my_source',
    async fetch() {
      const rows = await pullFromOfficialApi();
      return rows.map((r) => ({
        signalType: 'form_submit',
        externalId: r.id,
        observedAt: r.created_at,
        actor: { email: r.email, name: r.name },
        props: { form: r.form_name },
        consentBasis: 'consent',
      }));
    },
  };
}
```

Rules: official APIs or user-provided exports only (no scraping — see PRD audit #1); connectors never touch persons/scores/decisions; ingestion is idempotent so refetching is always safe. Adding a new signal type = one entry in `SIGNAL_TYPES` + a weight in `INTENT_WEIGHTS`.
