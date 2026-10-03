import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { jsonRead, jsonWrite, assertSpec, inspect, hash, MAX_BYTES } from './core.js';
const uiRoot = fileURLToPath(new URL('../ui/', import.meta.url));
export async function startServer({ specPath, repo, mode = 'author', port = 0, sessionPath, baselinePath }) {
  if (!['author', 'review'].includes(mode)) throw Error('Mode must be author or review');
  assertSpec(jsonRead(specPath));
  const token = randomBytes(24).toString('hex');
  const events = [], messages = [];
  let waiter = null, origin, lastRead = 0;
  const state = () => {
    const spec = assertSpec(jsonRead(specPath));
    let report;
    try { report = inspect(spec, repo); } catch (e) { report = { error: e.message, fresh: false }; }
    return { spec, mode, revision: hash(spec), report, baseline: baselinePath ? assertSpec(jsonRead(baselinePath)) : null, events: events.map(({ id, action, text, target, status }) => ({ id, action, text, target, status })), messages, agentConnected: Date.now() - lastRead < 65000 };
  };
  const send = (res, status, data) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); } };
  const notify = () => { if (waiter) { const fn = waiter; waiter = null; fn(); } };
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) return send(res, 403, { error: 'Invalid host' });
      if (req.headers.origin && req.headers.origin !== origin) return send(res, 403, { error: 'Invalid origin' });
      const url = new URL(req.url, origin);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      if (url.pathname.startsWith('/api/')) {
        if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { error: 'Session token required' });
        if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, state());
        if (req.method === 'GET' && url.pathname === '/api/feedback') {
          lastRead = Date.now();
          if (waiter) return send(res, 409, { error: 'Another agent is already waiting' });
          const deliver = () => {
            try { send(res, 200, { events: events.filter(e => e.status === 'pending'), revision: hash(assertSpec(jsonRead(specPath))) }); }
            catch (err) { send(res, 400, { error: err.message }); }
          };
          if (events.some(e => e.status === 'pending')) return deliver();
          const wait = Math.min(50, Math.max(0, Number(url.searchParams.get('wait')) || 0));
          const timeout = setTimeout(() => { waiter = null; deliver(); }, wait * 1000);
          const pending = () => { clearTimeout(timeout); deliver(); };
          waiter = pending;
          res.on('close', () => { clearTimeout(timeout); if (waiter === pending) waiter = null; });
          return;
        }
        if (req.method !== 'POST') return send(res, 404, { error: 'Unknown API route' });
        const chunks = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX_BYTES) return send(res, 413, { error: 'Request too large' }); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        if (url.pathname === '/api/events') {
          if (!['ask', 'change', 'accept', 'implement', 'publish', 'done'].includes(body.action) || typeof body.text !== 'string' || body.text.length > 20000 || typeof body.target !== 'string' || body.target.length > 100) return send(res, 400, { error: 'Invalid feedback' });
          if (mode === 'review' && ['accept', 'implement'].includes(body.action)) return send(res, 400, { error: 'Reviewer sessions publish proposals; implementation belongs to adoption' });
          if (mode === 'author' && body.action === 'publish') return send(res, 400, { error: 'Publish proposal is a reviewer action' });
          if (body.revision !== hash(assertSpec(jsonRead(specPath)))) return send(res, 409, { error: 'Design changed. Review the refreshed view before submitting.' });
          if (events.length >= 1000) return send(res, 429, { error: 'Session event limit reached. Start a new session.' });
          const event = { id: randomUUID(), action: body.action, text: body.text, target: body.target, revision: body.revision, status: 'pending', createdAt: new Date().toISOString() };
          events.push(event); notify(); return send(res, 201, event);
        }
        if (url.pathname === '/api/ack') {
          const event = events.find(e => e.id === body.id);
          if (!event) return send(res, 404, { error: 'Unknown event' });
          if (typeof body.message !== 'string' || body.message.length > 20000) return send(res, 400, { error: 'Invalid message' });
          if (event.status === 'handled') return send(res, 200, { ok: true, existing: true });
          assertSpec(jsonRead(specPath));
          event.status = 'handled'; messages.push({ eventId: event.id, text: body.message, createdAt: new Date().toISOString() });
          return send(res, 200, { ok: true });
        }
        if (url.pathname === '/api/stop') { notify(); send(res, 200, { ok: true }); server.close(); server.closeIdleConnections(); return; }
        return send(res, 404, { error: 'Unknown API route' });
      }
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (req.method !== 'GET' || !files[url.pathname]) return send(res, 404, { error: 'Not found' });
      const [file, type] = files[url.pathname];
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(readFileSync(uiRoot + file));
    } catch (err) { send(res, 400, { error: err.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const session = { url: `${origin}/#${token}`, origin, token, pid: process.pid, specPath, repo, mode, baselinePath: baselinePath || null };
  if (sessionPath) jsonWrite(sessionPath, session);
  return { server, session };
}
export async function sessionRequest(path, route, body) {
  const session = jsonRead(path);
  const url = new URL(session.origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password) throw Error('Invalid local session address');
  const res = await fetch(session.origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(55000), redirect: 'error' });
  const result = await res.json(); if (!res.ok) throw Error(result.error || `HTTP ${res.status}`); return result;
}
