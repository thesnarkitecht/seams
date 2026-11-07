// Microsoft identity platform, using one Entra app registration (the application credentials).
//
//  - App token (client credentials, secret or certificate): used for what the app does on its own
//    account, which in Seams is presence sessions (application permission Presence.ReadWrite.All).
//  - Person tokens (authorization code + PKCE, redeemed with the same credentials): each person signs in
//    once; their refresh token is sealed on disk and their messages are sent with their own token, so
//    Teams shows them as the sender, exactly as when they type in Teams.
//
// Microsoft Graph does not let an app-only token post chat or channel messages as a person (outside
// one-time migrations), so sending always goes through the person's own sign-in.
import fs from 'node:fs';
import crypto from 'node:crypto';

export const SCOPES = [
  'openid', 'profile', 'email', 'offline_access',
  'User.Read', 'User.ReadBasic.All',
  'Chat.ReadWrite', 'ChatMessage.Send',
  'Team.ReadBasic.All', 'Channel.ReadBasic.All', 'ChannelMessage.Read.All', 'ChannelMessage.Send',
  'Presence.Read.All', 'Presence.ReadWrite',
].join(' ');

const b64url = (b) => Buffer.from(b).toString('base64url');

export class Auth {
  /** @param {ReturnType<import('./config.js').readConfig>} cfg  @param {import('./store.js').Store} store */
  constructor(cfg, store, { fetch = globalThis.fetch } = {}) {
    this.cfg = cfg; this.g = cfg.graph; this.store = store; this.fetch = fetch;
    this.app = null;           // {token, exp}
    this.people = new Map();   // oid -> {token, exp}
    this.inflight = new Map(); // oid|'app' -> Promise
    this.pending = new Map();  // state -> {verifier, exp}
    this._cert = null;
  }
  get tokenUrl() { return `${this.g.authority}/${this.g.tenantId}/oauth2/v2.0/token`; }
  get redirectUri() { return this.cfg.publicUrl + '/auth/callback'; }

  clientAuth() {
    if (this.g.clientSecret) return { client_secret: this.g.clientSecret };
    return { client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: this.assertion() };
  }
  /** Signed JWT proving we hold the certificate's private key (RS256 with x5t). */
  assertion() {
    if (!this._cert) {
      const pem = fs.readFileSync(this.g.certPath, 'utf8');
      const cert = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.exec(pem);
      const thumb = cert ? Buffer.from(new crypto.X509Certificate(cert[0]).fingerprint.replace(/:/g, ''), 'hex')
        : this.g.certThumbprint ? Buffer.from(this.g.certThumbprint.replace(/[^0-9a-f]/gi, ''), 'hex') : null;
      if (!thumb) throw new Error('CLIENT_CERT_PATH must contain the certificate, or set CLIENT_CERT_THUMBPRINT');
      this._cert = { key: crypto.createPrivateKey(pem), x5t: b64url(thumb) };
    }
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', x5t: this._cert.x5t }));
    const body = b64url(JSON.stringify({ aud: this.tokenUrl, iss: this.g.clientId, sub: this.g.clientId, jti: crypto.randomUUID(), nbf: now - 60, iat: now, exp: now + 600 }));
    return `${head}.${body}.${b64url(crypto.sign('RSA-SHA256', Buffer.from(head + '.' + body), this._cert.key))}`;
  }
  async post(fields) {
    const r = await this.fetch(this.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.g.clientId, ...this.clientAuth(), ...fields }), signal: AbortSignal.timeout(20_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(String(j.error_description || j.error || `HTTP ${r.status}`).split('\r\n')[0]); e.code = j.error; e.status = r.status; throw e; }
    return j;
  }
  once(key, fn) {
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** App-only token for Graph. */
  async appToken() {
    if (this.app && this.app.exp - Date.now() > 300_000) return this.app.token;
    return this.once('app', async () => {
      const j = await this.post({ grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default' });
      this.app = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
      return this.app.token;
    });
  }

  /** Start sign-in: returns the Microsoft URL and the state to bind to this browser. */
  begin() {
    const state = crypto.randomBytes(24).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const now = Date.now();
    for (const [k, v] of this.pending) if (v.exp < now) this.pending.delete(k);
    this.pending.set(state, { verifier, exp: now + 10 * 60_000 });
    const q = new URLSearchParams({ client_id: this.g.clientId, response_type: 'code', redirect_uri: this.redirectUri, response_mode: 'query', scope: SCOPES, state,
      code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', prompt: 'select_account' });
    return { url: `${this.g.authority}/${this.g.tenantId}/oauth2/v2.0/authorize?${q}`, state };
  }

  /** Finish sign-in: redeem the code; returns {accessToken, refreshToken}. */
  async finish(state, code) {
    const p = this.pending.get(state);
    this.pending.delete(state);
    if (!p || p.exp < Date.now()) throw Object.assign(new Error('This sign-in link has expired. Start again.'), { status: 400 });
    const j = await this.post({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri, code_verifier: p.verifier, scope: SCOPES });
    return { accessToken: j.access_token, refreshToken: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  }
  remember(oid, accessToken, exp) { this.people.set(oid, { token: accessToken, exp }); }
  forget(oid) { this.people.delete(oid); }

  /** The person's own token, refreshed from their sealed refresh token when needed. */
  async userToken(oid) {
    const c = this.people.get(oid);
    if (c && c.exp - Date.now() > 300_000) return c.token;
    return this.once(oid, async () => {
      const rt = this.store.refreshToken(oid);
      if (!rt) throw Object.assign(new Error('Sign in again'), { status: 401 });
      let j;
      try { j = await this.post({ grant_type: 'refresh_token', refresh_token: rt, scope: SCOPES }); }
      catch (e) { if (e.code === 'invalid_grant' || e.code === 'interaction_required') { this.store.dropUser(oid); throw Object.assign(new Error('Your Microsoft sign-in has expired. Sign in again.'), { status: 401 }); } throw e; }
      if (j.refresh_token) this.store.setRefreshToken(oid, j.refresh_token);
      this.remember(oid, j.access_token, Date.now() + (j.expires_in || 3600) * 1000);
      return j.access_token;
    });
  }
}
