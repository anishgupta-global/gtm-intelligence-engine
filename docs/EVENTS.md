# Pipeline event catalog

Every stage appends to the `events` table — the audit spine for replay and debugging. Sensitive actions additionally land in `audit_log`.

| Stage | Ref | Detail payload |
| --- | --- | --- |
| `ingest` | connector name | `{ inserted, duplicates, rejected }` |
| `resolve` | — | `{ persons, merged, review }` |
| `identity_conflict` | person ids | `{ keys }` — a cluster touched two existing persons (kept on first, logged loudly) |
| `review_queued` | provisional person | `{ proposed, score }` |
| `review_approved` | from-person | `{ to }` |
| `graph` | — | `{ entities, edges }` |
| `score` | — | `{ computed, skipped }` (skipped = input-hash unchanged) |
| `decide` | decision id | `{ confidence, priors, level }` or `{ reused: true, reason }` |
| `decision_status` | decision id | `{ status }` (accepted/dismissed) |
| `outcome` | decision id | `{ achieved }` |
| `evaluate` | decision id | `{ attainment, verdict, calibrationError }` |
| `learn` | decision kind | `{ adjustment, samples }` |
| `digest` | — | `{ hot, fading }` |
| `erasure` | person id | `{ observations }` |
| `pipeline` | — | run summary |

`audit_log` actions: `identity_merge_approved`, `identity_merge_rejected`, `dsar_erasure`, `outbound_send`.
