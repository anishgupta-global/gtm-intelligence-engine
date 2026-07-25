let DEMO = null;
let LIVE = true;

async function api(path) {
  if (LIVE) {
    try {
      const res = await fetch(path);
      if (res.ok) return await res.json();
      LIVE = false;
    } catch { LIVE = false; }
  }
  if (!DEMO) {
    const res = await fetch('demo-data.json');
    DEMO = await res.json();
    document.getElementById('mode-badge').textContent = 'static demo snapshot';
    document.getElementById('conn-dot').classList.add('static');
    document.getElementById('powered').innerHTML = 'Deterministic pipeline · <b>$0</b>';
    const note = document.createElement('div');
    note.className = 'static-note';
    note.textContent = 'Static snapshot of the demo pipeline (fictional Northwind AI dataset). Clone the repo and run "npm run demo && npm run dev" for the live engine.';
    document.querySelector('main').prepend(note);
  }
  const base = path.split('?')[0];
  const map = {
    '/api/summary': DEMO.summary,
    '/api/leads/hot': DEMO.hot,
    '/api/leads/fading': DEMO.fading,
    '/api/people': DEMO.people,
    '/api/platforms': DEMO.platforms ?? [],
    '/api/companies': DEMO.companies ?? [],
    '/api/decisions': DEMO.decisions,
    '/api/evaluation': DEMO.evaluation,
    '/api/cost': DEMO.cost,
    '/api/digest': { markdown: DEMO.digest },
    '/api/review-queue': DEMO.reviewQueue,
  };
  return map[base] ?? null;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const initials = (name) => (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const pct = (v) => `${v >= 0 ? '+' : ''}${v}%`;

const RECO_PILL = {
  'double down': 'pill-green', 'increase budget': 'pill-green', 'expand incentives': 'pill-green',
  protect: 'pill-navy', 'maintain (B2C awareness)': 'pill-navy', nurture: 'pill-navy',
  're-engage': 'pill-amber', 'reduce effort': 'pill-red',
};
const KIND_LABEL = { weekly_gtm: 'who to contact', platform_allocation: 'where to invest', account_retention: 'account to save' };

function kpi(label, value, sub, cls = '') {
  return `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub ${cls}">${sub}</div>` : ''}</div>`;
}

function decisionCard(d, { compact = false } = {}) {
  const prior = (d.priors ?? [])[0];
  return `
    <div class="decision">
      <div class="decision-head">
        <div class="decision-title">${esc(d.title)}</div>
        <span style="display:flex;gap:6px;flex-shrink:0">
          <span class="pill pill-amber">${esc(KIND_LABEL[d.kind] ?? d.kind)}</span>
          <span class="pill pill-navy">confidence ${d.confidence}</span>
        </span>
      </div>
      <dl class="trace">
        ${compact ? '' : `<dt>Evidence</dt><dd>${(d.trace?.evidence ?? []).slice(0, 5).map(esc).join(', ') || '—'}</dd>`}
        <dt>Hypothesis</dt><dd>${esc(d.trace?.hypothesis)}</dd>
        <dt>Reasoning</dt><dd>${esc(d.trace?.reasoning)}</dd>
        <dt>Action</dt><dd>${esc(d.trace?.action)}</dd>
        <dt>Expected</dt><dd>${d.expected?.target} ${esc(d.expected?.metric)} · model ${esc(d.model)} (L${d.resolutionLevel})</dd>
        <dt>Status</dt><dd>${esc(d.status)}${d.verdict ? ` → <strong>${esc(d.verdict)}</strong> (attainment ${d.attainment})` : ''}</dd>
      </dl>
      ${prior ? `<span class="memory-chip">memory: ${Math.round(prior.similarity * 100)}% similar to a past ${esc(prior.verdict)} (attainment ${prior.attainment})</span>` : ''}
      ${LIVE && d.status === 'proposed' ? `<div class="actions">
        <button onclick="decisionAction('${d.id}','accept')">Accept</button>
        <button onclick="decisionAction('${d.id}','dismiss')">Dismiss</button>
      </div>` : ''}
      ${LIVE && d.status === 'accepted' ? `<div class="actions">
        <button onclick="recordOutcomePrompt('${d.id}','${esc(d.expected?.metric)}')">Record outcome</button>
      </div>` : ''}
    </div>`;
}

async function renderExecutive() {
  const s = await api('/api/summary');
  const cost = await api('/api/cost');
  const platforms = await api('/api/platforms');
  document.getElementById('kpis').innerHTML =
    kpi('People', s.people.toLocaleString(), `${(s.consumers ?? 0).toLocaleString()} consumers · ${s.merchants ?? 0} merchant contacts`) +
    kpi('New this week', `+${s.newPeople7.toLocaleString()}`, 'channel-attributed signups', 'up') +
    kpi('Orders 7d', (s.ordersThisWeek ?? 0).toLocaleString(), `€${(s.orderRevenue7 ?? 0).toLocaleString()}`) +
    kpi('Restaurant partners', s.companies) +
    kpi('Hot leads', (s.hotLeads ?? 0).toLocaleString(), 'intent ≥ 0.5') +
    kpi('Cost per insight', `$${cost.costPerInsight}`, `${cost.budget.mode} budget mode`);

  const decisions = await api('/api/decisions');
  const alloc = decisions.find((d) => d.kind === 'platform_allocation');
  document.getElementById('allocation').innerHTML = alloc ? decisionCard(alloc, { compact: true }) : '<div class="empty">Run the pipeline to get an allocation call</div>';

  document.getElementById('platforms-table').innerHTML = platforms.length ? `
    <table><thead><tr><th>Platform</th><th>People</th><th>New users/wk</th><th>Growth</th><th>Conversion</th><th>Repeat</th><th>Merchant leads</th><th>Quality</th><th>Call</th></tr></thead>
    <tbody>${platforms.map((p) => `<tr>
      <td><strong>${esc(p.source)}</strong></td><td>${p.people.toLocaleString()}</td>
      <td>+${(p.newUsers7 ?? 0).toLocaleString()}</td>
      <td class="${p.growthPct < 0 ? 'neg-text' : 'pos-text'}">${pct(p.growthPct)}</td>
      <td>${Math.round((p.conversion ?? 0) * 100)}%</td><td>${Math.round((p.repeatRate ?? 0) * 100)}%</td>
      <td>${p.merchantLeads14 ?? 0}</td><td>${p.quality}</td>
      <td><span class="pill ${RECO_PILL[p.recommendation] ?? 'pill-navy'}">${esc(p.recommendation)}</span></td>
    </tr>`).join('')}</tbody></table>` : '<div class="empty">No platform data yet — run: npm run demo</div>';

  const maxSignals = Math.max(1, ...s.segments.map((x) => x.current));
  document.getElementById('segments').innerHTML = s.segments.map((x) => `
    <div class="seg-row">
      <span class="seg-name">${esc(x.segment)}</span>
      <div class="seg-track"><div class="seg-fill ${x.deltaPct < 0 ? 'neg' : ''}" style="width:${Math.round((x.current / maxSignals) * 100)}%"></div></div>
      <span class="seg-delta ${x.deltaPct < 0 ? 'neg' : ''}">${pct(x.deltaPct)}</span>
    </div>`).join('') || '<div class="empty">No signals yet</div>';
}

async function renderBusiness() {
  const companies = await api('/api/companies');
  document.getElementById('companies').innerHTML = companies.length ? `
    <table><thead><tr><th>Restaurant</th><th>Industry</th><th>Contacts</th><th>Max intent</th><th>ICP</th><th>Churn risk</th><th>Revenue (60d)</th><th>Action</th></tr></thead>
    <tbody>${companies.map((c) => `<tr>
      <td><strong>${esc(c.company)}</strong></td><td>${esc(c.industry)}</td><td>${c.people}</td>
      <td>${c.maxIntent}</td><td>${c.icpFit}</td>
      <td>${c.churnRisk > 0 ? `<span class="pill pill-red">${Math.round(c.churnRisk * 100)}%</span>` : '—'}</td>
      <td>${c.mrr ? '€' + c.mrr.toLocaleString() : '—'}</td><td class="action-cell">${esc(c.action)}</td>
    </tr>`).join('')}</tbody></table>` : '<div class="empty">No restaurants yet</div>';

  await renderHotLeads();

  const fading = await api('/api/leads/fading');
  document.getElementById('fading').innerHTML = fading.length ? fading.map((f) => `
    <div class="lead">
      <div class="avatar" style="background:#fcebeb;color:#a32d2d">${initials(f.name)}</div>
      <div class="lead-main">
        <div class="lead-name">${esc(f.name)} <span>· ${esc(f.company ?? '')}</span></div>
        <div class="lead-signals">engagement down ${Math.round(f.drop * 100)}% · last active ${f.factors?.lastActiveDays ?? '?'}d ago</div>
      </div>
      <div class="lead-side"><span class="pill pill-red">retention</span></div>
    </div>`).join('') : '<div class="empty">Nobody going quiet this week</div>';

  const queue = await api('/api/review-queue');
  document.getElementById('review-queue').innerHTML = queue.length ? queue.map((q) => `
    <div class="decision">
      <div class="decision-head">
        <div class="decision-title">Merge "${esc(q.from?.display_name)}" into "${esc(q.to?.display_name)}"?</div>
        <span class="pill pill-amber">confidence ${q.confidence}</span>
      </div>
      <div class="lead-signals">identifiers: ${q.keys.map(esc).join(', ')}</div>
      ${LIVE ? `<div class="actions">
        <button onclick="reviewAction('approve','${q.from?.id}','${q.to?.id}')">Approve merge</button>
        <button onclick="reviewAction('reject','','${q.to?.id}')">Keep separate</button>
      </div>` : ''}
    </div>`).join('') : '<div class="empty">Queue is empty — nothing waiting for human judgment</div>';

  const pd = await api('/api/people');
  const list = pd.people ?? pd;
  const total = pd.total ?? list.length;
  document.getElementById('people').innerHTML = `
    <div class="lead-signals" style="margin-bottom:8px">${total.toLocaleString()} resolved people · showing top ${list.length} by side + intent</div>
    <table><thead><tr><th>Name</th><th>Side</th><th>Company</th><th>Title</th><th>Intent</th><th>Identifiers</th></tr></thead>
    <tbody>${list.slice(0, 60).map((p) => `<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.side ?? (p.company ? 'merchant' : 'consumer'))}</td><td>${esc(p.company ?? '—')}</td><td>${esc(p.title ?? '—')}</td><td>${p.intent ?? '—'}</td><td>${p.identifiers}</td></tr>`).join('')}</tbody></table>`;
}

async function renderHotLeads() {
  const limit = document.getElementById('f-limit').value;
  const role = document.getElementById('f-role').value;
  const minIntent = document.getElementById('f-intent').value;
  const side = document.getElementById('f-side').value;
  let hot = await api(`/api/leads/hot?limit=${limit}&role=${role}&minIntent=${minIntent}&side=${side}`);
  if (!LIVE) hot = hot.filter((l) => (!role || l.role === role) && (!side || l.side === side) && l.intent >= Number(minIntent)).slice(0, Number(limit));
  document.getElementById('hot-leads').innerHTML = hot.length ? hot.map((l) => `
    <div class="lead">
      <div class="avatar">${initials(l.name)}</div>
      <div class="lead-main">
        <div class="lead-name">${esc(l.name)} <span>· ${esc(l.title ?? l.role)}, ${esc(l.company ?? '—')}</span></div>
        <div class="lead-signals">${Object.entries(l.signals ?? {}).map(([t, v]) => `${esc(t)}×${v.count}`).join(' · ')}</div>
        <div class="lead-evidence">evidence: ${(l.evidence ?? []).slice(0, 3).map(esc).join(', ')}</div>
      </div>
      <div class="lead-side">
        <span class="pill ${l.intent >= 0.6 ? 'pill-green' : 'pill-amber'}">intent ${l.intent}</span>
        <div class="lead-action">${esc(l.action)}</div>
      </div>
    </div>`).join('') : '<div class="empty">No leads match these filters</div>';
}

async function renderAudience() {
  const platforms = await api('/api/platforms');
  document.getElementById('platform-cards').innerHTML = platforms.length ? platforms.map((p) => `
    <div class="card">
      <div class="decision-head">
        <h2 style="margin:0">${esc(p.source)}</h2>
        <span class="pill ${RECO_PILL[p.recommendation]}">${esc(p.recommendation)}</span>
      </div>
      <div class="kpi-row" style="margin:12px 0">
        ${kpi('People', p.people.toLocaleString())}
        ${kpi('New users/wk', '+' + (p.newUsers7 ?? 0).toLocaleString(), 'channel-attributed signups')}
        ${kpi('Signals 7d', p.signals7.toLocaleString(), pct(p.growthPct) + ' vs prior wk', p.growthPct < 0 ? 'down' : 'up')}
        ${kpi('Order conversion', Math.round((p.conversion ?? 0) * 100) + '%', 'repeat ' + Math.round((p.repeatRate ?? 0) * 100) + '%')}
        ${kpi('Quality', p.quality + '/100', 'active intent ' + (p.avgIntentActive ?? p.avgIntent))}
      </div>
      <div class="lead-signals">top signals: ${p.topSignals.map((t) => `${esc(t.type)}×${t.count}`).join(' · ') || '—'}</div>
      <div class="lead-signals">top people: ${p.topPeople.map((t) => `${esc(t.name)} (${t.intent})`).join(' · ') || '—'}</div>
    </div>`).join('') : '<div class="card"><div class="empty">No platform data yet — run: npm run demo</div></div>';
}

async function reviewAction(kind, fromId, toId) {
  await fetch(`/api/review-queue/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fromPersonId: fromId, toPersonId: toId }),
  });
  renderBusiness();
}

async function renderDecisions() {
  const decisions = await api('/api/decisions');
  document.getElementById('decisions').innerHTML = decisions.length
    ? decisions.map((d) => decisionCard(d)).join('')
    : '<div class="empty">No decisions yet</div>';

  const ev = await api('/api/evaluation');
  document.getElementById('evaluation').innerHTML = `
    <div class="kpi-row">
      ${kpi('Decisions', ev.decisionsTotal)}
      ${kpi('Acceptance rate', ev.acceptanceRate ?? '—')}
      ${kpi('Success rate', ev.successRate ?? '—')}
      ${kpi('Calibration error', ev.meanCalibrationError ?? '—', 'mean |confidence − attainment|')}
    </div>
    ${ev.history.length ? `<table><thead><tr><th>Decision</th><th>Expected</th><th>Actual</th><th>Attainment</th><th>Verdict</th></tr></thead>
    <tbody>${ev.history.map((h) => `<tr><td>${esc(h.title)}</td><td>${h.expected.target}</td><td>${h.actual.achieved}</td><td>${h.attainment}</td><td><span class="pill ${h.verdict === 'winner' ? 'pill-green' : h.verdict === 'loser' ? 'pill-red' : 'pill-amber'}">${esc(h.verdict)}</span></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No outcomes recorded yet — accept a decision and record what happened</div>'}
    <div class="lead-evidence" style="margin-top:8px">not measured yet (needs ground truth): ${ev.notMeasuredYet.join(', ')}</div>`;
}

async function decisionAction(id, action) {
  await fetch(`/api/decisions/${id}/${action}`, { method: 'POST' });
  renderDecisions();
  renderExecutive();
}

async function recordOutcomePrompt(id, metric) {
  const achieved = prompt(`Achieved value for "${metric}"?`);
  if (achieved === null) return;
  await fetch(`/api/decisions/${id}/outcome`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ achieved: Number(achieved), note: 'recorded via dashboard' }),
  });
  renderDecisions();
}

const LEVEL_COLORS = ['#b5d4f4', '#85b7eb', '#378add', '#185fa5'];

async function renderCost() {
  const c = await api('/api/cost');
  const totalOps = c.levels.reduce((s, l) => s + l.ops, 0) || 1;
  document.getElementById('cost').innerHTML = `
    <div class="kpi-row">
      ${kpi('AI spend', `$${c.totalSpendUsd}`, `of $${c.budget.budgetUsd} budget (${c.budget.mode})`)}
      ${kpi('Cost per insight', `$${c.costPerInsight}`, `${c.insights} insights generated`)}
      ${kpi('Cache hits', c.cacheHits, `${c.cacheEntries} cached results`)}
    </div>
    <div class="stack">${c.levels.map((l) => `<div style="width:${Math.max(1, Math.round((l.ops / totalOps) * 100))}%;background:${LEVEL_COLORS[l.level]}"></div>`).join('')}</div>
    <div class="bar-legend">${c.levels.map((l) => `<span><span class="sw" style="background:${LEVEL_COLORS[l.level]}"></span>${l.label} ${l.pct}% (${l.ops} ops, $${l.costUsd})</span>`).join('')}</div>`;

  const d = await api('/api/digest');
  document.getElementById('digest').textContent = d.markdown;
}

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

['f-limit', 'f-role', 'f-intent', 'f-side'].forEach((id) => document.getElementById(id).addEventListener('change', renderHotLeads));

(async () => {
  const health = await api('/api/summary');
  if (LIVE) {
    document.getElementById('mode-badge').textContent = `live · ${health.provider} provider`;
    if (health.provider === 'anthropic') document.getElementById('powered').innerHTML = 'Powered by <b>Claude</b>';
  }
  await renderExecutive();
  await renderBusiness();
  await renderAudience();
  await renderDecisions();
  await renderCost();
})();
