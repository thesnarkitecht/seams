// Microsoft Graph requests with retries on throttling. Only graph.microsoft.com is ever called.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class GraphError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

export function makeGraph(base, fetchImpl = globalThis.fetch) {
  const origin = new URL(base).origin;
  return async function graph(token, method, path, body, { headers = {}, raw = false, tries = 4 } = {}) {
    const url = /^https:\/\//.test(path) ? path : base + path;
    if (new URL(url).origin !== origin) throw new GraphError(400, 'Refusing to call a host other than Microsoft Graph');
    for (let i = 0; ; i++) {
      const r = await fetchImpl(url, { method, headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
      if ((r.status === 429 || r.status === 503 || r.status === 504) && i < tries - 1) {
        const ra = Number(r.headers.get('retry-after'));
        await sleep(Math.min(30_000, (Number.isFinite(ra) && ra > 0 ? ra * 1000 : 0) || 500 * 2 ** i));
        continue;
      }
      if (raw && r.ok) return r;
      if (r.status === 204 || r.status === 202) return {};
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        let msg = j.error?.message || `Microsoft Graph returned ${r.status}`;
        if (r.status === 403) msg = `Microsoft Graph refused this (${msg}). An admin may need to grant the app's permissions; see docs/ENTRA.md.`;
        throw new GraphError(r.status === 401 ? 502 : r.status, msg, j.error?.code);
      }
      return j;
    }
  };
}
