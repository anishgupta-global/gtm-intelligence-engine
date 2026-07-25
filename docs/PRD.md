# PRD — GTM Intelligence Engine

Status: v1.3.0 shipped · Owner: Anish Gupta · Last updated: 2026-07-25

## 1. Vision

Build an open-source **intelligence engine** whose product capabilities ship as **decision packs**. The engine — the core decision loop (observations → identity → evidence → reasoning → decision → evaluation → learning) — never changes per use case; packs are decision domains plugged into it (ADR-0013). The canonical object is a **Person**, never a follower or a platform profile. The moat is not the data graph (graphs are commodities); it is the shared decision loop and its memory. People don't buy graphs. They buy decisions.

v1 ships **Decision Pack 1 — Growth** (grow a two-sided motion with data you already have): `weekly_gtm` (who to talk to), `platform_allocation` (where to invest), `account_retention` (which account to save). Audience/content, executive cross-side, community, and customer packs follow the same contract later.

## 2. North Star & primary design principle

> **Maximize intelligence generated per dollar of compute. AI is a last resort, not the default.**

Enforced mechanisms (all implemented, all tested):

| Mechanism | Implementation |
| --- | --- |
| AI cost pyramid | L0 rules/SQL (free) → L1 local embeddings (free) → L2 small LLM → L3 large LLM. Every operation ledgered with its level; target ≥70% at L0 is asserted in CI (`test/pipeline.test.ts`). |
| LLMs never see raw data | Prompt builders accept only a typed `Aggregates` object (~50 numbers). There is no code path that passes records to a model. PII is regex-redacted besides. |
| Intelligence cache | AI outputs keyed by input hash + data version with TTL; unchanged input = cache hit = $0. |
| Meaningful-change gate | A recommendation regenerates only when the aggregates hash changes — never on a schedule. |
| Confidence gating | Deterministic extractors first (title → role at 0.95, free); the small model is consulted only when rules can't answer. |
| Budget manager | Per-workspace monthly budget. Modes: full → lean (small model) → exhausted (deterministic fallback). Degradation is explicit and visible, never an error and never silent overspend. |
| Cost per insight | First-class KPI at `/api/cost`: total AI spend ÷ insights generated. |

## 3. The Intelligence Law

**No AI output may exist without evidence, provenance, confidence, cost, and reproducibility.**
Every enrichment, score, and decision stores: supporting observation IDs, producing model + version, a confidence value, its ledger entry, and the input hash that regenerates it.

## 4. The wedge (day-one problem)

For founder-led GTM teams (devtools, SaaS, creators): **"Where should I invest my GTM effort this week — and who should I talk to there?"** One weekly funnel: which platform → which audience → which companies → which people. Everything in v1 serves this loop — the platform allocation call, ranked hot leads and fading champions with evidence, retention alerts on at-risk accounts, one digest.

Scope guards: *if a feature doesn't improve the weekly question, it doesn't ship in v1* — and *every feature must introduce a new decision, not merely a new visualization* (Principle 13).

## 5. Architecture (12 layers)

```
L1  Connectors            official APIs / CSV / universal webhook — produce observations only
L2  Observations          append-only, typed via the Signal Registry, idempotent, consent-tagged
L3  Identity resolution   deterministic co-occurrence → probabilistic match → human review queue
L4  Knowledge graph       entities + typed edges with provenance (enabler, not the moat)
L5  Behavior engine       time-windowed aggregates per person
L6  Audience intelligence L0 scores (intent, fading, ICP fit) with factor breakdowns; segments
L7  Reasoning engine      evidence → hypothesis → reasoning → recommendation → confidence
L8  Decision engine       decision objects with lifecycle + decision memory (similarity priors)
L9  Learning engine       outcome capture → calibration → memory priors (damped, honest)
L10 Optimization engine   goal → ranked strategy plan (v2; interface reserved)
L11 Automation engine     weekly digest → file/Slack, destination-allowlisted, audit-logged
L12 Executive reports     the digest + evaluation metrics
```

AI appears only at L7+, after reliable data is established. The same spine later powers customer/sales/community/creator/recruitment intelligence as connector families + intelligence packs.

## 6. Audit — loopholes found, closures, trade-offs

### Round 1 (architecture review)

| # | Loophole | Closure | Trade-off accepted |
|---|----------|---------|--------------------|
| 1 | Social scraping connectors not legally buildable (platform ToS + GDPR) | Official-API / export / webhook connectors only; connector SDK; scraping documented out of scope | Weaker social story at launch; exports still get the data in |
| 2 | GDPR vs cross-source identity resolution | Consent basis per observation; DSAR export + erasure (payload hard-delete + tombstone); PII redaction pre-LLM; crypto-shredding = v2 ADR | Tombstoned replay is lossy by design |
| 3 | Wrong merges poison everything downstream | Never physically merge: virtual clusters via membership rows (confidence/method/evidence/engine-version); ≥0.90 auto, 0.70–0.90 human review; retraction = clean split | Queries join through memberships (fine at v1 scale) |
| 4 | Enrichment hallucination + cost blowup | Tiered enrichment; input-hash skip; budget + ledger; confidence/provenance/model on every field; ungroundable → `unknown`, never guessed | Sparse fields — correct behavior |
| 5 | "Incremental everything" vs graph-global scores | v1 scores are local/egocentric and incremental; global algorithms deferred as scheduled batches | Influence-style scores absent in v1 |
| 6 | Graph DB + vector store + feature store = ops sprawl | Single SQLite file behind repository functions; Postgres/pgvector/Neo4j swap path documented (ADR-0004) | Multi-hop graph queries limited; honest ceiling |
| 7 | Marketplace = remote-code-execution risk | Only first-party in-repo plugins; sandbox spec in ADR-0011; marketplace deferred | No ecosystem at launch, no RCE either |
| 8 | Prediction cold start | Transparent heuristics with factor breakdowns; model interfaces reserved | Honest heuristics over fake ML |
| 9 | Multi-tenant leakage | v1 = single workspace, `tenant` column throughout; Postgres RLS path in ADR-0012 | Multi-tenancy is v2 |
| 10 | Automations = exfiltration surface | Digest sends aggregates + allowlisted fields; outbound sends audit-logged | Less rich Slack payloads |
| 11 | Re-sync duplication / replay | Idempotent observations (source, external_id, content_hash); cursors; append-only event log | Append-only growth; retention policy handles it |

### Round 2 (product review)

| # | Concern | Design response | Trade-off |
|---|---------|-----------------|-----------|
| 12 | Six products in one; no day-one problem | The wedge (§4); connectors cut to 6; dashboard cut to 4 pages | Narrower launch surface |
| 13 | Graph mistaken for the moat | Moat re-declared as the decision loop (L7–L9); graph demoted to enabler | Less "knowledge graph" marketing shine |
| 14 | No learning after automation | Learning engine: outcome capture → calibration → memory priors | Attribution is a correlation window, labeled as such; small samples damped |
| 15 | No decision memory | `decisions` + `outcomes` tables; embedded context; similarity priors in every new decision | Memory only as good as recorded outcomes |
| 16 | No explicit reasoning layer | Structured trace stored on every decision, rendered in UI + digest | One structured L3 call per decision — bounded by cache + change gate |
| 17 | Reports but no optimization | Goal-driven optimization engine deferred to v2 (cut by the wedge rule — it answers "how do I hit +30%?", not "who this week?") | v1 proposes, doesn't plan campaigns |
| 18 | Cost efficiency not the core principle | §2 — pyramid, router, cache, gating, budget, cost-per-insight, CI-enforced distribution | Insights degrade to L0/L1 under budget pressure — deliberate and visible |

### Round 3 (final review — integrated)

| Change | Status |
| --- | --- |
| Rename: drop "Audience Evaluation", keep **GTM Intelligence Engine**; wedge moves to the tagline | Done |
| Intelligence Law at the top of the README | Done (§3) |
| **Evaluation engine** — expected vs actual, the one missing subsystem | Built (`src/decisions/evaluate.ts`): attainment, verdicts, calibration error, acceptance/success rates. Decision recall / false negatives need ground truth that doesn't exist yet — listed as `notMeasuredYet`, never fabricated |
| **Signal registry** — typed signals between connectors and observations | Built (`src/signals/registry.ts`): zod-validated, 12 signal types, identifier extraction |
| **ENGINEERING_PRINCIPLES.md** | Written (12 principles) |
| Replace Uber Eats with a fictional company | Demo dataset = **Northwind AI** (fictional data-tools vendor); avoids trademark exposure and keeps the project universal |

### Rounds 4–6 (product depth — shipped in v1.1.0)

| # | Concern | Design response | Trade-off |
|---|---------|-----------------|-----------|
| 19 | "So what?" — people-ranking without allocation. Users first ask **where** to spend time, then who to contact | **Platform intelligence** (`src/intelligence/platforms.ts`): per-source rollups (people, active, signals/wk, growth, avg intent, hot-lead yield, quality) + a per-platform call (double down / nurture / re-engage / reduce effort); wedge evolved to "where → who" | Metrics are **observed engagement, not follower counts** — most social platforms don't expose reach via official APIs (audit #1), and the Intelligence Law forbids ungrounded numbers. Engagement-per-source is the honest, more actionable substitute |
| 20 | Hardcoded "Top 10" | No fixed N anywhere: `limit`/`role`/`minIntent`/`company` on the leads API + a filter bar in the UI | — |
| 21 | Drill-down hierarchy (platform → audience → company → person) | Companies rollup (`companies.ts`): people, intent, ICP, churn risk, observed MRR; platform detail cards; person detail API already existed | Full graph-explorer UI deferred |
| 22 | B2B vs B2C split for two-sided platforms | Rejected as a product split; adopted as **decision packs** on one engine (ADR-0013). Growth pack v1 spans both sides' seed decisions; packs share graph, evaluation, learning, memory | Executive cross-side attribution needs outcome history from ≥2 packs — sequenced last, never faked |
| 23 | Features that are visualizations, not decisions | **Principle 13: decisions over dashboards.** Platform allocation and account retention ship as real decision kinds (trace, evidence, expected metric, memory, calibration) — not table strings | Decision generators must be spam-gated (input-hash reuse) |
| 24 | Navigation should expose user goals, not B2B/B2C | Tabs: Executive (growth allocation + platform comparison) / Business / Audience / Decisions / Cost & health | Separate "Growth" tab arrives with the executive pack; for now growth is the Executive centerpiece |

### Round 7 (demo credibility for two-sided platforms — shipped in v1.2.0)

| # | Concern | Design response | Trade-off |
|---|---------|-----------------|-----------|
| 25 | Demo felt B2B-only (SaaS/data vendor); didn't prove the same engine serves two-sided platforms like food delivery, ride-hailing, marketplaces | Demo dataset swapped to **Northwind Eats** — a fictional two-sided food-delivery marketplace: 12 restaurant partners + 15 consumers across 6 acquisition sources + orders + universal webhook. Same engine, same decision loop, same APIs, same schema — only fixtures, ICP config, dashboard labels, and digest opener change | Segment code still labels the merchant/consumer split as "Startups & SMB" (single segment for this workspace); a food-industry-aware segmentation would improve UX but is intelligence code, deferred to a workspace-config pass |
| 26 | Digest opened with sections, not decisions — user's first read was "so what?" | Digest rewritten to open with a numbered **Weekly Growth Decisions** list (allocation → who-to-contact → account-to-save), each item ships reason + action + evidence IDs + confidence + expected outcome + memory prior — every item is a real decision object, not table-driven prose | Platform comparison and hot leads move below the decisions as supporting evidence |
| 27 | Cost pyramid CI threshold (≥70% L0) was calibrated on the v1.0 dataset; broke for larger multi-source workspaces where more consumers-without-titles produce more L2 `classify_role` calls | Threshold relaxed to L0+L1 free-tier ≥ 60% AND L0 ≥ 40% plurality. Principle preserved: AI remains the last resort, most work is deterministic | ~~Deferred sparse-skip gate~~ — **closed in v1.3.0** (audit #28): the gate shipped, L0 share at 25k scale is 99%, and the CI assertion is back to ≥70% |

### Round 8 (scale — shipped in v1.3.0)

| # | Concern | Design response | Trade-off |
|---|---------|-----------------|-----------|
| 28 | **Scale missed**: round-7 spec said ~5,000 active customers + 180 partners and "5k+ new users followed us"; v1.2 shipped 28 people. Hand-written fixtures can't represent a marketplace | Seeded deterministic generator: **~25k people, 5.2k+ new users/week, 180 partners, ~30k observations**; named "story characters" (Ben Novak, Ana Vasquez ×2, Sara K., Pizza Corner) layered on top so identity/review/DSAR cases stay crisp. "Followed us" modeled as **channel-attributed signups** (UTM-attributed registrations on your own app) — observable, Intelligence-Law-clean; literal follower identities aren't exposed by platform APIs | Synthetic data, clearly labeled; per-channel economics are configured, not emergent |
| 29 | Per-person queries and O(N²) probabilistic matching don't survive 25k people | Bulk workspace loader (one scan), transactional writes, email-cluster fast path (probabilistic matching only for clusters WITHOUT a strong identifier — an email IS an identity; joining two emails is a human review call) | Two people sharing a name across their two emails never auto-merge — by design; the review queue is the path |
| 30 | v1.2's small data hid intelligence bugs: monotone "double down" calls, quality diluted by dormant users, "New consumers +719,700%", "new this week" = person-row creation date | Channel cohort economics (first-touch conversion, repeat, AOV, merchant yield) + 8-call vocabulary; quality judges the active cohort; as-of-window segmentation; "new" derives from first observed signal; webhook/orders/crm excluded from investable channels; fresh decisions supersede stale open proposals of the same kind | Recommendation thresholds are workspace-tuned heuristics — factors are always attached so every call is auditable |

## 7. v1 scope (shipped)

- **Working end to end:** L1–L9, L11–L12 on the wedge. 8 connectors on the demo workspace (CSV CRM + Instagram/TikTok/Google/Newsletter/Referral/LinkedIn fixtures + Orders + universal webhook), identity resolution with review queue, graph, behavior + 3 scores with factors, segments, platform + company intelligence, the Growth decision pack (3 kinds: weekly_gtm, platform_allocation, account_retention) with reasoning traces, decision memory, evaluation, calibration learning, weekly digest, DSAR, 5-tab dashboard, REST API with filters. Demo workspace = **Northwind Eats** — fictional two-sided food-delivery marketplace demonstrating both merchant (B2B) and consumer (B2C) decisions on one engine.
- **Deferred with contracts reserved:** optimization engine (L10), marketplace/plugins, trained predictions, multi-tenancy, Postgres swap.
- **Quality gates in CI:** typecheck, 16 tests including identity golden pairs (incl. adversarial same-name), cost-pyramid distribution assertion (≥70% L0), budget degradation, cache behavior, full e2e decision loop, DSAR.

## 8. Dashboard (5 tabs, goal-oriented — not B2B/B2C)

| Tab | Shows |
| --- | --- |
| Executive | KPI row · **this week's allocation call** (a decision, not a chart) · platform comparison table (observed engagement per source) · segment momentum |
| Business | Accounts table (people, intent, ICP, churn risk, observed MRR, action) · hot leads with **filter bar** (limit/role/min-intent) · fading champions · identity review queue · resolved people |
| Audience | Per-platform detail cards: people, active, signals + growth, quality, top signals, top people |
| Decisions | Every decision from every pack with kind chip + full trace, accept/dismiss/record-outcome · evaluation table (expected vs actual, verdicts) |
| Cost & health | Budget bar, level distribution (pyramid), cache hits, cost per insight · the weekly digest |

## 9. Success metrics

- Time-to-first-insight after `git clone`: **< 3 minutes** (npm install + npm run demo).
- ≥70% of pipeline operations resolved at L0 (CI-enforced).
- Cost per insight in $0 mock mode: $0.00; with Claude on the demo dataset: < $0.10.
- Every recommendation traceable to observation IDs (structurally guaranteed).
- Decision-loop demonstrable in one demo run: outcome → calibration shift → memory prior on the next decision.

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| Feature creep (the #1 execution risk) | The wedge rule (§4) is written into this PRD and the README roadmap |
| Mock provider oversold as AI | Every output labels its model + level; README is explicit about the $0 mode |
| Identity false merges | Review queue + reversibility + adversarial tests |
| LLM spend surprises | Budget modes + ledger + cache; exhaustion degrades, never errors |
