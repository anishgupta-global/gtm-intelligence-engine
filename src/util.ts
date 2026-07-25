import { createHash, randomBytes } from 'node:crypto';

export const now = () => new Date().toISOString();
export const daysAgoIso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
export const id = (prefix: string) => `${prefix}_${randomBytes(8).toString('hex')}`;
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round2 = (v: number) => Math.round(v * 100) / 100;

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9@. ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Token-based name similarity with initial handling ("J. Rodriguez" ~ "Jorge Rodriguez"). */
export function nameSimilarity(a: string, b: string): number {
  const ta = normalize(a).split(' ').filter(Boolean);
  const tb = normalize(b).split(' ').filter(Boolean);
  if (!ta.length || !tb.length) return 0;
  const matchToken = (x: string, ys: string[]): number => {
    let best = 0;
    for (const y of ys) {
      if (x === y) best = Math.max(best, 1);
      else if (x.length <= 2 && y.startsWith(x[0])) best = Math.max(best, 0.8);
      else if (y.length <= 2 && x.startsWith(y[0])) best = Math.max(best, 0.8);
    }
    return best;
  };
  const sa = ta.reduce((s, t) => s + matchToken(t.replace('.', ''), tb.map((x) => x.replace('.', ''))), 0) / ta.length;
  const sb = tb.reduce((s, t) => s + matchToken(t.replace('.', ''), ta.map((x) => x.replace('.', ''))), 0) / tb.length;
  return (sa + sb) / 2;
}

export function companySimilarity(a: string | undefined, b: string | undefined): number {
  if (!a || !b) return 0;
  const na = normalize(a).replace(/\b(inc|gmbh|ltd|llc|corp|co)\b/g, '').trim();
  const nb = normalize(b).replace(/\b(inc|gmbh|ltd|llc|corp|co)\b/g, '').trim();
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  return 0;
}

/** Deterministic local embedding: char-trigram hashing into 128 dims, L2-normalized. Zero cost (L1). Pluggable. */
export function localEmbed(text: string, dims = 128): number[] {
  const v = new Array<number>(dims).fill(0);
  const t = `##${normalize(text)}##`;
  for (let i = 0; i < t.length - 2; i++) {
    const tri = t.slice(i, i + 3);
    let h = 2166136261;
    for (let j = 0; j < 3; j++) {
      h ^= tri.charCodeAt(j);
      h = Math.imul(h, 16777619);
    }
    v[Math.abs(h) % dims] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/** Seeded PRNG (mulberry32) — the synthetic demo dataset is deterministic and reproducible. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) dot += a[i] * b[i];
  return dot;
}

/** Strip emails and phone numbers from any free text before it can reach an LLM. */
export function redactPii(s: string): string {
  return s
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone]');
}
