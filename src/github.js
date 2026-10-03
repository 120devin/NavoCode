import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { git, headOf, jsonRead, jsonWrite, assertSpec, inspect, hash } from './core.js';
import { proposalComment, parseComment, validateProposal } from './proposals.js';
export function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
}
export function prIdentity(url) {
  const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d*)(?:\/)?(?:#.*)?$/.exec(url);
  if (!match) throw Error('Expected https://github.com/OWNER/REPO/pull/NUMBER');
  return { repository: match[1], number: Number(match[2]) };
}
export function remotePR(identity, run = gh) { return JSON.parse(run(['api', `repos/${identity.repository}/pulls/${identity.number}`])); }
export function assertRemoteHead(proposal, run = gh) {
  validateProposal(proposal);
  if (!proposal.base.repository) throw Error('Proposal is not bound to a GitHub PR');
  const pr = remotePR(proposal.base, run);
  if (pr.head.sha !== proposal.base.headSha) throw Error('PR head changed; refresh the proposal before publishing or adopting');
  if (pr.state !== 'open') throw Error('PR is not open');
  return pr;
}
export function prepareReview(url, changeId, run = gh) {
  const identity = prIdentity(url), pr = remotePR(identity, run);
  const folder = mkdtempSync(join(tmpdir(), 'navocode-review-'));
  const repo = join(folder, 'repo');
  run(['repo', 'clone', identity.repository, repo, '--', '--no-checkout', '--filter=blob:none']);
  git(repo, ['fetch', '--no-tags', 'origin', `refs/pull/${identity.number}/head`]);
  git(repo, ['checkout', '--detach', 'FETCH_HEAD']);
  if (headOf(repo) !== pr.head.sha) throw Error('PR changed while fetching; restart review');
  git(repo, ['fetch', '--no-tags', 'origin', pr.base.sha]);
  const changes = join(repo, '.navocode', 'changes');
  let options = existsSync(changes) ? readdirSync(changes).filter(n => /^[\w-]+$/.test(n) && existsSync(join(changes, n, 'spec.json'))) : [];
  if (changeId) options = options.filter(n => n === changeId);
  const context = { ...identity, headSha: pr.head.sha, baseSha: pr.base.sha, repo, folder };
  if (options.length !== 1) {
    jsonWrite(join(folder, 'context.json'), context);
    return { ...context, context: join(folder, 'context.json'), specs: options, action: options.length ? 'Select --change from the listed specs and run review again.' : 'No spec found. Generate an agent draft with init using baseSha, then run review-bind to capture the baseline before reviewer edits.' };
  }
  const specPath = join(changes, options[0], 'spec.json');
  if (!realpathSync(specPath).startsWith(realpathSync(repo) + '/')) throw Error('PR specification resolves outside the checkout');
  const spec = assertSpec(jsonRead(specPath)), report = inspect(spec, repo);
  if (!report.fresh) throw Error(`PR specifications are stale. Temporary source: ${repo}. Reconcile an explicitly inferred draft and use review-bind.`);
  const baseline = join(folder, 'baseline.json');
  jsonWrite(baseline, spec);
  const full = { ...context, spec: specPath, specPath: relative(repo, specPath), baseline };
  jsonWrite(join(folder, 'context.json'), full);
  return { ...full, context: join(folder, 'context.json'), report };
}
export function publishProposal(proposal, run = gh) {
  assertRemoteHead(proposal, run);
  const endpoint = `repos/${proposal.base.repository}/issues/${proposal.base.number}/comments`;
  const me = JSON.parse(run(['api', 'user']));
  const pages = JSON.parse(run(['api', endpoint, '--paginate', '--slurp']));
  for (const comment of pages.flat()) {
    if (comment.user?.id !== me.id) continue;
    try { if (hash(parseComment(comment.body)) === hash(proposal)) return { url: comment.html_url, existing: true }; } catch {}
  }
  const response = JSON.parse(run(['api', '--method', 'POST', endpoint, '--input', '-'], JSON.stringify({ body: proposalComment(proposal) })));
  const verified = JSON.parse(run(['api', `repos/${proposal.base.repository}/issues/comments/${response.id}`]));
  if (hash(parseComment(verified.body)) !== hash(proposal)) throw Error('Published comment failed verification');
  return { url: verified.html_url, existing: false };
}
export function readProposal(url, run = gh) {
  const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d*)#issuecomment-([1-9]\d*)$/.exec(url);
  if (!match) throw Error('Expected a PR timeline comment URL');
  const comment = JSON.parse(run(['api', `repos/${match[1]}/issues/comments/${match[3]}`]));
  const proposal = parseComment(comment.body);
  if (proposal.base.repository !== match[1] || proposal.base.number !== Number(match[2]) || !comment.issue_url?.endsWith(`/issues/${match[2]}`)) throw Error('Comment and proposal PR identities differ');
  return { proposal, author: comment.user?.login, url: comment.html_url };
}
