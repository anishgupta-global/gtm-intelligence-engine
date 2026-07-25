import { readFileSync } from 'node:fs';
import type { Connector } from './sdk.js';
import type { Signal } from '../signals/registry.js';
import { daysAgoIso } from '../util.js';

/**
 * Fixture + array connectors. Fixture files hold hand-authored "named character" events
 * with relative dates (daysAgo); array connectors wrap programmatically generated signals
 * (the synthetic marketplace population). Both stand in for any poll-based source.
 */

export function loadFixtureSignals(file: string): Signal[] {
  const rows = JSON.parse(readFileSync(file, 'utf8')) as Array<Record<string, any>>;
  return rows.map((r) => ({
    signalType: r.signalType,
    externalId: String(r.externalId),
    observedAt: daysAgoIso(Number(r.daysAgo ?? 0)),
    actor: r.actor ?? {},
    props: r.props ?? {},
    consentBasis: r.consentBasis ?? 'legitimate_interest',
  }));
}

export function arrayConnector(name: string, signals: Signal[]): Connector {
  return { name, fetch: async () => signals };
}

export function fixtureConnector(name: string, file: string): Connector {
  return { name, fetch: async () => loadFixtureSignals(file) };
}
