import type { DB } from '../db.js';
import { j } from '../db.js';
import { sha256, clamp, localEmbed, round2 } from '../util.js';
import { config } from '../config.js';
import { platformStats, type PlatformStat } from '../intelligence/platforms.js';
import { companyStats } from '../intelligence/companies.js';
import { loadWorkspace, type Workspace } from '../intelligence/bulk.js';
import { ledger } from '../cost/router.js';
import { findSimilar, priorAdjustment } from './memory.js';
import { getCalibration } from './learn.js';
import { persistDecision, rowToRecord, type DecisionRecord } from './reason.js';
import { logEvent } from '../pipeline/events.js';

/**
 * Decision Pack 1 — GROWTH (grow a two-sided marketplace with the data you already have).
 * Packs are decision domains, not products: every pack reads the same graph, produces
 * Decision objects, and shares the same evaluation, learning, and decision memory.
 * Principle 13 applies: a pack ships decisions, not visualizations.
 *
 * Kinds in this pack:
 *  - weekly_gtm            (reason.ts) who to talk to this week
 *  - platform_allocation   (here)      where to invest growth effort
 *  - account_retention     (here)      which account to save before it churns
 * All L0 — grounded arithmetic over the graph, zero AI spend.
 */

export const PACK_GROWTH = ['weekly_gtm', 'platform_allocation', 'account_retention'] as const;

/** Cap simultaneous open retention decisions — the top revenue-at-risk accounts, not spam. */
const MAX_RETENTION_DECISIONS = 3;

function reusable(db: DB, kind: string, inputHash: string): DecisionRecord | null {
  const row = db.prepare(
    `SELECT * FROM decisions WHERE tenant = ? AND kind = ? AND input_hash = ? AND status IN ('proposed','accepted') ORDER BY created_at DESC LIMIT 1`
  ).get(config.tenant, kind, inputHash) as any;
  if (!row) return null;
  logEvent(db, 'decide', row.id, { reused: true, kind });
  return rowToRecord(row, true);
}

const INVEST_CALLS = new Set(['double down', 'increase budget']);

/** "Which platform deserves more investment this week?" — from observed engagement, never follower counts. */
export function generateAllocationDecision(db: DB, ws: Workspace = loadWorkspace(db)): DecisionRecord | null {
  const stats = platformStats(db, ws);
  if (!stats.length) return null;
  const inputHash = sha256('alloc-v2:' + j(stats.map((s) => [s.source, s.signals7, s.signalsPrior7, s.newUsers7, s.people])));
  const existing = reusable(db, 'platform_allocation', inputHash);
  if (existing) return existing;

  // "double down" is the strategic focus call; "increase budget" is the tactical spend bump.
  const focus = stats.find((s) => s.recommendation === 'double down')
    ?? stats.find((s) => INVEST_CALLS.has(s.recommendation))
    ?? stats[0];
  const secondary = stats.find((s) => s.recommendation === 'increase budget' && s.source !== focus.source);
  const cut = [...stats].reverse().find((s) => s.recommendation === 'reduce effort' && s.source !== focus.source);
  const maintain = stats.find((s) => s.recommendation === 'maintain (B2C awareness)');
  const evidence = (db.prepare(
    `SELECT id FROM observations WHERE tenant = ? AND source = ? AND erased = 0 ORDER BY observed_at DESC LIMIT 8`
  ).all(config.tenant, focus.source) as any[]).map((r) => r.id);

  const baseConfidence = clamp(round2(
    0.5 + 0.12 * Math.min(1, focus.newUsers7 / 500) + 0.1 * Math.min(1, Math.max(0, focus.growthPct) / 60)
      + 0.08 * focus.conversion + 0.05 * Math.min(1, focus.merchantLeads14 / 5)
  ), 0.35, 0.92);
  const embedding = localEmbed(`platform_allocation ${focus.source} ${focus.recommendation} growth ${focus.growthPct} conversion ${focus.conversion}`);
  ledger(db, { level: 1, operation: 'embed_decision' });
  const priors = findSimilar(db, embedding, 'platform_allocation');
  const confidence = clamp(round2(baseConfidence + priorAdjustment(priors) + getCalibration(db, 'platform_allocation').adjustment), 0.05, 0.95);
  ledger(db, { level: 0, operation: 'allocate_platform' });

  const expectedNewSignups = Math.max(focus.newUsers7 + 20, Math.round(focus.newUsers7 * 1.15));
  return persistDecision(db, {
    kind: 'platform_allocation',
    title: `Invest more in ${focus.source} this week${cut ? `; reduce effort on ${cut.source}` : ''}`,
    context: stats,
    trace: {
      evidence,
      hypothesis: `${focus.source} is the highest-yield growth channel right now: ${focus.newUsers7.toLocaleString()} new users this week (${focus.newUsersPrior7 ? `vs ${focus.newUsersPrior7.toLocaleString()} prior` : 'new cohort'}), ${focus.signals7.toLocaleString()} signals (${focus.growthPct >= 0 ? '+' : ''}${focus.growthPct}%), order conversion ${Math.round(focus.conversion * 100)}%, ${focus.merchantLeads14} merchant enquiries in 14d.`,
      reasoning: `Of ${stats.length} acquisition channels, ${focus.source} combines the best quality (${focus.quality}/100: intent ${focus.avgIntent}, cohort conversion ${Math.round(focus.conversion * 100)}%)${focus.merchantLeads14 >= 3 ? ' AND it feeds the supply side — merchant enquiries arrive through it, so investment compounds on both sides of the marketplace' : ''}.${maintain ? ` ${maintain.source} grows fast (+${maintain.growthPct}%) but converts at ${Math.round(maintain.conversion * 100)}% with ${maintain.merchantLeads14} merchant leads — keep it for B2C awareness, don't raise merchant-acquisition budget there.` : ''}${cut ? ` ${cut.source} is declining (${cut.growthPct}%) at quality ${cut.quality}/100 — effort there converts worst.` : ''}`,
      action: `Shift this week's growth budget toward ${focus.source} (top drivers: ${focus.topSignals.map((t) => t.type).join(', ')})${secondary ? `; also increase ${secondary.source} paid budget (order conversion ${Math.round(secondary.conversion * 100)}%)` : ''}${maintain ? `; hold ${maintain.source} at current spend for awareness only` : ''}${cut ? `; pause discretionary effort on ${cut.source}` : ''}.`,
    },
    confidence, baseConfidence, priors, embedding,
    expected: { metric: `new_signups_${focus.source}`, target: expectedNewSignups },
    inputHash, level: 0, model: 'rules',
  });
}

/** "Which account do we save before it churns?" — top revenue-at-risk accounts, gated so it never spams. */
export function generateRetentionDecisions(db: DB, ws: Workspace = loadWorkspace(db)): DecisionRecord[] {
  const out: DecisionRecord[] = [];
  const atRisk = companyStats(db, ws)
    .filter((c) => c.churnRisk >= 0.5)
    .sort((a, b) => (b.mrr + b.orderRevenue60) - (a.mrr + a.orderRevenue60))
    .slice(0, MAX_RETENTION_DECISIONS);
  for (const c of atRisk) {
    const inputHash = sha256(`retain-v1:${c.company}:${c.churnRisk}:${c.signals7}`);
    const existing = reusable(db, 'account_retention', inputHash);
    if (existing) { out.push(existing); continue; }
    const evidence = (db.prepare(
      `SELECT o.id FROM observations o JOIN identifiers i ON i.observation_id = o.id
       JOIN person_memberships m ON m.identifier_key = (i.kind || ':' || i.value) AND m.status = 'active'
       JOIN persons p ON p.id = m.person_id AND p.company = ?
       WHERE o.tenant = ? AND o.erased = 0 ORDER BY o.observed_at DESC LIMIT 6`
    ).all(c.company, config.tenant) as any[]).map((r) => r.id);
    const revenueAtRisk = c.mrr + c.orderRevenue60;
    const baseConfidence = clamp(round2(0.45 + 0.3 * c.churnRisk + (revenueAtRisk > 0 ? 0.1 : 0)), 0.35, 0.9);
    const embedding = localEmbed(`account_retention ${c.industry} churn ${c.churnRisk} revenue ${revenueAtRisk > 0}`);
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
        hypothesis: `${c.company} (${c.people} contact${c.people === 1 ? '' : 's'}${revenueAtRisk ? `, €${revenueAtRisk.toLocaleString()} observed revenue at risk` : ''}) has gone quiet — engagement down ${Math.round(c.churnRisk * 100)}% vs its prior baseline.`,
        reasoning: `Previously engaged partners that stop engaging are the highest-probability revenue loss; ${c.signals7} signals in the last 7 days${c.orders7 ? ` while ${c.orders7} consumer orders still flow to them — partner disengagement precedes delisting` : ''}.`,
        action: `Schedule a partner retention check-in with ${c.company} this week; lead with what changed for them, not with product news.`,
      },
      confidence, baseConfidence, priors, embedding,
      expected: { metric: 'reactivation_signals_14d', target: 2 },
      inputHash, level: 0, model: 'rules',
      supersedeScope: `"company":"${c.company}"`,
    }));
  }
  return out;
}
