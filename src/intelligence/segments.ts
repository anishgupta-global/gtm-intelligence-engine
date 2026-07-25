import type { DB } from '../db.js';
import { pj } from '../db.js';
import { config } from '../config.js';
import { listActivePersons, getPersonObservations } from '../identity/resolve.js';
import { getRole } from './scores.js';
import type { SegmentStat } from '../ai/prompts.js';

/** Segments — L0 rules over role + company size. Momentum = signals 7d vs prior 7d. */

export function personSegment(db: DB, person: any): string {
  const { role } = getRole(db, person.id);
  if (role === 'developer') return 'Developers';
  const company = person.company
    ? (db.prepare(`SELECT attrs FROM entities WHERE tenant = ? AND type = 'company' AND name = ?`).get(config.tenant, person.company) as any)
    : null;
  const employees = company ? Number(pj<any>(company.attrs).employees ?? 0) : 0;
  if (employees >= 200) return 'Enterprise';
  if (employees >= 50) return 'Mid-market';
  return 'Startups & SMB';
}

export function segmentMomentum(db: DB): SegmentStat[] {
  const stats = new Map<string, { current: number; previous: number }>();
  for (const person of listActivePersons(db)) {
    const seg = personSegment(db, person);
    if (!stats.has(seg)) stats.set(seg, { current: 0, previous: 0 });
    const s = stats.get(seg)!;
    for (const o of getPersonObservations(db, person.id)) {
      if (o.signal_type === 'crm_contact') continue;
      const days = (Date.now() - Date.parse(o.observed_at)) / 86_400_000;
      if (days <= 7) s.current++;
      else if (days <= 14) s.previous++;
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

export function audienceSummary(db: DB): any {
  const people = listActivePersons(db);
  const newPeople7 = people.filter((p: any) => Date.now() - Date.parse(p.created_at) < 7 * 86_400_000).length;
  const companies = (db.prepare(`SELECT COUNT(*) AS c FROM entities WHERE tenant = ? AND type = 'company'`).get(config.tenant) as any).c;
  const observations = (db.prepare(`SELECT COUNT(*) AS c FROM observations WHERE tenant = ? AND erased = 0`).get(config.tenant) as any).c;
  return { people: people.length, newPeople7, companies, observations, segments: segmentMomentum(db) };
}
