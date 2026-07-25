import type { DB } from '../db.js';
import { round2 } from '../util.js';
import { config, INTENT_WEIGHTS } from '../config.js';

/**
 * Platform intelligence — "where should you invest?" answered from data the engine
 * actually observes: engaged people, signal volume, growth, intent yield per source.
 * Deliberately NOT follower counts: most social platforms don't expose reach through
 * official APIs (PRD audit #1), and the Intelligence Law forbids showing numbers we
 * can't ground. Engagement quality per source is the honest — and more actionable — metric.
 * All L0: pure SQL + arithmetic, zero AI spend.
 */

export interface PlatformStat {
  source: string;
  people: number;
  activePeople7: number;
  signals7: number;
  signalsPrior7: number;
  growthPct: number;
  avgIntent: number;
  hotLeadYield: number;
  quality: number;
  recommendation: 'double down' | 'nurture' | 're-engage' | 'reduce effort';
  topSignals: { type: string; count: number }[];
  topPeople: { name: string; intent: number }[];
  factors: Record<string, number | string>;
}

export function platformStats(db: DB): PlatformStat[] {
  const rows = db.prepare(
    `SELECT DISTINCT o.id AS obs_id, o.source, o.signal_type, o.observed_at, m.person_id AS pid
     FROM observations o
     JOIN identifiers i ON i.observation_id = o.id AND i.tenant = o.tenant
     JOIN person_memberships m ON m.identifier_key = (i.kind || ':' || i.value) AND m.status = 'active' AND m.tenant = o.tenant
     JOIN persons p ON p.id = m.person_id AND p.erased = 0
     WHERE o.tenant = ? AND o.erased = 0`
  ).all(config.tenant) as any[];

  const intent = new Map<string, number>();
  for (const s of db.prepare(`SELECT entity_id, value FROM scores WHERE tenant = ? AND score_type = 'intent'`).all(config.tenant) as any[]) {
    intent.set(s.entity_id, s.value);
  }
  const names = new Map<string, string>();
  for (const p of db.prepare(`SELECT id, display_name FROM persons WHERE tenant = ? AND erased = 0`).all(config.tenant) as any[]) {
    names.set(p.id, p.display_name);
  }

  const bySource = new Map<string, { persons: Set<string>; active7: Set<string>; s7: number; sPrior7: number; types: Map<string, number>; seenObs: Set<string> }>();
  for (const r of rows) {
    if (!bySource.has(r.source)) bySource.set(r.source, { persons: new Set(), active7: new Set(), s7: 0, sPrior7: 0, types: new Map(), seenObs: new Set() });
    const s = bySource.get(r.source)!;
    s.persons.add(r.pid);
    if (s.seenObs.has(r.obs_id)) continue;
    s.seenObs.add(r.obs_id);
    const behavioral = (INTENT_WEIGHTS[r.signal_type] ?? 0) > 0;
    const days = (Date.now() - Date.parse(r.observed_at)) / 86_400_000;
    if (behavioral && days <= 7) { s.s7++; s.active7.add(r.pid); }
    else if (behavioral && days <= 14) s.sPrior7++;
    if (behavioral) s.types.set(r.signal_type, (s.types.get(r.signal_type) ?? 0) + 1);
  }

  const stats: PlatformStat[] = [];
  for (const [source, s] of bySource) {
    const people = s.persons.size;
    const intents = [...s.persons].map((pid) => intent.get(pid) ?? 0);
    const avgIntent = round2(intents.reduce((a, b) => a + b, 0) / Math.max(1, intents.length));
    const hotLeadYield = round2(intents.filter((v) => v >= 0.5).length / Math.max(1, people));
    const growthPct = Math.round(((s.s7 - s.sPrior7) / Math.max(1, s.sPrior7)) * 100);
    const activeShare = s.active7.size / Math.max(1, people);
    const quality = Math.round(60 * avgIntent + 40 * activeShare);
    let recommendation: PlatformStat['recommendation'];
    if (s.s7 === 0 && s.sPrior7 === 0) recommendation = avgIntent >= 0.3 ? 'nurture' : 'reduce effort';
    else if (growthPct > 15 && avgIntent >= 0.35) recommendation = 'double down';
    else if (growthPct < 0 && avgIntent >= 0.3) recommendation = 're-engage';
    else if (growthPct < 0 || avgIntent < 0.15) recommendation = 'reduce effort';
    else recommendation = 'nurture';
    stats.push({
      source,
      people,
      activePeople7: s.active7.size,
      signals7: s.s7,
      signalsPrior7: s.sPrior7,
      growthPct,
      avgIntent,
      hotLeadYield,
      quality,
      recommendation,
      topSignals: [...s.types.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count).slice(0, 4),
      topPeople: [...s.persons]
        .map((pid) => ({ name: names.get(pid) ?? 'unknown', intent: intent.get(pid) ?? 0 }))
        .sort((a, b) => b.intent - a.intent)
        .slice(0, 3),
      factors: { avgIntent, activeShare: round2(activeShare), growthPct, rule: recommendation },
    });
  }
  return stats.sort((a, b) => b.quality - a.quality);
}
