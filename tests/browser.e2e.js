import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { startServer, sessionRequest, fixture, jsonWrite, project } from './helpers.js';
import { join } from 'node:path';

test('browser author: explore, send feedback, receive agent revision, accept, request implementation', async t => {
  const f = fixture(t), sessionPath = join(f.repo, '.navocode/local/session.json');
  const { server, session } = await startServer({ specPath: f.path, repo: f.repo, sessionPath });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(session.url); await page.getByRole('heading', { name: f.spec.title }).waitFor();
  assert.equal(await page.locator('#decisions').evaluate(n => n === document.querySelector('#content').firstElementChild), true);
  await page.getByRole('heading', { name: 'Assurance', exact: true }).waitFor();
  assert.equal(await page.locator('[role=tab]').count(), 0);
  await page.locator('.responsibility').getByText(f.spec.components[0].current, { exact: true }).waitFor();
  await page.locator('.responsibility').getByText(f.spec.components[0].intended, { exact: true }).waitFor();
  await page.screenshot({ path: '/tmp/navocode-review-preview.png' });
  await page.getByRole('button', { name: 'Inspect Billing service' }).click();
  await page.locator('.responsibility').getByText(f.spec.components[0].intended, { exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Billing service', exact: true }).waitFor();
  await page.getByLabel('Describe a question or architectural change').fill('Keep eligibility in authorization and charging in billing.');
  await page.getByRole('button', { name: 'Suggest change', exact: true }).click();
  const event = (await sessionRequest(sessionPath, '/api/feedback?wait=2')).events[0];
  assert.equal(event.target, 'billing'); assert.equal(event.action, 'change');
  f.spec.components[2].intended = 'Own charging and delegate eligibility to authorization.'; jsonWrite(f.path, f.spec);
  await sessionRequest(sessionPath, '/api/ack', { id: event.id, message: 'Billing now delegates eligibility to authorization.' });
  await page.getByText('Billing now delegates eligibility to authorization.', { exact: true }).waitFor();
  await page.locator('.responsibility').getByText(f.spec.components[2].intended, { exact: true }).waitFor();
  f.spec.decisions[0].status = 'proposed'; f.spec.decisions[0].provenance = 'agent'; jsonWrite(f.path, f.spec);
  await page.waitForFunction(() => document.querySelector('[data-action=implement]').disabled);
  await page.getByRole('button', { name: 'Accept design', exact: true }).click();
  const accepted = (await sessionRequest(sessionPath, '/api/feedback?wait=2')).events[0]; assert.equal(accepted.action, 'accept');
  f.spec.decisions[0].status = 'accepted'; f.spec.decisions[0].provenance = 'human'; jsonWrite(f.path, f.spec);
  await sessionRequest(sessionPath, '/api/ack', { id: accepted.id, message: 'Design accepted.' });
  await page.waitForFunction(() => !document.querySelector('[data-action=implement]').disabled);
  await page.getByRole('button', { name: 'Implement accepted design', exact: true }).click();
  assert.equal((await sessionRequest(sessionPath, '/api/feedback?wait=2')).events[0].action, 'implement');
  await page.screenshot({ path: '/tmp/navocode-author-test.png', fullPage: true });
  assert.deepEqual(errors, []);
});

test('browser reviewer: compare edits, publish intent, no direct implementation action, safe text rendering', async t => {
  const f = fixture(t), sessionPath = join(f.repo, '.navocode/local/session.json'), baseline = join(f.repo, '.navocode/local/baseline.json'); jsonWrite(baseline, f.spec);
  const { server, session } = await startServer({ specPath: f.path, repo: f.repo, mode: 'review', sessionPath, baselinePath: baseline });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(session.url); await page.getByRole('heading', { name: f.spec.title }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Implement accepted design' }).count(), 0);
  f.spec.decisions[0].choice = 'A dedicated boundary owns policy <img src=x onerror=alert(1)>.'; jsonWrite(f.path, f.spec);
  await page.getByRole('link', { name: 'Proposed edits' }).click();
  await page.getByText(f.spec.decisions[0].choice, { exact: true }).first().waitFor();
  assert.equal(await page.locator('#content img').count(), 0);
  await page.getByRole('button', { name: 'Publish proposal' }).click();
  assert.equal((await sessionRequest(sessionPath, '/api/feedback?wait=2')).events[0].action, 'publish');
  // Long contracts stay readable, and dependency cycles/self-loops remain navigable.
  const longContract = 'POST revision-bound feedback to the local HTTP transport with human decision context and idempotent event acknowledgement';
  f.spec.relations.push({ id: 'feedback-return', from: 'billing', to: 'clients', label: longContract, state: 'intended' });
  f.spec.relations.push({ id: 'billing-loop', from: 'billing', to: 'billing', label: 'Retry pending feedback', state: 'intended' });
  f.spec.components.push({ id: 'audit', name: 'Independent audit adapter', current: 'Read local state.', intended: 'Inspect persisted events without owning policy.', observed: '' });
  jsonWrite(f.path, f.spec);
  await page.locator('.graph').getByText(longContract, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Inspect Independent audit adapter' }).waitFor();
  await page.locator('.graph').getByText('0 incoming · 0 outgoing mapped connections',{exact:true}).waitFor();
  assert.equal(await page.locator('.graph svg .component-node').count(), 4);
  await page.getByRole('button', { name: 'Before', exact: true }).click();
  assert.equal(await page.locator('.graph').getByText(longContract, { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Intended', exact: true }).click();
  await page.locator('.graph').getByText(longContract, { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.locator('body').evaluate(el => el.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: '/tmp/navocode-review-mobile-test.png', fullPage: true });
});


test('holistic flow uses compact nodes and labeled connections with stable positions', async t => {
  const f = fixture(t), sessionPath = join(f.repo, '.navocode/local/session.json');
  Object.assign(f.spec.components[2], { kind: 'component', technology: 'Python', boundary: 'Local billing policy', risk: 'Delegated payer may be ineligible.' });
  Object.assign(f.spec.relations[1], { protocol: 'In-process call', failure: 'Reject an ineligible delegated payer.' });
  f.spec.decisions[0].status = 'proposed'; f.spec.decisions[0].provenance = 'agent';
  f.spec.unknowns = ['How do existing clients migrate?'];
  f.spec.evidence[0].status = 'unverified'; jsonWrite(f.path, f.spec);
  const { server, session } = await startServer({ specPath: f.path, repo: f.repo, sessionPath });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(session.url); await page.getByRole('heading', { name: f.spec.title }).waitFor();
  const graph = page.locator('.graph');
  for (const text of [f.spec.title, f.spec.intent, 'component · Python', 'Delegated payer', 'In-process call', 'Decision needed: Who owns eligibility policy?', 'Open question: How do existing clients migrate?', 'Evidence: 1 claims need verification']) await graph.getByText(text, { exact: true }).first().waitFor();
  assert.ok(await graph.getByText('Changed', { exact: true }).count());
  await graph.getByText('Group sources: JavaScript', {exact:true}).first().waitFor();
  assert.equal(await graph.getByText('Type / technology not recorded', {exact:true}).count(), 0);
  assert.equal(await graph.getByText('Previously: ' + f.spec.components[2].current, { exact: true }).count(), 0);
  assert.equal(await graph.locator('.component-node .contract-label').count(), 0);
  assert.equal(await graph.locator('.map-edges [data-edge]').count(), f.spec.relations.filter(r => r.state !== 'current').length);
  assert.equal(await page.locator('.graph-contracts').count(), 0);
  const positions = () => graph.locator('[data-concept] > .component-card').evaluateAll(nodes => nodes.map(n => ['x', 'y', 'height'].map(key => n.getAttribute(key))));
  const intendedPositions = await positions();
  assert.ok(intendedPositions.every(p => Number(p[2]) < 150), 'ordinary nodes stay compact');
  await page.getByRole('button', { name: 'Before', exact: true }).click();
  assert.deepEqual(await positions(), intendedPositions);
  assert.equal(await graph.getByText('Delegated payer', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Intended', exact: true }).click();
  assert.deepEqual(await positions(), intendedPositions);
  f.spec.relations[1].label = 'W'.repeat(120); jsonWrite(f.path, f.spec);
  await graph.locator('[data-relation="account-billing"] .contract-label').filter({ hasText: 'WWW' }).waitFor();
  const overflow = await graph.locator('.component-node').evaluateAll(nodes => nodes.some(n => {
    const card = n.querySelector('.component-card').getBBox();
    return [...n.querySelectorAll('text')].some(t => { const b = t.getBBox(); return b.x < card.x || b.x + b.width > card.x + card.width || b.y + b.height > card.y + card.height; });
  }));
  assert.equal(overflow, false);
  assert.deepEqual(errors, []);
});

test('review scenarios: success, failure and retry traces preserve context and expose evidence', async t => {
  const f=fixture(t), sessionPath=join(f.repo,'.navocode/local/session.json');
  f.spec.relations.push(
    {id:'result',from:'billing',to:'accounts',label:'Return the billing result',state:'intended'},
    {id:'response',from:'accounts',to:'clients',label:'Return the response',state:'both'},
    {id:'rejected',from:'billing',to:'accounts',label:'Reject the delegated payer',state:'intended'},
    {id:'retry',from:'accounts',to:'accounts',label:'Retry the billing request',state:'intended'});
  Object.assign(f.spec.relations[1],{protocol:'HTTPS',failure:'Reject an ineligible payer.',paths:['billing.js'],evidenceIds:['source-check'],decisionIds:['policy-owner']});
  const step=(id,relationId)=>({id,relationId});
  const first=step('request','client-account'), call={...step('bill','account-billing'), description:'Choose the delegated payer before charging the account.'}, result=step('result','result'), response=step('response','response');
  f.spec.scenarios=[
    {id:'success',title:'Billing succeeds',trigger:'The client submits an account.',outcome:'The client receives a billing result.',current:[first,response],intended:[first,call,result,response]},
    {id:'failure',title:'Billing rejects the payer',trigger:'The client submits an ineligible payer.',outcome:'The client receives a rejection.',current:[],intended:[first,call,step('reject','rejected'),response]},
    {id:'retry-flow',title:'Billing retries once',trigger:'The first attempt cannot complete.',outcome:'The client receives the next result.',current:[],intended:[first,step('retry-1','retry'),step('retry-2','retry'),call,result,response]}];
  jsonWrite(f.path,f.spec);
  const {server,session}=await startServer({specPath:f.path,repo:f.repo,sessionPath});t.after(()=>{server.closeAllConnections();server.close();});
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:1100}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(session.url);await page.getByRole('heading',{name:f.spec.title}).waitFor();
  await page.locator('.scenario-graph').waitFor();assert.equal(await page.locator('.flow-step').count(),4);assert.equal(await page.locator('.flow-step.changed').count(),3);
  await page.locator('.scenario-graph').getByText('Who does what',{exact:true}).waitFor();
  await page.locator('.scenario-graph .component-node').getByText(f.spec.components[2].intended,{exact:true}).waitFor();
  const billingStep=page.locator('.flow-step[data-relation=account-billing]');
  for (const value of ['Choose the delegated payer before charging the account.','Transport: HTTPS','On failure: Reject an ineligible payer.','Source: billing.js','Evidence (supported): Delegation preserves fallback.',`Decision: ${f.spec.decisions[0].title} — ${f.spec.decisions[0].choice}`]) {
    await billingStep.getByText(value,{exact:true}).waitFor();
  }
  assert.ok(await billingStep.getByText('Added step',{exact:true}).count());
  assert.equal(await page.locator('.flow-step').evaluateAll(nodes=>nodes.some(n=>{const box=n.querySelector('.step-background').getBBox();return [...n.querySelectorAll('text')].some(t=>{const b=t.getBBox();return b.y+b.height>box.y+box.height;});})),false,'Desktop explanations stay inside their cards');
  await page.screenshot({path:'/tmp/navocode-helpful-flow-desktop.png',fullPage:true});
  const geometry=()=>page.locator('.scenario-graph .component-card').evaluateAll(ns=>ns.map(n=>['x','y','height'].map(k=>n.getAttribute(k))));const intended=await geometry();
  await page.getByRole('button',{name:'Next step',exact:true}).click();await page.getByText('Step 1 of 4',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Next step',exact:true}).click();await page.locator('#contract-details').getByText('Protocol: HTTPS',{exact:true}).waitFor();
  await page.locator('#contract-details').getByText('On failure: Reject an ineligible payer.',{exact:true}).waitFor();await page.locator('#contract-details').getByText('billing.js',{exact:true}).waitFor();await page.locator('#contract-details').getByText('Delegation preserves fallback.',{exact:true}).waitFor();
  assert.equal(await page.locator('.trace-active').count(),1);
  f.spec.evidence[0].status='unverified';jsonWrite(f.path,f.spec);await page.locator('#contract-details').getByText('unverified',{exact:true}).waitFor();
  await page.getByLabel('Describe a question or architectural change').fill('Why can this payer fail?');await page.getByRole('button',{name:'Ask a question',exact:true}).click();
  const event=(await sessionRequest(sessionPath,'/api/feedback?wait=0')).events[0];assert.equal(event.target,'account-billing');assert.match(event.text,/Billing succeeds, Intended, step 2/);await sessionRequest(sessionPath,'/api/ack',{id:event.id,message:'The billing policy checks eligibility.'});
  await page.getByRole('button',{name:'Before',exact:true}).click();assert.equal(await page.locator('.flow-step').count(),2);assert.deepEqual(await geometry(),intended);
  await page.getByRole('button',{name:'Intended',exact:true}).click();
  await page.getByLabel('Execution scenario').selectOption('failure');assert.equal(await page.locator('.flow-step').count(),4);await page.locator('.scenario-graph').getByText('3. Reject the delegated payer',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Before',exact:true}).click();await page.locator('.scenario-graph').getByText('No Before steps recorded for this scenario.',{exact:true}).waitFor();assert.equal(await page.locator('.flow-step').count(),0);
  await page.getByRole('button',{name:'Intended',exact:true}).click();await page.getByLabel('Execution scenario').selectOption('retry-flow');assert.equal(await page.locator('.flow-step').count(),6);
  await page.getByRole('button',{name:'Step 3: Retry the billing request',exact:true}).focus();await page.keyboard.press('Enter');await page.getByText('Step 3 of 6',{exact:true}).waitFor();
  await page.getByLabel('Describe a question or architectural change').fill('Does this retry duplicate state?');await page.getByRole('button',{name:'Ask a question',exact:true}).click();
  const retryEvent=(await sessionRequest(sessionPath,'/api/feedback?wait=0')).events[0];assert.equal(retryEvent.target,'retry');assert.match(retryEvent.text,/Billing retries once, Intended, step 3/);await sessionRequest(sessionPath,'/api/ack',{id:retryEvent.id,message:'This is the second recorded retry.'});
  await page.getByRole('button',{name:'Show full flow',exact:true}).click();assert.equal(await page.locator('.trace-active').count(),0);
  f.spec.relations[1].label='<img src=x onerror=alert(1)> '+ 'W'.repeat(120);jsonWrite(f.path,f.spec);await page.locator('.scenario-graph').getByText('4. '+f.spec.relations[1].label,{exact:true}).waitFor();assert.equal(await page.locator('.scenario-graph img').count(),0);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth+1));
  await page.locator('.compact-flow').waitFor();
  assert.ok(await page.locator('.scenario-graph').evaluate(el=>el.scrollWidth<=el.clientWidth+1), 'The complete flow must fit without horizontal panning.');
  assert.equal(await page.locator('.flow-endpoint').count(),12);
  await page.locator('.scenario-graph .component-node').getByText(f.spec.components[2].intended,{exact:true}).waitFor();
  await page.screenshot({path:'/tmp/navocode-helpful-flow-mobile.png',fullPage:true});
  assert.equal(await page.locator('.flow-step').evaluateAll(nodes=>nodes.some(n=>{const box=n.querySelector('.step-background').getBBox();return [...n.querySelectorAll('text')].some(t=>{const b=t.getBBox();return b.y+b.height>box.y+box.height;});})),false,'Step explanations stay inside their cards');
  assert.ok(await page.locator('.scenario-graph').evaluate(el=>[...el.querySelectorAll('text')].every(n=>{const r=n.getBoundingClientRect(), box=el.getBoundingClientRect();return r.left>=box.left-1 && r.right<=box.right+1;})), 'Every flow label must stay visible.');
  await page.getByRole('button',{name:'Next step',exact:true}).click();await page.getByText('Step 1 of 6',{exact:true}).waitFor();
  await page.setViewportSize({width:1440,height:1100});await page.locator('.scenario-graph:not(.compact-flow)').waitFor();
  assert.equal(await page.locator('.trace-active').count(),1);
  assert.ok(await page.locator('.scenario-graph').evaluate(el=>el.scrollWidth<=el.clientWidth+1));

  await page.getByLabel('Execution scenario').selectOption('');await page.locator('.flow-contract').first().click();await page.locator('#contract-details h3').waitFor();
  await page.getByRole('link',{name:'Architecture',exact:true}).click();await page.reload();await page.locator('.scenario-graph').waitFor();assert.equal(await page.locator('#error').isVisible(),false);
  assert.deepEqual(errors,[]);
});


test('workspace chat resumes its original conversation after idle, displays failures, and retries without a parent poll', async t => {
  const f=fixture(t), sessionPath=join(f.repo,'.navocode/local/session.json');
  const originalId='00000000-0000-0000-0000-000000000123';
  jsonWrite(join(f.repo,'.navocode/local/fake-chat.json'),{id:originalId,originalContext:'The original chat chose authorization as the policy owner.'});
  const {server,session}=await startServer({specPath:f.path,repo:f.repo,sessionPath,agent:'custom',agentSession:originalId,agentCommand:['python3',join(project,'tests/fake_agent.py')]});
  t.after(()=>{server.closeAllConnections();server.close();});
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(session.url);await page.getByRole('heading',{name:f.spec.title}).waitFor();
  await page.locator('#connection').getByText('Agent ready',{exact:true}).waitFor();
  const send=async text=>{await page.getByLabel('Describe a question or architectural change').fill(text);await page.getByRole('button',{name:'Ask a question',exact:true}).click();};
  await send('First question');await page.locator('#messages').getByText('Reply: First question',{exact:true}).waitFor();
  await page.locator('#connection').getByText('Agent ready',{exact:true}).waitFor();
  await send('Second question');await page.locator('#messages').getByText('Reply: Second question | Previous reply: Reply: First question',{exact:true}).waitFor();
  await send('Recall original conversation');await page.locator('#messages').getByText('The original chat chose authorization as the policy owner.',{exact:true}).waitFor();
  assert.equal(session.agentSession,originalId);
  await send('fail once');await page.locator('#connection').getByText('Agent needs attention',{exact:true}).waitFor();
  await page.locator('#messages').getByText('custom could not complete this message. The original chat may be busy or unavailable. Check its session ID, CLI sign-in, usage limits, and permissions, then retry.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Retry message',exact:true}).click();
  await page.locator('#messages .message:not(.human)').filter({hasText:'Reply: fail once'}).waitFor();
  assert.equal(await page.locator('#messages .message.human').count(),4);
  assert.equal(await page.getByRole('button',{name:'Retry message',exact:true}).count(),0);
  await page.getByRole('button',{name:'Finish session',exact:true}).click();
  await page.locator('#connection').getByText('Session finished',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Ask a question',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Implement accepted design',exact:true}).isDisabled(),true);
  assert.deepEqual(errors,[]);
});
