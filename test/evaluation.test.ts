import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, j } from '../src/db.js';
import { recordOutcome } from '../src/decisions/evaluate.js';
import { updateCalibration, getCalibration } from '../src/decisions/learn.js';

function insertDecision(db: any, id: string, confidence: number, target: number): void {
  db.prepare(
    `INSERT INTO decisions (id, tenant, kind, title, context, trace, confidence, base_confidence, prior, embedding, expected, status, input_hash, resolution_level, model, created_at)
     VALUES (?, 'default', 'weekly_gtm', 'test decision', '{}', ?, ?, ?, '[]', '[]', ?, 'accepted', ?, 0, 'mock', ?)`
  ).run(id, j({ evidence: [], hypothesis: 'h', reasoning: 'r', action: 'a' }), confidence, confidence, j({ metric: 'qualified_conversations', target }), id, new Date().toISOString());
}

test('evaluation verdicts: winner / inconclusive / loser from expected vs actual', () => {
  const db = openDb(':memory:');
  insertDecision(db, 'd1', 0.8, 10);
  insertDecision(db, 'd2', 0.8, 10);
  insertDecision(db, 'd3', 0.8, 10);
  assert.equal(recordOutcome(db, 'd1', 9).verdict, 'winner'); // 0.9 attainment
  assert.equal(recordOutcome(db, 'd2', 5).verdict, 'inconclusive'); // 0.5
  assert.equal(recordOutcome(db, 'd3', 1).verdict, 'loser'); // 0.1
});

test('calibration error: confidence minus capped attainment', () => {
  const db = openDb(':memory:');
  insertDecision(db, 'd1', 0.9, 10);
  const e = recordOutcome(db, 'd1', 2); // attainment 0.2 -> error 0.7 (overconfident)
  assert.equal(e.calibrationError, 0.7);
});

test('learning: systematic overconfidence produces a negative, damped adjustment', () => {
  const db = openDb(':memory:');
  for (let i = 1; i <= 5; i++) {
    insertDecision(db, `d${i}`, 0.9, 10);
    recordOutcome(db, `d${i}`, 3); // always overconfident
  }
  const c = updateCalibration(db, 'weekly_gtm');
  assert.ok(c.adjustment < 0, `adjustment ${c.adjustment} should discount`);
  assert.ok(c.adjustment >= -0.2, 'clamped');
  assert.equal(c.samples, 5);
  assert.equal(getCalibration(db, 'weekly_gtm').adjustment, c.adjustment);
});

test('small samples are damped so one outcome cannot swing confidence', () => {
  const db = openDb(':memory:');
  insertDecision(db, 'd1', 0.9, 10);
  recordOutcome(db, 'd1', 1); // brutal loss, but only 1 sample
  const c = updateCalibration(db, 'weekly_gtm');
  assert.ok(Math.abs(c.adjustment) <= 0.08, `adjustment ${c.adjustment} stays small on n=1`);
});
