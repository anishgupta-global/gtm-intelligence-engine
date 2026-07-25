import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { cachePut, cacheGet } from '../src/cost/cache.js';
import { ledger, budgetState, guardLlm, BudgetExhaustedError, costReport } from '../src/cost/router.js';
import { generateRecommendation } from '../src/decisions/reason.js';
import { MockProvider } from '../src/ai/provider.js';
import { ingestSignal } from '../src/connectors/sdk.js';
import { resolveIdentities } from '../src/identity/resolve.js';
import { computeScores } from '../src/intelligence/scores.js';

test('intelligence cache: hit within TTL, miss after expiry', () => {
  const db = openDb(':memory:');
  cachePut(db, 'k1', { v: 42 }, 'mock', 3600);
  assert.deepEqual(cacheGet(db, 'k1'), { v: 42 });
  cachePut(db, 'k2', { v: 1 }, 'mock', -1); // already expired
  assert.equal(cacheGet(db, 'k2'), null);
  const hits = db.prepare(`SELECT hits FROM intelligence_cache WHERE key = 'k1'`).get() as any;
  assert.equal(hits.hits, 1);
});

test('budget manager: modes degrade full -> lean -> exhausted, guard throws', () => {
  const db = openDb(':memory:');
  assert.equal(budgetState(db).mode, 'full');
  ledger(db, { level: 3, operation: 'recommend', model: 'x', costUsd: 12.5 }); // budget default 15 -> remaining 2.5 < 20%
  assert.equal(budgetState(db).mode, 'lean');
  ledger(db, { level: 3, operation: 'recommend', model: 'x', costUsd: 3 });
  assert.equal(budgetState(db).mode, 'exhausted');
  assert.throws(() => guardLlm(db), BudgetExhaustedError);
});

test('budget exhaustion degrades recommendation to L0 fallback — never an error', async () => {
  const db = openDb(':memory:');
  ledger(db, { level: 3, operation: 'burn', model: 'x', costUsd: 99 });
  const d = await generateRecommendation(db, new MockProvider());
  assert.equal(d.resolutionLevel, 0);
  assert.match(d.model, /budget-fallback/);
});

test('meaningful-change gate: unchanged aggregates reuse the decision (zero new spend)', async () => {
  const db = openDb(':memory:');
  ingestSignal(db, 'crm_csv', { signalType: 'crm_contact', externalId: 'c1', observedAt: new Date().toISOString(), actor: { email: 'a@x.io', name: 'Ada Alpha', company: 'XCo' }, props: {} });
  ingestSignal(db, 'website', { signalType: 'pricing_view', externalId: 'p1', observedAt: new Date().toISOString(), actor: { email: 'a@x.io' }, props: {} });
  resolveIdentities(db);
  await computeScores(db, new MockProvider());
  const d1 = await generateRecommendation(db, new MockProvider());
  const d2 = await generateRecommendation(db, new MockProvider());
  assert.equal(d1.reused, false);
  assert.equal(d2.reused, true);
  assert.equal(d2.id, d1.id);
});

test('recommendation cache: same inputs after dismissal hit the cache, ledgered as cache hit', async () => {
  const db = openDb(':memory:');
  const d1 = await generateRecommendation(db, new MockProvider());
  db.prepare(`UPDATE decisions SET status = 'dismissed' WHERE id = ?`).run(d1.id);
  const d2 = await generateRecommendation(db, new MockProvider());
  assert.notEqual(d2.id, d1.id);
  assert.match(d2.model, /cache/);
  const hit = db.prepare(`SELECT COUNT(*) AS c FROM cost_ledger WHERE cache_hit = 1`).get() as any;
  assert.ok(hit.c >= 1);
});

test('cost report: level distribution and cost per insight are computed', async () => {
  const db = openDb(':memory:');
  ledger(db, { level: 0, operation: 'score_person' });
  ledger(db, { level: 0, operation: 'score_person' });
  ledger(db, { level: 2, operation: 'classify_role', model: 'mock' });
  const r = costReport(db);
  const l0 = r.levels.find((l: any) => l.level === 0);
  assert.equal(l0.ops, 2);
  assert.equal(typeof r.costPerInsight, 'number');
  assert.equal(r.budget.mode, 'full');
});
