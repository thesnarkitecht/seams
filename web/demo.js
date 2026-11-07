// Example conversations for demo mode (no server, or SEAMS_DEMO=1). Names and messages are invented.
// Exposes window.SeamsDemo, an API with the same shape as the live one in app.js.
(() => {
  const DAY = 86400000;
  const now = Date.now();
  const at = (daysAgo, h, m) => { const d = new Date(now - daysAgo * DAY); d.setHours(h, m, 0, 0); return d.toISOString(); };
  let seq = 1000;
  const nid = () => String(++seq);

  const me = { id: 'u-me', name: 'Ryan Spell', email: 'ryan.spell@huntingtonog.com', title: 'Managing Partner' };
  const P = {
    dana: { id: 'u-dana', name: 'Dana Whitfield', email: 'dana.whitfield@example.com', title: 'Land Manager' },
    marco: { id: 'u-marco', name: 'Marco Ibarra', email: 'marco.ibarra@example.com', title: 'Operations Engineer' },
    priya: { id: 'u-priya', name: 'Priya Raman', email: 'priya.raman@example.com', title: 'Controller' },
    theo: { id: 'u-theo', name: 'Theo Lindqvist', email: 'theo.lindqvist@example.com', title: 'IT' },
    june: { id: 'u-june', name: 'June Okafor', email: 'june.okafor@example.com', title: 'Geologist' },
    sam: { id: 'u-sam', name: 'Sam Castellano', email: 'sam.castellano@example.com', title: 'Accounts Payable' },
    nora: { id: 'u-nora', name: 'Nora Feld', email: 'nora.feld@example.com', title: 'Counsel' },
  };
  const people = [me, ...Object.values(P)];
  const presence = { 'u-me': 'Available', 'u-dana': 'Available', 'u-marco': 'Busy', 'u-priya': 'Away', 'u-theo': 'Available', 'u-june': 'Offline', 'u-sam': 'DoNotDisturb', 'u-nora': 'BeRightBack' };

  const shot = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="260" viewBox="0 0 480 260"><rect width="480" height="260" fill="#fefefe"/><rect x=".5" y=".5" width="479" height="259" fill="none" stroke="#c9c9c3"/><rect x="0" y="0" width="480" height="28" fill="#1e1e1e"/><text x="14" y="18" font-family="monospace" font-size="11" fill="#fefefe" letter-spacing="1">DECLINE CURVE · PECOS STATE 2H</text><g stroke="#e2e2dd">${[60, 100, 140, 180, 220].map((y) => `<line x1="40" x2="460" y1="${y}" y2="${y}"/>`).join('')}</g><path d="M40 60 C 120 120, 200 170, 460 205" fill="none" stroke="#1e1e1e" stroke-width="2.5"/><path d="M40 70 C 130 140, 220 185, 460 222" fill="none" stroke="#f386a1" stroke-width="2" stroke-dasharray="6 5"/><text x="44" y="246" font-family="monospace" font-size="10" fill="#62625d">MONTHS ON PRODUCTION 0 → 24 · BOE/D</text></svg>`);

  const m = (from, when, html, extra = {}) => ({ id: nid(), at: when, from: from ? { id: from.id, name: from.name } : null, html, reactions: [], attachments: [], ...extra });

  const chats = [
    { id: 'c-dana', chatType: 'oneOnOne', topic: null, members: [me, P.dana], unread: true, fav: true, messages: [
      m(me, at(4, 10, 47), 'Here is the draft lease extension for the Reeves County tracts: <a href="https://example.com/leases/reeves-extension">reeves-extension-v3.docx</a>'),
      m(P.dana, at(4, 10, 53), 'thanks'),
      m(P.dana, at(4, 10, 54), 'I checked the depth severance on tract 14. It still reads <b>surface to 10,450 ft</b>, so we need the deeper rights carved out before signing.'),
      m(me, at(4, 11, 2), 'If that blocks it, I can ask Nora to redline the depth clause today. Give me the go-ahead.'),
      m(P.dana, at(4, 11, 43), 'Go ahead, I can review it this afternoon', { reactions: [{ type: '👍', users: ['u-me'] }] }),
      m(P.dana, at(1, 9, 12), 'Nora sent the redline. Two open points: the continuous development clause and the shut-in royalty at <code>$25/acre</code>.'),
      m(P.dana, at(0, 8, 41), 'Can we talk before the 2:00 with the mineral owners?'),
    ] },
    { id: 'c-ops', chatType: 'group', topic: 'Pecos field ops', members: [me, P.marco, P.june, P.dana], unread: true, messages: [
      m(P.marco, at(2, 7, 15), 'Morning report: Pecos State 2H back online at 06:40 after the ESP swap. Making 412 BOE/d on a 28/64 choke.'),
      m(P.june, at(2, 7, 32), 'Nice. That is right on the type curve for month 7.', { attachments: [] }),
      m(P.june, at(2, 7, 33), `<img src="${shot}" alt="Decline curve, Pecos State 2H">`),
      m(me, at(2, 8, 5), 'Good news. <span class="at">Marco Ibarra</span> can you send the workover invoice to Priya when it lands?', { reactions: [{ type: '❤️', users: ['u-marco', 'u-june'] }] }),
      m(P.marco, at(2, 8, 9), 'Will do'),
      m(P.marco, at(0, 7, 2), 'Heads up: wind advisory this afternoon, rig move for the 4H pushed to Thursday.'),
      m(P.dana, at(0, 7, 20), 'Noted. I will let the surface owner know the access road stays closed one more day.'),
    ] },
    { id: 'c-priya', chatType: 'oneOnOne', topic: null, members: [me, P.priya], unread: false, messages: [
      m(P.priya, at(6, 15, 30), 'October JIBs are out to all working interest owners.', { attachments: [{ name: 'JIB-2026-10-HOG-II.pdf', type: 'pdf', size: '284 KB' }] }),
      m(me, at(6, 15, 41), 'Thanks Priya. Any owners still past 60 days?'),
      m(P.priya, at(6, 15, 52), 'Two: Cobalt Royalty and one estate account. I sent second notices on both.'),
      m(me, at(1, 16, 20), 'Let us net the Cobalt balance against their November revenue if it is still open on the 15th.'),
      m(P.priya, at(1, 16, 24), 'Agreed, I will set that up.', { reactions: [{ type: '👍', users: ['u-me'] }] }),
    ] },
    { id: 'c-theo', chatType: 'oneOnOne', topic: null, members: [me, P.theo], unread: false, messages: [
      m(P.theo, at(3, 10, 38), 'The first profile set up on the new laptop had anchored the old Outlook config. Fixed it, though.'),
      m(me, at(3, 10, 44), 'Thank you, that was driving me nuts'),
      m(P.theo, at(3, 10, 45), 'Also: the Seams app registration is in place. Client secret is in the vault under <code>seams-graph</code>, expires in 12 months.'),
    ] },
    { id: 'c-close', chatType: 'group', topic: 'Month-end close', members: [me, P.priya, P.sam], unread: false, messages: [
      m(P.sam, at(5, 13, 0), 'AP cutoff is Friday at noon. Anything after that rolls to December.'),
      m(P.priya, at(5, 13, 6), 'Please get vendor invoices for the 2H workover in before then.'),
      m(me, at(5, 13, 30), 'Will flag it with Marco.'),
    ] },
    { id: 'c-nora', chatType: 'oneOnOne', topic: null, members: [me, P.nora], unread: false, messages: [
      m(P.nora, at(9, 17, 2), 'Signed copies of the HFF operating agreement are in the Legal library.'),
      m(me, at(9, 17, 10), 'Perfect, thank you.'),
    ] },
    { id: 'c-self', chatType: 'oneOnOne', topic: null, self: true, members: [me], unread: false, messages: [
      m(me, at(12, 21, 4), 'Notes to self: ask June for the updated reserves report before the bank meeting.'),
    ] },
  ];

  const post = (from, when, html, subject, replies = []) => ({ ...m(from, when, html), subject, replies: replies.map((r) => m(...r)) });
  const teams = [
    { id: 't-hog', name: 'HOG Operations', channels: [
      { id: 'ch-gen', name: 'General', posts: [
        post(P.marco, at(3, 8, 0), 'Weekly production summary is posted. HOG II is up 6% on the month, mostly from the 2H coming back.', 'Weekly production, week 44', [[P.june, at(3, 8, 40), 'The 3H is still trending under the curve. I will look at offset pressure data.'], [me, at(3, 9, 5), 'Thanks both. Let us review the 3H on Monday.']]),
        post(P.dana, at(1, 14, 10), 'Reminder: the mineral owner meeting is tomorrow at 2:00 in the Midland office. Agenda is in the channel files.', 'Mineral owner meeting'),
      ] },
      { id: 'ch-wells', name: 'Wells', posts: [
        post(P.marco, at(2, 6, 55), 'ESP swap complete on Pecos State 2H. Pump intake pressure normal, amps steady.', 'Pecos State 2H workover', [[P.june, at(2, 7, 10), 'Great work. Uploading the updated decline curve to the chat.']]),
      ] },
      { id: 'ch-land', name: 'Land', posts: [] },
    ] },
    { id: 't-hip', name: 'HIP Corporate', channels: [
      { id: 'ch-hgen', name: 'General', posts: [
        post(P.priya, at(4, 11, 0), 'Q3 investor letters went out this morning. Copies are in Investnext.', 'Q3 investor letters', [[me, at(4, 11, 20), 'Thank you Priya.']]),
      ] },
      { id: 'ch-fin', name: 'Finance', posts: [] },
    ] },
  ];

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const nameOf = (c) => c.topic || (c.self ? `${me.name} (You)` : c.members.filter((p) => p.id !== me.id).map((p) => p.name).join(', '));
  const textOf = (html) => String(html).replace(/<img[^>]*>/g, '[image]').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  const summary = (c) => {
    const last = c.messages.filter((x) => !x.deleted).at(-1);
    return { id: c.id, chatType: c.chatType, topic: c.topic, title: nameOf(c), self: !!c.self, members: c.members.map(({ id, name, email }) => ({ id, name, email })),
      unread: c.unread, fav: !!c.fav, last: last ? { at: last.at, from: last.from?.name, mine: last.from?.id === me.id, text: textOf(last.html) } : null };
  };
  const chat = (id) => { const c = chats.find((x) => x.id === id); if (!c) throw new Error('Chat not found'); return c; };
  const chan = (tid, cid) => teams.find((t) => t.id === tid).channels.find((c) => c.id === cid);
  const find = (list, id) => { for (const x of list) { if (x.id === id) return x; for (const r of x.replies || []) if (r.id === id) return r; } return null; };
  const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
  const listeners = new Set();
  const emit = (ev) => listeners.forEach((f) => f(ev));
  const canned = ['Sounds good.', 'Got it, thanks.', 'I will take a look this afternoon.', 'Makes sense to me.', 'Can you send me the file?', 'On it.'];

  window.SeamsDemo = {
    mode: 'demo',
    onEvent(f) { listeners.add(f); },
    async session() { return { me: { ...me }, mode: 'demo', presence: presence[me.id] }; },
    async chats() { await wait(); return chats.map(summary).sort((a, b) => (b.last?.at || '').localeCompare(a.last?.at || '')); },
    async messages(id) { await wait(); return clone(chat(id).messages); },
    async markRead(id) { chat(id).unread = false; },
    async send(id, { html }) {
      await wait(250);
      const c = chat(id); const msg = m(me, new Date().toISOString(), html); c.messages.push(msg);
      const others = c.members.filter((p) => p.id !== me.id);
      if (others.length) {
        const who = others[Math.floor(Math.random() * others.length)];
        setTimeout(() => emit({ kind: 'typing', chatId: id, name: who.name }), 900);
        setTimeout(() => { c.messages.push(m(who, new Date().toISOString(), canned[seq % canned.length])); if (window.SeamsDemo.openId !== id) c.unread = true; emit({ kind: 'message', chatId: id }); }, 3200);
      }
      return clone(msg);
    },
    async edit(id, mid, { html }) { const x = find(chat(id).messages, mid); x.html = html; x.edited = true; return clone(x); },
    async remove(id, mid) { const x = find(chat(id).messages, mid); x.deleted = true; x.html = ''; },
    async react(id, mid, type, on) {
      toggle(find(chat(id).messages, mid), type, on);
    },
    async teams() { await wait(); return teams.map((t) => ({ id: t.id, name: t.name, channels: t.channels.map((c) => ({ id: c.id, name: c.name })) })); },
    async posts(tid, cid) { await wait(); return clone(chan(tid, cid).posts); },
    async post(tid, cid, { html, subject }) { const p = { ...m(me, new Date().toISOString(), html), subject: subject || null, replies: [] }; chan(tid, cid).posts.push(p); return clone(p); },
    async reply(tid, cid, pid, { html }) { const r = m(me, new Date().toISOString(), html); find(chan(tid, cid).posts, pid).replies.push(r); return clone(r); },
    async reactPost(tid, cid, mid, type, on) { toggle(find(chan(tid, cid).posts, mid), type, on); },
    async people(q) { q = String(q || '').toLowerCase(); return people.filter((p) => p.id !== me.id && (p.name.toLowerCase().includes(q) || p.email.includes(q))).slice(0, 8); },
    async newChat(ids, topic) {
      const members = [me, ...ids.map((i) => people.find((p) => p.id === i))];
      const existing = ids.length === 1 && chats.find((c) => c.chatType === 'oneOnOne' && c.members.some((p) => p.id === ids[0]));
      if (existing) return summary(existing);
      const c = { id: 'c-' + nid(), chatType: ids.length > 1 ? 'group' : 'oneOnOne', topic: topic || null, members, unread: false, messages: [] };
      chats.unshift(c); return summary(c);
    },
    async presence(ids) { return Object.fromEntries(ids.map((i) => [i, presence[i] || 'PresenceUnknown'])); },
    async setStatus(a) { presence[me.id] = a || 'Available'; return { availability: presence[me.id] }; },
    async heartbeat() {},
  };
  function toggle(x, type, on) {
    let r = x.reactions.find((y) => y.type === type);
    if (!r) { r = { type, users: [] }; x.reactions.push(r); }
    r.users = r.users.filter((u) => u !== me.id); if (on) r.users.push(me.id);
    x.reactions = x.reactions.filter((y) => y.users.length);
  }
})();
