# Changelog

## 1.3.0 — 2026-07-25

Marketplace at real scale: ~25,000 people (5,200+ new users/week) + 180 restaurant partners, generated deterministically. Fixes the round-7 audit's scale miss and everything the small dataset was hiding.

- **Seeded synthetic generator** (`scripts/synth.ts`): channel-attributed signups (the honest, observable version of "5k+ followed us" — UTM-attributed registrations on your own app), engagement, orders, partner payouts, merchant enquiries; internally consistent per-channel economics; `scale` parameter (tests run at 5%, demo at 100%)
- **Performance for 25k+**: transactional ingestion + scoring, bulk workspace loader (one scan instead of 25k per-person queries), email-cluster fast path in identity resolution (O(N) instead of O(N²) name matching), entity cache in graph build. Full demo: ~30s
- **Cost gate for signal-sparse consumers**: no title + no company + <5 signals → role classification skipped at L0 instead of paying L2 for a guaranteed "unknown". L0 share at 25k scale: **99%** (fixes the round-7 trade-off, restores the ≥70% CI assertion)
- **Channel cohort economics** in platform intelligence: first-touch attribution, new users/wk, order conversion, repeat rate, avg order value, merchant-lead yield; quality judges the *active* cohort (not years of dormant users)
- **Differentiated platform calls**: double down · increase budget · maintain (B2C awareness) · protect · expand incentives · nurture · re-engage · reduce effort; `orders`/`crm`/`webhook` excluded from investable channels
- **As-of-window segmentation**: last week's "New consumers" compared against last week's new cohort — kills the "+719,700%" artifact; marketplace segments (Merchant partners / New / Returning / High-value / Browsing consumers)
- **Side-aware intelligence**: merchant vs consumer leads (side pushed into SQL), consumer-appropriate actions (loyalty invite, first-order promo), digest splits merchant leads from top consumers
- **Decision hygiene**: a fresh decision supersedes prior *proposed* (never-acted-on) decisions of the same kind — one open call per question; retention scoped per company, capped at top-3 revenue-at-risk
- Allocation decision prefers the strategic "double down" channel and folds the tactical budget bump + awareness-hold + cut into one action
- Scale-safe API: `/api/people` paginated with total; `side` filter on leads; KPIs show consumers/merchants/orders/revenue

## 1.2.0 — 2026-07-25

Demo dataset swap: the engine is now demonstrated on a fictional two-sided food-delivery marketplace (Northwind Eats). Same architecture, decision loop, APIs, database schema, evaluation, and cost system — only fixtures, dashboard labels, and digest wording change.

- **Two-sided workspace**: 12 restaurant partners + 15 consumers × 6 acquisition sources (instagram, tiktok, google, newsletter, referral, linkedin) + orders payments + universal webhook
- **Digest reordered**: opens with a numbered "Weekly Growth Decisions" list (allocation → who-to-contact → account-to-save), each with reason, action, evidence, confidence, expected outcome, and memory prior
- **Dashboard labels**: `Restaurant partners`, `Revenue (60d)`, workspace badge → "Northwind Eats"; column set unchanged in the API
- **ICP config**: workspace ICP tuned for restaurant merchants (industries=food, minEmployees=5) — consumers still surface via intent × 0.6 baseline
- **`csvCrmConnector` gains an optional `name` param** — connector name = source name; defaults to `crm` (was `crm_csv`)
- Fixtures reshaped so the engine produces the requested outputs from grounded data: Instagram (partner enquiries + consumer clicks), Google (menu views + orders → highest intent), Newsletter (small loyal cohort), Referral (low volume high LTV), LinkedIn (merchant leads), Orders (customer payments + partner payouts)
- Marco Rossi @ Pizza Corner engineered as the churn-risk case (€6,400 observed revenue, no signals in 14 days → `account_retention` decision fires at 0.85)
- 3 fixtures deleted (`github.json`, `website.json`, `stripe.json`); tests updated to look up the new demo persons (Ben Novak cross-source across 5 platforms, Ana Vasquez × 2 adversarial pair, Sara K.→Sara Kim review queue, Oscar Lindberg DSAR)
- Cost pyramid CI assertion relaxed from ≥70% L0 to ≥60% L0+L1 free-tier + L0 ≥ 40% plurality — larger multi-source workspaces classify more consumers-without-titles, but the "AI is a last resort" principle holds

## 1.1.0 — 2026-07-25

The engine becomes explicit: capabilities ship as **decision packs** on one shared decision loop (ADR-0013). Wedge evolved: *where should you invest — and who should you talk to there.*

- **Platform intelligence** (`/api/platforms`): per-source rollups from observed engagement (people, active, signals/week, growth, avg intent, hot-lead yield, quality) + a per-platform call — never follower counts the engine can't ground
- **`platform_allocation` decision kind**: the weekly "invest here, reduce there" call as a real decision with trace, evidence, expected metric, memory, and calibration
- **`account_retention` decision kind**: churn-risk accounts produce spam-gated retention decisions
- **Company intelligence** (`/api/companies`): accounts rolled up from the graph — people, intent, ICP fit, churn risk, observed MRR
- **No hardcoded top-N**: `limit`/`role`/`minIntent`/`company` filters on the leads API + a filter bar in the UI
- **Pack-aware dashboard**: Executive (allocation call + platform comparison) / Business / Audience / Decisions / Cost & health
- Digest now opens with "Where to invest" and includes accounts-to-save; outcome recording calibrates per decision kind
- Principle 13 added: decisions over dashboards — every feature must introduce a new decision, not a visualization
- Demo reset now fails loudly if the DB is held by a running server (was: silent reuse); 4 new growth-pack tests (20 total)

## 1.0.0 — 2026-07-25

Initial release.

- Connector SDK + 5 connectors (CSV CRM, GitHub official API/fixture, newsletter/website/payments fixtures) + universal webhook
- Typed signal registry (12 signal types, zod-validated, consent-tagged)
- Identity resolution: deterministic co-occurrence + probabilistic matching, virtual clusters, human review queue, reversible merges
- Knowledge graph (entities + typed edges with provenance)
- Behavior windows + L0 scores (intent, fading, ICP fit) with factor breakdowns, incremental via input hashes
- Cost engine: L0–L3 pyramid, model router, monthly budget with graceful degradation, intelligence cache, per-operation ledger, cost-per-insight KPI
- Reasoning engine: aggregates-only prompts, structured traces (evidence → hypothesis → reasoning → action → confidence)
- Decision engine: lifecycle, decision memory with similarity priors
- Evaluation engine: expected vs actual, verdicts, calibration error, acceptance/success rates
- Learning engine: damped per-kind confidence calibration
- Weekly GTM digest (+ optional Slack webhook), DSAR export/erasure, audit log
- Dashboard (Leads / People / Decisions / Cost & health) with static-demo fallback
- $0 grounded mock provider + optional Anthropic provider (Haiku for L2, Sonnet for L3)
- 16 tests incl. identity golden pairs, cost-distribution assertion, full decision-loop e2e
