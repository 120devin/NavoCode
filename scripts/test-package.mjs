import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJSON = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const pkg = readJSON('package.json');
const lock = readJSON('package-lock.json');
assert.equal(lock.version, pkg.version, 'Lockfile version must match package.json');
assert.equal(lock.packages[''].version, pkg.version);
assert.equal(readJSON('.claude-plugin/plugin.json').version, pkg.version);
const pythonVersion = readFileSync(join(root, 'src/navocode/__init__.py'), 'utf8')
  .match(/__version__ = ['"]([^'"]+)['"]/)[1];
assert.equal(pythonVersion, pkg.version, 'Python version must match package.json');
if (process.env.RELEASE_TAG) {
  assert.equal(process.env.RELEASE_TAG, `v${pkg.version}`, 'Release tag must match package.json');
}

const temporary = mkdtempSync(join(tmpdir(), 'navocode-package-'));
const run = (command, args, cwd = temporary) => execFileSync(command, args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temporary], root));
  const files = packed.files.map((file) => file.path);
  assert(!files.some((path) => /(^|\/)(__pycache__|node_modules|\.agents|\.navocode)(\/|$)/.test(path)),
    'Package must exclude generated files and project state');
  const prefix = join(temporary, 'installation');
  run('npm', ['install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund',
    join(temporary, packed.filename)]);
  const cli = join(prefix, 'bin', 'navocode');
  assert(run(cli, ['help']).includes(`NavoCode ${pkg.version}`));
  JSON.parse(run(cli, ['schema']));
  for (const [host, folder] of Object.entries({
    codex: '.agents', claude: '.claude', cursor: '.cursor', copilot: '.github',
  })) {
    const project = join(temporary, host);
    mkdirSync(project);
    run(cli, ['install', '--host', host, '--project', project]);
    const installed = join(project, folder, 'skills', 'navocode');
    assert(run(process.env.NAVOCODE_PYTHON || 'python3',
      [join(installed, 'scripts', 'navocode.py'), 'help']).includes(`NavoCode ${pkg.version}`));
    // Reinstall is the update path for skills copied into projects.
    run(cli, ['install', '--host', host, '--project', project]);
    run(cli, ['uninstall', '--host', host, '--project', project]);
  }
  console.log(`Verified ${packed.filename}: CLI, schema, and all four skill installations.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
