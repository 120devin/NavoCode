import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, cli, project } from './helpers.js';
import { hash, validateSpec, sourceDigest, inspect, readiness, jsonWrite, draft, changedFiles, git } from '../src/core.js';
import { specSchema } from '../src/schema.js';

test('source bindings exclude specs and survive a source+spec commit', t => {
  const f = fixture(t), digest = sourceDigest(f.repo);
  f.spec.intent += ' More context.'; jsonWrite(f.path, f.spec);
  assert.equal(sourceDigest(f.repo), digest);
  git(f.repo, ['add', '.']); git(f.repo, ['commit', '-qm', 'Code and specs']);
  assert.equal(sourceDigest(f.repo), digest);
  assert.equal(inspect(f.spec, f.repo).fresh, true);
});
test('source changes and untracked additions invalidate binding and coverage', t => {
  const f = fixture(t); writeFileSync(join(f.repo, 'unexpected.js'), 'unrelated');
  const report = inspect(f.spec, f.repo);
  assert.equal(report.fresh, false); assert.deepEqual(report.uncovered, ['unexpected.js']);
  assert.deepEqual(report.staleEvidence, ['source-check']);
});
test('readiness requires current evidence and accepted architecture', t => {
  const f = fixture(t); assert.equal(readiness(f.spec, f.repo).ready, true);
  f.spec.decisions[0].status = 'proposed'; assert.equal(readiness(f.spec, f.repo).ready, false);
  f.spec.decisions[0].status = 'accepted'; f.spec.evidence = []; assert.equal(readiness(f.spec, f.repo).ready, false);
});
test('schema rejects malformed and unsafe artifacts', t => {
  const { spec } = fixture(t);
  const invalid = [s => s.groups.push(s.groups[0]), s => s.relations[0].to = 'missing', s => s.groups[0].paths.push('../secret'), s => s.groups[0].paths.push('/secret'), s => s.components[0].unexpected = true, s => s.components[0].intended = 32, s => s.decisions[0].evidenceIds.push('absent'), s => s.groups = null];
  for (const change of invalid) { const next = structuredClone(spec); change(next); assert.ok(validateSpec(next).length); }
});
test('draft is explicitly incomplete and does not pretend to understand code', t => {
  const f = fixture(t), s = draft(f.repo, { id: 'new', title: 'New architecture', intent: 'Design it' });
  assert.equal(validateSpec(s).length, 0); assert.equal(readiness(s, f.repo).ready, false); assert.ok(s.unknowns.length);
});
test('renames and deletions remain visible in coverage', t => {
  const f = fixture(t); git(f.repo, ['mv', 'accounts.js', 'identity.js']);
  assert.deepEqual(changedFiles(f.repo, f.base), ['accounts.js', 'billing.js', 'identity.js']);
});
test('canonical hash ignores key order but preserves arrays', () => {
  assert.equal(hash({ a: 1, b: 2 }), hash({ b: 2, a: 1 })); assert.notEqual(hash([1, 2]), hash([2, 1]));
});
test('published JSON Schema matches runtime schema', () => {
  assert.deepEqual(JSON.parse(readFileSync(join(project, 'schema/spec.schema.json'), 'utf8')), specSchema);
});
test('bind does not relabel old evidence as current', t => {
  const f = fixture(t); writeFileSync(join(f.repo, 'billing.js'), 'new behavior');
  const report = JSON.parse(cli(['bind', '--repo', f.repo, '--spec', f.path]));
  assert.equal(report.fresh, true); assert.deepEqual(report.staleEvidence, ['source-check']);
});
test('CLI validation exits unsuccessfully when change is unexplained', t => {
  const f = fixture(t); writeFileSync(join(f.repo, 'other.js'), 'new');
  assert.throws(() => cli(['validate', '--repo', f.repo, '--spec', f.path]), e => e.status === 1);
});
test('symlinks are hashed as links without reading external targets', t => {
  const f = fixture(t); symlinkSync('/not/a/real/file', join(f.repo, 'external'));
  assert.match(sourceDigest(f.repo), /^sha256:/);
});
