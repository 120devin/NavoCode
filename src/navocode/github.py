"""GitHub through the user's authenticated gh CLI."""
import json
from pathlib import Path
import re
import tempfile
from .core import run, git, head_of, read_json, write_json, assert_spec, inspect, digest
from . import proposals

def gh(args, data=None):
    return run(['gh', *args], data.encode() if isinstance(data, str) else data).decode()

def identity(url):
    match = re.fullmatch(r'https://github\.com/([\w.-]+/[\w.-]+)/pull/([1-9]\d*)/?(?:#.*)?', url or '')
    if not match: raise ValueError('Expected https://github.com/OWNER/REPO/pull/NUMBER')
    return dict(repository=match[1], number=int(match[2]))

def remote_pr(context, runner=gh):
    return json.loads(runner(['api', f'repos/{context["repository"]}/pulls/{context["number"]}']))

def assert_remote_head(proposal, runner=gh):
    p = proposals.validate(proposal)
    if not p['base'].get('repository'): raise ValueError('Proposal is not bound to a GitHub PR')
    pr = remote_pr(p['base'], runner)
    if pr['head']['sha'] != p['base']['headSha']: raise ValueError('PR head changed; refresh the proposal')
    if pr['state'] != 'open': raise ValueError('PR is not open')
    return pr

def review_candidates(repo, names):
    candidates = []
    for name in names:
        path = repo / '.navocode/changes' / name / 'spec.json'
        if not path.resolve().is_relative_to(repo.resolve()): raise ValueError('PR specification resolves outside the checkout')
        try:
            spec = assert_spec(read_json(path)); report = inspect(spec, repo)
            candidates.append(dict(id=name, title=spec['title'], applicable=report['fresh'] and not report['uncovered']))
        except (ValueError, OSError, KeyError):
            candidates.append(dict(id=name, title=name, applicable=False))
    return candidates

def prepare_review(url, change=None, runner=gh):
    context = identity(url); pr = remote_pr(context, runner)
    folder = Path(tempfile.mkdtemp(prefix='navocode-review-')); repo = folder / 'repo'
    runner(['repo', 'clone', context['repository'], str(repo), '--', '--no-checkout', '--filter=blob:none'])
    git(repo, 'fetch', '--no-tags', 'origin', f'refs/pull/{context["number"]}/head'); git(repo, 'checkout', '--detach', 'FETCH_HEAD')
    if head_of(repo) != pr['head']['sha']: raise ValueError('PR changed while fetching; restart review')
    git(repo, 'fetch', '--no-tags', 'origin', pr['base']['sha'])
    changes = repo / '.navocode/changes'
    options = sorted(p.name for p in changes.iterdir() if re.fullmatch(r'[\w-]+', p.name) and (p / 'spec.json').exists()) if changes.exists() else []
    candidates = review_candidates(repo, options)
    if change:
        if change not in options: raise ValueError('Unknown change: ' + change)
        options = [change]
    else:
        options = [c['id'] for c in candidates if c['applicable']]
    context.update(headSha=pr['head']['sha'], baseSha=pr['base']['sha'], repo=str(repo), folder=str(folder))
    context_path = folder / 'context.json'
    if len(options) != 1:
        write_json(context_path, context)
        return dict(context, context=str(context_path), specs=options, candidates=candidates, action='Select --change from the listed specs.' if options else 'Generate an inferred draft using baseSha, then review-bind before edits.')
    path = changes / options[0] / 'spec.json'
    if not path.resolve().is_relative_to(repo.resolve()): raise ValueError('PR specification resolves outside the checkout')
    spec = assert_spec(read_json(path)); report = inspect(spec, repo)
    if not report['fresh']: raise ValueError(f'PR specs are stale. Temporary source: {repo}. Reconcile an inferred draft.')
    baseline = folder / 'baseline.json'; write_json(baseline, spec)
    context.update(spec=str(path), specPath=str(path.relative_to(repo)), baseline=str(baseline)); write_json(context_path, context)
    return dict(context, context=str(context_path), report=report)

def publish(proposal, runner=gh):
    assert_remote_head(proposal, runner)
    endpoint = f'repos/{proposal["base"]["repository"]}/issues/{proposal["base"]["number"]}/comments'
    me = json.loads(runner(['api', 'user']))
    pages = json.loads(runner(['api', endpoint, '--paginate', '--slurp']))
    for page in pages:
        for entry in page:
            if entry.get('user', {}).get('id') != me['id']: continue
            try:
                if digest(proposals.parse(entry['body'])) == digest(proposal): return dict(url=entry['html_url'], existing=True)
            except (ValueError, KeyError): pass
    response = json.loads(runner(['api', '--method', 'POST', endpoint, '--input', '-'], json.dumps(dict(body=proposals.comment(proposal)))))
    verified = json.loads(runner(['api', f'repos/{proposal["base"]["repository"]}/issues/comments/{response["id"]}']))
    if digest(proposals.parse(verified['body'])) != digest(proposal): raise ValueError('Published comment failed verification')
    return dict(url=verified['html_url'], existing=False)

def read_proposal(url, runner=gh):
    match = re.fullmatch(r'https://github\.com/([\w.-]+/[\w.-]+)/pull/([1-9]\d*)#issuecomment-([1-9]\d*)', url or '')
    if not match: raise ValueError('Expected a PR timeline comment URL')
    entry = json.loads(runner(['api', f'repos/{match[1]}/issues/comments/{match[3]}']))
    proposal = proposals.parse(entry['body'])
    if proposal['base']['repository'] != match[1] or proposal['base']['number'] != int(match[2]) or not entry.get('issue_url', '').endswith('/issues/' + match[2]): raise ValueError('Comment and proposal PR identities differ')
    return dict(proposal=proposal, author=entry.get('user', {}).get('login'), url=entry['html_url'])
