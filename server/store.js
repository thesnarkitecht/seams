// Small JSON store on disk: one record per signed-in person (their refresh token, sealed with
// SEAMS_SECRET_KEY) and the browser sessions that point at them. Written atomically.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const keyFrom = (secret) => (secret ? crypto.createHash('sha256').update(String(secret)).digest() : null);

export function seal(plaintext, secret) {
  const key = keyFrom(secret);
  if (!key) throw new Error('SEAMS_SECRET_KEY is not set: refusing to store Microsoft tokens');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(plaintext), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function unseal(box, secret) {
  const [v, iv, tag, ct] = String(box || '').split(':');
  if (v !== 'v1' || !ct) throw new Error('Unreadable sealed value');
  const d = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

export class Store {
  constructor(dir, secret) {
    this.file = path.join(dir, 'seams.json');
    this.secret = secret;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { users: {}, sessions: {} };
  }
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  user(oid) { return this.data.users[oid] || null; }
  putUser(oid, { name, email, refreshToken }) {
    const cur = this.data.users[oid] || {};
    this.data.users[oid] = { ...cur, oid, name, email, box: refreshToken ? seal(refreshToken, this.secret) : cur.box, updatedAt: new Date().toISOString() };
    this.save();
  }
  refreshToken(oid) { const u = this.user(oid); return u?.box ? unseal(u.box, this.secret) : null; }
  setRefreshToken(oid, rt) { const u = this.user(oid); if (!u || !rt) return; u.box = seal(rt, this.secret); this.save(); }
  dropUser(oid) { delete this.data.users[oid]; for (const [k, s] of Object.entries(this.data.sessions)) if (s.oid === oid) delete this.data.sessions[k]; this.save(); }

  /** New browser session; returns the cookie value (only its hash is stored). */
  newSession(oid, days = 14) {
    const sid = crypto.randomBytes(32).toString('base64url');
    this.data.sessions[hash(sid)] = { oid, exp: Date.now() + days * 864e5 };
    this.prune();
    this.save();
    return sid;
  }
  session(sid) {
    if (!sid) return null;
    const s = this.data.sessions[hash(sid)];
    if (!s || s.exp < Date.now()) return null;
    return s;
  }
  endSession(sid) { if (sid) { delete this.data.sessions[hash(sid)]; this.save(); } }
  prune() { const now = Date.now(); for (const [k, s] of Object.entries(this.data.sessions)) if (s.exp < now) delete this.data.sessions[k]; }
}
