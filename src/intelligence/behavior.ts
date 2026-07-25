/** Behavior engine — time-windowed aggregates per person. Pure functions over observations. */

export interface BehaviorWindows {
  last7: number;
  last14: number;
  last30: number;
  prior30: number;
  lastActiveDays: number | null;
  bySignal14: Record<string, number>;
}

export function behaviorWindows(obs: Array<{ signal_type: string; observed_at: string }>, nowMs = Date.now()): BehaviorWindows {
  const w: BehaviorWindows = { last7: 0, last14: 0, last30: 0, prior30: 0, lastActiveDays: null, bySignal14: {} };
  for (const o of obs) {
    if (o.signal_type === 'crm_contact') continue;
    const days = (nowMs - Date.parse(o.observed_at)) / 86_400_000;
    if (days <= 7) w.last7++;
    if (days <= 14) {
      w.last14++;
      w.bySignal14[o.signal_type] = (w.bySignal14[o.signal_type] ?? 0) + 1;
    }
    if (days <= 30) w.last30++;
    else if (days <= 60) w.prior30++;
    if (w.lastActiveDays === null || days < w.lastActiveDays) w.lastActiveDays = Math.floor(days);
  }
  return w;
}
