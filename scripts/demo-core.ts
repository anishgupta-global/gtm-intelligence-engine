import type { DB } from '../src/db.js';
import { loadCrmSignals } from '../src/connectors/csv.js';
import { loadFixtureSignals, arrayConnector } from '../src/connectors/fixture.js';
import { syncConnector, ingestSignal } from '../src/connectors/sdk.js';
import { generateMarketplace } from './synth.js';
import { runPipeline } from '../src/pipeline/run.js';
import { getProvider } from '../src/ai/provider.js';
import { listActivePersons, getPersonObservations, reviewQueue, approveMerge } from '../src/identity/resolve.js';
import { hotLeads, hotLeadCount, fadingChampions } from '../src/intelligence/scores.js';
import { audienceSummary } from '../src/intelligence/segments.js';
import { setDecisionStatus, listDecisions, type DecisionRecord } from '../src/decisions/reason.js';
import { platformStats } from '../src/intelligence/platforms.js';
import { companyStats } from '../src/intelligence/companies.js';
import { recordOutcome, evaluationMetrics } from '../src/decisions/evaluate.js';
import { updateCalibration } from '../src/decisions/learn.js';
import { costReport } from '../src/cost/router.js';
import { buildDigest } from '../src/automations/digest.js';
import { exportPerson, erasePerson } from '../src/privacy/dsar.js';
import { DECISION_KIND } from '../src/decisions/reason.js';

/**
 * End-to-end demo: Northwind Eats, a fictional two-sided food-delivery marketplace.
 * Restaurant partners (B2B) + consumers (B2C) share ONE engine and ONE decision loop.
 * Walk: ingest 6 acquisition sources + orders -> resolve identities -> graph -> score ->
 * growth pack decides (where to invest, who to contact, which account to save) ->
 * outcome recorded -> learning -> the next decision carries a memory prior -> DSAR.
 */

/** Cross-source consumer — Ben appears in Instagram, TikTok, Google, Newsletter, and Orders. */
const CROSS_SOURCE_EMAIL = 'ben.novak@example.com';
/** Adversarial same-name pair — Ana Vasquez the restaurant owner (@Taco Piso) and Ana Vasquez the customer. */
const ADVERSARIAL_NAME = 'Ana Vasquez';
/** DSAR target — Oscar has exactly 3 observations (tiktok visit, newsletter open, one order). */
const DSAR_EMAIL = 'oscar.lindberg@example.com';

/** Second-week signals arriving via the universal webhook. Includes a new
 *  restaurant partner (Skybite Pizza) with strong hand-raise signals. */
const WEEK2_SIGNALS = [
  { signalType: 'form_submit', externalId: 'form:eli', daysAgo: 0, actor: { email: 'eli@skybite.de', name: 'Eli Fischer', company: 'Skybite Pizza', title: 'Owner', employees: 18, industry: 'food' }, props: { form: 'premium_placement_enquiry' }, consentBasis: 'consent' },
  { signalType: 'pricing_view', externalId: 'pv:eli', daysAgo: 0, actor: { email: 'eli@skybite.de' }, props: { path: '/partners/pricing' } },
  { signalType: 'demo_request', externalId: 'demo:eli', daysAgo: 0, actor: { email: 'eli@skybite.de' }, props: { topic: 'onboarding' }, consentBasis: 'consent' },
  { signalType: 'demo_request', externalId: 'demo:ken2', daysAgo: 0, actor: { email: 'ken@sushirocket.de' }, props: { topic: 'multi_location_expansion' } },
  { signalType: 'pricing_view', externalId: 'pv:priya2', daysAgo: 0, actor: { email: 'priya@veganvista.de' }, props: { path: '/partners/pricing' } },
];

export interface DemoOutcome {
  summary: any;
  hot: any[];
  fading: any[];
  people: { total: number; people: any[] };
  platforms: any[];
  companies: any[];
  decisions: any[];
  evaluation: any;
  cost: any;
  digest: string;
  reviewQueue: any[];
  decision1: DecisionRecord;
  decision2: DecisionRecord;
  allocation: DecisionRecord | null;
  retention: DecisionRecord[];
  crossSourcePersonSources: string[];
  sameNameConflictCount: number;
  dsar: { exported: boolean; erasedObservations: number };
}

export async function runDemo(db: DB, log: (s: string) => void = () => {}, opts: { scale?: number } = {}): Promise<DemoOutcome> {
  const provider = getProvider();
  const scale = opts.scale ?? 1;
  log(`Provider: ${provider.name}${provider.name === 'mock' ? ' ($0 mode)' : ''}`);

  const synth = generateMarketplace(scale);
  log(`\n[1/8] Ingesting from 8 sources (~${synth.totals.consumers.toLocaleString()} consumers, ${synth.totals.merchants} restaurant partners, seeded + deterministic)...`);
  const t0 = Date.now();
  const connectors = [
    arrayConnector('crm', [...loadCrmSignals('data/fixtures/crm.csv'), ...synth.crm]),
    arrayConnector('instagram', [...loadFixtureSignals('data/fixtures/instagram.json'), ...synth.channels.instagram]),
    arrayConnector('tiktok', [...loadFixtureSignals('data/fixtures/tiktok.json'), ...synth.channels.tiktok]),
    arrayConnector('google', [...loadFixtureSignals('data/fixtures/google.json'), ...synth.channels.google]),
    arrayConnector('newsletter', [...loadFixtureSignals('data/fixtures/newsletter.json'), ...synth.channels.newsletter]),
    arrayConnector('referral', [...loadFixtureSignals('data/fixtures/referral.json'), ...synth.channels.referral]),
    arrayConnector('linkedin', [...loadFixtureSignals('data/fixtures/linkedin.json'), ...synth.channels.linkedin]),
    arrayConnector('orders', [...loadFixtureSignals('data/fixtures/orders.json'), ...synth.orders]),
  ];
  for (const c of connectors) {
    const r = await syncConnector(db, c);
    log(`  ${c.name.padEnd(10)} +${r.inserted.toLocaleString()} observations${r.duplicates ? ` (${r.duplicates} dups skipped)` : ''}`);
  }
  log(`  ingested in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  log('\n[2/8] Pipeline week 1: resolve -> graph -> score -> decide...');
  const t1 = Date.now();
  const r1 = await runPipeline(db, getProvider());
  log(`  identity: ${r1.resolve.persons.toLocaleString()} persons created, ${r1.resolve.merged} clusters merged, ${r1.resolve.review} sent to review`);
  log(`  graph: ${r1.graph.entities.toLocaleString()} entities, ${r1.graph.edges.toLocaleString()} edges · scores: ${r1.scores.computed.toLocaleString()} computed · pipeline ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  const crossPerson = (listActivePersons(db) as any[]).find((p) => p.primary_email === CROSS_SOURCE_EMAIL);
  const crossSourcePersonSources = crossPerson ? [...new Set(getPersonObservations(db, crossPerson.id).map((o: any) => o.source))] : [];
  log(`  cross-source resolve: ${crossPerson?.display_name} appears across [${crossSourcePersonSources.join(', ')}] — one person`);
  const sameNameConflictCount = (listActivePersons(db) as any[]).filter((p) => p.display_name === ADVERSARIAL_NAME).length;
  log(`  adversarial case: ${sameNameConflictCount} distinct "${ADVERSARIAL_NAME}" persons kept separate (restaurant owner vs consumer, different companies)`);

  const queue = reviewQueue(db);
  for (const q of queue) log(`  review queue: merge "${q.from?.display_name}" -> "${q.to?.display_name}" @ confidence ${q.confidence} (${q.keys.join(', ')})`);
  const queueSnapshot = JSON.parse(JSON.stringify(queue));
  if (queue.length) {
    approveMerge(db, queue[0].from.id, queue[0].to.id);
    log(`  approved: "${queue[0].from.display_name}" merged into "${queue[0].to.display_name}" (reversible — memberships retracted, not deleted)`);
  }

  log('\n[3/8] Weekly Growth Decisions (Growth pack, all L0 — grounded in observed data):');
  const openThisWeek = listDecisions(db).filter((d: any) => d.status === 'proposed');
  const KIND_ORDER = ['platform_allocation', 'weekly_gtm', 'account_retention'];
  openThisWeek.sort((a: any, b: any) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  openThisWeek.forEach((d: any, i: number) => {
    log(`  ${i + 1}. ${d.title}`);
    log(`     kind: ${d.kind} · confidence ${d.confidence} · expected ${d.expected.target} ${d.expected.metric}`);
    log(`     reason: ${d.trace.hypothesis}`);
    log(`     evidence: ${(d.trace.evidence ?? []).slice(0, 4).join(', ') || '—'}`);
  });

  const summary1 = audienceSummary(db);
  log(`\n  Marketplace this week: ${summary1.people.toLocaleString()} people (${summary1.consumers.toLocaleString()} consumers · ${summary1.merchants} merchant contacts) · +${summary1.newPeople7.toLocaleString()} NEW users this week · ${summary1.ordersThisWeek.toLocaleString()} orders (€${summary1.orderRevenue7.toLocaleString()})`);

  log('\n  Platform comparison (observed engagement — signups, conversion, merchant leads; never follower counts):');
  for (const p of platformStats(db)) {
    log(`  ${p.source.padEnd(10)} ${String(p.people.toLocaleString()).padStart(6)} people · +${String(p.newUsers7.toLocaleString()).padStart(5)} new/wk · signals ${p.growthPct >= 0 ? '+' : ''}${p.growthPct}% · conv ${Math.round(p.conversion * 100)}% · repeat ${Math.round(p.repeatRate * 100)}% · ${p.merchantLeads14} merch leads · q${p.quality} -> ${p.recommendation.toUpperCase()}`);
  }

  const hot1 = hotLeads(db, { limit: 6, side: 'merchant' });
  log('\n  Hot merchant leads (evidence for the who-to-contact decision):');
  for (const l of hot1) log(`  ${l.name} (${l.title ?? l.role}, ${l.company}) · intent ${l.intent} · ${l.action}`);
  const hotConsumers = hotLeads(db, { limit: 3, side: 'consumer' });
  log('  Top consumers: ' + hotConsumers.map((l) => `${l.name} (${l.intent})`).join(' · '));
  for (const f of fadingChampions(db, 3)) log(`  FADING: ${f.name} (${f.company ?? 'consumer'}) — engagement down ${Math.round(f.drop * 100)}%`);
  log('  accounts: ' + companyStats(db).slice(0, 4).map((c) => `${c.company} (intent ${c.maxIntent}${c.churnRisk >= 0.5 ? `, CHURN RISK €${(c.mrr + c.orderRevenue60).toLocaleString()}` : ''})`).join(' · '));

  const decision1 = r1.decision;
  log(`\n[4/8] Weekly GTM recommendation (${decision1.model}, level L${decision1.resolutionLevel}):`);
  log(`  ${decision1.title}`);
  log(`  hypothesis: ${decision1.trace.hypothesis}`);
  log(`  action:     ${decision1.trace.action}`);
  log(`  confidence: ${decision1.confidence} · expected: ${decision1.expected.target} ${decision1.expected.metric}`);

  log('\n[5/8] Closing the loop: accept -> execute -> outcome -> evaluate -> learn...');
  setDecisionStatus(db, decision1.id, 'accepted');
  const achieved = decision1.expected.target + 1;
  const evaluation1 = recordOutcome(db, decision1.id, achieved, 'demo: outreach ran, merchant conversations booked');
  const calibration = updateCalibration(db, DECISION_KIND);
  log(`  outcome: ${achieved} vs expected ${decision1.expected.target} -> attainment ${evaluation1.attainment} -> verdict: ${evaluation1.verdict}`);
  log(`  learning: calibration adjustment for '${DECISION_KIND}' is now ${calibration.adjustment >= 0 ? '+' : ''}${calibration.adjustment} (${calibration.samples} sample${calibration.samples === 1 ? '' : 's'})`);

  log('\n[6/8] Week 2: new signals arrive (universal webhook)...');
  for (const s of WEEK2_SIGNALS) ingestSignal(db, 'webhook', { ...s, observedAt: new Date().toISOString() });
  log(`  +${WEEK2_SIGNALS.length} signals (incl. Eli Fischer, Owner @ Skybite Pizza — a new merchant hand-raise)`);
  const r2 = await runPipeline(db, getProvider());
  const decision2 = r2.decision;
  log(`\n  Recommendation #2: ${decision2.title}`);
  log(`  confidence: ${decision2.confidence} (base ${decision2.baseConfidence}, calibration ${calibration.adjustment >= 0 ? '+' : ''}${calibration.adjustment}${decision2.priors.length ? `, memory prior from a past ${decision2.priors[0].verdict}` : ''})`);
  if (decision2.priors.length) {
    const p = decision2.priors[0];
    log(`  decision memory: ${Math.round(p.similarity * 100)}% similar to "${p.title}" -> ${p.verdict} (attainment ${p.attainment})`);
  }

  log('\n  Re-running the pipeline with no new data (the meaningful-change gate)...');
  const r3 = await runPipeline(db, getProvider());
  log(r3.decision.reused
    ? `  decision reused — aggregates unchanged, zero new AI spend (scores skipped: ${r3.scores.skipped})`
    : '  unexpected: a new decision was generated');

  log('\n[7/8] Engine health:');
  const ev = evaluationMetrics(db);
  const cost = costReport(db);
  log(`  decisions ${ev.decisionsTotal} · acceptance ${ev.acceptanceRate} · success ${ev.successRate} · mean calibration error ${ev.meanCalibrationError}`);
  log(`  work distribution: ${cost.levels.map((l: any) => `${l.label} ${l.pct}%`).join(' · ')}`);
  log(`  AI spend $${cost.totalSpendUsd} · cost per insight $${cost.costPerInsight} · cache hits ${cost.cacheHits}`);

  log('\n[8/8] Privacy (DSAR): export + erase...');
  const dsarTarget = (listActivePersons(db) as any[]).find((p) => p.primary_email === DSAR_EMAIL);
  const exported = dsarTarget ? exportPerson(db, dsarTarget.id) : null;
  const erased = dsarTarget ? erasePerson(db, dsarTarget.id) : { erasedObservations: 0 };
  log(`  exported ${dsarTarget?.display_name}'s full record (${exported?.observations?.length ?? 0} observations), then erased: payloads deleted, identifiers removed, tombstone kept`);

  const digest = buildDigest(db);
  const peopleTotal = (db.prepare(
    `SELECT COUNT(DISTINCT p.id) AS c FROM persons p JOIN person_memberships m ON m.person_id = p.id AND m.status = 'active' WHERE p.erased = 0`
  ).get() as any).c as number;
  const topPeople = (db.prepare(
    `SELECT p.id, p.display_name AS name, p.primary_email AS email, p.company, p.title,
            COUNT(DISTINCT m.identifier_key) AS identifiers, COALESCE(s.value, 0) AS intent
     FROM persons p
     JOIN person_memberships m ON m.person_id = p.id AND m.status = 'active'
     LEFT JOIN scores s ON s.entity_id = p.id AND s.score_type = 'intent'
     WHERE p.erased = 0 GROUP BY p.id ORDER BY (p.company IS NOT NULL) DESC, intent DESC LIMIT 200`
  ).all() as any[]).map((p) => ({ ...p, side: p.company ? 'merchant' : 'consumer' }));
  return {
    summary: { ...audienceSummary(db), hotLeads: hotLeadCount(db), fading: fadingChampions(db).length, provider: provider.name, budget: cost.budget },
    hot: [...hotLeads(db, { limit: 10, side: 'merchant' }), ...hotLeads(db, { limit: 10, side: 'consumer' })],
    fading: fadingChampions(db, 20),
    people: { total: peopleTotal, people: topPeople },
    platforms: platformStats(db),
    companies: companyStats(db).slice(0, 60),
    decisions: listDecisions(db),
    evaluation: evaluationMetrics(db),
    cost: costReport(db),
    digest,
    reviewQueue: queueSnapshot,
    decision1,
    decision2,
    allocation: r2.allocation ?? r1.allocation,
    retention: r2.retention.length ? r2.retention : r1.retention,
    crossSourcePersonSources,
    sameNameConflictCount,
    dsar: { exported: !!exported, erasedObservations: erased.erasedObservations },
  };
}
