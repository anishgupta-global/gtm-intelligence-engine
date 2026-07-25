import type { DB } from '../db.js';
import { j } from '../db.js';
import { sha256, clamp, localEmbed, round2 } from '../util.js';
import { config } from '../config.js';
import { platformStats, type PlatformStat } from '../intelligence/platforms.js';
import { companyStats } from '../intelligence/companies.js';
import { ledger } from '../cost/router.js';
import { findSimilar, priorAdjustment } from './memory.js';
import { getCalibration } from './learn.js';
import { persistDecision, rowToRecord, type DecisionRecord } from './reason.js';
import { logEvent } from '../pipeline/events.js';

/**
 * Decision Pack 1 — GROWTH (grow a two-sided motion with the data you already have).
 * Packs are decision domains, not products: every pack reads the same graph, produces
 * Decision objects, and shares the same evaluation, learning, and decision memory.
 * Principle 13 applies: a pack ships decisions, not visualizations.
 *
 * Kinds in this pack:
 *  - weekly_gtm            (reason.ts) who to talk to this week
 *  - platform_allocation   (here)      where to invest effort
 *  - account_retention     (here)      which account to save before it churns
 * All L0 — grounded arithmetic over the graph, zero AI spend.
 */

export const PACK_GROWTH = ['weekly_gtm', 'platform_allocation', 'account_retention'] as const;

function reusable(db: DB, kind: string, inputHash: string): DecisionRecord | null {
  const row = db.prepare(
    `SELECT * FROM decisions WHERE tenant = ? AND kind = ? AND input_hash = ? AND status IN ('proposed','accepted') ORDER BY created_at DESC LIMIT 1`
  ).get(config.tenant, kind, inputHash) as any;
  if (!row) return null;
  logEvent(db, 'decide', row.id, { reused: true, kind });
  return rowToRecord(row, true);
}

/** "Which platform deserves more investment this week?" — from observed engagement, never follower counts. */
export function generateAllocationDecision(db: DB): DecisionRecord | null {
  const stats = platformStats(db);
  if (!stats.length) return null;
  const inputHash = sha256('alloc-v1:' + j(stats.map((s) => [s.source, s.signals7, s.signalsPrior7, s.people])));
  const existing = reusable(db, 'platform_allocation', inputHash);
  if (existing) return existing;

  const focus = stats.find((s) => s.recommendation === 'double down') ?? stats[0];
  const cut = [...stats].reverse().find((s) => s.recommendation === 'reduce effort' && s.source !== focus.source);
  const evidence = (db.prepare(
    `SELECT id FROM observations WHERE tenant = ? AND source = ? AND erased = 0 ORDER BY observed_at DESC LIMIT 8`
  ).all(config.tenant, focus.source) as any[]).map((r) => r.id);

  const baseConfidence = clamp(round2(0.5 + 0.15 * Math.min(1, focus.people / 10) + 0.15 * Math.min(1, Math.max(0, focus.growthPct) / 100) + 0.1 * focus.avgIntent), 0.35, 0.85);
  const embedding = localEmbed(`platform_allocation ${focus.source} ${focus.recommendation} growth ${focus.growthPct}`);
  ledger(db, { level: 1, operation: 'embed_decision' });
  const priors = findSimilar(db, embedding, 'platform_allocation');
  const confidence = clamp(round2(baseConfidence + priorAdjustment(priors) + getCalibration(db, 'platform_allocation').adjustment), 0.05, 0.95);
  ledger(db, { level: 0, operation: 'allocate_platform' });

  return persistDecision(db, {
    kind: 'platform_allocation',
    title: `Invest in ${focus.source} this week${cut ? `; reduce effort on ${cut.source}` : ''}`,
    context: stats,
    trace: {
      evidence,
      hypothesis: `${focus.source} is the highest-yield channel right now: ${focus.signals7} signals this week vs ${focus.signalsPrior7} prior (${focus.growthPct >= 0 ? '+' : ''}${focus.growthPct}%), quality ${focus.quality}/100, avg intent ${focus.avgIntent}.`,
      reasoning: `${focus.activePeople7} of ${focus.people} people observed via ${focus.source} were active in the last 7 days and ${Math.round(focus.hotLeadYield * 100)}% are hot leads — the best engagement-per-person of ${stats.length} sources.${cut ? ` ${cut.source} shows ${cut.growthPct}% growth at quality ${cut.quality}/100 — effort there converts worst.` : ''}`,
      action: `Concentrate this week's content and outreach on ${focus.source} (top drivers: ${focus.topSignals.map((t) => t.type).join(', ')})${cut ? `; pause discretionary effort on ${cut.source}` : ''}.`,
    },
    confidence, baseConfidence, priors, embedding,
    expected: { metric: `active_people_${focus.source}`, target: focus.activePeople7 + Math.max(1, Math.ceil(focus.activePeople7 * 0.25)) },
    inputHash, level: 0, model: 'rules',
  });
}

/** "Which account do we save before it churns?" — one decision per at-risk account, gated so it never spams. */
export function generateRetentionDecisions(db: DB): DecisionRecord[] {
  const out: DecisionRecord[] = [];
  for (const c of companyStats(db).filter((c) => c.churnRisk >= 0.5)) {
    const inputHash = sha256(`retain-v1:${c.company}:${c.churnRisk}:${c.signals7}`);
    const existing = reusable(db, 'account_retention', inputHash);
    if (existing) { out.push(existing); continue; }
    const evidence = (db.prepare(
      `SELECT o.id FROM observations o JOIN identifiers i ON i.observation_id = o.id
       JOIN person_memberships m ON m.identifier_key = (i.kind || ':' || i.value) AND m.status = 'active'
       JOIN persons p ON p.id = m.person_id AND p.company = ?
       WHERE o.tenant = ? AND o.erased = 0 ORDER BY o.observed_at DESC LIMIT 6`
    ).all(c.company, config.tenant) as any[]).map((r) => r.id);
    const baseConfidence = clamp(round2(0.45 + 0.3 * c.churnRisk + (c.mrr > 0 ? 0.1 : 0)), 0.35, 0.9);
    const embedding = localEmbed(`account_retention ${c.industry} churn ${c.churnRisk} mrr ${c.mrr > 0}`);
    ledger(db, { level: 1, operation: 'embed_decision' });
    const priors = findSimilar(db, embedding, 'account_retention');
    const confidence = clamp(round2(baseConfidence + priorAdjustment(priors) + getCalibration(db, 'account_retention').adjustment), 0.05, 0.95);
    ledger(db, { level: 0, operation: 'retention_check' });
    out.push(persistDecision(db, {
      kind: 'account_retention',
      title: `Retention: re-engage ${c.company} before it churns`,
      context: c,
      trace: {
        evidence,
        hypothesis: `${c.company} (${c.people} contact${c.people === 1 ? '' : 's'}${c.mrr ? `, $${c.mrr} MRR observed` : ''}) has gone quiet — engagement down ${Math.round(c.churnRisk * 100)}% vs its prior baseline.`,
        reasoning: `Previously engaged accounts that stop engaging are the highest-probability revenue loss; ${c.signals7} signals in the last 7 days${c.mrr ? ' while payments continue — usage decay precedes contraction' : ''}.`,
        action: `Schedule a retention check-in with ${c.company} this week; lead with what changed for them, not with product news.`,
      },
      confidence, baseConfidence, priors, embedding,
      expected: { metric: 'reactivation_signals_14d', target: 2 },
      inputHash, level: 0, model: 'rules',
    }));
  }
  return out;
}
