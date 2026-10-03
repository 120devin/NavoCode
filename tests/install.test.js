import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { install, uninstall } from '../src/install.js';
for (const host of ['codex', 'claude', 'cursor', 'copilot']) test(`${host}: self-contained install, runtime invocation, reinstall, uninstall`, t => {
  const dir = mkdtempSync(join(tmpdir(), 'navocode-install-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = install(dir, host, true);
  const cli = join(result.installed, 'scripts/navocode.mjs');
  const output = execFileSync(process.execPath, [cli, 'help'], { encoding: 'utf8', cwd: dir });
  assert.match(output, /NavoCode 0.1.0/); assert.ok(!existsSync(join(result.installed, 'node_modules')));
  assert.match(readFileSync(join(result.installed, 'SKILL.md'), 'utf8'), /whenever preparing/);
  install(dir, host, true); uninstall(dir, host); assert.equal(existsSync(result.installed), false);
});
test('installer preserves modified and unrelated user files', t => {
  const dir = mkdtempSync(join(tmpdir(), 'navocode-install-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'AGENTS.md'), 'Existing rules');
  const { installed } = install(dir, 'codex'); writeFileSync(join(installed, 'SKILL.md'), 'My changes');
  assert.throws(() => install(dir, 'codex'), /local edits/); assert.throws(() => uninstall(dir, 'codex'), /local edits/);
  assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), 'Existing rules');
});
