import type { DB } from '../db.js';
import { round2 } from '../util.js';
import { INTENT_WEIGHTS } from '../config.js';
import { loadWorkspace, daysSince, isConsumerOrder, acquisitionChannel, firstObservedAt, type Workspace } from './bulk.js';

/**
 * Platform intelligence — "where should you invest?" answered from data the engine
 * actually observes: channel-attributed signups, engagement, first-touch cohort
 * conversion to orders, repeat rate, merchant lead yield. Deliberately NOT follower
 * counts: platforms don't expose follower identities via official APIs (PRD audit #1),
 * and the Intelligence Law forbids showing numbers we can't ground. All L0.
 */

/** Sources that hold events but aren't acquisition channels you can invest budget in:
 *  orders (transactions), crm (records), webhook (inbound catch-all — hand-raises arrive
 *  through it, but you can't "spend more on webhook"). */
const NON_CHANNEL_SOURCES = new Set(['orders', 'crm', 'webhook']);

export type PlatformCall =
  | 'double down'
  | 'increase budget'
  | 'maintain (B2C awareness)'
  | 'protect'
  | 'expand incentives'
  | 'nurture'
  | 're-engage'
  | 'reduce effort';

export interface PlatformStat {
  source: string;
  people: number;
  activePeople7: number;
  newUsers7: number;
  newUsersPrior7: number;
  signals7: number;
  signalsPrior7: number;
  growthPct: number;
  avgIntent: number;
  avgIntentActive: number;
  hotLeadYield: number;
  conversion: number;
  repeatRate: number;
  avgOrderValue: number;
  merchantLeads14: number;
  quality: number;
  recommendation: PlatformCall;
  topSignals: { type: string; count: number }[];
  topPeople: { name: string; intent: number }[];
  factors: Record<string, number | string>;
}

interface Acc {
  persons: Set<string>;
  active7: Set<string>;
  s7: number;
  sPrior7: number;
  types: Map<string, number>;
  // first-touch cohort
  cohort: Set<string>;
  cohortNew7: number;
  cohortNewPrior7: number;
  cohortOrdered: Set<string>;
  cohortRepeat: Set<string>;
  cohortOrderRevenue: number;
  cohortOrderCount: number;
  merchantLeads14: number;
}

export function platformStats(db: DB, ws: Workspace = loadWorkspace(db)): PlatformStat[] {
  const bySource = new Map<string, Acc>();
  const acc = (source: string): Acc => {
    let a = bySource.get(source);
    if (!a) bySource.set(source, (a = {
      persons: new Set(), active7: new Set(), s7: 0, sPrior7: 0, types: new Map(),
      cohort: new Set(), cohortNew7: 0, cohortNewPrior7: 0, cohortOrdered: new Set(),
      cohortRepeat: new Set(), cohortOrderRevenue: 0, cohortOrderCount: 0, merchantLeads14: 0,
    }));
    return a;
  };
  const names = new Map(ws.persons.map((p) => [p.id, p.display_name]));
  const isMerchant = new Map(ws.persons.map((p) => [p.id, !!p.company]));

  for (const person of ws.persons) {
    const obs = ws.obsByPerson.get(person.id) ?? [];
    // engagement per source
    for (const o of obs) {
      if (NON_CHANNEL_SOURCES.has(o.source)) continue;
      const a = acc(o.source);
      a.persons.add(person.id);
      const behavioral = (INTENT_WEIGHTS[o.signal_type] ?? 0) > 0;
      if (!behavioral) continue;
      const days = daysSince(o.observed_at);
      if (days <= 7) { a.s7++; a.active7.add(person.id); }
      else if (days <= 14) a.sPrior7++;
      a.types.set(o.signal_type, (a.types.get(o.signal_type) ?? 0) + 1);
      if ((o.signal_type === 'form_submit' || o.signal_type === 'demo_request') && isMerchant.get(person.id) && days <= 14) a.merchantLeads14++;
    }
    // first-touch cohort economics (channel that acquired this person)
    const channel = acquisitionChannel(obs);
    if (!channel || NON_CHANNEL_SOURCES.has(channel)) continue;
    const a = acc(channel);
    a.cohort.add(person.id);
    const first = firstObservedAt(obs);
    if (first) {
      const fd = daysSince(first);
      if (fd <= 7) a.cohortNew7++;
      else if (fd <= 14) a.cohortNewPrior7++;
    }
    const orders = obs.filter(isConsumerOrder);
    if (orders.length >= 1) a.cohortOrdered.add(person.id);
    if (orders.length >= 2) a.cohortRepeat.add(person.id);
    a.cohortOrderCount += orders.length;
    a.cohortOrderRevenue += orders.reduce((s, o) => s + Number(o.props?.amount ?? 0), 0);
  }

  const prelim = [...bySource.entries()].map(([source, a]) => {
    const people = a.persons.size;
    const intents = [...a.persons].map((pid) => ws.intents.get(pid) ?? 0);
    const avgIntent = round2(intents.reduce((x, y) => x + y, 0) / Math.max(1, intents.length));
    // quality judges the ACTIVE cohort — averaging over years of dormant users would
    // dilute every channel toward zero and make the calls meaningless at scale
    const activeIntents = [...a.active7].map((pid) => ws.intents.get(pid) ?? 0);
    const avgIntentActive = round2(activeIntents.reduce((x, y) => x + y, 0) / Math.max(1, activeIntents.length));
    const hotLeadYield = round2(intents.filter((v) => v >= 0.5).length / Math.max(1, people));
    const growthPct = Math.round(((a.s7 - a.sPrior7) / Math.max(1, a.sPrior7)) * 100);
    const conversion = round2(a.cohortOrdered.size / Math.max(1, a.cohort.size));
    const repeatRate = round2(a.cohortRepeat.size / Math.max(1, a.cohortOrdered.size));
    const avgOrderValue = a.cohortOrdered.size ? round2(a.cohortOrderRevenue / Math.max(1, a.cohortOrderCount)) : 0;
    const quality = Math.round(100 * (0.4 * avgIntentActive + 0.35 * conversion + 0.25 * repeatRate));
    return {
      source, people, activePeople7: a.active7.size,
      newUsers7: a.cohortNew7, newUsersPrior7: a.cohortNewPrior7,
      signals7: a.s7, signalsPrior7: a.sPrior7, growthPct, avgIntent, avgIntentActive, hotLeadYield,
      conversion, repeatRate, avgOrderValue, merchantLeads14: a.merchantLeads14, quality,
      topSignals: [...a.types.entries()].map(([type, count]) => ({ type, count })).sort((x, y) => y.count - x.count).slice(0, 4),
      topPeople: [...a.persons].map((pid) => ({ name: names.get(pid) ?? 'unknown', intent: ws.intents.get(pid) ?? 0 }))
        .sort((x, y) => y.intent - x.intent).slice(0, 3),
    };
  });

  const sizes = prelim.map((p) => p.people).sort((x, y) => x - y);
  const medianPeople = sizes[Math.floor(sizes.length / 2)] ?? 0;
  const smallCohort = sizes[Math.max(0, Math.floor((sizes.length - 1) * 0.25))] ?? 0;
  const newUserCounts = prelim.map((p) => p.newUsers7).sort((x, y) => x - y);
  const medianNew = newUserCounts[Math.floor(newUserCounts.length / 2)] ?? 0;
  const topLtv = Math.max(0, ...prelim.map((p) => p.avgOrderValue));

  const stats: PlatformStat[] = prelim.map((p) => {
    let recommendation: PlatformCall;
    const declining = p.growthPct < 0;
    if (p.signals7 === 0 && p.signalsPrior7 === 0) recommendation = p.avgIntent >= 0.3 ? 'nurture' : 'reduce effort';
    else if (declining && p.avgIntentActive < 0.25) recommendation = 'reduce effort';
    else if (declining) recommendation = 're-engage';
    else if (p.repeatRate >= 0.55 && p.newUsers7 <= medianNew) recommendation = 'protect';
    else if (p.avgOrderValue > 0 && p.avgOrderValue >= topLtv && p.people <= smallCohort * 1.05) recommendation = 'expand incentives';
    else if (p.conversion >= 0.35 && (p.avgIntentActive >= 0.3 || p.repeatRate >= 0.4)) recommendation = 'increase budget';
    else if (p.growthPct >= 25 && p.merchantLeads14 >= 3) recommendation = 'double down';
    else if (p.merchantLeads14 >= 5) recommendation = 'double down';
    else if (p.growthPct >= 25) recommendation = 'maintain (B2C awareness)';
    else recommendation = 'nurture';
    return {
      ...p,
      recommendation,
      factors: {
        growthPct: p.growthPct, avgIntentActive: p.avgIntentActive, conversion: p.conversion,
        repeatRate: p.repeatRate, avgOrderValue: p.avgOrderValue, merchantLeads14: p.merchantLeads14,
        medianNewUsers: medianNew, rule: recommendation,
      },
    };
  });
  return stats.sort((x, y) => y.quality - x.quality);
}
