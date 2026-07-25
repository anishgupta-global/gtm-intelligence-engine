import { redactPii } from '../util.js';

/**
 * Aggregates-only prompt builders. LLMs never see raw records: the ONLY input type
 * accepted here is this small numeric summary — ~50 numbers, not 100k rows.
 */

export interface SegmentStat { segment: string; current: number; previous: number; deltaPct: number }

export interface Aggregates {
  audiencePeople: number;
  newPeople7: number;
  hotLeadCount: number;
  fadingCount: number;
  segments: SegmentStat[];
  topSignals14: { type: string; count: number }[];
  hotLeadRoleMix: Record<string, number>;
  hotLeadCompanySizeMix: Record<string, number>;
}

export function buildRecommendationPrompt(agg: Aggregates): string {
  const lines = [
    'You are the reasoning engine of a GTM intelligence platform.',
    'Based ONLY on the aggregate audience statistics below, produce one GTM recommendation.',
    'Respond with strict JSON: {"title": string, "hypothesis": string, "reasoning": string, "action": string, "confidence": number 0..1, "expected_qualified_conversations": integer}.',
    'Ground every claim in the numbers given. Do not invent data.',
    '',
    `Audience: ${agg.audiencePeople} people (+${agg.newPeople7} in last 7 days)`,
    `Hot leads: ${agg.hotLeadCount} · Fading champions: ${agg.fadingCount}`,
    'Segment momentum (7d vs prior 7d):',
    ...agg.segments.map((s) => `- ${s.segment}: ${s.current} signals vs ${s.previous} (${s.deltaPct >= 0 ? '+' : ''}${s.deltaPct}%)`),
    'Top signals (14d): ' + agg.topSignals14.map((s) => `${s.type}=${s.count}`).join(', '),
    'Hot-lead role mix: ' + JSON.stringify(agg.hotLeadRoleMix),
    'Hot-lead company-size mix: ' + JSON.stringify(agg.hotLeadCompanySizeMix),
  ];
  return redactPii(lines.join('\n'));
}

export function buildRoleClassifyPrompt(input: { company?: string; title?: string; signalCounts: Record<string, number> }): string {
  return redactPii(
    [
      'Classify this contact into one role bucket: founder | executive | data_leader | developer | marketer | other | unknown.',
      'Respond with strict JSON: {"role": string, "confidence": number 0..1}.',
      `Title fragment: ${input.title ?? 'none'} · Company: ${input.company ?? 'unknown'}`,
      `Signal counts: ${JSON.stringify(input.signalCounts)}`,
    ].join('\n')
  );
}
