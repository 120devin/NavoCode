const $ = selector => document.querySelector(selector);
const hashToken = location.hash.slice(1);
const token = /^[a-f0-9]{48}$/.test(hashToken) ? hashToken : sessionStorage.getItem('navocode-token');
if (token) { sessionStorage.setItem('navocode-token', token); if (hashToken === token) history.replaceState(null, '', '/'); }
let state, selected = null, version = 'intended', lastSignature = '', scenarioId = null, traceIndex = -1;
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
const error = message => { $('#error').textContent = message; $('#error').hidden = !message; };
async function api(path, body) {
  const response = await fetch('/api/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw Error(data.error); return data;
}
const badge = (text, type = '') => el('span', text, `badge ${type}`);
function list(items) { const ul = el('ul'); for (const item of items) ul.append(el('li', item)); return ul; }
function panel(title, id) { const node = el('section', undefined, 'panel'); if (id) node.id = id; node.append(el('h2', title)); return node; }
function targetLabel() { const item = ['components', 'decisions', 'groups', 'relations', 'scenarios'].flatMap(k => state.spec[k] || []).find(x => x.id === selected); return item?.name || item?.title || item?.label || 'Whole change'; }

function choose(id, focus = true) {
  selected = id;
  $('#feedback-target').textContent = targetLabel(); $('#clear-target').hidden = !selected;
  document.querySelectorAll('[data-concept]').forEach(n => n.classList.toggle('selected', n.dataset.concept === selected));
  renderContractDetails();
  const steps = state.spec.scenarios?.find(s => s.id === scenarioId)?.[version] || [];
  document.querySelectorAll('[data-trace]').forEach(b => { b.disabled = b.dataset.trace === '-1' ? traceIndex <= 0 : traceIndex >= steps.length - 1 || !steps.length; });
  if ($('#trace-status')) $('#trace-status').textContent = traceIndex < 0 ? 'Full flow' : `Step ${traceIndex + 1} of ${steps.length}`;
  document.querySelectorAll('[data-step-index]').forEach(n => { n.classList.toggle('trace-active', Number(n.dataset.stepIndex) === traceIndex); n.classList.toggle('trace-muted', traceIndex >= 0 && Number(n.dataset.stepIndex) !== traceIndex); });
  // Preserve the page position and every review section when selecting feedback context.
  if (focus) $('#feedback').focus({ preventScroll: true });
}
function discuss(id, name) { const b = el('button', name || 'Discuss', 'quiet'); b.onclick = () => choose(id); return b; }
function render() {
  const { spec, report, mode } = state;
  if (selected && !['components', 'decisions', 'groups', 'relations', 'scenarios'].some(k => (spec[k] || []).some(x => x.id === selected))) selected = null;
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
  implement.disabled = pending.length > 0 || state.agent?.status === 'finished';
  implement.title = pending.length ? 'Accept architectural decisions before requesting implementation.' : '';
  $('#proposal-link').hidden = !state.baseline;
  if (scenarioId === null) scenarioId = spec.scenarios?.[0]?.id || '';
  if (scenarioId && !spec.scenarios?.some(s => s.id === scenarioId)) { scenarioId = ''; traceIndex = -1; }
  const flow = spec.scenarios?.find(s => s.id === scenarioId);
  if (traceIndex >= (flow?.[version]?.length || 0)) traceIndex = -1;
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
// Prefer authored facts. File extensions describe source languages, not runtime guesses.
function componentMetadata(component) {
  const explicit = [component.kind, component.technology].filter(Boolean);
  if (component.technology) return explicit.join(' · ');
  const groups = state.spec.groups.filter(g => g.componentIds.includes(component.id));
  const paths = [...new Set(groups.flatMap(g => g.paths))];
  const languages = {js:'JavaScript',mjs:'JavaScript',cjs:'JavaScript',jsx:'JavaScript',ts:'TypeScript',tsx:'TypeScript',py:'Python',go:'Go',rs:'Rust',java:'Java',kt:'Kotlin',swift:'Swift',rb:'Ruby',php:'PHP',cs:'C#',cpp:'C++',c:'C',html:'HTML',css:'CSS',sql:'SQL',sh:'Shell'};
  const sourceLanguages = [...new Set(paths.map(path => languages[path.split('.').pop().toLowerCase()]).filter(Boolean))];
  if (sourceLanguages.length) explicit.push('Group sources: ' + sourceLanguages.join(', '));
  else if (groups.length) explicit.push('Area: ' + groups.map(g => g.title).join(', '));
  else {
    const incoming = state.spec.relations.filter(r => r.to === component.id).length;
    const outgoing = state.spec.relations.filter(r => r.from === component.id).length;
    explicit.push(`${incoming} incoming · ${outgoing} outgoing mapped connections`);
  }
  return explicit.join(' · ');
}
function stepNotes(step, relation) {
  const notes = [];
  if (step.description) notes.push([step.description, 'component-responsibility']);
  if (relation.protocol) notes.push(['Transport: ' + relation.protocol, 'component-meta']);
  if (relation.failure) notes.push(['On failure: ' + relation.failure, 'map-warning']);
  if (relation.paths?.length) notes.push(['Source: ' + relation.paths.join(', '), 'component-meta']);
  const evidence = state.spec.evidence.filter(e => relation.evidenceIds?.includes(e.id));
  for (const e of evidence) notes.push([`Evidence (${e.status}${state.report.staleEvidence?.includes(e.id) ? ', stale' : ''}): ${e.claim}`, e.status === 'supported' && !state.report.staleEvidence?.includes(e.id) ? 'component-meta' : 'map-warning']);
  if (!evidence.length) notes.push(['Evidence: no checks linked to this step', 'map-warning']);
  for (const d of state.spec.decisions.filter(d => relation.decisionIds?.includes(d.id))) notes.push([`${d.status === 'accepted' && d.provenance === 'human' ? 'Decision' : 'Decision needed'}: ${d.title} — ${d.choice}`, d.status === 'accepted' && d.provenance === 'human' ? 'component-meta' : 'map-warning']);
  return notes;
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
      const metadata = componentMetadata(c);
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
      const label = make('g', { 'data-relation': r.id, 'data-concept': r.id, role: 'button', tabindex: '0', 'aria-label': `Inspect contract: ${r.label}`, class: 'flow-contract' });
      label.onclick = () => choose(r.id, false); label.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(r.id, false); } };
      label.append(make('rect', { x: p.x, y: labelY - 14, width: nodeWidth, height: p.lanes[slot] - 9, rx: 4, class: 'flow-label-background' }));
      let cursor = labelY; cursor += textBlock(label, r.label, p.x + 8, cursor, 'contract-label', 26);
      if (r.protocol) textBlock(label, r.protocol, p.x + 8, cursor, 'component-meta', 26);
      labels.append(label);
    });
  }
  svg.append(labels);
  for (const c of components) {
    const p = positions.get(c.id), changed = c.current.trim() !== c.intended.trim();
    const g = make('g', { role: 'button', tabindex: '0', 'aria-label': `Inspect ${c.name}`, class: `component-node ${changed ? 'changed' : ''} ${selected === c.id ? 'selected' : ''}`, 'data-concept': c.id });
    g.append(make('title', {}, [c[version], c.boundary && 'Boundary: ' + c.boundary, c.risk && 'Risk: ' + c.risk].filter(Boolean).join(' · ')));
    g.append(make('rect', { x: p.x, y: p.y, width: nodeWidth, height: p.height, rx: 10, class: 'component-card' }));
    let cursor = p.y + 25; cursor += textBlock(g, c.name, p.x + 12, cursor, 'component-name', 24) + 4;
    cursor += textBlock(g, p.metadata, p.x + 12, cursor, 'component-meta', 25) + 4;
    if (changed) textBlock(g, 'Changed', p.x + 12, cursor, 'component-change', 25);
    g.onclick = () => choose(c.id); g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(c.id); } }; svg.append(g);
  }
  canvas.append(svg); wrap.append(canvas); return wrap;
}

function scenarioGraph(scenario) {
  const ns = 'http://www.w3.org/2000/svg', canvas = el('div', undefined, 'graph scenario-graph');
  const make = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, value); if (text !== undefined) n.textContent = text; return n; };
  const measure = document.createElement('canvas').getContext('2d'); if (measure) measure.font = `600 15px ${getComputedStyle(document.body).fontFamily}`;
  const lines = (text, width) => {
    const output = []; let line = '';
    for (const word of text.trim().split(/\s+/)) {
      if (line && measure.measureText(line + ' ' + word).width > width) { output.push(line + ' '); line = ''; }
      for (const ch of (line ? ' ' : '') + word) { if (line && measure.measureText(line + ch).width > width) { output.push(line); line = ''; } line += ch; }
    }
    if (line) output.push(line); return output;
  };
  const text = (parent, value, x, y, cls, width) => {
    const chunks = lines(value, width), n = make('text', { x, y, class: cls });
    chunks.forEach((chunk, i) => n.append(make('tspan', {x, dy:i ? 17 : 0}, chunk))); parent.append(n); return chunks.length * 17;
  };
  const relations = new Map(state.spec.relations.map(r => [r.id, r]));
  const participants = [...new Set([...scenario.current, ...scenario.intended].flatMap(step => { const r = relations.get(step.relationId); return [r.from, r.to]; }))];
  // Fit the actual panel rather than forcing the reader to pan across participants.
  const width = Math.max(220, Math.floor($('#content').clientWidth - (matchMedia('(max-width:760px)').matches ? 36 : 46)));
  const compact = width < participants.length * 140 + 40, lane = (width - 40) / participants.length;
  const cardWidth = lane - 20, positions = new Map(participants.map((id, i) => [id, 30 + i * lane]));
  const name = id => state.spec.components.find(c => c.id === id).name;
  const endpointWidth = (width - 90) / 2;
  canvas.classList.toggle('compact-flow', compact);
  const svg = make('svg', {role:'img', 'aria-label':`${version} execution flow`}); svg.style.width = '100%';
  let y = 25; y += text(svg, scenario.title, 20, y, 'map-title', width - 45) + 7;
  y += text(svg, 'Trigger: ' + scenario.trigger, 20, y, 'component-responsibility', width - 45) + 5;
  y += text(svg, 'Result: ' + scenario.outcome, 20, y, 'component-responsibility', width - 45) + 15;
  y += text(svg, 'Who does what', 20, y, 'contract-label', width - 45) + 8;
  const component = id => state.spec.components.find(c => c.id === id);
  const participantLines = (id, v) => [
    [name(id), 'component-name'],
    [componentMetadata(component(id)), 'component-meta'],
    [component(id)[v] || 'Responsibility needs description', 'component-responsibility'],
    ...(component(id).boundary ? [['Boundary: ' + component(id).boundary, 'component-meta']] : [])
  ];
  const participantHeight = (id, available) => 26 + Math.max(...['current', 'intended'].map(v => participantLines(id, v).reduce((height, [value]) => height + lines(value, available).length * 17 + 5, 0)));
  if (compact) for (const id of participants) {
    const height = participantHeight(id, width - 65), g = make('g', {role:'button', tabindex:0, 'aria-label':`Inspect ${name(id)}`, 'data-concept':id, class:'component-node'});
    g.append(make('rect', {x:15, y:y-12, width:width-30, height, rx:8, class:'component-card'}));
    let cursor=y+10;
    for (const [value, cls] of participantLines(id, version)) cursor += text(g, value, 25, cursor, cls, width-65) + 5;
    g.onclick=()=>choose(id); g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(id);}}; svg.append(g); y += height + 12;
  }
  const top = y, headerHeight = compact || !participants.length ? 0 : Math.max(...participants.map(id => participantHeight(id, cardWidth - 20))); y += compact ? 15 : headerHeight + 25;
  const slots = [];
  for (let i = 0; i < Math.max(scenario.current.length, scenario.intended.length); i++) {
    const height = Math.max(...['current','intended'].map(v => {
      const step = scenario[v][i]; if (!step) return 0;
      const r = relations.get(step.relationId);
      const endpointHeight = compact ? Math.max(lines(name(r.from), endpointWidth - 16).length, lines(name(r.to), endpointWidth - 16).length) * 17 + 32 : r.from === r.to ? 45 : 25;
      return 50 + lines(r.label, width - 65).length * 17 + lines(`${name(r.from)} → ${name(r.to)}`, width - 65).length * 17 + endpointHeight + stepNotes(step, r).reduce((height, [value]) => height + lines(value, width - 65).length * 17 + 5, 0);
    }));
    slots.push({y, height}); y += height;
  }
  if (!scenario[version].length) text(svg, `No ${version === 'current' ? 'Before' : 'Intended'} steps recorded for this scenario.`, 20, (slots[0]?.y || y) + 20, 'map-warning', width - 45);
  const defs = make('defs', {}), marker = make('marker', {id:'flow-arrow', viewBox:'0 0 10 10', refX:9, refY:5, markerWidth:6, markerHeight:6, orient:'auto'}); marker.append(make('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#58718d'})); defs.append(marker); svg.append(defs);
  for (const id of compact ? [] : participants) {
    const c = state.spec.components.find(c => c.id === id), x = positions.get(id), g = make('g', {role:'button',tabindex:0,'aria-label':`Inspect ${c.name}`,'data-concept':id,class:'component-node'});
    g.append(make('line',{x1:x+cardWidth/2,x2:x+cardWidth/2,y1:top+headerHeight,y2:y,class:'flow-lifeline'}), make('rect',{x,y:top,width:cardWidth,height:headerHeight,rx:8,class:'component-card'})); let cursor=top+25;
    for (const [value, cls] of participantLines(id, version)) cursor += text(g,value,x+10,cursor,cls,cardWidth-20) + 5;
    g.onclick=()=>choose(id); g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(id);}}; svg.append(g);
  }
  scenario[version].forEach((step,i)=>{
    const r=relations.get(step.relationId), slot=slots[i], x=positions.get(r.from)+cardWidth/2, target=positions.get(r.to)+cardWidth/2;
    const otherSteps=scenario[version==='current'?'intended':'current'], otherIndex=otherSteps.findIndex(s=>s.id===step.id), other=otherSteps[otherIndex];
    const changed=other?.relationId!==step.relationId || other?.description!==step.description || (other && otherIndex!==i) || r.state!=='both';
    const changeLabel=!other ? (version==='intended' ? 'Added step' : 'Removed step') : changed ? 'Changed step' : 'Unchanged step';
    const g=make('g',{role:'button',tabindex:0,'aria-label':`Step ${i+1}: ${r.label}`,'data-concept':r.id,'data-relation':r.id,'data-step-index':i,class:`flow-step ${changed?'changed':''}`});
    g.append(make('rect',{x:15,y:slot.y-12,width:width-30,height:slot.height-10,rx:5,class:'step-background'}));
    let cursor=slot.y+5; cursor+=text(g,`${i+1}. ${r.label}`,25,cursor,'contract-label',width-65)+5;
    cursor+=text(g,changeLabel,25,cursor,changed?'component-change':'component-meta',width-65)+5;
    if (!compact) cursor+=text(g,`${name(r.from)} → ${name(r.to)}`,25,cursor,'component-meta',width-65)+5;
    if (compact) {
      const endpointHeight = Math.max(lines(name(r.from), endpointWidth-16).length, lines(name(r.to), endpointWidth-16).length) * 17 + 16;
      for (const [id, left] of [[r.from, 25], [r.to, width-25-endpointWidth]]) {
        g.append(make('rect',{x:left,y:cursor-4,width:endpointWidth,height:endpointHeight,rx:6,class:'flow-endpoint'}));
        text(g,name(id),left+8,cursor+16,'contract-label',endpointWidth-16);
      }
      g.append(make('path',{d:`M ${25+endpointWidth} ${cursor+endpointHeight/2-4} H ${width-25-endpointWidth}`,class:'edge','marker-end':'url(#flow-arrow)'}));
      cursor += endpointHeight + 16;
    } else {
    const path=x===target?`M ${x} ${cursor} h 55 v 20 h -55`:`M ${x} ${cursor} H ${target}`;
    g.append(make('path',{d:path,class:'edge','marker-end':'url(#flow-arrow)'})); cursor+=x===target?45:25;
    }
    for (const [value, cls] of stepNotes(step, r)) cursor += text(g,value,25,cursor,cls,width-65) + 5;
    g.onclick=()=>{traceIndex=i;choose(r.id,false);}; g.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();traceIndex=i;choose(r.id,false);}}; svg.append(g);
  });
  svg.setAttribute('viewBox',`0 0 ${width} ${y+20}`); canvas.append(svg); return canvas;
}
function renderContractDetails() {
  const box = $('#contract-details'); if (!box || !state) return;
  box.replaceChildren(); const r = state.spec.relations.find(r => r.id === selected);
  if (!r) { box.append(el('p','Select a connection to inspect its contract and evidence.','fine')); return; }
  const name = id => state.spec.components.find(c => c.id === id).name;
  box.append(el('h3',`${name(r.from)} → ${name(r.to)}`),el('p',r.label),el('p',`Protocol: ${r.protocol || 'Not recorded'}`),el('p',`On failure: ${r.failure || 'Not recorded'}`));
  const paths = r.paths || []; box.append(el('h4','Source references'), paths.length ? list(paths) : el('p','No source references recorded.'));
  box.append(el('h4','Evidence'));
  const evidence = state.spec.evidence.filter(e => r.evidenceIds?.includes(e.id));
  if (!evidence.length) box.append(el('p','No evidence linked to this contract.','warning-text'));
  for (const e of evidence) box.append(badge(`${e.status}${state.report.staleEvidence?.includes(e.id) ? ' · stale' : ''}`,e.status==='supported'&&!state.report.staleEvidence?.includes(e.id)?'good':'warning'),el('p',e.claim),el('p',e.detail));
  for (const d of state.spec.decisions.filter(d=>r.decisionIds?.includes(d.id))) box.append(el('h4',d.title),el('p',d.choice),discuss(d.id,'Discuss this decision'));
  box.append(discuss(r.id,'Discuss this step'));
}
function renderContent() {
  const content = $('#content'), s = state.spec; content.replaceChildren();
  const map = panel('Architecture', 'architecture'), heading = el('div', undefined, 'section-heading'), segmented = el('div', undefined, 'segmented');
  heading.append(map.firstChild);
  for (const value of ['current', 'intended']) { const b = el('button', value === 'current' ? 'Before' : 'Intended', value === version ? 'active' : ''); b.onclick = () => { version = value; traceIndex = -1; renderContent(); choose(selected, false); }; segmented.append(b); }
  heading.append(segmented); map.append(heading);
  if (s.scenarios?.length) {
    const controls = el('div', undefined, 'flow-controls'), select = el('select'); select.id = 'scenario'; select.setAttribute('aria-label','Execution scenario');
    const overview = el('option','Architecture overview'); overview.value=''; select.append(overview);
    for (const f of s.scenarios) { const option=el('option',f.title); option.value=f.id; select.append(option); }
    select.value=scenarioId || ''; select.onchange=()=>{scenarioId=select.value;traceIndex=-1;selected=null;renderContent();choose(null,false);}; controls.append(select);
    const flow=s.scenarios.find(f=>f.id===scenarioId), steps=flow?.[version] || [];
    if (flow) {
      for (const [label,delta] of [['Previous step',-1],['Next step',1]]) { const b=el('button',label); b.type='button'; b.dataset.trace=delta; b.disabled=delta<0?traceIndex<=0:traceIndex>=steps.length-1||!steps.length; b.onclick=()=>{traceIndex+=delta;selected=steps[traceIndex].relationId;renderContent();choose(selected,false);};controls.append(b); }
      const reset=el('button','Show full flow'); reset.onclick=()=>{traceIndex=-1;selected=null;renderContent();choose(null,false);};controls.append(reset);
      const status=el('span',traceIndex<0?'Full flow':`Step ${traceIndex+1} of ${steps.length}`,'fine');status.id='trace-status';status.setAttribute('role','status');controls.append(status);
      map.append(controls,el('p','Blue arrows: changed or selected steps. Select a step to inspect its contract.','fine'),scenarioGraph(flow),discuss(flow.id,'Discuss this flow'));
    } else map.append(controls,graph(s.components));
  } else if (s.components.length) map.append(graph(s.components)); else map.append(el('p', 'The agent is still mapping this architecture.'));
  map.append(el('p', 'The whole architecture stays visible. Select a concept only when you want to discuss it.', 'fine'));
  const details=el('div',undefined,'contract-details'); details.id='contract-details'; details.setAttribute('aria-live','polite'); map.append(details);
  content.append(map); renderContractDetails();
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
  if (state.report.writingWarnings?.length) { const writing=el('details'); writing.append(el('summary',`${state.report.writingWarnings.length} sentences need a length review`),el('p','These checks measure sentence length. They do not check STE compliance or technical accuracy.'),list(state.report.writingWarnings.map(w=>`${w.field}: ${w.message}`))); assurance.append(writing); }
  if (state.report.uncovered?.length) assurance.append(el('h3', 'Changes still needing explanation'), list(state.report.uncovered));
  if (s.nonGoals.length) assurance.append(el('h3', 'Out of scope'), list(s.nonGoals));
  content.append(assurance);
  if (state.baseline) renderProposal(content, s, state.baseline);
  document.querySelectorAll('[data-concept]').forEach(n => n.classList.toggle('selected', n.dataset.concept === selected));
}
function renderProposal(content, spec, baseline) {
  const section = panel('Proposed edits', 'proposal'); let count = 0;
  const display = v => v === undefined ? 'Absent' : Array.isArray(v) ? v.map(x => typeof x === 'object' ? JSON.stringify(x) : x).join('; ') || 'None' : String(v);
  const difference = (title, before, after) => { const row = el('article', undefined, 'proposal-row'); row.append(el('h3', title)); const columns = el('div', undefined, 'comparison'); const a = el('div', undefined, 'before'), b = el('div', undefined, 'after'); a.append(el('h4', 'Original PR'), el('p', display(before))); b.append(el('h4', 'Suggested'), el('p', display(after))); columns.append(a, b); row.append(columns); section.append(row); count++; };
  for (const collection of ['components', 'decisions', 'groups', 'relations', 'evidence', 'scenarios']) {
    for (const id of new Set([...(baseline[collection] || []), ...(spec[collection] || [])].map(v => v.id))) {
      const before = (baseline[collection] || []).find(x => x.id === id), after = (spec[collection] || []).find(x => x.id === id);
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
    if (event.error) p.append(el('div', event.error, 'warning-text'));
    if (event.status === 'failed' && state.agent?.mode !== 'manual' && state.agent?.status !== 'finished') {
      const retry = el('button', 'Retry message'); retry.type = 'button';
      retry.onclick = async () => { retry.disabled = true; try { await api('retry', {id:event.id}); error(''); await refresh(); } catch (e) { error(e.message); retry.disabled = false; } };
      p.append(retry);
    }
    for (const reply of state.messages.filter(m => m.eventId === event.id)) { const r = el('div', undefined, 'message'); r.append(el('small', 'Agent'), el('div', reply.text)); box.append(r); }
  }
  if (nearBottom) box.scrollTop = box.scrollHeight;
}
async function submit(action) {
  if (!state) return; let text = $('#feedback').value.trim();
  if (['change', 'ask'].includes(action) && !text) { error('Describe your question or architectural change first.'); $('#feedback').focus(); return; }
  const flow = state.spec.scenarios?.find(s => s.id === scenarioId);
  if (text && ['ask','change'].includes(action) && flow && traceIndex >= 0 && flow[version][traceIndex]?.relationId === selected) text = `[${flow.title}, ${version === 'current' ? 'Before' : 'Intended'}, step ${traceIndex + 1}] ${text}`;
  try { await api('events', { action, text, target: selected || 'whole-change', revision: state.revision }); $('#feedback').value = ''; error(''); await refresh(); } catch (e) { error(e.message); }
}
$('#feedback-form').onsubmit = e => { e.preventDefault(); submit('change'); };
document.querySelectorAll('[data-action]').forEach(b => { if (b.type !== 'submit') b.onclick = () => submit(b.dataset.action); });
$('#clear-target').onclick = () => choose(null);
async function refresh() {
  try {
    const next = await api('state'), signature = JSON.stringify([next.revision, next.events, next.messages, next.report, next.agent]); state = next;
    const status = next.agent?.status || (next.agentConnected ? 'listening' : 'offline');
    $('#connection').textContent = {ready:'Agent ready',responding:'Agent responding',error:'Agent needs attention',finished:'Session finished',listening:'Agent listening',offline:'Agent paused'}[status];
    $('#agent-status').textContent = {ready:'Messages use your configured assistant runner. The bound chat must be available to that runner.',responding:'Your assistant is handling a message. New messages will wait their turn.',error:'A message failed. Review the error below and retry when ready.',finished:'This session has finished. Start a new NavoCode session to continue.',listening:'Your assistant is listening for workspace messages.',offline:'Your assistant is paused. Messages are queued; resume this NavoCode session in your assistant to receive a reply.'}[status];
    document.querySelectorAll('[data-action]').forEach(b => { if (b.dataset.action !== 'implement') b.disabled = status === 'finished'; });
    $('#feedback').disabled = status === 'finished';
    if (signature !== lastSignature) { lastSignature = signature; render(); }
  } catch (e) { error(`Workspace unavailable: ${e.message}. Ask your agent to restart the session if needed.`); }
}
let resizeFrame;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => { if (state) { renderContent(); choose(selected, false); } });
});
await refresh(); setInterval(refresh, 1500);
