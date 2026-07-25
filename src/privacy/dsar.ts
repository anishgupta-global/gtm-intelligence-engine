import type { DB } from '../db.js';
import { pj } from '../db.js';
import { sha256 } from '../util.js';
import { config } from '../config.js';
import { getPersonObservations } from '../identity/resolve.js';
import { personEdges } from '../graph/store.js';
import { audit, logEvent } from '../pipeline/events.js';

/**
 * DSAR endpoints — GDPR data-subject rights.
 * Export: everything the engine holds about a person.
 * Erasure: payload hard-delete + identifier removal + hashed tombstone. The person row
 * survives as a tombstone (id + erased flag) so replay/audit stay consistent; the
 * personal data does not. Full crypto-shredding is the documented v2 path (ADR-0010).
 */

export function exportPerson(db: DB, personId: string): any {
  const person = db.prepare(`SELECT * FROM persons WHERE tenant = ? AND id = ?`).get(config.tenant, personId) as any;
  if (!person) return null;
  return {
    person,
    memberships: db.prepare(`SELECT identifier_key, confidence, method, status, created_at FROM person_memberships WHERE tenant = ? AND person_id = ?`).all(config.tenant, personId),
    observations: getPersonObservations(db, personId).map((o: any) => ({ ...o, payload: pj(o.payload) })),
    edges: personEdges(db, personId),
    scores: db.prepare(`SELECT score_type, value, factors, computed_at FROM scores WHERE tenant = ? AND entity_id = ?`).all(config.tenant, personId),
    enrichments: db.prepare(`SELECT field, value, confidence, model, reasoning, created_at FROM enrichments WHERE tenant = ? AND entity_id = ?`).all(config.tenant, personId),
  };
}

export function erasePerson(db: DB, personId: string): { erasedObservations: number } {
  const obs = getPersonObservations(db, personId);
  for (const o of obs) {
    db.prepare(`UPDATE observations SET payload = '{}', erased = 1 WHERE id = ?`).run(o.id);
    db.prepare(`DELETE FROM identifiers WHERE tenant = ? AND observation_id = ?`).run(config.tenant, o.id);
  }
  const memberships = db.prepare(`SELECT id, identifier_key FROM person_memberships WHERE tenant = ? AND person_id = ?`).all(config.tenant, personId) as any[];
  for (const m of memberships) {
    db.prepare(`UPDATE person_memberships SET identifier_key = ?, status = 'retracted', evidence = '[]' WHERE id = ?`).run(
      `erased:${sha256(m.identifier_key).slice(0, 16)}`, m.id
    );
  }
  db.prepare(`DELETE FROM scores WHERE tenant = ? AND entity_id = ?`).run(config.tenant, personId);
  db.prepare(`DELETE FROM enrichments WHERE tenant = ? AND entity_id = ?`).run(config.tenant, personId);
  db.prepare(`DELETE FROM edges WHERE tenant = ? AND from_id = ?`).run(config.tenant, personId);
  db.prepare(`UPDATE persons SET display_name = '[erased]', primary_email = NULL, company = NULL, title = NULL, erased = 1 WHERE tenant = ? AND id = ?`).run(
    config.tenant, personId
  );
  audit(db, 'dsar_erasure', `person ${personId}: ${obs.length} observations payload-deleted, identifiers removed, tombstone kept`);
  logEvent(db, 'erasure', personId, { observations: obs.length });
  return { erasedObservations: obs.length };
}
