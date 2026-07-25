import type { DB } from '../db.js';
import { pj } from '../db.js';
import { config } from '../config.js';

/**
 * Bulk loaders — at marketplace scale (25k+ people) per-person queries are O(N) round
 * trips; these load the whole workspace in a handful of scans and let stages work from
 * in-memory maps. Single-person API paths keep using the row-level helpers.
 */

export interface ObsLite {
  id: string;
  source: string;
  signal_type: string;
  observed_at: string;
  actor: any;
  props: any;
}

export interface PersonLite {
  id: string;
  display_name: string;
  primary_email: string | null;
  company: string | null;
  title: string | null;
}

export interface Workspace {
  persons: PersonLite[];
  obsByPerson: Map<string, ObsLite[]>;
  roles: Map<string, string>;
  intents: Map<string, number>;
}

export function loadWorkspace(db: DB): Workspace {
  const persons = db.prepare(
    `SELECT DISTINCT p.id, p.display_name, p.primary_email, p.company, p.title
     FROM persons p JOIN person_memberships m ON m.person_id = p.id AND m.status = 'active'
     WHERE p.tenant = ? AND p.erased = 0`
  ).all(config.tenant) as any[] as PersonLite[];

  const rows = db.prepare(
    `SELECT DISTINCT m.person_id AS pid, o.id, o.source, o.signal_type, o.observed_at, o.payload
     FROM person_memberships m
     JOIN identifiers i ON (i.kind || ':' || i.value) = m.identifier_key AND i.tenant = m.tenant
     JOIN observations o ON o.id = i.observation_id
     WHERE m.tenant = ? AND m.status = 'active' AND o.erased = 0`
  ).all(config.tenant) as any[];

  const obsByPerson = new Map<string, ObsLite[]>();
  for (const r of rows) {
    const payload = pj<any>(r.payload) ?? {};
    const o: ObsLite = { id: r.id, source: r.source, signal_type: r.signal_type, observed_at: r.observed_at, actor: payload.actor ?? {}, props: payload.props ?? {} };
    const list = obsByPerson.get(r.pid);
    if (list) list.push(o);
    else obsByPerson.set(r.pid, [o]);
  }
  for (const list of obsByPerson.values()) list.sort((a, b) => (a.observed_at < b.observed_at ? 1 : -1));

  const roles = new Map<string, string>();
  for (const e of db.prepare(
    `SELECT entity_id, value FROM enrichments WHERE tenant = ? AND field = 'role' ORDER BY created_at ASC`
  ).all(config.tenant) as any[]) {
    roles.set(e.entity_id, e.value);
  }

  const intents = new Map<string, number>();
  for (const s of db.prepare(`SELECT entity_id, value FROM scores WHERE tenant = ? AND score_type = 'intent'`).all(config.tenant) as any[]) {
    intents.set(s.entity_id, s.value);
  }
  return { persons, obsByPerson, roles, intents };
}

export const daysSince = (iso: string, nowMs = Date.now()) => (nowMs - Date.parse(iso)) / 86_400_000;

export function firstObservedAt(obs: ObsLite[]): string | null {
  return obs.length ? obs[obs.length - 1].observed_at : null;
}

/** Consumer order = payment that isn't a partner payout. */
export const isConsumerOrder = (o: ObsLite) => o.signal_type === 'payment' && o.props?.type !== 'partner_payout';

/** First-touch acquisition channel = source of the person's earliest observation (excluding CRM records). */
export function acquisitionChannel(obs: ObsLite[]): string | null {
  for (let i = obs.length - 1; i >= 0; i--) {
    if (obs[i].source !== 'crm') return obs[i].source;
  }
  return obs.length ? obs[obs.length - 1].source : null;
}
