import type { DB } from '../db.js';
import { now, clamp, round2 } from '../util.js';
import { config } from '../config.js';
import { logEvent } from '../pipeline/events.js';

/**
 * Learning engine — closes the loop: outcome -> calibration -> better next decision.
 * v1 learning is honest and incremental: confidence calibration (systematically
 * overconfident decision kinds get discounted) + memory priors (memory.ts).
 * No deep RL, no pretending. Damped and sample-weighted so small samples can't overfit.
 */

export function getCalibration(db: DB, kind: string): { adjustment: number; samples: number } {
  const row = db.prepare(`SELECT adjustment, samples FROM calibration WHERE tenant = ? AND kind = ?`).get(config.tenant, kind) as any;
  return row ? { adjustment: row.adjustment, samples: row.samples } : { adjustment: 0, samples: 0 };
}

export function updateCalibration(db: DB, kind: string): { adjustment: number; samples: number } {
  const evals = db.prepare(
    `SELECT e.calibration_error FROM evaluations e JOIN decisions d ON d.id = e.decision_id
     WHERE e.tenant = ? AND d.kind = ?`
  ).all(config.tenant, kind) as any[];
  if (!evals.length) return getCalibration(db, kind);
  const meanErr = evals.reduce((s, e) => s + e.calibration_error, 0) / evals.length;
  const damping = Math.min(1, evals.length / 5);
  const adjustment = round2(clamp(-meanErr * 0.5 * damping, -0.2, 0.2));
  db.prepare(
    `INSERT INTO calibration (tenant, kind, adjustment, samples, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tenant, kind) DO UPDATE SET adjustment = excluded.adjustment, samples = excluded.samples, updated_at = excluded.updated_at`
  ).run(config.tenant, kind, adjustment, evals.length, now());
  logEvent(db, 'learn', kind, { adjustment, samples: evals.length });
  return { adjustment, samples: evals.length };
}
