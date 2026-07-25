import type { DB } from '../db.js';
import { j, pj } from '../db.js';
import { id, now } from '../util.js';
import { config } from '../config.js';
import { loadWorkspace, type Workspace } from '../intelligence/bulk.js';
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

/** Derive graph edges from resolved persons + their observations. Idempotent, bulk, transactional. */
export function buildGraph(db: DB, ws: Workspace = loadWorkspace(db)): { entities: number; edges: number } {
  let edges = 0;
  const entityCache = new Map<string, string>();
  const ent = (type: string, name: string, attrs: Record<string, unknown> = {}): string => {
    const k = `${type}:${name}`;
    let eid = entityCache.get(k);
    if (!eid) entityCache.set(k, (eid = upsertEntity(db, type, name, attrs)));
    return eid;
  };
  db.exec('BEGIN');
  try {
    for (const person of ws.persons) {
      const obs = ws.obsByPerson.get(person.id) ?? [];
      if (person.company) {
        const companyAttrs: Record<string, unknown> = {};
        for (const o of obs) {
          if (o.actor?.employees) companyAttrs.employees = o.actor.employees;
          if (o.actor?.industry) companyAttrs.industry = o.actor.industry;
        }
        const cid = ent('company', person.company, companyAttrs);
        upsertEdge(db, 'WORKS_AT', person.id, cid, obs.slice(0, 5).map((o) => o.id));
        edges++;
      }
      for (const o of obs) {
        const props = o.props ?? {};
        if (o.signal_type === 'payment' && props.restaurant && props.type !== 'partner_payout') {
          const rid = ent('company', String(props.restaurant));
          upsertEdge(db, 'ORDERED_FROM', person.id, rid, [o.id]);
          edges++;
        } else if (o.signal_type === 'payment' || o.signal_type === 'trial_started') {
          const prid = ent('product', String(props.plan ?? 'marketplace'));
          upsertEdge(db, 'PURCHASED', person.id, prid, [o.id]);
          edges++;
        }
        if (o.signal_type === 'repo_star' || o.signal_type === 'repo_issue') {
          const rid = ent('repo', String(props.repo ?? 'unknown'));
          upsertEdge(db, 'ENGAGED_WITH', person.id, rid, [o.id]);
          edges++;
        }
        if (props.topic) {
          const tid = ent('topic', String(props.topic));
          upsertEdge(db, 'INTERESTED_IN', person.id, tid, [o.id]);
          edges++;
        }
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
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
