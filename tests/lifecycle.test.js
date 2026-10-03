import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fixture, cli } from './helpers.js';
import { git, headOf, jsonRead, jsonWrite, sourceDigest, readiness } from '../src/core.js';
import { prepareReview, publishProposal } from '../src/github.js';
import { createProposal, parseComment, applyProposal } from '../src/proposals.js';
import { sessionRequest } from '../src/server.js';

test('author pushes code/specs, reviewer fetches exact head, proposal is adopted and pushed to local remote', t => {
  const f = fixture(t), remote = mkdtempSync(join(tmpdir(), 'navocode-remote-'));
  t.after(() => rmSync(remote, { recursive: true, force: true })); git(remote, ['init', '--bare', '-q']);
  git(f.repo, ['checkout', '-qb', 'feature']); git(f.repo, ['add', '.']); git(f.repo, ['commit', '-qm', 'Delegated billing with architecture specs']);
  git(f.repo, ['remote', 'add', 'origin', remote]); git(f.repo, ['push', '-q', 'origin', 'feature', 'HEAD:refs/pull/7/head']);
  const initialHead = headOf(f.repo); let comments = [];
  const run = (args, input) => {
    if (args[0] === 'repo') { execFileSync('git', ['clone', '--quiet', '--no-checkout', remote, args[3]]); return ''; }
    const route = args.find(x => x.startsWith('repos/'));
    if (route?.endsWith('/pulls/7')) return JSON.stringify({ head: { sha: initialHead }, base: { sha: f.base }, state: 'open' });
    if (args[1] === 'user') return JSON.stringify({ id: 1 });
    if (args.includes('POST')) { const c = { id: 12, body: JSON.parse(input).body, user: { id: 1 }, html_url: 'https://github.com/owner/repo/pull/7#issuecomment-12' }; comments.push(c); return JSON.stringify(c); }
    if (route?.endsWith('/issues/comments/12')) return JSON.stringify(comments[0]);
    return JSON.stringify([comments]);
  };
  const review = prepareReview('https://github.com/owner/repo/pull/7', undefined, run);
  t.after(() => rmSync(review.folder, { recursive: true, force: true }));
  assert.equal(headOf(review.repo), initialHead); assert.equal(review.report.fresh, true);
  const baseline = jsonRead(review.baseline), proposed = jsonRead(review.spec);
  proposed.components.find(c => c.id === 'billing').intended = 'Reject empty delegated payer IDs and retain the current owner fallback.';
  proposed.decisions[0].choice = 'Billing validates delegated payer identity before charging.';
  const p = createProposal(baseline, proposed, review, 'Reject empty delegated billing ownership.');
  const published = publishProposal(p, run); assert.match(published.url, /issuecomment-12/);
  assert.equal(headOf(f.repo), initialHead); assert.equal(git(remote, ['rev-parse', 'refs/heads/feature']).trim(), initialHead);
  const accepted = applyProposal(jsonRead(f.path), parseComment(comments[0].body), initialHead);
  jsonWrite(f.path, accepted);
  writeFileSync(join(f.repo, 'billing.js'), "export const payer = account => { if (account.billingOwner === '') throw Error('Empty billing owner'); return account.billingOwner ?? account.owner; };\n");
  // Execute behavioral checks against the actual changed source.
  const source = readFileSync(join(f.repo, 'billing.js'), 'utf8');
  execFileSync(process.execPath, ['--input-type=module', '-e', `${source}\nimport assert from 'node:assert/strict'; assert.equal(payer({ owner: 'a' }), 'a'); assert.equal(payer({ owner: 'a', billingOwner: 'b' }), 'b'); assert.throws(() => payer({ owner: 'a', billingOwner: '' }));`]);
  accepted.sourceDigest = sourceDigest(f.repo); accepted.components.find(c => c.id === 'billing').observed = accepted.components.find(c => c.id === 'billing').intended;
  accepted.evidence[0] = { ...accepted.evidence[0], kind: 'test', detail: 'Executed Node assertions for delegated owner, owner fallback, and empty owner rejection.', sourceDigest: accepted.sourceDigest };
  jsonWrite(f.path, accepted); assert.equal(readiness(accepted, f.repo).ready, true);
  git(f.repo, ['add', '.']); git(f.repo, ['commit', '-qm', 'Adopt reviewer architecture proposal']); git(f.repo, ['push', '-q', 'origin', 'feature']);
  assert.notEqual(headOf(f.repo), initialHead); assert.equal(git(remote, ['rev-parse', 'refs/heads/feature']).trim(), headOf(f.repo));
  assert.throws(() => applyProposal(accepted, p, headOf(f.repo)), /Stale/);
});

test('detached CLI workspace starts, receives feedback through CLI, and stops', async t => {
  const f = fixture(t), started = JSON.parse(cli(['start', '--repo', f.repo, '--spec', f.path]));
  t.after(async () => { try { await sessionRequest(started.session, '/api/stop', {}); } catch {} });
  const state = await sessionRequest(started.session, '/api/state');
  await sessionRequest(started.session, '/api/events', { action: 'ask', text: 'Who owns billing?', target: 'billing', revision: state.revision });
  const received = JSON.parse(cli(['feedback', '--session', started.session, '--wait', '0'])); assert.equal(received.events[0].text, 'Who owns billing?');
  cli(['ack', '--session', started.session, '--event', received.events[0].id, '--message', 'The billing service owns billing policy.']);
  assert.equal((await sessionRequest(started.session, '/api/state')).messages.length, 1);
});

test('CLI adoption invalidates old implementation claims until reconciliation', t => {
  const f = fixture(t), next = structuredClone(f.spec); next.decisions[0].choice = 'Authorization owns policy.';
  const proposal = createProposal(f.spec, next, { headSha: headOf(f.repo) }, 'Move policy ownership.');
  const path = join(f.repo, '.navocode/proposal.json'); jsonWrite(path, proposal);
  cli(['adopt', '--repo', f.repo, '--spec', f.path, '--proposal', path]);
  const adopted = jsonRead(f.path);
  assert.ok(adopted.components.every(c => !c.observed)); assert.equal(adopted.evidence[0].status, 'unverified');
  assert.equal(readiness(adopted, f.repo).ready, false);
});
