import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from '../db.js';
import { pj } from '../db.js';
import { config } from '../config.js';
import { audienceSummary } from '../intelligence/segments.js';
import { hotLeads, fadingChampions, getRole } from '../intelligence/scores.js';
import { listActivePersons, getPersonObservations, reviewQueue, approveMerge, rejectMerge } from '../identity/resolve.js';
import { personSegment } from '../intelligence/segments.js';
import { personEdges } from '../graph/store.js';
import { listDecisions, setDecisionStatus } from '../decisions/reason.js';
import { platformStats } from '../intelligence/platforms.js';
import { companyStats } from '../intelligence/companies.js';
import { recordOutcome, evaluationMetrics } from '../decisions/evaluate.js';
import { updateCalibration } from '../decisions/learn.js';
import { costReport, budgetState } from '../cost/router.js';
import { buildDigest } from '../automations/digest.js';
import { exportPerson, erasePerson } from '../privacy/dsar.js';
import { ingestSignal } from '../connectors/sdk.js';
import { runPipeline } from '../pipeline/run.js';
import type { LLMProvider } from '../ai/provider.js';
import { DECISION_KIND } from '../decisions/reason.js';

export function buildServer(db: DB, provider: LLMProvider): FastifyInstance {
  const app = Fastify({ logger: false });
  const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
  app.register(fastifyStatic, { root: webDir });

  if (config.apiKey) {
    app.addHook('onRequest', async (req, reply) => {
      if (!req.url.startsWith('/api')) return;
      const auth = req.headers.authorization ?? '';
      if (auth !== `Bearer ${config.apiKey}`) reply.code(401).send({ error: 'unauthorized' });
    });
  }

  app.get('/healthz', async () => ({ ok: true, provider: provider.name, budget: budgetState(db).mode }));

  app.get('/api/summary', async () => ({
    ...audienceSummary(db),
    hotLeads: hotLeads(db).length,
    fading: fadingChampions(db).length,
    provider: provider.name,
    budget: budgetState(db),
  }));

  app.get('/api/leads/hot', async (req: any) =>
    hotLeads(db, {
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      role: req.query.role || undefined,
      minIntent: req.query.minIntent ? Number(req.query.minIntent) : undefined,
      company: req.query.company || undefined,
    })
  );
  app.get('/api/leads/fading', async (req: any) => fadingChampions(db, req.query.limit ? Number(req.query.limit) : 20));

  app.get('/api/platforms', async () => platformStats(db));
  app.get('/api/companies', async () => companyStats(db));

  app.get('/api/people', async () =>
    listActivePersons(db).map((p: any) => ({
      id: p.id,
      name: p.display_name,
      email: p.primary_email,
      company: p.company,
      title: p.title,
      identifiers: p.identifier_count,
      role: getRole(db, p.id).role,
      segment: personSegment(db, p),
    }))
  );

  app.get('/api/people/:id', async (req: any, reply) => {
    const personId = req.params.id;
    const person = db.prepare(`SELECT * FROM persons WHERE tenant = ? AND id = ?`).get(config.tenant, personId) as any;
    if (!person) return reply.code(404).send({ error: 'not found' });
    return {
      person,
      memberships: db.prepare(`SELECT identifier_key, confidence, method, status FROM person_memberships WHERE tenant = ? AND person_id = ?`).all(config.tenant, personId),
      observations: getPersonObservations(db, personId).map((o: any) => ({ id: o.id, source: o.source, signal_type: o.signal_type, observed_at: o.observed_at, payload: pj(o.payload), consent_basis: o.consent_basis })),
      edges: personEdges(db, personId),
      scores: (db.prepare(`SELECT score_type, value, factors, computed_at FROM scores WHERE tenant = ? AND entity_id = ?`).all(config.tenant, personId) as any[]).map((s) => ({ ...s, factors: pj(s.factors) })),
      enrichments: db.prepare(`SELECT field, value, confidence, model, reasoning, resolution_level, created_at FROM enrichments WHERE tenant = ? AND entity_id = ?`).all(config.tenant, personId),
    };
  });

  app.get('/api/review-queue', async () => reviewQueue(db));
  app.post('/api/review-queue/approve', async (req: any) => {
    approveMerge(db, req.body.fromPersonId, req.body.toPersonId);
    return { ok: true };
  });
  app.post('/api/review-queue/reject', async (req: any) => {
    rejectMerge(db, req.body.toPersonId);
    return { ok: true };
  });

  app.get('/api/decisions', async () => listDecisions(db));
  app.post('/api/decisions/:id/accept', async (req: any) => {
    setDecisionStatus(db, req.params.id, 'accepted');
    return { ok: true };
  });
  app.post('/api/decisions/:id/dismiss', async (req: any) => {
    setDecisionStatus(db, req.params.id, 'dismissed');
    return { ok: true };
  });
  app.post('/api/decisions/:id/outcome', async (req: any) => {
    const evaluation = recordOutcome(db, req.params.id, Number(req.body.achieved ?? 0), req.body.note ?? '');
    const row = db.prepare(`SELECT kind FROM decisions WHERE tenant = ? AND id = ?`).get(config.tenant, req.params.id) as any;
    const calibration = updateCalibration(db, row?.kind ?? DECISION_KIND);
    return { evaluation, calibration };
  });

  app.get('/api/evaluation', async () => evaluationMetrics(db));
  app.get('/api/cost', async () => costReport(db));
  app.get('/api/digest', async () => ({ markdown: buildDigest(db) }));

  app.post('/api/ingest/webhook/:source', async (req: any) => {
    const body = Array.isArray(req.body) ? req.body : [req.body];
    let inserted = 0, duplicates = 0, rejected = 0;
    for (const raw of body) {
      const r = ingestSignal(db, req.params.source, raw);
      if (r === 'inserted') inserted++;
      else if (r === 'duplicate') duplicates++;
      else rejected++;
    }
    return { inserted, duplicates, rejected };
  });

  app.post('/api/pipeline/run', async () => {
    const result = await runPipeline(db, provider);
    return { ...result, decision: { id: result.decision.id, title: result.decision.title, reused: result.decision.reused } };
  });

  app.get('/api/privacy/persons/:id/export', async (req: any, reply) => {
    const data = exportPerson(db, req.params.id);
    if (!data) return reply.code(404).send({ error: 'not found' });
    return data;
  });
  app.delete('/api/persons/:id', async (req: any) => erasePerson(db, req.params.id));

  return app;
}
