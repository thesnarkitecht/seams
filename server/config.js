// Configuration from the environment (and an optional .env file next to package.json).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadDotEnv(file = path.join(root, '.env'), env = process.env) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (env[m[1]] === undefined) env[m[1]] = v;
  }
}

export function readConfig(env = process.env) {
  const publicUrl = String(env.PUBLIC_URL || `http://localhost:${env.PORT || 8090}`).replace(/\/+$/, '');
  const cfg = {
    root,
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 8090),
    publicUrl,
    dataDir: path.resolve(env.DATA_DIR || path.join(root, 'data')),
    secretKey: env.SEAMS_SECRET_KEY || '',
    demo: env.SEAMS_DEMO === '1',
    allowed: String(env.ALLOWED_USERS || '').split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean),
    graph: {
      authority: (env.AUTHORITY || 'https://login.microsoftonline.com').replace(/\/+$/, ''),
      tenantId: env.TENANT_ID || '',
      clientId: env.CLIENT_ID || '',
      clientSecret: env.CLIENT_SECRET || '',
      certPath: env.CLIENT_CERT_PATH || '',
      certThumbprint: env.CLIENT_CERT_THUMBPRINT || '',
      base: (env.GRAPH_BASE || 'https://graph.microsoft.com/v1.0').replace(/\/+$/, ''),
    },
    // Presence through the app's own token (application permission Presence.ReadWrite.All).
    // Off: presence is set with the person's delegated token (Presence.ReadWrite) instead.
    appPresence: env.APP_PRESENCE !== '0',
  };
  cfg.configured = !!(cfg.graph.tenantId && cfg.graph.clientId && (cfg.graph.clientSecret || cfg.graph.certPath));
  cfg.secure = publicUrl.startsWith('https://');
  return cfg;
}
