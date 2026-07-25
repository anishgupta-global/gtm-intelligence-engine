import type { DB } from '../db.js';
import { j, pj } from '../db.js';
import { id, now, sha256, clamp, localEmbed } from '../util.js';
import { config } from '../config.js';
import { audienceSummary } from '../intelligence/segments.js';
import { hotLeads, hotLeadCount, fadingChampions } from '../intelligence/scores.js';
import type { Workspace } from '../intelligence/bulk.js';
import { ledger, guardLlm, BudgetExhaustedError } from '../cost/router.js';
import { cacheGet, cachePut } from '../cost/cache.js';
import { MockProvider, type LLMProvider, type RecommendationDraft } from '../ai/provider.js';
import type { Aggregates } from '../ai/prompts.js';
import { findSimilar, priorAdjustment, type MemoryPrior } from './memory.js';
import { getCalibration } from './learn.js';
import { logEvent } from '../pipeline/events.js';

/**
 * Reasoning engine (L7) + decision engine (L8).
 * Trace on every decision: evidence -> hypothesis -> reasoning -> action -> confidence.
 * Evidence IDs are joined from the database — they physically cannot be hallucinated.
 * Meaningful-change gate: identical aggregates never trigger a second LLM call.
 */

export const DECISION_KIND = 'weekly_gtm';

export function buildAggregates(db: DB, ws?: Workspace): { agg: Aggregates; evidence: string[] } {
  const summary = audienceSummary(db, ws);
  const hot = hotLeads(db, { limit: 10 });
  const fading = fadingChampions(db, 10);
  const topSignals14 = (db.prepare(
    `SELECT signal_type AS type, COUNT(*) AS count FROM observations
     WHERE tenant = ? AND erased = 0 AND signal_type != 'crm_contact' AND observed_at >= ?
     GROUP BY signal_type ORDER BY count DESC LIMIT 6`
  ).all(config.tenant, new Date(Date.now() - 14 * 86_400_000).toISOString()) as any[]);
  const roleMix: Record<string, number> = {};
  const sizeMix: Record<string, number> = {};
  for (const l of hot) {
    roleMix[l.role] = (roleMix[l.role] ?? 0) + 1;
    const seg = l.icpFit >= 0.6 ? 'icp_strong' : l.icpFit >= 0.35 ? 'icp_medium' : 'icp_weak';
    sizeMix[seg] = (sizeMix[seg] ?? 0) + 1;
  }
  const agg: Aggregates = {
    audiencePeople: summary.people,
    newPeople7: summary.newPeople7,
    hotLeadCount: hotLeadCount(db),
    fadingCount: fading.length,
    segments: summary.segments,
    topSignals14,
    hotLeadRoleMix: roleMix,
    hotLeadCompanySizeMix: sizeMix,
  };
  const evidence = [...new Set(hot.flatMap((l: any) => l.evidence ?? []))].slice(0, 12) as string[];
  return { agg, evidence };
}

export interface DecisionRecord {
  id: string;
  kind: string;
  title: string;
  trace: { evidence: string[]; hypothesis: string; reasoning: string; action: string };
  confidence: number;
  baseConfidence: number;
  priors: MemoryPrior[];
  expected: { metric: string; target: number };
  status: string;
  model: string;
  resolutionLevel: number;
  createdAt: string;
  reused: boolean;
}

export async function generateRecommendation(db: DB, provider: LLMProvider, ws?: Workspace): Promise<DecisionRecord> {
  const { agg, evidence } = buildAggregates(db, ws);
  const inputHash = sha256('rec-v1:' + j(agg));

  const existing = db.prepare(
    `SELECT * FROM decisions WHERE tenant = ? AND kind = ? AND input_hash = ? AND status IN ('proposed','accepted') ORDER BY created_at DESC LIMIT 1`
  ).get(config.tenant, DECISION_KIND, inputHash) as any;
  if (existing) {
    logEvent(db, 'decide', existing.id, { reused: true, reason: 'no meaningful change in aggregates' });
    return rowToRecord(existing, true);
  }

  let draft: RecommendationDraft;
  let level: 0 | 2 | 3;
  let model: string;
  const cacheKey = sha256(`rec:${provider.name}:${inputHash}`);
  const cached = cacheGet<RecommendationDraft>(db, cacheKey);
  if (cached) {
    draft = cached;
    level = 3;
    model = `${provider.name}(cache)`;
    ledger(db, { level: 3, operation: 'recommend', model, cacheHit: true });
  } else {
    try {
      const mode = guardLlm(db);
      draft = await provider.recommend(agg, mode === 'lean');
      level = provider.name === 'mock' ? 0 : mode === 'lean' ? 2 : 3;
      model = provider.name;
      ledger(db, { level: level === 0 ? 0 : level, operation: 'recommend', model, inputTokens: draft.usage.inputTokens, outputTokens: draft.usage.outputTokens, costUsd: draft.usage.costUsd });
      cachePut(db, cacheKey, draft, model);
    } catch (e) {
      if (!(e instanceof BudgetExhaustedError)) throw e;
      draft = await new MockProvider().recommend(agg, false);
      level = 0;
      model = 'mock(budget-fallback)';
      ledger(db, { level: 0, operation: 'recommend', model });
    }
  }

  const embedding = localEmbed(`${DECISION_KIND} ${draft.title} ${draft.hypothesis}`);
  ledger(db, { level: 1, operation: 'embed_decision' });
  const priors = findSimilar(db, embedding, DECISION_KIND);
  const calibration = getCalibration(db, DECISION_KIND);
  const confidence = clamp(Math.round((draft.confidence + priorAdjustment(priors) + calibration.adjustment) * 100) / 100, 0.05, 0.95);

  const trace = { evidence, hypothesis: draft.hypothesis, reasoning: draft.reasoning, action: draft.action };
  return persistDecision(db, {
    kind: DECISION_KIND, title: draft.title, context: agg, trace, confidence,
    baseConfidence: draft.confidence, priors, embedding,
    expected: { metric: 'qualified_conversations', target: draft.expectedTarget },
    inputHash, level, model,
  });
}

/** Shared persistence for every decision pack — one loop, one memory, one evaluation path.
 *  A fresh decision supersedes prior PROPOSED (never acted on) decisions of the same kind —
 *  one open call per question. Accepted/completed decisions are history and stay untouched.
 *  `supersedeScope` narrows this for per-entity kinds (e.g. retention per company). */
export function persistDecision(db: DB, d: {
  kind: string; title: string; context: unknown;
  trace: { evidence: string[]; hypothesis: string; reasoning: string; action: string };
  confidence: number; baseConfidence: number; priors: MemoryPrior[]; embedding: number[];
  expected: { metric: string; target: number }; inputHash: string; level: number; model: string;
  supersedeScope?: string;
}): DecisionRecord {
  if (d.supersedeScope !== undefined) {
    db.prepare(`UPDATE decisions SET status = 'superseded' WHERE tenant = ? AND kind = ? AND status = 'proposed' AND context LIKE ?`).run(
      config.tenant, d.kind, `%${d.supersedeScope}%`
    );
  } else {
    db.prepare(`UPDATE decisions SET status = 'superseded' WHERE tenant = ? AND kind = ? AND status = 'proposed'`).run(config.tenant, d.kind);
  }
  const decisionId = id('dec');
  db.prepare(
    `INSERT INTO decisions (id, tenant, kind, title, context, trace, confidence, base_confidence, prior, embedding, expected, status, input_hash, resolution_level, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?)`
  ).run(decisionId, config.tenant, d.kind, d.title, j(d.context), j(d.trace), d.confidence, d.baseConfidence, j(d.priors), j(d.embedding), j(d.expected), d.inputHash, d.level, d.model, now());
  logEvent(db, 'decide', decisionId, { kind: d.kind, confidence: d.confidence, priors: d.priors.length, level: d.level });
  return {
    id: decisionId, kind: d.kind, title: d.title, trace: d.trace, confidence: d.confidence,
    baseConfidence: d.baseConfidence, priors: d.priors, expected: d.expected, status: 'proposed',
    model: d.model, resolutionLevel: d.level, createdAt: now(), reused: false,
  };
}

export function rowToRecord(row: any, reused = false): DecisionRecord {
  return {
    id: row.id, kind: row.kind, title: row.title, trace: pj(row.trace), confidence: row.confidence,
    baseConfidence: row.base_confidence, priors: pj(row.prior ?? '[]'), expected: pj(row.expected),
    status: row.status, model: row.model, resolutionLevel: row.resolution_level, createdAt: row.created_at, reused,
  };
}

export function listDecisions(db: DB): any[] {
  const rows = db.prepare(
    `SELECT d.*, e.verdict, e.attainment, e.calibration_error, o.metrics AS outcome_metrics, o.note AS outcome_note
     FROM decisions d
     LEFT JOIN evaluations e ON e.decision_id = d.id
     LEFT JOIN outcomes o ON o.decision_id = d.id
     WHERE d.tenant = ? ORDER BY d.created_at DESC`
  ).all(config.tenant) as any[];
  return rows.map((r) => ({
    ...rowToRecord(r),
    verdict: r.verdict ?? null,
    attainment: r.attainment ?? null,
    calibrationError: r.calibration_error ?? null,
    outcome: r.outcome_metrics ? { metrics: pj(r.outcome_metrics), note: r.outcome_note } : null,
  }));
}

export function setDecisionStatus(db: DB, decisionId: string, status: 'accepted' | 'dismissed'): void {
  db.prepare(`UPDATE decisions SET status = ? WHERE tenant = ? AND id = ? AND status = 'proposed'`).run(status, config.tenant, decisionId);
  logEvent(db, 'decision_status', decisionId, { status });
}
