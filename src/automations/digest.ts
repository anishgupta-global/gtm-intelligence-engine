import type { DB } from '../db.js';
import { config } from '../config.js';
import { audienceSummary } from '../intelligence/segments.js';
import { hotLeads, fadingChampions } from '../intelligence/scores.js';
import { listDecisions } from '../decisions/reason.js';
import { platformStats } from '../intelligence/platforms.js';
import { evaluationMetrics } from '../decisions/evaluate.js';
import { costReport } from '../cost/router.js';
import { logEvent, audit } from '../pipeline/events.js';

/**
 * Automation engine (L11) + executive report (L12): the weekly GTM digest — the wedge
 * deliverable. Aggregates + reasoning only; no raw PII beyond name/company/action
 * (allowlisted fields), and outbound sends are audit-logged.
 */

/** Order for the numbered "Weekly Growth Decisions" list. Allocation first (biggest
 *  lever this week), then the segment-level GTM decision, then per-account retention
 *  calls. Hot leads are shown as supporting context — they are the evidence behind the
 *  GTM decision, not decisions themselves. */
const DECISION_KIND_ORDER = ['platform_allocation', 'weekly_gtm', 'account_retention'];
const KIND_LABEL: Record<string, string> = {
  platform_allocation: 'where to invest',
  weekly_gtm: 'who to contact',
  account_retention: 'account to save',
};

export function buildDigest(db: DB): string {
  const s = audienceSummary(db);
  const hot = hotLeads(db, { limit: 5, side: 'merchant' });
  const topConsumers = hotLeads(db, { limit: 3, side: 'consumer' });
  const fading = fadingChampions(db, 3);
  const decisions = listDecisions(db);
  const open = decisions
    .filter((d: any) => d.status === 'proposed' || d.status === 'accepted')
    .sort((a: any, b: any) => DECISION_KIND_ORDER.indexOf(a.kind) - DECISION_KIND_ORDER.indexOf(b.kind));
  const platforms = platformStats(db);
  const ev = evaluationMetrics(db);
  const cost = costReport(db);

  const lines: string[] = [`# Weekly Growth Decisions`, ``];

  if (open.length === 0) {
    lines.push(`_No open decisions yet — run the pipeline to generate this week's decisions._`, ``);
  }

  open.forEach((d: any, i: number) => {
    const prior = d.priors?.[0];
    lines.push(
      `${i + 1}. **${d.title}** _(${KIND_LABEL[d.kind] ?? d.kind})_`,
      `   Reason: ${d.trace.hypothesis}`,
      `   Action: ${d.trace.action}`,
      `   Evidence: ${(d.trace.evidence ?? []).slice(0, 4).join(', ') || '—'}`,
      `   Confidence: ${d.confidence} · Expected: ${d.expected.target} ${d.expected.metric}${prior ? ` · memory: ${Math.round(prior.similarity * 100)}% similar to a past ${prior.verdict}` : ''}`,
      ``
    );
  });

  lines.push(
    `## Platform comparison (observed engagement per source — never follower counts)`,
    ...platforms.map((p) => `- **${p.source}** — ${p.people.toLocaleString()} people · +${p.newUsers7.toLocaleString()} new/wk · signals ${p.growthPct >= 0 ? '+' : ''}${p.growthPct}% · conversion ${Math.round(p.conversion * 100)}% · repeat ${Math.round(p.repeatRate * 100)}% · ${p.merchantLeads14} merchant leads · quality ${p.quality}/100 → **${p.recommendation}**`),
    ``,
    `## Merchant leads (evidence for the who-to-contact decision)`,
    ...hot.map((l: any, i: number) =>
      `${i + 1}. **${l.name}** — ${l.title ?? l.role}, ${l.company} · intent ${l.intent} · ${l.action}\n   signals: ${Object.entries(l.signals ?? {}).map(([t, v]: any) => `${t}×${v.count}`).join(', ')} · evidence: ${(l.evidence ?? []).slice(0, 3).join(', ')}`
    ),
    ``,
    `Top consumers: ${topConsumers.map((l: any) => `${l.name} (${l.intent} — ${l.action})`).join(' · ') || '—'}`,
    ``,
    `## Going quiet`,
    ...(fading.length ? fading.map((f: any) => `- **${f.name}** (${f.company ?? 'consumer'}) — engagement down ${Math.round(f.drop * 100)}% · ${f.action}`) : ['- none this week']),
    ``,
    `## Audience`,
    `- ${s.people.toLocaleString()} people (${s.consumers.toLocaleString()} consumers · ${s.merchants} merchant contacts) · +${s.newPeople7.toLocaleString()} new users this week`,
    `- ${s.ordersThisWeek.toLocaleString()} orders this week (€${s.orderRevenue7.toLocaleString()}) · ${s.companies} restaurant partners · ${s.observations.toLocaleString()} observations`,
    ``,
    `## Engine health`,
    `- Decisions: ${ev.decisionsTotal} total · acceptance ${ev.acceptanceRate ?? 'n/a'} · success ${ev.successRate ?? 'n/a'} · mean calibration error ${ev.meanCalibrationError ?? 'n/a'}`,
    `- AI spend: $${cost.totalSpendUsd} of $${cost.budget.budgetUsd} (${cost.budget.mode}) · cost per insight $${cost.costPerInsight} · cache hits ${cost.cacheHits}`,
    `- Work distribution: ${cost.levels.map((l: any) => `${l.label} ${l.pct}%`).join(' · ')}`
  );

  logEvent(db, 'digest', null, { decisions: open.length, hot: hot.length, fading: fading.length });
  return lines.join('\n');
}

export async function sendDigestToSlack(db: DB, markdown: string): Promise<boolean> {
  if (!config.slackWebhookUrl) return false;
  const res = await fetch(config.slackWebhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: markdown.slice(0, 3500) }),
  });
  audit(db, 'outbound_send', `slack digest -> ${new URL(config.slackWebhookUrl).host} (${res.status})`);
  return res.ok;
}
