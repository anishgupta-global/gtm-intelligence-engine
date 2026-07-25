import { clamp } from '../util.js';
import { config } from '../config.js';
import { buildRecommendationPrompt, buildRoleClassifyPrompt, type Aggregates } from './prompts.js';

export interface Usage { inputTokens: number; outputTokens: number; costUsd: number }

export interface RecommendationDraft {
  title: string;
  hypothesis: string;
  reasoning: string;
  action: string;
  confidence: number;
  expectedTarget: number;
  usage: Usage;
}

export interface RoleResult { role: string; confidence: number; usage: Usage }

export interface LLMProvider {
  name: string;
  /** L2 — small model classification. */
  classifyRole(input: { company?: string; title?: string; signalCounts: Record<string, number> }): Promise<RoleResult>;
  /** L3 — large model reasoning over aggregates only. `lean` downgrades to the small model. */
  recommend(agg: Aggregates, lean: boolean): Promise<RecommendationDraft>;
}

const ZERO: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

/**
 * Grounded mock provider — the $0 default. Deterministic templates computed from the
 * aggregates it is given, so its output is always evidence-backed (never invented),
 * just less fluent than a real model. Also the L0 fallback when the budget is exhausted.
 */
export class MockProvider implements LLMProvider {
  name = 'mock';

  async classifyRole(input: { company?: string; title?: string; signalCounts: Record<string, number> }): Promise<RoleResult> {
    const dev = (input.signalCounts.repo_star ?? 0) + (input.signalCounts.repo_issue ?? 0) + (input.signalCounts.docs_view ?? 0);
    if (dev >= 2) return { role: 'developer', confidence: 0.72, usage: ZERO };
    return { role: 'unknown', confidence: 0.3, usage: ZERO };
  }

  async recommend(agg: Aggregates, _lean: boolean): Promise<RecommendationDraft> {
    // only segments with an established prior-week baseline can "move"; a brand-new
    // segment with previous=0 would produce absurd deltas
    const moving = [...agg.segments].filter((s) => s.current >= 3 && s.previous >= 5).sort((a, b) => b.deltaPct - a.deltaPct);
    const top = moving[0] ?? [...agg.segments].sort((a, b) => b.current - a.current)[0] ?? { segment: 'audience', current: 0, previous: 0, deltaPct: 0 };
    const declining = [...agg.segments].sort((a, b) => a.deltaPct - b.deltaPct)[0];
    const driver = agg.topSignals14[0]?.type ?? 'website_visit';
    const driverLabel = driver.replace(/_/g, ' ');
    const routed = Math.min(agg.hotLeadCount, 40);
    const confidence = clamp(0.5 + 0.2 * Math.min(1, Math.abs(top.deltaPct) / 30) + 0.15 * Math.min(1, agg.hotLeadCount / 10), 0.35, 0.85);
    return {
      title: `Prioritize ${top.segment}: ${driverLabel} campaign + route top ${routed} hot leads to outreach`,
      hypothesis: `${top.segment} engagement moved ${top.deltaPct >= 0 ? '+' : ''}${top.deltaPct}% week over week (${top.current.toLocaleString()} vs ${top.previous.toLocaleString()} signals), led by ${driverLabel}.`,
      reasoning: `The strongest momentum is in ${top.segment} while ${declining?.segment ?? 'other segments'} is at ${declining?.deltaPct ?? 0}%. ${agg.hotLeadCount.toLocaleString()} people currently show high buying intent and ${agg.fadingCount} previously engaged people are going quiet — concentrating this week's outreach on the moving segment converts momentum while it exists.`,
      action: `Publish one ${driverLabel}-focused piece for ${top.segment} and start outreach with the top ${routed} of ${agg.hotLeadCount.toLocaleString()} hot leads; open retention conversations with the ${agg.fadingCount} fading champions.`,
      confidence: Math.round(confidence * 100) / 100,
      expectedTarget: Math.max(2, Math.round(routed * 0.5)),
      usage: ZERO,
    };
  }
}

/** Prices per 1M tokens (docs/adr/0008) — used for the ledger's cost estimates. */
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-sonnet-5': { in: 3, out: 15 },
};

function estimate(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model] ?? { in: 3, out: 15 };
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}

/** Real reasoning via the Claude API. Small model for L2, large for L3 (small when budget is lean). */
export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private client: any;

  private async getClient() {
    if (!this.client) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      this.client = new Anthropic({ apiKey: config.anthropicKey });
    }
    return this.client;
  }

  private async callJson(model: string, prompt: string, maxTokens: number): Promise<{ json: any; usage: Usage }> {
    const client = await this.getClient();
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('');
    const match = text.match(/\{[\s\S]*\}/);
    const usage: Usage = {
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
      costUsd: estimate(model, res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0),
    };
    return { json: match ? JSON.parse(match[0]) : {}, usage };
  }

  async classifyRole(input: { company?: string; title?: string; signalCounts: Record<string, number> }): Promise<RoleResult> {
    const { json, usage } = await this.callJson(config.smallModel, buildRoleClassifyPrompt(input), 200);
    return { role: String(json.role ?? 'unknown'), confidence: clamp(Number(json.confidence ?? 0.5), 0, 1), usage };
  }

  async recommend(agg: Aggregates, lean: boolean): Promise<RecommendationDraft> {
    const model = lean ? config.smallModel : config.smartModel;
    const { json, usage } = await this.callJson(model, buildRecommendationPrompt(agg), 700);
    return {
      title: String(json.title ?? 'GTM recommendation'),
      hypothesis: String(json.hypothesis ?? ''),
      reasoning: String(json.reasoning ?? ''),
      action: String(json.action ?? ''),
      confidence: clamp(Number(json.confidence ?? 0.5), 0, 1),
      expectedTarget: Math.max(1, Math.round(Number(json.expected_qualified_conversations ?? 5))),
      usage,
    };
  }
}

export function getProvider(): LLMProvider {
  return config.anthropicKey ? new AnthropicProvider() : new MockProvider();
}
