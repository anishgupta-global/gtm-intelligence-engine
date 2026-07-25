import type { DB } from '../db.js';
import { j, pj } from '../db.js';
import { id, now, sha256 } from '../util.js';
import { config } from '../config.js';
import { validateSignal, extractIdentifiers, type Signal } from '../signals/registry.js';
import { logEvent } from '../pipeline/events.js';

/**
 * Connector SDK. A connector fetches raw source data and maps it to typed signals.
 * Connectors ONLY produce observations — they never touch persons, scores, or decisions.
 */
export interface Connector {
  name: string;
  fetch(since: string | null): Promise<Signal[]>;
}

export interface IngestResult {
  inserted: number;
  duplicates: number;
  rejected: number;
}

/** Idempotent observation write: (tenant, source, external_id, content_hash) is unique. */
export function ingestSignal(db: DB, source: string, raw: unknown): 'inserted' | 'duplicate' | 'rejected' {
  let sig: Signal;
  try {
    sig = validateSignal(raw);
  } catch {
    return 'rejected';
  }
  const hash = sha256(j({ t: sig.signalType, a: sig.actor, p: sig.props, o: sig.observedAt }));
  const obsId = id('obs');
  try {
    db.prepare(
      `INSERT INTO observations (id, tenant, source, external_id, signal_type, payload, observed_at, ingested_at, content_hash, consent_basis)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(obsId, config.tenant, source, sig.externalId, sig.signalType, j({ actor: sig.actor, props: sig.props }), sig.observedAt, now(), hash, sig.consentBasis);
  } catch {
    return 'duplicate';
  }
  for (const ident of extractIdentifiers(source, sig)) {
    db.prepare(`INSERT OR IGNORE INTO identifiers (id, tenant, kind, value, observation_id) VALUES (?, ?, ?, ?, ?)`).run(
      id('idn'), config.tenant, ident.kind, ident.value, obsId
    );
  }
  return 'inserted';
}

export async function syncConnector(db: DB, c: Connector): Promise<IngestResult> {
  const state = db.prepare(`SELECT cursor FROM sync_state WHERE connector = ?`).get(c.name) as { cursor?: string } | undefined;
  const signals = await c.fetch(state?.cursor ?? null);
  const res: IngestResult = { inserted: 0, duplicates: 0, rejected: 0 };
  let cursor = state?.cursor ?? '';
  for (const s of signals) {
    const r = ingestSignal(db, c.name, s);
    if (r === 'inserted') res.inserted++;
    else if (r === 'duplicate') res.duplicates++;
    else res.rejected++;
    if (s.observedAt > cursor) cursor = s.observedAt;
  }
  db.prepare(
    `INSERT INTO sync_state (connector, cursor, last_run) VALUES (?, ?, ?)
     ON CONFLICT(connector) DO UPDATE SET cursor = excluded.cursor, last_run = excluded.last_run`
  ).run(c.name, cursor, now());
  logEvent(db, 'ingest', c.name, res);
  return res;
}

export { pj };
