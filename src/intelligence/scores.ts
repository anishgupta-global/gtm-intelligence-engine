import type { DB } from '../db.js';
import { j, pj } from '../db.js';
import { id, now, sha256, round2 } from '../util.js';
import { config, INTENT_WEIGHTS, ICP } from '../config.js';
import { behaviorWindows } from './behavior.js';
import { loadWorkspace, type Workspace } from './bulk.js';
import { ledger, guardLlm, BudgetExhaustedError } from '../cost/router.js';
import { cacheGet, cachePut } from '../cost/cache.js';
import { logEvent } from '../pipeline/events.js';
import type { LLMProvider } from '../ai/provider.js';

/**
 * L0 scoring — SQL/rules only, every score ships a factor breakdown.
 * Incremental: a score is recomputed only when its input observations changed (input_hash).
 * Bulk + transactional: one workspace scan, one write transaction — 25k people in seconds.
 */

const SCORES_VERSION = 'scores-v1';

export async function computeScores(db: DB, provider: LLMProvider, ws: Workspace = loadWorkspace(db)): Promise<{ computed: number; skipped: number }> {
  let computed = 0, skipped = 0;
  const existingHashes = new Map<string, string>();
  for (const row of db.prepare(`SELECT entity_id, input_hash FROM scores WHERE tenant = ? AND score_type = 'intent'`).all(config.tenant) as any[]) {
    existingHashes.set(row.entity_id, row.input_hash);
  }

  db.exec('BEGIN');
  try {
    for (const person of ws.persons) {
      const obs = ws.obsByPerson.get(person.id) ?? [];
      const inputHash = sha256(SCORES_VERSION + obs.map((o) => o.id).sort().join(','));
      if (existingHashes.get(person.id) === inputHash) { skipped++; continue; }

      const w = behaviorWindows(obs);
      const contributions: Record<string, { count: number; points: number }> = {};
      const evidence: { id: string; points: number }[] = [];
      let raw = 0;
      for (const o of obs) {
        const weight = INTENT_WEIGHTS[o.signal_type] ?? 0;
        if (!weight) continue;
        const days = (Date.now() - Date.parse(o.observed_at)) / 86_400_000;
        if (days > 14) continue;
        const points = weight * Math.max(0.3, 1 - days / 21);
        raw += points;
        const c = contributions[o.signal_type] ?? { count: 0, points: 0 };
        c.count++;
        c.points = round2(c.points + points);
        contributions[o.signal_type] = c;
        evidence.push({ id: o.id, points });
      }
      const intent = round2(1 - Math.exp(-raw / 40));
      upsertScore(db, person.id, 'intent', intent, {
        raw: round2(raw),
        signals: contributions,
        evidence: evidence.sort((a, b) => b.points - a.points).slice(0, 5).map((e) => e.id),
        windows: { last7: w.last7, last14: w.last14 },
      }, inputHash);

      const fading = w.prior30 >= 3 && w.last14 <= w.prior30 * 0.35 ? round2((w.prior30 - w.last14) / w.prior30) : 0;
      upsertScore(db, person.id, 'fading', fading, {
        prior30: w.prior30, last14: w.last14, lastActiveDays: w.lastActiveDays,
      }, inputHash);

      ledger(db, { level: 0, operation: 'score_person' });
      const role = await enrichRole(db, provider, person, obs.map((o) => o.id), w.bySignal14, obs.length);
      upsertIcpFit(db, person, role, inputHash);
      computed++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  logEvent(db, 'score', null, { computed, skipped });
  return { computed, skipped };
}

function upsertScore(db: DB, entityId: string, type: string, value: number, factors: unknown, inputHash: string): void {
  db.prepare(
    `INSERT INTO scores (tenant, entity_id, score_type, value, factors, computed_at, input_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant, entity_id, score_type) DO UPDATE SET value = excluded.value, factors = excluded.factors, computed_at = excluded.computed_at, input_hash = excluded.input_hash`
  ).run(config.tenant, entityId, type, value, j(factors), now(), inputHash);
}

const ROLE_RULES: Array<[RegExp, string]> = [
  [/founder|ceo|co-founder|owner|proprietor|managing director/i, 'founder'],
  [/cto|chief|vp |vice president|head of|director|head chef|general manager/i, 'executive'],
  [/data (lead|head|manager)|analytics lead/i, 'data_leader'],
  [/engineer|developer|programmer/i, 'developer'],
  [/marketing|growth/i, 'marketer'],
];

/**
 * Confidence gating in action: a title resolves the role at L0 for free; the (L2) small
 * model is only consulted when rules can't answer — and never for signal-sparse consumers
 * (no title, no company, < 5 behavioral signals): paying L2 for a guaranteed "unknown"
 * would be silent waste. Cached besides.
 */
async function enrichRole(db: DB, provider: LLMProvider, person: any, provenanceIds: string[], signalCounts: Record<string, number>, totalObs: number): Promise<string> {
  const existing = db.prepare(
    `SELECT value FROM enrichments WHERE tenant = ? AND entity_id = ? AND field = 'role' ORDER BY created_at DESC LIMIT 1`
  ).get(config.tenant, person.id) as any;
  if (existing && existing.value !== 'unknown') return existing.value;

  const provenance = provenanceIds.slice(0, 5);
  if (person.title) {
    for (const [re, role] of ROLE_RULES) {
      if (re.test(person.title)) {
        insertEnrichment(db, person.id, 'role', role, 0.95, provenance, 'rules', `title matched ${re}`, 0);
        ledger(db, { level: 0, operation: 'classify_role', model: 'rules' });
        return role;
      }
    }
  }

  if (!person.title && !person.company && totalObs < 5) {
    if (!existing) insertEnrichment(db, person.id, 'role', 'unknown', 0.3, provenance, 'gate', 'signal-sparse consumer — L2 classification skipped (cost gate)', 0);
    ledger(db, { level: 0, operation: 'classify_role', model: 'gate' });
    return 'unknown';
  }

  const cacheKey = sha256(`role:${person.company ?? ''}:${person.title ?? ''}:${j(signalCounts)}`);
  const cached = cacheGet<{ role: string; confidence: number }>(db, cacheKey);
  if (cached) {
    ledger(db, { level: 2, operation: 'classify_role', model: 'cache', cacheHit: true });
    if (!existing) insertEnrichment(db, person.id, 'role', cached.role, cached.confidence, provenance, 'cache', 'cached classification', 2);
    return cached.role;
  }
  try {
    guardLlm(db);
    const res = await provider.classifyRole({ company: person.company ?? undefined, title: person.title ?? undefined, signalCounts });
    ledger(db, { level: 2, operation: 'classify_role', model: provider.name, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, costUsd: res.usage.costUsd });
    cachePut(db, cacheKey, { role: res.role, confidence: res.confidence }, provider.name);
    insertEnrichment(db, person.id, 'role', res.role, res.confidence, provenance, provider.name, 'classified from signal mix (no raw records)', 2);
    return res.role;
  } catch (e) {
    if (!(e instanceof BudgetExhaustedError)) throw e;
    if (!existing) insertEnrichment(db, person.id, 'role', 'unknown', 0.3, provenance, 'rules', 'budget exhausted — left unknown rather than guessed', 0);
    return 'unknown';
  }
}

function insertEnrichment(db: DB, entityId: string, field: string, value: string, confidence: number, provenance: string[], model: string, reasoning: string, level: number): void {
  db.prepare(
    `INSERT INTO enrichments (id, tenant, entity_id, field, value, confidence, provenance, model, model_version, reasoning, resolution_level, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id('enr'), config.tenant, entityId, field, value, confidence, j(provenance), model, SCORES_VERSION, reasoning, level, now());
}

export function getRole(db: DB, personId: string): { role: string; confidence: number } {
  const row = db.prepare(
    `SELECT value, confidence FROM enrichments WHERE tenant = ? AND entity_id = ? AND field = 'role' ORDER BY created_at DESC LIMIT 1`
  ).get(config.tenant, personId) as any;
  return row ? { role: row.value, confidence: row.confidence } : { role: 'unknown', confidence: 0 };
}

function upsertIcpFit(db: DB, person: any, role: string, inputHash: string): void {
  const company = person.company
    ? (db.prepare(`SELECT attrs FROM entities WHERE tenant = ? AND type = 'company' AND name = ?`).get(config.tenant, person.company) as any)
    : null;
  const attrs = company ? pj<any>(company.attrs) : {};
  const employees = Number(attrs.employees ?? 0);
  const industry = String(attrs.industry ?? '').toLowerCase();
  const sizePts = employees >= 200 ? 0.35 : employees >= ICP.minEmployees ? 0.25 : 0.1;
  const industryPts = ICP.industries.some((i) => industry.includes(i)) ? 0.3 : 0;
  const rolePts = ICP.buyerRoles.includes(role) ? 0.35 : role === 'developer' ? 0.15 : 0.05;
  upsertScore(db, person.id, 'icp_fit', round2(sizePts + industryPts + rolePts), {
    employees, industry: industry || 'unknown', role, sizePts, industryPts, rolePts,
  }, inputHash);
}

function suggestedAction(signals: Record<string, { count: number }>, side: 'merchant' | 'consumer'): string {
  if (side === 'merchant') {
    if (signals.demo_request || signals.form_submit) return 'Sales outreach — explicit partner hand-raise';
    if (signals.trial_started || signals.payment) return 'Expansion conversation — active partner';
    if (signals.pricing_view) return 'Sales outreach — pricing intent';
    return 'Warm partner outreach with relevant material';
  }
  const ordered = !!signals.payment;
  const engaged = (signals.website_visit?.count ?? 0) + (signals.newsletter_click?.count ?? 0) >= 2;
  if (ordered && engaged) return 'Invite to loyalty / referral program';
  if (ordered) return 'Second-order nudge — personalized picks';
  if (signals.pricing_view) return 'Send first-order promo';
  if (signals.signup) return 'Welcome flow — first-order incentive';
  return 'Re-engagement content';
}

export interface LeadFilters { limit?: number; role?: string; minIntent?: number; company?: string; side?: 'merchant' | 'consumer' }

/** No hardcoded top-N: the caller chooses limit and filters (API exposes them as query params).
 *  The side filter is pushed into SQL — at marketplace scale thousands of consumers would
 *  otherwise crowd every merchant out of the fetch window. */
export function hotLeads(db: DB, f: LeadFilters = {}): any[] {
  const fetchLimit = Math.min(2000, (f.limit ?? 50) * (f.role ? 8 : 1));
  const sideClause = f.side === 'merchant' ? 'AND p.company IS NOT NULL' : f.side === 'consumer' ? 'AND p.company IS NULL' : '';
  const rows = db.prepare(
    `SELECT p.id, p.display_name, p.company, p.title, s.value AS intent, s.factors,
            icp.value AS icp_fit
     FROM scores s
     JOIN persons p ON p.id = s.entity_id AND p.erased = 0
     LEFT JOIN scores icp ON icp.entity_id = s.entity_id AND icp.score_type = 'icp_fit' AND icp.tenant = s.tenant
     WHERE s.tenant = ? AND s.score_type = 'intent' AND s.value >= ? ${sideClause}
     ORDER BY s.value * (0.6 + 0.4 * COALESCE(icp.value, 0.2)) DESC LIMIT ?`
  ).all(config.tenant, f.minIntent ?? 0.25, fetchLimit) as any[];
  return rows
    .map((r) => {
      const factors = pj<any>(r.factors);
      const side: 'merchant' | 'consumer' = r.company ? 'merchant' : 'consumer';
      return {
        personId: r.id,
        name: r.display_name,
        company: r.company,
        title: r.title,
        side,
        role: getRole(db, r.id).role,
        intent: r.intent,
        icpFit: r.icp_fit ?? 0,
        signals: factors.signals,
        evidence: factors.evidence,
        action: suggestedAction(factors.signals ?? {}, side),
      };
    })
    .filter((l) => (!f.role || l.role === f.role) && (!f.company || l.company === f.company) && (!f.side || l.side === f.side))
    .slice(0, f.limit ?? 50);
}

/** Fast aggregate count for KPIs (never materializes rows). */
export function hotLeadCount(db: DB, minIntent = 0.5): number {
  return (db.prepare(
    `SELECT COUNT(*) AS c FROM scores s JOIN persons p ON p.id = s.entity_id AND p.erased = 0
     WHERE s.tenant = ? AND s.score_type = 'intent' AND s.value >= ?`
  ).get(config.tenant, minIntent) as any).c as number;
}

export function fadingChampions(db: DB, limit = 10): any[] {
  const rows = db.prepare(
    `SELECT p.id, p.display_name, p.company, p.title, s.value, s.factors
     FROM scores s JOIN persons p ON p.id = s.entity_id AND p.erased = 0
     WHERE s.tenant = ? AND s.score_type = 'fading' AND s.value > 0
     ORDER BY s.value DESC LIMIT ?`
  ).all(config.tenant, limit) as any[];
  return rows.map((r) => ({
    personId: r.id,
    name: r.display_name,
    company: r.company,
    title: r.title,
    side: r.company ? 'merchant' : 'consumer',
    drop: r.value,
    factors: pj(r.factors),
    action: r.company ? 'Partner retention check-in — engagement dropped sharply' : 'Win-back offer — lapsed customer',
  }));
}
