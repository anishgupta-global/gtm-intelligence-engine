import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { openDb } from '../src/db.js';
import { config } from '../src/config.js';
import { runDemo } from './demo-core.js';

const banner = `
=====================================================================
  GTM Intelligence Engine — end-to-end demo (Northwind AI workspace)
  Answers one question, weekly: who should you talk to, and why?
=====================================================================`;

console.log(banner);

try { rmSync(config.dbPath); } catch {}
try { rmSync(config.dbPath + '-journal'); } catch {}
const db = openDb(config.dbPath);

const result = await runDemo(db, (s) => console.log(s));

mkdirSync('data', { recursive: true });
writeFileSync('data/digest.md', result.digest);

console.log('\n=====================================================================');
console.log('  Weekly digest written to data/digest.md');
console.log('  Now explore it visually:  npm run dev  ->  http://localhost:' + config.port);
console.log('=====================================================================\n');
