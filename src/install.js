import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync, rmSync, realpathSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, jsonRead, jsonWrite } from './core.js';
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const destinations = { codex: '.agents/skills/navocode', claude: '.claude/skills/navocode', cursor: '.cursor/skills/navocode', copilot: '.github/skills/navocode' };
function inventory(root, folder = root) {
  const output = {};
  for (const name of readdirSync(folder)) {
    const path = join(folder, name), stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw Error('Installed skill must not contain symlinks');
    if (stat.isDirectory()) Object.assign(output, inventory(root, path));
    else if (path !== join(root, '.navocode-install.json')) output[relative(root, path)] = hash(readFileSync(path).toString('base64'));
  }
  return output;
}
function unchanged(target) {
  const manifest = join(target, '.navocode-install.json');
  if (!existsSync(manifest)) throw Error('Existing folder is not owned by NavoCode; move it before installing');
  if (JSON.stringify(inventory(target)) !== JSON.stringify(jsonRead(manifest).files)) throw Error('Installed skill has local edits; preserve them before reinstalling/uninstalling');
}
function targetPath(project, host) {
  if (!destinations[host]) throw Error('Host must be codex, claude, cursor, or copilot');
  const root = realpathSync(project), target = resolve(root, destinations[host]);
  let cursor = target;
  while (cursor !== root) { if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw Error('Skill installation path contains a symlink'); cursor = dirname(cursor); }
  return target;
}
export function install(project, host, always = false) {
  const target = targetPath(project, host);
  if (existsSync(target)) { unchanged(target); rmSync(target, { recursive: true }); }
  mkdirSync(target, { recursive: true });
  cpSync(join(packageRoot, 'skills/navocode/SKILL.md'), join(target, 'SKILL.md'));
  cpSync(join(packageRoot, 'skills/navocode/references'), join(target, 'references'), { recursive: true });
  mkdirSync(join(target, 'scripts'), { recursive: true });
  for (const folder of ['bin', 'src', 'ui', 'schema', 'examples']) cpSync(join(packageRoot, folder), join(target, 'runtime', folder), { recursive: true });
  cpSync(join(packageRoot, 'package.json'), join(target, 'runtime/package.json'));
  cpSync(join(packageRoot, 'LICENSE'), join(target, 'runtime/LICENSE'));
  // The runtime's install command remains usable after installation.
  cpSync(join(packageRoot, 'skills'), join(target, 'runtime/skills'), { recursive: true });
  writeFileSync(join(target, 'scripts/navocode.mjs'), "#!/usr/bin/env node\nimport '../runtime/bin/navocode.js';\n");
  if (always) {
    const path = join(target, 'SKILL.md');
    const text = readFileSync(path, 'utf8').replace('Use when the user asks to author or review with NavoCode.', 'Use whenever preparing, creating, or updating a pull request, and when the user asks to author or review with NavoCode.');
    writeFileSync(path, text + '\n## Project PR preference\nUse NavoCode before preparing or updating a PR in this project. This is an agent instruction, not a Git hook or enforced platform event.\n');
  }
  jsonWrite(join(target, '.navocode-install.json'), { version: '0.1.0', host, files: inventory(target) });
  return { installed: target, command: `node ${join(target, 'scripts/navocode.mjs')}`, prMode: always ? 'agent-instruction' : 'manual', restart: 'Start a new assistant session to discover the skill.' };
}
export function uninstall(project, host) { const target = targetPath(project, host); unchanged(target); rmSync(target, { recursive: true }); return { removed: target }; }
