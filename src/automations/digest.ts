import type { DB } from '../db.js';
import { config } from '../config.js';
import { audienceSummary } from '../intelligence/segments.js';
import { hotLeads, fadingChampions } from '../intelligence/scores.js';
import { listDecisions } from '../decisions/reason.js';
import { evaluationMetrics } from '../decisions/evaluate.js';
import { costReport } from '../cost/router.js';
import { logEvent, audit } from '../pipeline/events.js';

/**
 * Automation engine (L11) + executive report (L12): the weekly GTM digest — the wedge
 * deliverable. Aggregates + reasoning only; no raw PII beyond name/company/action
 * (allowlisted fields), and outbound sends are audit-logged.
 */

export function buildDigest(db: DB): string {
  const s = audienceSummary(db);
  const hot = hotLeads(db, 5);
  const fading = fadingChampions(db, 3);
  const decision = listDecisions(db).find((d: any) => d.status === 'proposed' || d.status === 'accepted');
  const ev = evaluationMetrics(db);
  const cost = costReport(db);

  const lines: string[] = [
    `# Weekly GTM digest`,
    ``,
    `**Audience:** ${s.people} people · ${s.companies} companies · +${s.newPeople7} people this week · ${s.observations} observations`,
    ``,
    `## Segment momentum (7d vs prior 7d)`,
    ...s.segments.map((x: any) => `- ${x.segment}: ${x.current} signals (${x.deltaPct >= 0 ? '+' : ''}${x.deltaPct}%)`),
    ``,
    `## Who to talk to this week`,
    ...hot.map((l: any, i: number) =>
      `${i + 1}. **${l.name}** — ${l.title ?? l.role}, ${l.company ?? 'unknown'} · intent ${l.intent} · ${l.action}\n   signals: ${Object.entries(l.signals ?? {}).map(([t, v]: any) => `${t}×${v.count}`).join(', ')} · evidence: ${(l.evidence ?? []).slice(0, 3).join(', ')}`
    ),
    ``,
    `## Going quiet`,
    ...(fading.length ? fading.map((f: any) => `- **${f.name}** (${f.company ?? 'unknown'}) — engagement down ${Math.round(f.drop * 100)}% · ${f.action}`) : ['- none this week']),
  ];

  if (decision) {
    lines.push(
      ``,
      `## Recommendation — ${decision.title}`,
      `- Hypothesis: ${decision.trace.hypothesis}`,
      `- Reasoning: ${decision.trace.reasoning}`,
      `- Action: ${decision.trace.action}`,
      `- Confidence: ${decision.confidence}${decision.priors?.length ? ` · memory prior: ${Math.round(decision.priors[0].similarity * 100)}% similar to a past ${decision.priors[0].verdict}` : ''}`,
      `- Expected: ${decision.expected.target} ${decision.expected.metric}`,
      `- Evidence: ${decision.trace.evidence.slice(0, 5).join(', ')}`
    );
  }

  lines.push(
    ``,
    `## Engine health`,
    `- Decisions: ${ev.decisionsTotal} total · acceptance ${ev.acceptanceRate ?? 'n/a'} · success ${ev.successRate ?? 'n/a'} · mean calibration error ${ev.meanCalibrationError ?? 'n/a'}`,
    `- AI spend: $${cost.totalSpendUsd} of $${cost.budget.budgetUsd} (${cost.budget.mode}) · cost per insight $${cost.costPerInsight} · cache hits ${cost.cacheHits}`,
    `- Work distribution: ${cost.levels.map((l: any) => `${l.label} ${l.pct}%`).join(' · ')}`
  );

  logEvent(db, 'digest', null, { hot: hot.length, fading: fading.length });
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
