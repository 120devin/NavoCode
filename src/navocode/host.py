"""Same-owner messaging through an explicitly connected host MCP server.

The MCP server must expose send_message_to_thread and read_thread. It owns
authorization and session lifecycle; this client never starts/resumes a thread.
"""
import hashlib
import json
import os
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
import time
import uuid
from .agent import AgentRunner, cli_failure_detail
from .core import read_json, write_json


class McpClient:
    def __init__(self, runner, repo):
        self.runner = runner
        self.responses = queue.Queue()
        self.counter = 0
        self.stderr = tempfile.TemporaryFile()
        with runner.lock:
            if runner.closed: raise ValueError('Workspace agent stopped')
            self.process = subprocess.Popen(runner.command, cwd=repo, stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=self.stderr, start_new_session=True)
            runner.process = self.process
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        try:
            while True:
                line = self.process.stdout.readline(2 * 1024 * 1024 + 1)
                if not line: break
                if len(line) > 2 * 1024 * 1024: raise ValueError('Host response exceeds 2 MiB')
                item = json.loads(line)
                if not isinstance(item, dict): raise ValueError('Invalid host MCP response')
                self.responses.put(item)
        except Exception as error: self.responses.put(error)
        finally: self.responses.put(EOFError('Host messaging connection closed. Check its client authorization and MCP configuration.'))

    def request(self, method, params, deadline):
        self.counter += 1
        identifier = self.counter
        try:
            self.process.stdin.write((json.dumps(dict(jsonrpc='2.0', id=identifier, method=method, params=params)) + '\n').encode())
            self.process.stdin.flush()
        except (BrokenPipeError, OSError): raise ValueError('Host messaging connection closed before submission.') from None
        while time.monotonic() < deadline:
            if self.runner.closed: raise ValueError('Workspace stopped. A submitted host turn may still continue in the assistant.')
            try: message = self.responses.get(timeout=min(.2, max(.001, deadline-time.monotonic())))
            except queue.Empty: continue
            if isinstance(message, Exception): raise ValueError(str(message)) from None
            if 'method' in message and 'id' in message:
                # Do not auto-approve host requests or execute host tools on its behalf.
                self.process.stdin.write((json.dumps(dict(jsonrpc='2.0', id=message['id'], error=dict(code=-32601, message='Host must handle its own permissions.'))) + '\n').encode())
                self.process.stdin.flush()
                continue
            if message.get('id') != identifier: continue
            if 'error' in message: raise ValueError(str(message['error'].get('message', 'Host request failed')))
            return message.get('result', {})
        raise ValueError('Host messaging timed out. Retrying reconnects to a submitted message; it will not submit it twice.')

    def initialize(self, deadline):
        self.request('initialize', dict(protocolVersion='2024-11-05', capabilities={},
                     clientInfo=dict(name='navocode', version='0.2.0')), deadline)
        self.process.stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
        self.process.stdin.flush()
        catalog = self.request('tools/list', {}, deadline)
        available = {tool['name'] for tool in catalog.get('tools', [])}
        if not {'send_message_to_thread', 'read_thread'} <= available:
            raise ValueError('Host MCP must expose send_message_to_thread and read_thread for the original chat.')

    def call(self, name, args, deadline):
        result = self.request('tools/call', dict(name=name, arguments=args,
            _meta={'openai/threadId': self.runner.session_id}), deadline)
        content = result.get('content', [])
        text = '\n'.join(c.get('text','') for c in content if c.get('type') == 'text')
        if result.get('isError'): raise ValueError(text or 'Host tool rejected this request')
        if isinstance(result.get('structuredContent'), dict): return result['structuredContent']
        try: parsed = json.loads(text)
        except ValueError: raise ValueError('Host tool did not return structured conversation data') from None
        if not isinstance(parsed, dict): raise ValueError('Invalid host conversation data')
        return parsed

    def close(self):
        with self.runner.lock:
            # Terminate only our MCP client, never the owning assistant process.
            self.runner._terminate()
        self.process.wait()
        for stream in (self.process.stdin, self.process.stdout): stream.close()
        self.stderr.close()
        with self.runner.lock: self.runner.process = None


def item_text(item):
    if item.get('type') in ('userMessage', 'steeringUserMessage'):
        return '\n'.join(c.get('text','') for c in item.get('content', []) if c.get('type') == 'text')
    if item.get('type') == 'functionCallOutput':
        output = item.get('output', '')
        return output if isinstance(output, str) else json.dumps(output)
    return ''


class HostAgentRunner(AgentRunner):
    transport = 'host'
    poll_interval = 2

    def __init__(self, mode, command, timeout=600, session_id=None):
        # A host SDK may use exact opaque IDs (for example Copilot named SDK sessions).
        super().__init__('custom', command, timeout, session_id)
        self.mode = mode

    def read(self, client, deadline):
        state = client.call('read_thread', dict(threadId=self.session_id, turnLimit=20,
                            includeOutputs=True, maxOutputCharsPerItem=20000), deadline)
        if state.get('thread', {}).get('id') != self.session_id:
            raise ValueError('Host returned a different chat. No workspace reply was accepted.')
        return state

    def _respond(self, workspace, event, history):
        deadline = time.monotonic() + self.timeout
        folder = Path(workspace.repo)/'.navocode/local'
        key = hashlib.sha256((self.mode+':'+self.session_id+':'+event['id']).encode()).hexdigest()
        record_path = folder/'host-deliveries'/(key+'.json')
        record = read_json(record_path) if record_path.exists() else None
        if record and record.get('status') == 'completed': return record['reply']
        if not record or record.get('status') == 'failed':
            marker = 'NavoCode workspace message '+str(uuid.uuid4())
            record = dict(marker=marker, sessionId=self.session_id, eventId=event['id'], status='new')
        client = McpClient(self, workspace.repo)
        try:
            client.initialize(deadline)
            while time.monotonic() < deadline:
                state = self.read(client, deadline)
                turns = state.get('turns', [])
                match = next((turn for turn in turns if any(record['marker'] in item_text(i) for i in turn.get('items', []))), None)
                if match:
                    status = match.get('status')
                    if status in ('failed', 'interrupted'):
                        record.update(status='failed'); write_json(record_path, record)
                        detail = match.get('error') or dict(message='Host turn '+status)
                        raise ValueError(detail.get('message', 'Host turn failed') if isinstance(detail, dict) else str(detail))
                    if status == 'completed':
                        messages = [i for i in match.get('items', []) if i.get('type') == 'agentMessage']
                        finals = [i for i in messages if i.get('phase') in ('final_answer','final')]
                        if not finals: finals = [i for i in messages if i.get('phase') is None]
                        reply = finals[-1].get('text', '').strip() if finals else ''
                        if not reply: raise ValueError('Host finished this message without a final reply.')
                        if len(reply)>20000: raise ValueError('Assistant reply exceeded the workspace limit.')
                        record.update(status='completed', reply=reply); write_json(record_path, record)
                        return reply
                host_status = state.get('thread',{}).get('status',{})
                host_status = host_status.get('type') if isinstance(host_status,dict) else host_status
                busy = host_status in ('active','inProgress','busy') or any(t.get('status') == 'inProgress' for t in turns)
                if record['status'] == 'new' and not busy:
                    # Store before submission: lost connections must not cause duplicate edits.
                    record.update(status='submitting'); write_json(record_path, record)
                    result = client.call('send_message_to_thread', dict(threadId=self.session_id,
                                         prompt=record['marker']+'\n'+self.prompt(workspace,event,history)), deadline)
                    if result.get('threadId') != self.session_id:
                        raise ValueError('Host did not confirm the bound chat. Submission will not be repeated automatically.')
                    record.update(status='submitted'); write_json(record_path, record)
                if self.closed: raise ValueError('Workspace stopped. A submitted host turn may continue in the assistant.')
                time.sleep(min(self.poll_interval, max(0,deadline-time.monotonic())))
            raise ValueError('Host turn timed out. Retry reconnects to the same submitted message without sending it again.')
        except Exception as error:
            # Preserve the reason without exposing credentials returned by a host.
            with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
                err.write(str(error).encode()); err.flush()
                detail = cli_failure_detail(out, err, dict(os.environ))
            write_json(folder/'last-agent-error.json', dict(host=self.mode, transport='host',
                       sessionId=self.session_id, eventId=event['id'], detail=detail))
            raise ValueError(detail) from None
        finally: client.close()
