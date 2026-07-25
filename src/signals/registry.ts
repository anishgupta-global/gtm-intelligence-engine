import { z } from 'zod';

/**
 * Signal Registry — every event entering the engine becomes a typed signal.
 * Connectors map raw source data into one of these; nothing untyped reaches the pipeline.
 */

export const Actor = z.object({
  email: z.string().email().optional(),
  name: z.string().optional(),
  company: z.string().optional(),
  handle: z.string().optional(),
  title: z.string().optional(),
  employees: z.number().optional(),
  industry: z.string().optional(),
});
export type Actor = z.infer<typeof Actor>;

export const SIGNAL_TYPES = [
  'crm_contact',
  'website_visit',
  'pricing_view',
  'docs_view',
  'newsletter_open',
  'newsletter_click',
  'repo_star',
  'repo_issue',
  'payment',
  'trial_started',
  'demo_request',
  'form_submit',
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const Signal = z.object({
  signalType: z.enum(SIGNAL_TYPES),
  externalId: z.string().min(1),
  observedAt: z.string().min(1),
  actor: Actor,
  props: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  consentBasis: z.enum(['consent', 'contract', 'legitimate_interest']).default('legitimate_interest'),
});
export type Signal = z.infer<typeof Signal>;

export function validateSignal(raw: unknown): Signal {
  return Signal.parse(raw);
}

/** Identifiers extracted from a signal's actor — the raw material of identity resolution. */
export function extractIdentifiers(source: string, sig: Signal): { kind: string; value: string }[] {
  const out: { kind: string; value: string }[] = [];
  const a = sig.actor;
  if (a.email) out.push({ kind: 'email', value: a.email.toLowerCase().trim() });
  if (a.handle) out.push({ kind: `handle:${source}`, value: a.handle.toLowerCase().trim() });
  if (!a.email && !a.handle && a.name) out.push({ kind: 'name', value: a.name.toLowerCase().trim() });
  return out;
}
