import type { Signal } from '../src/signals/registry.js';
import { seededRng, daysAgoIso } from '../src/util.js';

/**
 * Synthetic marketplace population for the Northwind Eats demo — seeded and
 * deterministic, so every demo run is reproducible. Generates internally
 * consistent, OBSERVABLE data only: channel-attributed signups (the honest
 * version of "5k+ followed us"), engagement events, consumer orders, partner
 * payouts, and merchant enquiries. No follower counts, no reach estimates.
 *
 * scale=1 → ~25k consumers (~5.2k new this week) + 180 restaurant partners.
 */

interface ChannelParams {
  base: number;        // existing consumers acquired by this channel (15-365d ago)
  new7: number;        // new signups this week
  newPrior7: number;   // signups the prior week (growth baseline)
  engage7: number;     // additional engagement events in the last 7d
  engagePrior7: number;
  conversion: number;  // share of cohort that has ordered at least once
  repeat: number;      // share of orderers with 2+ orders
  aov: [number, number]; // order value range (EUR)
  merchantLeads: number; // partner enquiries via this channel in last 14d
  engagementType: string;
}

// base + newPrior7 + new7 across channels ≈ 24.9k consumers total, ~5.2k new this week.
const CHANNELS: Record<string, ChannelParams> = {
  instagram:  { base: 4700, new7: 1650, newPrior7: 1270, engage7: 520, engagePrior7: 410, conversion: 0.22, repeat: 0.30, aov: [16, 42], merchantLeads: 8, engagementType: 'website_visit' },
  tiktok:     { base: 4100, new7: 1900, newPrior7: 1310, engage7: 640, engagePrior7: 450, conversion: 0.11, repeat: 0.18, aov: [12, 30], merchantLeads: 1, engagementType: 'website_visit' },
  google:     { base: 3700, new7: 780,  newPrior7: 720,  engage7: 460, engagePrior7: 430, conversion: 0.52, repeat: 0.44, aov: [18, 48], merchantLeads: 2, engagementType: 'pricing_view' },
  newsletter: { base: 1500, new7: 260,  newPrior7: 255,  engage7: 480, engagePrior7: 465, conversion: 0.48, repeat: 0.62, aov: [18, 44], merchantLeads: 0, engagementType: 'newsletter_click' },
  referral:   { base: 750,  new7: 420,  newPrior7: 385,  engage7: 130, engagePrior7: 118, conversion: 0.50, repeat: 0.48, aov: [26, 58], merchantLeads: 0, engagementType: 'website_visit' },
  linkedin:   { base: 600,  new7: 190,  newPrior7: 165,  engage7: 70,  engagePrior7: 60,  conversion: 0.18, repeat: 0.20, aov: [16, 38], merchantLeads: 6, engagementType: 'website_visit' },
};

const FIRST = ['Noah', 'Mila', 'Leon', 'Sofia', 'Finn', 'Clara', 'Jonas', 'Ida', 'Paul', 'Lena2', 'Emil', 'Zoe', 'Anton', 'Maja', 'Theo', 'Nora', 'Max', 'Ella', 'Tom', 'Lia', 'Erik', 'Ava', 'Nils', 'Ruth', 'Omar', 'Yara', 'Ivan', 'Amin', 'Jin', 'Kim', 'Raj', 'Tara', 'Sven', 'Pia', 'Timo', 'Gül', 'Aldo', 'Nia', 'Juan', 'Eva'];
const LAST = ['Weber', 'Braun', 'Krüger', 'Wolf', 'Peters', 'Fuchs', 'Lang', 'Busch', 'Frank', 'Berger', 'Winkler', 'Roth', 'Beck', 'Lorenz', 'Baumann', 'Albrecht', 'Schuster', 'Simon', 'Ludwig', 'Böhm', 'Winter', 'Kraus', 'Martin', 'Schubert', 'Krämer', 'Vogt', 'Stein', 'Jäger', 'Otto', 'Sommer', 'Groß', 'Seidel', 'Heinrich', 'Brandt', 'Haas', 'Schreiber', 'Graf', 'Schulte', 'Dietrich', 'Ziegler'];
const CUISINES = ['Golden', 'Urban', 'Little', 'Royal', 'Fresh', 'Wild', 'Silk', 'Cosmo', 'Alpen', 'Neon', 'Rustic', 'Blue', 'Copper', 'Velvet'];
const VENUES = ['Wok', 'Tandoor', 'Grill', 'Bistro', 'Kitchen', 'Deli', 'Cantina', 'Trattoria', 'Diner', 'Brasserie', 'Taverna', 'Smokehouse'];

export interface SynthOutput {
  channels: Record<string, Signal[]>;
  crm: Signal[];
  orders: Signal[];
  restaurantNames: string[];
  totals: { consumers: number; newThisWeek: number; merchants: number };
}

export function generateMarketplace(scale = 1, seed = 20260725): SynthOutput {
  const rng = seededRng(seed);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
  const between = (lo: number, hi: number) => lo + rng() * (hi - lo);
  const n = (x: number) => Math.max(1, Math.round(x * scale));

  const sig = (signalType: string, externalId: string, daysAgo: number, actor: any, props: Record<string, any> = {}, consentBasis: any = 'contract'): Signal => ({
    signalType: signalType as any, externalId, observedAt: daysAgoIso(daysAgo), actor, props, consentBasis,
  });

  // --- restaurant partners (supply side) ---
  const restaurantNames: string[] = [];
  for (const c of CUISINES) for (const v of VENUES) restaurantNames.push(`${c} ${v}`);
  const merchantCount = n(168);
  const crm: Signal[] = [];
  const orders: Signal[] = [];
  const merchants: { name: string; email: string; owner: string }[] = [];
  for (let i = 0; i < merchantCount; i++) {
    const name = restaurantNames[i % restaurantNames.length] + (i >= restaurantNames.length ? ` ${Math.floor(i / restaurantNames.length) + 1}` : '');
    const owner = `${pick(FIRST)} ${pick(LAST)}`;
    const email = `owner${i}@${name.toLowerCase().replace(/[^a-z0-9]/g, '')}.example`;
    merchants.push({ name, email, owner });
    crm.push(sig('crm_contact', `crm:m${i}`, Math.round(between(30, 400)), {
      email, name: owner, company: name, title: 'Owner', employees: Math.round(between(3, 40)), industry: 'food',
    }, { stage: 'customer' }, 'contract'));
    // ~30% of partners have observable payouts; 2 synthetic churn cases (payouts stopped 5+ weeks ago)
    if (i < 2) {
      for (let w = 5; w <= 7; w++) orders.push(sig('payment', `payout:m${i}:w${w}`, w * 7 + Math.round(between(0, 4)), { email, name: owner, company: name }, { type: 'partner_payout', mrr: Math.round(between(900, 2600)) }));
    } else if (rng() < 0.3) {
      orders.push(sig('payment', `payout:m${i}:w0`, between(1, 6), { email, name: owner, company: name }, { type: 'partner_payout', mrr: Math.round(between(400, 5000)) }));
      orders.push(sig('payment', `payout:m${i}:w1`, between(8, 13), { email, name: owner, company: name }, { type: 'partner_payout', mrr: Math.round(between(400, 5000)) }));
    }
  }

  // --- consumers (demand side): channel-attributed signups + engagement + orders ---
  const channels: Record<string, Signal[]> = {};
  let consumerIdx = 0;
  let consumers = 0;
  let newThisWeek = 0;
  for (const [channel, p] of Object.entries(CHANNELS)) {
    const out: Signal[] = [];
    const cohort: { email: string; name: string; daysAgo: number }[] = [];
    const addConsumer = (daysAgo: number) => {
      const i = consumerIdx++;
      const name = `${pick(FIRST)} ${pick(LAST)}`;
      const email = `user${i}@example.com`;
      cohort.push({ email, name, daysAgo });
      out.push(sig('signup', `su:${channel}:${i}`, daysAgo, { email, name }, { channel, utm_campaign: `${channel}_acq` }, 'consent'));
      consumers++;
      if (daysAgo <= 7) newThisWeek++;
    };
    for (let i = 0; i < n(p.new7); i++) addConsumer(between(0, 7));
    for (let i = 0; i < n(p.newPrior7); i++) addConsumer(between(7.01, 14));
    for (let i = 0; i < n(p.base); i++) addConsumer(between(14.01, 365));

    // engagement events (recent + prior week baseline; prior-week events can only come
    // from people who already existed then — otherwise "new this week" would be corrupted)
    const existedPriorWeek = cohort.filter((c) => c.daysAgo > 7.2);
    for (let i = 0; i < n(p.engage7); i++) {
      const c = pick(cohort);
      out.push(sig(p.engagementType, `en:${channel}:a${i}`, Math.min(c.daysAgo, between(0, 7)), { email: c.email }, { campaign: `${channel}_wk` }, 'consent'));
    }
    for (let i = 0; i < n(p.engagePrior7); i++) {
      const c = pick(existedPriorWeek);
      out.push(sig(p.engagementType, `en:${channel}:b${i}`, Math.min(c.daysAgo, between(7.21, 14)), { email: c.email }, { campaign: `${channel}_wk_prev` }, 'consent'));
    }

    // orders for the converted share of the cohort — strided so orderers are UNIQUE
    // members spread across new + old users (with-replacement sampling would inflate
    // the repeat rate; taking a prefix would make only new users order)
    const orderers = Math.round(cohort.length * p.conversion);
    const stride = cohort.length / Math.max(1, orderers);
    for (let i = 0; i < orderers; i++) {
      const c = cohort[Math.min(cohort.length - 1, Math.floor(i * stride + rng() * (stride - 0.01)))];
      const count = rng() < p.repeat ? 2 + Math.floor(rng() * 2) : 1;
      for (let k = 0; k < count; k++) {
        // orders happen after signup, biased toward recent days, capped at the 60d revenue window
        const frac = rng() < 0.45 ? between(0.02, 0.25) : between(0.25, 1);
        const daysAgo = Math.min(60, Math.max(0.2, c.daysAgo * frac));
        const restaurant = merchants[Math.floor(Math.pow(rng(), 2) * merchants.length)].name; // top restaurants get more orders
        orders.push(sig('payment', `ord:${channel}:${i}:${k}`, daysAgo, { email: c.email }, { restaurant, amount: Math.round(between(p.aov[0], p.aov[1])) }));
      }
    }

    // merchant enquiries arriving through this channel (last 14d)
    for (let i = 0; i < n(p.merchantLeads); i++) {
      const owner = `${pick(FIRST)} ${pick(LAST)}`;
      const name = `${pick(CUISINES)} ${pick(VENUES)} ${channel.slice(0, 2)}${i}`;
      out.push(sig(i % 2 ? 'demo_request' : 'form_submit', `ml:${channel}:${i}`, between(0, 14), {
        email: `prospect.${channel}.${i}@${name.toLowerCase().replace(/[^a-z0-9]/g, '')}.example`,
        name: owner, company: name, title: 'Owner', employees: Math.round(between(3, 25)), industry: 'food',
      }, { form: 'partner_signup', channel }, 'consent'));
    }
    channels[channel] = out;
  }

  return { channels, crm, orders, restaurantNames: merchants.map((m) => m.name), totals: { consumers, newThisWeek, merchants: merchantCount } };
}
