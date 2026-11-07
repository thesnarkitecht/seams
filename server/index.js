// Seams server entry point.
import { loadDotEnv, readConfig } from './config.js';
import { createApp } from './http.js';

loadDotEnv();
const cfg = readConfig();
const { server, live } = createApp(cfg);
server.listen(cfg.port, cfg.host, () => {
  console.log(`[seams] ${live ? 'Teams via Microsoft Graph' : 'example data (set TENANT_ID, CLIENT_ID, CLIENT_SECRET to use Teams)'} on http://${cfg.host}:${cfg.port}`);
  if (live) console.log(`[seams] sign-in redirect URI: ${cfg.publicUrl}/auth/callback`);
});
