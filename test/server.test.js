import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

process.env.SEAMS_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'seams-test-'));
const { server } = await import('../server.js');
let base, hook, hookUrl, lastHook;

before(async () => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  hook = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      lastHook = { body: b, sig: req.headers['x-seams-signature'] };
      res.end(JSON.stringify({ text: 'echo: ' + JSON.parse(b).message.body }));
    });
  });
  await new Promise((r) => hook.listen(0, r));
  hookUrl = `http://127.0.0.1:${hook.address().port}/`;
});
after(() => { server.close(); hook.close(); server.closeAllConnections?.(); });

const call = async (method, url, token, body) => {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }) }, body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
};

test('chat, agents and access control', async () => {
  const alice = (await call('POST', '/api/register', null, { name: 'alice', password: 'secret1' })).data.token;
  const bob = (await call('POST', '/api/register', null, { name: 'bob', password: 'secret2' })).data.token;
  const eve = (await call('POST', '/api/register', null, { name: 'eve', password: 'secret3' })).data.token;
  assert.ok(alice && bob && eve);
  assert.equal((await call('POST', '/api/login', null, { name: 'alice', password: 'wrong!!' })).status, 401);
  assert.equal((await call('GET', '/api/me', alice)).data.user.is_admin, true);

  const users = (await call('GET', '/api/users', alice)).data.users;
  const bobId = users.find((u) => u.name === 'bob').id;
  const { id: dm } = (await call('POST', '/api/convos', alice, { kind: 'dm', members: [bobId] })).data;
  assert.equal((await call('POST', '/api/convos', alice, { kind: 'dm', members: [bobId] })).data.id, dm, 'DMs are deduplicated');

  // realtime delivery to bob
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws?token=' + bob);
  const got = new Promise((r) => ws.on('message', (m) => { const e = JSON.parse(m); if (e.type === 'message') r(e.message); }));
  await new Promise((r) => ws.on('open', r));
  await call('POST', `/api/convos/${dm}/messages`, alice, { body: 'hi **bob**' });
  assert.equal((await got).body, 'hi **bob**');
  ws.close();

  assert.equal((await call('GET', `/api/convos/${dm}/messages`, eve)).status, 403, 'non-members cannot read');
  assert.equal((await call('GET', `/api/convos/${dm}/messages`, bob)).data.messages.length, 1);
  assert.equal((await call('GET', '/api/search?q=bob', eve)).data.messages.length, 0, 'search is scoped to membership');

  // webhook agent replies in its DM, signed with HMAC
  const agent = (await call('POST', '/api/agents', alice, { kind: 'webhook', name: 'echo', url: hookUrl })).data;
  await call('POST', `/api/convos/${agent.convo_id}/messages`, alice, { body: 'ping' });
  let msgs;
  for (let i = 0; i < 50; i++) { msgs = (await call('GET', `/api/convos/${agent.convo_id}/messages`, alice)).data.messages; if (msgs.length === 2) break; await new Promise((r) => setTimeout(r, 50)); }
  assert.equal(msgs[1].body, 'echo: ping');
  assert.equal(lastHook.sig, 'sha256=' + crypto.createHmac('sha256', agent.secret).update(lastHook.body).digest('hex'));

  // agent token can post where it is a member, but not manage the server or read others' chats
  assert.equal((await call('POST', `/api/convos/${agent.convo_id}/messages`, agent.token, { body: 'proactive hello' })).status, 200);
  assert.equal((await call('GET', `/api/convos/${dm}/messages`, agent.token)).status, 403);
  assert.equal((await call('POST', '/api/agents', agent.token, { name: 'x2', kind: 'api' })).status, 403);

  // channel: agent only answers when @mentioned
  const { id: ch } = (await call('POST', '/api/convos', alice, { kind: 'channel', name: 'dev', members: [agent.id] })).data;
  await call('POST', `/api/convos/${ch}/messages`, alice, { body: 'no mention' });
  await call('POST', `/api/convos/${ch}/messages`, alice, { body: '@echo yo' });
  for (let i = 0; i < 50; i++) { msgs = (await call('GET', `/api/convos/${ch}/messages`, alice)).data.messages; if (msgs.length === 3) break; await new Promise((r) => setTimeout(r, 50)); }
  assert.deepEqual(msgs.map((m) => m.body), ['no mention', '@echo yo', 'echo: @echo yo']);
});
