import type { DB } from '../db.js';
import { j, pj } from '../db.js';
import { now } from '../util.js';

/**
 * Intelligence cache — AI outputs keyed by input hash + data version.
 * Unchanged inputs are a cache hit: zero tokens, zero dollars.
 */

export function cacheGet<T = any>(db: DB, key: string): T | null {
  const row = db.prepare(`SELECT value, created_at, ttl_seconds FROM intelligence_cache WHERE key = ?`).get(key) as any;
  if (!row) return null;
  if (Date.parse(row.created_at) + row.ttl_seconds * 1000 < Date.now()) return null;
  db.prepare(`UPDATE intelligence_cache SET hits = hits + 1 WHERE key = ?`).run(key);
  return pj<T>(row.value);
}

export function cachePut(db: DB, key: string, value: unknown, model: string, ttlSeconds = 7 * 86_400): void {
  db.prepare(
    `INSERT INTO intelligence_cache (key, value, model, created_at, ttl_seconds)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, model = excluded.model, created_at = excluded.created_at, ttl_seconds = excluded.ttl_seconds`
  ).run(key, j(value), model, now(), ttlSeconds);
}
