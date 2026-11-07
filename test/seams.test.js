import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConfig } from '../server/config.js';
import { createApp } from '../server/http.js';
import { seal, unseal } from '../server/store.js';
import { mapMessage, messageBody } from '../server/teams.js';

const ME = '11111111-1111-1111-1111-111111111111';
const DANA = '22222222-2222-2222-2222-222222222222';
const CHAT = '19:abc_def@unq.gbl.spaces';

// A fake Microsoft: the token endpoint and the Graph calls Seams makes. Records every request.
function fakeMicrosoft() {
  const calls = [];
  const json = (status, body) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (url, opts = {}) => {
    url = String(url);
    const body = opts.body instanceof URLSearchParams ? Object.fromEntries(opts.body) : opts.body ? JSON.parse(opts.body) : null;
    const auth = opts.headers?.authorization;
    calls.push({ url, method: opts.method || 'GET', body, auth });
    if (url.includes('/oauth2/v2.0/token')) {
      if (body.grant_type === 'client_credentials') return json(200, { access_token: 'APP', expires_in: 3600 });
      if (body.grant_type === 'authorization_code') return body.code === 'good' && body.code_verifier ? json(200, { access_token: 'USER', refresh_token: 'RT1', expires_in: 3600 }) : json(400, { error: 'invalid_grant' });
      if (body.grant_type === 'refresh_token') return json(200, { access_token: 'USER2', refresh_token: 'RT2', expires_in: 3600 });
    }
    const u = new URL(url); const p = decodeURIComponent(u.pathname.replace('/v1.0', ''));
    if (p === '/me' ) return json(200, { id: ME, displayName: 'Ryan Spell', mail: 'ryan@example.com' });
    if (p === '/me/presence') return json(200, { availability: 'Available' });
    if (p === '/me/chats') return json(200, { value: [{ id: CHAT, chatType: 'oneOnOne', topic: null, viewpoint: { lastMessageReadDateTime: '2026-11-01T00:00:00Z' },
      members: [{ userId: ME, displayName: 'Ryan Spell' }, { userId: DANA, displayName: 'Dana Whitfield', email: 'dana@example.com' }],
      lastMessagePreview: { createdDateTime: '2026-11-02T10:00:00Z', from: { user: { id: DANA, displayName: 'Dana Whitfield' } }, body: { content: '<p>See you <b>at 2</b></p>' } } }] });
    if (p === `/chats/${CHAT}/messages` && opts.method === 'POST') return json(201, { id: '99', createdDateTime: '2026-11-07T10:00:00Z', messageType: 'message', from: { user: { id: ME, displayName: 'Ryan Spell' } }, body: body.body });
    if (p.endsWith('/presence/setPresence') || p.endsWith('/presence/clearPresence')) return json(200, {});
    return json(404, { error: { message: 'not faked: ' + p } });
  };
  return { fetch, calls };
}

async function boot(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seams-'));
  const cfg = readConfig({ TENANT_ID: 'contoso', CLIENT_ID: 'app-1', CLIENT_SECRET: 's3cret', SEAMS_SECRET_KEY: 'k'.repeat(32), DATA_DIR: dir, PUBLIC_URL: 'http://localhost:1', ...env });
  const ms = fakeMicrosoft();
  const app = createApp(cfg, { fetch: ms.fetch });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { ...app, ms, base, dir, close: () => new Promise((r) => app.server.close(r)) };
}

async function signIn(s) {
  const r1 = await fetch(s.base + '/auth/login', { redirect: 'manual' });
  assert.equal(r1.status, 302);
  const loc = new URL(r1.headers.get('location'));
  assert.equal(loc.origin, 'https://login.microsoftonline.com');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  assert.match(loc.searchParams.get('scope'), /ChatMessage\.Send/);
  const state = loc.searchParams.get('state');
  const stateCookie = r1.headers.get('set-cookie').split(';')[0];
  const r2 = await fetch(`${s.base}/auth/callback?code=good&state=${state}`, { redirect: 'manual', headers: { cookie: stateCookie } });
  assert.equal(r2.status, 302, await r2.text());
  const sid = r2.headers.getSetCookie().find((c) => c.startsWith('seams_sid=')).split(';')[0];
  return sid;
}

test('sealed values round-trip and fail with the wrong key', () => {
  const box = seal('refresh-token', 'one');
  assert.equal(unseal(box, 'one'), 'refresh-token');
  assert.throws(() => unseal(box, 'two'));
});

test('without app credentials Seams serves example data', async () => {
  const s = await boot({ TENANT_ID: '', CLIENT_ID: '' });
  try {
    const r = await fetch(s.base + '/api/session');
    assert.deepEqual(await r.json(), { mode: 'demo', configured: false });
    assert.equal((await fetch(s.base + '/api/chats')).status, 404);
    const page = await fetch(s.base + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  } finally { await s.close(); }
});

test('sign in, list chats, send a message as yourself', async () => {
  const s = await boot();
  try {
    assert.equal((await fetch(s.base + '/api/chats')).status, 401);
    const sid = await signIn(s);
    // The refresh token is stored sealed, never in the clear.
    const raw = fs.readFileSync(path.join(s.dir, 'seams.json'), 'utf8');
    assert.ok(!raw.includes('RT1'));
    assert.equal(s.store.refreshToken(ME), 'RT1');

    const chats = await (await fetch(s.base + '/api/chats', { headers: { cookie: sid } })).json();
    assert.equal(chats.length, 1);
    assert.equal(chats[0].title, 'Dana Whitfield');
    assert.equal(chats[0].unread, true);
    assert.equal(chats[0].last.text, 'See you at 2');

    // Without the x-seams header a cross-site form cannot post.
    const blocked = await fetch(`${s.base}/api/chats/${encodeURIComponent(CHAT)}/messages`, { method: 'POST', headers: { cookie: sid, 'content-type': 'application/json' }, body: JSON.stringify({ html: 'hi' }) });
    assert.equal(blocked.status, 403);

    const html = '<at id="0">Dana Whitfield</at> thanks';
    const r = await fetch(`${s.base}/api/chats/${encodeURIComponent(CHAT)}/messages`, { method: 'POST', headers: { cookie: sid, 'content-type': 'application/json', 'x-seams': '1' },
      body: JSON.stringify({ html, mentions: [{ id: 0, mentionText: 'Dana Whitfield', mentioned: { user: { id: DANA, displayName: 'Dana Whitfield' } } }, { id: 1, mentionText: 'x', mentioned: { user: { id: 'bad id!' } } }] }) });
    assert.equal(r.status, 200);
    const sent = s.ms.calls.find((c) => c.method === 'POST' && c.url.includes('/messages'));
    assert.equal(sent.auth, 'Bearer USER', 'messages go out with the person\'s own token');
    assert.deepEqual(sent.body.body, { contentType: 'html', content: html });
    assert.equal(sent.body.mentions.length, 1);
    assert.equal(sent.body.mentions[0].mentioned.user.id, DANA);
  } finally { await s.close(); }
});

test('presence session uses the app credentials and expires on its own', async () => {
  const s = await boot();
  try {
    const sid = await signIn(s);
    const r = await fetch(s.base + '/api/presence/heartbeat', { method: 'POST', headers: { cookie: sid, 'content-type': 'application/json', 'x-seams': '1' }, body: JSON.stringify({ state: 'active' }) });
    assert.equal(r.status, 200);
    const call = s.ms.calls.find((c) => c.url.endsWith('/presence/setPresence'));
    assert.equal(call.auth, 'Bearer APP');
    assert.deepEqual(call.body, { sessionId: 'app-1', availability: 'Available', activity: 'Available', expirationDuration: 'PT5M' });
    await fetch(s.base + '/api/presence/leave', { method: 'POST', headers: { cookie: sid } });
    assert.ok(s.ms.calls.some((c) => c.url.endsWith('/presence/clearPresence')));
  } finally { await s.close(); }
});

test('a callback without the matching state cookie is refused', async () => {
  const s = await boot();
  try {
    const r1 = await fetch(s.base + '/auth/login', { redirect: 'manual' });
    const state = new URL(r1.headers.get('location')).searchParams.get('state');
    const r2 = await fetch(`${s.base}/auth/callback?code=good&state=${state}`, { redirect: 'manual' });
    assert.equal(r2.status, 400);
  } finally { await s.close(); }
});

test('image proxy only fetches Teams hosted content', async () => {
  const s = await boot();
  try {
    const sid = await signIn(s);
    const r = await fetch(`${s.base}/api/hosted?u=${encodeURIComponent('https://evil.example.com/x.png')}`, { headers: { cookie: sid } });
    assert.equal(r.status, 400);
  } finally { await s.close(); }
});

test('Graph messages map to what the client draws', () => {
  const m = mapMessage({ id: '1', createdDateTime: '2026-11-01T00:00:00Z', messageType: 'message', from: { user: { id: DANA, displayName: 'Dana' } }, body: { contentType: 'text', content: 'a <b>\nb' },
    reactions: [{ reactionType: 'like', user: { user: { id: ME } } }, { reactionType: 'like', user: { user: { id: DANA } } }], attachments: [{ contentType: 'reference', name: 'JIB.pdf', contentUrl: 'https://x/JIB.pdf' }] });
  assert.equal(m.html, 'a &lt;b&gt;<br>b');
  assert.deepEqual(m.reactions, [{ type: 'like', users: [ME, DANA] }]);
  assert.equal(m.attachments[0].type, 'pdf');
  const sys = mapMessage({ id: '2', createdDateTime: 'x', messageType: 'systemEventMessage', eventDetail: { '@odata.type': '#microsoft.graph.membersAddedEventMessageDetail' }, body: {} });
  assert.equal(sys.system, 'People were added to the chat');
  assert.throws(() => messageBody({ html: '  ' }));
});
