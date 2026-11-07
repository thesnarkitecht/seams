// Seams web client. Vanilla JS, no build step.
// Talks to the Seams server (/api/*), which calls Microsoft Graph as the signed-in person.
// With no server (or SEAMS_DEMO=1) it runs on the example conversations in demo.js.
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get(k, d) { try { const v = localStorage.getItem('seams:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('seams:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } } };

  // ---------- icons (square caps, mitred joins) ----------
  const P = {
    bell: 'M6 16V10a6 6 0 0 1 12 0v6l2 2H4zM10 21h4',
    chat: 'M4 5h16v11H9l-5 4z',
    teams: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M16 5a3 3 0 0 1 0 6M18 13a5 5 0 0 1 3 5v2',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
    compose: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
    left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', down: 'M6 9l6 6 6-6',
    panel: 'M4 5h16v14H4zM10 5v14',
    smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2M9 9.5h.01M15 9.5h.01',
    send: 'M4 4l17 8-17 8 3-8zM7 12h8',
    format: 'M5 19L12 5l7 14M8 14h8',
    edit: 'M4 20h4L19 9l-4-4L4 16z',
    trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
    reply: 'M10 8L4 13l6 5M4 13h10a6 6 0 0 1 6 6',
    x: 'M6 6l12 12M18 6L6 18',
    plus: 'M12 5v14M5 12h14',
    star: 'M12 4l2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8z',
    hash: 'M9 4L7 20M17 4l-2 16M4 9h16M3 15h16',
    sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
    clip: 'M20 11l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7',
    people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2M17 8v6M14 11h6',
    out: 'M14 4h6v16h-6M10 8l-4 4 4 4M6 12h10',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  };
  const ic = (n, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[n]}"/></svg>`;
  const MARK = `<svg viewBox="0 0 64 64" role="img" aria-label="seams"><path d="M8 15h44v30H27l-11 9v-9H8z" fill="var(--fg)"/><path d="M15 30h30" stroke="var(--card)" stroke-width="4.2" stroke-dasharray="5.5 4"/><rect x="51" y="8" width="6" height="6" fill="#f386a1"/></svg>`;

  const STATUSES = [['Available', 'Available'], ['Busy', 'Busy'], ['DoNotDisturb', 'Do not disturb'], ['BeRightBack', 'Be right back'], ['Away', 'Appear away'], ['Offline', 'Appear offline']];
  const statusLabel = (a) => (STATUSES.find((s) => s[0] === a) || [a, a === 'PresenceUnknown' ? 'Status unknown' : a])[1];
  const LEGACY = { like: '👍', heart: '❤️', laugh: '😆', surprised: '😮', sad: '😢', angry: '😠' };
  const QUICK = ['👍', '❤️', '😆', '😮', '😢'];
  const EMOJI = ['👍', '❤️', '😆', '😮', '😢', '😠', '🙏', '👏', '🎉', '🔥', '✅', '👀', '💯', '🤝', '😊', '😂', '🙂', '😉', '🤔', '😅', '🙌', '💪', '☕', '📎', '📌', '📈', '🛢️', '⛽', '🚧', '⏰', '📅', '✍️'];

  // ---------- the API: live server or demo ----------
  const hdr = { 'content-type': 'application/json', 'x-seams': '1' };
  async function call(method, url, body) {
    const r = await fetch(url, { method, headers: hdr, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
    if (r.status === 401) { S.signedOut = true; render(); }
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j;
  }
  const enc = encodeURIComponent;
  const Live = {
    mode: 'live',
    onEvent() {},
    session: () => call('GET', '/api/session'),
    chats: () => call('GET', '/api/chats'),
    messages: (id) => call('GET', `/api/chats/${enc(id)}/messages`),
    markRead: (id) => call('POST', `/api/chats/${enc(id)}/read`),
    send: (id, b) => call('POST', `/api/chats/${enc(id)}/messages`, b),
    edit: (id, mid, b) => call('PATCH', `/api/chats/${enc(id)}/messages/${enc(mid)}`, b),
    remove: (id, mid) => call('DELETE', `/api/chats/${enc(id)}/messages/${enc(mid)}`),
    react: (id, mid, type, on) => call('POST', `/api/chats/${enc(id)}/messages/${enc(mid)}/react`, { type, on }),
    teams: () => call('GET', '/api/teams'),
    posts: (t, c) => call('GET', `/api/teams/${enc(t)}/channels/${enc(c)}/posts`),
    post: (t, c, b) => call('POST', `/api/teams/${enc(t)}/channels/${enc(c)}/posts`, b),
    reply: (t, c, p, b) => call('POST', `/api/teams/${enc(t)}/channels/${enc(c)}/posts/${enc(p)}/replies`, b),
    reactPost: (t, c, mid, type, on) => call('POST', `/api/teams/${enc(t)}/channels/${enc(c)}/messages/${enc(mid)}/react`, { type, on }),
    people: (q) => call('GET', `/api/people?q=${enc(q)}`),
    newChat: (ids, topic) => call('POST', '/api/chats', { members: ids, topic }),
    presence: (ids) => call('POST', '/api/presence', { ids }),
    setStatus: (availability) => call('POST', '/api/presence/status', { availability }),
    heartbeat: (state) => call('POST', '/api/presence/heartbeat', { state }),
  };

  // ---------- state ----------
  const S = {
    api: null, me: null, mode: 'demo', serverDemo: false, signedOut: false, error: null,
    view: 'chat', filter: null, q: '', chats: [], teams: [], open: null, items: [], loading: false,
    tab: 'chat', collapsed: store.get('collapsed', { teams: true }), favs: store.get('favs', null), presence: {}, myStatus: 'Available',
    replyTo: null, editing: null, typing: null, history: [], fwd: [], mentions: [], pinned: true, drafts: {},
  };

  // ---------- formatting ----------
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const tm = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  function when(iso) {
    if (!iso) return '';
    const d = new Date(iso), n = new Date();
    if (sameDay(d, n)) return tm(d);
    const y = new Date(n); y.setDate(n.getDate() - 1);
    if (sameDay(d, y)) return 'Yesterday';
    if (n - d < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'short' });
    return md(d);
  }
  const stamp = (iso) => { const d = new Date(iso); return sameDay(d, new Date()) ? tm(d) : `${md(d)} ${tm(d)}`; };
  function dayLabel(d) {
    const n = new Date(); const y = new Date(n); y.setDate(n.getDate() - 1);
    if (sameDay(d, n)) return 'Today';
    if (sameDay(d, y)) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }
  const initials = (n) => String(n || '?').replace(/\(.*?\)/g, '').split(/[\s._@-]+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?';
  function avatar(person, cls = '') {
    const pr = person && S.presence[person.id];
    return `<span class="av ${cls}${person?.id === S.me?.id ? ' ink' : ''}" title="${esc(person?.name || '')}">${esc(initials(person?.name))}${pr ? `<i class="pr ${esc(pr)}" title="${esc(statusLabel(pr))}"></i>` : ''}</span>`;
  }
  function chatAvatar(c, cls = '') {
    const others = c.members.filter((p) => p.id !== S.me.id);
    if (c.self || !others.length) return avatar(S.me, cls);
    if (c.chatType === 'oneOnOne') return avatar(others[0], cls);
    return `<span class="av grp ${cls}" title="${esc(c.title || '')}">${esc(initials(c.topic || others.map((p) => p.name.split(' ')[0]).join(' ')))}</span>`;
  }

  // Teams message HTML → safe HTML. Allow-list of tags and attributes; everything else is unwrapped or dropped.
  const KEEP = { P: [], BR: [], B: [], STRONG: [], I: [], EM: [], U: [], S: [], STRIKE: [], A: ['href'], UL: [], OL: [], LI: [], CODE: [], PRE: [], BLOCKQUOTE: [], SPAN: ['class'], DIV: [], IMG: ['src', 'alt'], TABLE: [], TR: [], TD: [], TH: [], TBODY: [] };
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'SVG', 'MATH', 'SYSTEMEVENTMESSAGE', 'ATTACHMENT']);
  function clean(html) {
    const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
    (function walk(node) {
      for (const el of [...node.childNodes]) {
        if (el.nodeType === 8) { el.remove(); continue; }
        if (el.nodeType !== 1) continue;
        const tag = el.tagName;
        if (tag === 'EMOJI') { el.replaceWith(doc.createTextNode(el.getAttribute('alt') || '')); continue; }
        if (tag === 'AT') { const s = doc.createElement('span'); s.className = 'at'; s.textContent = el.textContent; el.replaceWith(s); continue; }
        if (DROP.has(tag)) { el.remove(); continue; }
        if (!KEEP[tag]) { walk(el); el.replaceWith(...el.childNodes); continue; }
        for (const a of [...el.attributes]) if (!KEEP[tag].includes(a.name)) el.removeAttribute(a.name);
        if (tag === 'SPAN' && el.className !== 'at') el.removeAttribute('class');
        if (tag === 'A') { const h = el.getAttribute('href') || ''; if (!/^(https?:|mailto:)/i.test(h)) el.removeAttribute('href'); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
        if (tag === 'IMG') { const src = imgSrc(el.getAttribute('src')); if (!src) { el.replaceWith(doc.createTextNode('[image]')); continue; } el.setAttribute('src', src); el.setAttribute('loading', 'lazy'); }
        walk(el);
      }
    })(doc.body);
    return doc.body.innerHTML;
  }
  function imgSrc(src) {
    src = String(src || '');
    if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(src)) return src;
    if (S.mode === 'live' && /^https:\/\/graph\.microsoft\.com\//i.test(src)) return '/api/hosted?u=' + enc(src);
    return null;
  }
  const textOf = (html) => { const d = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html'); d.querySelectorAll('br').forEach((b) => b.replaceWith('\n')); d.querySelectorAll('p,div,li').forEach((b) => b.append('\n')); return d.body.textContent.replace(/\n{3,}/g, '\n\n').trim(); };

  // What you type → message HTML: **bold**, _italic_, `code`, ```blocks```, links, line breaks, @mentions.
  function toHtml(text, mentions) {
    const parts = String(text).split(/```/);
    let out = parts.map((seg, i) => {
      if (i % 2) return `<pre><code>${esc(seg.replace(/^\n|\n$/g, ''))}</code></pre>`;
      let s = esc(seg);
      s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
        .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?])/g, '$1<i>$2</i>')
        .replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,!?)])/g, '$1<a href="$2">$2</a>');
      return s.replace(/\n/g, '<br>');
    }).join('');
    const used = [];
    (mentions || []).forEach((p) => {
      const token = esc('@' + p.name);
      if (!out.includes(token)) return;
      const id = used.length; used.push({ id, mentionText: p.name, mentioned: { user: { id: p.id, displayName: p.name, userIdentityType: 'aadUser' } } });
      out = out.split(token).join(`<at id="${id}">${esc(p.name)}</at>`);
    });
    return { html: out, mentions: used };
  }

  // ---------- render ----------
  const app = document.getElementById('app');
  function render() {
    if (!S.me) { app.innerHTML = `<div class="empty"><div class="framed"><h3>${S.error ? 'Seams could not start' : 'Opening Seams'}</h3><p>${esc(S.error || 'Loading your chats')}</p></div></div>`; return; }
    if (S.signedOut) return renderSignedOut();
    const focusId = document.activeElement?.id; const caret = document.activeElement?.selectionStart;
    const scroll = $('.lscroll')?.scrollTop;
    const st = $('#stream'); const streamTop = st ? st.scrollTop : null; const streamKey = st?.dataset.key;
    const rbox = $('#rbox')?.value;
    app.innerHTML = `<div class="app ${S.open ? 'in-conv' : ''}">
      ${topbar()}
      <div class="body">${rail()}${listPane()}<main class="conv" aria-label="Conversation">${convPane()}</main></div>
    </div>`;
    if (scroll != null && $('.lscroll')) $('.lscroll').scrollTop = scroll;
    const box = $('#box');
    if (box) { box.value = S.editing ? S.editDraft || '' : S.drafts[draftKey()] || ''; autosize(box); }
    if (rbox != null && $('#rbox')) $('#rbox').value = rbox;
    const ns = $('#stream');
    if (ns) {
      if (S.pinned || streamKey !== ns.dataset.key || streamTop == null) ns.scrollTop = ns.scrollHeight; else ns.scrollTop = streamTop;
      watchStream(ns);
    }
    if (focusId && document.getElementById(focusId)) { const el = document.getElementById(focusId); el.focus({ preventScroll: true }); if (el.setSelectionRange && el.value) { const c = Math.min(caret ?? el.value.length, el.value.length); el.setSelectionRange(c, c); } }
  }
  function renderSignedOut() {
    app.innerHTML = `<div class="empty" style="height:100%"><div class="framed"><div class="brand" style="justify-content:center;margin-bottom:12px"><span style="width:56px;height:56px;display:block">${MARK}</span></div>
      <h3>Sign in to Seams</h3><p>Seams uses your organisation's app registration. Sign in once with your Microsoft work account and your chats and channels open here, sent as you.</p>
      <p style="margin-top:16px"><a class="btn primary" href="/auth/login">Sign in with Microsoft</a></p></div></div>`;
  }
  function topbar() {
    const live = S.mode === 'live';
    return `<header class="topbar">
      <div class="brand">${MARK}</div>
      <div class="navbtns"><button class="iconbtn" data-act="back" aria-label="Back" ${S.history.length ? '' : 'disabled'}>${ic('left')}</button><button class="iconbtn" data-act="fwd" aria-label="Forward" ${S.fwd.length ? '' : 'disabled'}>${ic('right')}</button><span class="word">seams</span></div>
      <label class="search">${ic('search')}<span class="sr">Search</span><input id="q" type="search" placeholder="Search people and chats" value="${esc(S.q)}" autocomplete="off"><kbd>⌘E</kbd></label>
      <div class="topright"><span class="modepill ${live ? 'live' : ''}" title="${live ? 'Signed in to Microsoft Teams through Microsoft Graph' : 'Example conversations'}"><i></i><span>${live ? 'Teams · live' : 'Example data'}</span></span>
        <button data-act="me-menu" aria-label="Your status and settings">${avatar({ ...S.me, id: S.me.id }, 'ink')}</button></div>
    </header>`;
  }
  function rail() {
    const unread = S.chats.filter((c) => c.unread).length;
    const b = (v, icon, label, badge) => `<button data-act="view" data-v="${v}" aria-current="${S.view === v ? 'page' : 'false'}">${ic(icon)}<span>${label}</span>${badge ? `<i class="badge">${badge}</i>` : ''}</button>`;
    return `<nav class="rail" aria-label="Apps">${b('activity', 'bell', 'Activity', unread)}${b('chat', 'chat', 'Chat')}${b('teams', 'teams', 'Teams')}<span class="spacer"></span><button class="more" data-act="theme" aria-label="Switch theme">${ic('sun')}<span>Theme</span></button></nav>`;
  }

  const favIds = () => S.favs || S.chats.filter((c) => c.fav).map((c) => c.id);
  function visibleChats() {
    const q = S.q.trim().toLowerCase();
    return S.chats.filter((c) => (S.filter !== 'unread' || c.unread) && (!q || c.title.toLowerCase().includes(q) || c.members.some((p) => p.name.toLowerCase().includes(q))));
  }
  function chatRow(c) {
    const cur = S.open?.kind === 'chat' && S.open.id === c.id;
    const prev = c.last ? `${c.last.mine ? 'You: ' : c.chatType !== 'oneOnOne' && c.last.from ? c.last.from.split(' ')[0] + ': ' : ''}${c.last.text}` : 'No messages yet';
    return `<button class="row ${c.unread ? 'unread' : ''}" data-act="open-chat" data-id="${esc(c.id)}" aria-current="${cur}">
      ${chatAvatar(c)}<span class="txt"><span class="nm"><b>${esc(c.title)}</b><span class="when">${esc(when(c.last?.at))}</span></span><span class="prev">${esc(prev)}</span></span></button>`;
  }
  function section(key, title, n, body) {
    const open = !S.collapsed[key];
    return `<div class="sec"><button class="sechead" data-act="toggle-sec" data-k="${key}" aria-expanded="${open}">${ic('down')}${esc(title)}${n != null ? `<span class="n">${n}</span>` : ''}</button>${open ? body : ''}</div>`;
  }
  function teamsBlock() {
    if (!S.teams.length) return `<p class="lbl" style="padding:8px">No teams yet</p>`;
    return S.teams.map((t) => {
      const k = 'team:' + t.id; const open = !S.collapsed[k];
      return `<button class="row sm team" data-act="toggle-sec" data-k="${esc(k)}" aria-expanded="${open}"><span class="av sm ink sq">${esc(initials(t.name))}</span><span class="txt"><span class="nm"><b>${esc(t.name)}</b></span></span>${ic('down')}</button>
      ${open ? t.channels.map((c) => `<button class="row chan" data-act="open-chan" data-t="${esc(t.id)}" data-id="${esc(c.id)}" aria-current="${S.open?.kind === 'channel' && S.open.id === c.id && S.open.teamId === t.id}"><span class="hash">#</span>${esc(c.name)}</button>`).join('') : ''}`;
    }).join('');
  }
  function listPane() {
    const head = (title) => `<div class="lhead"><h1>${title}</h1><button class="iconbtn" data-act="refresh" aria-label="Refresh">${ic('more')}</button><button class="iconbtn" data-act="new-chat" aria-label="New chat">${ic('compose')}</button></div>`;
    if (S.view === 'teams') {
      return `<aside class="list" aria-label="Teams">${head('Teams')}<div class="lscroll">${teamsBlock()}</div></aside>`;
    }
    if (S.view === 'activity') {
      const un = S.chats.filter((c) => c.unread);
      return `<aside class="list" aria-label="Activity">${head('Activity')}<div class="lscroll">${section('act', 'Unread', un.length, un.map(chatRow).join('') || '<p class="lbl" style="padding:8px">You are all caught up</p>')}</div></aside>`;
    }
    const chips = [['unread', 'Unread'], ['channels', 'Channels'], ['chats', 'Chats']].map(([k, l]) => `<button class="fchip" data-act="filter" data-f="${k}" aria-pressed="${S.filter === k}">${l}</button>`).join('');
    const list = visibleChats(); const favs = favIds();
    const fav = list.filter((c) => favs.includes(c.id)); const rest = list.filter((c) => !favs.includes(c.id));
    let body = '';
    if (S.filter !== 'channels') {
      if (fav.length) body += section('fav', 'Favorites', null, fav.map(chatRow).join(''));
      body += section('chats', 'Chats', null, rest.map(chatRow).join('') || '<p class="lbl" style="padding:8px">No chats match</p>');
    }
    if (S.filter !== 'chats' && S.filter !== 'unread') body += section('teams', 'Teams and channels', null, teamsBlock());
    return `<aside class="list" aria-label="Chats">${head('Chat')}<div class="filters">${chips}</div><div class="lscroll">${body}</div></aside>`;
  }

  function current() {
    if (!S.open) return null;
    if (S.open.kind === 'chat') return S.chats.find((c) => c.id === S.open.id);
    const t = S.teams.find((x) => x.id === S.open.teamId); const c = t?.channels.find((x) => x.id === S.open.id);
    return c ? { ...c, team: t } : null;
  }
  function convPane() {
    const banner = S.mode === 'demo' ? `<div class="banner"><b>Example</b><span>${S.serverDemo ? 'These are example conversations. Set the app registration in .env and restart to use your own Teams.' : 'Example conversations, sent nowhere. Run Seams with your app registration to use your own Teams.'}</span></div>` : '';
    const cur = current();
    if (!cur) {
      return `<div style="display:grid;grid-template-rows:auto 1fr;min-height:0">${banner}<div class="empty"><div class="framed"><h3>Pick up where you left off</h3><p>Choose a chat or channel on the left, or start a new chat. Messages you send here arrive in Teams as you.</p><p style="margin-top:14px"><button class="btn primary" data-act="new-chat">${ic('compose')} New chat</button></p></div></div></div>`;
    }
    const isChat = S.open.kind === 'chat';
    const title = isChat ? cur.title : cur.name;
    const meta = isChat ? (cur.chatType === 'oneOnOne' && !cur.self ? statusLabel(S.presence[cur.members.find((p) => p.id !== S.me.id)?.id] || 'PresenceUnknown') : `${cur.members.length} people`) : cur.team.name;
    const tabs = isChat ? [['chat', 'Chat'], ['shared', 'Shared'], ['people', 'People']] : [['chat', 'Posts'], ['shared', 'Shared']];
    const fav = isChat && favIds().includes(cur.id);
    const head = `<div class="chead">
      <button class="iconbtn back" data-act="close" aria-label="Back to list">${ic('left')}</button>
      <div class="title">${isChat ? chatAvatar(cur, 'lg') : `<span class="av lg ink sq">${ic('hash')}</span>`}<div style="min-width:0"><h2>${esc(title)}</h2><div class="meta">${esc(meta)}</div></div></div>
      <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-act="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}</button>`).join('')}</div>
      <div class="acts">${isChat ? `<button class="iconbtn" data-act="fav" aria-label="${fav ? 'Remove from favorites' : 'Add to favorites'}" style="${fav ? 'color:var(--fg)' : ''}">${ic('star')}</button><button class="iconbtn" data-act="add-people" aria-label="Start a group chat with these people">${ic('people')}</button>` : ''}<button class="iconbtn" data-act="find-in" aria-label="Search this conversation">${ic('search')}</button></div>
    </div>`;
    let main;
    if (S.tab === 'shared') main = `<div class="panel">${sharedPanel()}</div>`;
    else if (S.tab === 'people') main = `<div class="panel">${peoplePanel(cur)}</div>`;
    else main = `<div class="stream" id="stream" data-key="${esc(draftKey())}"><div class="stream-inner">${streamInner()}</div></div><button class="jump" data-act="jump" ${S.pinned ? 'hidden' : ''}>${ic('down')} Latest</button>`;
    const showComposer = S.tab === 'chat';
    return `<div>${head}${banner}</div>${main}${showComposer ? composer(isChat ? 'Type a message' : 'Start a post') : '<div></div>'}`;
  }

  function streamInner() {
    const isChat = S.open?.kind === 'chat';
    return `${S.loading && !S.items.length ? '<p class="sysmsg">Loading messages</p>' : isChat ? chatStream() : channelStream()}${S.typing ? `<p class="typing"><span class="dots"><i></i><i></i><i></i></span>${esc(S.typing)} is typing</p>` : ''}`;
  }
  // Partial updates, so polling never resets what you are typing or where you have scrolled.
  function renderStream() {
    const s = $('#stream'); if (!s || S.replyTo) return render();
    const top = s.scrollTop;
    s.firstElementChild.innerHTML = streamInner();
    s.scrollTop = S.pinned ? s.scrollHeight : top;
  }
  function renderList() {
    const l = $('.list'), r = $('.rail'); if (!l || !r) return render();
    const top = $('.lscroll')?.scrollTop;
    l.outerHTML = listPane(); r.outerHTML = rail();
    if (top != null && $('.lscroll')) $('.lscroll').scrollTop = top;
  }
  function reactionsHtml(m, ctx) {
    if (!m.reactions?.length) return '';
    return `<div class="reacts">${m.reactions.map((r) => { const e = LEGACY[r.type] || r.type; const mine = r.users.includes(S.me.id); return `<button class="${mine ? 'me' : ''}" data-act="react" data-id="${esc(m.id)}" data-e="${esc(r.type)}" data-on="${!mine}" ${ctx} title="${r.users.length} ${r.users.length === 1 ? 'reaction' : 'reactions'}">${esc(e)}<b>${r.users.length}</b></button>`; }).join('')}</div>`;
  }
  function attachHtml(m) {
    return (m.attachments || []).map((a) => {
      const ext = (a.type || String(a.name).split('.').pop() || 'file').slice(0, 4).toUpperCase();
      return `<a class="att" href="${a.url && /^https:/.test(a.url) ? esc(a.url) : '#'}" target="_blank" rel="noopener noreferrer"><span class="ft ${ext === 'PDF' ? 'pdf' : ''}">${esc(ext)}</span><span class="an"><span>${esc(a.name)}</span><small>${esc(a.size || 'File')}</small></span></a>`;
    }).join('');
  }
  function hoverbar(m, mine, ctx) {
    return `<div class="hoverbar" role="toolbar" aria-label="Message actions">${QUICK.map((e) => `<button data-act="react" data-id="${esc(m.id)}" data-e="${e}" data-on="true" ${ctx} aria-label="React ${e}">${e}</button>`).join('')}
      <button data-act="react-more" data-id="${esc(m.id)}" ${ctx} aria-label="More reactions">${ic('smile')}</button><span class="sep"></span>
      ${mine ? `<button data-act="edit" data-id="${esc(m.id)}" aria-label="Edit">${ic('edit')}</button><button data-act="delete" data-id="${esc(m.id)}" aria-label="Delete">${ic('trash')}</button>` : `<button data-act="quote" data-id="${esc(m.id)}" aria-label="Reply with quote">${ic('reply')}</button>`}</div>`;
  }
  function bubble(m) {
    if (m.deleted) return `<div class="bubble deleted">This message has been deleted.</div>`;
    return `<div class="bubble">${clean(m.html)}${m.edited ? '<span class="edited">Edited</span>' : ''}${attachHtml(m)}</div>`;
  }
  function chatStream() {
    if (!S.items.length) return `<div class="empty" style="height:auto;padding-top:80px"><div class="framed"><h3>Say hello</h3><p>This is the start of your conversation.</p></div></div>`;
    let out = ''; let prevDay = null; let g = null;
    const flush = () => { if (!g) return; const mine = g.from?.id === S.me.id;
      out += `<div class="grp ${mine ? 'mine' : ''}">${mine ? '' : avatar(g.from, 'lg')}<div class="ghead">${mine ? '' : `<b>${esc(g.from?.name || 'Unknown')}</b>`}<time>${esc(stamp(g.items[0].at))}</time></div>${g.items.map((m) =>
        `<div class="msg ${m.pending ? 'pending' : ''} ${m.failed ? 'failed' : ''}" data-mid="${esc(m.id)}">${m.deleted || m.pending ? '' : hoverbar(m, mine, '')}${bubble(m)}${reactionsHtml(m, '')}${m.failed ? `<div class="note">Not sent: ${esc(m.failed)} · <button data-act="retry" data-id="${esc(m.id)}" style="text-decoration:underline">Try again</button></div>` : ''}</div>`).join('')}</div>`;
      g = null; };
    for (const m of S.items) {
      const d = new Date(m.at);
      if (!prevDay || !sameDay(d, prevDay)) { flush(); out += `<div class="day"><span>${esc(dayLabel(d))}</span></div>`; prevDay = d; }
      if (m.system) { flush(); out += `<p class="sysmsg">${esc(textOf(m.html) || m.system)}</p>`; continue; }
      if (g && g.from?.id === m.from?.id && d - new Date(g.items.at(-1).at) < 5 * 60e3) g.items.push(m);
      else { flush(); g = { from: m.from, items: [m] }; }
    }
    flush();
    return out;
  }
  function channelStream() {
    if (!S.items.length) return `<div class="empty" style="height:auto;padding-top:80px"><div class="framed"><h3>No posts yet</h3><p>Start a post below. Everyone in the channel will see it in Teams.</p></div></div>`;
    return S.items.map((p) => {
      const ctx = `data-post="1"`;
      return `<article class="post" data-mid="${esc(p.id)}">
        <div class="phead">${avatar(p.from, 'lg')}<b>${esc(p.from?.name || 'Unknown')}</b><time>${esc(stamp(p.at))}</time></div>
        ${p.subject ? `<div class="psubj" style="padding-left:56px">${esc(p.subject)}</div>` : ''}
        <div class="pbody msg">${p.deleted ? '' : hoverbar(p, false, ctx)}${bubble(p)}${reactionsHtml(p, ctx)}</div>
        ${p.replies?.length ? `<div class="replies">${p.replies.map((r) => `<div class="reply">${avatar(r.from, 'sm')}<div><div class="rmeta"><b>${esc(r.from?.name || '')}</b><time>${esc(stamp(r.at))}</time></div>${bubble(r)}${reactionsHtml(r, ctx)}</div></div>`).join('')}</div>` : ''}
        ${S.replyTo === p.id ? `<div class="rcompose"><div class="cbox"><label class="sr" for="rbox">Reply</label><textarea id="rbox" rows="1" placeholder="Reply"></textarea><button class="send" data-act="send-reply" data-id="${esc(p.id)}" aria-label="Send reply">${ic('send')}</button></div></div>`
          : `<button class="rbtn" data-act="open-reply" data-id="${esc(p.id)}">${ic('reply')} Reply</button>`}
      </article>`;
    }).join('');
  }
  function sharedPanel() {
    const links = []; const files = [];
    const all = S.open.kind === 'chat' ? S.items : S.items.flatMap((p) => [p, ...(p.replies || [])]);
    for (const m of all) {
      (m.attachments || []).forEach((a) => files.push({ a, m }));
      const d = new DOMParser().parseFromString(`<body>${m.html || ''}</body>`, 'text/html');
      d.querySelectorAll('a[href]').forEach((a) => { if (/^https?:/.test(a.getAttribute('href'))) links.push({ href: a.getAttribute('href'), text: a.textContent, m }); });
    }
    const row = (main, sub) => `<div>${main}<span class="grow"></span><small>${esc(sub)}</small></div>`;
    return `<div class="framed" style="padding:16px 18px;max-width:780px"><h3 class="lbl" style="margin-bottom:10px">Files</h3><div class="plist">${files.map(({ a, m }) => row(`<span class="grow">${esc(a.name)}</span>`, `${m.from?.name || ''} · ${stamp(m.at)}`)).join('') || '<div><small>No files shared yet</small></div>'}</div>
      <h3 class="lbl" style="margin:20px 0 10px">Links</h3><div class="plist">${links.map(({ href, text, m }) => row(`<a class="grow" href="${esc(href)}" target="_blank" rel="noopener noreferrer" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(text || href)}</a>`, `${m.from?.name || ''} · ${stamp(m.at)}`)).join('') || '<div><small>No links shared yet</small></div>'}</div></div>`;
  }
  function peoplePanel(c) {
    return `<div class="framed" style="padding:16px 18px;max-width:780px"><h3 class="lbl" style="margin-bottom:10px">${c.members.length} people</h3><div class="plist">${c.members.map((p) => `<div>${avatar(p)}<span class="grow">${esc(p.name)}${p.id === S.me.id ? ' (You)' : ''}<small>${esc(p.email || '')}</small></span><small>${esc(statusLabel(S.presence[p.id] || 'PresenceUnknown'))}</small></div>`).join('')}</div></div>`;
  }
  function composer(placeholder) {
    const editing = S.editing ? `<div class="replyto"><b>Editing</b><span>${esc(textOf(S.items.find((m) => m.id === S.editing)?.html || ''))}</span><button class="iconbtn" data-act="cancel-edit" aria-label="Cancel edit">${ic('x')}</button></div>` : '';
    const quote = S.quote ? `<div class="replyto"><b>${esc(S.quote.name)}</b><span>${esc(S.quote.text)}</span><button class="iconbtn" data-act="cancel-quote" aria-label="Remove quote">${ic('x')}</button></div>` : '';
    return `<div class="composer">${editing}${quote}<div class="cbox"><label class="sr" for="box">${placeholder}</label><textarea id="box" rows="1" placeholder="${placeholder}"></textarea>
      <div class="tools"><button class="iconbtn" data-act="fmt-help" aria-label="Formatting">${ic('format')}</button><button class="iconbtn" data-act="emoji" aria-label="Emoji">${ic('smile')}</button><span class="sep"></span>
      <button class="send" data-act="send" aria-label="${S.editing ? 'Save edit' : 'Send'}">${ic('send')}</button></div></div>
      <div class="chint"><span>Enter to send</span><span>Shift+Enter for a new line</span><span>**bold** _italic_ \`code\`</span><span>@ to mention</span></div></div>`;
  }

  // ---------- behaviour ----------
  function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 2800); }
  function closeFloat() { document.querySelectorAll('.menu,.sheet').forEach((x) => x.remove()); }
  function menuAt(anchor, html, onClick) {
    closeFloat();
    const m = document.createElement('div'); m.className = 'menu'; m.innerHTML = html; document.body.append(m);
    const r = anchor.getBoundingClientRect(); const w = m.offsetWidth, hgt = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
    m.style.top = (r.bottom + hgt + 8 > window.innerHeight ? Math.max(8, r.top - hgt - 6) : r.bottom + 6) + 'px';
    m.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { onClick(b); } });
    setTimeout(() => document.addEventListener('click', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', off); } }), 0);
    return m;
  }
  function autosize(t) { t.style.height = 'auto'; t.style.height = Math.min(200, t.scrollHeight) + 'px'; }
  const draftKey = () => (S.open ? `${S.open.kind}:${S.open.teamId || ''}:${S.open.id}:${S.tab}` : '');
  const nearBottom = (s) => s.scrollHeight - s.scrollTop - s.clientHeight < 120;
  function scrollDown(force) { const s = $('#stream'); if (!s) return; if (force || S.pinned) { S.pinned = true; s.scrollTop = s.scrollHeight; const j = $('.jump'); if (j) j.hidden = true; } }
  // Images and late layout grow the stream after render; stay at the bottom while pinned there.
  let ro = null;
  function watchStream(el) {
    ro?.disconnect();
    if (!window.ResizeObserver) return;
    ro = new ResizeObserver(() => { if (S.pinned) el.scrollTop = el.scrollHeight; });
    ro.observe(el.firstElementChild); ro.observe(el);
  }
  function nav(open) { if (S.open) S.history.push(S.open); S.fwd = []; return go(open); }

  async function go(open) {
    S.open = open; S.items = []; S.tab = 'chat'; S.replyTo = null; S.editing = null; S.quote = null; S.typing = null; S.mentions = []; S.loading = true; S.pinned = true;
    if (S.api.mode === 'demo') S.api.openId = open?.id;
    render();
    if (!open) return;
    await loadOpen(true);
  }
  async function loadOpen(first) {
    const o = S.open; if (!o) return;
    try {
      const items = o.kind === 'chat' ? await S.api.messages(o.id) : await S.api.posts(o.teamId, o.id);
      if (S.open !== o) return;
      const pending = S.items.filter((m) => m.pending || m.failed);
      const changed = JSON.stringify(items) !== JSON.stringify(S.items.filter((m) => !m.pending && !m.failed));
      S.items = [...items, ...pending]; S.loading = false;
      if (o.kind === 'chat') { const c = S.chats.find((x) => x.id === o.id); if (c?.unread) { c.unread = false; S.api.markRead(o.id).catch(() => {}); } }
      if (first || changed) { first ? render() : renderStream(); if (first) scrollDown(true); else if (!S.pinned) { const j = $('.jump'); if (j) { j.hidden = false; j.classList.add('new'); j.lastChild.textContent = ' New messages'; } } }
      if (first && o.kind === 'chat') { const c = S.chats.find((x) => x.id === o.id); if (c) refreshPresence(c.members.map((p) => p.id)); }
    } catch (e) { S.loading = false; render(); toast(e.message); }
  }
  async function refreshLists() {
    const [chats, teams] = await Promise.all([S.api.chats(), S.api.teams().catch(() => S.teams)]);
    S.chats = chats; S.teams = teams;
    if (S.favs == null) { S.favs = chats.filter((c) => c.fav).map((c) => c.id); }
  }
  async function refreshPresence(ids) {
    ids = [...new Set(ids)].filter(Boolean); if (!ids.length) return;
    try { Object.assign(S.presence, await S.api.presence(ids)); render(); } catch { /* presence is optional */ }
  }

  async function send() {
    const box = $('#box'); if (!box) return;
    const text = box.value.replace(/\s+$/, ''); if (!text.trim()) return;
    const { html: body, mentions } = toHtml(text, S.mentions);
    const html = S.quote ? `<blockquote><b>${esc(S.quote.name)}</b><br>${esc(S.quote.text)}</blockquote>${body}` : body;
    box.value = ''; autosize(box); S.mentions = []; S.quote = null; if (!S.editing) delete S.drafts[draftKey()]; S.pinned = true;
    const o = S.open;
    if (S.editing) {
      const id = S.editing; S.editing = null;
      try { await S.api.edit(o.id, id, { html, mentions }); await loadOpen(); toast('Message edited'); } catch (e) { toast(e.message); }
      return;
    }
    if (o.kind === 'channel') {
      try { await S.api.post(o.teamId, o.id, { html, mentions }); await loadOpen(); scrollDown(true); } catch (e) { toast(e.message); box.value = text; }
      return;
    }
    const temp = { id: 'tmp-' + Date.now(), at: new Date().toISOString(), from: { id: S.me.id, name: S.me.name }, html, reactions: [], pending: true, body: { html, mentions } };
    S.items.push(temp); render(); scrollDown(true);
    deliver(o, temp);
  }
  async function deliver(o, temp) {
    try {
      await S.api.send(o.id, temp.body);
      S.items = S.items.filter((m) => m !== temp);
      await loadOpen(); scrollDown(true);
      const c = S.chats.find((x) => x.id === o.id); if (c) { c.last = { at: new Date().toISOString(), mine: true, text: textOf(temp.html) }; S.chats.sort((a, b) => (b.last?.at || '').localeCompare(a.last?.at || '')); render(); }
    } catch (e) { temp.pending = false; temp.failed = e.message; render(); }
  }

  function emojiPicker(anchor, pick) {
    menuAt(anchor, `<div class="mh lbl">Emoji</div><div class="emojis">${EMOJI.map((e) => `<button data-e="${e}" aria-label="${e}">${e}</button>`).join('')}</div>`, (b) => { if (b.dataset.e) { pick(b.dataset.e); closeFloat(); } });
  }
  function meMenu(anchor) {
    const theme = document.documentElement.dataset.theme || 'system';
    menuAt(anchor, `<div class="mh"><b>${esc(S.me.name)}</b><div class="lbl" style="margin-top:4px;text-transform:none">${esc(S.me.email || '')}</div></div><hr>
      ${STATUSES.map(([k, l]) => `<button data-status="${k}"><i class="dot ${k}"></i>${l}${S.myStatus === k ? ' ·' : ''}</button>`).join('')}
      <button data-status="reset"><i class="dot"></i>Reset status</button><hr>
      <button data-theme-set="next">${ic('sun')}Theme: ${theme}</button>
      ${S.mode === 'live' ? `<button data-signout="1">${ic('out')}Sign out</button>` : ''}`, async (b) => {
      if (b.dataset.status) {
        const a = b.dataset.status === 'reset' ? null : b.dataset.status; closeFloat();
        try { const r = await S.api.setStatus(a); S.myStatus = r.availability || a || 'Available'; S.presence[S.me.id] = S.myStatus; render(); toast(a ? `Status set to ${statusLabel(a)}` : 'Status reset'); } catch (e) { toast(e.message); }
      } else if (b.dataset.themeSet) { cycleTheme(); closeFloat(); }
      else if (b.dataset.signout) { location.href = '/auth/logout'; }
    });
  }
  function cycleTheme() {
    const order = ['system', 'light', 'dark']; const cur = document.documentElement.dataset.theme || 'system';
    const next = order[(order.indexOf(cur) + 1) % 3];
    if (next === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = next;
    store.set('theme', next); toast(`Theme: ${next}`); render();
  }

  function newChatSheet(preset = []) {
    closeFloat();
    const picks = [...preset];
    const sh = document.createElement('div'); sh.className = 'sheet';
    sh.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-label="New chat"><div class="cardhead">New chat<button class="iconbtn" data-x aria-label="Close">${ic('x')}</button></div>
      <div class="cardbody"><div class="field"><label class="lbl" for="to">To</label><div class="picks" id="picks"></div><input id="to" placeholder="Type a name or email" autocomplete="off"></div>
      <div class="field" id="topicf" hidden><label class="lbl" for="topic">Group name (optional)</label><input id="topic" placeholder="e.g. Pecos field ops"></div>
      <div class="results" id="res"></div><div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn" data-x>Cancel</button><button class="btn primary" id="go" disabled>Start chat</button></div></div></div>`;
    document.body.append(sh);
    const draw = () => { $('#picks', sh).innerHTML = picks.map((p) => `<span class="pick">${esc(p.name)}<button data-rm="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">${ic('x')}</button></span>`).join(''); $('#go', sh).disabled = !picks.length; $('#topicf', sh).hidden = picks.length < 2; };
    let t; const search = () => { clearTimeout(t); t = setTimeout(async () => { const q = $('#to', sh).value.trim(); if (!q) { $('#res', sh).innerHTML = ''; return; } try { const r = await S.api.people(q); $('#res', sh).innerHTML = r.filter((p) => !picks.some((x) => x.id === p.id)).map((p) => `<button data-add='${esc(JSON.stringify(p))}'>${avatar(p, 'sm')}<span>${esc(p.name)}<small>${esc(p.title ? p.title + ' · ' : '')}${esc(p.email || '')}</small></span></button>`).join('') || '<p class="lbl" style="padding:10px">Nobody found</p>'; } catch (e) { $('#res', sh).innerHTML = `<p class="lbl" style="padding:10px">${esc(e.message)}</p>`; } }, 200); };
    sh.addEventListener('input', (e) => { if (e.target.id === 'to') search(); });
    sh.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (e.target === sh || b?.hasAttribute('data-x')) { sh.remove(); return; }
      if (!b) return;
      if (b.dataset.add) { picks.push(JSON.parse(b.dataset.add)); $('#to', sh).value = ''; $('#res', sh).innerHTML = ''; draw(); $('#to', sh).focus(); }
      if (b.dataset.rm) { picks.splice(picks.findIndex((p) => p.id === b.dataset.rm), 1); draw(); }
      if (b.id === 'go') {
        b.disabled = true;
        try { const c = await S.api.newChat(picks.map((p) => p.id), $('#topic', sh).value.trim() || null); sh.remove(); await refreshLists(); if (!S.chats.some((x) => x.id === c.id)) S.chats.unshift(c); S.view = 'chat'; nav({ kind: 'chat', id: c.id }); setTimeout(() => $('#box')?.focus(), 50); }
        catch (err) { b.disabled = false; toast(err.message); }
      }
    });
    draw(); $('#to', sh).focus();
  }

  // @mention suggestions from the open chat's members
  function mentionMenu(box) {
    const before = box.value.slice(0, box.selectionStart); const m = /(?:^|\s)@([\w.'-]{0,30})$/.exec(before);
    document.querySelector('.menu.mention')?.remove();
    if (!m || S.open?.kind !== 'chat') return;
    const c = current(); const q = m[1].toLowerCase();
    const opts = c.members.filter((p) => p.id !== S.me.id && p.name.toLowerCase().includes(q)).slice(0, 6);
    if (!opts.length) return;
    const menu = menuAt(box, `<div class="mh lbl">Mention</div>${opts.map((p) => `<button data-pid="${esc(p.id)}">${avatar(p, 'sm')}${esc(p.name)}</button>`).join('')}`, (b) => {
      const p = opts.find((x) => x.id === b.dataset.pid); if (!p) return;
      const start = before.length - m[1].length - 1;
      box.value = box.value.slice(0, start) + '@' + p.name + ' ' + box.value.slice(box.selectionStart);
      if (!S.mentions.some((x) => x.id === p.id)) S.mentions.push(p);
      closeFloat(); box.focus();
    });
    menu.classList.add('mention');
    const r = box.getBoundingClientRect(); menu.style.left = r.left + 'px'; menu.style.top = Math.max(8, r.top - menu.offsetHeight - 8) + 'px';
  }

  app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act; const o = S.open;
    if (a === 'view') { S.view = b.dataset.v; render(); }
    else if (a === 'filter') { S.filter = S.filter === b.dataset.f ? null : b.dataset.f; render(); }
    else if (a === 'toggle-sec') { S.collapsed[b.dataset.k] = !S.collapsed[b.dataset.k]; store.set('collapsed', S.collapsed); render(); }
    else if (a === 'open-chat') nav({ kind: 'chat', id: b.dataset.id });
    else if (a === 'open-chan') nav({ kind: 'channel', teamId: b.dataset.t, id: b.dataset.id });
    else if (a === 'close') { S.history.push(S.open); go(null); }
    else if (a === 'back') { const p = S.history.pop(); if (S.open) S.fwd.push(S.open); go(p || null); }
    else if (a === 'fwd') { const n = S.fwd.pop(); if (S.open) S.history.push(S.open); if (n) go(n); }
    else if (a === 'tab') { S.tab = b.dataset.tab; S.pinned = true; render(); }
    else if (a === 'refresh') { await refreshLists(); render(); toast('Up to date'); }
    else if (a === 'new-chat') newChatSheet();
    else if (a === 'add-people') { const c = current(); newChatSheet(c.members.filter((p) => p.id !== S.me.id)); }
    else if (a === 'fav') { const ids = favIds(); S.favs = ids.includes(o.id) ? ids.filter((x) => x !== o.id) : [...ids, o.id]; store.set('favs', S.favs); render(); }
    else if (a === 'theme') cycleTheme();
    else if (a === 'me-menu') meMenu(b);
    else if (a === 'send') send();
    else if (a === 'emoji') emojiPicker(b, (em) => { const box = $('#box'); const p = box.selectionStart ?? box.value.length; box.value = box.value.slice(0, p) + em + box.value.slice(p); box.focus(); });
    else if (a === 'fmt-help') toast('**bold**  _italic_  `code`  ```code block```  links are detected');
    else if (a === 'find-in') { $('#q').focus(); toast('Search filters your chats and people'); }
    else if (a === 'react' || a === 'react-more') {
      const id = b.dataset.id; const post = b.hasAttribute('data-post');
      const run = async (type, on) => {
        const target = findItem(id); if (target) { let r = target.reactions.find((x) => x.type === type); if (!r) target.reactions.push(r = { type, users: [] }); r.users = r.users.filter((u) => u !== S.me.id); if (on) r.users.push(S.me.id); target.reactions = target.reactions.filter((x) => x.users.length); renderStream(); }
        try { if (post) await S.api.reactPost(o.teamId, o.id, id, type, on); else await S.api.react(o.id, id, type, on); } catch (err) { toast(err.message); loadOpen(); }
      };
      if (a === 'react-more') emojiPicker(b, (em) => run(em, true)); else run(b.dataset.e, b.dataset.on === 'true');
    }
    else if (a === 'edit') { S.editing = b.dataset.id; S.editDraft = textOf(findItem(b.dataset.id).html); render(); $('#box').focus(); }
    else if (a === 'cancel-edit') { S.editing = null; render(); }
    else if (a === 'cancel-quote') { S.quote = null; render(); }
    else if (a === 'quote') { const m = findItem(b.dataset.id); S.quote = { name: m.from?.name || '', text: textOf(m.html).slice(0, 200) }; render(); $('#box').focus(); }
    else if (a === 'delete') { try { await S.api.remove(o.id, b.dataset.id); await loadOpen(); toast('Message deleted'); } catch (err) { toast(err.message); } }
    else if (a === 'retry') { const m = S.items.find((x) => x.id === b.dataset.id); m.failed = null; m.pending = true; render(); deliver(o, m); }
    else if (a === 'open-reply') { S.replyTo = b.dataset.id; render(); $('#rbox')?.focus(); }
    else if (a === 'send-reply') sendReply(b.dataset.id);
    else if (a === 'jump') scrollDown(true);
  });
  const findItem = (id) => { for (const m of S.items) { if (m.id === id) return m; for (const r of m.replies || []) if (r.id === id) return r; } return null; };
  async function sendReply(pid) {
    const box = $('#rbox'); const text = box?.value.trim(); if (!text) return;
    const { html, mentions } = toHtml(text, []);
    try { await S.api.reply(S.open.teamId, S.open.id, pid, { html, mentions }); S.replyTo = null; await loadOpen(); } catch (e) { toast(e.message); }
  }
  app.addEventListener('keydown', (e) => {
    if (e.target.id === 'box' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      if (document.querySelector('.menu.mention')) { e.preventDefault(); document.querySelector('.menu.mention button[data-pid]')?.click(); return; }
      e.preventDefault(); send();
    }
    if (e.target.id === 'box' && e.key === 'Escape') { if (S.editing) { S.editing = null; render(); } closeFloat(); }
    if (e.target.id === 'box' && e.key === 'ArrowUp' && !e.target.value && S.open?.kind === 'chat') { const mine = [...S.items].reverse().find((m) => m.from?.id === S.me.id && !m.deleted && !m.pending); if (mine) { e.preventDefault(); S.editing = mine.id; S.editDraft = textOf(mine.html); render(); $('#box').focus(); } }
    if (e.target.id === 'rbox' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(S.replyTo); }
  });
  app.addEventListener('input', (e) => {
    if (e.target.id === 'box' || e.target.id === 'rbox') { autosize(e.target); if (e.target.id === 'box') { if (S.editing) S.editDraft = e.target.value; else S.drafts[draftKey()] = e.target.value; mentionMenu(e.target); } }
    if (e.target.id === 'q') { S.q = e.target.value; if (S.view !== 'chat') S.view = 'chat'; render(); }
  });
  app.addEventListener('scroll', (e) => {
    if (e.target.id !== 'stream') return;
    S.pinned = nearBottom(e.target);
    const j = $('.jump'); if (j) j.hidden = S.pinned;
  }, true);
  document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); $('#q')?.focus(); } if (e.key === 'Escape') closeFloat(); });

  // ---------- presence: you show as active while Seams is open and you are using it ----------
  let lastInput = Date.now();
  ['pointerdown', 'keydown', 'pointermove', 'focus'].forEach((ev) => window.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true }));
  function beat() {
    if (S.mode !== 'live' || !S.me || S.signedOut) return;
    const state = document.visibilityState === 'visible' && Date.now() - lastInput < 5 * 60e3 ? 'active' : 'inactive';
    S.api.heartbeat(state).catch(() => {});
  }
  window.addEventListener('pagehide', () => { if (S.mode === 'live') navigator.sendBeacon?.('/api/presence/leave'); });
  document.addEventListener('visibilitychange', beat);

  // ---------- start ----------
  async function start() {
    const t = store.get('theme', 'system'); if (t !== 'system') document.documentElement.dataset.theme = t;
    let sess = null;
    if (!window.SEAMS_STANDALONE) {
      try {
        const r = await fetch('/api/session', { headers: { 'x-seams': '1' }, credentials: 'same-origin' });
        if (r.status === 401) { S.me = {}; S.signedOut = true; S.mode = 'live'; return render(); }
        else if (r.ok) sess = await r.json();
      } catch { /* no server: demo */ }
    }
    if (sess && sess.mode === 'live') { S.api = Live; S.mode = 'live'; S.me = sess.me; S.myStatus = sess.presence || 'Available'; }
    else { S.api = window.SeamsDemo; S.mode = 'demo'; S.serverDemo = !!sess; const d = await S.api.session(); S.me = d.me; S.myStatus = d.presence; }
    S.api.onEvent((ev) => {
      if (ev.kind === 'typing' && S.open?.id === ev.chatId) { S.typing = ev.name; renderStream(); }
      if (ev.kind === 'message') { if (S.open?.id === ev.chatId) S.typing = null; refreshLists().then(() => { renderList(); if (S.open?.id === ev.chatId) loadOpen(); }); }
    });
    try { await refreshLists(); } catch (e) { S.error = e.message; }
    S.presence[S.me.id] = S.myStatus;
    render();
    refreshPresence(S.chats.filter((c) => c.chatType === 'oneOnOne').flatMap((c) => c.members.map((p) => p.id)).slice(0, 650));
    // Open the most recent chat on wide screens, as Teams does.
    if (window.innerWidth > 760 && S.chats[0]) go({ kind: 'chat', id: (S.chats.find((c) => c.unread) || S.chats[0]).id });
    if (S.mode === 'live') {
      beat(); setInterval(beat, 60e3);
      setInterval(() => { if (document.visibilityState === 'visible') loadOpen(); }, 5e3);
      setInterval(() => { if (document.visibilityState === 'visible') refreshLists().then(renderList).catch(() => {}); }, 20e3);
    }
  }
  render(); start();
})();
