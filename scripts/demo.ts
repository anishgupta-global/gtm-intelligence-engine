import { rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { openDb } from '../src/db.js';
import { config } from '../src/config.js';
import { runDemo } from './demo-core.js';

const banner = `
=====================================================================
  GTM Intelligence Engine — end-to-end demo
  Workspace: Northwind Eats (fictional two-sided food-delivery marketplace)
  Where should we invest growth effort — and who should we talk to there?
=====================================================================`;

console.log(banner);

for (const f of [config.dbPath, `${config.dbPath}-journal`, `${config.dbPath}-wal`, `${config.dbPath}-shm`]) {
  if (!existsSync(f)) continue;
  try {
    rmSync(f);
  } catch {
    console.error(`Cannot remove ${f} — stop the running server (npm run dev) first, then re-run the demo.`);
    process.exit(1);
  }
}
const db = openDb(config.dbPath);

const result = await runDemo(db, (s) => console.log(s));

mkdirSync('data', { recursive: true });
writeFileSync('data/digest.md', result.digest);

console.log('\n=====================================================================');
console.log('  Weekly digest written to data/digest.md');
console.log('  Now explore it visually:  npm run dev  ->  http://localhost:' + config.port);
console.log('=====================================================================\n');
