import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { git, headOf, sourceDigest, jsonWrite } from '../src/core.js';
export const project = fileURLToPath(new URL('../', import.meta.url));
export function fixture(t) {
  const repo = mkdtempSync(join(tmpdir(), 'navocode-test-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'NavoCode tests']); git(repo, ['config', 'user.email', 'test@navocode.local']);
  writeFileSync(join(repo, 'accounts.js'), 'export const owner = account => account.owner;\n');
  writeFileSync(join(repo, 'billing.js'), 'export const payer = account => account.owner;\n');
  git(repo, ['add', '.']); git(repo, ['commit', '-qm', 'Baseline']);
  const base = headOf(repo);
  writeFileSync(join(repo, 'billing.js'), 'export const payer = account => account.billingOwner ?? account.owner;\n');
  const spec = JSON.parse(readFileSync(join(project, 'examples/billing.json'), 'utf8'));
  spec.baseRef = base; spec.sourceDigest = sourceDigest(repo);
  spec.groups[0].paths = ['billing.js']; spec.unknowns = [];
  spec.components.forEach(c => { c.observed = c.intended; });
  spec.decisions.forEach(d => { d.status = 'accepted'; d.provenance = 'human'; });
  spec.evidence = [{ id: 'source-check', claim: 'Billing resolves the delegated owner with an existing-client fallback.', kind: 'source', status: 'supported', detail: 'Fixture source inspection: billing.js uses billingOwner, falling back to owner.', paths: ['billing.js'], sourceDigest: spec.sourceDigest }];
  const path = join(repo, '.navocode/changes/delegated-billing/spec.json'); jsonWrite(path, spec);
  return { repo, base, spec, path };
}
export function cli(args, cwd = project) { return execFileSync(process.execPath, [join(project, 'bin/navocode.js'), ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
