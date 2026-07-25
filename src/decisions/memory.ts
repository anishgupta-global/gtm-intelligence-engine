import type { DB } from '../db.js';
import { pj } from '../db.js';
import { cosine } from '../util.js';
import { config } from '../config.js';

/**
 * Decision memory — every past decision (with its measured outcome) is retrievable by
 * similarity, so new recommendations carry priors like "97% similar to #384, which won".
 */

export interface MemoryPrior {
  decisionId: string;
  title: string;
  similarity: number;
  verdict: string;
  attainment: number;
  outcome: string;
}

export function findSimilar(db: DB, embedding: number[], kind: string, minSim = 0.75): MemoryPrior[] {
  const rows = db.prepare(
    `SELECT d.id, d.title, d.embedding, e.verdict, e.attainment, o.metrics
     FROM decisions d
     JOIN evaluations e ON e.decision_id = d.id
     LEFT JOIN outcomes o ON o.decision_id = d.id
     WHERE d.tenant = ? AND d.kind = ?`
  ).all(config.tenant, kind) as any[];
  return rows
    .map((r) => ({
      decisionId: r.id,
      title: r.title,
      similarity: Math.round(cosine(embedding, pj<number[]>(r.embedding)) * 100) / 100,
      verdict: r.verdict,
      attainment: r.attainment,
      outcome: r.metrics ? JSON.stringify(pj(r.metrics)) : '',
    }))
    .filter((r) => r.similarity >= minSim)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3);
}

/** Confidence adjustment from the best prior: winners boost, losers discount, scaled by similarity. */
export function priorAdjustment(priors: MemoryPrior[]): number {
  if (!priors.length) return 0;
  const best = priors[0];
  if (best.verdict === 'winner') return 0.07 * best.similarity;
  if (best.verdict === 'loser') return -0.12 * best.similarity;
  return 0;
}
