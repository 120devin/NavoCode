"""Copy a self-contained skill; preserve user edits and avoid nested skill discovery."""
import base64
from pathlib import Path
import shutil
from .core import ROOT, digest, read_json, write_json
from . import __version__
DESTINATIONS = dict(codex='.agents/skills/navocode', claude='.claude/skills/navocode', cursor='.cursor/skills/navocode', copilot='.github/skills/navocode')

def inventory(root):
    result = {}
    for path in sorted(root.rglob('*')):
        if '__pycache__' in path.parts: continue
        if path.is_symlink(): raise ValueError('Installed skill must not contain symlinks')
        if path.is_file() and path != root / '.navocode-install.json': result[path.relative_to(root).as_posix()] = digest(base64.b64encode(path.read_bytes()).decode())
    return result

def unchanged(target):
    if not (target / '.navocode-install.json').exists(): raise ValueError('Existing folder is not owned by NavoCode')
    if inventory(target) != read_json(target / '.navocode-install.json')['files']: raise ValueError('Installed skill has local edits; preserve them before reinstalling/uninstalling')

def target_path(project, host):
    if host not in DESTINATIONS: raise ValueError('Host must be codex, claude, cursor, or copilot')
    root = Path(project).resolve(strict=True); target = root / DESTINATIONS[host]
    cursor = target
    while cursor != root:
        if cursor.is_symlink(): raise ValueError('Skill path contains a symlink')
        cursor = cursor.parent
    return target

def install(project, host, always=False):
    target = target_path(project, host)
    if target.exists(): unchanged(target); shutil.rmtree(target)
    target.mkdir(parents=True)
    # Installed runtimes retain the reusable templates as .md.txt, not discoverable SKILL.md files.
    template = ROOT / 'skills/navocode/SKILL.md'
    if not template.exists(): template = ROOT / 'templates/navocode.md.txt'
    shutil.copyfile(template, target / 'SKILL.md')
    references = ROOT / 'skills/navocode/references'
    if not references.exists(): references = ROOT / 'templates/references'
    shutil.copytree(references, target / 'references')
    (target / 'scripts').mkdir()
    (target / 'scripts/navocode.py').write_text("#!/usr/bin/env python3\nimport runpy\nfrom pathlib import Path\nrunpy.run_path(str(Path(__file__).resolve().parents[1] / 'runtime/bin/navocode.py'), run_name='__main__')\n")
    (target / 'scripts/navocode.mjs').write_text("#!/usr/bin/env node\nimport '../runtime/bin/navocode.js';\n")
    for folder in ('bin', 'src', 'ui', 'schema', 'examples'):
        shutil.copytree(ROOT / folder, target / 'runtime' / folder, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    for filename in ('package.json', 'LICENSE'): shutil.copyfile(ROOT / filename, target / 'runtime' / filename)
    templates = target / 'runtime/templates'; templates.mkdir()
    shutil.copyfile(template, templates / 'navocode.md.txt'); shutil.copytree(references, templates / 'references')
    if always:
        path = target / 'SKILL.md'
        path.write_text(path.read_text().replace('Use when the user asks to author or review with NavoCode.', 'Use whenever preparing, creating, or updating a pull request, and when the user asks to author or review with NavoCode.') + '\n## Project PR preference\nUse NavoCode before preparing or updating a PR in this project. This is agent guidance, not an enforced Git hook.\n')
    write_json(target / '.navocode-install.json', dict(version=__version__, host=host, files=inventory(target)))
    return dict(installed=str(target), command=f'python3 {target / "scripts/navocode.py"}', prMode='agent-instruction' if always else 'manual', restart='Start a new assistant session to discover the skill.')

def uninstall(project, host):
    target = target_path(project, host); unchanged(target); shutil.rmtree(target)
    return dict(removed=str(target))
