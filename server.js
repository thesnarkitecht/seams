// Seams server: HTTP API + static UI + WebSocket (chat events, presence, WebRTC signaling) + agents.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { WebSocketServer } from 'ws';
import { runAgent } from './agents.js';

const PORT = +process.env.PORT || 3000;
const DATA = process.env.SEAMS_DATA || path.resolve('data');
const OPEN_SIGNUP = process.env.SEAMS_OPEN_SIGNUP !== 'false';
const PUBLIC = path.resolve(import.meta.dirname, 'public');
const ICE_SERVERS = JSON.parse(process.env.SEAMS_ICE_SERVERS || '[{"urls":"stun:stun.l.google.com:19302"}]');
fs.mkdirSync(path.join(DATA, 'files'), { recursive: true });

export const db = new DatabaseSync(path.join(DATA, 'seams.db'));
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, display TEXT NOT NULL,
  pass TEXT, is_agent INTEGER DEFAULT 0, is_admin INTEGER DEFAULT 0, agent_json TEXT, token TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS convos(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT, team TEXT, notes TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS members(convo_id INTEGER, user_id INTEGER, last_read INTEGER DEFAULT 0, fav INTEGER DEFAULT 0,
  PRIMARY KEY(convo_id,user_id));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, convo_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  body TEXT NOT NULL, file TEXT, preview TEXT, reactions TEXT DEFAULT '{}', ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS msg_convo ON messages(convo_id, id);
`);

const q = (sql) => db.prepare(sql);
const hash = (p, salt = crypto.randomBytes(16).toString('hex')) =>
  salt + ':' + crypto.scryptSync(p, salt, 32).toString('hex');
const checkPass = (p, stored) => {
  const [salt, h] = (stored || ':').split(':');
  const a = Buffer.from(hash(p, salt).split(':')[1], 'hex'), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const pubUser = (u) => u && { id: u.id, name: u.name, display: u.display, is_agent: !!u.is_agent, is_admin: !!u.is_admin, online: online.has(u.id) };

// ---------- realtime ----------
const sockets = new Map(); // userId -> Set<ws>
const online = new Set();
const send = (uid, msg) => sockets.get(uid)?.forEach((ws) => ws.readyState === 1 && ws.send(JSON.stringify(msg)));
const memberIds = (cid) => q('SELECT user_id FROM members WHERE convo_id=?').all(cid).map((r) => r.user_id);
const toConvo = (cid, msg) => memberIds(cid).forEach((u) => send(u, msg));
const broadcast = (msg) => sockets.forEach((_, uid) => send(uid, msg));

// ---------- core actions (used by HTTP, WS and agents) ----------
export function convoView(c, uid) {
  const m = uid && q('SELECT last_read, fav FROM members WHERE convo_id=? AND user_id=?').get(c.id, uid);
  const members = q('SELECT u.* FROM users u JOIN members m ON m.user_id=u.id WHERE m.convo_id=?').all(c.id).map(pubUser);
  const last = q('SELECT m.*, u.display FROM messages m JOIN users u ON u.id=m.user_id WHERE convo_id=? ORDER BY id DESC LIMIT 1').get(c.id);
  const unread = m ? q('SELECT COUNT(*) n FROM messages WHERE convo_id=? AND id>? AND user_id<>?').get(c.id, m.last_read, uid).n : 0;
  return { ...c, members, last, unread, fav: !!m?.fav };
}

export async function postMessage(cid, uid, body, file = null) {
  body = String(body ?? '').slice(0, 20000);
  if (!body.trim() && !file) throw httpErr(400, 'empty message');
  const ts = Date.now();
  const { lastInsertRowid } = q('INSERT INTO messages(convo_id,user_id,body,file,ts) VALUES(?,?,?,?,?)').run(cid, uid, body, file && JSON.stringify(file), ts);
  q('UPDATE members SET last_read=? WHERE convo_id=? AND user_id=?').run(lastInsertRowid, cid, uid);
  const msg = getMessage(lastInsertRowid);
  toConvo(cid, { type: 'message', message: msg });
  const url = body.match(/https?:\/\/[^\s<>"]+/)?.[0];
  if (url) linkPreview(url).then((p) => {
    if (!p) return;
    q('UPDATE messages SET preview=? WHERE id=?').run(JSON.stringify(p), msg.id);
    toConvo(cid, { type: 'message_update', message: getMessage(msg.id) });
  });
  triggerAgents(cid, uid, msg);
  return msg;
}

export function getMessage(id) {
  const m = q('SELECT m.*, u.display, u.name, u.is_agent FROM messages m JOIN users u ON u.id=m.user_id WHERE m.id=?').get(id);
  return m && { ...m, file: JSON.parse(m.file || 'null'), preview: JSON.parse(m.preview || 'null'), reactions: JSON.parse(m.reactions) };
}

function triggerAgents(cid, authorId, msg) {
  const author = q('SELECT * FROM users WHERE id=?').get(authorId);
  if (author.is_agent) return; // agents never trigger agents: no reply loops
  const convo = q('SELECT * FROM convos WHERE id=?').get(cid);
  const agents = q('SELECT u.* FROM users u JOIN members m ON m.user_id=u.id WHERE m.convo_id=? AND u.is_agent=1').all(cid);
  for (const a of agents) {
    // In DMs/groups an agent answers everything; in channels only when @mentioned.
    if (convo.kind === 'channel' && !msg.body.toLowerCase().includes('@' + a.name.toLowerCase())) continue;
    const history = q('SELECT m.body, m.user_id, u.display FROM messages m JOIN users u ON u.id=m.user_id WHERE convo_id=? ORDER BY m.id DESC LIMIT 30').all(cid).reverse();
    toConvo(cid, { type: 'typing', convo_id: cid, user: pubUser(a) });
    runAgent(JSON.parse(a.agent_json || '{}'), { agent: pubUser(a), convo: { id: cid, kind: convo.kind, name: convo.name }, message: msg, history })
      .then((reply) => reply && postMessage(cid, a.id, reply))
      .catch((e) => postMessage(cid, a.id, `⚠️ Agent error: ${e.message}`).catch(() => {}));
  }
}

function createConvo(kind, name, team, userIds) {
  const ids = [...new Set(userIds.map(Number))];
  if (kind === 'dm') {
    if (ids.length !== 2) throw httpErr(400, 'dm needs exactly 2 users');
    const existing = q(`SELECT c.id FROM convos c WHERE kind='dm' AND
      (SELECT COUNT(*) FROM members WHERE convo_id=c.id AND user_id IN (?,?))=2`).get(ids[0], ids[1]);
    if (existing) return existing.id;
  }
  const { lastInsertRowid: cid } = q('INSERT INTO convos(kind,name,team) VALUES(?,?,?)').run(kind, name || null, team || null);
  for (const u of ids) q('INSERT OR IGNORE INTO members(convo_id,user_id) VALUES(?,?)').run(cid, u);
  ids.forEach((u) => send(u, { type: 'convo', convo: convoView(q('SELECT * FROM convos WHERE id=?').get(cid), u) }));
  return cid;
}

// ---------- link previews (SSRF-guarded) ----------
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || (l.startsWith('::ffff:') && privateIp(l.slice(7)));
}
async function linkPreview(url) {
  try {
    const u = new URL(url);
    // shortcut: checks DNS once before fetch (DNS-rebinding window remains); fine for previews, upgrade to a pinned-IP agent if exposed publicly to hostile users.
    const addrs = await dns.lookup(u.hostname, { all: true });
    if (addrs.some((a) => privateIp(a.address))) return null;
    const res = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { 'user-agent': 'SeamsBot/0.1 (link preview)' } });
    if (!res.ok || !res.headers.get('content-type')?.includes('text/html')) return null;
    const html = (await res.text()).slice(0, 200000);
    const meta = (p) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']*)`, 'i'))?.[1]
      ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${p}["']`, 'i'))?.[1];
    const title = meta('og:title') || html.match(/<title[^>]*>([^<]*)/i)?.[1];
    if (!title) return null;
    return { url, title: title.trim().slice(0, 200), description: (meta('og:description') || meta('description') || '').slice(0, 300), image: meta('og:image') || null, site: u.hostname.replace(/^www\./, '') };
  } catch { return null; }
}

// ---------- HTTP ----------
function httpErr(status, message) { return Object.assign(new Error(message), { status }); }
const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
async function readBody(req, limit = 1e6) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw httpErr(413, 'too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}
function authUser(req) {
  const t = req.headers.authorization?.replace(/^Bearer /, '') || new URL(req.url, 'http://x').searchParams.get('token');
  if (!t) return null;
  return q('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(t) || q('SELECT * FROM users WHERE token=? AND is_agent=1').get(t);
}
const requireMember = (cid, uid) => { if (!q('SELECT 1 FROM members WHERE convo_id=? AND user_id=?').get(cid, uid)) throw httpErr(403, 'not a member'); };
const newToken = () => crypto.randomBytes(24).toString('base64url');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

const routes = {
  'POST /api/register': async (req, _u, b) => {
    const count = q('SELECT COUNT(*) n FROM users WHERE is_agent=0').get().n;
    if (!OPEN_SIGNUP && count > 0) throw httpErr(403, 'signup closed');
    const name = String(b.name || '').trim().toLowerCase();
    if (!/^[a-z0-9_.-]{2,32}$/.test(name) || String(b.password || '').length < 6) throw httpErr(400, 'username 2-32 chars [a-z0-9_.-], password 6+ chars');
    if (q('SELECT 1 FROM users WHERE name=?').get(name)) throw httpErr(409, 'username taken');
    const { lastInsertRowid: id } = q('INSERT INTO users(name,display,pass,is_admin) VALUES(?,?,?,?)').run(name, String(b.display || name).slice(0, 64), hash(b.password), count === 0 ? 1 : 0);
    // everyone joins General so a new server is usable immediately
    let general = q("SELECT id FROM convos WHERE kind='channel' AND name='General' AND team='Everyone'").get()?.id;
    general ??= q("INSERT INTO convos(kind,name,team) VALUES('channel','General','Everyone')").run().lastInsertRowid;
    q('INSERT OR IGNORE INTO members(convo_id,user_id) VALUES(?,?)').run(general, id);
    const token = newToken(); q('INSERT INTO sessions VALUES(?,?)').run(token, id);
    broadcast({ type: 'user', user: pubUser(q('SELECT * FROM users WHERE id=?').get(id)) });
    return { token };
  },
  'POST /api/login': async (req, _u, b) => {
    const u = q('SELECT * FROM users WHERE name=? AND is_agent=0').get(String(b.name || '').toLowerCase());
    if (!u || !checkPass(String(b.password || ''), u.pass)) throw httpErr(401, 'wrong username or password');
    const token = newToken(); q('INSERT INTO sessions VALUES(?,?)').run(token, u.id);
    return { token };
  },
  'POST /api/logout': async (req) => { q('DELETE FROM sessions WHERE token=?').run(req.headers.authorization?.replace(/^Bearer /, '')); return {}; },
  'GET /api/me': async (req, u) => ({ user: pubUser(u), signup: OPEN_SIGNUP }),
  // STUN/TURN for calls. Set SEAMS_ICE_SERVERS to a JSON array, e.g. [{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]
  'GET /api/config': async () => ({ iceServers: ICE_SERVERS }),
  'GET /api/users': async () => ({ users: q('SELECT * FROM users ORDER BY is_agent, display').all().map(pubUser) }),
  'GET /api/convos': async (req, u) => ({
    convos: q('SELECT c.* FROM convos c JOIN members m ON m.convo_id=c.id WHERE m.user_id=?').all(u.id).map((c) => convoView(c, u.id))
      .sort((a, b) => (b.last?.ts || 0) - (a.last?.ts || 0)),
  }),
  'POST /api/convos': async (req, u, b) => {
    const kind = ['dm', 'group', 'channel'].includes(b.kind) ? b.kind : 'group';
    if (kind === 'channel' && !String(b.name || '').trim()) throw httpErr(400, 'channel needs a name');
    return { id: createConvo(kind, b.name, kind === 'channel' ? (b.team || 'Everyone') : null, [u.id, ...(b.members || [])]) };
  },
  'GET /api/channels': async () => ({ channels: q("SELECT * FROM convos WHERE kind='channel' ORDER BY team, name").all() }),
  'POST /api/convos/:id/join': async (req, u, b, [cid]) => {
    const c = q("SELECT * FROM convos WHERE id=? AND kind='channel'").get(cid);
    if (!c) throw httpErr(404, 'no such channel');
    q('INSERT OR IGNORE INTO members(convo_id,user_id) VALUES(?,?)').run(cid, u.id);
    send(u.id, { type: 'convo', convo: convoView(c, u.id) });
    return {};
  },
  'POST /api/convos/:id/members': async (req, u, b, [cid]) => {
    requireMember(cid, u.id);
    for (const id of b.members || []) q('INSERT OR IGNORE INTO members(convo_id,user_id) VALUES(?,?)').run(cid, Number(id));
    const c = q('SELECT * FROM convos WHERE id=?').get(cid);
    if (c.kind === 'dm') q("UPDATE convos SET kind='group' WHERE id=?").run(cid);
    memberIds(cid).forEach((m) => send(m, { type: 'convo', convo: convoView(q('SELECT * FROM convos WHERE id=?').get(cid), m) }));
    return {};
  },
  'POST /api/convos/:id/leave': async (req, u, b, [cid]) => { q('DELETE FROM members WHERE convo_id=? AND user_id=?').run(cid, u.id); return {}; },
  'POST /api/convos/:id/fav': async (req, u, b, [cid]) => { q('UPDATE members SET fav=? WHERE convo_id=? AND user_id=?').run(b.fav ? 1 : 0, cid, u.id); return {}; },
  'POST /api/convos/:id/read': async (req, u, b, [cid]) => {
    const max = q('SELECT MAX(id) m FROM messages WHERE convo_id=?').get(cid).m || 0;
    q('UPDATE members SET last_read=? WHERE convo_id=? AND user_id=?').run(max, cid, u.id); return {};
  },
  'GET /api/convos/:id/messages': async (req, u, b, [cid]) => {
    requireMember(cid, u.id);
    const before = Number(new URL(req.url, 'http://x').searchParams.get('before')) || 1e15;
    const ids = q('SELECT id FROM messages WHERE convo_id=? AND id<? ORDER BY id DESC LIMIT 100').all(cid, before).map((r) => r.id).reverse();
    return { messages: ids.map(getMessage) };
  },
  'POST /api/convos/:id/messages': async (req, u, b, [cid]) => { requireMember(cid, u.id); return { message: await postMessage(cid, u.id, b.body, b.file) }; },
  'GET /api/convos/:id/notes': async (req, u, b, [cid]) => { requireMember(cid, u.id); return { notes: q('SELECT notes FROM convos WHERE id=?').get(cid).notes }; },
  'PUT /api/convos/:id/notes': async (req, u, b, [cid]) => {
    requireMember(cid, u.id);
    q('UPDATE convos SET notes=? WHERE id=?').run(String(b.notes ?? '').slice(0, 100000), cid);
    toConvo(cid, { type: 'notes', convo_id: cid, notes: b.notes, by: u.id }); return {};
  },
  'GET /api/convos/:id/shared': async (req, u, b, [cid]) => {
    requireMember(cid, u.id);
    const rows = q("SELECT id FROM messages WHERE convo_id=? AND (file IS NOT NULL OR body LIKE '%http%') ORDER BY id DESC LIMIT 200").all(cid);
    return { messages: rows.map((r) => getMessage(r.id)) };
  },
  'POST /api/messages/:id/react': async (req, u, b, [mid]) => {
    const m = getMessage(mid); if (!m) throw httpErr(404, 'no message'); requireMember(m.convo_id, u.id);
    const emoji = String(b.emoji || '').slice(0, 16), r = m.reactions;
    r[emoji] = r[emoji]?.includes(u.id) ? r[emoji].filter((x) => x !== u.id) : [...(r[emoji] || []), u.id];
    if (!r[emoji].length) delete r[emoji];
    q('UPDATE messages SET reactions=? WHERE id=?').run(JSON.stringify(r), mid);
    toConvo(m.convo_id, { type: 'message_update', message: getMessage(mid) }); return {};
  },
  'PUT /api/messages/:id': async (req, u, b, [mid]) => {
    const m = getMessage(mid); if (!m || m.user_id !== u.id) throw httpErr(403, 'not yours');
    q('UPDATE messages SET body=? WHERE id=?').run(String(b.body).slice(0, 20000), mid);
    toConvo(m.convo_id, { type: 'message_update', message: getMessage(mid) }); return {};
  },
  'DELETE /api/messages/:id': async (req, u, b, [mid]) => {
    const m = getMessage(mid); if (!m || m.user_id !== u.id) throw httpErr(403, 'not yours');
    q('DELETE FROM messages WHERE id=?').run(mid);
    toConvo(m.convo_id, { type: 'message_delete', id: m.id, convo_id: m.convo_id }); return {};
  },
  'GET /api/search': async (req, u) => {
    const term = new URL(req.url, 'http://x').searchParams.get('q') || '';
    const rows = q(`SELECT m.id FROM messages m JOIN members mm ON mm.convo_id=m.convo_id AND mm.user_id=?
      WHERE m.body LIKE ? ESCAPE '\\' ORDER BY m.id DESC LIMIT 50`).all(u.id, '%' + term.replace(/[%_\\]/g, '\\$&') + '%');
    return { messages: rows.map((r) => getMessage(r.id)) };
  },
  // files: raw body upload, ?name=
  'POST /api/files': async (req, u) => {
    const buf = await readBody(req, 50e6);
    const name = path.basename(new URL(req.url, 'http://x').searchParams.get('name') || 'file').slice(0, 120);
    const id = crypto.randomBytes(12).toString('hex');
    fs.writeFileSync(path.join(DATA, 'files', id), buf);
    return { file: { id, name, size: buf.length, type: req.headers['content-type'] || 'application/octet-stream' } };
  },
  // ---- agents ----
  'GET /api/agents': async () => ({ agents: q('SELECT * FROM users WHERE is_agent=1').all().map((a) => ({ ...pubUser(a), config: redact(JSON.parse(a.agent_json || '{}')) })) }),
  'POST /api/agents': async (req, u, b) => {
    const name = String(b.name || '').trim().toLowerCase();
    if (!/^[a-z0-9_.-]{2,32}$/.test(name)) throw httpErr(400, 'agent handle 2-32 chars [a-z0-9_.-]');
    if (q('SELECT 1 FROM users WHERE name=?').get(name)) throw httpErr(409, 'name taken');
    const config = agentConfig(b);
    const token = 'sk_seams_' + newToken();
    const { lastInsertRowid: id } = q('INSERT INTO users(name,display,is_agent,agent_json,token) VALUES(?,?,1,?,?)').run(name, String(b.display || name).slice(0, 64), JSON.stringify(config), token);
    const cid = createConvo('dm', null, null, [u.id, id]);
    broadcast({ type: 'user', user: pubUser(q('SELECT * FROM users WHERE id=?').get(id)) });
    return { id, token, convo_id: cid, secret: config.kind === 'webhook' ? config.secret : undefined };
  },
  'PUT /api/agents/:id': async (req, u, b, [id]) => {
    const a = q('SELECT * FROM users WHERE id=? AND is_agent=1').get(id); if (!a) throw httpErr(404, 'no agent');
    const old = JSON.parse(a.agent_json || '{}');
    const cfg = agentConfig({ ...old, ...b, secret: b.secret || old.secret });
    q('UPDATE users SET display=?, agent_json=? WHERE id=?').run(String(b.display || a.display).slice(0, 64), JSON.stringify(cfg), id); return {};
  },
  'DELETE /api/agents/:id': async (req, u, b, [id]) => {
    if (!q('SELECT 1 FROM users WHERE id=? AND is_agent=1').get(id)) throw httpErr(404, 'no agent');
    q('DELETE FROM members WHERE user_id=?').run(id);
    q('DELETE FROM users WHERE id=?').run(id); return {};
  },
};
function agentConfig(b) {
  const kind = ['claude', 'webhook', 'api'].includes(b.kind) ? b.kind : 'claude';
  if (kind === 'webhook' && !/^https?:\/\//.test(b.url || '')) throw httpErr(400, 'webhook needs an http(s) url');
  return { kind, system: String(b.system || '').slice(0, 20000), model: String(b.model || 'claude-opus-5-5'), url: b.url || '', secret: b.secret || crypto.randomBytes(16).toString('hex') };
}
const redact = (c) => ({ ...c, secret: c.secret ? '••••' + c.secret.slice(-4) : '' });
const PUBLIC_ROUTES = new Set(['POST /api/register', 'POST /api/login']);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      // match "METHOD /api/x/:id/y"
      let handler, params = [];
      for (const [key, fn] of Object.entries(routes)) {
        const [m, pat] = key.split(' ');
        if (m !== req.method) continue;
        const re = new RegExp('^' + pat.replace(/:id/g, '(\\d+)') + '$');
        const hit = url.pathname.match(re);
        if (hit) { handler = [key, fn]; params = hit.slice(1).map(Number); break; }
      }
      if (!handler) throw httpErr(404, 'not found');
      const user = authUser(req);
      if (!PUBLIC_ROUTES.has(handler[0]) && !user) throw httpErr(401, 'login required');
      // agent tokens may only post/read messages, not manage the server
      if (user?.is_agent && !/messages|convos$|^GET \/api\/(me|users)/.test(handler[0])) throw httpErr(403, 'agent tokens cannot do that');
      const body = req.method === 'POST' && handler[0] === 'POST /api/files' ? {} : JSON.parse((await readBody(req)).toString() || '{}');
      return json(res, 200, await handler[1](req, user, body, params));
    }
    if (url.pathname.startsWith('/files/')) {
      if (!authUser(req)) throw httpErr(401, 'login required');
      const id = url.pathname.slice(7);
      if (!/^[a-f0-9]{24}$/.test(id)) throw httpErr(404, 'not found');
      const name = url.searchParams.get('name') || id;
      res.writeHead(200, { 'content-disposition': `inline; filename="${name.replace(/["\\\r\n]/g, '')}"`, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src 'self'; media-src 'self'" });
      return fs.createReadStream(path.join(DATA, 'files', id)).on('error', () => res.end()).pipe(res);
    }
    const file = path.join(PUBLIC, path.normalize(url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(200, { 'content-type': 'text/html' }); return fs.createReadStream(path.join(PUBLIC, 'index.html')).pipe(res);
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (!e.status) console.error(e);
    json(res, e.status || 500, { error: e.status ? e.message : 'server error' });
  }
});

// ---------- WebSocket: presence, typing, call signaling ----------
const calls = new Map(); // convoId -> Set<userId>
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const user = authUser(req);
  if (!user) return ws.close(4001, 'unauthorized');
  if (!sockets.has(user.id)) sockets.set(user.id, new Set());
  sockets.get(user.id).add(ws);
  if (!online.has(user.id)) { online.add(user.id); broadcast({ type: 'presence', user_id: user.id, online: true }); }
  ws.send(JSON.stringify({ type: 'calls', calls: Object.fromEntries([...calls].map(([k, v]) => [k, [...v]])) }));

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const cid = Number(m.convo_id);
    if (!q('SELECT 1 FROM members WHERE convo_id=? AND user_id=?').get(cid, user.id)) return;
    if (m.type === 'typing') toConvo(cid, { type: 'typing', convo_id: cid, user: pubUser(user) });
    else if (m.type === 'call_join') {
      if (!calls.has(cid)) calls.set(cid, new Set());
      const peers = [...calls.get(cid)];
      calls.get(cid).add(user.id);
      ws.callConvo = cid;
      send(user.id, { type: 'call_peers', convo_id: cid, peers });
      toConvo(cid, { type: 'call_state', convo_id: cid, participants: [...calls.get(cid)], caller: pubUser(user), joined: user.id, video: !!m.video });
    } else if (m.type === 'call_leave') leaveCall(user.id, cid);
    else if (m.type === 'call_decline') toConvo(cid, { type: 'call_decline', convo_id: cid, user: pubUser(user) });
    else if (m.type === 'media' && calls.get(cid)?.has(user.id)) toConvo(cid, { type: 'media', convo_id: cid, user_id: user.id, mic: !!m.mic, cam: !!m.cam });
    else if (m.type === 'signal' && calls.get(cid)?.has(Number(m.to))) send(Number(m.to), { type: 'signal', convo_id: cid, from: user.id, data: m.data });
  });
  ws.on('close', () => {
    sockets.get(user.id)?.delete(ws);
    if (ws.callConvo) leaveCall(user.id, ws.callConvo);
    if (!sockets.get(user.id)?.size) { sockets.delete(user.id); online.delete(user.id); broadcast({ type: 'presence', user_id: user.id, online: false }); }
  });
});
function leaveCall(uid, cid) {
  const set = calls.get(cid); if (!set?.delete(uid)) return;
  if (!set.size) calls.delete(cid);
  toConvo(cid, { type: 'call_state', convo_id: cid, participants: [...(set || [])], left: uid });
}

if (process.argv[1] === import.meta.filename) server.listen(PORT, () => console.log(`Seams running on http://localhost:${PORT}`));
export { server };
