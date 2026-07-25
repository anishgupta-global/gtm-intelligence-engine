import type { DB } from '../db.js';
import { id, now, round2 } from '../util.js';
import { config } from '../config.js';

/**
 * Cost engine — the single chokepoint for every computation level.
 * L0 rules/SQL (free) -> L1 embeddings (local, free) -> L2 small LLM -> L3 large LLM.
 * Every operation is ledgered; budget state degrades the router, never silently overspends.
 */

export type Level = 0 | 1 | 2 | 3;

export class BudgetExhaustedError extends Error {
  constructor() { super('AI budget exhausted — falling back to deterministic levels'); }
}

export interface LedgerEntry {
  level: Level;
  operation: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  cacheHit?: boolean;
}

export function ledger(db: DB, e: LedgerEntry): void {
  db.prepare(
    `INSERT INTO cost_ledger (id, tenant, ts, level, operation, model, input_tokens, output_tokens, cost_usd, cache_hit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id('led'), config.tenant, now(), e.level, e.operation, e.model ?? 'none', e.inputTokens ?? 0, e.outputTokens ?? 0, e.costUsd ?? 0, e.cacheHit ? 1 : 0);
}

export function spentThisMonth(db: DB): number {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const row = db.prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS s FROM cost_ledger WHERE tenant = ? AND ts >= ?`).get(
    config.tenant, monthStart.toISOString()
  ) as any;
  return row.s as number;
}

export type BudgetMode = 'full' | 'lean' | 'exhausted';

export function budgetState(db: DB): { budgetUsd: number; spentUsd: number; remainingUsd: number; mode: BudgetMode } {
  const budgetUsd = config.monthlyBudgetUsd;
  const spentUsd = round2(spentThisMonth(db));
  const remainingUsd = round2(Math.max(0, budgetUsd - spentUsd));
  const mode: BudgetMode = remainingUsd <= 0 ? 'exhausted' : remainingUsd < budgetUsd * 0.2 ? 'lean' : 'full';
  return { budgetUsd, spentUsd, remainingUsd, mode };
}

/** Guard an L2/L3 call: throws BudgetExhaustedError so callers fall back to L0/L1 — degradation is explicit, never an error page. */
export function guardLlm(db: DB): BudgetMode {
  const { mode } = budgetState(db);
  if (mode === 'exhausted') throw new BudgetExhaustedError();
  return mode;
}

export function costReport(db: DB): any {
  const byLevel = db.prepare(
    `SELECT level, COUNT(*) AS ops, SUM(cost_usd) AS cost, SUM(cache_hit) AS cache_hits
     FROM cost_ledger WHERE tenant = ? GROUP BY level ORDER BY level`
  ).all(config.tenant) as any[];
  const totalOps = byLevel.reduce((s, r) => s + r.ops, 0) || 1;
  const insights =
    (db.prepare(`SELECT COUNT(*) AS c FROM decisions WHERE tenant = ?`).get(config.tenant) as any).c +
    (db.prepare(`SELECT COUNT(*) AS c FROM enrichments WHERE tenant = ?`).get(config.tenant) as any).c +
    (db.prepare(`SELECT COUNT(*) AS c FROM events WHERE tenant = ? AND stage = 'digest'`).get(config.tenant) as any).c;
  const cache = db.prepare(`SELECT COALESCE(SUM(hits), 0) AS hits, COUNT(*) AS entries FROM intelligence_cache`).get() as any;
  const spend = round2(byLevel.reduce((s, r) => s + (r.cost ?? 0), 0));
  return {
    budget: budgetState(db),
    levels: byLevel.map((r) => ({
      level: r.level,
      label: ['L0 rules/SQL', 'L1 embeddings', 'L2 small LLM', 'L3 large LLM'][r.level],
      ops: r.ops,
      pct: Math.round((r.ops / totalOps) * 100),
      costUsd: round2(r.cost ?? 0),
    })),
    totalSpendUsd: spend,
    insights,
    costPerInsight: insights ? round2(spend / insights) : 0,
    cacheHits: cache.hits,
    cacheEntries: cache.entries,
  };
}
