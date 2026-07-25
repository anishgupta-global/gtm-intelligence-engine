export const ENGINE_VERSION = '1.0.0';
export const IDRES_VERSION = 'idres-1.0.0';

export const config = {
  port: Number(process.env.PORT || 4100),
  dbPath: process.env.DB_PATH || 'data/engine.db',
  apiKey: process.env.API_KEY || '',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  smallModel: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
  smartModel: process.env.ANTHROPIC_SMART_MODEL || 'claude-sonnet-5',
  monthlyBudgetUsd: Number(process.env.AI_MONTHLY_BUDGET_USD || 15),
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || '',
  githubRepo: process.env.GITHUB_REPO || '',
  tenant: 'default',
};

/** Identity resolution thresholds (see docs/adr/0003). */
export const ID_THRESHOLDS = { autoMerge: 0.9, review: 0.7 };

/** Intent weights per signal type — L0 scoring, fully explainable. */
export const INTENT_WEIGHTS: Record<string, number> = {
  pricing_view: 25,
  trial_started: 30,
  payment: 20,
  demo_request: 30,
  repo_star: 12,
  repo_issue: 15,
  docs_view: 8,
  newsletter_click: 6,
  newsletter_open: 2,
  website_visit: 4,
  form_submit: 15,
  crm_contact: 0,
};

/** ICP definition for the demo workspace (Northwind Eats — a fictional two-sided food-delivery marketplace).
 *  The ICP describes ideal *merchant partners* (restaurants), not consumers.
 *  Consumers naturally score low ICP — they aren't the buyers of a marketplace product;
 *  their intent still ranks them for outreach via the intent × 0.6 baseline. */
export const ICP = {
  industries: ['food'],
  minEmployees: 5,
  buyerRoles: ['founder', 'executive'],
};
