import type { DB } from '../src/db.js';
import { config } from '../src/config.js';
import { csvCrmConnector } from '../src/connectors/csv.js';
import { githubConnector } from '../src/connectors/github.js';
import { fixtureConnector } from '../src/connectors/fixture.js';
import { syncConnector, ingestSignal } from '../src/connectors/sdk.js';
import { runPipeline } from '../src/pipeline/run.js';
import { getProvider } from '../src/ai/provider.js';
import { listActivePersons, getPersonObservations, reviewQueue, approveMerge } from '../src/identity/resolve.js';
import { hotLeads, fadingChampions } from '../src/intelligence/scores.js';
import { audienceSummary } from '../src/intelligence/segments.js';
import { setDecisionStatus, listDecisions, type DecisionRecord } from '../src/decisions/reason.js';
import { recordOutcome, evaluationMetrics } from '../src/decisions/evaluate.js';
import { updateCalibration } from '../src/decisions/learn.js';
import { costReport } from '../src/cost/router.js';
import { buildDigest } from '../src/automations/digest.js';
import { exportPerson, erasePerson } from '../src/privacy/dsar.js';
import { DECISION_KIND } from '../src/decisions/reason.js';

/**
 * The full engine walked end to end on the Northwind AI demo dataset (a fictional
 * data-tools vendor): ingest -> resolve -> graph -> score -> reason -> decide ->
 * outcome -> evaluate -> learn -> decide again (now with memory) -> digest -> DSAR.
 */

const WEEK2_SIGNALS = [
  { signalType: 'form_submit', externalId: 'form:dana', daysAgo: 0, actor: { email: 'dana.wolf@skyforge.dev', name: 'Dana Wolf', company: 'Skyforge Systems', title: 'Head of Data', employees: 800, industry: 'software' }, props: { form: 'architecture-webinar' }, consentBasis: 'consent' },
  { signalType: 'pricing_view', externalId: 'pv:dana', daysAgo: 0, actor: { email: 'dana.wolf@skyforge.dev' }, props: { path: '/pricing' } },
  { signalType: 'demo_request', externalId: 'demo:dana', daysAgo: 0, actor: { email: 'dana.wolf@skyforge.dev' }, props: { source: 'website' }, consentBasis: 'consent' },
  { signalType: 'demo_request', externalId: 'demo:sam', daysAgo: 0, actor: { email: 'sam.okafor@brightqueue.io' }, props: { source: 'newsletter' } },
  { signalType: 'pricing_view', externalId: 'pv:priya2', daysAgo: 0, actor: { email: 'priya.nair@quantabio.com' }, props: { path: '/pricing' } },
];

export interface DemoOutcome {
  summary: any;
  hot: any[];
  fading: any[];
  people: any[];
  decisions: any[];
  evaluation: any;
  cost: any;
  digest: string;
  reviewQueue: any[];
  decision1: DecisionRecord;
  decision2: DecisionRecord;
  mayaSources: string[];
  alexKumarCount: number;
  dsar: { exported: boolean; erasedObservations: number };
}

export async function runDemo(db: DB, log: (s: string) => void = () => {}): Promise<DemoOutcome> {
  const provider = getProvider();
  log(`Provider: ${provider.name}${provider.name === 'mock' ? ' ($0 mode)' : ''}`);

  log('\n[1/8] Ingesting from 5 sources (connectors only ever write observations)...');
  const connectors = [
    csvCrmConnector('data/fixtures/crm.csv'),
    githubConnector('data/fixtures/github.json', config.githubRepo || undefined),
    fixtureConnector('newsletter', 'data/fixtures/newsletter.json'),
    fixtureConnector('website', 'data/fixtures/website.json'),
    fixtureConnector('stripe', 'data/fixtures/stripe.json'),
  ];
  for (const c of connectors) {
    const r = await syncConnector(db, c);
    log(`  ${c.name.padEnd(12)} +${r.inserted} observations${r.duplicates ? ` (${r.duplicates} dups skipped)` : ''}`);
  }

  log('\n[2/8] Pipeline week 1: resolve -> graph -> score -> reason...');
  const r1 = await runPipeline(db, getProvider());
  log(`  identity: ${r1.resolve.persons} persons created, ${r1.resolve.merged} clusters merged, ${r1.resolve.review} sent to review`);
  log(`  graph: ${r1.graph.entities} entities, ${r1.graph.edges} edges · scores: ${r1.scores.computed} computed`);

  const maya = (listActivePersons(db) as any[]).find((p) => p.primary_email === 'maya.chen@lumenpay.io');
  const mayaSources = maya ? [...new Set(getPersonObservations(db, maya.id).map((o: any) => o.source))] : [];
  log(`  cross-source merge: Maya Chen resolved across [${mayaSources.join(', ')}] — one person, ${maya?.identifier_count} identifiers`);
  const alexKumarCount = (listActivePersons(db) as any[]).filter((p) => p.display_name === 'Alex Kumar').length;
  log(`  adversarial case: ${alexKumarCount} distinct "Alex Kumar" persons kept separate (different companies)`);

  const queue = reviewQueue(db);
  for (const q of queue) log(`  review queue: merge "${q.from?.display_name}" -> "${q.to?.display_name}" @ confidence ${q.confidence} (${q.keys.join(', ')})`);
  const queueSnapshot = JSON.parse(JSON.stringify(queue));
  if (queue.length) {
    approveMerge(db, queue[0].from.id, queue[0].to.id);
    log(`  approved: "${queue[0].from.display_name}" merged into "${queue[0].to.display_name}" (reversible — memberships retracted, not deleted)`);
  }

  const hot1 = hotLeads(db, 10);
  log('\n[3/8] Who to talk to this week:');
  for (const l of hot1) log(`  ${l.name} (${l.title ?? l.role}, ${l.company ?? '—'}) · intent ${l.intent} · ${l.action}`);
  for (const f of fadingChampions(db, 5)) log(`  FADING: ${f.name} (${f.company}) — engagement down ${Math.round(f.drop * 100)}%`);
  log('  segment momentum: ' + audienceSummary(db).segments.map((x: any) => `${x.segment} ${x.deltaPct >= 0 ? '+' : ''}${x.deltaPct}%`).join(' · '));

  const decision1 = r1.decision;
  log(`\n[4/8] Recommendation #1 (${decision1.model}, level L${decision1.resolutionLevel}):`);
  log(`  ${decision1.title}`);
  log(`  hypothesis: ${decision1.trace.hypothesis}`);
  log(`  reasoning:  ${decision1.trace.reasoning}`);
  log(`  action:     ${decision1.trace.action}`);
  log(`  confidence: ${decision1.confidence} · expected: ${decision1.expected.target} ${decision1.expected.metric} · evidence: ${decision1.trace.evidence.slice(0, 4).join(', ')}`);

  log('\n[5/8] Closing the loop: accept -> execute -> outcome -> evaluate -> learn...');
  setDecisionStatus(db, decision1.id, 'accepted');
  const achieved = decision1.expected.target + 1;
  const evaluation1 = recordOutcome(db, decision1.id, achieved, 'demo: outreach ran, conversations booked');
  const calibration = updateCalibration(db, DECISION_KIND);
  log(`  outcome: ${achieved} vs expected ${decision1.expected.target} -> attainment ${evaluation1.attainment} -> verdict: ${evaluation1.verdict}`);
  log(`  learning: calibration adjustment for '${DECISION_KIND}' is now ${calibration.adjustment >= 0 ? '+' : ''}${calibration.adjustment} (${calibration.samples} sample${calibration.samples === 1 ? '' : 's'})`);

  log('\n[6/8] Week 2: new signals arrive (universal webhook)...');
  for (const s of WEEK2_SIGNALS) ingestSignal(db, 'webhook', { ...s, observedAt: new Date().toISOString() });
  log(`  +${WEEK2_SIGNALS.length} signals (incl. Dana Wolf, Head of Data @ Skyforge Systems — 800 employees)`);
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
  const linZhang = (listActivePersons(db) as any[]).find((p) => p.primary_email === 'lin.zhang@vectorloom.ai');
  const exported = linZhang ? exportPerson(db, linZhang.id) : null;
  const erased = linZhang ? erasePerson(db, linZhang.id) : { erasedObservations: 0 };
  log(`  exported Lin Zhang's full record (${exported?.observations?.length ?? 0} observations), then erased: payloads deleted, identifiers removed, tombstone kept`);

  const digest = buildDigest(db);
  return {
    summary: { ...audienceSummary(db), hotLeads: hotLeads(db).length, fading: fadingChampions(db).length, provider: provider.name, budget: cost.budget },
    hot: hotLeads(db, 20),
    fading: fadingChampions(db, 20),
    people: (listActivePersons(db) as any[]).map((p) => ({ id: p.id, name: p.display_name, email: p.primary_email, company: p.company, title: p.title, identifiers: p.identifier_count })),
    decisions: listDecisions(db),
    evaluation: evaluationMetrics(db),
    cost: costReport(db),
    digest,
    reviewQueue: queueSnapshot,
    decision1,
    decision2,
    mayaSources,
    alexKumarCount,
    dsar: { exported: !!exported, erasedObservations: erased.erasedObservations },
  };
}
