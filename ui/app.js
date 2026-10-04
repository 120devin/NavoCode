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
// Collapse cycles before assigning dependency layers; input order is only a tie-breaker.
function architectureLayers(components, relations) {
  const ids = components.map(c => c.id), edges = new Map(ids.map(id => [id, []]));
  for (const r of relations) if (edges.has(r.from) && edges.has(r.to)) edges.get(r.from).push(r.to);
  const reachable = new Map(ids.map(id => {
    const seen = new Set(), visit = node => { if (seen.has(node)) return; seen.add(node); edges.get(node).forEach(visit); };
    visit(id); return [id, seen];
  }));
  const owner = new Map(), clusters = [];
  for (const id of ids) if (!owner.has(id)) {
    const members = ids.filter(other => reachable.get(id).has(other) && reachable.get(other).has(id));
    members.forEach(member => owner.set(member, clusters.length)); clusters.push(members);
  }
  const parents = clusters.map(() => new Set());
  for (const r of relations) if (owner.has(r.from) && owner.has(r.to) && owner.get(r.from) !== owner.get(r.to)) parents[owner.get(r.to)].add(owner.get(r.from));
  const ranks = new Map(), rank = index => {
    if (!ranks.has(index)) ranks.set(index, Math.max(0, ...[...parents[index]].map(parent => rank(parent) + 1)));
    return ranks.get(index);
  };
  const layers = [];
  for (const c of components) { const level = rank(owner.get(c.id)); (layers[level] ||= []).push(c); }
  return layers;
}
function graph(components) {
  const wrap = el('div', undefined, 'architecture-map'), canvas = el('div', undefined, 'graph'), ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const allRelations = state.spec.relations, visible = r => r.state === 'both' || r.state === version;
  const make = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, value); if (text !== undefined) n.textContent = text; return n; };
  const measure = document.createElement('canvas').getContext('2d');
  if (measure) measure.font = `600 15px ${getComputedStyle(document.body).fontFamily}`;
  const lines = (text, limit = 43) => {
    const result = []; let line = '';
    const fits = value => value.length <= limit && (!measure || measure.measureText(value).width <= limit * 7.1);
    for (const word of text.trim().split(/\s+/)) {
      if (line && !fits(line + ' ' + word)) { result.push(line); line = ''; }
      let chunk = '';
      for (const character of word) {
        if (chunk && !fits(chunk + character)) { if (line) { result.push(line); line = ''; } result.push(chunk); chunk = ''; }
        chunk += character;
      }
      if (line && !fits(line + ' ' + chunk)) { result.push(line); line = ''; }
      line += (line ? ' ' : '') + chunk;
    }
    if (line) result.push(line); return result;
  };
  const textBlock = (parent, text, x, y, cls, limit = 43) => {
    const parts = lines(text, limit), node = make('text', { x, y, class: cls });
    parts.forEach((line, i) => node.append(make('tspan', { x, dy: i ? 17 : 0 }, line + (i < parts.length - 1 ? ' ' : '')))); parent.append(node); return parts.length * 17;
  };
  const names = new Map(components.map(c => [c.id, c.name]));
  const layers = architectureLayers(components, allRelations), positions = new Map();
  const nodeWidth = 210, columnStep = 245, columns = Math.min(3, Math.max(1, ...layers.map(l => l.length))), width = columns * columnStep + 45;
  const notices = [state.spec.intent, 'Flow runs top to bottom · arrows show calls / data movement', 'Blue: changed responsibility · dashed: version-only flow'];
  if (!state.report.fresh) notices.push('Warning: source binding stale');
  if (state.report.uncovered?.length) notices.push(`Warning: ${state.report.uncovered.length} changed files are unexplained`);
  if (state.report.staleEvidence?.length) notices.push(`Warning: ${state.report.staleEvidence.length} evidence records are stale`);
  const unverified = state.spec.evidence.filter(e => e.status !== 'supported');
  if (unverified.length || !state.spec.evidence.length) notices.push(`Evidence: ${unverified.length || 'no recorded'} claims need verification`);
  for (const d of state.spec.decisions.filter(d => d.status !== 'accepted' || d.provenance !== 'human')) notices.push('Decision needed: ' + d.title);
  for (const question of state.spec.unknowns) notices.push('Open question: ' + question);
  if (state.report.error) notices.push('Warning: ' + state.report.error);
  const headerLimit = Math.floor((width - 50) / 7.1);
  let y = 25;
  y += textBlock(svg, state.spec.title, 20, y, 'map-title', headerLimit) + 8;
  for (const notice of notices) y += textBlock(svg, notice, 20, y, notice.startsWith('Warning') || notice.startsWith('Open question') || notice.startsWith('Decision needed') ? 'map-warning' : 'map-legend', headerLimit) + 5;
  y += 25;
  // Reserve flow lanes using both versions. Nodes remain stable when comparing views.
  for (const layer of layers) for (let offset = 0; offset < layer.length; offset += 3) {
    const row = layer.slice(offset, offset + 3); let height = 0, laneHeight = 0;
    row.forEach((c, column) => {
      const metadata = [c.kind, c.technology].filter(Boolean).join(' · ') || 'Type / technology not recorded';
      const h = 42 + lines(c.name, 24).length * 17 + lines(metadata, 25).length * 17;
      const contracts = allRelations.filter(r => r.from === c.id);
      const lanes = contracts.map(r => 20 + lines(r.label, 26).length * 17 + (r.protocol ? lines(r.protocol, 26).length * 17 : 0));
      positions.set(c.id, { x: 20 + column * columnStep, y, height: h, contracts, lanes, metadata });
      height = Math.max(height, h); laneHeight = Math.max(laneHeight, lanes.reduce((a, b) => a + b, 0));
    });
    row.forEach(c => { positions.get(c.id).rowBottom = y + height; });
    y += height + Math.max(70, laneHeight + 40);
  }
  svg.setAttribute('viewBox', `0 0 ${width} ${y + 20}`); svg.style.width = `${width}px`;
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${version} architecture map`);
  const defs = make('defs', {}), marker = make('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
  marker.append(make('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#58718d' })); defs.append(marker); svg.append(defs);
  const edges = make('g', { class: 'map-edges' }), labels = make('g', { class: 'flow-labels' }); svg.append(edges);
  for (const c of components) {
    const p = positions.get(c.id); let laneY = p.rowBottom + 25;
    p.contracts.forEach((r, slot) => {
      const labelY = laneY; laneY += p.lanes[slot]; if (!visible(r)) return;
      const b = positions.get(r.to); if (!b) return;
      const sourceX = p.x + nodeWidth / 2, targetX = b.x + nodeWidth / 2, routeY = labelY + p.lanes[slot] - 10 + (allRelations.indexOf(r) % 5) * 4;
      let path;
      const skipsStage = [...positions.values()].some(other => other.y > p.y && other.y < b.y);
      if (b.y > p.y && !skipsStage) path = `M ${sourceX} ${p.y + p.height} V ${routeY} H ${targetX} V ${b.y}`;
      else {
        const track = width - 22 + (allRelations.indexOf(r) % 3) * 6;
        path = `M ${sourceX} ${p.y + p.height} V ${routeY} H ${track} V ${b.y - 12} H ${targetX} V ${b.y}`;
      }
      const edge = make('g', { 'data-edge': r.id });
      edge.append(make('title', {}, `${c.name} → ${names.get(r.to)}: ${r.label}${r.failure ? ' · On failure: ' + r.failure : ''}`), make('path', { d: path, class: `edge ${r.state !== 'both' ? 'version-edge' : ''}`, 'marker-end': 'url(#arrow)' })); edges.append(edge);
      const label = make('g', { 'data-relation': r.id, class: 'flow-contract' });
      label.append(make('rect', { x: p.x, y: labelY - 14, width: nodeWidth, height: p.lanes[slot] - 9, rx: 4, class: 'flow-label-background' }));
      let cursor = labelY; cursor += textBlock(label, r.label, p.x + 8, cursor, 'contract-label', 26);
      if (r.protocol) textBlock(label, r.protocol, p.x + 8, cursor, 'component-meta', 26);
      labels.append(label);
    });
  }
  svg.append(labels);
  for (const c of components) {
    const p = positions.get(c.id), changed = c.current.trim() !== c.intended.trim();
    const g = make('g', { role: 'button', tabindex: '0', 'aria-label': `Inspect ${c.name}`, class: `${changed ? 'changed' : ''} ${selected === c.id ? 'selected' : ''}`, 'data-concept': c.id });
    g.append(make('title', {}, [c[version], c.boundary && 'Boundary: ' + c.boundary, c.risk && 'Risk: ' + c.risk].filter(Boolean).join(' · ')));
    g.append(make('rect', { x: p.x, y: p.y, width: nodeWidth, height: p.height, rx: 10, class: 'component-card' }));
    let cursor = p.y + 25; cursor += textBlock(g, c.name, p.x + 12, cursor, 'component-name', 24) + 4;
    cursor += textBlock(g, p.metadata, p.x + 12, cursor, 'component-meta', 25) + 4;
    if (changed) textBlock(g, 'Changed', p.x + 12, cursor, 'component-change', 25);
    g.onclick = () => choose(c.id); g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(c.id); } }; svg.append(g);
  }
  canvas.append(svg); wrap.append(canvas); return wrap;
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
