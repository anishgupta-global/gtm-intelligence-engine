import type { DB } from '../db.js';
import { j, pj } from '../db.js';
import { id, now, round2 } from '../util.js';
import { config } from '../config.js';
import { logEvent } from '../pipeline/events.js';
import { costReport } from '../cost/router.js';

/**
 * Evaluation engine — computes EXPECTED vs ACTUAL for every executed decision.
 * Without this layer nobody can objectively say whether the engine is improving.
 * Only honestly measurable metrics are reported (docs/EVALUATION.md); decision recall
 * and false negatives need ground truth that does not exist early — they are roadmap,
 * never fabricated.
 */

export function evaluateDecision(db: DB, decisionId: string): any {
  const decision = db.prepare(`SELECT * FROM decisions WHERE tenant = ? AND id = ?`).get(config.tenant, decisionId) as any;
  const outcome = db.prepare(`SELECT * FROM outcomes WHERE tenant = ? AND decision_id = ? ORDER BY recorded_at DESC LIMIT 1`).get(config.tenant, decisionId) as any;
  if (!decision || !outcome) return null;
  const expected = pj<{ metric: string; target: number }>(decision.expected);
  const achieved = Number(pj<any>(outcome.metrics).achieved ?? 0);
  const attainment = round2(Math.min(2, achieved / Math.max(1, expected.target)));
  const verdict = attainment >= 0.8 ? 'winner' : attainment >= 0.4 ? 'inconclusive' : 'loser';
  const calibrationError = round2(decision.confidence - Math.min(1, attainment));
  db.prepare(
    `INSERT INTO evaluations (id, tenant, decision_id, expected, actual, attainment, verdict, calibration_error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(decision_id) DO UPDATE SET actual = excluded.actual, attainment = excluded.attainment, verdict = excluded.verdict, calibration_error = excluded.calibration_error, created_at = excluded.created_at`
  ).run(id('evl'), config.tenant, decisionId, decision.expected, j({ achieved }), attainment, verdict, calibrationError, now());
  logEvent(db, 'evaluate', decisionId, { attainment, verdict, calibrationError });
  return { decisionId, expected, achieved, attainment, verdict, calibrationError };
}

export function recordOutcome(db: DB, decisionId: string, achieved: number, note = ''): any {
  db.prepare(`INSERT INTO outcomes (id, tenant, decision_id, metrics, note, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    id('out'), config.tenant, decisionId, j({ achieved }), note, now()
  );
  db.prepare(`UPDATE decisions SET status = 'completed' WHERE tenant = ? AND id = ?`).run(config.tenant, decisionId);
  logEvent(db, 'outcome', decisionId, { achieved });
  return evaluateDecision(db, decisionId);
}

export function evaluationMetrics(db: DB): any {
  const d = (sql: string) => (db.prepare(sql).get(config.tenant) as any).c as number;
  const total = d(`SELECT COUNT(*) AS c FROM decisions WHERE tenant = ?`);
  const accepted = d(`SELECT COUNT(*) AS c FROM decisions WHERE tenant = ? AND status IN ('accepted','completed')`);
  const dismissed = d(`SELECT COUNT(*) AS c FROM decisions WHERE tenant = ? AND status = 'dismissed'`);
  const decided = accepted + dismissed;
  const evals = db.prepare(
    `SELECT e.*, dcs.title FROM evaluations e JOIN decisions dcs ON dcs.id = e.decision_id WHERE e.tenant = ? ORDER BY e.created_at DESC`
  ).all(config.tenant) as any[];
  const winners = evals.filter((e) => e.verdict === 'winner').length;
  const meanCalErr = evals.length ? round2(evals.reduce((s, e) => s + Math.abs(e.calibration_error), 0) / evals.length) : null;
  const cost = costReport(db);
  return {
    decisionsTotal: total,
    accepted,
    dismissed,
    acceptanceRate: decided ? round2(accepted / decided) : null,
    evaluated: evals.length,
    successRate: evals.length ? round2(winners / evals.length) : null,
    meanCalibrationError: meanCalErr,
    costPerInsight: cost.costPerInsight,
    history: evals.map((e) => ({
      decisionId: e.decision_id,
      title: e.title,
      expected: pj(e.expected),
      actual: pj(e.actual),
      attainment: e.attainment,
      verdict: e.verdict,
      calibrationError: e.calibration_error,
    })),
    notMeasuredYet: ['decision_recall', 'false_negative_rate'],
  };
}
