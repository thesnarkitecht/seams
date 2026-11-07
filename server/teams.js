// Teams through Microsoft Graph, as the signed-in person. Responses are trimmed to what the client draws.
import { GraphError } from './graph.js';

const GUIDISH = /^[0-9a-zA-Z:@._=-]{1,200}$/;
const strip = (html) => String(html || '').replace(/<attachment[^>]*><\/attachment>/gi, '').replace(/<img[^>]*>/gi, '[image] ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const escHtml = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const EVENTS = { membersAddedEventMessageDetail: 'People were added to the chat', membersDeletedEventMessageDetail: 'People were removed from the chat', chatRenamedEventMessageDetail: 'The chat was renamed',
  callStartedEventMessageDetail: 'A call started', callEndedEventMessageDetail: 'A call ended', callRecordingEventMessageDetail: 'A call was recorded', teamsAppInstalledEventMessageDetail: 'An app was added',
  messagePinnedEventMessageDetail: 'A message was pinned', meetingPolicyUpdatedEventMessageDetail: 'Meeting settings changed' };

export function id(v, what = 'id') {
  v = String(v || '');
  if (!GUIDISH.test(v)) throw new GraphError(400, `Invalid ${what}`);
  return encodeURIComponent(v);
}

export function mapMessage(m) {
  const isSystem = m.messageType && m.messageType !== 'message';
  const ev = m.eventDetail?.['@odata.type']?.split('.').pop();
  const reactions = [];
  for (const r of m.reactions || []) {
    const type = r.reactionType; const uid = r.user?.user?.id;
    let g = reactions.find((x) => x.type === type);
    if (!g) reactions.push(g = { type, users: [] });
    if (uid && !g.users.includes(uid)) g.users.push(uid);
  }
  const from = m.from?.user ? { id: m.from.user.id, name: m.from.user.displayName || 'Unknown' }
    : m.from?.application ? { id: 'app:' + m.from.application.id, name: m.from.application.displayName || 'App' } : null;
  return {
    id: m.id, at: m.createdDateTime, edited: !!m.lastEditedDateTime, deleted: !!m.deletedDateTime, from,
    html: m.deletedDateTime ? '' : m.body?.contentType === 'html' ? m.body.content || '' : escHtml(m.body?.content).replace(/\n/g, '<br>'),
    subject: m.subject || null,
    system: isSystem ? EVENTS[ev] || 'Conversation updated' : undefined,
    reactions,
    attachments: (m.attachments || []).filter((a) => a.contentType === 'reference' && a.name).map((a) => ({ name: a.name, url: a.contentUrl, type: String(a.name).split('.').pop().toLowerCase() })),
    ...(m.replies ? { replies: m.replies.map(mapMessage).sort((a, b) => a.at.localeCompare(b.at)) } : {}),
  };
}

/** Body for a new or edited message: HTML from the client plus well-formed mentions only. */
export function messageBody({ html, mentions, subject } = {}) {
  html = String(html || '');
  if (!html.trim()) throw new GraphError(400, 'The message is empty');
  if (html.length > 28_000) throw new GraphError(413, 'The message is too long for Teams (about 28 KB)');
  const out = { body: { contentType: 'html', content: html } };
  if (Array.isArray(mentions) && mentions.length) {
    out.mentions = mentions.slice(0, 20).map((x, i) => ({ id: Number.isInteger(x.id) ? x.id : i, mentionText: String(x.mentionText || '').slice(0, 200),
      mentioned: { user: { id: String(x.mentioned?.user?.id || ''), displayName: String(x.mentioned?.user?.displayName || '').slice(0, 200), userIdentityType: 'aadUser' } } }))
      .filter((x) => GUIDISH.test(x.mentioned.user.id) && html.includes(`<at id="${x.id}">`));
  }
  if (subject) out.subject = String(subject).slice(0, 250);
  return out;
}

const ACTIVITY = { Available: 'Available', Busy: 'Busy', DoNotDisturb: 'DoNotDisturb', BeRightBack: 'BeRightBack', Away: 'Away', Offline: 'OffWork' };

export class Teams {
  constructor({ cfg, auth, graph }) { this.cfg = cfg; this.auth = auth; this.graph = graph; this.teamCache = new Map(); this.beats = new Map(); }
  async g(oid, method, path, body, opts) { return this.graph(await this.auth.userToken(oid), method, path, body, opts); }

  async me(oid) {
    const [me, pr] = await Promise.all([this.g(oid, 'GET', '/me?$select=id,displayName,mail,userPrincipalName,jobTitle'), this.g(oid, 'GET', '/me/presence').catch(() => null)]);
    return { me: { id: me.id, name: me.displayName, email: me.mail || me.userPrincipalName, title: me.jobTitle || '' }, presence: pr?.availability || 'PresenceUnknown' };
  }

  async chats(oid) {
    let j;
    try { j = await this.g(oid, 'GET', '/me/chats?$expand=members,lastMessagePreview&$orderby=lastMessagePreview/createdDateTime%20desc&$top=50'); }
    catch (e) { if (e.status !== 400) throw e; j = await this.g(oid, 'GET', '/me/chats?$expand=members&$top=50'); }
    return (j.value || []).map((c) => {
      const members = (c.members || []).map((x) => ({ id: x.userId, name: x.displayName || x.email || 'Guest', email: x.email || '' })).filter((x) => x.id);
      const others = members.filter((x) => x.id !== oid);
      const p = c.lastMessagePreview;
      const mine = p?.from?.user?.id === oid;
      const read = c.viewpoint?.lastMessageReadDateTime;
      return {
        id: c.id, chatType: c.chatType, topic: c.topic || null,
        title: c.topic || (others.length ? others.map((x) => x.name).join(', ') : 'You'), self: !others.length,
        members,
        unread: !!(p && !mine && !p.isDeleted && read && p.createdDateTime > read),
        last: p ? { at: p.createdDateTime, from: p.from?.user?.displayName || null, mine, text: p.isDeleted ? 'This message has been deleted.' : strip(p.body?.content) } : { at: c.lastUpdatedDateTime, text: '' },
      };
    }).sort((a, b) => (b.last?.at || '').localeCompare(a.last?.at || ''));
  }

  async messages(oid, chatId) {
    const j = await this.g(oid, 'GET', `/chats/${id(chatId, 'chat')}/messages?$top=50&$orderby=createdDateTime%20desc`);
    return (j.value || []).map(mapMessage).reverse();
  }
  async send(oid, chatId, b) { return mapMessage(await this.g(oid, 'POST', `/chats/${id(chatId, 'chat')}/messages`, messageBody(b))); }
  async edit(oid, chatId, mid, b) { await this.g(oid, 'PATCH', `/chats/${id(chatId, 'chat')}/messages/${id(mid, 'message')}`, messageBody(b)); return { ok: true }; }
  async remove(oid, chatId, mid) { await this.g(oid, 'POST', `/users/${id(oid)}/chats/${id(chatId, 'chat')}/messages/${id(mid, 'message')}/softDelete`); return { ok: true }; }
  async react(oid, base, type, on) {
    type = String(type || '').slice(0, 16);
    if (!type) throw new GraphError(400, 'Pick a reaction');
    await this.g(oid, 'POST', `${base}/${on ? 'setReaction' : 'unsetReaction'}`, { reactionType: type });
    return { ok: true };
  }
  async markRead(oid, chatId) {
    const tid = this.cfg.graph.tenantId;
    await this.g(oid, 'POST', `/chats/${id(chatId, 'chat')}/markChatReadForUser`, { user: { id: oid, tenantId: tid } }).catch(() => {});
    return { ok: true };
  }
  async newChat(oid, ids, topic) {
    ids = [...new Set((ids || []).map(String))].filter((x) => x && x !== oid);
    if (!ids.length) throw new GraphError(400, 'Add at least one person');
    ids.forEach((x) => id(x, 'person'));
    const member = (u) => ({ '@odata.type': '#microsoft.graph.aadUserConversationMember', roles: ['owner'], 'user@odata.bind': `${this.cfg.graph.base}/users('${u}')` });
    const group = ids.length > 1;
    const c = await this.g(oid, 'POST', '/chats', { chatType: group ? 'group' : 'oneOnOne', ...(group && topic ? { topic: String(topic).slice(0, 250) } : {}), members: [oid, ...ids].map(member) });
    const all = await this.chats(oid);
    return all.find((x) => x.id === c.id) || { id: c.id, chatType: c.chatType, topic: c.topic || null, title: c.topic || 'New chat', members: [], unread: false, last: null };
  }

  async teams(oid) {
    const hit = this.teamCache.get(oid);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.list;
    const j = await this.g(oid, 'GET', '/me/joinedTeams?$select=id,displayName');
    const list = await Promise.all((j.value || []).slice(0, 40).map(async (t) => {
      const ch = await this.g(oid, 'GET', `/teams/${id(t.id, 'team')}/channels?$select=id,displayName,membershipType`).catch(() => ({ value: [] }));
      const channels = (ch.value || []).map((c) => ({ id: c.id, name: c.displayName })).sort((a, b) => (a.name === 'General' ? -1 : b.name === 'General' ? 1 : a.name.localeCompare(b.name)));
      return { id: t.id, name: t.displayName, channels };
    }));
    list.sort((a, b) => a.name.localeCompare(b.name));
    this.teamCache.set(oid, { at: Date.now(), list });
    return list;
  }
  chan(t, c) { return `/teams/${id(t, 'team')}/channels/${id(c, 'channel')}`; }
  async posts(oid, t, c) {
    const j = await this.g(oid, 'GET', `${this.chan(t, c)}/messages?$top=30&$expand=replies`);
    return (j.value || []).map(mapMessage).filter((m) => !m.system).reverse();
  }
  async post(oid, t, c, b) { return mapMessage(await this.g(oid, 'POST', `${this.chan(t, c)}/messages`, messageBody(b))); }
  async reply(oid, t, c, pid, b) { const { subject, ...rest } = b || {}; return mapMessage(await this.g(oid, 'POST', `${this.chan(t, c)}/messages/${id(pid, 'post')}/replies`, messageBody(rest))); }

  async people(oid, q) {
    q = String(q || '').replace(/["\\]/g, '').trim().slice(0, 60);
    if (!q) return [];
    const j = await this.g(oid, 'GET', `/users?$search=${encodeURIComponent(`"displayName:${q}" OR "mail:${q}"`)}&$select=id,displayName,mail,userPrincipalName,jobTitle&$top=10`, null, { headers: { ConsistencyLevel: 'eventual' } });
    return (j.value || []).filter((u) => u.id !== oid).map((u) => ({ id: u.id, name: u.displayName, email: u.mail || u.userPrincipalName, title: u.jobTitle || '' }));
  }

  async presence(oid, ids) {
    ids = [...new Set((ids || []).map(String))].filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 650);
    if (!ids.length) return {};
    const j = await this.g(oid, 'POST', '/communications/getPresencesByUserId', { ids });
    return Object.fromEntries((j.value || []).map((p) => [p.id, p.availability]));
  }
  /** Status you pick, as in Teams' status menu (null resets it). */
  async setStatus(oid, availability) {
    if (!availability) { await this.g(oid, 'POST', `/users/${id(oid)}/presence/clearUserPreferredPresence`); }
    else {
      if (!ACTIVITY[availability]) throw new GraphError(400, 'Unknown status');
      await this.g(oid, 'POST', `/users/${id(oid)}/presence/setUserPreferredPresence`, { availability, activity: ACTIVITY[availability], expirationDuration: 'P1D' });
    }
    const pr = await this.g(oid, 'GET', '/me/presence').catch(() => null);
    return { availability: pr?.availability || availability || 'Available' };
  }
  /**
   * Seams' own presence session, as the Teams app keeps one: Available while you are using Seams, Away when
   * the window is idle, and cleared when you leave. Each session lasts 5 minutes unless renewed.
   */
  async heartbeat(oid, state) {
    const availability = state === 'active' ? 'Available' : 'Away';
    const prev = this.beats.get(oid);
    if (prev && prev.availability === availability && Date.now() - prev.at < 4 * 60_000) return { ok: true, availability };
    await this.presenceCall(oid, 'setPresence', { sessionId: this.cfg.graph.clientId, availability, activity: availability, expirationDuration: 'PT5M' });
    this.beats.set(oid, { availability, at: Date.now() });
    return { ok: true, availability };
  }
  async leave(oid) {
    this.beats.delete(oid);
    await this.presenceCall(oid, 'clearPresence', { sessionId: this.cfg.graph.clientId }).catch(() => {});
    return { ok: true };
  }
  async presenceCall(oid, action, body) {
    const path = `/users/${id(oid)}/presence/${action}`;
    if (this.cfg.appPresence) {
      try { return await this.graph(await this.auth.appToken(), 'POST', path, body); }
      catch (e) { if (e.status !== 403) throw e; } // app permission not granted: fall back to the person's token
    }
    return this.g(oid, 'POST', path, body);
  }

  /** Images pasted into Teams messages live behind Graph; fetch them with the person's token. */
  async hosted(oid, url) {
    let u;
    try { u = new URL(String(url)); } catch { throw new GraphError(400, 'Bad image address'); }
    if (u.origin !== 'https://graph.microsoft.com' || !/\/hostedContents\/[^/]+\/\$value$/.test(u.pathname)) throw new GraphError(400, 'Only Teams message images can be fetched');
    const r = await this.g(oid, 'GET', u.toString(), null, { raw: true });
    const type = r.headers.get('content-type') || 'application/octet-stream';
    if (!/^image\//.test(type) || /svg/i.test(type)) throw new GraphError(415, 'Not an image');
    return { type, body: Buffer.from(await r.arrayBuffer()) };
  }
}
