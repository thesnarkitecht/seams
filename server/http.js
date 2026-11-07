// HTTP: the web client, Microsoft sign-in, and the /api the client calls. No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { Store } from './store.js';
import { Auth } from './auth.js';
import { makeGraph } from './graph.js';
import { Teams } from './teams.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const SID = 'seams_sid', STATE = 'seams_state';

const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
const httpErr = (status, message) => Object.assign(new Error(message), { status });

export function createApp(cfg, { fetch = globalThis.fetch } = {}) {
  const live = cfg.configured && !cfg.demo;
  if (live && !cfg.secretKey) throw new Error('Set SEAMS_SECRET_KEY: sign-ins are stored encrypted with it');
  const store = live ? new Store(cfg.dataDir, cfg.secretKey) : null;
  const auth = live ? new Auth(cfg, store, { fetch }) : null;
  const teams = live ? new Teams({ cfg, auth, graph: makeGraph(cfg.graph.base, fetch) }) : null;
  const webDir = path.join(cfg.root, 'web');
  const cookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cfg.secure ? '; Secure' : ''}`;

  const send = (res, status, body, headers = {}) => {
    const json = typeof body !== 'string' && !Buffer.isBuffer(body);
    res.writeHead(status, { 'content-type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...headers });
    res.end(json ? JSON.stringify(body) : body);
  };
  const redirect = (res, to, setCookie) => { res.writeHead(302, { location: to, 'cache-control': 'no-store', ...(setCookie ? { 'set-cookie': setCookie } : {}) }); res.end(); };
  const readJson = (req) => new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > 64 * 1024) { reject(httpErr(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!n) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(httpErr(400, 'Bad JSON')); } });
    req.on('error', reject);
  });

  function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.join(webDir, rel);
    if (!file.startsWith(webDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' });
    fs.createReadStream(file).pipe(res);
  }

  // /api routes for a signed-in person: [method, pattern, handler(oid, params, body, url)]
  const T = (t, c) => teams.chan(t, c);
  const routes = [
    ['GET', /^\/api\/chats$/, (oid) => teams.chats(oid)],
    ['POST', /^\/api\/chats$/, (oid, p, b) => teams.newChat(oid, b.members, b.topic)],
    ['GET', /^\/api\/chats\/([^/]+)\/messages$/, (oid, [c]) => teams.messages(oid, c)],
    ['POST', /^\/api\/chats\/([^/]+)\/messages$/, (oid, [c], b) => teams.send(oid, c, b)],
    ['PATCH', /^\/api\/chats\/([^/]+)\/messages\/([^/]+)$/, (oid, [c, m], b) => teams.edit(oid, c, m, b)],
    ['DELETE', /^\/api\/chats\/([^/]+)\/messages\/([^/]+)$/, (oid, [c, m]) => teams.remove(oid, c, m)],
    ['POST', /^\/api\/chats\/([^/]+)\/messages\/([^/]+)\/react$/, (oid, [c, m], b) => teams.react(oid, `/chats/${encodeURIComponent(c)}/messages/${encodeURIComponent(m)}`, b.type, b.on !== false)],
    ['POST', /^\/api\/chats\/([^/]+)\/read$/, (oid, [c]) => teams.markRead(oid, c)],
    ['GET', /^\/api\/teams$/, (oid) => teams.teams(oid)],
    ['GET', /^\/api\/teams\/([^/]+)\/channels\/([^/]+)\/posts$/, (oid, [t, c]) => teams.posts(oid, t, c)],
    ['POST', /^\/api\/teams\/([^/]+)\/channels\/([^/]+)\/posts$/, (oid, [t, c], b) => teams.post(oid, t, c, b)],
    ['POST', /^\/api\/teams\/([^/]+)\/channels\/([^/]+)\/posts\/([^/]+)\/replies$/, (oid, [t, c, p], b) => teams.reply(oid, t, c, p, b)],
    ['POST', /^\/api\/teams\/([^/]+)\/channels\/([^/]+)\/messages\/([^/]+)\/react$/, (oid, [t, c, m], b) => teams.react(oid, `${T(t, c)}/messages/${encodeURIComponent(m)}`, b.type, b.on !== false)],
    ['GET', /^\/api\/people$/, (oid, p, b, url) => teams.people(oid, url.searchParams.get('q'))],
    ['POST', /^\/api\/presence$/, (oid, p, b) => teams.presence(oid, b.ids)],
    ['POST', /^\/api\/presence\/status$/, (oid, p, b) => teams.setStatus(oid, b.availability || null)],
    ['POST', /^\/api\/presence\/heartbeat$/, (oid, p, b) => teams.heartbeat(oid, b.state)],
    ['POST', /^\/api\/presence\/leave$/, (oid) => teams.leave(oid)],
  ];

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;
    if (p === '/api/health') return send(res, 200, { ok: true, mode: live ? 'live' : 'demo' });
    if (!live) {
      if (p === '/api/session') return send(res, 200, { mode: 'demo', configured: cfg.configured });
      if (p.startsWith('/api/') || p.startsWith('/auth/')) return send(res, 404, { error: 'Seams is running on example data. Set TENANT_ID, CLIENT_ID and CLIENT_SECRET (see .env.example) to use Teams.' });
      return serveStatic(req, res, p);
    }

    if (p === '/auth/login') {
      const { url: to, state } = auth.begin();
      return redirect(res, to, cookie(STATE, state, 600));
    }
    if (p === '/auth/callback') {
      const c = cookies(req); const state = url.searchParams.get('state');
      if (url.searchParams.get('error')) return send(res, 400, `Microsoft sign-in did not finish: ${url.searchParams.get('error_description') || url.searchParams.get('error')}`);
      if (!state || state !== c[STATE]) return send(res, 400, 'This sign-in was started in another browser or has expired. Go back to Seams and sign in again.');
      const t = await auth.finish(state, url.searchParams.get('code'));
      const g = makeGraph(cfg.graph.base, fetch);
      const me = await g(t.accessToken, 'GET', '/me?$select=id,displayName,mail,userPrincipalName');
      const email = String(me.mail || me.userPrincipalName || '').toLowerCase();
      if (cfg.allowed.length && !cfg.allowed.includes(email) && !cfg.allowed.includes(String(me.userPrincipalName || '').toLowerCase())) return send(res, 403, `${email} is not on this Seams server's allowed list.`);
      store.putUser(me.id, { name: me.displayName, email, refreshToken: t.refreshToken });
      auth.remember(me.id, t.accessToken, t.exp);
      const sid = store.newSession(me.id);
      return redirect(res, '/', [cookie(SID, sid, 14 * 86400), cookie(STATE, '', 0)]);
    }
    if (p === '/auth/logout') {
      const sid = cookies(req)[SID]; const s = store.session(sid);
      if (s) { await teams.leave(s.oid).catch(() => {}); auth.forget(s.oid); }
      store.endSession(sid);
      return redirect(res, '/', cookie(SID, '', 0));
    }
    if (!p.startsWith('/api/')) return serveStatic(req, res, p);

    const s = store.session(cookies(req)[SID]);
    if (!s) return send(res, 401, { error: 'Sign in with Microsoft' });
    // Calls that change something must come from the Seams page itself (a custom header forces a CORS preflight).
    // The one exception is leaving, sent by navigator.sendBeacon when the tab closes; it can only clear your own presence.
    if (req.method !== 'GET' && req.headers['x-seams'] !== '1' && p !== '/api/presence/leave') return send(res, 403, { error: 'Missing x-seams header' });

    if (p === '/api/session') return send(res, 200, { mode: 'live', ...(await teams.me(s.oid)) });
    if (p === '/api/hosted' && req.method === 'GET') {
      const img = await teams.hosted(s.oid, url.searchParams.get('u'));
      return send(res, 200, img.body, { 'content-type': img.type, 'cache-control': 'private, max-age=3600' });
    }
    for (const [method, re, fn] of routes) {
      if (method !== req.method) continue;
      const m = re.exec(p); if (!m) continue;
      const body = method === 'GET' ? {} : await readJson(req);
      const out = await fn(s.oid, m.slice(1).map(decodeURIComponent), body, url);
      return send(res, 200, out ?? { ok: true });
    }
    return send(res, 404, { error: 'Not found' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
      if (status >= 500) console.error('[seams]', req.method, req.url.split('?')[0], e.message);
      if (!res.headersSent) send(res, status, req.url.startsWith('/api/') ? { error: e.message } : e.message);
      else res.end();
    });
  });
  return { server, store, auth, teams, live };
}
