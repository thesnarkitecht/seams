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

// ---------- avatars & formatting ----------
const COLORS = ['#c4314b', '#5b5fc7', '#0f6cbd', '#038387', '#8764b8', '#ca5010', '#498205', '#b4009e'];
const initials = (n) => String(n).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
function avatar(u, lg = false) {
  if (!u) return '';
  const c = COLORS[u.id % COLORS.length];
  return `<span class="av ${lg ? 'lg' : ''} ${u.is_agent ? 'bot' : ''}" style="background:${c}" aria-hidden="true">${u.is_agent ? '🤖' : esc(initials(u.display))}<i class="dot ${u.online || u.is_agent ? 'on' : ''}" data-presence="${u.id}"></i></span>`;
}
function convoAvatar(c) {
  if (c.kind === 'channel') return `<span class="av" style="background:${COLORS[c.id % COLORS.length]}" aria-hidden="true">#</span>`;
  const others = c.members.filter((m) => m.id !== S.me.id);
  return others.length === 1 ? avatar(S.users.get(others[0].id) || others[0]) : `<span class="av" style="background:#8a8886" aria-hidden="true">${others.length}</span>`;
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
      if (ev.caller && ev.caller.id !== S.me.id && ev.participants.length === 1 && !call) ringing(ev.convo_id, ev.caller);
      if (ev.left && call?.convo === ev.convo_id) dropPeer(ev.left);
      renderCallBanner(); break;
    }
    case 'call_peers': if (call?.convo === ev.convo_id) ev.peers.forEach((p) => makePeer(p, true)); break;
    case 'signal': onSignal(ev); break;
  }
}
function clearTyping(cid, uid) { if (typingTimers[cid]) delete typingTimers[cid][uid]; renderTyping(); }
function renderTyping() {
  const t = Object.entries(typingTimers[S.current] || {}).filter(([uid, v]) => Date.now() - v.t < (S.users.get(+uid)?.is_agent ? 60000 : 4000)).map(([, v]) => v.name);
  $('#typing').textContent = t.length ? `${t.join(', ')} ${t.length > 1 ? 'are' : 'is'} typing…` : '';
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
    S.convos.has(c.id) ? `<button class="item" data-convo="${c.id}"><span class="av" style="background:${COLORS[c.id % COLORS.length]}">#</span><span class="meta name">${esc(c.name)}</span></button>`
      : `<button class="item" data-join="${c.id}"><span class="av" style="background:#8a8886">#</span><span class="meta"><div class="name">${esc(c.name)}</div><div class="sub">Click to join</div></span></button>`).join('')).join('')
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
    <div class="body"><div class="head">${mine ? '' : `<b>${esc(m.display)}</b>`}${fmtTime(m.ts)}</div>
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
let call = null; // { convo, stream, peers: Map<uid, RTCPeerConnection>, video }
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
function renderCallBanner() {
  const p = S.calls[S.current];
  const show = p?.length && call?.convo !== S.current;
  $('#callBanner').classList.toggle('hidden', !show);
  if (show) $('#callBannerText').textContent = `📞 Call in progress · ${p.map((id) => S.users.get(id)?.display).join(', ')}`;
}
function ringing(cid, caller) {
  const c = S.convos.get(cid); if (!c) return;
  const t = toast(`📞 ${esc(caller.display)} is calling${c.kind === 'channel' ? ' in ' + esc(convoName(c)) : ''} <button class="primary" id="ansV">Video</button><button class="primary" id="ansA">Audio</button><button id="ansX">✕</button>`, 30000);
  $('#ansV', t).onclick = () => { t.classList.add('hidden'); openConvo(cid); startCall(cid, true); };
  $('#ansA', t).onclick = () => { t.classList.add('hidden'); openConvo(cid); startCall(cid, false); };
  $('#ansX', t).onclick = () => t.classList.add('hidden');
}
$('#videoBtn').onclick = () => startCall(S.current, true);
$('#audioBtn').onclick = () => startCall(S.current, false);
$('#joinCallBtn').onclick = () => startCall(S.current, true);
async function startCall(cid, video) {
  if (call) return toast('You are already in a call.');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true, video }); }
  catch (err) { return toast('Could not access microphone/camera: ' + esc(err.message)); }
  call = { convo: cid, stream, peers: new Map(), video };
  $('#call').classList.remove('hidden'); $('#callTitle').textContent = convoName(S.convos.get(cid));
  $('#videos').innerHTML = ''; addTile('me', stream, S.me.display + ' (you)');
  $('#camBtn').classList.toggle('off', !video); $('#micBtn').classList.remove('off');
  wsSend({ type: 'call_join', convo_id: cid });
  renderCallBanner();
}
function addTile(id, stream, label) {
  let t = $(`#tile-${id}`);
  if (!t) { t = document.createElement('div'); t.className = 'tile' + (id === 'me' ? ' me' : ''); t.id = 'tile-' + id; t.innerHTML = `<video autoplay playsinline ${id === 'me' ? 'muted' : ''}></video><span>${esc(label)}</span>`; $('#videos').append(t); }
  $('video', t).srcObject = stream;
}
function makePeer(uid, initiator) {
  if (call.peers.has(uid)) return call.peers.get(uid);
  const pc = new RTCPeerConnection(ICE);
  call.peers.set(uid, pc);
  call.stream.getTracks().forEach((t) => pc.addTrack(t, call.stream));
  if (!call.video) pc.addTransceiver('video', { direction: 'recvonly' }); // still see others' cameras
  pc.onicecandidate = (e) => e.candidate && wsSend({ type: 'signal', convo_id: call.convo, to: uid, data: { candidate: e.candidate } });
  pc.ontrack = (e) => addTile(uid, e.streams[0], S.users.get(uid)?.display || 'Guest');
  pc.onconnectionstatechange = () => pc.connectionState === 'failed' && dropPeer(uid);
  if (initiator) pc.onnegotiationneeded = async () => {
    await pc.setLocalDescription(await pc.createOffer());
    wsSend({ type: 'signal', convo_id: call.convo, to: uid, data: { sdp: pc.localDescription } });
  };
  return pc;
}
async function onSignal({ from, convo_id, data }) {
  if (!call || call.convo !== convo_id) return;
  const pc = makePeer(from, false);
  try {
    if (data.sdp) {
      await pc.setRemoteDescription(data.sdp);
      if (data.sdp.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); wsSend({ type: 'signal', convo_id, to: from, data: { sdp: pc.localDescription } }); }
    } else if (data.candidate) await pc.addIceCandidate(data.candidate);
  } catch (err) { console.warn('signal', err); }
}
function dropPeer(uid) { call?.peers.get(uid)?.close(); call?.peers.delete(uid); $(`#tile-${uid}`)?.remove(); }
function endCall() {
  if (!call) return;
  wsSend({ type: 'call_leave', convo_id: call.convo });
  call.peers.forEach((pc) => pc.close()); call.stream.getTracks().forEach((t) => t.stop()); call.screen?.getTracks().forEach((t) => t.stop());
  call = null; $('#call').classList.add('hidden'); renderCallBanner();
}
$('#hangBtn').onclick = endCall;
window.addEventListener('beforeunload', endCall);
$('#micBtn').onclick = () => { const t = call.stream.getAudioTracks()[0]; t.enabled = !t.enabled; $('#micBtn').classList.toggle('off', !t.enabled); };
$('#camBtn').onclick = async () => {
  let t = call.stream.getVideoTracks()[0];
  if (!t) { // audio call → turn camera on
    t = (await navigator.mediaDevices.getUserMedia({ video: true })).getVideoTracks()[0];
    call.stream.addTrack(t); call.peers.forEach((pc) => { const tr = pc.getTransceivers().find((x) => x.receiver.track.kind === 'video'); if (tr) { tr.direction = 'sendrecv'; tr.sender.replaceTrack(t); } else pc.addTrack(t, call.stream); });
    addTile('me', call.stream, S.me.display + ' (you)'); $('#camBtn').classList.remove('off'); return;
  }
  t.enabled = !t.enabled; $('#camBtn').classList.toggle('off', !t.enabled);
};
$('#screenBtn').onclick = async () => {
  const cam = call.stream.getVideoTracks()[0];
  const swap = (track) => call.peers.forEach((pc) => pc.getSenders().find((s) => s.track?.kind === 'video' || (!s.track && s === pc.getTransceivers().find((x) => x.receiver.track.kind === 'video')?.sender))?.replaceTrack(track));
  if (call.screen) { call.screen.getTracks().forEach((t) => t.stop()); call.screen = null; swap(cam || null); $('#screenBtn').classList.remove('off'); addTile('me', call.stream, S.me.display + ' (you)'); return; }
  try { call.screen = await navigator.mediaDevices.getDisplayMedia({ video: true }); } catch { return; }
  const st = call.screen.getVideoTracks()[0];
  call.peers.forEach((pc) => { const tr = pc.getTransceivers().find((x) => x.receiver.track.kind === 'video'); if (tr && tr.direction === 'recvonly') tr.direction = 'sendrecv'; });
  swap(st); addTile('me', call.screen, 'Your screen'); $('#screenBtn').classList.add('off');
  st.onended = () => call?.screen && $('#screenBtn').click();
};

if ('Notification' in window && Notification.permission === 'default') document.addEventListener('click', () => Notification.requestPermission(), { once: true });
start();
