const $ = selector => document.querySelector(selector);
const token = location.hash.slice(1) || sessionStorage.getItem('navocode-token');
if (token) { sessionStorage.setItem('navocode-token', token); history.replaceState(null, '', '/'); }
let state, group = null, selected = null, tab = 'architecture', version = 'intended', lastSignature = '';
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
const error = message => { $('#error').textContent = message; $('#error').hidden = !message; };
async function api(path, body) {
  const result = await fetch('/api/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await result.json(); if (!result.ok) throw Error(data.error); return data;
}
function badge(text, type = '') { return el('span', text, `badge ${type}`); }
function list(items) { const ul = el('ul'); for (const item of items) ul.append(el('li', item)); return ul; }
function panel(title) { const node = el('section', undefined, 'panel'); node.append(el('h2', title)); return node; }
function choose(id) { selected = id; renderContent(); renderInspector(); $('#feedback-target').textContent = targetLabel(); }
function targetLabel() { return state.spec.components.find(c => c.id === selected)?.name || state.spec.decisions.find(d => d.id === selected)?.title || state.spec.groups.find(g => g.id === group)?.title || 'Whole change'; }
function visibleComponents() { const ids = state.spec.groups.find(g => g.id === group)?.componentIds; return state.spec.components.filter(c => !ids || ids.includes(c.id)); }
function render() {
  const { spec, report, mode } = state;
  $('#title').textContent = spec.title; $('#intent').textContent = spec.intent; $('#mode').textContent = mode === 'author' ? 'Authoring' : 'Review';
  $('#scope').textContent = group ? spec.groups.find(g => g.id === group)?.title || 'WHOLE CHANGE' : 'WHOLE CHANGE';
  const health = $('#health'); health.replaceChildren(badge(report.fresh ? 'Source binding current' : 'Source binding stale', report.fresh ? 'good' : 'warning'), badge(`${spec.groups.length} architectural groups`), badge(`${spec.unknowns.length} open questions`, spec.unknowns.length ? 'warning' : ''));
  if (report.uncovered?.length) health.append(badge(`${report.uncovered.length} unexplained files`, 'warning'));
  if (report.staleEvidence?.length) health.append(badge(`${report.staleEvidence.length} stale checks`, 'warning'));
  if (report.error) health.append(badge(report.error, 'warning'));
  $('#decision-count').textContent = spec.decisions.length;
  const nav = $('#groups'); nav.replaceChildren();
  for (const g of spec.groups) { const b = el('button', g.title, `group ${group === g.id ? 'active' : ''}`); b.onclick = () => { group = g.id; selected = null; render(); }; nav.append(b); }
  $('#overview').classList.toggle('active', !group);
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelector('[data-action="publish"]').hidden = mode !== 'review';
  for (const action of ['accept', 'implement']) document.querySelector(`[data-action="${action}"]`).hidden = mode === 'review';
  renderContent(); renderInspector(); renderMessages(); $('#feedback-target').textContent = targetLabel();
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
    const p = positions.get(c.id), g = make('g', { role: 'button', tabindex: '0', 'aria-label': `Inspect ${c.name}`, class: selected === c.id ? 'selected' : '' });
    g.append(make('rect', { x: p.x, y: p.y, width: 245, height: 68, rx: 10 }), make('text', { x: p.x + 17, y: p.y + 28 }, c.name.length > 29 ? c.name.slice(0, 27) + '…' : c.name), make('text', { x: p.x + 17, y: p.y + 48, class: 'edge-label' }, 'View responsibilities →'));
    g.onclick = () => choose(c.id); g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(c.id); } }; svg.append(g);
  }
  wrap.append(svg); return wrap;
}
function renderContent() {
  const content = $('#content'); content.replaceChildren(); const s = state.spec;
  if (tab === 'architecture') {
    const node = panel('Responsibilities & interactions'), heading = el('div', undefined, 'section-heading'), segmented = el('div', undefined, 'segmented');
    heading.append(node.firstChild);
    for (const value of ['current', 'intended']) { const b = el('button', value === 'current' ? 'Before' : 'Intended', value === version ? 'active' : ''); b.onclick = () => { version = value; renderContent(); }; segmented.append(b); }
    heading.append(segmented); node.append(heading);
    const components = visibleComponents();
    if (components.length) node.append(graph(components)); else node.append(el('p', 'Your agent is still mapping this architecture.'));
    node.append(el('p', 'Select a component to inspect its responsibilities. Relationships outside this group appear in the whole-change view.', 'fine'));
    content.append(node);
    const cards = el('div', undefined, 'cards');
    for (const c of components) { const b = el('button', undefined, `component ${selected === c.id ? 'selected' : ''}`); b.append(el('strong', c.name), el('p', c[version] || 'Not described yet')); b.onclick = () => choose(c.id); cards.append(b); }
    content.append(cards);
    const groups = s.groups.filter(g => !group || g.id === group);
    for (const g of groups) { const p = panel(g.title); p.append(el('p', g.summary)); content.append(p); }
  } else if (tab === 'decisions') {
    const ids = s.groups.find(g => g.id === group)?.decisionIds;
    for (const d of s.decisions.filter(d => !ids || ids.includes(d.id))) {
      const p = panel(d.title); p.classList.add('decision'); p.append(badge(d.status, d.status === 'accepted' ? 'good' : 'warning'), el('p', d.choice || 'No choice recorded'));
      p.append(el('h3', 'Alternatives'), list(d.alternatives), el('h3', 'Consequences'), list(d.consequences));
      const b = el('button', 'Discuss this decision'); b.onclick = () => { choose(d.id); $('#feedback').focus(); }; p.append(b); content.append(p);
    }
    if (!content.children.length) content.append(el('p', 'No decisions mapped yet.', 'empty'));
  } else if (tab === 'evidence') {
    const criteria = panel('Acceptance criteria'); criteria.append(list(s.acceptanceCriteria)); content.append(criteria);
    const unknowns = panel('Open questions'); unknowns.append(s.unknowns.length ? list(s.unknowns) : el('p', 'No open questions recorded.')); content.append(unknowns);
    const evidence = panel('Implementation evidence');
    for (const e of s.evidence) { const row = el('div', undefined, 'evidence-row'); row.append(badge(`${e.kind} · ${e.status}`, e.status === 'supported' && !state.report.staleEvidence?.includes(e.id) ? 'good' : 'warning'), el('h3', e.claim), el('p', e.detail)); if (state.report.staleEvidence?.includes(e.id)) row.append(el('p', 'This evidence refers to an older source revision.')); evidence.append(row); }
    if (!s.evidence.length) evidence.append(el('p', 'No evidence recorded. Claims are not yet verified.')); content.append(evidence);
    const observed = panel('Observed implementation'); for (const c of s.components) observed.append(el('h3', c.name), el('p', c.observed || 'Not inspected yet')); content.append(observed);
    if (state.report.uncovered?.length) { const gaps = panel('Changes the agent still needs to explain'); gaps.append(list(state.report.uncovered)); content.append(gaps); }
  } else {
    const baseline = state.baseline;
    if (!baseline) { content.append(el('p', 'Author feedback is shown below. Reviewer sessions compare architectural edits against the original PR specification.', 'empty')); return; }
    for (const collection of ['components', 'decisions', 'groups', 'relations', 'evidence']) {
      const ids = new Set([...baseline[collection], ...s[collection]].map(v => v.id));
      for (const id of ids) {
        const before = baseline[collection].find(x => x.id === id), after = s[collection].find(x => x.id === id);
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        const p = panel(after?.name || after?.title || before?.name || before?.title || id);
        for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
          if (key === 'id' || JSON.stringify(before?.[key]) === JSON.stringify(after?.[key])) continue;
          const display = v => v === undefined ? 'Absent' : Array.isArray(v) ? v.join('; ') || 'None' : String(v);
          p.append(el('h3', key), el('p', display(before?.[key]), 'diff-before'), el('p', display(after?.[key]), 'diff-after'));
        }
        content.append(p);
      }
    }
    for (const key of ['title', 'intent', 'acceptanceCriteria', 'nonGoals', 'unknowns', 'supportingChanges']) if (JSON.stringify(baseline[key]) !== JSON.stringify(s[key])) { const p = panel(key); const display = value => Array.isArray(value) ? value.map(x => typeof x === 'object' ? `${x.path}: ${x.reason}` : x).join('; ') || 'None' : value; p.append(el('p', display(baseline[key]), 'diff-before'), el('p', display(s[key]), 'diff-after')); content.append(p); }
    if (!content.children.length) content.append(el('p', 'No architectural edits yet. Suggest a change below to build a proposal with your agent.', 'empty'));
  }
}
function renderInspector() {
  const pane = $('#inspector'); pane.replaceChildren(el('p', 'ARCHITECTURE DETAILS', 'eyebrow'));
  const c = state.spec.components.find(c => c.id === selected), d = state.spec.decisions.find(d => d.id === selected);
  if (c) {
    pane.append(el('h2', c.name)); for (const [key, label] of [['current', 'Before'], ['intended', 'Intended'], ['observed', 'Observed implementation']]) pane.append(el('h3', label), el('p', c[key] || 'Not described yet'));
    const links = state.spec.relations.filter(r => r.from === c.id || r.to === c.id);
    pane.append(el('h3', 'Connected responsibilities'), list(links.map(r => `${state.spec.components.find(c => c.id === r.from)?.name} → ${state.spec.components.find(c => c.id === r.to)?.name}: ${r.label} (${r.state})`)));
  } else if (d) { pane.append(el('h2', d.title), badge(d.status), el('p', d.choice), el('h3', 'Consequences'), list(d.consequences)); }
  else { pane.append(el('h2', 'The whole change'), el('p', 'Start with the architecture. Explore a responsibility or decision, then tell your agent what should change.'), el('h3', 'Acceptance criteria'), list(state.spec.acceptanceCriteria), el('h3', 'Out of scope'), list(state.spec.nonGoals)); }
}
function renderMessages() {
  const messages = $('#messages'); messages.replaceChildren();
  for (const event of state.events.slice(-8)) { const p = el('div', undefined, 'message human'); p.append(el('small', `You · ${event.action} · ${event.status}`), el('div', event.text || event.action)); messages.append(p); const replies = state.messages.filter(m => m.eventId === event.id); for (const reply of replies) { const r = el('div', undefined, 'message'); r.append(el('small', 'Agent'), el('div', reply.text)); messages.append(r); } }
}
async function submit(action) {
  if (!state) return;
  const text = $('#feedback').value.trim();
  if (['change', 'ask'].includes(action) && !text) { error('Describe your question or architectural change first.'); $('#feedback').focus(); return; }
  try { await api('events', { action, text, target: selected || group || 'whole-change', revision: state.revision }); $('#feedback').value = ''; error(''); await refresh(); } catch (e) { error(e.message); }
}
$('#feedback-form').onsubmit = e => { e.preventDefault(); submit('change'); };
document.querySelectorAll('[data-action]').forEach(b => { if (b.type !== 'submit') b.onclick = () => submit(b.dataset.action); });
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
$('#overview').onclick = () => { group = null; selected = null; render(); };
async function refresh() {
  try {
    const next = await api('state'), signature = JSON.stringify([next.revision, next.events, next.messages, next.report]); state = next;
    $('#connection').textContent = next.agentConnected ? 'Agent connected' : 'Waiting for agent';
    if (signature !== lastSignature) { lastSignature = signature; render(); }
  } catch (e) { error(`Workspace unavailable: ${e.message}. Ask your agent to restart the session if needed.`); }
}
await refresh(); setInterval(refresh, 1500);
