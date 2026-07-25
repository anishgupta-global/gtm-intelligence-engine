import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { runDemo } from '../scripts/demo-core.js';

/** Full end-to-end: the entire demo flow on an in-memory DB — the engine's contract.
 *  Runs the synthetic marketplace at 5% scale (~1.3k people) so CI stays fast; the
 *  full 25k dataset runs in the demo smoke step of the CI workflow. */

test('end-to-end: ingest -> resolve -> score -> decide -> outcome -> learn -> decide (with memory) -> DSAR', async () => {
  const db = openDb(':memory:');
  const r = await runDemo(db, undefined, { scale: 0.05 });

  // scale: a real marketplace population, not a toy list
  assert.ok(r.summary.people >= 1000, `people ${r.summary.people}`);
  assert.ok(r.summary.newPeople7 >= 150, `new users this week ${r.summary.newPeople7}`);
  assert.ok(r.summary.ordersThisWeek > 50, `orders this week ${r.summary.ordersThisWeek}`);
  assert.ok(r.summary.merchants >= 8, `merchant contacts ${r.summary.merchants}`);

  // identity
  assert.ok(r.crossSourcePersonSources.length >= 4, `cross-source person resolved across ${r.crossSourcePersonSources.length} sources`);
  assert.equal(r.sameNameConflictCount, 2, 'same-name different-company kept separate (restaurant owner vs consumer)');
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
  assert.ok(r.platforms.length >= 5, 'platform intelligence computed per acquisition channel');
  const CALLS = ['double down', 'increase budget', 'maintain (B2C awareness)', 'protect', 'expand incentives', 'nurture', 're-engage', 'reduce effort'];
  assert.ok(r.platforms.every((p: any) => CALLS.includes(p.recommendation)), 'every platform gets a known call');
  assert.ok(!r.platforms.some((p: any) => p.source === 'orders' || p.source === 'crm'), 'non-channels excluded from allocation');
  assert.ok(new Set(r.platforms.map((p: any) => p.recommendation)).size >= 3, 'calls are differentiated, not monotone');
  assert.ok(r.allocation, 'allocation decision generated');
  assert.equal(r.allocation.kind, 'platform_allocation');
  assert.match(r.allocation.expected.metric, /^new_signups_/);
  assert.ok(r.retention.length >= 1 && r.retention.length <= 3, 'churn-risk accounts produce capped retention decisions');
  assert.ok(r.companies.some((c: any) => c.churnRisk >= 0.5), 'company churn risk surfaced');

  // marketplace segmentation: both sides visible, no absurd new-cohort deltas
  const segs = r.summary.segments.map((s: any) => s.segment);
  assert.ok(segs.includes('Merchant partners'), 'merchant side segmented');
  assert.ok(segs.includes('New consumers'), 'new consumer cohort segmented');
  const newSeg = r.summary.segments.find((s: any) => s.segment === 'New consumers');
  assert.ok(newSeg.previous > 0, 'new-cohort prior week compares like with like (as-of segmentation)');
  assert.ok(r.hot.every((l: any) => l.side === 'merchant' || l.side === 'consumer'), 'leads carry side labels');

  // evaluation
  assert.equal(r.evaluation.successRate, 1);
  assert.equal(r.evaluation.evaluated, 1);
  assert.deepEqual(r.evaluation.notMeasuredYet, ['decision_recall', 'false_negative_rate']);

  // cost pyramid: L0 dominates (workspace-dependent share — larger multi-source workspaces
  // classify more consumers who lack titles, shifting more work to L2 classify_role).
  // The principle: L0 + L1 (deterministic + local) still dominates paid LLM calls.
  // the sparse-skip gate keeps signal-thin consumers off the paid tiers entirely
  const l0 = r.cost.levels.find((l: any) => l.level === 0);
  assert.ok(l0.pct >= 70, `L0 share ${l0.pct}% must be >= 70% (sparse-skip gate)`);
  assert.equal(r.cost.totalSpendUsd, 0);

  // digest is the wedge deliverable
  assert.match(r.digest, /Weekly Growth Decisions/);
  assert.match(r.digest, /Merchant leads \(evidence for the who-to-contact decision\)/);
  assert.match(r.digest, /Platform comparison/);
  assert.ok(!/Invest more in webhook/.test(r.digest), 'inbound catch-all is never an investable channel');

  // DSAR: erased person leaves no personal data behind
  assert.equal(r.dsar.erasedObservations, 3);
  assert.ok(!r.people.people.some((p: any) => p.name === 'Oscar Lindberg'), 'erased person not in active list');
  assert.ok(!JSON.stringify(r.hot).includes('oscar.lindberg'), 'no erased PII in outputs');
  const tomb = db.prepare(`SELECT display_name, erased FROM persons WHERE erased = 1`).all() as any[];
  assert.ok(tomb.some((t) => t.display_name === '[erased]'), 'tombstone kept');
});
