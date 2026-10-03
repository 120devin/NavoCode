#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdtempSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { assertSpec, jsonRead, jsonWrite, draft, rootOf, revision, headOf, sourceDigest, changedFiles, inspect, readiness, brief, summary, git } from '../src/core.js';
import { specSchema } from '../src/schema.js';
import { startServer, sessionRequest } from '../src/server.js';
import { createProposal, validateProposal, applyProposal, proposalComment } from '../src/proposals.js';
import { prepareReview, publishProposal, readProposal, assertRemoteHead } from '../src/github.js';
import { install, uninstall } from '../src/install.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const options = Object.fromEntries(['repo', 'id', 'title', 'intent', 'base', 'spec', 'mode', 'port', 'session', 'wait', 'event', 'message', 'baseline', 'context', 'out', 'rationale', 'proposal', 'host', 'project', 'pr-mode', 'change', 'text', 'target', 'action'].map(k => [k, { type: 'string' }]));
for (const k of ['help', 'open', 'ready']) options[k] = { type: 'boolean' };
const output = value => process.stdout.write(typeof value === 'string' ? value + '\n' : JSON.stringify(value, null, 2) + '\n');
const required = (opts, key) => { if (!opts[key]) throw Error(`--${key} is required`); return opts[key]; };
function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => process.stderr.write(`Open this URL in a browser: ${url}\n`)); child.unref();
}
async function start(opts) {
  const session = opts.session ? resolve(opts.session) : join(mkdtempSync(join(tmpdir(), 'navocode-session-')), 'session.json');
  if (existsSync(session)) throw Error('Session file already exists; choose a new path');
  const args = [fileURLToPath(import.meta.url), 'serve', '--spec', resolve(required(opts, 'spec')), '--repo', rootOf(opts.repo || process.cwd()), '--session', session, '--mode', opts.mode || 'author'];
  if (opts.baseline) args.push('--baseline', resolve(opts.baseline));
  const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' }); child.unref();
  let spawnError; child.on('error', err => { spawnError = err; });
  for (let i = 0; i < 100; i++) { if (spawnError) throw spawnError; if (existsSync(session)) { const result = jsonRead(session); if (opts.open) openBrowser(result.url); return { session, url: result.url, pid: result.pid, next: `navocode feedback --session ${session} --wait 25` }; } await new Promise(r => setTimeout(r, 50)); }
  throw Error('UI failed to start. Run serve in the foreground for diagnostics.');
}
async function main() {
  const { values: o, positionals: args } = parseArgs({ options, allowPositionals: true });
  const [cmd, sub] = args;
  const repo = () => rootOf(o.repo || process.cwd());
  const spec = () => assertSpec(jsonRead(required(o, 'spec')));
  if (!cmd || cmd === 'help' || o.help) return output(`NavoCode 0.1.0 — architecture authoring and PR review\n\ninstall --host codex|claude|cursor|copilot --project PATH [--pr-mode always]\nuninstall --host HOST --project PATH\ninit --repo PATH --id ID --title TITLE --intent INTENT [--base REF]\ncontext --repo PATH [--base REF]\nschema\nvalidate --repo PATH --spec FILE [--ready]\nbind --repo PATH --spec FILE\nstart --repo PATH --spec FILE [--mode author|review] [--baseline FILE] [--open]\nserve --repo PATH --spec FILE [--port PORT]\nfeedback --session FILE [--wait 25]\nack --session FILE --event ID --message TEXT\nstop --session FILE\nbrief --spec FILE\nsummary --spec FILE\nreview PR_URL [--change ID]\nreview-bind --context FILE --spec FILE\nproposal create --spec FILE --baseline FILE --context FILE --rationale TEXT --out FILE\nproposal show --proposal FILE\nproposal publish --proposal FILE\nproposal read COMMENT_URL --out FILE\nadopt --repo PATH --spec FILE --proposal FILE\ndemo [--open]\n\nThe agent generates meaningful specs. init only creates an explicitly unverified draft.\nPublish posts a GitHub comment; adopt changes specifications, not code.\n`);
  switch (cmd) {
    case 'schema': return output(specSchema);
    case 'install': if (o['pr-mode'] && !['always', 'manual'].includes(o['pr-mode'])) throw Error('Invalid PR mode'); return output(install(resolve(required(o, 'project')), required(o, 'host'), o['pr-mode'] === 'always'));
    case 'uninstall': return output(uninstall(resolve(required(o, 'project')), required(o, 'host')));
    case 'init': {
      const s = draft(repo(), { id: required(o, 'id'), title: required(o, 'title'), intent: required(o, 'intent'), base: o.base || 'HEAD' });
      const path = join(repo(), '.navocode/changes', s.changeId, 'spec.json');
      if (existsSync(path)) throw Error('Change already exists');
      jsonWrite(path, s); return output({ spec: path, next: 'Inspect source and replace the draft with architectural groups, components, decisions, and evidence.' });
    }
    case 'context': { const r = repo(), base = revision(r, o.base || 'HEAD'); return output({ repo: r, headSha: headOf(r), baseSha: base, sourceDigest: sourceDigest(r), changedFiles: changedFiles(r, base) }); }
    case 'bind': { const s = spec(); s.sourceDigest = sourceDigest(repo()); jsonWrite(resolve(o.spec), s); return output(inspect(s, repo())); }
    case 'validate': { const s = spec(), result = o.ready ? readiness(s, repo()) : inspect(s, repo()); output(result); if (!result.fresh || result.uncovered.length || result.staleEvidence.length || (o.ready && !result.ready)) process.exitCode = 1; return; }
    case 'brief': return output(brief(spec()));
    case 'summary': return output(summary(spec()));
    case 'start': assertSpec(jsonRead(required(o, 'spec'))); return output(await start(o));
    case 'serve': {
      const port = Number(o.port || 0); if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid port');
      const { session } = await startServer({ specPath: resolve(required(o, 'spec')), repo: repo(), mode: o.mode, port, sessionPath: o.session ? resolve(o.session) : undefined, baselinePath: o.baseline ? resolve(o.baseline) : undefined }); output(session); if (o.open) openBrowser(session.url); return;
    }
    case 'feedback': return output(await sessionRequest(required(o, 'session'), `/api/feedback?wait=${Math.min(50, Math.max(0, Number(o.wait || 25)))}`));
    case 'ack': return output(await sessionRequest(required(o, 'session'), '/api/ack', { id: required(o, 'event'), message: required(o, 'message') }));
    case 'stop': return output(await sessionRequest(required(o, 'session'), '/api/stop', {}));
    case 'review': return output(prepareReview(sub, o.change));
    case 'review-bind': {
      const context = jsonRead(required(o, 'context')), s = spec();
      if (headOf(context.repo) !== context.headSha || sourceDigest(context.repo) !== s.sourceDigest) throw Error('Review source binding changed');
      if (changedFiles(context.repo, context.headSha).length) throw Error('Review draft must describe the fetched PR source without modifying it');
      if (context.baseline) throw Error('Baseline already exists; preserve the original revision');
      const baseline = join(context.folder, 'baseline.json'); jsonWrite(baseline, s);
      const next = { ...context, baseline, spec: resolve(o.spec), inferredBaseline: true }; jsonWrite(resolve(o.context), next); return output(next);
    }
    case 'proposal': {
      if (sub === 'create') {
        const context = jsonRead(required(o, 'context')), baseline = assertSpec(jsonRead(required(o, 'baseline')));
        if (context.repo && (headOf(context.repo) !== context.headSha || sourceDigest(context.repo) !== baseline.sourceDigest)) throw Error('Review source changed; refresh before proposing');
        const p = createProposal(baseline, spec(), context, required(o, 'rationale')); validateProposal(p); jsonWrite(resolve(required(o, 'out')), p); return output({ proposal: resolve(o.out), summary: proposalComment(p) });
      }
      if (sub === 'show') return output(proposalComment(jsonRead(required(o, 'proposal'))));
      if (sub === 'publish') return output(publishProposal(jsonRead(required(o, 'proposal'))));
      if (sub === 'read') { const result = readProposal(args[2]); jsonWrite(resolve(required(o, 'out')), result.proposal); return output({ ...result, proposal: resolve(o.out) }); }
      throw Error('Unknown proposal action');
    }
    case 'adopt': {
      const p = validateProposal(jsonRead(required(o, 'proposal'))), s = spec(), r = repo();
      if (p.base.repository) {
        assertRemoteHead(p);
        const origin = git(r, ['remote', 'get-url', 'origin']).trim().replace(/\.git$/, '');
        if (![ `https://github.com/${p.base.repository}`, `git@github.com:${p.base.repository}` ].includes(origin)) throw Error('Local repository does not match proposal');
      }
      if (sourceDigest(r) !== p.base.sourceDigest) throw Error('Local source differs from the proposal baseline');
      const next = applyProposal(s, p, headOf(r));
      // A changed design needs a fresh implementation reconciliation, even if source is unchanged.
      next.components.forEach(c => { c.observed = ''; });
      next.evidence.forEach(e => { if (e.status === 'supported') e.status = 'unverified'; });
      for (const op of p.operations.filter(op => op.collection === 'decisions' && op.value)) {
        const d = next.decisions.find(d => d.id === op.id); d.status = 'accepted'; d.provenance = 'human';
      }
      jsonWrite(resolve(o.spec), next);
      return output({ adopted: p.proposalId, spec: resolve(o.spec), next: 'Implement accepted intent, reconcile observed behavior, rerun checks, and bind. Adoption only updates the specification.' });
    }
    case 'demo': {
      const r = mkdtempSync(join(tmpdir(), 'navocode-demo-')); git(r, ['init', '-q']);
      git(r, ['-c', 'user.name=NavoCode', '-c', 'user.email=demo@navocode.local', 'commit', '--allow-empty', '-qm', 'Demo baseline']);
      const s = jsonRead(join(root, 'examples/billing.json')); s.baseRef = headOf(r); s.sourceDigest = sourceDigest(r);
      const path = join(r, '.navocode/changes/billing/spec.json'); jsonWrite(path, s);
      return output(await start({ ...o, repo: r, spec: path }));
    }
    default: throw Error(`Unknown command: ${cmd}`);
  }
}
main().catch(error => { process.stderr.write(`NavoCode: ${error.message}\n`); process.exitCode = 1; });
