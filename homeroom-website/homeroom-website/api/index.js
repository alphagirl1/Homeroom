// Vercel runs this one function for every /api/… and /cal/… address (see vercel.json).
import { createApp } from '../server/app.js';

let app = null;

export default async function handler(req, res) {
  app = app || createApp(process.env);
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0];
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
    body = chunks.length ? Buffer.concat(chunks) : (req.body == null ? undefined : Buffer.from(typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body)));
  }
  const response = await app.handle(new Request(`${proto}://${host}${req.url}`, { method: req.method, headers, body }));
  res.statusCode = response.status;
  response.headers.forEach((v, k) => { if (k !== 'set-cookie') res.setHeader(k, v); });
  const cookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}
