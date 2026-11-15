// Storage. On Vercel this is an Upstash Redis database (free tier), reached over HTTPS with no extra packages.
// For running on your own computer it's a JSON file; for tests it's memory.
import fs from 'node:fs';
import { sleep } from './util.js';

function redisEnv(env) {
  const pick = (...names) => names.map(n => env[n]).find(Boolean);
  let url = pick('UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL');
  let token = pick('UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN');
  if (!url || !token) { // Vercel can add a custom prefix, e.g. HOMEROOM_KV_REST_API_URL
    const k = Object.keys(env).find(k => /_REST_API_URL$/.test(k) && env[k] && env[k.replace(/_URL$/, '_TOKEN')]);
    if (k) { url = env[k]; token = env[k.replace(/_URL$/, '_TOKEN')]; }
  }
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

export function upstashStore({ url, token }, fetchImpl = fetch) {
  async function call(path, body) {
    const res = await fetchImpl(url + path, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error('Database error: ' + (j.error || res.status));
    return j;
  }
  const cmd = async (...args) => (await call('', args)).result;
  const pipe = async cmds => (await call('/pipeline', cmds)).map(r => { if (r.error) throw new Error('Database error: ' + r.error); return r.result; });
  return {
    kind: 'upstash',
    get: k => cmd('GET', k),
    mget: (...keys) => keys.length ? cmd('MGET', ...keys) : [],
    async set(k, v, o = {}) {
      const args = ['SET', k, String(v)];
      if (o.ex) args.push('EX', String(Math.ceil(o.ex))); else if (o.px) args.push('PX', String(Math.ceil(o.px)));
      if (o.nx) args.push('NX');
      return (await cmd(...args)) === 'OK';
    },
    del: (...keys) => keys.length ? cmd('DEL', ...keys) : 0,
    mset: pairs => { const a = Object.entries(pairs).flat().map(String); return a.length ? cmd('MSET', ...a) : null; },
    delIf: (k, v) => cmd('EVAL', "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", '1', k, String(v)),
    async incr(k, ex) { const n = await cmd('INCR', k); if (n === 1 && ex) await cmd('EXPIRE', k, String(ex)); return n; },
    sadd: (k, ...m) => cmd('SADD', k, ...m),
    srem: (k, ...m) => cmd('SREM', k, ...m),
    smembers: async k => (await cmd('SMEMBERS', k)) || [],
    pipe,
    usage: async () => ({ keys: await cmd('DBSIZE') }),
  };
}

export function memoryStore(seed = {}, onChange = null) {
  const m = new Map(Object.entries(seed.kv || {})), exp = new Map(Object.entries(seed.exp || {}).map(([k, v]) => [k, Number(v)])), sets = new Map(Object.entries(seed.sets || {}).map(([k, v]) => [k, new Set(v)]));
  const alive = k => { const e = exp.get(k); if (e && e <= Date.now()) { m.delete(k); exp.delete(k); return false; } return m.has(k); };
  const changed = () => onChange && onChange();
  const api = {
    calls: 0,
    kind: 'memory',
    async get(k) { return alive(k) ? m.get(k) : null; },
    async mget(...keys) { return keys.map(k => alive(k) ? m.get(k) : null); },
    async set(k, v, o = {}) {
      if (o.nx && alive(k)) return false;
      m.set(k, String(v));
      if (o.ex) exp.set(k, Date.now() + o.ex * 1000); else if (o.px) exp.set(k, Date.now() + o.px); else exp.delete(k);
      changed(); return true;
    },
    async del(...keys) { let n = 0; for (const k of keys) { if (m.delete(k)) n++; exp.delete(k); if (sets.delete(k)) n++; } changed(); return n; },
    async mset(pairs) { for (const [k, v] of Object.entries(pairs)) { m.set(k, String(v)); exp.delete(k); } changed(); return 'OK'; },
    async delIf(k, v) { if (alive(k) && m.get(k) === String(v)) { m.delete(k); exp.delete(k); changed(); return 1; } return 0; },
    async incr(k, ex) { const n = (alive(k) ? Number(m.get(k)) || 0 : 0) + 1; m.set(k, String(n)); if (n === 1 && ex) exp.set(k, Date.now() + ex * 1000); changed(); return n; },
    async sadd(k, ...mem) { const s = sets.get(k) || new Set(); mem.forEach(x => s.add(String(x))); sets.set(k, s); changed(); return mem.length; },
    async srem(k, ...mem) { const s = sets.get(k); if (s) mem.forEach(x => s.delete(String(x))); changed(); return mem.length; },
    async smembers(k) { return [...(sets.get(k) || [])]; },
    async usage() { let bytes = 0; for (const [k, v] of m) bytes += k.length + v.length; return { keys: m.size + sets.size, bytes }; },
    dump() { return { kv: Object.fromEntries(m), exp: Object.fromEntries(exp), sets: Object.fromEntries([...sets].map(([k, v]) => [k, [...v]])) }; },
  };
  for (const k of ['get', 'mget', 'set', 'del', 'mset', 'delIf', 'incr', 'sadd', 'srem', 'smembers']) { const f = api[k]; api[k] = (...a) => { api.calls++; return f(...a); }; }
  return api;
}

export function fileStore(path) {
  let seed = {};
  try { seed = JSON.parse(fs.readFileSync(path, 'utf8')); } catch {}
  let timer = null;
  const store = memoryStore(seed, () => { clearTimeout(timer); timer = setTimeout(() => { try { fs.writeFileSync(path + '.tmp', JSON.stringify(store.dump())); fs.renameSync(path + '.tmp', path); } catch (e) { console.error('save failed', e); } }, 300); });
  store.kind = 'file';
  return store;
}

export function makeStore(env) {
  const r = redisEnv(env);
  if (r) return upstashStore(r);
  if (env.HOMEROOM_DATA_FILE) return fileStore(env.HOMEROOM_DATA_FILE);
  return null;
}

/** A short-lived lock so two syncs for the same student don't overwrite each other. */
export async function withLock(store, key, fn, { ttl = 55000, wait = 20000 } = {}) {
  const token = Math.random().toString(36).slice(2), until = Date.now() + wait;
  while (!(await store.set('hr:lock:' + key, token, { px: ttl, nx: true }))) {
    if (Date.now() > until) throw Object.assign(new Error('Busy syncing. Try again in a minute.'), { code: 'busy' });
    await sleep(250 + Math.random() * 250);
  }
  try { return await fn(); }
  finally { await store.delIf('hr:lock:' + key, token); }
}
