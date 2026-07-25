import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { ingestSignal } from '../src/connectors/sdk.js';
import { resolveIdentities } from '../src/identity/resolve.js';
import { buildGraph } from '../src/graph/store.js';
import { computeScores, hotLeads } from '../src/intelligence/scores.js';
import { platformStats } from '../src/intelligence/platforms.js';
import { companyStats } from '../src/intelligence/companies.js';
import { generateAllocationDecision, generateRetentionDecisions } from '../src/decisions/growth-pack.js';
import { MockProvider } from '../src/ai/provider.js';

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const sig = (signalType: string, externalId: string, actor: any, daysAgo: number, props: any = {}) => ({
  signalType, externalId, observedAt: iso(daysAgo), actor, props,
});

async function seed(db: any) {
  // hot channel: growing, high intent
  ingestSignal(db, 'crm_csv', sig('crm_contact', 'c1', { email: 'a@x.io', name: 'Ada Alpha', company: 'XCo', title: 'CTO', employees: 300, industry: 'software' }, 30));
  ingestSignal(db, 'github', sig('repo_star', 'g1', { email: 'a@x.io', handle: 'ada', name: 'Ada Alpha' }, 2, { repo: 'r' }));
  ingestSignal(db, 'github', sig('repo_issue', 'g2', { email: 'a@x.io', handle: 'ada', name: 'Ada Alpha' }, 1, { repo: 'r' }));
  ingestSignal(db, 'website', sig('pricing_view', 'w1', { email: 'a@x.io' }, 1));
  // cold channel: was active, went quiet (churn-risk company)
  ingestSignal(db, 'crm_csv', sig('crm_contact', 'c2', { email: 'b@y.io', name: 'Bo Beta', company: 'YCo', title: 'Director of Data', employees: 250, industry: 'data' }, 90));
  for (let i = 0; i < 4; i++) ingestSignal(db, 'newsletter', sig('newsletter_open', `n${i}`, { email: 'b@y.io', name: 'Bo Beta' }, 35 + i * 3));
  resolveIdentities(db);
  buildGraph(db);
  await computeScores(db, new MockProvider());
}

test('platform stats: grounded per-source rollups with recommendations', async () => {
  const db = openDb(':memory:');
  await seed(db);
  const stats = platformStats(db);
  const github = stats.find((s) => s.source === 'github')!;
  assert.equal(github.people, 1);
  assert.equal(github.signals7, 2);
  assert.equal(github.recommendation, 'double down');
  const newsletter = stats.find((s) => s.source === 'newsletter')!;
  assert.equal(newsletter.signals7, 0, 'quiet channel has no current signals');
  assert.notEqual(newsletter.recommendation, 'double down');
  // stats carry factors — the Intelligence Law applies to L0 too
  assert.ok(github.factors.avgIntent !== undefined);
});

test('allocation decision: created with trace + evidence, reused when nothing changed', async () => {
  const db = openDb(':memory:');
  await seed(db);
  const d1 = generateAllocationDecision(db)!;
  assert.equal(d1.kind, 'platform_allocation');
  assert.match(d1.title, /Invest in (github|website)/); // both are Ada's active channels — quality ties
  assert.ok(d1.trace.evidence.length > 0, 'allocation carries observation evidence');
  assert.ok(d1.expected.target >= 1);
  const d2 = generateAllocationDecision(db)!;
  assert.equal(d2.reused, true, 'same inputs -> same decision, no duplicate');
  assert.equal(d2.id, d1.id);
});

test('retention decision: fired for churn-risk account, gated against spam', async () => {
  const db = openDb(':memory:');
  await seed(db);
  const companies = companyStats(db);
  const yco = companies.find((c) => c.company === 'YCo')!;
  assert.ok(yco.churnRisk >= 0.5, `YCo churn risk ${yco.churnRisk}`);
  const decisions = generateRetentionDecisions(db);
  assert.equal(decisions.length, 1);
  assert.match(decisions[0].title, /YCo/);
  assert.equal(decisions[0].kind, 'account_retention');
  const again = generateRetentionDecisions(db);
  assert.equal(again[0].reused, true, 'unchanged churn state reuses the decision');
});

test('hot leads: caller controls limit and filters — no hardcoded top-N', async () => {
  const db = openDb(':memory:');
  await seed(db);
  assert.equal(hotLeads(db, { limit: 1 }).length, 1);
  const execs = hotLeads(db, { role: 'executive' });
  assert.ok(execs.every((l: any) => l.role === 'executive'));
  assert.equal(hotLeads(db, { minIntent: 0.99 }).length, 0);
});
