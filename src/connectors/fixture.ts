import { readFileSync } from 'node:fs';
import type { Connector } from './sdk.js';
import type { Signal } from '../signals/registry.js';
import { daysAgoIso } from '../util.js';

/**
 * Fixture connector — replays a JSON file of raw events shaped as signals with
 * relative dates (daysAgo), so demo data is always "recent". Stands in for any
 * poll-based source (newsletter tool, payment processor, product analytics, ...).
 */
export function fixtureConnector(name: string, file: string): Connector {
  return {
    name,
    async fetch(): Promise<Signal[]> {
      const rows = JSON.parse(readFileSync(file, 'utf8')) as Array<Record<string, any>>;
      return rows.map((r) => ({
        signalType: r.signalType,
        externalId: String(r.externalId),
        observedAt: daysAgoIso(Number(r.daysAgo ?? 0)),
        actor: r.actor ?? {},
        props: r.props ?? {},
        consentBasis: r.consentBasis ?? 'legitimate_interest',
      }));
    },
  };
}
