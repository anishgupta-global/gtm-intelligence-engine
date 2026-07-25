import type { DB } from '../db.js';
import { j, pj } from '../db.js';
import { id, now, nameSimilarity, companySimilarity } from '../util.js';
import { config, ID_THRESHOLDS, IDRES_VERSION } from '../config.js';
import { logEvent, audit } from '../pipeline/events.js';

/**
 * Identity resolution. A Person is a VIRTUAL CLUSTER of identifier keys held together
 * by membership rows (confidence + method + evidence + engine version). Nothing is ever
 * physically merged, so every merge is reversible by retracting memberships.
 *
 * Pass 1 (deterministic): identifier keys that co-occur in one observation belong to the
 * same actor (an event carrying both an email and a handle). Confidence 1.0.
 * Pass 2 (probabilistic): clusters WITHOUT a strong identifier (no email) are compared to
 * existing persons by name + company. >= 0.90 auto-merge, 0.70-0.90 human review queue,
 * else new person. Email-bearing clusters never merge probabilistically — an email IS an
 * identity; joining two different emails into one person is a human (review-queue) call.
 * This is also what keeps resolution O(N) at 25k+ people instead of O(N^2).
 */

interface Profile { name?: string; company?: string; title?: string; email?: string; employees?: number; industry?: string }

const key = (kind: string, value: string) => `${kind}:${value}`;

export function resolveIdentities(db: DB): { persons: number; merged: number; review: number } {
  const idents = db.prepare(`SELECT observation_id, kind, value FROM identifiers WHERE tenant = ?`).all(config.tenant) as any[];

  const obsMeta = new Map<string, { signal_type: string; actor: any }>();
  for (const o of db.prepare(`SELECT id, signal_type, payload FROM observations WHERE tenant = ? AND erased = 0`).all(config.tenant) as any[]) {
    obsMeta.set(o.id, { signal_type: o.signal_type, actor: pj<any>(o.payload)?.actor ?? {} });
  }

  const parent = new Map<string, string>();
  const find = (k: string): string => {
    if (!parent.has(k)) parent.set(k, k);
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  const union = (a: string, b: string) => { parent.set(find(a), find(b)); };

  const byObs = new Map<string, string[]>();
  const keyObs = new Map<string, string[]>();
  for (const r of idents) {
    const k = key(r.kind, r.value);
    find(k);
    let list = byObs.get(r.observation_id);
    if (!list) byObs.set(r.observation_id, (list = []));
    list.push(k);
    let ko = keyObs.get(k);
    if (!ko) keyObs.set(k, (ko = []));
    ko.push(r.observation_id);
  }
  for (const keys of byObs.values()) for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);

  const active = new Map<string, string>();
  for (const m of db.prepare(`SELECT identifier_key, person_id FROM person_memberships WHERE tenant = ? AND status = 'active'`).all(config.tenant) as any[]) {
    active.set(m.identifier_key, m.person_id);
  }

  const clusters = new Map<string, Set<string>>();
  for (const k of parent.keys()) {
    const root = find(k);
    if (!clusters.has(root)) clusters.set(root, new Set());
    clusters.get(root)!.add(k);
  }

  const clusterObsIds = (keys: string[]): string[] => {
    const out = new Set<string>();
    for (const k of keys) for (const oid of keyObs.get(k) ?? []) out.add(oid);
    return [...out].slice(0, 20);
  };

  const stats = { persons: 0, merged: 0, review: 0 };
  db.exec('BEGIN');
  try {
    for (const keys of clusters.values()) {
      const unassigned = [...keys].filter((k) => !active.has(k));
      if (!unassigned.length) continue;
      const assignedPersons = [...new Set([...keys].filter((k) => active.has(k)).map((k) => active.get(k)!))];
      const evidence = clusterObsIds([...keys]);

      if (assignedPersons.length) {
        if (assignedPersons.length > 1) logEvent(db, 'identity_conflict', assignedPersons.join(','), { keys: [...keys] });
        addMemberships(db, unassigned, assignedPersons[0], 1.0, 'co_occurrence', evidence);
        for (const k of unassigned) active.set(k, assignedPersons[0]);
        stats.merged++;
        continue;
      }

      const profile = deriveProfile(evidence, obsMeta);
      const hasEmail = unassigned.some((k) => k.startsWith('email:'));
      const match = hasEmail ? null : bestPersonMatch(db, profile);
      if (match && match.score >= ID_THRESHOLDS.autoMerge) {
        addMemberships(db, unassigned, match.personId, match.score, 'probabilistic', evidence);
        for (const k of unassigned) active.set(k, match.personId);
        stats.merged++;
      } else {
        const personId = createPerson(db, profile);
        const conf = hasEmail ? 1.0 : 0.8;
        addMemberships(db, unassigned, personId, conf, 'observation', evidence);
        for (const k of unassigned) active.set(k, personId);
        stats.persons++;
        if (match && match.score >= ID_THRESHOLDS.review) {
          for (const k of unassigned) {
            db.prepare(
              `INSERT INTO person_memberships (id, tenant, person_id, identifier_key, confidence, method, evidence, engine_version, status, created_at)
               VALUES (?, ?, ?, ?, ?, 'probabilistic', ?, ?, 'pending_review', ?)`
            ).run(id('mem'), config.tenant, match.personId, k, match.score, j(evidence), IDRES_VERSION, now());
          }
          stats.review++;
          logEvent(db, 'review_queued', personId, { proposed: match.personId, score: match.score });
        }
      }
    }
    refreshProfiles(db);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  logEvent(db, 'resolve', null, stats);
  return stats;
}

function addMemberships(db: DB, keys: string[], personId: string, confidence: number, method: string, evidence: string[]): void {
  for (const k of keys) {
    db.prepare(
      `INSERT INTO person_memberships (id, tenant, person_id, identifier_key, confidence, method, evidence, engine_version, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
    ).run(id('mem'), config.tenant, personId, k, confidence, method, j(evidence), IDRES_VERSION, now());
  }
}

function deriveProfile(obsIds: string[], obsMeta: Map<string, { signal_type: string; actor: any }>): Profile {
  const profile: Profile = {};
  let bestRank = -1;
  for (const oid of obsIds) {
    const row = obsMeta.get(oid);
    if (!row) continue;
    const actor = row.actor ?? {};
    const rank = row.signal_type === 'crm_contact' ? 2 : actor.name ? 1 : 0;
    if (rank > bestRank) {
      bestRank = rank;
      profile.name = actor.name ?? profile.name;
      profile.company = actor.company ?? profile.company;
      profile.title = actor.title ?? profile.title;
      profile.employees = actor.employees ?? profile.employees;
      profile.industry = actor.industry ?? profile.industry;
    }
    if (!profile.email && actor.email) profile.email = actor.email;
    if (!profile.name && actor.name) profile.name = actor.name;
    if (!profile.company && actor.company) profile.company = actor.company;
  }
  return profile;
}

function bestPersonMatch(db: DB, p: Profile): { personId: string; score: number } | null {
  if (!p.name) return null;
  let best: { personId: string; score: number } | null = null;
  const persons = db.prepare(
    `SELECT DISTINCT pe.id, pe.display_name, pe.company, pe.primary_email FROM persons pe
     JOIN person_memberships m ON m.person_id = pe.id AND m.status = 'active'
     WHERE pe.tenant = ? AND pe.erased = 0`
  ).all(config.tenant) as any[];
  for (const per of persons) {
    const nameS = nameSimilarity(p.name, per.display_name ?? '');
    if (nameS < 0.5) continue;
    const compS = companySimilarity(p.company, per.company ?? undefined);
    const candidateDomain = p.email?.split('@')[1]?.split('.')[0] ?? '';
    const domainHint = candidateDomain && per.company && per.company.toLowerCase().replace(/\s/g, '').includes(candidateDomain) ? 1 : 0;
    const score = 0.55 * nameS + 0.35 * compS + 0.1 * domainHint;
    if (!best || score > best.score) best = { personId: per.id, score: Math.round(score * 1000) / 1000 };
  }
  return best;
}

function createPerson(db: DB, p: Profile): string {
  const pid = id('per');
  db.prepare(`INSERT INTO persons (id, tenant, display_name, primary_email, company, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    pid, config.tenant, p.name ?? p.email ?? 'unknown', p.email ?? null, p.company ?? null, p.title ?? null, now()
  );
  return pid;
}

/** Bulk profile refresh: one scan over (person, observation) pairs, one guarded UPDATE per person. */
function refreshProfiles(db: DB): void {
  const rows = db.prepare(
    `SELECT DISTINCT m.person_id AS pid, o.id AS oid, o.signal_type, o.payload
     FROM person_memberships m
     JOIN identifiers i ON (i.kind || ':' || i.value) = m.identifier_key AND i.tenant = m.tenant
     JOIN observations o ON o.id = i.observation_id
     WHERE m.tenant = ? AND m.status = 'active' AND o.erased = 0`
  ).all(config.tenant) as any[];

  const byPerson = new Map<string, Profile & { rank: number }>();
  for (const r of rows) {
    const actor = pj<any>(r.payload)?.actor ?? {};
    let prof = byPerson.get(r.pid);
    if (!prof) byPerson.set(r.pid, (prof = { rank: -1 }));
    const rank = r.signal_type === 'crm_contact' ? 2 : actor.title ? 1 : 0;
    if (rank > prof.rank && actor.name) {
      prof.rank = rank;
      prof.name = actor.name;
      prof.company = actor.company ?? prof.company;
      prof.title = actor.title ?? prof.title;
    }
    if (!prof.email && actor.email) prof.email = actor.email;
    if (!prof.company && actor.company) prof.company = actor.company;
    if (!prof.name && actor.name) prof.name = actor.name;
  }
  const update = db.prepare(
    `UPDATE persons SET display_name = COALESCE(?, display_name), primary_email = COALESCE(?, primary_email), company = COALESCE(?, company), title = COALESCE(?, title) WHERE id = ?`
  );
  for (const [pid, prof] of byPerson) {
    update.run(prof.name ?? null, prof.email ?? null, prof.company ?? null, prof.title ?? null, pid);
  }
}

/** All non-erased observations belonging to a person via active memberships (single-person API path). */
export function getPersonObservations(db: DB, personId: string): any[] {
  return db.prepare(
    `SELECT DISTINCT o.* FROM person_memberships m
     JOIN identifiers i ON (i.kind || ':' || i.value) = m.identifier_key AND i.tenant = m.tenant
     JOIN observations o ON o.id = i.observation_id
     WHERE m.tenant = ? AND m.person_id = ? AND m.status = 'active' AND o.erased = 0
     ORDER BY o.observed_at DESC`
  ).all(config.tenant, personId) as any[];
}

/** Persons that currently hold at least one active identifier (merged-away shells drop out naturally). */
export function listActivePersons(db: DB): any[] {
  return db.prepare(
    `SELECT pe.*, COUNT(DISTINCT m.identifier_key) AS identifier_count
     FROM persons pe JOIN person_memberships m ON m.person_id = pe.id AND m.status = 'active'
     WHERE pe.tenant = ? AND pe.erased = 0 GROUP BY pe.id`
  ).all(config.tenant) as any[];
}

export function reviewQueue(db: DB): any[] {
  const rows = db.prepare(
    `SELECT m.*, act.person_id AS current_person_id FROM person_memberships m
     JOIN person_memberships act ON act.identifier_key = m.identifier_key AND act.status = 'active' AND act.tenant = m.tenant
     WHERE m.tenant = ? AND m.status = 'pending_review'`
  ).all(config.tenant) as any[];
  const groups = new Map<string, any>();
  for (const r of rows) {
    const gk = `${r.current_person_id}->${r.person_id}`;
    if (!groups.has(gk)) {
      const from = db.prepare(`SELECT id, display_name, company FROM persons WHERE id = ?`).get(r.current_person_id) as any;
      const to = db.prepare(`SELECT id, display_name, company FROM persons WHERE id = ?`).get(r.person_id) as any;
      groups.set(gk, { from, to, confidence: r.confidence, evidence: pj(r.evidence), keys: [] as string[] });
    }
    groups.get(gk)!.keys.push(r.identifier_key);
  }
  return [...groups.values()];
}

/** Approve a proposed merge: retract the provisional person's active memberships, activate the pending ones. Fully reversible history. */
export function approveMerge(db: DB, fromPersonId: string, toPersonId: string): void {
  const pend = db.prepare(
    `SELECT m.id, m.identifier_key FROM person_memberships m WHERE m.tenant = ? AND m.person_id = ? AND m.status = 'pending_review'`
  ).all(config.tenant, toPersonId) as any[];
  for (const p of pend) {
    db.prepare(`UPDATE person_memberships SET status = 'retracted' WHERE tenant = ? AND identifier_key = ? AND person_id = ? AND status = 'active'`).run(
      config.tenant, p.identifier_key, fromPersonId
    );
    db.prepare(`UPDATE person_memberships SET status = 'active' WHERE id = ?`).run(p.id);
  }
  audit(db, 'identity_merge_approved', `${fromPersonId} -> ${toPersonId} (${pend.length} identifiers)`);
  logEvent(db, 'review_approved', fromPersonId, { to: toPersonId });
}

export function rejectMerge(db: DB, toPersonId: string): void {
  db.prepare(`UPDATE person_memberships SET status = 'rejected' WHERE tenant = ? AND person_id = ? AND status = 'pending_review'`).run(
    config.tenant, toPersonId
  );
  audit(db, 'identity_merge_rejected', `proposed target ${toPersonId}`);
}
