// Builds a single self-contained HTML page: the real Seams client + demo/mock.js instead of a server.
// Usage: node demo/build.js out.html
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const icon = 'data:image/svg+xml;base64,' + Buffer.from(read('public/icon.svg')).toString('base64');
const out = process.argv[2] || 'seams-demo.html';

const body = read('public/index.html').match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/<script[^>]*src="\/app.js"[^>]*><\/script>/, '')
  .replaceAll('/icon.svg', icon)
  .replace('<div class="brand small"><img src="' + icon + '" alt=""> Seams</div>', '<div class="brand small"><img src="' + icon + '" alt=""> Seams <span class="demo-pill">Demo · resets on reload</span></div>');

const app = read('public/app.js')
  .replaceAll('localStorage.', 'safeStore.')
  .replaceAll('confirm(', 'demoConfirm(')
  .replace("if (call) return toast('You are already in a call.');",
    "if (window.__seamsDemo) return toast('Calls and screen sharing run on your own Seams server. This demo page cannot use a camera.', 6000);\n  if (call) return toast('You are already in a call.');");

for (const [needle, src] of [['safeStore.', app], ['demoConfirm(', app], ['__seamsDemo', app], ['demo-pill', body]]) if (!src.includes(needle)) throw new Error('demo build: patch failed for ' + needle);

fs.writeFileSync(out, `<title>Seams</title>
<style>${read('public/style.css')}
html, body { height: 100%; }
.demo-pill { font-size: 11px; font-weight: 600; color: var(--brand); background: var(--brand-soft); border-radius: 10px; padding: 1px 8px; margin-left: 6px; }
</style>
${body}
<script>${read('demo/mock.js')}</script>
<script type="module">${app}</script>
`);
console.log('wrote', out);
