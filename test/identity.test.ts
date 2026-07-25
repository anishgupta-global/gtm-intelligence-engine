import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { ingestSignal } from '../src/connectors/sdk.js';
import { resolveIdentities, listActivePersons, reviewQueue, approveMerge, getPersonObservations } from '../src/identity/resolve.js';

const sig = (signalType: string, externalId: string, actor: any, daysAgo = 1) => ({
  signalType,
  externalId,
  observedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  actor,
  props: {},
});

test('golden pair: same email across sources resolves to one person', () => {
  const db = openDb(':memory:');
  ingestSignal(db, 'crm_csv', sig('crm_contact', 'c1', { email: 'a@x.io', name: 'Ada Alpha', company: 'XCo', title: 'CTO' }));
  ingestSignal(db, 'newsletter', sig('newsletter_click', 'n1', { email: 'a@x.io', name: 'Ada Alpha' }));
  ingestSignal(db, 'github', sig('repo_star', 'g1', { email: 'a@x.io', handle: 'ada-dev', name: 'Ada Alpha' }));
  resolveIdentities(db);
  const persons = listActivePersons(db);
  assert.equal(persons.length, 1);
  assert.equal(persons[0].identifier_count, 2); // email + github handle
  assert.equal(getPersonObservations(db, persons[0].id).length, 3);
});

test('adversarial pair: same name, different companies stay separate', () => {
  const db = openDb(':memory:');
  ingestSignal(db, 'crm_csv', sig('crm_contact', 'c1', { email: 'alex@stellar.io', name: 'Alex Kumar', company: 'StellarPay' }));
  ingestSignal(db, 'newsletter', sig('newsletter_open', 'n1', { email: 'alex@kumarlabs.dev', name: 'Alex Kumar', company: 'Kumar Labs' }));
  resolveIdentities(db);
  assert.equal(listActivePersons(db).length, 2);
  assert.equal(reviewQueue(db).length, 0); // 0.55 score — not even review-worthy
});

test('review band: initial + same company goes to human review, approve merges reversibly', () => {
  const db = openDb(':memory:');
  ingestSignal(db, 'crm_csv', sig('crm_contact', 'c1', { email: 'jorge@helios.io', name: 'Jorge Rodriguez', company: 'Helios Cloud', title: 'VP Engineering' }));
  ingestSignal(db, 'github', sig('repo_star', 'g1', { handle: 'jrodz', name: 'Jorge R.', company: 'Helios Cloud' }));
  resolveIdentities(db);
  const queue = reviewQueue(db);
  assert.equal(queue.length, 1);
  assert.ok(queue[0].confidence >= 0.7 && queue[0].confidence < 0.9, `confidence ${queue[0].confidence} in review band`);

  approveMerge(db, queue[0].from.id, queue[0].to.id);
  const persons = listActivePersons(db);
  assert.equal(persons.length, 1);
  assert.equal(getPersonObservations(db, persons[0].id).length, 2);
  // reversibility: the retracted membership still exists as history
  const retracted = db.prepare(`SELECT COUNT(*) AS c FROM person_memberships WHERE status = 'retracted'`).get() as any;
  assert.ok(retracted.c >= 1);
});

test('idempotent ingestion: same event twice creates one observation', () => {
  const db = openDb(':memory:');
  const s = sig('payment', 'inv-1', { email: 'b@y.io', name: 'Bo Beta' });
  assert.equal(ingestSignal(db, 'stripe', s), 'inserted');
  assert.equal(ingestSignal(db, 'stripe', s), 'duplicate');
  const count = db.prepare(`SELECT COUNT(*) AS c FROM observations`).get() as any;
  assert.equal(count.c, 1);
});

test('invalid signal is rejected, never half-ingested', () => {
  const db = openDb(':memory:');
  assert.equal(ingestSignal(db, 'webhook', { signalType: 'not_a_signal', externalId: 'x' }), 'rejected');
  const count = db.prepare(`SELECT COUNT(*) AS c FROM observations`).get() as any;
  assert.equal(count.c, 0);
});
