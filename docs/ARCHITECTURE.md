# Architecture

## Layers

```mermaid
flowchart TD
  subgraph data [Reliable data first]
    C[L1 Connectors<br/>CSV · GitHub · webhook · fixtures] --> O[(L2 Observations<br/>append-only, typed signals)]
    O --> IR[L3 Identity resolution<br/>virtual clusters + review queue]
    IR --> G[L4 Knowledge graph<br/>entities + typed edges]
    G --> B[L5 Behavior<br/>time-windowed aggregates]
    B --> S[L6 Scores + segments<br/>L0 rules, factor breakdowns]
  end
  subgraph loop [The decision loop — the moat]
    S --> R[L7 Reasoning<br/>aggregates-only prompts]
    R --> D[L8 Decisions<br/>trace + memory priors]
    D --> A[L11 Automations<br/>weekly digest]
    A --> OUT[Outcomes]
    OUT --> E[Evaluation<br/>expected vs actual]
    E --> L[L9 Learning<br/>calibration]
    L -.-> R
    E -.decision memory.-> D
  end
```

## Pipeline sequence

```mermaid
sequenceDiagram
  participant Src as Source
  participant Con as Connector
  participant Obs as Observations
  participant Id as Identity
  participant Sc as Scores
  participant Cost as Cost router
  participant LLM as Provider
  participant Dec as Decisions

  Src->>Con: raw events
  Con->>Obs: typed signals (idempotent, consent-tagged)
  Obs->>Id: identifier co-occurrence -> clusters
  Id->>Id: deterministic merge / review queue (0.70-0.90)
  Id->>Sc: person observations
  Sc->>Sc: intent, fading, ICP (L0, input-hash gated)
  Sc->>Cost: role unknown? check budget + cache
  Cost->>LLM: L2 classify (only if rules failed)
  Dec->>Cost: aggregates changed? budget mode?
  Cost->>LLM: L3 recommend (aggregates only, ~50 numbers)
  LLM-->>Dec: draft + usage -> ledger
  Dec->>Dec: attach evidence IDs, memory prior, calibration
```

## Data model (SQLite, one file)

| Table | Holds |
| --- | --- |
| `observations` | Append-only typed signals; unique on (tenant, source, external_id, content_hash); consent basis; erasable payloads |
| `identifiers` | Extracted identity claims (email, handle) per observation |
| `persons` + `person_memberships` | Virtual clusters: membership rows carry confidence, method, evidence, engine version, status (active/pending_review/retracted/rejected) |
| `entities` + `edges` | Companies, repos, products, topics; typed edges with provenance and validity |
| `enrichments` | Never overwritten; field, value, confidence, provenance, model, reasoning, resolution level |
| `scores` | Intent / fading / ICP fit with factor JSON and input hash (incremental skip) |
| `decisions` / `outcomes` / `evaluations` / `calibration` | The decision loop: trace, embedding, priors, expected vs actual, verdicts, learned adjustments |
| `intelligence_cache` | AI outputs by input hash + TTL with hit counters |
| `cost_ledger` | Every operation: level, model, tokens, dollars, cache flag |
| `events` / `audit_log` / `sync_state` | Pipeline event log, sensitive-action audit, connector cursors |

## Module map

```
src/
  signals/registry.ts      typed signal catalog (zod) + identifier extraction
  connectors/              sdk (ingest/sync) · csv · github · fixture
  identity/resolve.ts      union-find co-occurrence + probabilistic matching + review queue
  graph/store.ts           entities, edges, person view
  intelligence/            behavior windows · scores (+ role enrichment gating) · segments
  cost/                    router (levels, budget, ledger) · cache
  ai/                      providers (mock $0, anthropic) · aggregates-only prompts
  decisions/               reason (traces, gate) · memory · evaluate · learn
  automations/digest.ts    weekly GTM digest (+ optional Slack)
  privacy/dsar.ts          export + erasure
  pipeline/                run (stage orchestration) · events (log/audit)
  api/server.ts            Fastify REST + static dashboard
web/                       vanilla-JS dashboard (live API or static demo snapshot)
scripts/                   demo, demo-core, build-demo-data
```

## Swap paths (all behind existing interfaces)

- **SQLite → Postgres + pgvector**: `db.ts` and repository functions; RLS enables multi-tenancy (ADR-0004, ADR-0012).
- **Local hash embeddings → real embedding model**: `util.localEmbed` is the single entry point (L1 stays L1).
- **Mock ↔ Anthropic provider**: `ai/provider.ts` interface; any other provider is one class.
- **In-process pipeline → queued workers**: stages are already pure functions over the store; a queue slots between them.
