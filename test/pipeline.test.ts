import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { runDemo } from '../scripts/demo-core.js';

/** Full end-to-end: the entire demo flow on an in-memory DB — the engine's contract. */

test('end-to-end: ingest -> resolve -> score -> decide -> outcome -> learn -> decide (with memory) -> DSAR', async () => {
  const db = openDb(':memory:');
  const r = await runDemo(db);

  // identity
  assert.ok(r.mayaSources.length >= 4, `Maya resolved across ${r.mayaSources.length} sources`);
  assert.equal(r.alexKumarCount, 2, 'same-name different-company kept separate');
  assert.equal(r.reviewQueue.length, 1, 'probabilistic match went to review');

  // intelligence
  assert.ok(r.hot.length >= 3, 'hot leads ranked');
  assert.ok(r.hot[0].evidence.length > 0, 'every lead carries evidence observation IDs');
  assert.ok(r.fading.length >= 1, 'fading champion detected');

  // decision loop
  assert.equal(r.decision1.reused, false);
  assert.ok(r.decision1.trace.evidence.length > 0, 'decision has evidence');
  assert.ok(r.decision2.priors.length >= 1, 'second decision carries a memory prior');
  assert.equal(r.decision2.priors[0].verdict, 'winner');
  assert.ok(r.decision2.confidence > r.decision2.baseConfidence, 'prior + calibration lifted confidence');

  // growth pack: where to invest + accounts to save
  assert.ok(r.platforms.length >= 4, 'platform intelligence computed per source');
  assert.ok(r.platforms.every((p: any) => p.recommendation), 'every platform gets a call');
  assert.ok(r.allocation, 'allocation decision generated');
  assert.equal(r.allocation.kind, 'platform_allocation');
  assert.ok(r.retention.length >= 1, 'churn-risk account produced a retention decision');
  assert.ok(r.companies.some((c: any) => c.churnRisk >= 0.5), 'company churn risk surfaced');

  // evaluation
  assert.equal(r.evaluation.successRate, 1);
  assert.equal(r.evaluation.evaluated, 1);
  assert.deepEqual(r.evaluation.notMeasuredYet, ['decision_recall', 'false_negative_rate']);

  // cost pyramid: >= 70% of work at L0, zero dollars in mock mode
  const l0 = r.cost.levels.find((l: any) => l.level === 0);
  assert.ok(l0.pct >= 70, `L0 share ${l0.pct}% must be >= 70%`);
  assert.equal(r.cost.totalSpendUsd, 0);

  // digest is the wedge deliverable
  assert.match(r.digest, /Weekly GTM digest/);
  assert.match(r.digest, /Who to talk to this week/);

  // DSAR: erased person leaves no personal data behind
  assert.equal(r.dsar.erasedObservations, 3);
  assert.ok(!r.people.some((p: any) => p.name === 'Lin Zhang'), 'erased person not in active list');
  assert.ok(!JSON.stringify(r.hot).includes('lin.zhang'), 'no erased PII in outputs');
  const tomb = db.prepare(`SELECT display_name, erased FROM persons WHERE erased = 1`).all() as any[];
  assert.ok(tomb.some((t) => t.display_name === '[erased]'), 'tombstone kept');
});
