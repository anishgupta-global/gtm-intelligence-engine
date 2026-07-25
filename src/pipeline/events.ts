import type { DB } from '../db.js';
import { j } from '../db.js';
import { id, now } from '../util.js';
import { config } from '../config.js';

/** Append-only pipeline event log — every stage records what it did, enabling audit + replay. */
export function logEvent(db: DB, stage: string, ref: string | null, detail: unknown = {}): void {
  db.prepare(`INSERT INTO events (id, tenant, stage, ref, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    id('evt'), config.tenant, stage, ref, j(detail), now()
  );
}

export function audit(db: DB, action: string, detail: string): void {
  db.prepare(`INSERT INTO audit_log (id, tenant, action, detail, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    id('aud'), config.tenant, action, detail, now()
  );
}
