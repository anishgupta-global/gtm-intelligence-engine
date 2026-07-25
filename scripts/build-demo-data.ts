import { writeFileSync } from 'node:fs';
import { openDb } from '../src/db.js';
import { runDemo } from './demo-core.js';

/** Runs the demo against an in-memory DB and snapshots the API surface into
 *  web/demo-data.json — this is what powers the static GitHub Pages demo. */

const db = openDb(':memory:');
const r = await runDemo(db);

const snapshot = {
  generatedAt: new Date().toISOString(),
  demoNote: 'Static snapshot of the demo pipeline (Northwind Eats — fictional two-sided marketplace, ~25k people). Run the engine locally for the live version.',
  summary: r.summary,
  hot: r.hot,
  fading: r.fading,
  people: r.people,
  platforms: r.platforms,
  companies: r.companies,
  decisions: r.decisions,
  evaluation: r.evaluation,
  cost: r.cost,
  digest: r.digest,
  reviewQueue: r.reviewQueue,
};

writeFileSync('web/demo-data.json', JSON.stringify(snapshot, null, 2));
console.log(`web/demo-data.json written (${r.people.total.toLocaleString()} people, top ${r.people.people.length} snapshotted, ${r.decisions.length} decisions)`);
