import { readFileSync } from 'node:fs';
import type { Connector } from './sdk.js';
import type { Signal } from '../signals/registry.js';
import { daysAgoIso } from '../util.js';

/** Minimal RFC-4180-ish CSV parser (quoted fields, escaped quotes). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '', row: string[] = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((c) => c !== '')) rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, idx) => [h.trim(), (r[idx] ?? '').trim()])));
}

/** CRM CSV import — every row becomes a crm_contact signal (the universal escape hatch: export from any CRM). */
export function csvCrmConnector(file: string, name = 'crm'): Connector {
  return {
    name,
    async fetch(): Promise<Signal[]> {
      return parseCsv(readFileSync(file, 'utf8')).map((r) => ({
        signalType: 'crm_contact' as const,
        externalId: r.email || r.name,
        observedAt: daysAgoIso(Number(r.days_ago || 30)),
        actor: {
          email: r.email || undefined,
          name: r.name || undefined,
          company: r.company || undefined,
          title: r.title || undefined,
          employees: r.employees ? Number(r.employees) : undefined,
          industry: r.industry || undefined,
        },
        props: { stage: r.stage || 'unknown' },
        consentBasis: (r.consent === 'consent' ? 'consent' : 'legitimate_interest') as 'consent' | 'legitimate_interest',
      }));
    },
  };
}
