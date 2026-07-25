import type { DB } from '../db.js';
import { j, pj } from '../db.js';
import { id, now } from '../util.js';
import { config } from '../config.js';
import { listActivePersons, getPersonObservations } from '../identity/resolve.js';
import { logEvent } from '../pipeline/events.js';

/** Entity graph on plain SQL tables. Postgres/Neo4j can replace this behind the same functions (ADR-0006). */

export function upsertEntity(db: DB, type: string, name: string, attrs: Record<string, unknown> = {}): string {
  const existing = db.prepare(`SELECT id FROM entities WHERE tenant = ? AND type = ? AND name = ?`).get(config.tenant, type, name) as any;
  if (existing) return existing.id;
  const eid = id('ent');
  db.prepare(`INSERT INTO entities (id, tenant, type, name, attrs) VALUES (?, ?, ?, ?, ?)`).run(eid, config.tenant, type, name, j(attrs));
  return eid;
}

export function upsertEdge(db: DB, type: string, fromId: string, toId: string, provenance: string[], confidence = 1): void {
  db.prepare(
    `INSERT INTO edges (id, tenant, type, from_id, to_id, confidence, provenance, valid_from)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant, type, from_id, to_id) DO UPDATE SET provenance = excluded.provenance, confidence = excluded.confidence`
  ).run(id('edg'), config.tenant, type, fromId, toId, confidence, j(provenance.slice(0, 10)), now());
}

/** Derive graph edges from resolved persons + their observations. Idempotent. */
export function buildGraph(db: DB): { entities: number; edges: number } {
  let edges = 0;
  for (const person of listActivePersons(db)) {
    const obs = getPersonObservations(db, person.id);
    if (person.company) {
      const companyAttrs: Record<string, unknown> = {};
      for (const o of obs) {
        const a = pj<any>(o.payload)?.actor ?? {};
        if (a.employees) companyAttrs.employees = a.employees;
        if (a.industry) companyAttrs.industry = a.industry;
      }
      const cid = upsertEntity(db, 'company', person.company, companyAttrs);
      upsertEdge(db, 'WORKS_AT', person.id, cid, obs.slice(0, 5).map((o: any) => o.id));
      edges++;
    }
    for (const o of obs) {
      const props = pj<any>(o.payload)?.props ?? {};
      if (o.signal_type === 'repo_star' || o.signal_type === 'repo_issue') {
        const rid = upsertEntity(db, 'repo', String(props.repo ?? 'unknown'));
        upsertEdge(db, 'ENGAGED_WITH', person.id, rid, [o.id]);
        edges++;
      }
      if (o.signal_type === 'payment' || o.signal_type === 'trial_started') {
        const prid = upsertEntity(db, 'product', String(props.plan ?? 'default'));
        upsertEdge(db, 'PURCHASED', person.id, prid, [o.id]);
        edges++;
      }
      if (props.topic) {
        const tid = upsertEntity(db, 'topic', String(props.topic));
        upsertEdge(db, 'INTERESTED_IN', person.id, tid, [o.id]);
        edges++;
      }
    }
  }
  const entities = (db.prepare(`SELECT COUNT(*) AS c FROM entities WHERE tenant = ?`).get(config.tenant) as any).c;
  logEvent(db, 'graph', null, { entities, edges });
  return { entities, edges };
}

export function personEdges(db: DB, personId: string): any[] {
  return (db.prepare(
    `SELECT e.type, e.confidence, e.provenance, en.type AS entity_type, en.name AS entity_name, en.attrs
     FROM edges e JOIN entities en ON en.id = e.to_id WHERE e.tenant = ? AND e.from_id = ?`
  ).all(config.tenant, personId) as any[]).map((r) => ({ ...r, provenance: pj(r.provenance), attrs: pj(r.attrs) }));
}
