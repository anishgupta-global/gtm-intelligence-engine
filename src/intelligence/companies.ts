import type { DB } from '../db.js';
import { pj } from '../db.js';
import { round2 } from '../util.js';
import { config } from '../config.js';
import { getPersonObservations } from '../identity/resolve.js';

/**
 * Company intelligence (Business pack seed) — accounts rolled up from the graph:
 * engaged people, aggregate intent, churn risk, observed revenue. All L0.
 */

export interface CompanyStat {
  company: string;
  industry: string;
  employees: number;
  people: number;
  avgIntent: number;
  maxIntent: number;
  icpFit: number;
  churnRisk: number;
  mrr: number;
  signals7: number;
  action: string;
}

export function companyStats(db: DB): CompanyStat[] {
  const companies = db.prepare(`SELECT id, name, attrs FROM entities WHERE tenant = ? AND type = 'company'`).all(config.tenant) as any[];
  const stats: CompanyStat[] = [];
  for (const c of companies) {
    const members = db.prepare(
      `SELECT p.id FROM edges e JOIN persons p ON p.id = e.from_id AND p.erased = 0
       WHERE e.tenant = ? AND e.type = 'WORKS_AT' AND e.to_id = ?`
    ).all(config.tenant, c.id) as any[];
    if (!members.length) continue;
    let intents: number[] = [], icp = 0, churn = 0, mrr = 0, signals7 = 0;
    for (const m of members) {
      const sc = db.prepare(`SELECT score_type, value FROM scores WHERE tenant = ? AND entity_id = ?`).all(config.tenant, m.id) as any[];
      for (const s of sc) {
        if (s.score_type === 'intent') intents.push(s.value);
        if (s.score_type === 'icp_fit') icp = Math.max(icp, s.value);
        if (s.score_type === 'fading') churn = Math.max(churn, s.value);
      }
      for (const o of getPersonObservations(db, m.id)) {
        const days = (Date.now() - Date.parse(o.observed_at)) / 86_400_000;
        if (days <= 7 && o.signal_type !== 'crm_contact') signals7++;
        if (o.signal_type === 'payment' && days <= 60) mrr += Number(pj<any>(o.payload)?.props?.mrr ?? 0);
      }
    }
    const avgIntent = round2(intents.reduce((a, b) => a + b, 0) / Math.max(1, intents.length));
    const maxIntent = round2(Math.max(0, ...intents));
    const attrs = pj<any>(c.attrs);
    const action =
      churn >= 0.5 ? 'Retention call — engagement collapsed'
      : maxIntent >= 0.6 ? 'Sales outreach — active buying motion'
      : mrr > 0 ? 'Expansion conversation'
      : avgIntent >= 0.3 ? 'Nurture — warming up'
      : 'Monitor';
    stats.push({
      company: c.name,
      industry: String(attrs.industry ?? 'unknown'),
      employees: Number(attrs.employees ?? 0),
      people: members.length,
      avgIntent,
      maxIntent,
      icpFit: round2(icp),
      churnRisk: round2(churn),
      mrr,
      signals7,
      action,
    });
  }
  return stats.sort((a, b) => b.maxIntent - a.maxIntent);
}
