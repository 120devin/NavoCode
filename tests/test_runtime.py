"""Behavioral tests for the Python runtime, real HTTP transport, and Git lifecycle."""
import base64
import copy
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
from io import StringIO
from urllib.error import HTTPError
from urllib.request import Request, urlopen
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from navocode import core, proposals, github, install, cli
from navocode.server import Workspace, session_request
ROOT = core.ROOT

class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='navocode-python-test-'); self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / 'repo'; self.repo.mkdir()
        core.git(self.repo, 'init', '-q'); core.git(self.repo, 'config', 'user.name', 'NavoCode test'); core.git(self.repo, 'config', 'user.email', 'test@navocode.local')
        (self.repo / 'billing.txt').write_text('Account owner is the payer.\n'); core.git(self.repo, 'add', '.'); core.git(self.repo, 'commit', '-qm', 'Baseline')
        self.base = core.head_of(self.repo); (self.repo / 'billing.txt').write_text('Delegated owner is the payer; omitted owner uses the account owner.\n')
        self.spec = core.read_json(ROOT / 'examples/billing.json'); self.spec.update(baseRef=self.base, sourceDigest=core.source_digest(self.repo), unknowns=[])
        self.spec['groups'][0]['paths'] = ['billing.txt']
        for c in self.spec['components']: c['observed'] = c['intended']
        for d in self.spec['decisions']: d.update(status='accepted', provenance='human')
        self.spec['evidence'] = [dict(id='source-check', claim='Delegated owners preserve the fallback.', kind='source', status='supported', detail='Inspected fixture billing contract.', paths=['billing.txt'], sourceDigest=self.spec['sourceDigest'])]
        self.path = self.repo / '.navocode/changes/delegated-billing/spec.json'; core.write_json(self.path, self.spec)
    def cli(self, *args, check=True):
        return subprocess.run([sys.executable, str(ROOT / 'bin/navocode.py'), *map(str,args)], capture_output=True, text=True, check=check)
    def proposal(self, remote=False):
        next_spec = copy.deepcopy(self.spec); next_spec['decisions'][0]['choice'] = 'Billing validates delegated owner identity.'
        context = dict(headSha=core.head_of(self.repo))
        if remote: context.update(repository='owner/repo', number=7)
        return proposals.create(self.spec, next_spec, context, 'Centralize identity validation.')
    def workspace(self, mode='author'):
        server = Workspace(self.path, self.repo, mode)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        self.addCleanup(server.server_close); self.addCleanup(server.shutdown)
        session = self.repo / '.navocode/local/session.json'; core.write_json(session, server.descriptor())
        return server, session
    def feedback(self, session, action='ask', **kw):
        data = dict(action=action, text='Explain the contract', target='billing', revision=core.digest(core.read_json(self.path))); data.update(kw)
        return session_request(session, '/api/events', data)
    def test_source_digest_excludes_specs_and_survives_commit(self):
        digest = core.source_digest(self.repo); self.spec['intent'] += ' More context'; core.write_json(self.path, self.spec)
        self.assertEqual(core.source_digest(self.repo), digest)
        core.git(self.repo, 'add', '.'); core.git(self.repo, 'commit', '-qm', 'Source and specs'); self.assertEqual(core.source_digest(self.repo), digest)
    def test_untracked_changes_invalidate_binding_and_coverage(self):
        (self.repo / 'other.txt').write_text('Unrelated change')
        report = core.inspect(self.spec, self.repo); self.assertFalse(report['fresh']); self.assertEqual(report['uncovered'], ['other.txt']); self.assertEqual(report['staleEvidence'], ['source-check'])
    def test_readiness_requires_human_acceptance(self):
        self.assertTrue(core.readiness(self.spec, self.repo)['ready'])
        self.spec['decisions'][0]['provenance'] = 'agent'
        self.assertFalse(core.readiness(self.spec, self.repo)['ready'])
        with self.assertRaisesRegex(ValueError,'Engineer acceptance'): core.brief(self.spec)
    def test_readiness_rejects_missing_observation_and_evidence(self):
        self.spec['components'][0]['observed'] = ''; self.spec['evidence'] = []; self.assertFalse(core.readiness(self.spec, self.repo)['ready'])
    def test_bad_schema_references_and_paths(self):
        for mutate in (lambda s:s['groups'].append(s['groups'][0]),lambda s:s['relations'][0].update(to='missing'),lambda s:s['groups'][0]['paths'].append('../secret'),lambda s:s['components'][0].update(unexpected=True),lambda s:s['components'][0].update(intended=3),lambda s:s['decisions'][0]['evidenceIds'].append('missing')):
            with self.subTest(mutate=mutate):
                spec = copy.deepcopy(self.spec); mutate(spec); self.assertTrue(core.validate_spec(spec))
    def test_diagram_metadata_is_optional_validated_and_preserved_in_proposals(self):
        core.assert_spec(self.spec)
        extended=copy.deepcopy(self.spec)
        extended['components'][0].update(kind='actor',technology='Browser',boundary='Client',risk='Stale ownership information.')
        extended['relations'][0].update(protocol='HTTPS',failure='Return an authorization error.')
        core.assert_spec(extended)
        p=proposals.create(self.spec,extended,dict(headSha=core.head_of(self.repo)),'Expose inspected boundary contracts.')
        self.assertEqual(proposals.apply(self.spec,p,core.head_of(self.repo)),extended)
        extended['components'][0]['kind']='invented-kind'
        self.assertTrue(core.validate_spec(extended))
    def flow_spec(self):
        spec = copy.deepcopy(self.spec)
        spec['relations'] += [dict(id='bill-result', **{'from':'billing','to':'accounts'}, label='Return the billing result', state='intended'), dict(id='response', **{'from':'accounts','to':'clients'}, label='Return the response', state='both')]
        spec['scenarios'] = [dict(id='pay', title='Submit billing', trigger='The client submits an account.', outcome='The client receives the result.', current=[dict(id='request',relationId='client-account'),dict(id='response',relationId='response')], intended=[dict(id='request',relationId='client-account'),dict(id='bill',relationId='account-billing'),dict(id='result',relationId='bill-result'),dict(id='response',relationId='response')])]
        spec['relations'][0].update(paths=['billing.txt'],evidenceIds=['source-check'],decisionIds=['policy-owner'])
        return spec
    def test_execution_scenarios_validate_and_survive_proposals(self):
        spec = self.flow_spec(); core.assert_spec(spec)
        p = proposals.create(self.spec,spec,dict(headSha=core.head_of(self.repo)),'Explain the complete billing path.')
        self.assertEqual(proposals.apply(self.spec,p,core.head_of(self.repo)),spec)
        summary = core.summary(spec)
        self.assertIn('sequenceDiagram',summary); self.assertIn('Return the response',summary)
        self.assertIn('Execution flows',core.brief(spec))
        original = copy.deepcopy(spec); del original['scenarios']
        remove = proposals.create(spec,original,dict(headSha=core.head_of(self.repo)),'Remove the recorded path.')
        self.assertEqual(proposals.apply(spec,remove,core.head_of(self.repo))['scenarios'],[])
    def test_execution_scenarios_reject_inconsistent_paths_and_links(self):
        for mutate in (lambda s:s['scenarios'][0]['intended'][0].update(relationId='missing'), lambda s:s['scenarios'][0]['current'].append(dict(id='bad',relationId='account-billing')), lambda s:s['scenarios'][0]['intended'].reverse(), lambda s:s['scenarios'][0]['intended'].append(s['scenarios'][0]['intended'][0]), lambda s:s['relations'][0]['paths'].append('../secret'), lambda s:s['relations'][0]['evidenceIds'].append('missing'), lambda s:s['relations'][0]['decisionIds'].append('missing'), lambda s:s['scenarios'][0].update(current=[],intended=[])):
            with self.subTest(mutate=mutate):
                spec=self.flow_spec();mutate(spec);self.assertTrue(core.validate_spec(spec))
    def test_writing_checks_are_advisory_and_preserve_text(self):
        from navocode.writing import check_writing
        spec=self.flow_spec();spec['intent']=' '.join(['word']*26)+'.';spec['scenarios'][0]['intended'][0]['description']=' '.join(['action']*21)+'.'
        before=copy.deepcopy(spec);warnings=check_writing(spec)
        self.assertTrue(any(w['field']=='intent' and w['limit']==25 for w in warnings))
        self.assertTrue(any(w['limit']==20 for w in warnings));self.assertEqual(spec,before)
        core.assert_spec(spec)
    def test_draft_is_not_ready(self):
        draft = core.draft(self.repo,'new','New request','Design something'); self.assertTrue(draft['unknowns']); self.assertFalse(core.readiness(draft,self.repo)['ready'])
    def test_renames_and_deletions_have_coverage(self):
        core.git(self.repo,'mv','billing.txt','payer.txt'); self.assertEqual(core.changed_files(self.repo,self.base),['billing.txt','payer.txt'])
    def test_canonical_hash_ignores_keys_not_array_order(self):
        self.assertEqual(core.digest(dict(a=1,b=2)),core.digest(dict(b=2,a=1))); self.assertNotEqual(core.digest([1,2]),core.digest([2,1]))
    def test_bind_never_refreshes_evidence(self):
        (self.repo/'billing.txt').write_text('New contract'); report=json.loads(self.cli('bind','--repo',self.repo,'--spec',self.path).stdout); self.assertTrue(report['fresh']); self.assertEqual(report['staleEvidence'],['source-check'])
    def test_invalid_validation_exit(self):
        (self.repo/'other.txt').write_text('New'); self.assertEqual(self.cli('validate','--repo',self.repo,'--spec',self.path,check=False).returncode,1)
    def test_symlinks_not_external_contents_are_hashed(self):
        (self.repo/'external').symlink_to('/not/a/real/file'); self.assertTrue(core.source_digest(self.repo).startswith('sha256:'))
    def test_proposal_roundtrip_and_baseline_preservation(self):
        proposal=self.proposal(); result=proposals.apply(self.spec,proposals.parse(proposals.comment(proposal)),core.head_of(self.repo)); self.assertNotEqual(self.spec['decisions'][0]['choice'],result['decisions'][0]['choice'])
    def test_stale_head_and_spec_are_rejected(self):
        proposal=self.proposal()
        with self.assertRaisesRegex(ValueError,'Stale'):proposals.apply(self.spec,proposal,'a'*40)
        self.spec['intent']+='Changed'
        with self.assertRaisesRegex(ValueError,'Stale'):proposals.apply(self.spec,proposal,core.head_of(self.repo))
    def test_precondition_conflict(self):
        proposal=self.proposal();proposal['operations'][0]['expected']='wrong'
        with self.assertRaisesRegex(ValueError,'Conflict'):proposals.apply(self.spec,proposal,core.head_of(self.repo))
    def test_invalid_proposal_targets_and_values(self):
        for mutate in (lambda p:p['operations'][0].update(collection='__proto__'),lambda p:p['operations'].append(p['operations'][0]),lambda p:p['operations'][0]['value'].update(choice=1),lambda p:p.update(rationale='x'*30000)):
            p=self.proposal();mutate(p)
            with self.assertRaises(ValueError):proposals.validate(p)
    def test_dangling_deletion_rejected(self):
        proposal=self.proposal(); component=next(c for c in self.spec['components'] if c['id']=='billing'); proposal['operations']=[dict(collection='components',id='billing',expected=core.digest(component),value=None)]
        with self.assertRaisesRegex(ValueError,'missing'):proposals.apply(self.spec,proposal,core.head_of(self.repo))
    def test_comment_html_and_fences_roundtrip(self):
        proposal=self.proposal();proposal['rationale']='```json\n{}\n```</details>';proposal['operations'][0]['value']['choice']='</details><script>bad()</script>'
        self.assertEqual(proposals.parse(proposals.comment(proposal)),proposal)
    def test_github_publication_verified_and_idempotent(self):
        p=self.proposal(True); comments=[]
        def runner(args,data=None):
            if 'repos/owner/repo/pulls/7' in args:return json.dumps(dict(head=dict(sha=p['base']['headSha']),state='open'))
            if args==['api','user']:return '{"id":42}'
            if 'POST' in args:
                entry=dict(id=9,body=json.loads(data)['body'],user=dict(id=42),html_url='https://github.com/owner/repo/pull/7#issuecomment-9');comments.append(entry);return json.dumps(entry)
            if 'repos/owner/repo/issues/comments/9' in args:return json.dumps(comments[0])
            return json.dumps([comments])
        self.assertFalse(github.publish(p,runner)['existing']);self.assertTrue(github.publish(p,runner)['existing']);self.assertEqual(len(comments),1)
    def test_remote_head_and_permissions_fail(self):
        p=self.proposal(True)
        with self.assertRaisesRegex(ValueError,'head changed'):github.publish(p,lambda *a:json.dumps(dict(head=dict(sha='a'*40),state='open')))
        def denied(*args):raise ValueError('403 Forbidden')
        with self.assertRaisesRegex(ValueError,'403'):github.publish(p,denied)
    def test_comment_identity_and_author(self):
        p=self.proposal(True);entry=dict(body=proposals.comment(p),issue_url='https://api.github.com/repos/owner/repo/issues/7',user=dict(login='reviewer'),html_url='link')
        self.assertEqual(github.read_proposal('https://github.com/owner/repo/pull/7#issuecomment-9',lambda *a:json.dumps(entry))['author'],'reviewer')
        entry['issue_url']='https://api.github.com/repos/owner/repo/issues/8'
        with self.assertRaisesRegex(ValueError,'identities'):github.read_proposal('https://github.com/owner/repo/pull/7#issuecomment-9',lambda *a:json.dumps(entry))
    def test_feedback_wakes_waiter_redelivers_then_acknowledges(self):
        server,session=self.workspace()
        with ThreadPoolExecutor() as pool:
            waiting=pool.submit(session_request,session,'/api/feedback?wait=2');event=self.feedback(session);self.assertEqual(waiting.result()['events'][0]['id'],event['id'])
        self.assertEqual(len(session_request(session,'/api/feedback?wait=0')['events']),1)
        self.spec['components'][0]['intended']='New responsibility';core.write_json(self.path,self.spec)
        session_request(session,'/api/ack',dict(id=event['id'],message='Design updated'))
        state=session_request(session,'/api/state');self.assertEqual(state['spec']['components'][0]['intended'],'New responsibility');self.assertEqual(state['messages'][0]['text'],'Design updated')
        self.assertEqual(session_request(session,'/api/feedback?wait=0')['events'],[])
    def test_timeout_is_not_acceptance(self):
        server,session=self.workspace();self.assertEqual(session_request(session,'/api/feedback?wait=0')['events'],[])
    def test_token_origin_and_stale_feedback(self):
        server,session=self.workspace()
        for headers,code in [({},401),({'Origin':'https://evil.example','Authorization':'Bearer '+server.token},403)]:
            with self.assertRaises(HTTPError) as error:urlopen(Request(server.origin+'/api/state',headers=headers))
            self.assertEqual(error.exception.code,code)
        with self.assertRaisesRegex(ValueError,'Design changed'):self.feedback(session,revision='stale')
    def test_reviewer_cannot_implement(self):
        server,session=self.workspace('review')
        with self.assertRaisesRegex(ValueError,'Reviewer'):self.feedback(session,'implement')
    def test_implementation_event_requires_engineer_acceptance(self):
        server,session=self.workspace();self.spec['decisions'][0]['status']='proposed';core.write_json(self.path,self.spec)
        with self.assertRaisesRegex(ValueError,'Engineer acceptance'):self.feedback(session,'implement')
    def test_ack_retry_is_idempotent(self):
        server,session=self.workspace();event=self.feedback(session);payload=dict(id=event['id'],message='Response')
        session_request(session,'/api/ack',payload);session_request(session,'/api/ack',payload);self.assertEqual(len(session_request(session,'/api/state')['messages']),1)
    def test_bad_artifact_recovery(self):
        server,session=self.workspace();core.write_json(self.path,{'invalid':True})
        with self.assertRaisesRegex(ValueError,'required'):session_request(session,'/api/state')
        core.write_json(self.path,self.spec);self.assertEqual(session_request(session,'/api/state')['spec']['changeId'],self.spec['changeId'])
    def test_installs_all_hosts_without_node_or_pip_dependencies(self):
        for host in ('codex','claude','cursor','copilot'):
            with self.subTest(host=host):
                project=Path(self.temp.name)/host;project.mkdir();result=install.install(project,host,True);folder=Path(result['installed'])
                help=subprocess.check_output([sys.executable,str(folder/'scripts/navocode.py'),'help'],text=True);self.assertIn('proposal publish',help)
                self.assertEqual(len(list(folder.rglob('SKILL.md'))),1)
                install.install(project,host,True);install.uninstall(project,host);self.assertFalse(folder.exists())
    def test_install_preserves_local_edits(self):
        project=Path(self.temp.name)/'project';project.mkdir();(project/'AGENTS.md').write_text('Existing instructions')
        result=install.install(project,'codex');(Path(result['installed'])/'SKILL.md').write_text('Local edits')
        with self.assertRaisesRegex(ValueError,'local edits'):install.install(project,'codex')
        with self.assertRaisesRegex(ValueError,'local edits'):install.uninstall(project,'codex')
        self.assertEqual((project/'AGENTS.md').read_text(),'Existing instructions')
    def test_adoption_invalidates_old_implementation_claims(self):
        path=self.repo/'.navocode/proposal.json';core.write_json(path,self.proposal());self.cli('adopt','--repo',self.repo,'--spec',self.path,'--proposal',path)
        adopted=core.read_json(self.path);self.assertTrue(all(not c['observed'] for c in adopted['components']));self.assertEqual(adopted['evidence'][0]['status'],'unverified')
    def test_detached_cli_transport_and_node_launcher(self):
        result=json.loads(self.cli('start','--agent','manual','--repo',self.repo,'--spec',self.path).stdout);self.addCleanup(lambda:session_request(result['session'],'/api/stop',{}))
        event=self.feedback(result['session']);data=json.loads(self.cli('feedback','--session',result['session'],'--wait','0').stdout);self.assertEqual(data['events'][0]['id'],event['id'])
        if shutil.which('node'):
            text=subprocess.check_output(['node',str(ROOT/'bin/navocode.js'),'help'],text=True);self.assertIn('NavoCode 0.2.0',text)
    def test_review_candidates_exclude_historical_and_uncovered_specs(self):
        historical=copy.deepcopy(self.spec);historical.update(changeId='historical',sourceDigest='sha256:'+'0'*64)
        core.write_json(self.repo/'.navocode/changes/historical/spec.json',historical)
        incomplete=copy.deepcopy(self.spec);incomplete['groups'][0]['paths']=[]
        core.write_json(self.repo/'.navocode/changes/incomplete/spec.json',incomplete)
        candidates=github.review_candidates(self.repo,['delegated-billing','historical','incomplete'])
        self.assertEqual([c['id'] for c in candidates if c['applicable']],['delegated-billing'])
        alternative=copy.deepcopy(self.spec);alternative['changeId']='alternative'
        core.write_json(self.repo/'.navocode/changes/alternative/spec.json',alternative)
        self.assertEqual(len([c for c in github.review_candidates(self.repo,['delegated-billing','alternative']) if c['applicable']]),2)
    def test_review_cli_opens_workspace_by_default_and_supports_prepare_only(self):
        prepared=dict(repo=str(self.repo),spec=str(self.path),baseline='baseline.json')
        workspace=dict(session='session.json',url='http://127.0.0.1:1234/#token')
        with patch.object(github,'prepare_review',return_value=prepared),patch.object(cli,'start',return_value=workspace) as start:
            stream=StringIO()
            with redirect_stdout(stream): cli.main(['review','https://github.com/owner/repo/pull/7'])
            self.assertEqual(json.loads(stream.getvalue())['workspace'],workspace)
            self.assertEqual(start.call_args.args[0],dict(repo=str(self.repo),spec=str(self.path),baseline='baseline.json',mode='review',open=True,agent='auto',host=None,agent_command=None,agent_session=None))
            start.reset_mock()
            with redirect_stdout(StringIO()): cli.main(['review','https://github.com/owner/repo/pull/7','--prepare-only'])
            start.assert_not_called()
        with patch.object(github,'prepare_review',return_value=dict(specs=['one','two'])),patch.object(cli,'start') as start:
            with redirect_stdout(StringIO()): cli.main(['review','https://github.com/owner/repo/pull/7'])
            start.assert_not_called()
    def test_git_author_review_adoption_lifecycle(self):
        (self.repo/'billing.py').write_text('def payer(account, delegated=None):\n    return delegated or account\n')
        self.spec['groups'][0]['paths'].append('billing.py')
        self.spec['sourceDigest']=core.source_digest(self.repo)
        self.spec['evidence'][0]['sourceDigest']=self.spec['sourceDigest']
        core.write_json(self.path,self.spec)
        historical=copy.deepcopy(self.spec);historical.update(changeId='historical',sourceDigest='sha256:'+'0'*64)
        core.write_json(self.repo/'.navocode/changes/historical/spec.json',historical)
        remote=Path(self.temp.name)/'remote';remote.mkdir();core.git(remote,'init','--bare','-q');core.git(self.repo,'checkout','-qb','feature');core.git(self.repo,'add','.');core.git(self.repo,'commit','-qm','Author source and specs');core.git(self.repo,'remote','add','origin',str(remote));core.git(self.repo,'push','-q','origin','feature','HEAD:refs/pull/7/head')
        first=core.head_of(self.repo)
        def runner(args,data=None):
            if args[0]=='repo':core.run(['git','clone','--quiet','--no-checkout',str(remote),args[3]]);return ''
            return json.dumps(dict(head=dict(sha=first),base=dict(sha=self.base),state='open'))
        review=github.prepare_review('https://github.com/owner/repo/pull/7',runner=runner);self.addCleanup(__import__('shutil').rmtree,review['folder'])
        self.assertEqual(review['specPath'],'.navocode/changes/delegated-billing/spec.json')
        self.assertTrue(review['report']['fresh']);baseline=core.read_json(review['baseline']);next_spec=copy.deepcopy(baseline);next_spec['decisions'][0]['choice']='Billing validates ownership.'
        p=proposals.create(baseline,next_spec,review,'Validate ownership.');accepted=proposals.apply(core.read_json(self.path),p,first);core.write_json(self.path,accepted)
        self.assertEqual(core.head_of(self.repo),first)
        (self.repo/'billing.txt').write_text('Billing validates the delegated owner and retains the fallback.')
        (self.repo/'billing.py').write_text('def payer(account, delegated=None):\n    selected = account if delegated is None else delegated\n    if not isinstance(selected, str) or not selected.strip():\n        raise ValueError("Invalid owner")\n    return selected\n')
        checks = '''from billing import payer
assert payer('account') == 'account'
assert payer('account', 'delegate') == 'delegate'
for invalid in ('', '   ', 0, False):
    try: payer('account', invalid)
    except ValueError: pass
    else: raise AssertionError('Invalid ownership accepted')
'''
        subprocess.check_call([sys.executable,'-B','-c',checks],cwd=self.repo)
        accepted['sourceDigest']=core.source_digest(self.repo);accepted['evidence'][0]['sourceDigest']=accepted['sourceDigest'];core.write_json(self.path,accepted)
        core.git(self.repo,'add','.');core.git(self.repo,'commit','-qm','Adopt review proposal');core.git(self.repo,'push','-q','origin','feature')
        self.assertEqual(core.git(remote,'rev-parse','refs/heads/feature').strip(),core.head_of(self.repo))
        with self.assertRaisesRegex(ValueError,'Stale'):proposals.apply(accepted,p,core.head_of(self.repo))

if __name__=='__main__':unittest.main()
