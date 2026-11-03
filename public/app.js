// Seams web client: vanilla JS, no build step.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const S = { token: localStorage.getItem('seams_token'), me: null, users: new Map(), convos: new Map(), current: null, filter: null, view: 'chat', tab: 'chat', messages: [], calls: {}, pendingFile: null };

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + S.token, ...opts.headers }, body: opts.body && typeof opts.body !== 'string' && !(opts.body instanceof Blob) ? JSON.stringify(opts.body) : opts.body });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && S.me) { logout(); throw new Error('session expired'); }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
function toast(html, ms = 4000) {
  const t = $('#toast'); t.innerHTML = html; t.classList.remove('hidden');
  clearTimeout(toast.t); if (ms) toast.t = setTimeout(() => t.classList.add('hidden'), ms);
  return t;
}

// ---------- avatars: GitHub-style identicons ----------
const hash = (str) => { let h = 2166136261; for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const identicons = new Map();
// 5x5 grid mirrored left-to-right, one hue per name, the same on every device
function identicon(seed) {
  if (identicons.has(seed)) return identicons.get(seed);
  const h = hash(seed);
  let bits = hash(seed + '#cells') & 0x7fff;
  if (!bits) bits = h & 0x7fff || 0x1b6d;
  const color = `hsl(${h % 360} ${48 + ((h >>> 9) % 22)}% ${40 + ((h >>> 15) % 14)}%)`;
  let cells = '';
  for (let x = 0; x < 3; x++) for (let y = 0; y < 5; y++) if ((bits >>> (x * 5 + y)) & 1) {
    cells += `<rect x="${x}" y="${y}" width="1.02" height="1.02"/>`;
    if (x < 2) cells += `<rect x="${4 - x}" y="${y}" width="1.02" height="1.02"/>`;
  }
  const svg = `<svg class="idn" viewBox="-0.9 -0.9 6.8 6.8" aria-hidden="true"><rect x="-0.9" y="-0.9" width="6.8" height="6.8" fill="var(--idn-bg)"/><g fill="${color}">${cells}</g></svg>`;
  identicons.set(seed, svg);
  return svg;
}
function avatar(u, size = '') {
  if (!u) return '';
  return `<span class="av ${size === true ? 'lg' : size} ${u.is_agent ? 'bot' : ''}" aria-hidden="true">${identicon(u.name || u.display)}<i class="dot ${u.online || u.is_agent ? 'on' : ''}" data-presence="${u.id}"></i></span>`;
}
const chanAvatar = (c) => `<span class="av chan" aria-hidden="true">#</span>`;
function convoAvatar(c) {
  if (c.kind === 'channel') return chanAvatar(c);
  const others = c.members.filter((m) => m.id !== S.me.id);
  if (others.length <= 1) return avatar(S.users.get(others[0]?.id) || others[0] || S.me);
  return `<span class="av stack" aria-hidden="true">${identicon(others[0].name)}${identicon(others[1].name)}</span>`;
}
function convoName(c) {
  if (c.kind === 'channel') return `${c.team} › ${c.name}`;
  if (c.name) return c.name;
  const others = c.members.filter((m) => m.id !== S.me.id).map((m) => m.display);
  return others.length ? (others.length > 3 ? others.slice(0, 3).join(', ') + ` +${others.length - 3}` : others.join(others.length === 2 ? ' and ' : ', ')) : S.me.display + ' (you)';
}
const fmtTime = (ts) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; };
const fmtDay = (ts) => new Date(ts).toLocaleDateString([], { month: 'long', day: 'numeric', year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
function md(text) {
  // escape first, then a small safe subset of Markdown
  const blocks = esc(text).split(/```/);
  return blocks.map((b, i) => i % 2 ? `<pre><code>${b.replace(/^\w*\n/, '')}</code></pre>` : b
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/g, '$1<i>$2</i>')
    .replace(/https?:\/\/[^\s<>"]+[^\s<>".,!?)]/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`)
    .replace(/(^|\s)@([a-z0-9_.-]+)/g, '$1<b class="mention">@$2</b>')
    .split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')).join('');
}

// ---------- auth ----------
let registering = false;
function showAuth() {
  $('#app').classList.add('hidden'); $('#auth').classList.remove('hidden');
}
$('#authToggle').onclick = () => {
  registering = !registering;
  $('#authForm').classList.toggle('register', registering);
  $('#authBtn').textContent = registering ? 'Create account' : 'Sign in';
  $('#authToggle').textContent = registering ? 'I already have an account' : 'Create an account';
  $('#authHint').textContent = registering ? 'The first account on a new server becomes admin' : 'Sign in to your workspace';
};
$('#authForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  try {
    const { token } = await api(registering ? '/api/register' : '/api/login', { method: 'POST', body: f });
    S.token = token; localStorage.setItem('seams_token', token); start();
  } catch (err) { $('#authErr').textContent = err.message; }
};
function logout() {
  api('/api/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('seams_token'); location.reload();
}
$('#logoutBtn').onclick = logout;
$('#meBtn').onclick = (e) => { e.stopPropagation(); $('#meMenu').classList.toggle('hidden'); };
document.addEventListener('click', (e) => {
  $('#meMenu').classList.add('hidden');
  if (!e.target.closest('#emojiPicker, #emojiBtn')) $('#emojiPicker').classList.add('hidden');
});

// ---------- boot ----------
async function start() {
  if (!S.token) return showAuth();
  try { S.me = (await api('/api/me')).user; } catch { localStorage.removeItem('seams_token'); return showAuth(); }
  api('/api/config').then((c) => { if (c.iceServers?.length) ICE = { iceServers: c.iceServers }; }).catch(() => {});
  $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#meBtn').innerHTML = avatar(S.me); $('#meName').textContent = `${S.me.display} (@${S.me.name})`;
  const [{ users }, { convos }] = await Promise.all([api('/api/users'), api('/api/convos')]);
  users.forEach((u) => S.users.set(u.id, u));
  convos.forEach((c) => S.convos.set(c.id, c));
  connect(); renderList();
  const fromHash = Number(location.hash.slice(1));
  if (S.convos.has(fromHash)) openConvo(fromHash);
}

// ---------- websocket ----------
let ws;
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${encodeURIComponent(S.token)}`);
  ws.onmessage = (e) => onEvent(JSON.parse(e.data));
  ws.onclose = (e) => { if (e.code !== 4001) setTimeout(connect, 2000); };
}
const wsSend = (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m));
const typingTimers = {};

function onEvent(ev) {
  switch (ev.type) {
    case 'message': {
      const m = ev.message, c = S.convos.get(m.convo_id);
      if (!c) return api('/api/convos').then(({ convos }) => { convos.forEach((x) => S.convos.set(x.id, x)); renderList(); });
      c.last = m;
      const viewing = S.current === m.convo_id && document.visibilityState === 'visible';
      if (m.user_id !== S.me.id && !viewing) { c.unread++; notify(c, m); }
      if (S.current === m.convo_id) { S.messages.push(m); renderMessages(true); if (viewing) markRead(); clearTyping(m.convo_id, m.user_id); }
      renderList(); break;
    }
    case 'message_update': {
      const i = S.messages.findIndex((x) => x.id === ev.message.id);
      if (i >= 0) { S.messages[i] = ev.message; renderMessages(); } break;
    }
    case 'message_delete': S.messages = S.messages.filter((x) => x.id !== ev.id); if (S.current === ev.convo_id) renderMessages(); break;
    case 'convo': S.convos.set(ev.convo.id, ev.convo); renderList(); if (S.current === ev.convo.id) renderHead(); break;
    case 'user': S.users.set(ev.user.id, ev.user); break;
    case 'presence': {
      const u = S.users.get(ev.user_id); if (u) u.online = ev.online;
      $$(`[data-presence="${ev.user_id}"]`).forEach((d) => d.classList.toggle('on', ev.online)); break;
    }
    case 'typing': {
      if (ev.user.id === S.me.id) return;
      (typingTimers[ev.convo_id] ??= {})[ev.user.id] = { name: ev.user.display, t: Date.now() };
      renderTyping(); setTimeout(renderTyping, ev.user.is_agent ? 60000 : 4000); break;
    }
    case 'notes': if (S.current === ev.convo_id && ev.by !== S.me.id) $('#notes').value = ev.notes; break;
    case 'calls': S.calls = ev.calls; renderCallBanner(); break;
    case 'call_state': {
      S.calls[ev.convo_id] = ev.participants; if (!ev.participants.length) delete S.calls[ev.convo_id];
      if (ev.caller && ev.caller.id !== S.me.id && ev.participants.length === 1 && !call) ringing(ev.convo_id, ev.caller, ev.video);
      if (!ev.participants.length && ring?.cid === ev.convo_id) stopRing();
      if (call?.convo === ev.convo_id) {
        if (ev.left) dropPeer(ev.left);
        if (ev.joined && ev.joined !== S.me.id) sendMedia(); // tell the newcomer whether we're muted / on camera
        if (call.alone && ev.participants.length > 1) { call.alone = false; call.started = Date.now(); call.ringback?.(); clearTimeout(call.noAnswer); }
      }
      renderCallBanner(); break;
    }
    case 'call_decline':
      if (call?.convo === ev.convo_id && call.alone && ev.user.id !== S.me.id) {
        toast(`${esc(ev.user.display)} declined the call.`);
        if (S.convos.get(ev.convo_id)?.kind === 'dm') endCall();
      }
      break;
    case 'media':
      if (call?.convo === ev.convo_id && ev.user_id !== S.me.id) { call.media.set(ev.user_id, { mic: ev.mic, cam: ev.cam }); refreshTile(ev.user_id); }
      break;
    case 'call_peers': if (call?.convo === ev.convo_id) ev.peers.forEach((p) => makePeer(p)); break;
    case 'signal': onSignal(ev); break;
  }
}
function clearTyping(cid, uid) { if (typingTimers[cid]) delete typingTimers[cid][uid]; renderTyping(); }
function renderTyping() {
  const now = Date.now();
  const who = Object.entries(typingTimers[S.current] || {})
    .filter(([uid, v]) => now - v.t < (S.users.get(+uid)?.is_agent ? 60000 : 4000))
    .map(([uid, v]) => ({ u: S.users.get(+uid) || { id: +uid, name: v.name, display: v.name }, name: v.name }));
  const el = $('#typing'), key = who.map((w) => w.u.id).join();
  if (el.dataset.key === key) return; // keep the dots animating smoothly
  el.dataset.key = key;
  if (!who.length) { el.innerHTML = ''; return; }
  const agents = who.every((w) => w.u.is_agent), n = who.length;
  const names = n > 2 ? `${who[0].name} and ${n - 1} others` : who.map((w) => w.name).join(' and ');
  el.innerHTML = `<span class="typing-avs">${who.slice(0, 3).map((w) => avatar(w.u, 'xs')).join('')}</span>
    <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${esc(names)} ${n > 1 ? 'are' : 'is'} ${agents ? 'thinking' : 'typing'}…</span>`;
}
function notify(c, m) {
  if (document.visibilityState === 'visible' && S.current === c.id) return;
  if (window.Notification?.permission === 'granted' && document.visibilityState !== 'visible') new Notification(m.display, { body: m.body.slice(0, 140), tag: 'seams' + c.id });
  updateActivityBadge();
}

// ---------- side lists ----------
function renderList() {
  updateActivityBadge();
  const all = [...S.convos.values()];
  const pass = (c) => S.filter === 'unread' ? c.unread > 0 : S.filter === 'channel' ? c.kind === 'channel' : S.filter === 'chat' ? c.kind !== 'channel' : true;
  const item = (c) => `<button class="item ${c.id === S.current ? 'active' : ''} ${c.unread ? 'unread' : ''}" data-convo="${c.id}">${convoAvatar(c)}
    <span class="meta"><div class="name">${esc(convoName(c))}</div><div class="sub">${c.last ? esc((c.last.user_id === S.me.id ? 'You: ' : '') + (c.last.body.replace(/[*`]/g, '') || '📎 ' + (c.last.file?.name || 'file'))) : '&nbsp;'}</div></span>
    ${c.unread ? `<span class="count">${c.unread}</span>` : ''}</button>`;
  const sect = (title, list) => list.length ? `<div class="group-title">⌄ ${title}</div>${list.map(item).join('')}` : '';
  const shown = all.filter(pass);
  $('#convoList').innerHTML = sect('Favorites', shown.filter((c) => c.fav)) + sect('Chats', shown.filter((c) => !c.fav && c.kind !== 'channel')) + sect('Teams and channels', shown.filter((c) => !c.fav && c.kind === 'channel'))
    || '<p class="muted pad">Nothing here yet. Start a chat with the ✎ button.</p>';
}
function updateActivityBadge() {
  const n = [...S.convos.values()].reduce((a, c) => a + c.unread, 0);
  $('#activityBadge').textContent = n; $('#activityBadge').classList.toggle('hidden', !n);
  document.title = n ? `(${n}) Seams` : 'Seams';
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-convo]'); if (b) openConvo(+b.dataset.convo);
});
$$('.filters button').forEach((b) => b.onclick = () => {
  S.filter = S.filter === b.dataset.filter ? null : b.dataset.filter;
  $$('.filters button').forEach((x) => x.classList.toggle('active', x.dataset.filter === S.filter)); renderList();
});
$$('.rail button').forEach((b) => b.onclick = () => setView(b.dataset.view));
function setView(v) {
  S.view = v;
  $$('.rail button').forEach((x) => x.classList.toggle('active', x.dataset.view === v));
  $$('.side section').forEach((s) => s.classList.toggle('hidden', s.dataset.pane !== v));
  $('#app').classList.remove('open-main');
  if (v === 'activity') renderActivity();
  if (v === 'teams') renderTeams();
  if (v === 'agents') renderAgents();
}
function renderActivity() {
  const unread = [...S.convos.values()].filter((c) => c.unread);
  $('#activityList').innerHTML = unread.length ? unread.map((c) => `<button class="item unread" data-convo="${c.id}">${convoAvatar(c)}<span class="meta"><div class="name">${esc(c.last?.display || '')} in ${esc(convoName(c))}</div><div class="sub">${esc(c.last?.body || '')}</div></span><span class="count">${c.unread}</span></button>`).join('') : '<p class="muted pad">You’re all caught up.</p>';
}
async function renderTeams() {
  const { channels } = await api('/api/channels');
  const teams = Object.groupBy(channels, (c) => c.team);
  $('#teamList').innerHTML = Object.entries(teams).map(([t, cs]) => `<div class="group-title">⌄ ${esc(t)}</div>` + cs.map((c) =>
    S.convos.has(c.id) ? `<button class="item" data-convo="${c.id}">${chanAvatar(c)}<span class="meta name">${esc(c.name)}</span></button>`
      : `<button class="item" data-join="${c.id}"><span class="av chan muted-chan">#</span><span class="meta"><div class="name">${esc(c.name)}</div><div class="sub">Click to join</div></span></button>`).join('')).join('')
    || '<p class="muted pad">No channels yet.</p>';
  $$('[data-join]').forEach((b) => b.onclick = async () => { await api(`/api/convos/${b.dataset.join}/join`, { method: 'POST' }); const { convos } = await api('/api/convos'); convos.forEach((c) => S.convos.set(c.id, c)); openConvo(+b.dataset.join); renderTeams(); });
}

// ---------- conversation ----------
async function openConvo(id) {
  const c = S.convos.get(id); if (!c) return;
  S.current = id; location.hash = id;
  $('#emptyState').classList.add('hidden'); $('#panel').classList.add('hidden'); $('#convoView').classList.remove('hidden');
  $('#app').classList.add('open-main');
  renderHead(); setTab('chat');
  S.messages = []; renderMessages();
  S.messages = (await api(`/api/convos/${id}/messages`)).messages;
  if (S.current !== id) return;
  renderMessages(true); markRead(); renderList(); renderTyping(); renderCallBanner();
  $('#input').focus();
}
function markRead() {
  const c = S.convos.get(S.current); if (!c) return;
  if (c.unread) { c.unread = 0; renderList(); }
  api(`/api/convos/${S.current}/read`, { method: 'POST' }).catch(() => {});
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && S.current && markRead());
function renderHead() {
  const c = S.convos.get(S.current);
  $('#convoAvatar').innerHTML = `<button class="icon mobile-back" id="backBtn" aria-label="Back">‹</button>` + convoAvatar(c);
  $('#backBtn').onclick = () => $('#app').classList.remove('open-main');
  $('#convoTitle').textContent = convoName(c);
  $('#favBtn').classList.toggle('on', c.fav);
}
$$('.tabs button').forEach((b) => b.onclick = () => setTab(b.dataset.tab));
function setTab(t) {
  S.tab = t;
  $$('.tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === t));
  $$('[data-tabpane]').forEach((x) => x.classList.toggle('hidden', x.dataset.tabpane !== t));
  if (t === 'shared') renderShared();
  if (t === 'notes') api(`/api/convos/${S.current}/notes`).then((r) => { $('#notes').value = r.notes; });
  if (t === 'recap') renderRecap();
}

function messageHtml(m, prev) {
  const mine = m.user_id === S.me.id;
  const cont = prev && prev.user_id === m.user_id && m.ts - prev.ts < 5 * 60e3 && new Date(prev.ts).toDateString() === new Date(m.ts).toDateString();
  const u = S.users.get(m.user_id) || { id: m.user_id, display: m.display, is_agent: m.is_agent };
  const f = m.file;
  const file = f ? (f.type?.startsWith('image/') ? `<a href="/files/${f.id}?name=${encodeURIComponent(f.name)}&token=${S.token}" target="_blank"><img class="file-img" src="/files/${f.id}?token=${S.token}" alt="${esc(f.name)}"></a>`
    : `<a class="file" href="/files/${f.id}?name=${encodeURIComponent(f.name)}&token=${S.token}" target="_blank" download="${esc(f.name)}">📄 ${esc(f.name)} <small class="muted">${(f.size / 1024).toFixed(0)} KB</small></a>`) : '';
  const p = m.preview;
  const preview = p ? `<a class="preview" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${p.image && /^https:/.test(p.image) ? `<img src="${esc(p.image)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ''}<div><b>${esc(p.title)}</b><span>${esc(p.description)}</span><small>${esc(p.site)}</small></div></a>` : '';
  const reactions = Object.entries(m.reactions || {}).map(([e, ids]) => `<button data-react="${m.id}" data-emoji="${esc(e)}" class="${ids.includes(S.me.id) ? 'me' : ''}" title="${esc(ids.map((i) => S.users.get(i)?.display).join(', '))}">${esc(e)} ${ids.length}</button>`).join('');
  return `<div class="msg ${mine ? 'mine' : ''} ${cont ? 'cont' : ''}" data-id="${m.id}">${avatar(u)}
    <div class="body"><div class="head">${mine ? '' : `<b>${esc(m.display)}</b>${u.is_agent ? '<span class="tag">bot</span>' : ''}`}<time>${fmtTime(m.ts)}</time></div>
    ${m.body ? `<div class="bubble">${md(m.body)}${preview}</div>` : ''}${file}
    ${reactions ? `<div class="reactions">${reactions}</div>` : ''}</div>
    <div class="actions">${['👍', '❤️', '😆', '😮', '😢'].map((e) => `<button data-react="${m.id}" data-emoji="${e}" aria-label="React ${e}">${e}</button>`).join('')}
    ${mine ? `<button data-edit="${m.id}" aria-label="Edit">✎</button><button data-del="${m.id}" aria-label="Delete">🗑</button>` : ''}</div></div>`;
}
function renderMessages(scroll) {
  const box = $('#messages');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  let html = '', prev = null;
  for (const m of S.messages) {
    if (!prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString()) { html += `<div class="day">${fmtDay(m.ts)}</div>`; prev = null; }
    html += messageHtml(m, prev); prev = m;
  }
  box.innerHTML = html || '<p class="muted day">No messages yet — say hi 👋</p>';
  if (scroll || atBottom) box.scrollTop = box.scrollHeight;
  const last = S.messages.at(-1);
  $('#quick').innerHTML = last && last.user_id !== S.me.id ? ['Wow!', 'Thanks', 'Nice!'].map((q) => `<button data-quick="${q}">${q}</button>`).join('') : '';
}
$('#messages').addEventListener('click', async (e) => {
  const r = e.target.closest('[data-react]');
  if (r) return api(`/api/messages/${r.dataset.react}/react`, { method: 'POST', body: { emoji: r.dataset.emoji } });
  const ed = e.target.closest('[data-edit]');
  if (ed) {
    const m = S.messages.find((x) => x.id === +ed.dataset.edit);
    const body = await prompt2('Edit message', [{ name: 'body', label: 'Message', value: m.body, textarea: true }]);
    if (body) api(`/api/messages/${m.id}`, { method: 'PUT', body });
  }
  const del = e.target.closest('[data-del]');
  if (del && confirm('Delete this message?')) api(`/api/messages/${del.dataset.del}`, { method: 'DELETE' });
});
$('#quick').onclick = (e) => { const q = e.target.dataset.quick; if (q) sendMessage(q); };

// composer
const input = $('#input');
input.addEventListener('input', () => {
  input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px';
  if (Date.now() - (input.lastTyping || 0) > 2500) { input.lastTyping = Date.now(); wsSend({ type: 'typing', convo_id: S.current }); }
});
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); } });
$('#composer').onsubmit = (e) => { e.preventDefault(); sendMessage(input.value); };
async function sendMessage(text) {
  if (!text.trim() && !S.pendingFile) return;
  const file = S.pendingFile; S.pendingFile = null; $('#attachPreview').classList.add('hidden');
  input.value = ''; input.style.height = 'auto';
  try { await api(`/api/convos/${S.current}/messages`, { method: 'POST', body: { body: text, file } }); }
  catch (err) { toast(esc(err.message)); input.value = text; }
}
$('#fileInput').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  $('#attachPreview').classList.remove('hidden'); $('#attachPreview').textContent = `Uploading ${f.name}…`;
  try {
    const { file } = await api(`/api/files?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f, headers: { 'content-type': f.type || 'application/octet-stream' } });
    S.pendingFile = file; $('#attachPreview').innerHTML = `📎 ${esc(file.name)} <button type="button" class="link" id="rmAttach">remove</button>`;
    $('#rmAttach').onclick = () => { S.pendingFile = null; $('#attachPreview').classList.add('hidden'); };
  } catch (err) { $('#attachPreview').textContent = 'Upload failed: ' + err.message; }
};
const EMOJI = '😀 😂 😊 😍 🤔 😎 😢 😡 👍 👎 👏 🙏 🎉 🔥 ❤️ ✅ 👀 💯 🚀 ☕ 😅 🙌 🤝 💡'.split(' ');
$('#emojiPicker').innerHTML = EMOJI.map((e) => `<button type="button">${e}</button>`).join('');
$('#emojiBtn').onclick = () => $('#emojiPicker').classList.toggle('hidden');
$('#emojiPicker').onclick = (e) => { if (e.target.tagName === 'BUTTON') { input.value += e.target.textContent; input.focus(); } };

// header actions
$('#favBtn').onclick = async () => { const c = S.convos.get(S.current); c.fav = !c.fav; await api(`/api/convos/${c.id}/fav`, { method: 'POST', body: { fav: c.fav } }); renderHead(); renderList(); };
$('#leaveBtn').onclick = async () => {
  if (!confirm('Leave this conversation?')) return;
  await api(`/api/convos/${S.current}/leave`, { method: 'POST' });
  S.convos.delete(S.current); S.current = null; location.hash = '';
  $('#convoView').classList.add('hidden'); $('#emptyState').classList.remove('hidden'); renderList();
};
$('#addPeopleBtn').onclick = async () => {
  const c = S.convos.get(S.current), have = new Set(c.members.map((m) => m.id));
  const r = await pickUsers('Add people or agents', [...S.users.values()].filter((u) => !have.has(u.id)));
  if (r?.members.length) await api(`/api/convos/${c.id}/members`, { method: 'POST', body: r });
};
$('#newChatBtn').onclick = async () => {
  const r = await pickUsers('New chat', [...S.users.values()].filter((u) => u.id !== S.me.id), true);
  if (!r?.members.length) return;
  const kind = r.members.length === 1 && !r.name ? 'dm' : 'group';
  const { id } = await api('/api/convos', { method: 'POST', body: { kind, name: r.name, members: r.members } });
  await waitConvo(id); openConvo(id);
};
$('#newChannelBtn').onclick = async () => {
  const r = await prompt2('New channel', [{ name: 'team', label: 'Team', value: 'Everyone' }, { name: 'name', label: 'Channel name', required: true }], true);
  if (!r) return;
  const { id } = await api('/api/convos', { method: 'POST', body: { kind: 'channel', ...r } });
  await waitConvo(id); renderTeams(); openConvo(id);
};
async function waitConvo(id) {
  if (!S.convos.has(id)) { const { convos } = await api('/api/convos'); convos.forEach((c) => S.convos.set(c.id, c)); renderList(); }
}

// tabs
async function renderShared() {
  const { messages } = await api(`/api/convos/${S.current}/shared`);
  $('#sharedList').innerHTML = messages.length ? messages.map((m) => {
    const links = (m.body.match(/https?:\/\/[^\s<>"]+/g) || []).map((u) => `<div><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(m.preview?.url === u ? m.preview.title : u)}</a></div>`).join('');
    const f = m.file ? `<div><a href="/files/${m.file.id}?name=${encodeURIComponent(m.file.name)}&token=${S.token}" target="_blank">📄 ${esc(m.file.name)}</a></div>` : '';
    return `<div class="card">${f}${links}<small class="muted">${esc(m.display)} · ${fmtTime(m.ts)}</small></div>`;
  }).join('') : '<p class="muted">No files or links shared yet.</p>';
}
let notesTimer;
$('#notes').addEventListener('input', () => {
  $('#notesStatus').textContent = 'Saving…'; clearTimeout(notesTimer);
  notesTimer = setTimeout(() => api(`/api/convos/${S.current}/notes`, { method: 'PUT', body: { notes: $('#notes').value } }).then(() => { $('#notesStatus').textContent = 'Saved'; }), 600);
});
async function renderRecap() {
  const c = S.convos.get(S.current), ms = S.messages, week = Date.now() - 7 * 864e5;
  const recent = ms.filter((m) => m.ts > week);
  const by = Object.entries(Object.groupBy(recent, (m) => m.display)).map(([n, l]) => `${esc(n)} (${l.length})`).join(', ');
  const agents = c.members.filter((m) => m.is_agent);
  $('#recap').innerHTML = `<div class="card"><h3>Last 7 days</h3><div class="stats"><div><b>${recent.length}</b>messages</div><div><b>${recent.filter((m) => m.file || /https?:/.test(m.body)).length}</b>files & links</div><div><b>${c.members.length}</b>members</div></div>
    <p class="muted">${by || 'No activity.'}</p></div>
    <div class="card"><h3>AI recap</h3>${agents.length ? `<p>Ask an agent in this chat to summarize the conversation.</p><div class="row">${agents.map((a) => `<button class="primary" data-recap="${esc(a.name)}">Ask @${esc(a.name)}</button>`).join('')}</div>`
      : '<p class="muted">Add an agent to this conversation (👤+ button) to get AI-written recaps.</p>'}</div>
    <div class="card"><h3>Members</h3>${c.members.map((m) => `<div class="row" style="margin:6px 0">${avatar(S.users.get(m.id) || m)} ${esc(m.display)} <span class="muted">@${esc(m.name)}</span></div>`).join('')}</div>`;
  $$('[data-recap]').forEach((b) => b.onclick = () => { setTab('chat'); sendMessage(`@${b.dataset.recap} Please recap this conversation: key points, decisions, and open action items.`); });
}

// search
$('#searchForm').onsubmit = async (e) => {
  e.preventDefault();
  const term = $('#searchInput').value.trim(); if (!term) return;
  const { messages } = await api('/api/search?q=' + encodeURIComponent(term));
  showPanel(`<h2>Results for “${esc(term)}”</h2>` + (messages.length ? messages.map((m) => `<button class="card item" data-convo="${m.convo_id}" style="display:block"><b>${esc(m.display)}</b> <small class="muted">${fmtTime(m.ts)} · ${esc(S.convos.get(m.convo_id) ? convoName(S.convos.get(m.convo_id)) : '')}</small><div>${esc(m.body)}</div></button>`).join('') : '<p class="muted">No matches.</p>'));
};
function showPanel(html) {
  $('#convoView').classList.add('hidden'); $('#emptyState').classList.add('hidden');
  $('#panel').classList.remove('hidden'); $('#panel').innerHTML = html; $('#app').classList.add('open-main');
  S.current = null; renderList();
}

// ---------- dialogs ----------
function dialog(html) {
  return new Promise((resolve) => {
    const d = $('#dialog'), f = $('#dialogForm');
    f.innerHTML = html + `<div class="dialog-actions"><button value="cancel" formnovalidate>Cancel</button><button class="primary" value="ok">OK</button></div>`;
    d.onclose = () => resolve(d.returnValue === 'ok' ? new FormData(f) : null);
    d.returnValue = ''; d.showModal(); f.querySelector('input, textarea')?.focus();
  });
}
async function prompt2(title, fields, all = false) {
  const fd = await dialog(`<h2>${esc(title)}</h2>` + fields.map((f) => `<label>${esc(f.label)}${f.textarea ? `<textarea class="field" name="${f.name}" rows="${f.rows || 4}" ${f.required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`
    : f.options ? `<select class="field" name="${f.name}">${f.options.map((o) => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('')}</select>`
    : `<input class="field" name="${f.name}" value="${esc(f.value || '')}" ${f.required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}">`}</label>`).join(''));
  if (!fd) return null;
  return all ? Object.fromEntries(fd) : fd.get(fields[0].name);
}
async function pickUsers(title, users, withName = false) {
  if (!users.length) { toast('Nobody else here yet — invite teammates to sign up, or create an agent.'); return null; }
  const fd = await dialog(`<h2>${esc(title)}</h2>${withName ? '<label>Group name (optional)<input class="field" name="name"></label>' : ''}
    <div class="picks">${users.map((u) => `<label><input type="checkbox" name="m" value="${u.id}">${avatar(u)} ${esc(u.display)} <span class="muted">@${esc(u.name)}</span></label>`).join('')}</div>`);
  return fd && { name: fd.get('name') || undefined, members: fd.getAll('m').map(Number) };
}

// ---------- agents ----------
async function renderAgents() {
  const { agents } = await api('/api/agents');
  $('#agentList').innerHTML = agents.map((a) => `<button class="item" data-agent="${a.id}">${avatar(a)}<span class="meta"><div class="name">${esc(a.display)}</div><div class="sub">@${esc(a.name)} · ${esc(a.config.kind)}</div></span></button>`).join('')
    || '<p class="muted pad">No agents yet. Click + to create one.</p>';
  $$('[data-agent]').forEach((b) => b.onclick = () => showAgent(agents.find((a) => a.id === +b.dataset.agent)));
}
const origin = location.origin;
function agentDocs(a, token, secret) {
  return `<h3>Chat with it</h3><p>Open its DM, or add <b>@${esc(a.name)}</b> to any chat with the 👤+ button. In channels, mention <b>@${esc(a.name)}</b> to get a reply.</p>
  ${a.config.kind === 'webhook' ? `<h3>Your webhook receives</h3><pre>POST ${esc(a.config.url)}
x-seams-signature: sha256=HMAC_SHA256(secret, raw_body)

{ "agent": {...}, "convo": {"id","kind","name"}, "message": {"body", ...}, "history": [...] }

→ reply 200 {"text": "your answer"}  or 204 for no reply</pre>` : ''}
  <h3>Post from anywhere (any agent type)</h3><pre>curl -X POST ${origin}/api/convos/CONVO_ID/messages \\
  -H "Authorization: Bearer ${esc(token || 'AGENT_TOKEN')}" -H "content-type: application/json" \\
  -d '{"body":"Hello from my agent"}'</pre>
  <h3>Listen in real time</h3><pre>const ws = new WebSocket("${origin.replace(/^http/, 'ws')}/ws?token=${esc(token || 'AGENT_TOKEN')}");
ws.onmessage = (e) => { const ev = JSON.parse(e.data); if (ev.type === "message") console.log(ev.message); };</pre>
  ${token ? `<p><b>Save this token now — it is shown only once.</b>${secret ? ` Webhook signing secret: <code>${esc(secret)}</code>` : ''}</p>` : ''}`;
}
async function showAgent(a, token, secret) {
  const dm = [...S.convos.values()].find((c) => c.kind === 'dm' && c.members.some((m) => m.id === a.id));
  showPanel(`<div class="row">${avatar(a, true)}<h2 style="margin:0">${esc(a.display)}</h2><span class="muted">@${esc(a.name)} · ${esc(a.config.kind)}${a.config.kind === 'claude' ? ' · ' + esc(a.config.model) : ''}</span></div>
    <div class="row" style="margin:16px 0">${dm ? `<button class="primary" data-convo="${dm.id}">Open chat</button>` : ''}<button class="link" id="editAgent">Edit</button><button class="link" id="delAgent" style="color:var(--danger)">Delete</button></div>
    ${a.config.system ? `<div class="card"><h3>Instructions</h3><div>${md(a.config.system)}</div></div>` : ''}
    <div class="card">${agentDocs(a, token, secret)}</div>`);
  $('#delAgent').onclick = async () => { if (confirm(`Delete agent @${a.name}?`)) { await api(`/api/agents/${a.id}`, { method: 'DELETE' }); renderAgents(); showPanel('<p class="muted">Agent deleted.</p>'); } };
  $('#editAgent').onclick = async () => {
    const r = await prompt2('Edit agent', [{ name: 'display', label: 'Display name', value: a.display }, { name: 'system', label: 'Instructions', value: a.config.system, textarea: true, rows: 6 },
      ...(a.config.kind === 'claude' ? [{ name: 'model', label: 'Model', value: a.config.model }] : []), ...(a.config.kind === 'webhook' ? [{ name: 'url', label: 'Webhook URL', value: a.config.url }] : [])], true);
    if (r) { await api(`/api/agents/${a.id}`, { method: 'PUT', body: { kind: a.config.kind, ...r } }); renderAgents(); const { agents } = await api('/api/agents'); showAgent(agents.find((x) => x.id === a.id)); }
  };
}
$('#newAgentBtn').onclick = async () => {
  const r = await prompt2('Create an agent', [
    { name: 'kind', label: 'Type', options: [['claude', 'Built-in Claude agent (needs ANTHROPIC_API_KEY on server)'], ['webhook', 'Webhook — Seams calls your URL'], ['api', 'API bot — your code connects with a token']] },
    { name: 'name', label: 'Handle (used for @mentions)', required: true, placeholder: 'helper' },
    { name: 'display', label: 'Display name', placeholder: 'Helper Bot' },
    { name: 'system', label: 'Instructions', textarea: true, placeholder: 'You help the team triage bugs. Be brief.' },
    { name: 'url', label: 'Webhook URL (webhook type only)', placeholder: 'https://example.com/seams-hook' },
  ], true);
  if (!r) return;
  try {
    const res = await api('/api/agents', { method: 'POST', body: r });
    const { agents } = await api('/api/agents'); const a = agents.find((x) => x.id === res.id);
    await waitConvo(res.convo_id); renderAgents();
    S.users.set(a.id, a);
    showAgent(a, res.token, res.secret);
  } catch (err) { toast(esc(err.message)); }
};

// ---------- calls (WebRTC mesh) ----------
let call = null; // { convo, stream, screen, peers: Map<uid, RTCPeerConnection>, media: Map<uid, {mic, cam}>, alone, started }
let ring = null, audioCtx = null;
let ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const ICON = {
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  micOff: '<svg viewBox="0 0 24 24"><path d="M15 10V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3M4 4l16 16"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>',
  camOff: '<svg viewBox="0 0 24 24"><path d="M16 16v1a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1m4 0h5a1 1 0 0 1 1 1v3l5-3v10M3 3l18 18"/></svg>',
  screen: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M12 13V7M9 10l3-3 3 3"/></svg>',
  hang: '<svg viewBox="0 0 24 24"><path d="M3 15c5-5 13-5 18 0l-2.5 2.5-3-1.5v-2.5a10 10 0 0 0-5 0V16l-3 1.5z"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
};
$('#hangBtn .ic').innerHTML = ICON.hang; $('#screenBtn .ic').innerHTML = ICON.screen;

// soft repeating beeps for ringing; returns a stop function
function tone(freqs, every) {
  let ctx; try { ctx = new AudioContext(); } catch { return () => {}; }
  const beep = () => freqs.forEach((f, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.22;
    o.frequency.value = f; g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.22);
  });
  beep(); const timer = setInterval(beep, every);
  return () => { clearInterval(timer); ctx.close().catch(() => {}); };
}

function renderCallBanner() {
  const p = S.calls[S.current];
  const show = p?.length && call?.convo !== S.current;
  $('#callBanner').classList.toggle('hidden', !show);
  if (show) $('#callBannerText').textContent = `Call in progress with ${p.map((id) => S.users.get(id)?.display).join(', ')}`;
}
function ringing(cid, caller, video) {
  const c = S.convos.get(cid); if (!c || ring) return;
  const box = $('#incoming');
  box.innerHTML = `<div class="incoming-card" role="alertdialog" aria-labelledby="incName">
    <div class="ring">${avatar(caller, 'xl')}</div>
    <h2 id="incName">${esc(caller.display)}</h2>
    <p class="muted">Incoming ${video ? 'video' : 'audio'} call${c.kind === 'channel' ? ' in ' + esc(convoName(c)) : ''}</p>
    <div class="answer">
      <button class="ctl" data-ans="no"><span class="ic decline">${ICON.hang}</span><small>Decline</small></button>
      <button class="ctl" data-ans="audio"><span class="ic accept">${ICON.phone}</span><small>Audio</small></button>
      <button class="ctl" data-ans="video"><span class="ic accept">${ICON.cam}</span><small>Video</small></button>
    </div></div>`;
  box.classList.remove('hidden');
  ring = { cid, stop: tone([523, 659], 2600), timer: setTimeout(stopRing, 45000) };
  box.querySelector(`[data-ans="${video ? 'video' : 'audio'}"]`).focus();
  box.onclick = (e) => {
    const a = e.target.closest('[data-ans]')?.dataset.ans; if (!a) return;
    stopRing();
    if (a === 'no') wsSend({ type: 'call_decline', convo_id: cid });
    else { openConvo(cid); startCall(cid, a === 'video'); }
  };
}
function stopRing() { if (!ring) return; ring.stop(); clearTimeout(ring.timer); ring = null; $('#incoming').classList.add('hidden'); }

$('#videoBtn').onclick = () => startCall(S.current, true);
$('#audioBtn').onclick = () => startCall(S.current, false);
$('#joinCallBtn').onclick = () => startCall(S.current, true);
$('#joinAudioBtn').onclick = () => startCall(S.current, false);

async function startCall(cid, video) {
  if (call) return toast('You are already in a call.');
  const getMedia = (v) => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: v && { width: { ideal: 1280 }, height: { ideal: 720 } } });
  let stream;
  try { stream = await getMedia(video); }
  catch {
    if (video) try { stream = await getMedia(false); video = false; toast('No camera available, so you joined with audio only.'); } catch {}
    if (!stream) return toast('Calls need microphone access. Allow it in your browser’s site settings, then try again.', 6000);
  }
  const joining = S.calls[cid]?.length > 0;
  call = { convo: cid, stream, peers: new Map(), media: new Map(), video, alone: !joining, started: Date.now() };
  $('#call').classList.remove('hidden');
  $('#callTitle').textContent = convoName(S.convos.get(cid));
  $('#videos').innerHTML = '';
  addTile('me', stream, S.me);
  if (!joining) {
    call.ringback = tone([440], 3000);
    call.noAnswer = setTimeout(() => { if (call?.alone) { toast('No answer.'); endCall(); } }, 45000);
  }
  call.clock = setInterval(callClock, 1000); callClock();
  wsSend({ type: 'call_join', convo_id: cid, video });
  sendMedia(); renderCallBanner();
}
function callClock() {
  if (!call) return;
  const s = Math.floor((Date.now() - call.started) / 1000);
  $('#callStatus').textContent = call.alone ? 'Calling…' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function myMedia() {
  const v = (call.screen || call.stream).getVideoTracks()[0];
  return { mic: !!call.stream.getAudioTracks()[0]?.enabled, cam: !!v && v.enabled && v.readyState === 'live' };
}
function sendMedia() {
  if (!call) return;
  const m = myMedia();
  wsSend({ type: 'media', convo_id: call.convo, ...m });
  $('#micBtn').classList.toggle('off', !m.mic); $('#micBtn .ic').innerHTML = m.mic ? ICON.mic : ICON.micOff; $('#micBtn small').textContent = m.mic ? 'Mute' : 'Unmute';
  const camOn = !!call.stream.getVideoTracks()[0]?.enabled;
  $('#camBtn').classList.toggle('off', !camOn); $('#camBtn .ic').innerHTML = camOn ? ICON.cam : ICON.camOff;
  $('#screenBtn').classList.toggle('on', !!call.screen); $('#screenBtn small').textContent = call.screen ? 'Stop sharing' : 'Share';
  refreshTile('me');
}
function addTile(id, stream, u) {
  let t = $(`#tile-${id}`);
  if (!t) {
    t = document.createElement('div');
    t.className = 'tile' + (id === 'me' ? ' me' : ''); t.id = 'tile-' + id;
    t.innerHTML = `<video autoplay playsinline ${id === 'me' ? 'muted' : ''}></video><div class="tile-av">${avatar(u, 'xl')}</div>
      <span class="tile-name"><i class="mic-off" hidden>${ICON.micOff}</i>${esc(id === 'me' ? 'You' : u.display)}</span>`;
    $('#videos').append(t);
    $('#videos').dataset.n = $$('#videos .tile').length;
  }
  const v = $('video', t);
  if (v.srcObject !== stream) v.srcObject = stream;
  watchSpeaking(t, stream); refreshTile(id);
}
function refreshTile(id) {
  const t = $(`#tile-${id}`); if (!t || !call) return;
  const m = id === 'me' ? myMedia() : { mic: true, cam: false, ...call.media.get(id) };
  t.classList.toggle('novideo', !m.cam);
  t.classList.toggle('screen', id === 'me' && !!call.screen);
  $('.mic-off', t).hidden = m.mic;
}
// green outline on whoever is talking
function watchSpeaking(t, stream) {
  const track = stream.getAudioTracks()[0];
  if (!track || t.audioTrack === track) return;
  t.audioTrack = track;
  try {
    audioCtx ??= new AudioContext();
    const an = audioCtx.createAnalyser(); an.fftSize = 512;
    audioCtx.createMediaStreamSource(new MediaStream([track])).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const tick = () => {
      if (!t.isConnected || t.audioTrack !== track) return;
      an.getByteTimeDomainData(buf);
      let sum = 0; for (const v of buf) sum += (v - 128) ** 2;
      t.classList.toggle('speaking', track.enabled && Math.sqrt(sum / buf.length) > 4);
      setTimeout(tick, 150);
    };
    tick();
  } catch {}
}
function makePeer(uid) {
  if (call.peers.has(uid)) return call.peers.get(uid);
  const pc = new RTCPeerConnection(ICE);
  call.peers.set(uid, pc);
  call.stream.getTracks().forEach((t) => pc.addTrack(t, call.stream));
  if (!call.stream.getVideoTracks().length) pc.addTransceiver('video', { direction: 'recvonly' }); // still see others' cameras
  pc.onicecandidate = (e) => e.candidate && wsSend({ type: 'signal', convo_id: call.convo, to: uid, data: { candidate: e.candidate } });
  pc.ontrack = (e) => addTile(uid, e.streams[0] || new MediaStream([e.track]), S.users.get(uid) || { id: uid, name: 'guest', display: 'Guest' });
  pc.onconnectionstatechange = () => pc.connectionState === 'failed' && dropPeer(uid);
  // "perfect negotiation": either side may renegotiate (camera on, screen share); the lower user id yields on collisions
  pc.onnegotiationneeded = async () => {
    try { pc.making = true; await pc.setLocalDescription(); wsSend({ type: 'signal', convo_id: call.convo, to: uid, data: { sdp: pc.localDescription } }); }
    catch (err) { console.warn('negotiate', err); } finally { pc.making = false; }
  };
  return pc;
}
async function onSignal({ from, convo_id, data }) {
  if (!call || call.convo !== convo_id) return;
  const pc = makePeer(from), polite = S.me.id < from;
  try {
    if (data.sdp) {
      const collision = data.sdp.type === 'offer' && (pc.making || pc.signalingState !== 'stable');
      pc.ignoreOffer = !polite && collision;
      if (pc.ignoreOffer) return;
      await pc.setRemoteDescription(data.sdp);
      if (data.sdp.type === 'offer') { await pc.setLocalDescription(); wsSend({ type: 'signal', convo_id, to: from, data: { sdp: pc.localDescription } }); }
    } else if (data.candidate) await pc.addIceCandidate(data.candidate).catch((e) => { if (!pc.ignoreOffer) throw e; });
  } catch (err) { console.warn('signal', err); }
}
function dropPeer(uid) {
  call?.peers.get(uid)?.close(); call?.peers.delete(uid); call?.media.delete(uid);
  $(`#tile-${uid}`)?.remove(); $('#videos').dataset.n = $$('#videos .tile').length;
}
function endCall() {
  if (!call) return;
  wsSend({ type: 'call_leave', convo_id: call.convo });
  call.ringback?.(); clearTimeout(call.noAnswer); clearInterval(call.clock);
  call.peers.forEach((pc) => pc.close());
  call.stream.getTracks().forEach((t) => t.stop()); call.screen?.getTracks().forEach((t) => t.stop());
  audioCtx?.close().catch(() => {}); audioCtx = null;
  call = null; $('#call').classList.add('hidden'); renderCallBanner();
}
$('#hangBtn').onclick = endCall;
window.addEventListener('beforeunload', endCall);
document.addEventListener('keydown', (e) => {
  if (!call || e.target.matches('input, textarea')) return;
  if (e.key === 'm') $('#micBtn').click();
  if (e.key === 'v') $('#camBtn').click();
});
$('#micBtn').onclick = () => { const t = call.stream.getAudioTracks()[0]; if (t) t.enabled = !t.enabled; sendMedia(); };
// the transceiver that carries our video to each peer (created by addTrack or as recvonly)
const videoTx = (pc) => pc.getTransceivers().find((x) => x.receiver.track.kind === 'video');
$('#camBtn').onclick = async () => {
  let t = call.stream.getVideoTracks()[0];
  if (!t) { // joined audio-only: turn the camera on now
    try { t = (await navigator.mediaDevices.getUserMedia({ video: true })).getVideoTracks()[0]; } catch { return toast('Seams could not open your camera.'); }
    call.stream.addTrack(t);
    call.peers.forEach((pc) => { const tx = videoTx(pc); if (tx) { tx.direction = 'sendrecv'; if (!call.screen) tx.sender.replaceTrack(t); } else pc.addTrack(t, call.stream); });
    if (!call.screen) addTile('me', call.stream, S.me);
  } else t.enabled = !t.enabled;
  sendMedia();
};
$('#screenBtn').onclick = async () => {
  const cam = call.stream.getVideoTracks()[0] || null;
  const swap = (track) => call.peers.forEach((pc) => { const tx = videoTx(pc); if (tx) { if (tx.direction === 'recvonly') tx.direction = 'sendrecv'; tx.sender.replaceTrack(track); } });
  if (call.screen) {
    call.screen.getTracks().forEach((t) => t.stop()); call.screen = null;
    swap(cam); addTile('me', call.stream, S.me); return sendMedia();
  }
  try { call.screen = await navigator.mediaDevices.getDisplayMedia({ video: true }); } catch { return; }
  const st = call.screen.getVideoTracks()[0];
  swap(st); addTile('me', new MediaStream([st, ...call.stream.getAudioTracks()]), S.me); sendMedia();
  st.onended = () => call?.screen && $('#screenBtn').click();
};

if ('Notification' in window && Notification.permission === 'default') document.addEventListener('click', () => Notification.requestPermission(), { once: true });
start();
