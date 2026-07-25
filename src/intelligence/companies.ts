import type { DB } from '../db.js';
import { pj } from '../db.js';
import { round2 } from '../util.js';
import { config } from '../config.js';
import { loadWorkspace, daysSince, isConsumerOrder, type Workspace } from './bulk.js';

/**
 * Account intelligence (Business pack) — restaurant partners rolled up from the graph:
 * merchant contacts, aggregate intent, churn risk, observed revenue (partner payouts +
 * consumer order volume attributed by restaurant). All L0, single workspace scan.
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
  orderRevenue60: number;
  orders7: number;
  signals7: number;
  action: string;
}

export function companyStats(db: DB, ws: Workspace = loadWorkspace(db)): CompanyStat[] {
  const icp = new Map<string, number>();
  const fading = new Map<string, number>();
  for (const s of db.prepare(`SELECT entity_id, score_type, value FROM scores WHERE tenant = ? AND score_type IN ('icp_fit','fading')`).all(config.tenant) as any[]) {
    (s.score_type === 'icp_fit' ? icp : fading).set(s.entity_id, s.value);
  }

  // consumer order volume attributed to each restaurant (last 60 days)
  const orderRev = new Map<string, { revenue: number; orders7: number }>();
  for (const person of ws.persons) {
    for (const o of ws.obsByPerson.get(person.id) ?? []) {
      if (!isConsumerOrder(o) || !o.props?.restaurant) continue;
      const days = daysSince(o.observed_at);
      if (days > 60) continue;
      let r = orderRev.get(String(o.props.restaurant));
      if (!r) orderRev.set(String(o.props.restaurant), (r = { revenue: 0, orders7: 0 }));
      r.revenue += Number(o.props.amount ?? 0);
      if (days <= 7) r.orders7++;
    }
  }

  const membersByCompany = new Map<string, typeof ws.persons>();
  for (const p of ws.persons) {
    if (!p.company) continue;
    let list = membersByCompany.get(p.company);
    if (!list) membersByCompany.set(p.company, (list = []));
    list.push(p);
  }

  const companies = db.prepare(`SELECT name, attrs FROM entities WHERE tenant = ? AND type = 'company'`).all(config.tenant) as any[];
  const stats: CompanyStat[] = [];
  for (const c of companies) {
    const members = membersByCompany.get(c.name) ?? [];
    if (!members.length) continue;
    let intents: number[] = [], icpMax = 0, churn = 0, mrr = 0, signals7 = 0;
    for (const m of members) {
      intents.push(ws.intents.get(m.id) ?? 0);
      icpMax = Math.max(icpMax, icp.get(m.id) ?? 0);
      churn = Math.max(churn, fading.get(m.id) ?? 0);
      for (const o of ws.obsByPerson.get(m.id) ?? []) {
        const days = daysSince(o.observed_at);
        if (days <= 7 && o.signal_type !== 'crm_contact') signals7++;
        if (o.signal_type === 'payment' && o.props?.type === 'partner_payout' && days <= 60) mrr += Number(o.props?.mrr ?? 0);
      }
    }
    const rev = orderRev.get(c.name) ?? { revenue: 0, orders7: 0 };
    const avgIntent = round2(intents.reduce((a, b) => a + b, 0) / Math.max(1, intents.length));
    const maxIntent = round2(Math.max(0, ...intents));
    const attrs = pj<any>(c.attrs);
    const action =
      churn >= 0.5 ? 'Retention call — partner engagement collapsed'
      : maxIntent >= 0.6 ? 'Sales outreach — active buying motion'
      : mrr > 0 || rev.revenue > 0 ? 'Expansion conversation'
      : avgIntent >= 0.3 ? 'Nurture — warming up'
      : 'Monitor';
    stats.push({
      company: c.name,
      industry: String(attrs.industry ?? 'food'),
      employees: Number(attrs.employees ?? 0),
      people: members.length,
      avgIntent,
      maxIntent,
      icpFit: round2(icpMax),
      churnRisk: round2(churn),
      mrr,
      orderRevenue60: Math.round(rev.revenue),
      orders7: rev.orders7,
      signals7,
      action,
    });
  }
  return stats.sort((a, b) => (b.maxIntent + b.churnRisk) - (a.maxIntent + a.churnRisk));
}
