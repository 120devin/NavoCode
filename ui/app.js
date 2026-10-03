const $ = selector => document.querySelector(selector);
const token = location.hash.slice(1) || sessionStorage.getItem('navocode-token');
if (token) { sessionStorage.setItem('navocode-token', token); history.replaceState(null, '', '/'); }
let state, selected = null, version = 'intended', lastSignature = '';
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
const error = message => { $('#error').textContent = message; $('#error').hidden = !message; };
async function api(path, body) {
  const response = await fetch('/api/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw Error(data.error); return data;
}
const badge = (text, type = '') => el('span', text, `badge ${type}`);
function list(items) { const ul = el('ul'); for (const item of items) ul.append(el('li', item)); return ul; }
function panel(title, id) { const node = el('section', undefined, 'panel'); if (id) node.id = id; node.append(el('h2', title)); return node; }
function targetLabel() { return ['components', 'decisions', 'groups'].flatMap(k => state.spec[k]).find(x => x.id === selected)?.name || ['components', 'decisions', 'groups'].flatMap(k => state.spec[k]).find(x => x.id === selected)?.title || 'Whole change'; }
function choose(id, focus = true) {
  selected = id;
  $('#feedback-target').textContent = targetLabel(); $('#clear-target').hidden = !selected;
  document.querySelectorAll('[data-concept]').forEach(n => n.classList.toggle('selected', n.dataset.concept === selected));
  // Preserve the page position and every review section when selecting feedback context.
  if (focus) $('#feedback').focus({ preventScroll: true });
}
function discuss(id, name) { const b = el('button', name || 'Discuss', 'quiet'); b.onclick = () => choose(id); return b; }
function render() {
  const { spec, report, mode } = state;
  if (selected && !['components', 'decisions', 'groups'].some(k => spec[k].some(x => x.id === selected))) selected = null;
  $('#title').textContent = spec.title; $('#intent').textContent = spec.intent; $('#mode').textContent = mode === 'author' ? 'Authoring' : 'Review';
  $('#health').replaceChildren(badge(report.fresh ? 'Source binding current' : 'Source binding stale', report.fresh ? 'good' : 'warning'), badge(`${spec.groups.length} architectural groups`), badge(`${spec.unknowns.length} open questions`, spec.unknowns.length ? 'warning' : ''));
  if (report.uncovered?.length) $('#health').append(badge(`${report.uncovered.length} unexplained files`, 'warning'));
  if (report.staleEvidence?.length) $('#health').append(badge(`${report.staleEvidence.length} stale checks`, 'warning'));
  if (report.error) $('#health').append(badge(report.error, 'warning'));
  document.querySelector('[data-action="publish"]').hidden = mode !== 'review';
  for (const action of ['accept', 'implement']) document.querySelector(`[data-action="${action}"]`).hidden = mode === 'review';
  const pending = spec.decisions.filter(d => d.status !== 'accepted' || d.provenance !== 'human');
  if (pending.length) $('#health').append(badge(`${pending.length} engineer decisions need acceptance`, 'warning'));
  const implement = document.querySelector('[data-action="implement"]');
  implement.disabled = pending.length > 0;
  implement.title = pending.length ? 'Accept architectural decisions before requesting implementation.' : '';
  $('#proposal-link').hidden = !state.baseline;
  renderContent(); renderMessages(); choose(selected, false);
}
function graph(components) {
  const wrap = el('div', undefined, 'graph'), ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const columns = 2, rows = Math.ceil(components.length / columns), height = Math.max(190, rows * 145 + 25);
  svg.setAttribute('viewBox', `0 0 620 ${height}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${version} architecture map`);
  const make = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, value); if (text !== undefined) n.textContent = text; return n; };
  const positions = new Map(components.map((c, i) => [c.id, { x: 30 + (i % columns) * 310, y: 45 + Math.floor(i / columns) * 145 }]));
  const defs = make('defs', {}), marker = make('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }); marker.append(make('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#8196b0' })); defs.append(marker); svg.append(defs);
  for (const r of state.spec.relations) {
    if (r.state !== 'both' && r.state !== version) continue;
    const a = positions.get(r.from), b = positions.get(r.to); if (!a || !b) continue;
    const horizontal = a.y === b.y;
    const x1 = horizontal ? a.x + (b.x > a.x ? 245 : 0) : a.x + 122, y1 = horizontal ? a.y + 34 : a.y + (b.y > a.y ? 68 : 0);
    const x2 = horizontal ? b.x + (a.x > b.x ? 245 : 0) : b.x + 122, y2 = horizontal ? b.y + 34 : b.y + (a.y > b.y ? 68 : 0);
    svg.append(make('path', { d: `M ${x1} ${y1} L ${x2} ${y2}`, class: 'edge', 'marker-end': 'url(#arrow)' }));
    svg.append(make('text', { x: (x1 + x2) / 2, y: horizontal ? a.y - 13 : (y1 + y2) / 2 - 10, 'text-anchor': 'middle', class: 'edge-label' }, r.label.length > 30 ? r.label.slice(0, 28) + '…' : r.label));
  }
  for (const c of components) {
    const p = positions.get(c.id), g = make('g', { role: 'button', tabindex: '0', 'aria-label': `Inspect ${c.name}`, class: selected === c.id ? 'selected' : '', 'data-concept': c.id });
    g.append(make('rect', { x: p.x, y: p.y, width: 245, height: 68, rx: 10 }), make('text', { x: p.x + 17, y: p.y + 28 }, c.name.length > 29 ? c.name.slice(0, 27) + '…' : c.name), make('text', { x: p.x + 17, y: p.y + 48, class: 'edge-label' }, 'Discuss this responsibility →'));
    g.onclick = () => choose(c.id); g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(c.id); } }; svg.append(g);
  }
  wrap.append(svg); return wrap;
}
function renderContent() {
  const content = $('#content'), s = state.spec; content.replaceChildren();
  const map = panel('Architecture', 'architecture'), heading = el('div', undefined, 'section-heading'), segmented = el('div', undefined, 'segmented');
  heading.append(map.firstChild);
  for (const value of ['current', 'intended']) { const b = el('button', value === 'current' ? 'Before' : 'Intended', value === version ? 'active' : ''); b.onclick = () => { version = value; renderContent(); }; segmented.append(b); }
  heading.append(segmented); map.append(heading);
  if (s.components.length) map.append(graph(s.components)); else map.append(el('p', 'The agent is still mapping this architecture.'));
  map.append(el('p', 'The whole architecture stays visible. Select a concept only when you want to discuss it.', 'fine'));
  content.append(map);
  const groups = el('div', undefined, 'group-summaries');
  for (const g of s.groups) { const p = panel(g.title); p.dataset.concept = g.id; p.append(el('p', g.summary), discuss(g.id, 'Discuss this area')); groups.append(p); }
  content.append(groups);
  const responsibilities = panel('What changes');
  for (const c of s.components) {
    const row = el('article', undefined, 'responsibility'); row.dataset.concept = c.id;
    const head = el('div', undefined, 'section-heading'); head.append(el('h3', c.name), discuss(c.id, 'Discuss this responsibility')); row.append(head);
    const comparison = el('div', undefined, 'comparison');
    for (const [key, label] of [['current', 'Before'], ['intended', 'Intended']]) { const column = el('div', undefined, key === 'current' ? 'before' : 'after'); column.append(el('h4', label), el('p', c[key] || 'Not described yet')); comparison.append(column); }
    row.append(comparison, el('p', `Observed: ${c.observed || 'Not inspected yet'}`, 'observed')); responsibilities.append(row);
  }
  content.append(responsibilities);
  const decisions = panel('Engineer decisions', 'decisions');
  decisions.append(el('p', 'You own the architectural choices. The agent proposes alternatives and consequences, then implements the choices you accept.'));
  const categories = { boundaries: 'System boundaries', data: 'Data ownership', contracts: 'Contracts and compatibility', security: 'Security and trust', reliability: 'Failure behavior', migration: 'Migration and rollout', operations: 'Operations', cost: 'Cost and performance' };
  if (!s.decisions.length) decisions.append(el('p', 'No decisions mapped yet.'));
  for (const d of s.decisions) {
    const row = el('article', undefined, 'decision'); row.dataset.concept = d.id;
    const head = el('div', undefined, 'section-heading'); head.append(el('h3', d.title), badge(d.status === 'accepted' && d.provenance === 'human' ? 'Accepted by engineer' : 'Needs engineer decision', d.status === 'accepted' && d.provenance === 'human' ? 'good' : 'warning')); row.append(head);
    if (d.category) row.append(badge(categories[d.category]));
    row.append(el('p', d.choice || 'No choice recorded'));
    const columns = el('div', undefined, 'comparison');
    for (const [name, items] of [['Alternatives', d.alternatives], ['Consequences', d.consequences]]) { const column = el('div'); column.append(el('h4', name), items.length ? list(items) : el('p', 'None recorded')); columns.append(column); }
    row.append(columns, discuss(d.id, 'Discuss this decision')); decisions.append(row);
  }
  content.prepend(decisions);
  const assurance = panel('Assurance', 'assurance'), columns = el('div', undefined, 'comparison');
  const criteria = el('div'); criteria.append(el('h3', 'Acceptance criteria'), s.acceptanceCriteria.length ? list(s.acceptanceCriteria) : el('p', 'Not defined yet'));
  const questions = el('div'); questions.append(el('h3', 'Open questions'), s.unknowns.length ? list(s.unknowns) : el('p', 'None recorded')); columns.append(criteria, questions); assurance.append(columns);
  assurance.append(el('h3', 'Implementation evidence'));
  if (!s.evidence.length) assurance.append(el('p', 'No evidence recorded. Claims are not yet verified.'));
  for (const e of s.evidence) { const row = el('article', undefined, 'evidence-row'); row.append(badge(`${e.kind} · ${e.status}`, e.status === 'supported' && !state.report.staleEvidence?.includes(e.id) ? 'good' : 'warning'), el('h4', e.claim), el('p', e.detail)); if (state.report.staleEvidence?.includes(e.id)) row.append(el('p', 'This evidence refers to an older source revision.', 'warning-text')); assurance.append(row); }
  if (state.report.uncovered?.length) assurance.append(el('h3', 'Changes still needing explanation'), list(state.report.uncovered));
  if (s.nonGoals.length) assurance.append(el('h3', 'Out of scope'), list(s.nonGoals));
  content.append(assurance);
  if (state.baseline) renderProposal(content, s, state.baseline);
  document.querySelectorAll('[data-concept]').forEach(n => n.classList.toggle('selected', n.dataset.concept === selected));
}
function renderProposal(content, spec, baseline) {
  const section = panel('Proposed edits', 'proposal'); let count = 0;
  const display = v => v === undefined ? 'Absent' : Array.isArray(v) ? v.map(x => typeof x === 'object' ? `${x.path}: ${x.reason}` : x).join('; ') || 'None' : String(v);
  const difference = (title, before, after) => { const row = el('article', undefined, 'proposal-row'); row.append(el('h3', title)); const columns = el('div', undefined, 'comparison'); const a = el('div', undefined, 'before'), b = el('div', undefined, 'after'); a.append(el('h4', 'Original PR'), el('p', display(before))); b.append(el('h4', 'Suggested'), el('p', display(after))); columns.append(a, b); row.append(columns); section.append(row); count++; };
  for (const collection of ['components', 'decisions', 'groups', 'relations', 'evidence']) {
    for (const id of new Set([...baseline[collection], ...spec[collection]].map(v => v.id))) {
      const before = baseline[collection].find(x => x.id === id), after = spec[collection].find(x => x.id === id);
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      const name = after?.name || after?.title || before?.name || before?.title || id;
      for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) if (key !== 'id' && JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])) difference(`${name} · ${key}`, before?.[key], after?.[key]);
    }
  }
  for (const key of ['title', 'intent', 'acceptanceCriteria', 'nonGoals', 'unknowns', 'supportingChanges']) if (JSON.stringify(baseline[key]) !== JSON.stringify(spec[key])) difference(key, baseline[key], spec[key]);
  if (!count) section.append(el('p', 'No architectural edits yet. Suggest a change to build a proposal with your agent.'));
  content.append(section);
}
function renderMessages() {
  const box = $('#messages'), nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80; box.replaceChildren();
  for (const event of state.events.slice(-8)) {
    const p = el('div', undefined, 'message human'); p.append(el('small', `You · ${event.action} · ${event.status}`), el('div', event.text || event.action)); box.append(p);
    for (const reply of state.messages.filter(m => m.eventId === event.id)) { const r = el('div', undefined, 'message'); r.append(el('small', 'Agent'), el('div', reply.text)); box.append(r); }
  }
  if (nearBottom) box.scrollTop = box.scrollHeight;
}
async function submit(action) {
  if (!state) return; const text = $('#feedback').value.trim();
  if (['change', 'ask'].includes(action) && !text) { error('Describe your question or architectural change first.'); $('#feedback').focus(); return; }
  try { await api('events', { action, text, target: selected || 'whole-change', revision: state.revision }); $('#feedback').value = ''; error(''); await refresh(); } catch (e) { error(e.message); }
}
$('#feedback-form').onsubmit = e => { e.preventDefault(); submit('change'); };
document.querySelectorAll('[data-action]').forEach(b => { if (b.type !== 'submit') b.onclick = () => submit(b.dataset.action); });
$('#clear-target').onclick = () => choose(null);
async function refresh() {
  try {
    const next = await api('state'), signature = JSON.stringify([next.revision, next.events, next.messages, next.report]); state = next;
    $('#connection').textContent = next.agentConnected ? 'Agent connected' : 'Waiting for agent';
    if (signature !== lastSignature) { lastSignature = signature; render(); }
  } catch (e) { error(`Workspace unavailable: ${e.message}. Ask your agent to restart the session if needed.`); }
}
await refresh(); setInterval(refresh, 1500);
