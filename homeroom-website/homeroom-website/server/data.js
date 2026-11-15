// Where each student's data lives. Every key starts with "hr:" so one database can be shared safely.
import { clone } from './util.js';

export const DOCS = { state: null, items: { list: [] }, grades: { list: [], avgs: {} }, chat: { msgs: [] }, sync: {}, inbox: { pages: [] }, sched: {} };
const ukey = (uid, name) => `hr:u:${uid}:${name}`;

export async function getDoc(ctx, uid, name) {
  const s = await ctx.store.get(ukey(uid, name));
  if (s) { try { return JSON.parse(s); } catch {} }
  return clone(DOCS[name] ?? null);
}
export async function getDocs(ctx, uid, names) {
  const vals = ctx.store.mget ? await ctx.store.mget(...names.map(n => ukey(uid, n))) : await Promise.all(names.map(n => ctx.store.get(ukey(uid, n))));
  const out = {};
  names.forEach((n, i) => { let v = null; if (vals[i]) { try { v = JSON.parse(vals[i]); } catch {} } out[n] = v ?? clone(DOCS[n] ?? null); });
  return out;
}
export const putDoc = (ctx, uid, name, v) => ctx.store.set(ukey(uid, name), JSON.stringify(v));
/** Writes several documents in one database command. */
export function putDocs(ctx, uid, docs) { const pairs = {}; for (const [n, v] of Object.entries(docs)) if (v !== undefined) pairs[ukey(uid, n)] = JSON.stringify(v); return ctx.store.mset(pairs); }

export async function getSecrets(ctx, uid) {
  const s = await ctx.store.get(ukey(uid, 'sec'));
  if (!s) return {};
  try { return ctx.seal.open(s, 'u:' + uid) || {}; } catch { return {}; }
}
export const putSecrets = (ctx, uid, obj) => ctx.store.set(ukey(uid, 'sec'), ctx.seal.seal(obj, 'u:' + uid));

export async function getMeta(ctx) { const s = await ctx.store.get('hr:meta'); try { return s ? JSON.parse(s) : {}; } catch { return {}; } }
export const putMeta = (ctx, m) => ctx.store.set('hr:meta', JSON.stringify(m));
export async function getSiteSecrets(ctx) { const s = await ctx.store.get('hr:site:sec'); if (!s) return {}; try { return ctx.seal.open(s, 'site') || {}; } catch { return {}; } }
export const putSiteSecrets = (ctx, obj) => ctx.store.set('hr:site:sec', ctx.seal.seal(obj, 'site'));

export async function getAccount(ctx, uid) { const s = await ctx.store.get(ukey(uid, 'acct')); return s ? JSON.parse(s) : null; }
export const putAccount = (ctx, uid, a) => ctx.store.set(ukey(uid, 'acct'), JSON.stringify(a));
export const ALL_DOCS = ['acct', 'state', 'items', 'grades', 'chat', 'sync', 'inbox', 'sched', 'sec'];
export const userKeys = uid => ALL_DOCS.map(n => ukey(uid, n));
