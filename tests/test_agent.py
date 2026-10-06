"""Cross-host background turn and HTTP lifecycle regression tests."""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import patch
import test_runtime
from navocode.agent import AgentRunner, detect_host, resolve_agent, session_id_for, session_lock
from navocode.core import ROOT, read_json, write_json
from navocode.server import Workspace, session_request

FAKE = Path(__file__).with_name('fake_agent.py')
SESSION = '00000000-0000-0000-0000-000000000123'

class AgentTests(unittest.TestCase):
    def setUp(self):
        test_runtime.RuntimeTests.setUp(self)
        write_json(self.repo/'.navocode/local/fake-chat.json', dict(id=SESSION, originalContext='The original chat chose authorization as the policy owner.'))
    def feedback(self, session, **kwargs): return test_runtime.RuntimeTests.feedback(self, session, **kwargs)
    def workspace(self, provider='custom', timeout=5):
        runner = AgentRunner(provider, [sys.executable, str(FAKE), '--fake-provider', provider], timeout, session_id=SESSION)
        with patch('navocode.server.resolve_agent', return_value=runner):
            server = Workspace(self.path, self.repo, agent=provider)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close); self.addCleanup(server.shutdown)
        session = self.repo / '.navocode/local/session.json'; write_json(session, server.descriptor())
        return server, session
    def wait_event(self, session, identifier, status='handled'):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            state = session_request(session, '/api/state')
            event = next(e for e in state['events'] if e['id'] == identifier)
            if event['status'] == status: return state
            time.sleep(.02)
        self.fail(f'Event did not reach {status}: {state}')
    def test_all_hosts_reply_after_previous_turn_ends_without_polling(self):
        for provider in ('codex', 'claude', 'cursor', 'copilot', 'custom'):
            with self.subTest(provider=provider):
                server, session = self.workspace(provider)
                first = self.feedback(session, text='First question')
                state = self.wait_event(session, first['id'])
                self.assertEqual(state['messages'][-1]['text'], 'Reply: First question')
                self.assertEqual(state['agent']['status'], 'ready')
                second = self.feedback(session, text='Second question')
                state = self.wait_event(session, second['id'])
                self.assertEqual(state['messages'][-1]['text'], 'Reply: Second question | Previous reply: Reply: First question')
                self.assertEqual(len(state['messages']), 2)
                self.assertEqual(server.last_read, 0, 'No parent agent poll is needed')
                with self.assertRaisesRegex(ValueError, 'automatically'): session_request(session, '/api/feedback?wait=0')
                with self.assertRaisesRegex(ValueError, 'owns acknowledgements'): session_request(session, '/api/ack', dict(id=first['id'], message='Duplicate'))
    def test_queued_messages_are_serial_and_exactly_once(self):
        server, session = self.workspace()
        events = [self.feedback(session, text=f'Question {i}') for i in range(6)]
        state = self.wait_event(session, events[-1]['id'])
        self.assertEqual([m['eventId'] for m in state['messages']], [e['id'] for e in events])
        self.assertEqual(len(state['messages']), 6)
    def test_failure_visible_and_explicit_retry_returns_one_reply(self):
        server, session = self.workspace()
        event = self.feedback(session, text='fail once'); state = self.wait_event(session, event['id'], 'failed')
        self.assertEqual(state['agent']['status'], 'error'); self.assertEqual(state['messages'], [])
        self.assertIn('could not complete', state['events'][0]['error'])
        session_request(session, '/api/retry', dict(id=event['id']))
        state = self.wait_event(session, event['id']); self.assertEqual(len(state['messages']), 1)
        self.assertEqual(state['agent']['status'], 'ready')
        with self.assertRaisesRegex(ValueError, 'Only failed'): session_request(session, '/api/retry', dict(id=event['id']))
    def test_empty_reply_is_failure_not_acknowledgement(self):
        server, session = self.workspace()
        event = self.feedback(session, text='empty reply'); state = self.wait_event(session, event['id'], 'failed')
        self.assertEqual(state['messages'], []); self.assertIn('without a reply', state['events'][0]['error'])
    def test_structured_failure_exposes_actual_reason_and_saves_diagnostic(self):
        server, session = self.workspace('codex')
        event = self.feedback(session, text='structured failure')
        state = self.wait_event(session, event['id'], 'failed')
        self.assertIn('Model unavailable for this account.', state['events'][0]['error'])
        self.assertNotIn('Telemetry warning', state['events'][0]['error'])
        diagnostic = self.repo/'.navocode/local/last-agent-error.json'
        record = read_json(diagnostic)
        self.assertEqual(record['eventId'], event['id'])
        self.assertEqual(record['sessionId'], SESSION)
        self.assertEqual(record['exitCode'], 1)
        self.assertEqual(record['detail'], 'Model unavailable for this account.')
        if os.name == 'posix': self.assertEqual(diagnostic.stat().st_mode & 0o777, 0o600)
    def test_stderr_failure_is_visible_with_credentials_redacted_for_every_host(self):
        for provider in ('codex','claude','cursor','copilot','custom'):
            with self.subTest(provider=provider), patch.dict(os.environ, {'NAVOCODE_TEST_API_KEY':'private-test-credential'}):
                server, session = self.workspace(provider)
                event = self.feedback(session, text='stderr failure')
                state = self.wait_event(session, event['id'], 'failed')
                error = state['events'][0]['error']
                self.assertIn('Session not found.', error)
                self.assertIn('[redacted]', error)
                self.assertNotIn('private-test-credential', error)
                self.assertNotIn('private-test-credential', (self.repo/'.navocode/local/last-agent-error.json').read_text())
    def test_timeout_kills_process_and_exposes_failure(self):
        server, session = self.workspace(timeout=.1)
        event = self.feedback(session, text='block'); state = self.wait_event(session, event['id'], 'failed')
        self.assertIn('timed out', state['events'][0]['error']); self.assertIsNone(server.agent.process)
    def test_stop_cancels_running_process(self):
        server, session = self.workspace()
        event = self.feedback(session, text='block')
        marker = self.repo / '.navocode/local/fake-running'
        deadline = time.monotonic() + 3
        while not marker.exists() and time.monotonic() < deadline: time.sleep(.02)
        self.assertTrue(marker.exists()); process = server.agent.process
        session_request(session, '/api/stop', {})
        self.assertIsNotNone(process.wait(timeout=3)); self.assertTrue(server.agent.closed)
    def test_retry_rejects_changed_spec(self):
        server, session = self.workspace()
        event = self.feedback(session, text='fail once'); self.wait_event(session, event['id'], 'failed')
        self.spec['intent'] += ' Changed'; write_json(self.path, self.spec)
        with self.assertRaisesRegex(ValueError, 'Design changed'): session_request(session, '/api/retry', dict(id=event['id']))
    def test_done_finishes_without_a_model_call(self):
        server, session = self.workspace()
        event = self.feedback(session, action='done')
        state = self.wait_event(session, event['id']); self.assertEqual(state['agent']['status'], 'finished')
        self.assertFalse((self.repo / '.navocode/local/fake-invocations.jsonl').exists())
        with self.assertRaisesRegex(ValueError, 'finished'): self.feedback(session)
    def test_implementation_gate_still_applies_to_automatic_runner(self):
        server, session = self.workspace()
        self.spec['decisions'][0]['status'] = 'proposed'; write_json(self.path, self.spec)
        with self.assertRaisesRegex(ValueError, 'Engineer acceptance'): self.feedback(session, action='implement')
    def test_invocations_do_not_interpret_human_text_as_shell(self):
        prompt = '$(touch should-not-exist) `echo hidden` ; newline\n'
        for provider in ('codex','claude','cursor','copilot','custom'):
            with self.subTest(provider=provider):
                runner = AgentRunner(provider, ['binary'], session_id=SESSION)
                args, stdin = runner.invocation(dict(action='ask'), prompt, Path('/tmp/reply'))
                if provider == 'cursor':
                    self.assertIn('/tmp/prompt.txt', args[-1]); self.assertIsNone(stdin)
                else: self.assertEqual(stdin.decode(), prompt)
                self.assertNotIn('--force', args); self.assertNotIn('--allow-all-tools', args)
                self.assertNotIn('--dangerously-bypass-approvals-and-sandbox', args)
    def test_installed_host_detection_for_every_host(self):
        for host in ('codex','claude','cursor','copilot'):
            folder = self.repo / host; (folder / 'runtime').mkdir(parents=True)
            write_json(folder / '.navocode-install.json', dict(host=host))
            with patch.dict(os.environ, {'CODEX_THREAD_ID':'unrelated-parent'}):
                self.assertEqual(detect_host(folder / 'runtime'), host)
    def test_custom_command_validation_and_explicit_host_selection(self):
        with patch('navocode.agent.shutil.which', return_value=sys.executable):
            runner = resolve_agent('custom', command=json.dumps([sys.executable,str(FAKE)]), session_id=SESSION)
            self.assertEqual(runner.mode, 'custom')
            for host in ('codex','claude','cursor','copilot'):
                with patch.dict(os.environ, {}, clear=True):
                    self.assertEqual(resolve_agent('auto',host=host,session_id=SESSION).mode,host)
        for command in ('"shell command"','[]','[null]'):
            with self.assertRaises(ValueError): resolve_agent('custom',command=command)
        with patch('navocode.agent.shutil.which', return_value=None), patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError,'unavailable'): resolve_agent('copilot')
    def test_detached_custom_runner_cli_works_after_launcher_exits(self):
        args = [sys.executable, str(ROOT/'bin/navocode.py'),'start','--repo',str(self.repo),'--spec',str(self.path),
                '--agent','custom','--agent-session',SESSION,'--agent-command',json.dumps([sys.executable,str(FAKE)])]
        result = json.loads(subprocess.check_output(args, text=True))
        self.addCleanup(lambda: session_request(result['session'], '/api/stop', {}))
        event = self.feedback(result['session'],text='Launcher has exited')
        state = self.wait_event(result['session'],event['id'])
        self.assertEqual(state['messages'][0]['text'],'Reply: Launcher has exited')
        self.assertEqual(result['agentMode'],'custom'); self.assertEqual(result['agentSession'],SESSION)

    def test_original_chat_context_is_available_to_every_resumed_host(self):
        for provider in ('codex','claude','cursor','copilot','custom'):
            with self.subTest(provider=provider):
                server, session = self.workspace(provider)
                event = self.feedback(session, text='Recall original conversation')
                state = self.wait_event(session,event['id'])
                self.assertEqual(state['messages'][-1]['text'],'The original chat chose authorization as the policy owner.')
                self.assertEqual(state['agent']['sessionId'],SESSION)
                self.assertEqual(read_json(session)['agentSession'],SESSION)
                invocation = json.loads((self.repo/'.navocode/local/fake-invocations.jsonl').read_text().splitlines()[-1])
                self.assertEqual(invocation['context']['agentSession'],SESSION)
                self.assertEqual(invocation['context']['continuation'],'resume')
                self.assertNotIn('--ephemeral',invocation['args']); self.assertNotIn('--no-session-persistence',invocation['args'])
                self.assertNotIn('--continue',invocation['args']); self.assertNotIn('--last',invocation['args'])
    def test_missing_or_partial_session_ids_never_start_a_new_chat(self):
        with patch.dict(os.environ, {}, clear=True):
            for provider in ('codex','claude','cursor','copilot','custom'):
                with self.assertRaisesRegex(ValueError,'Original chat ID required'): AgentRunner(provider,['binary'])
            for provider in ('codex','claude','copilot'):
                with self.assertRaisesRegex(ValueError,'full original chat UUID'): AgentRunner(provider,['binary'],session_id='12345678')
        with patch.dict(os.environ, {'CODEX_THREAD_ID':SESSION},clear=True):
            self.assertEqual(session_id_for('codex'),SESSION)
            with self.assertRaises(ValueError): session_id_for('claude')
        other='00000000-0000-0000-0000-000000000321'
        with patch.dict(os.environ, {'CODEX_THREAD_ID':SESSION,'NAVOCODE_AGENT_SESSION':other},clear=True):
            self.assertEqual(session_id_for('codex'),other)
            self.assertEqual(session_id_for('codex',SESSION),SESSION)
    def test_unavailable_original_chat_fails_without_creating_a_replacement(self):
        for provider in ('codex','claude','cursor','copilot','custom'):
            with self.subTest(provider=provider):
                server, session = self.workspace(provider)
                (self.repo/'.navocode/local/fake-chat.json').unlink(missing_ok=True)
                event=self.feedback(session,text='Question'); state=self.wait_event(session,event['id'],'failed')
                self.assertEqual(state['messages'],[])
                self.assertFalse((self.repo/'.navocode/local/fake-chat.json').exists())
    def test_native_result_rejects_a_different_chat_id(self):
        for provider in ('codex','claude'):
            with self.subTest(provider=provider):
                server,session=self.workspace(provider)
                event=self.feedback(session,text='wrong chat'); state=self.wait_event(session,event['id'],'failed')
                self.assertIn('did not resume the bound chat',state['events'][0]['error'])
                self.assertEqual(state['messages'],[])
    def test_multiple_workspaces_cannot_resume_the_same_chat_concurrently(self):
        server,session=self.workspace()
        with session_lock('custom',SESSION):
            event=self.feedback(session,text='Question'); state=self.wait_event(session,event['id'],'failed')
            self.assertIn('another NavoCode workspace',state['events'][0]['error'])
        session_request(session,'/api/retry',dict(id=event['id']))
        self.wait_event(session,event['id'])
