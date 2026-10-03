import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, sessionRequest } from '../src/server.js';
import { fixture } from './helpers.js';
import { jsonWrite, hash } from '../src/core.js';
import { join } from 'node:path';
async function setup(t, mode = 'author') {
  const f = fixture(t), sessionPath = join(f.repo, '.navocode/local/session.json');
  const result = await startServer({ specPath: f.path, repo: f.repo, mode, sessionPath });
  t.after(() => { result.server.closeAllConnections(); result.server.close(); });
  return { ...f, ...result, sessionPath };
}
test('UI feedback wakes waiting agent, is redelivered until acknowledged, and refreshes design', async t => {
  const f = await setup(t);
  const waiting = sessionRequest(f.sessionPath, '/api/feedback?wait=2');
  const event = await sessionRequest(f.sessionPath, '/api/events', { action: 'change', text: 'Move policy ownership', target: 'billing', revision: hash(f.spec) });
  const received = await waiting; assert.equal(received.events[0].id, event.id);
  assert.equal((await sessionRequest(f.sessionPath, '/api/feedback?wait=0')).events.length, 1);
  f.spec.components[2].intended = 'Delegate policy and own charging.'; jsonWrite(f.path, f.spec);
  await sessionRequest(f.sessionPath, '/api/ack', { id: event.id, message: 'The design now delegates policy.' });
  const state = await sessionRequest(f.sessionPath, '/api/state');
  assert.equal(state.spec.components[2].intended, f.spec.components[2].intended);
  assert.equal(state.messages[0].text, 'The design now delegates policy.');
  assert.equal((await sessionRequest(f.sessionPath, '/api/feedback?wait=0')).events.length, 0);
});
test('unauthenticated, cross-origin, and stale feedback requests are rejected', async t => {
  const f = await setup(t);
  assert.equal((await fetch(f.session.origin + '/api/state')).status, 401);
  assert.equal((await fetch(f.session.origin + '/api/state', { headers: { Origin: 'https://evil.example', Authorization: `Bearer ${f.session.token}` } })).status, 403);
  await assert.rejects(sessionRequest(f.sessionPath, '/api/events', { action: 'change', text: 'old', target: 'all', revision: 'stale' }), /Design changed/);
});
test('review mode cannot request direct implementation and author mode cannot publish proposals', async t => {
  const f = await setup(t, 'review');
  await assert.rejects(sessionRequest(f.sessionPath, '/api/events', { action: 'implement', text: '', target: 'all', revision: hash(f.spec) }), /Reviewer sessions/);
  const a = await setup(t, 'author');
  await assert.rejects(sessionRequest(a.sessionPath, '/api/events', { action: 'publish', text: '', target: 'all', revision: hash(a.spec) }), /reviewer action/);
});
test('feedback timeout is empty and never acceptance', async t => {
  const f = await setup(t); const data = await sessionRequest(f.sessionPath, '/api/feedback?wait=0'); assert.deepEqual(data.events, []);
});
test('invalid artifact produces a recoverable API error', async t => {
  const f = await setup(t); jsonWrite(f.path, { invalid: true });
  await assert.rejects(sessionRequest(f.sessionPath, '/api/state'), /required/);
  jsonWrite(f.path, f.spec); assert.equal((await sessionRequest(f.sessionPath, '/api/state')).spec.changeId, f.spec.changeId);
});

test('acknowledgement retry is idempotent', async t => {
  const f = await setup(t);
  const event = await sessionRequest(f.sessionPath, '/api/events', { action: 'ask', text: 'Explain', target: 'all', revision: hash(f.spec) });
  const ack = { id: event.id, message: 'Explanation' };
  await sessionRequest(f.sessionPath, '/api/ack', ack); await sessionRequest(f.sessionPath, '/api/ack', ack);
  assert.equal((await sessionRequest(f.sessionPath, '/api/state')).messages.length, 1);
});
