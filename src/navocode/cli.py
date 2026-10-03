"""Portable command-line interface for host coding assistants."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import webbrowser
from . import __version__, proposals, github
from .core import ROOT, SCHEMA, read_json, write_json, assert_spec, draft, root_of, revision, head_of, source_digest, changed_files, inspect, readiness, brief, summary, git
from .install import install, uninstall
from .server import Workspace, session_request

HELP = '''NavoCode — architecture authoring and PR review

install --host codex|claude|cursor|copilot --project PATH [--pr-mode always]
uninstall --host HOST --project PATH
init --repo PATH --id ID --title TITLE --intent INTENT [--base REF]
context --repo PATH [--base REF]
schema
validate --repo PATH --spec FILE [--ready]
bind --repo PATH --spec FILE
start --repo PATH --spec FILE [--mode author|review] [--baseline FILE] [--open]
serve --repo PATH --spec FILE [--port PORT]
feedback --session FILE [--wait 25]
ack --session FILE --event ID --message TEXT
stop --session FILE
brief --spec FILE
summary --spec FILE
review PR_URL [--change ID]
review-bind --context FILE --spec FILE
proposal create --spec FILE --baseline FILE --context FILE --rationale TEXT --out FILE
proposal show --proposal FILE
proposal publish --proposal FILE
proposal read COMMENT_URL --out FILE
adopt --repo PATH --spec FILE --proposal FILE
demo [--open]

The agent generates meaningful specs. init creates an unverified draft.
Publish posts a GitHub comment; adopt updates specs, not code.
Architectural decisions require human acceptance before implementation.
'''

def output(value):
    print(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2), flush=True)

def start(options):
    session = Path(options['session']).resolve() if options.get('session') else Path(tempfile.mkdtemp(prefix='navocode-session-')) / 'session.json'
    if session.exists(): raise ValueError('Session file already exists; choose a new path')
    args = [sys.executable, str(ROOT / 'bin/navocode.py'), 'serve', '--repo', str(root_of(options.get('repo') or '.')), '--spec', str(Path(options['spec']).resolve()), '--session', str(session), '--mode', options.get('mode') or 'author', '--port', options.get('port') or '0']
    if options.get('baseline'): args += ['--baseline', str(Path(options['baseline']).resolve())]
    child = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    for _ in range(100):
        if session.exists():
            descriptor = read_json(session)
            if options.get('open'): webbrowser.open(descriptor['url'])
            return dict(session=str(session), url=descriptor['url'], pid=descriptor['pid'], next=f'navocode feedback --session {session} --wait 25')
        if child.poll() is not None: break
        time.sleep(.05)
    raise ValueError('UI failed to start. Run serve in the foreground for diagnostics.')

def main(argv=None):
    parser = argparse.ArgumentParser(description='NavoCode architecture workspace')
    parser.add_argument('command', nargs='?', default='help'); parser.add_argument('arguments', nargs='*')
    keys = ('repo', 'id', 'title', 'intent', 'base', 'spec', 'mode', 'port', 'session', 'wait', 'event', 'message', 'baseline', 'context', 'out', 'rationale', 'proposal', 'host', 'project', 'pr-mode', 'change')
    for key in keys: parser.add_argument('--' + key)
    for key in ('open', 'ready'): parser.add_argument('--' + key, action='store_true')
    options = vars(parser.parse_args(argv)); command = options['command']; args = options['arguments']
    def need(key):
        if not options.get(key): raise ValueError('--' + key.replace('_', '-') + ' is required')
        return options[key]
    repo = lambda: root_of(options.get('repo') or '.')
    spec = lambda: assert_spec(read_json(need('spec')))
    if command == 'help': output('NavoCode ' + __version__ + '\n\n' + HELP)
    elif command == 'schema': output(SCHEMA)
    elif command == 'install':
        if options.get('pr_mode') not in (None, 'manual', 'always'): raise ValueError('Invalid PR mode')
        output(install(need('project'), need('host'), options.get('pr_mode') == 'always'))
    elif command == 'uninstall': output(uninstall(need('project'), need('host')))
    elif command == 'init':
        value = draft(repo(), need('id'), need('title'), need('intent'), options.get('base') or 'HEAD')
        path = repo() / '.navocode/changes' / value['changeId'] / 'spec.json'
        if path.exists(): raise ValueError('Change already exists')
        write_json(path, value); output(dict(spec=str(path), next='Inspect source and replace the draft with architecture and evidence.'))
    elif command == 'context':
        root = repo(); base = revision(root, options.get('base') or 'HEAD')
        output(dict(repo=str(root), headSha=head_of(root), baseSha=base, sourceDigest=source_digest(root), changedFiles=changed_files(root, base)))
    elif command == 'bind':
        value = spec(); value['sourceDigest'] = source_digest(repo()); write_json(need('spec'), value); output(inspect(value, repo()))
    elif command == 'validate':
        result = readiness(spec(), repo()) if options['ready'] else inspect(spec(), repo()); output(result)
        return 0 if result['fresh'] and not result['uncovered'] and not result['staleEvidence'] and (not options['ready'] or result['ready']) else 1
    elif command == 'brief': output(brief(spec()))
    elif command == 'summary': output(summary(spec()))
    elif command == 'start': spec(); output(start(dict(options, repo=str(repo()))))
    elif command == 'serve':
        port = int(options.get('port') or 0)
        if not 0 <= port <= 65535: raise ValueError('Invalid port')
        server = Workspace(need('spec'), repo(), options.get('mode') or 'author', port, options.get('baseline'))
        if options.get('session'): write_json(options['session'], server.descriptor())
        output(server.descriptor())
        if options['open']: webbrowser.open(server.descriptor()['url'])
        try: server.serve_forever()
        finally: server.server_close()
    elif command == 'feedback': output(session_request(need('session'), '/api/feedback?wait=' + str(min(50, max(0, float(options.get('wait') or 25))))))
    elif command == 'ack': output(session_request(need('session'), '/api/ack', dict(id=need('event'), message=need('message'))))
    elif command == 'stop': output(session_request(need('session'), '/api/stop', {}))
    elif command == 'review': output(github.prepare_review(args[0] if args else '', options.get('change')))
    elif command == 'review-bind':
        context = read_json(need('context')); value = spec()
        if head_of(context['repo']) != context['headSha'] or source_digest(context['repo']) != value['sourceDigest'] or changed_files(context['repo'], context['headSha']): raise ValueError('Review source binding changed')
        if context.get('baseline'): raise ValueError('Baseline already exists')
        baseline = Path(context['folder']) / 'baseline.json'; write_json(baseline, value)
        context.update(baseline=str(baseline), spec=str(Path(need('spec')).resolve()), inferredBaseline=True); write_json(need('context'), context); output(context)
    elif command == 'proposal':
        action = args[0] if args else ''
        if action == 'create':
            context = read_json(need('context')); baseline = assert_spec(read_json(need('baseline')))
            if context.get('repo') and (head_of(context['repo']) != context['headSha'] or source_digest(context['repo']) != baseline['sourceDigest']): raise ValueError('Review source changed')
            value = proposals.create(baseline, spec(), context, need('rationale')); write_json(need('out'), value); output(dict(proposal=str(Path(options['out']).resolve()), summary=proposals.comment(value)))
        elif action == 'show': output(proposals.comment(read_json(need('proposal'))))
        elif action == 'publish': output(github.publish(read_json(need('proposal'))))
        elif action == 'read':
            result = github.read_proposal(args[1] if len(args) > 1 else ''); write_json(need('out'), result['proposal']); output(dict(result, proposal=str(Path(options['out']).resolve())))
        else: raise ValueError('Unknown proposal action')
    elif command == 'adopt':
        proposal = proposals.validate(read_json(need('proposal'))); root = repo()
        if proposal['base'].get('repository'):
            github.assert_remote_head(proposal)
            origin = git(root, 'remote', 'get-url', 'origin').strip().removesuffix('.git'); name = proposal['base']['repository']
            if origin not in ('https://github.com/' + name, 'git@github.com:' + name): raise ValueError('Local repository does not match proposal')
        if source_digest(root) != proposal['base']['sourceDigest']: raise ValueError('Local source differs from proposal baseline')
        value = proposals.apply(spec(), proposal, head_of(root))
        for component in value['components']: component['observed'] = ''
        for evidence in value['evidence']:
            if evidence['status'] == 'supported': evidence['status'] = 'unverified'
        for op in proposal['operations']:
            if op.get('collection') == 'decisions' and op['value']:
                decision = next(d for d in value['decisions'] if d['id'] == op['id']); decision.update(status='accepted', provenance='human')
        write_json(need('spec'), value); output(dict(adopted=proposal['proposalId'], spec=str(Path(options['spec']).resolve()), next='Implement accepted intent, reconcile observations and evidence, then bind.'))
    elif command == 'demo':
        root = Path(tempfile.mkdtemp(prefix='navocode-demo-')); git(root, 'init', '-q'); git(root, '-c', 'user.name=NavoCode', '-c', 'user.email=demo@navocode.local', 'commit', '--allow-empty', '-qm', 'Demo baseline')
        value = read_json(ROOT / 'examples/billing.json'); value.update(baseRef=head_of(root), sourceDigest=source_digest(root)); path = root / '.navocode/changes/billing/spec.json'; write_json(path, value)
        output(start(dict(options, repo=str(root), spec=str(path))))
    else: raise ValueError('Unknown command: ' + command)
    return 0

def entry():
    try: return main()
    except (ValueError, OSError, KeyError) as error:
        print('NavoCode: ' + str(error), file=sys.stderr); return 1
