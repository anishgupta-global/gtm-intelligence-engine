import type { DB } from '../db.js';
import { config } from '../config.js';
import { loadWorkspace, daysSince, isConsumerOrder, firstObservedAt, type Workspace, type ObsLite } from './bulk.js';
import type { SegmentStat } from '../ai/prompts.js';

/**
 * Marketplace segments — L0 rules over the two-sided graph.
 * Merchant partners (supply side) vs consumer cohorts (demand side).
 */

/** Segment as of a point in time (asOfDays ago) — so week-over-week comparisons compare
 *  like with like: last week's "New consumers" were the people who were new LAST week. */
export function segmentAsOf(person: { company: string | null }, role: string, obs: ObsLite[], asOfDays = 0): string {
  if (person.company || role === 'founder' || role === 'executive') return 'Merchant partners';
  const first = firstObservedAt(obs);
  if (first && daysSince(first) - asOfDays <= 7 && daysSince(first) >= asOfDays) return 'New consumers';
  const orders = obs.filter((o) => isConsumerOrder(o) && daysSince(o.observed_at) >= asOfDays);
  const revenue = orders.reduce((s, o) => s + Number(o.props?.amount ?? 0), 0);
  if (orders.length >= 3 || revenue >= 90) return 'High-value consumers';
  if (orders.length >= 1) return 'Returning consumers';
  return 'Browsing consumers';
}

export function segmentOf(person: { company: string | null }, role: string, obs: ObsLite[]): string {
  return segmentAsOf(person, role, obs, 0);
}

export function segmentMomentum(db: DB, ws: Workspace = loadWorkspace(db)): SegmentStat[] {
  const stats = new Map<string, { current: number; previous: number }>();
  const bump = (seg: string, field: 'current' | 'previous') => {
    let s = stats.get(seg);
    if (!s) stats.set(seg, (s = { current: 0, previous: 0 }));
    s[field]++;
  };
  for (const person of ws.persons) {
    const obs = ws.obsByPerson.get(person.id) ?? [];
    const role = ws.roles.get(person.id) ?? 'unknown';
    const segNow = segmentAsOf(person, role, obs, 0);
    const segPrior = segmentAsOf(person, role, obs, 7);
    for (const o of obs) {
      if (o.signal_type === 'crm_contact') continue;
      const days = daysSince(o.observed_at);
      if (days <= 7) bump(segNow, 'current');
      else if (days <= 14) bump(segPrior, 'previous');
    }
  }
  return [...stats.entries()]
    .map(([segment, s]) => ({
      segment,
      current: s.current,
      previous: s.previous,
      deltaPct: Math.round(((s.current - s.previous) / Math.max(1, s.previous)) * 100),
    }))
    .sort((a, b) => b.current - a.current);
}

export function audienceSummary(db: DB, ws: Workspace = loadWorkspace(db)): any {
  let newPeople7 = 0, merchants = 0, ordersThisWeek = 0, revenue7 = 0;
  for (const person of ws.persons) {
    const obs = ws.obsByPerson.get(person.id) ?? [];
    const first = firstObservedAt(obs);
    if (first && daysSince(first) <= 7) newPeople7++;
    if (person.company) merchants++;
    for (const o of obs) {
      if (isConsumerOrder(o) && daysSince(o.observed_at) <= 7) {
        ordersThisWeek++;
        revenue7 += Number(o.props?.amount ?? 0);
      }
    }
  }
  const companies = (db.prepare(`SELECT COUNT(*) AS c FROM entities WHERE tenant = ? AND type = 'company'`).get(config.tenant) as any).c;
  const observations = (db.prepare(`SELECT COUNT(*) AS c FROM observations WHERE tenant = ? AND erased = 0`).get(config.tenant) as any).c;
  return {
    people: ws.persons.length,
    consumers: ws.persons.length - merchants,
    merchants,
    newPeople7,
    ordersThisWeek,
    orderRevenue7: Math.round(revenue7),
    companies,
    observations,
    segments: segmentMomentum(db, ws),
  };
}
