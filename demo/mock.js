// In-browser stand-in for the Seams server, so the real client can run as a static demo.
// shortcut: no persistence, no uploads, no calls; the real server provides all three.
(() => {
  const now = Date.now(), day = 864e5, at = (d, h, m) => { const t = new Date(now - d * day); t.setHours(h, m, 0, 0); return +t; };
  const U = (id, name, display, extra = {}) => ({ id, name, display, is_agent: false, is_admin: false, online: false, ...extra });
  const users = [
    U(1, 'ryan', 'Ryan Spell', { is_admin: true, online: true }), U(2, 'ben', 'Benjamin Ko', { online: true }), U(3, 'corey', 'Corey McKeon', { online: true }),
    U(4, 'leanell', 'Leanell Labadan'), U(5, 'rachel', 'Rachel Rangel', { online: true }), U(6, 'jake', 'Jake Whitley'),
    U(7, 'helper', 'Helper Bot', { is_agent: true, online: true }), U(8, 'deploybot', 'Deploy Bot', { is_agent: true, online: true }),
  ];
  const agentCfg = {
    7: { kind: 'claude', model: 'claude-opus-5-5', system: 'You help the team find answers, summarize threads and draft replies. Be brief.', url: '', secret: '' },
    8: { kind: 'api', model: '', system: '', url: '', secret: '' },
  };
  const convos = [
    { id: 1, kind: 'dm', name: null, team: null, notes: '- Ship Seams agents to the whole team\n- Ben: test the HIP login flow', members: [1, 2], fav: false },
    { id: 2, kind: 'group', name: null, team: null, notes: '', members: [1, 3, 4, 5], fav: false },
    { id: 3, kind: 'dm', name: null, team: null, notes: '', members: [1, 3], fav: true },
    { id: 4, kind: 'channel', name: 'General', team: 'Everyone', notes: '', members: [1, 2, 3, 4, 5, 6, 7], fav: false },
    { id: 5, kind: 'channel', name: 'Deploys', team: 'Engineering', notes: '', members: [1, 2, 8], fav: false },
    { id: 6, kind: 'dm', name: null, team: null, notes: '', members: [1, 7], fav: false },
    { id: 7, kind: 'dm', name: null, team: null, notes: '', members: [1, 6], fav: false },
  ];
  let mid = 0;
  const M = (convo_id, user_id, body, ts, extra = {}) => ({ id: ++mid, convo_id, user_id, body, ts, file: null, preview: null, reactions: {}, ...extra });
  const messages = [
    M(1, 2, '?', at(81, 15, 10)), M(1, 1, 'That is the HIP Microsoft login.', at(81, 15, 11)), M(1, 2, 'ok', at(81, 15, 16)),
    M(1, 2, 'Let me know when the agents are working again', at(53, 11, 45)), M(1, 1, 'The agents should be working now', at(53, 13, 8), { reactions: { '👍': [2] } }),
    M(1, 2, 'https://github.com/thesnarkitecht/seams', at(32, 12, 37), { preview: { url: 'https://github.com/thesnarkitecht/seams', title: 'thesnarkitecht/seams', description: 'Self-hosted team chat with video calls and AI agents.', image: null, site: 'github.com' } }),
    M(2, 3, 'Who has the Q4 roadmap deck?', at(2, 9, 2)), M(2, 5, 'I do, I will share it after standup', at(2, 9, 5)), M(2, 4, 'Thanks Rachel 🙏', at(2, 9, 6)),
    M(3, 3, 'Can you add me to the Deploys channel?', at(1, 16, 20)),
    M(4, 6, 'Welcome to Seams, everyone! Mention **@helper** in this channel if you want the AI agent to jump in.', at(5, 10, 0)),
    M(4, 2, '@helper what can you do?', at(5, 10, 3)),
    M(4, 7, 'I can summarize threads, answer questions and draft replies. In channels I only answer when you @mention me. In a DM I answer everything.', at(5, 10, 3)),
    M(5, 8, '✅ **web** deployed `v2.4.1` to production (42s)', at(0, 8, 14)), M(5, 2, 'nice, that was fast', at(0, 8, 20)),
    M(6, 7, 'Hi Ryan! I\'m Helper Bot. Ask me anything, or open the **Recap** tab in any chat I\'m in.', at(3, 14, 0)),
    M(7, 6, 'Lunch at 12:30?', at(0, 11, 2)),
  ];
  const unread = { 3: 1, 7: 1, 5: 2 };
  const me = 1, find = (id) => users.find((u) => u.id === id);

  const view = (c) => {
    const last = messages.filter((m) => m.convo_id === c.id).at(-1);
    return { id: c.id, kind: c.kind, name: c.name, team: c.team, notes: c.notes, members: c.members.map(find), last: last && full(last), unread: unread[c.id] || 0, fav: c.fav };
  };
  const full = (m) => ({ ...m, display: find(m.user_id).display, name: find(m.user_id).name, is_agent: find(m.user_id).is_agent ? 1 : 0, reactions: { ...m.reactions } });
  const emit = (ev) => setTimeout(() => window.__seamsWs?.onmessage?.({ data: JSON.stringify(ev) }), 0);
  const err = (status, error) => { throw Object.assign(new Error(error), { status }); };
  const convo = (id) => convos.find((c) => c.id === id && c.members.includes(me)) || err(403, 'not a member');

  function post(cid, uid, body) {
    const m = M(cid, uid, String(body || ''), Date.now());
    if (!m.body.trim()) err(400, 'empty message');
    messages.push(m); emit({ type: 'message', message: full(m) });
    if (uid === me) reactTo(convos.find((c) => c.id === cid), m);
    return full(m);
  }
  // scripted teammates and agents, so the demo feels alive
  const CANNED = { 2: ['👍 sounds good', 'On it', 'Can we talk about it after lunch?', 'Nice!'], 3: ['Thanks!', 'Perfect, appreciate it'], 6: ['See you there', 'Works for me'] };
  function agentReply(c, m) {
    const text = m.body.toLowerCase();
    if (text.includes('recap')) {
      const ms = messages.filter((x) => x.convo_id === c.id && !find(x.user_id).is_agent);
      const people = [...new Set(ms.map((x) => find(x.user_id).display))];
      return `**Recap** (${ms.length} messages from ${people.join(', ')})\n\n- Latest: “${ms.at(-2)?.body || ms.at(-1)?.body}”\n- Decisions: none recorded yet\n- Action items: follow up on open questions above\n\n_In this demo the recap is canned. On a real server a Claude agent writes it from the conversation._`;
    }
    if (/hello|hi\b|hey/.test(text)) return `Hi ${find(me).display.split(' ')[0]}! 👋 What can I help with?`;
    return `This is a demo, so my answers are scripted. On your own Seams server I'm a real Claude agent: I read the last 30 messages here and reply using the instructions you give me in **Agents**.\n\nYou said: “${m.body.slice(0, 200)}”`;
  }
  function reactTo(c, m) {
    for (const uid of c.members) {
      const u = find(uid);
      if (uid === me) continue;
      if (u.is_agent) {
        if (agentCfg[uid]?.kind !== 'claude') continue;
        if (c.kind === 'channel' && !m.body.toLowerCase().includes('@' + u.name)) continue;
        setTimeout(() => emit({ type: 'typing', convo_id: c.id, user: u }), 300);
        setTimeout(() => post(c.id, uid, agentReply(c, m)), 1600);
      } else if (c.kind !== 'channel' && CANNED[uid] && u.online !== undefined && c.members.length <= 4 && Math.random() < 0.7) {
        setTimeout(() => emit({ type: 'typing', convo_id: c.id, user: u }), 900);
        setTimeout(() => post(c.id, uid, CANNED[uid][Math.floor(Math.random() * CANNED[uid].length)]), 2600);
        break;
      }
    }
  }

  const routes = [
    ['GET', /^\/api\/me$/, () => ({ user: find(me), signup: true })],
    ['POST', /^\/api\/(login|register|logout)$/, () => ({ token: 'demo' })],
    ['GET', /^\/api\/users$/, () => ({ users })],
    ['GET', /^\/api\/convos$/, () => ({ convos: convos.filter((c) => c.members.includes(me)).map(view).sort((a, b) => (b.last?.ts || 0) - (a.last?.ts || 0)) })],
    ['POST', /^\/api\/convos$/, (b) => {
      const ids = [...new Set([me, ...(b.members || []).map(Number)])];
      if (b.kind === 'dm') { const ex = convos.find((c) => c.kind === 'dm' && c.members.length === 2 && ids.every((i) => c.members.includes(i))); if (ex) return { id: ex.id }; }
      if (b.kind === 'channel' && !String(b.name || '').trim()) err(400, 'channel needs a name');
      const c = { id: convos.length + 1, kind: b.kind || 'group', name: b.name || null, team: b.kind === 'channel' ? b.team || 'Everyone' : null, notes: '', members: ids, fav: false };
      convos.push(c); emit({ type: 'convo', convo: view(c) }); return { id: c.id };
    }],
    ['GET', /^\/api\/channels$/, () => ({ channels: convos.filter((c) => c.kind === 'channel') })],
    ['POST', /^\/api\/convos\/(\d+)\/join$/, (b, id) => { const c = convos.find((x) => x.id === id); c.members.includes(me) || c.members.push(me); emit({ type: 'convo', convo: view(c) }); return {}; }],
    ['POST', /^\/api\/convos\/(\d+)\/members$/, (b, id) => { const c = convo(id); for (const m of b.members || []) c.members.includes(m) || c.members.push(m); if (c.kind === 'dm') c.kind = 'group'; emit({ type: 'convo', convo: view(c) }); return {}; }],
    ['POST', /^\/api\/convos\/(\d+)\/leave$/, (b, id) => { const c = convo(id); c.members = c.members.filter((m) => m !== me); return {}; }],
    ['POST', /^\/api\/convos\/(\d+)\/fav$/, (b, id) => { convo(id).fav = !!b.fav; return {}; }],
    ['POST', /^\/api\/convos\/(\d+)\/read$/, (b, id) => { delete unread[id]; return {}; }],
    ['GET', /^\/api\/convos\/(\d+)\/messages$/, (b, id) => { convo(id); return { messages: messages.filter((m) => m.convo_id === id).map(full) }; }],
    ['POST', /^\/api\/convos\/(\d+)\/messages$/, (b, id) => { convo(id); return { message: post(id, me, b.body) }; }],
    ['GET', /^\/api\/convos\/(\d+)\/notes$/, (b, id) => ({ notes: convo(id).notes })],
    ['PUT', /^\/api\/convos\/(\d+)\/notes$/, (b, id) => { convo(id).notes = b.notes; return {}; }],
    ['GET', /^\/api\/convos\/(\d+)\/shared$/, (b, id) => ({ messages: messages.filter((m) => m.convo_id === id && /https?:/.test(m.body)).reverse().map(full) })],
    ['POST', /^\/api\/messages\/(\d+)\/react$/, (b, id) => {
      const m = messages.find((x) => x.id === id), r = m.reactions, e = b.emoji;
      r[e] = r[e]?.includes(me) ? r[e].filter((x) => x !== me) : [...(r[e] || []), me]; if (!r[e].length) delete r[e];
      emit({ type: 'message_update', message: full(m) }); return {};
    }],
    ['PUT', /^\/api\/messages\/(\d+)$/, (b, id) => { const m = messages.find((x) => x.id === id && x.user_id === me) || err(403, 'not yours'); m.body = b.body; emit({ type: 'message_update', message: full(m) }); return {}; }],
    ['DELETE', /^\/api\/messages\/(\d+)$/, (b, id) => { const i = messages.findIndex((x) => x.id === id && x.user_id === me); if (i < 0) err(403, 'not yours'); const [m] = messages.splice(i, 1); emit({ type: 'message_delete', id, convo_id: m.convo_id }); return {}; }],
    ['GET', /^\/api\/search$/, (b, _, url) => { const q = (url.searchParams.get('q') || '').toLowerCase(); return { messages: messages.filter((m) => convos.find((c) => c.id === m.convo_id)?.members.includes(me) && m.body.toLowerCase().includes(q)).reverse().map(full) }; }],
    ['POST', /^\/api\/files$/, () => err(400, 'file sharing needs a self-hosted Seams server, so it is off in this demo')],
    ['GET', /^\/api\/agents$/, () => ({ agents: users.filter((u) => u.is_agent).map((u) => ({ ...u, config: agentCfg[u.id] })) })],
    ['POST', /^\/api\/agents$/, (b) => {
      const name = String(b.name || '').trim().toLowerCase();
      if (!/^[a-z0-9_.-]{2,32}$/.test(name)) err(400, 'agent handle must be 2-32 characters: a-z, 0-9, _ . -');
      if (users.some((u) => u.name === name)) err(409, 'that handle is taken');
      if (b.kind === 'webhook' && !/^https?:\/\//.test(b.url || '')) err(400, 'a webhook agent needs an http(s) URL');
      const u = U(users.length + 1, name, b.display || name, { is_agent: true, online: true }); users.push(u);
      agentCfg[u.id] = { kind: b.kind, model: 'claude-opus-5-5', system: b.system || '', url: b.url || '', secret: b.kind === 'webhook' ? 'demo-secret' : '' };
      const c = { id: convos.length + 1, kind: 'dm', name: null, team: null, notes: '', members: [me, u.id], fav: false }; convos.push(c);
      emit({ type: 'convo', convo: view(c) }); emit({ type: 'user', user: u });
      return { id: u.id, token: 'sk_seams_demo_' + name, convo_id: c.id, secret: b.kind === 'webhook' ? 'demo-secret' : undefined };
    }],
    ['PUT', /^\/api\/agents\/(\d+)$/, (b, id) => { Object.assign(agentCfg[id], { system: b.system ?? agentCfg[id].system, model: b.model || agentCfg[id].model, url: b.url ?? agentCfg[id].url }); find(id).display = b.display || find(id).display; return {}; }],
    ['DELETE', /^\/api\/agents\/(\d+)$/, (b, id) => { users.splice(users.indexOf(find(id)), 1); convos.forEach((c) => (c.members = c.members.filter((m) => m !== id))); return {}; }],
  ];

  window.fetch = async (input, opts = {}) => {
    const url = new URL(input, location.href), method = (opts.method || 'GET').toUpperCase();
    for (const [m, re, fn] of routes) {
      const hit = m === method && url.pathname.match(re);
      if (!hit) continue;
      try {
        const body = typeof opts.body === 'string' ? JSON.parse(opts.body || '{}') : {};
        return new Response(JSON.stringify(await fn(body, Number(hit[1]), url)), { status: 200 });
      } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: e.status || 500 }); }
    }
    return new Response(JSON.stringify({ error: 'not available in the demo' }), { status: 404 });
  };
  window.WebSocket = class { constructor() { this.readyState = 1; window.__seamsWs = this; } send() {} close() {} };
  window.__seamsDemo = true;
  window.safeStore = { getItem: () => 'demo', setItem() {}, removeItem() {} };
  window.demoConfirm = () => true;
})();
