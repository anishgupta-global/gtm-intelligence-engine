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
    const note = document.createElement('div');
    note.className = 'static-note';
    note.textContent = 'Static snapshot of the demo pipeline (fictional Northwind AI dataset). Clone the repo and run "npm run demo && npm run dev" for the live engine.';
    document.querySelector('main').prepend(note);
  }
  const map = {
    '/api/summary': DEMO.summary,
    '/api/leads/hot': DEMO.hot,
    '/api/leads/fading': DEMO.fading,
    '/api/people': DEMO.people,
    '/api/decisions': DEMO.decisions,
    '/api/evaluation': DEMO.evaluation,
    '/api/cost': DEMO.cost,
    '/api/digest': { markdown: DEMO.digest },
    '/api/review-queue': DEMO.reviewQueue,
  };
  return map[path] ?? null;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const initials = (name) => (name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const pct = (v) => `${v >= 0 ? '+' : ''}${v}%`;

function kpi(label, value, sub, cls = '') {
  return `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub ${cls}">${sub}</div>` : ''}</div>`;
}

async function renderOverview() {
  const s = await api('/api/summary');
  const cost = await api('/api/cost');
  document.getElementById('kpis').innerHTML =
    kpi('People', s.people, `+${s.newPeople7} this week`, 'up') +
    kpi('Companies', s.companies) +
    kpi('Hot leads', s.hotLeads ?? s.hot ?? 0, 'ranked by intent') +
    kpi('Fading champions', s.fading, s.fading > 0 ? 'churn risk' : 'all healthy', s.fading > 0 ? 'down' : 'up') +
    kpi('Cost per insight', `$${cost.costPerInsight}`, `${cost.budget.mode} budget mode`);

  const maxSignals = Math.max(1, ...s.segments.map((x) => x.current));
  document.getElementById('segments').innerHTML = s.segments.map((x) => `
    <div class="seg-row">
      <span class="seg-name">${esc(x.segment)}</span>
      <div class="seg-track"><div class="seg-fill ${x.deltaPct < 0 ? 'neg' : ''}" style="width:${Math.round((x.current / maxSignals) * 100)}%"></div></div>
      <span class="seg-delta ${x.deltaPct < 0 ? 'neg' : ''}">${pct(x.deltaPct)}</span>
    </div>`).join('') || '<div class="empty">No signals yet</div>';

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

  const hot = await api('/api/leads/hot');
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
    </div>`).join('') : '<div class="empty">No hot leads — run the demo: npm run demo</div>';
}

async function renderPeople() {
  const people = await api('/api/people');
  document.getElementById('people').innerHTML = `
    <table><thead><tr><th>Name</th><th>Company</th><th>Title</th><th>Identifiers</th></tr></thead>
    <tbody>${people.map((p) => `<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.company ?? '—')}</td><td>${esc(p.title ?? p.role ?? '—')}</td><td>${p.identifiers}</td></tr>`).join('')}</tbody></table>`;

  const queue = await api('/api/review-queue');
  document.getElementById('review-queue').innerHTML = queue.length ? queue.map((q) => `
    <div class="decision">
      <div class="decision-head">
        <div class="decision-title">Merge "${esc(q.from?.display_name)}" into "${esc(q.to?.display_name)}"?</div>
        <span class="pill pill-amber">confidence ${q.confidence}</span>
      </div>
      <div class="lead-signals">identifiers: ${q.keys.map(esc).join(', ')} · evidence: ${(q.evidence ?? []).slice(0, 3).map(esc).join(', ')}</div>
      ${LIVE ? `<div class="actions">
        <button onclick="reviewAction('approve','${q.from?.id}','${q.to?.id}')">Approve merge</button>
        <button onclick="reviewAction('reject','','${q.to?.id}')">Keep separate</button>
      </div>` : ''}
    </div>`).join('') : '<div class="empty">Queue is empty — nothing waiting for human judgment</div>';
}

async function reviewAction(kind, fromId, toId) {
  await fetch(`/api/review-queue/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fromPersonId: fromId, toPersonId: toId }),
  });
  renderPeople();
}

async function renderDecisions() {
  const decisions = await api('/api/decisions');
  document.getElementById('decisions').innerHTML = decisions.length ? decisions.map((d) => {
    const prior = (d.priors ?? [])[0];
    return `
    <div class="decision">
      <div class="decision-head">
        <div class="decision-title">${esc(d.title)}</div>
        <span class="pill pill-navy">confidence ${d.confidence}</span>
      </div>
      <dl class="trace">
        <dt>Evidence</dt><dd>${(d.trace?.evidence ?? []).slice(0, 5).map(esc).join(', ') || '—'}</dd>
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
        <button onclick="recordOutcomePrompt('${d.id}')">Record outcome</button>
      </div>` : ''}
    </div>`;
  }).join('') : '<div class="empty">No decisions yet</div>';

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
}

async function recordOutcomePrompt(id) {
  const achieved = prompt('Qualified conversations achieved?');
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
    <div class="stack">${c.levels.map((l, i) => `<div style="width:${Math.max(1, Math.round((l.ops / totalOps) * 100))}%;background:${LEVEL_COLORS[l.level]}"></div>`).join('')}</div>
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

(async () => {
  const health = await api('/api/summary');
  if (LIVE) document.getElementById('mode-badge').textContent = `live · ${health.provider} provider`;
  await renderOverview();
  await renderPeople();
  await renderDecisions();
  await renderCost();
})();
