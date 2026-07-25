import { openDb } from './db.js';
import { config } from './config.js';
import { getProvider } from './ai/provider.js';
import { buildServer } from './api/server.js';

const db = openDb(config.dbPath);
const provider = getProvider();
const app = buildServer(db, provider);

app.listen({ port: config.port, host: '0.0.0.0' }).then(() => {
  console.log(`GTM Intelligence Engine`);
  console.log(`  dashboard  http://localhost:${config.port}`);
  console.log(`  api        http://localhost:${config.port}/api/summary`);
  console.log(`  provider   ${provider.name}${provider.name === 'mock' ? ' ($0 mode — set ANTHROPIC_API_KEY for real reasoning)' : ''}`);
  console.log(`  db         ${config.dbPath}`);
  console.log(`\nNo data yet? Run: npm run demo`);
});
