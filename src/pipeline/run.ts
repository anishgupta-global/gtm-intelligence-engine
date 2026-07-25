import type { DB } from '../db.js';
import { resolveIdentities } from '../identity/resolve.js';
import { buildGraph } from '../graph/store.js';
import { computeScores } from '../intelligence/scores.js';
import { generateRecommendation, type DecisionRecord } from '../decisions/reason.js';
import { generateAllocationDecision, generateRetentionDecisions } from '../decisions/growth-pack.js';
import { loadWorkspace } from '../intelligence/bulk.js';
import type { LLMProvider } from '../ai/provider.js';
import { logEvent } from './events.js';

/**
 * Pipeline: ingest (connectors) -> resolve -> graph -> score -> decide (growth pack).
 * Stages are plain functions over the event-logged store, so any stage can be re-run
 * idempotently. AI appears only after reliable data is established (final stage).
 */
export async function runPipeline(db: DB, provider: LLMProvider): Promise<{
  resolve: { persons: number; merged: number; review: number };
  graph: { entities: number; edges: number };
  scores: { computed: number; skipped: number };
  decision: DecisionRecord;
  allocation: DecisionRecord | null;
  retention: DecisionRecord[];
}> {
  const resolve = resolveIdentities(db);
  const wsPre = loadWorkspace(db); // one scan feeds graph + scoring
  const graph = buildGraph(db, wsPre);
  const scores = await computeScores(db, provider, wsPre);
  const ws = loadWorkspace(db); // reload: scoring wrote fresh intents + roles
  const decision = await generateRecommendation(db, provider, ws);
  const allocation = generateAllocationDecision(db, ws);
  const retention = generateRetentionDecisions(db, ws);
  logEvent(db, 'pipeline', null, { resolve, graph, scores, decision: decision.id, reused: decision.reused, allocation: allocation?.id ?? null, retention: retention.length });
  return { resolve, graph, scores, decision, allocation, retention };
}
