import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { createProposal, applyProposal, parseComment, proposalComment, validateProposal } from '../src/proposals.js';
import { headOf, hash } from '../src/core.js';
import { publishProposal, readProposal } from '../src/github.js';
function proposal(t) {
  const f = fixture(t), next = structuredClone(f.spec);
  next.decisions[0].choice = 'Authorization owns policy; billing owns charging.';
  const context = { repository: 'owner/repo', number: 7, headSha: headOf(f.repo) };
  return { ...f, next, p: createProposal(f.spec, next, context, 'Centralize policy ownership.') };
}
test('proposal round trip applies architecture edits without altering baseline', t => {
  const { spec, next, p } = proposal(t);
  const result = applyProposal(spec, parseComment(proposalComment(p)), p.base.headSha);
  assert.deepEqual(result, next); assert.notEqual(spec.decisions[0].choice, result.decisions[0].choice);
});
test('stale head, spec, or semantic preconditions cannot be bypassed', t => {
  const { spec, p } = proposal(t);
  assert.throws(() => applyProposal(spec, p, 'a'.repeat(40)), /Stale/);
  const changed = structuredClone(spec); changed.intent += ' Changed'; assert.throws(() => applyProposal(changed, p, p.base.headSha), /Stale/);
  p.operations[0].expected = 'sha256:wrong'; assert.throws(() => applyProposal(spec, p, p.base.headSha), /Conflict/);
});
test('proposal operations reject unsupported targets, duplicates, oversized data and dangling references', t => {
  const { spec, p } = proposal(t);
  const bad = structuredClone(p); bad.operations[0].collection = '__proto__'; assert.throws(() => validateProposal(bad));
  const duplicate = structuredClone(p); duplicate.operations.push(duplicate.operations[0]); assert.throws(() => validateProposal(duplicate), /Duplicate/);
  const huge = structuredClone(p); huge.rationale = 'x'.repeat(30000); assert.throws(() => validateProposal(huge), /24 KiB/);
  const dangling = structuredClone(p); dangling.operations = [{ collection: 'components', id: 'billing', expected: hash(spec.components.find(x => x.id === 'billing')), value: null }];
  assert.throws(() => applyProposal(spec, dangling, p.base.headSha), /missing/);
});
test('structured comments safely round-trip HTML and code fences', t => {
  const { p } = proposal(t); p.operations[0].value.choice = '</details>```json<script>alert(1)</script>';
  assert.deepEqual(parseComment(proposalComment(p)), p);
});
test('GitHub publication verifies comment and is idempotent for the same user', t => {
  const { p } = proposal(t); let comments = [], posts = 0;
  const run = (args, input) => {
    const route = args.find(x => x.startsWith('repos/'));
    if (route?.endsWith('/pulls/7')) return JSON.stringify({ head: { sha: p.base.headSha }, state: 'open' });
    if (args[1] === 'user') return JSON.stringify({ id: 42 });
    if (args.includes('POST')) { posts++; const c = { id: 9, body: JSON.parse(input).body, user: { id: 42 }, html_url: 'https://github.com/owner/repo/pull/7#issuecomment-9' }; comments.push(c); return JSON.stringify(c); }
    if (route?.endsWith('/issues/comments/9')) return JSON.stringify(comments[0]);
    return JSON.stringify([comments]);
  };
  assert.equal(publishProposal(p, run).existing, false); assert.equal(publishProposal(p, run).existing, true); assert.equal(posts, 1);
});
test('GitHub stale heads and permission errors never report publication success', t => {
  const { p } = proposal(t);
  assert.throws(() => publishProposal(p, () => JSON.stringify({ head: { sha: 'a'.repeat(40) }, state: 'open' })), /head changed/);
  assert.throws(() => publishProposal(p, () => { throw Error('403 Forbidden'); }), /403/);
});
test('read comment validates actual PR identity and returns actual author', t => {
  const { p } = proposal(t), url = 'https://github.com/owner/repo/pull/7#issuecomment-9';
  const comment = { body: proposalComment(p), user: { login: 'reviewer' }, html_url: url, issue_url: 'https://api.github.com/repos/owner/repo/issues/7' };
  assert.equal(readProposal(url, () => JSON.stringify(comment)).author, 'reviewer');
  comment.issue_url = 'https://api.github.com/repos/owner/repo/issues/8'; assert.throws(() => readProposal(url, () => JSON.stringify(comment)), /identities/);
});

test('rationale with JSON fences cannot replace the structured payload', t => {
  const { p } = proposal(t); p.rationale = 'Example:\n```json\n{}\n```\n</details>';
  assert.deepEqual(parseComment(proposalComment(p)), p);
});

test('publication rejects structurally invalid operation values', t => {
  const { p } = proposal(t); p.operations[0].value.choice = 17;
  assert.throws(() => validateProposal(p), /Invalid proposal value/);
});
