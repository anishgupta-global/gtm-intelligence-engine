import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = DatabaseSync;

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL DEFAULT 'default',
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  consent_basis TEXT NOT NULL DEFAULT 'legitimate_interest',
  erased INTEGER NOT NULL DEFAULT 0,
  UNIQUE(tenant, source, external_id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_obs_signal ON observations(tenant, signal_type, observed_at);

CREATE TABLE IF NOT EXISTS identifiers (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL DEFAULT 'default',
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  observation_id TEXT NOT NULL,
  UNIQUE(tenant, kind, value, observation_id)
);
CREATE INDEX IF NOT EXISTS idx_ident_key ON identifiers(tenant, kind, value);

CREATE TABLE IF NOT EXISTS persons (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL DEFAULT 'default',
  display_name TEXT NOT NULL,
  primary_email TEXT,
  company TEXT,
  title TEXT,
  created_at TEXT NOT NULL,
  erased INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS person_memberships (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL DEFAULT 'default',
  person_id TEXT NOT NULL,
  identifier_key TEXT NOT NULL,
  confidence REAL NOT NULL,
  method TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '[]',
  engine_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memb_key ON person_memberships(tenant, identifier_key, status);
CREATE INDEX IF NOT EXISTS idx_memb_person ON person_memberships(tenant, person_id, status);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL DEFAULT 'default',
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  attrs TEXT NOT NULL DEFAULT '{}',
  UNIQUE(tenant, type, name)
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL DEFAULT 'default',
  type TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1,
  provenance TEXT NOT NULL DEFAULT '[]',
  valid_from TEXT,
  valid_to TEXT,
  UNIQUE(tenant, type, from_id, to_id)
);

CREATE TABLE IF NOT EXISTS enrichments (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL DEFAULT 'default',
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  confidence REAL NOT NULL,
  provenance TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL,
  model_version TEXT NOT NULL DEFAULT '',
  reasoning TEXT NOT NULL DEFAULT '',
  resolution_level INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_enrich ON enrichments(tenant, entity_id, field, created_at);

CREATE TABLE IF NOT EXISTS scores (
  tenant TEXT NOT NULL DEFAULT 'default',
  entity_id TEXT NOT NULL,
  score_type TEXT NOT NULL,
  value REAL NOT NULL,
  factors TEXT NOT NULL DEFAULT '{}',
  computed_at TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  PRIMARY KEY(tenant, entity_id, score_type)
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL DEFAULT 'default',
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '{}',
  trace TEXT NOT NULL,
  confidence REAL NOT NULL,
  base_confidence REAL NOT NULL,
  prior TEXT,
  embedding TEXT NOT NULL,
  expected TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  input_hash TEXT NOT NULL,
  resolution_level INTEGER NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outcomes (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL DEFAULT 'default',
  decision_id TEXT NOT NULL,
  metrics TEXT NOT NULL,
  note TEXT,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL DEFAULT 'default',
  decision_id TEXT NOT NULL UNIQUE,
  expected TEXT NOT NULL,
  actual TEXT NOT NULL,
  attainment REAL NOT NULL,
  verdict TEXT NOT NULL,
  calibration_error REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calibration (
  tenant TEXT NOT NULL DEFAULT 'default',
  kind TEXT NOT NULL,
  adjustment REAL NOT NULL DEFAULT 0,
  samples INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  PRIMARY KEY(tenant, kind)
);

CREATE TABLE IF NOT EXISTS intelligence_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ttl_seconds INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cost_ledger (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL DEFAULT 'default',
  ts TEXT NOT NULL,
  level INTEGER NOT NULL,
  operation TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'none',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  cache_hit INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL DEFAULT 'default',
  stage TEXT NOT NULL,
  ref TEXT,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL DEFAULT 'default',
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  connector TEXT PRIMARY KEY,
  cursor TEXT,
  last_run TEXT
);
`;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

export const j = (v: unknown) => JSON.stringify(v);
export const pj = <T = any>(s: unknown): T => JSON.parse(String(s ?? 'null')) as T;
