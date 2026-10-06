"""Host-owned same-chat delivery, correlation, and reconnect tests."""
import json
from pathlib import Path
import sys
import subprocess
import unittest
from unittest.mock import patch
import test_agent
from navocode.agent import resolve_agent
from navocode.host import HostAgentRunner
from navocode.core import read_json, write_json

FAKE_HOST = Path(__file__).with_name('fake_host.py')

class HostTests(unittest.TestCase):
    def setUp(self): test_agent.AgentTests.setUp(self)
    def runner(self, host):
        runner = HostAgentRunner(host,[sys.executable,str(FAKE_HOST)],timeout=2,session_id=test_agent.SESSION)
        runner.poll_interval=.01
        return runner
    def workspace(self):
        from types import SimpleNamespace
        return SimpleNamespace(repo=str(self.repo),spec_path=str(self.path),baseline=None,mode='author')
    def event(self,text='Question'): return dict(id='test-event',action='ask',text=text)
    def test_same_owner_delivery_and_original_context_for_all_four_hosts(self):
        for host in ('codex','claude','cursor','copilot'):
            with self.subTest(host=host):
                runner=self.runner(host)
                event=self.event('Recall original conversation');event['id']=host
                self.assertEqual(runner.respond(self.workspace(),event,[]),'The original chat chose authorization as the policy owner.')
                self.assertEqual(read_json(self.repo/'.navocode/local/fake-chat.json')['id'],test_agent.SESSION)
    def test_uncertain_submission_reconnects_without_duplicate_message(self):
        runner=self.runner('codex'); event=self.event('disconnect once')
        with self.assertRaisesRegex(ValueError,'connection closed'): runner.respond(self.workspace(),event,[])
        self.assertEqual(runner.respond(self.workspace(),event,[]),'Host reply: disconnect once')
        self.assertEqual(read_json(self.repo/'.navocode/local/fake-chat.json')['submissions'],1)
    def test_completed_delivery_is_idempotent(self):
        runner=self.runner('claude'); event=self.event()
        self.assertEqual(runner.respond(self.workspace(),event,[]),'Host reply: Question')
        self.assertEqual(runner.respond(self.workspace(),event,[]),'Host reply: Question')
        self.assertEqual(read_json(self.repo/'.navocode/local/fake-chat.json')['submissions'],1)
    def test_active_owner_is_waited_for_and_unrelated_reply_is_not_accepted(self):
        path=self.repo/'.navocode/local/fake-chat.json';chat=read_json(path)
        chat.update(busyReads=3,turns=[dict(id='old-turn',status='completed',items=[dict(type='agentMessage',phase='final_answer',text='Unrelated reply')])])
        write_json(path,chat)
        self.assertEqual(self.runner('cursor').respond(self.workspace(),self.event(),[]),'Host reply: Question')
        self.assertGreaterEqual(read_json(path)['reads'],5)
        self.assertEqual(read_json(path)['submissions'],1)
    def test_wrong_chat_read_prevents_submission(self):
        path=self.repo/'.navocode/local/fake-chat.json';chat=read_json(path);chat['wrongThread']=True;write_json(path,chat)
        with self.assertRaisesRegex(ValueError,'different chat'):
            self.runner('codex').respond(self.workspace(),self.event(),[])
        self.assertNotIn('submissions',read_json(path))
    def test_permission_rejection_never_falls_back_to_cli(self):
        runner=self.runner('copilot')
        with self.assertRaisesRegex(ValueError,'Permission denied'): runner.respond(self.workspace(),self.event('reject'),[])
        self.assertNotIn('submissions',read_json(self.repo/'.navocode/local/fake-chat.json'))
        self.assertEqual(read_json(self.repo/'.navocode/local/last-agent-error.json')['transport'],'host')
    def test_resolution_uses_explicit_host_command_for_every_host(self):
        for host in ('codex','claude','cursor','copilot'):
            runner=resolve_agent(host,session_id=test_agent.SESSION,host_command=json.dumps([sys.executable,str(FAKE_HOST)]))
            self.assertIsInstance(runner,HostAgentRunner)
            self.assertEqual(runner.transport,'host')
            self.assertNotIn('resume',runner.command)
        runner=resolve_agent('copilot',session_id='user-task-existing-session',host_command=[sys.executable,str(FAKE_HOST)])
        self.assertEqual(runner.session_id,'user-task-existing-session')
        with patch.dict('os.environ',{'NAVOCODE_HOST_MCP_COMMAND':json.dumps([sys.executable,str(FAKE_HOST)])}):
            self.assertIsNone(resolve_agent('manual'))
            self.assertEqual(resolve_agent('custom',command=[sys.executable],session_id='existing-chat').transport,'cli')
    def test_detached_launcher_wires_host_transport_to_workspace_chat(self):
        from navocode.core import ROOT
        from navocode.server import session_request
        import time
        session=self.repo/'.navocode/local/host-session.json'
        output=subprocess.check_output([sys.executable,str(ROOT/'bin/navocode.py'),'start',
            '--repo',str(self.repo),'--spec',str(self.path),'--session',str(session),
            '--agent','cursor','--agent-session',test_agent.SESSION,'--agent-host-command',
            json.dumps([sys.executable,str(FAKE_HOST)])],text=True)
        self.addCleanup(lambda:session_request(session,'/api/stop',{}))
        self.assertEqual(json.loads(output)['agentTransport'],'host')
        state=session_request(session,'/api/state')
        event=session_request(session,'/api/events',dict(action='ask',target='whole-change',
                          text='Question',revision=state['revision']))
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            state=session_request(session,'/api/state')
            if state['messages']:break
            time.sleep(.02)
        self.assertEqual(state['messages'][0]['text'],'Host reply: Question')
        self.assertEqual(state['messages'][0]['eventId'],event['id'])
        self.assertEqual(state['agent']['transport'],'host')
