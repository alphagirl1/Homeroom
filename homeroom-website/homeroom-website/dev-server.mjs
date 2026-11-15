// Run Homeroom on your own computer:  node dev-server.mjs   then open http://localhost:3000
// Your data is saved in homeroom-data.json next to this file. Keep the computer on for background syncing.
//   PORT=4000 node dev-server.mjs            use another port
//   HOMEROOM_MOCK=1 node dev-server.mjs      fake school sites (for testing)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from './server/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, 'public');
const port = Number(process.env.PORT || 3000);
const secretFile = path.join(here, '.homeroom-secret');
let secret = process.env.HOMEROOM_SECRET;
if (!secret) { try { secret = fs.readFileSync(secretFile, 'utf8').trim(); } catch { secret = crypto.randomBytes(32).toString('base64url'); fs.writeFileSync(secretFile, secret, { mode: 0o600 }); } }
const env = Object.assign({}, process.env, { HOMEROOM_SECRET: secret, HOMEROOM_DATA_FILE: process.env.HOMEROOM_DATA_FILE || path.join(here, 'homeroom-data.json') });

let fetchImpl = fetch;
if (process.env.HOMEROOM_MOCK) fetchImpl = (await import('./test/mocks.mjs')).mockFetch;
const app = createApp(env, { fetch: fetchImpl });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.zip': 'application/zip', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cal/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      const r = await app.handle(new Request(url.href, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
      const out = { ...Object.fromEntries(r.headers) }; delete out['set-cookie'];
      const cookies = r.headers.getSetCookie(); if (cookies.length) out['set-cookie'] = cookies;
      res.writeHead(r.status, out); res.end(Buffer.from(await r.arrayBuffer())); return;
    }
    let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { console.error(e); res.writeHead(500); res.end('Server error'); }
}).listen(port, () => console.log(`Homeroom is running at http://localhost:${port}`));

// Background sync every 5 minutes while this is running.
if (!process.env.HOMEROOM_NO_TIMER) setInterval(() => app.cron().catch(e => console.error('timer:', e.message)), 5 * 60 * 1000);
