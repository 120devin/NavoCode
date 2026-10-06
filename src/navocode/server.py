"""Loopback UI and bounded live feedback, using only Python's standard library."""
from copy import deepcopy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import threading
import time
import uuid
from urllib.parse import urlsplit, parse_qs
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from .agent import resolve_agent
from .core import ROOT, MAX_BYTES, read_json, write_json, assert_spec, inspect, digest, require_human_decisions

class Workspace(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, spec_path, repo, mode='author', port=0, baseline=None, agent='manual', host=None, agent_command=None, agent_session=None, agent_host_command=None):
        assert_spec(read_json(spec_path))
        if mode not in ('author', 'review'): raise ValueError('Mode must be author or review')
        self.spec_path, self.repo, self.mode, self.baseline = str(Path(spec_path).resolve()), str(Path(repo).resolve()), mode, baseline
        self.token = secrets.token_hex(24)
        self.events, self.messages, self.last_read = [], [], 0
        self.condition = threading.Condition(); self.waiting = False; self.stopping = False
        self.agent = resolve_agent(agent, host, agent_command, ROOT, agent_session, agent_host_command); self.agent_error = ''; self.agent_busy = False
        super().__init__(('127.0.0.1', port), Handler)
        self.origin = f'http://127.0.0.1:{self.server_address[1]}'
        if self.agent: threading.Thread(target=self.agent_loop, daemon=True).start()
    def descriptor(self):
        return dict(url=self.origin + '/#' + self.token, origin=self.origin, token=self.token, pid=__import__('os').getpid(), specPath=self.spec_path, repo=self.repo, mode=self.mode, baselinePath=self.baseline, agentMode=self.agent.mode if self.agent else 'manual', agentSession=self.agent.session_id if self.agent else None, agentTransport=self.agent.transport if self.agent else 'manual')
    def state(self):
        spec = assert_spec(read_json(self.spec_path))
        try: report = inspect(spec, self.repo)
        except ValueError as error: report = dict(error=str(error), fresh=False)
        with self.condition:
            return dict(spec=spec, mode=self.mode, revision=digest(spec), report=report, baseline=assert_spec(read_json(self.baseline)) if self.baseline else None, events=deepcopy(self.events), messages=deepcopy(self.messages), agentConnected=not self.stopping and (bool(self.agent) or self.waiting), agent=self.agent_state())


    def agent_state(self):
        if self.stopping: return dict(mode=self.agent.mode if self.agent else 'manual', status='finished', error='')
        if self.agent:
            return dict(mode=self.agent.mode, sessionId=self.agent.session_id, transport=self.agent.transport, status='responding' if self.agent_busy else 'error' if self.agent_error else 'ready', error=self.agent_error)
        return dict(mode='manual', status='listening' if self.waiting else 'offline', error='')

    def finish_event(self, event, message):
        # Both manual acknowledgement and automatic completion use the same idempotent path.
        if event['status'] == 'handled': return False
        event['status'] = 'handled'; event.pop('error', None)
        self.messages.append(dict(eventId=event['id'], text=message))
        self.condition.notify_all()
        return True

    def agent_loop(self):
        while True:
            with self.condition:
                self.condition.wait_for(lambda: self.stopping or any(e['status'] == 'pending' for e in self.events))
                if self.stopping: return
                event = next(e for e in self.events if e['status'] == 'pending')
                event['status'] = 'processing'; self.agent_busy = True; self.agent_error = ''
                history = [dict(action=e['action'], target=e['target'], text=e['text'][:2000], replies=[m['text'][:4000] for m in self.messages if m['eventId'] == e['id']]) for e in self.events if e['status'] == 'handled'][-8:]
                request = deepcopy(event)
            try:
                spec = assert_spec(read_json(self.spec_path))
                if event['revision'] != digest(spec): raise ValueError('Design changed before this message was processed. Review it and submit a new message.')
                if event['action'] == 'implement': require_human_decisions(spec)
                reply = 'Session finished.' if event['action'] == 'done' else self.agent.respond(self, request, history)
                assert_spec(read_json(self.spec_path))
                with self.condition:
                    if not self.stopping: self.finish_event(event, reply)
            except Exception as error:
                with self.condition:
                    event['status'] = 'failed'; event['error'] = str(error)
                    self.agent_error = str(error)
            finally:
                with self.condition:
                    self.agent_busy = False
                    if event['action'] == 'done' and event['status'] == 'handled':
                        self.stopping = True; self.condition.notify_all()
                        for queued in self.events:
                            if queued['status'] == 'pending': queued.update(status='cancelled', error='Session finished before this message was processed.')
                    if self.stopping: return

    def server_close(self):
        with self.condition:
            self.stopping = True; self.condition.notify_all()
        if self.agent: self.agent.cancel()
        super().server_close()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def send(self, status, data, content_type='application/json'):
        body = json.dumps(data, ensure_ascii=False).encode() if content_type == 'application/json' else data
        self.send_response(status)
        for key, value in {'Content-Type': content_type, 'Content-Length': str(len(body)), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}.items(): self.send_header(key, value)
        self.end_headers(); self.wfile.write(body)
    def do_GET(self): self.handle_request()
    def do_POST(self): self.handle_request()
    def handle_request(self):
        server = self.server
        try:
            if self.headers.get('Host') != urlsplit(server.origin).netloc or self.headers.get('Origin', server.origin) != server.origin: return self.send(403, dict(error='Invalid host or origin'))
            url = urlsplit(self.path)
            if not url.path.startswith('/api/'):
                files = {'/': ('index.html', 'text/html'), '/app.js': ('app.js', 'text/javascript'), '/style.css': ('style.css', 'text/css'), '/logo.png': ('logo.png', 'image/png')}
                if self.command != 'GET' or url.path not in files: return self.send(404, dict(error='Not found'))
                name, kind = files[url.path]; return self.send(200, (ROOT / 'ui' / name).read_bytes(), kind)
            if not secrets.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + server.token): return self.send(401, dict(error='Session token required'))
            if self.command == 'GET' and url.path == '/api/state': return self.send(200, server.state())
            if self.command == 'GET' and url.path == '/api/feedback':
                wait = min(50, max(0, float(parse_qs(url.query).get('wait', ['0'])[0])))
                with server.condition:
                    if server.agent: return self.send(409, dict(error='The workspace assistant runner handles feedback automatically.'))
                    if server.waiting: return self.send(409, dict(error='Another agent is already waiting'))
                    server.last_read = time.time(); server.waiting = True
                    try:
                        server.condition.wait_for(lambda: server.stopping or any(e['status'] == 'pending' for e in server.events), timeout=wait)
                        result = dict(events=deepcopy([e for e in server.events if e['status'] == 'pending']), revision=digest(assert_spec(read_json(server.spec_path))))
                    finally: server.waiting = False
                return self.send(200, result)
            if self.command != 'POST': return self.send(404, dict(error='Unknown API route'))
            length = int(self.headers.get('Content-Length', '0'))
            if length < 0 or length > MAX_BYTES: return self.send(413, dict(error='Request too large'))
            self.connection.settimeout(10)
            body = json.loads(self.rfile.read(length) or b'{}')
            if not isinstance(body, dict): return self.send(400, dict(error='Expected object'))
            if url.path == '/api/events':
                action = body.get('action')
                if action not in ('ask', 'change', 'accept', 'implement', 'publish', 'done') or not isinstance(body.get('text'), str) or len(body['text']) > 20000 or not isinstance(body.get('target'), str) or len(body['target']) > 100: return self.send(400, dict(error='Invalid feedback'))
                if server.mode == 'review' and action in ('accept', 'implement'): return self.send(400, dict(error='Reviewer sessions publish proposals; adoption owns implementation'))
                if server.mode == 'author' and action == 'publish': return self.send(400, dict(error='Publish proposal is a reviewer action'))
                spec = assert_spec(read_json(server.spec_path))
                if body.get('revision') != digest(spec): return self.send(409, dict(error='Design changed. Review the refreshed view before submitting.'))
                if action == 'implement': require_human_decisions(spec)
                with server.condition:
                    if server.stopping: return self.send(409, dict(error='This session has finished. Start a new workspace session.'))
                    if len(server.events) >= 1000: return self.send(429, dict(error='Session event limit reached'))
                    event = dict(id=str(uuid.uuid4()), action=action, text=body['text'], target=body['target'], revision=body['revision'], status='pending', createdAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
                    server.events.append(event); server.condition.notify_all()
                return self.send(201, event)
            if url.path == '/api/retry':
                with server.condition:
                    event = next((e for e in server.events if e['id'] == body.get('id')), None)
                    if not server.agent or server.stopping: return self.send(409, dict(error='Automatic agent is unavailable'))
                    if event is None: return self.send(404, dict(error='Unknown event'))
                    if event['status'] != 'failed': return self.send(409, dict(error='Only failed messages can be retried'))
                    if event['revision'] != digest(assert_spec(read_json(server.spec_path))): return self.send(409, dict(error='Design changed. Review it and submit a new message.'))
                    event['status'] = 'pending'; event.pop('error', None); server.agent_error = ''; server.condition.notify_all()
                return self.send(200, dict(ok=True))
            if url.path == '/api/ack':
                if not isinstance(body.get('message'), str) or len(body['message']) > 20000: return self.send(400, dict(error='Invalid message'))
                assert_spec(read_json(server.spec_path))
                with server.condition:
                    event = next((e for e in server.events if e['id'] == body.get('id')), None)
                    if event is None: return self.send(404, dict(error='Unknown event'))
                    if server.agent: return self.send(409, dict(error='Automatic agent owns acknowledgements for this session'))
                    if not server.finish_event(event, body['message']): return self.send(200, dict(ok=True, existing=True))
                return self.send(200, dict(ok=True))
            if url.path == '/api/stop':
                with server.condition: server.stopping = True; server.condition.notify_all()
                if server.agent: server.agent.cancel()
                self.send(200, dict(ok=True)); threading.Thread(target=server.shutdown, daemon=True).start(); return
            return self.send(404, dict(error='Unknown API route'))
        except (ValueError, KeyError, OSError) as error:
            try: self.send(400, dict(error=str(error)))
            except OSError: pass

def session_request(path, route, body=None):
    session = read_json(path); url = urlsplit(session['origin'])
    if url.scheme != 'http' or url.hostname != '127.0.0.1' or url.username or url.password or url.path: raise ValueError('Invalid local session address')
    request = Request(session['origin'] + route, data=json.dumps(body).encode() if body is not None else None, headers={'Authorization': 'Bearer ' + session['token'], 'Content-Type': 'application/json'})
    # Do not follow redirects that could forward a session credential.
    import urllib.request
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args): return None
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=55) as response: return json.load(response)
    except HTTPError as error:
        result = json.load(error); raise ValueError(result.get('error', f'HTTP {error.code}')) from error
