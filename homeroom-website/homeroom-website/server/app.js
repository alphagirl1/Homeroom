// Homeroom website server. Works with any host that speaks standard Request/Response
// (Vercel through api/index.js, or `node dev-server.mjs` on your own computer).
import { makeStore, withLock } from './store.js';
import { sealer, token, sha256, hmac, hashPassword, verifyPassword, uuid, safeEqual } from './crypto.js';
import { getDoc, getDocs, putDoc, putDocs, getSecrets, putSecrets, getMeta, putMeta, getSiteSecrets, putSiteSecrets, getAccount, putAccount, userKeys } from './data.js';
import { syncUser, syncGenesis, runFormLogin, syncCalLink, newIncoming, mergeIncoming, pruneItems, tzOf, aiFor, claudeCaller, notify, getVapid,
  digestMessage, schedFor, GENESIS_DEFAULT, friendlyError } from './sync.js';
import { buildFeed } from './ics.js';
import { validTz, dateWall, parts } from './time.js';
import { safeUrl, sleep } from './util.js';

const COOKIE = 'hr_s';
const SESSION_DAYS = 60;
const SITES = ['vhl', 'albert', 'deltamath', 'mcgraw', 'pearson', 'savvas', 'apclassroom', 'classroom', 'personal'];
class HttpError extends Error { constructor(status, msg, extra = {}) { super(msg); this.status = status; Object.assign(this, extra); } }
const bad = (msg, status = 400, extra) => new HttpError(status, msg, extra);
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers) });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
const cleanName = s => String(s || '').trim().toLowerCase();
const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = (groups, n = 4) => Array.from({ length: groups }, () => Array.from({ length: n }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join('')).join('-');

export function createApp(env = process.env, o = {}) {
  const store = o.store !== undefined ? o.store : makeStore(env);
  const secret = env.HOMEROOM_SECRET || '';
  const ctx = { env, store, seal: sealer(secret), fetch: o.fetch || fetch, now: o.now || (() => Date.now()), tz: validTz(env.HOMEROOM_TIMEZONE || 'America/New_York'), site: env.HOMEROOM_URL || '', log: o.log || ((...a) => console.log(...a)) };
  const cronKey = secret ? hmac(secret, 'cron').slice(0, 32) : '';
  const ready = () => !!(ctx.store && ctx.seal);
  const setup = () => ({ ready: ready(), db: !!ctx.store, dbKind: ctx.store ? ctx.store.kind : null, secret: !!ctx.seal, secretTooShort: !!secret && !ctx.seal, suggestedSecret: ctx.seal ? undefined : token(32) });

  /* ------------------------------ helpers ------------------------------ */
  const ipOf = req => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
  async function limit(key, max, seconds, msg) {
    const n = await ctx.store.incr('hr:rl:' + key, seconds);
    if (n > max) throw bad(msg || 'Too many tries. Wait a few minutes and try again.', 429);
  }
  function cookieFor(tok, req, maxAge = SESSION_DAYS * 86400) {
    const https = new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
    return `${COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${https ? '; Secure' : ''}`;
  }
  async function newSession(acct) { const tok = token(32); await ctx.store.set('hr:sess:' + sha256(tok), acct.uid + ':' + (acct.epoch || 0), { ex: SESSION_DAYS * 86400 }); return tok; }
  async function session(req) {
    const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([A-Za-z0-9_-]{20,})'));
    if (!m) return null;
    const v = await ctx.store.get('hr:sess:' + sha256(m[1]));
    if (!v) return null;
    const [uid, epoch] = v.split(':');
    const acct = await getAccount(ctx, uid);
    if (!acct || String(acct.epoch || 0) !== epoch) return null;
    return { uid, acct, tok: m[1] };
  }
  const isOwner = async uid => (await ctx.store.get('hr:owner')) === uid;
  const docsOut = d => ({ state: d.state, items: d.items, grades: d.grades, chat: d.chat });

  async function status(uid, pre = {}) {
    const docs = pre.docs && pre.docs.sync ? pre.docs : await getDocs(ctx, uid, ['sync']);
    const [sec, site, acct] = await Promise.all([pre.sec || getSecrets(ctx, uid), ctx.store.mget('hr:meta', 'hr:cron', 'hr:vapid', 'hr:owner'), pre.acct || getAccount(ctx, uid)]);
    const parse = v => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
    const meta = parse(site[0]) || {}, cr = parse(site[1]), vapid = parse(site[2]), owner = site[3], sync = docs.sync;
    const siteAi = meta.aiShare && meta.aiShare.on && !sec.anthropic ? !!(await getSiteSecrets(ctx)).anthropic : false;
    const g = sync.genesis;
    return {
      user: acct && acct.username, owner: owner === uid, lastSync: sync.lastSync || null, sources: sync.sources || {},
      cron: cr ? { last: cr.last, ran: cr.ran } : null, aiKey: !!sec.anthropic, aiSite: siteAi, aiPerDay: meta.aiShare ? meta.aiShare.perDay || 40 : 0,
      genesis: g ? { on: !!sec.genesis, url: g.url, user: g.user, student: g.student, last: g.last, note: g.note, ok: g.ok !== false } : null,
      logins: (sync.logins || []).map(l => ({ id: l.id, src: l.src, loginUrl: l.loginUrl, pageUrl: l.pageUrl, user: l.user, ok: l.ok, note: l.note, last: l.last, fails: l.fails || 0 })),
      ext: { key: !!sec.extKey, sites: sync.extSites || {} }, cals: (sync.cals || []).map(c => ({ id: c.id, name: c.name, ok: c.ok, note: c.note, last: c.last })),
      feed: !!sec.calToken, push: { n: (sync.push || []).length, key: vapid ? vapid.publicKey : null }, site: ctx.site,
    };
  }

  /* -------------------------- accounts (public) -------------------------- */
  const PUBLIC = {
    async site() {
      const [owner, meta] = await Promise.all([ctx.store.get('hr:owner'), getMeta(ctx)]);
      return { hasOwner: !!owner, inviteRequired: !!owner && !(meta.invite && meta.invite.on === false), name: meta.siteName || 'Homeroom' };
    },
    async signup(req, b) {
      const username = cleanName(b.username), pw = String(b.password || '');
      if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw bad('Usernames are 3–30 characters: letters, numbers, dots, dashes or underscores.');
      if (pw.length < 8) throw bad('Use a password with at least 8 characters.');
      await limit('signup:' + ipOf(req), 15, 3600, 'Too many new accounts from here. Try again in an hour.');
      const checkInvite = async () => {
        const meta = await getMeta(ctx), users = await ctx.store.smembers('hr:users');
        if (!(meta.invite && meta.invite.on === false) && !safeEqual(normCode(b.invite), normCode(meta.invite && meta.invite.code))) throw bad('That invite code isn’t right. Ask the person who sent you this Homeroom for it.', 403, { code: 'invite' });
        if (users.length >= (meta.maxUsers || 60)) throw bad('This Homeroom is full. Ask the person who runs it to make room.', 403);
      };
      const hadOwner = !!(await ctx.store.get('hr:owner'));
      if (hadOwner) await checkInvite();
      const uid = 'u' + uuid().replace(/-/g, '').slice(0, 16);
      if (!(await ctx.store.set('hr:name:' + username, uid, { nx: true }))) throw bad('That username is taken. Try another one.', 409);
      let owner = false;
      try {
        if (!hadOwner) { owner = await ctx.store.set('hr:owner', uid, { nx: true }); if (!owner) await checkInvite(); }
      } catch (e) { await ctx.store.del('hr:name:' + username); throw e; }
      const recovery = code(3);
      const acct = { uid, username, created: ctx.now(), pw: await hashPassword(pw), rec: sha256(normCode(recovery)), epoch: 0 };
      await putAccount(ctx, uid, acct);
      await ctx.store.sadd('hr:users', uid);
      if (owner) { const meta = await getMeta(ctx); meta.invite = { on: true, code: code(2) }; meta.created = ctx.now(); meta.maxUsers = 60; await putMeta(ctx, meta); }
      return json({ ok: true, recovery, owner }, 200, { 'Set-Cookie': cookieFor(await newSession(acct), req) });
    },
    async signin(req, b) {
      const username = cleanName(b.username);
      await limit('signin:' + username, 8, 900, 'Too many wrong tries for that username. Wait 15 minutes, or reset your password with your recovery code.');
      await limit('signin-ip:' + ipOf(req), 40, 900);
      const uid = username && await ctx.store.get('hr:name:' + username), acct = uid && await getAccount(ctx, uid);
      if (!acct || !(await verifyPassword(b.password, acct.pw))) { await sleep(250); throw bad('That username and password don’t match.', 401, { code: 'bad_login' }); }
      return json({ ok: true }, 200, { 'Set-Cookie': cookieFor(await newSession(acct), req) });
    },
    async reset(req, b) {
      const username = cleanName(b.username), pw = String(b.password || '');
      await limit('reset:' + username, 6, 3600, 'Too many tries. Wait an hour and try again.');
      if (pw.length < 8) throw bad('Use a password with at least 8 characters.');
      const uid = username && await ctx.store.get('hr:name:' + username), acct = uid && await getAccount(ctx, uid);
      if (!acct || !safeEqual(sha256(normCode(b.recovery)), acct.rec)) throw bad('That username and recovery code don’t match.', 401);
      const recovery = code(3);
      Object.assign(acct, { pw: await hashPassword(pw), rec: sha256(normCode(recovery)), epoch: (acct.epoch || 0) + 1 });
      await putAccount(ctx, uid, acct);
      return json({ ok: true, recovery }, 200, { 'Set-Cookie': cookieFor(await newSession(acct), req) });
    },
  };

  /* ---------------------------- the student's API ---------------------------- */
  const lockUser = (uid, fn) => withLock(ctx.store, 'u:' + uid, fn);
  const API = {
    async signout(s, b, req) { await ctx.store.del('hr:sess:' + sha256(s.tok)); return json({ ok: true }, 200, { 'Set-Cookie': cookieFor('x'.repeat(20), req, 0) }); },
    async bootstrap(s, b, req) {
      await ctx.store.set('hr:sess:' + sha256(s.tok), s.uid + ':' + (s.acct.epoch || 0), { ex: SESSION_DAYS * 86400 });
      const d = await getDocs(ctx, s.uid, ['state', 'items', 'grades', 'chat', 'sync']);
      return { user: { username: s.acct.username, created: s.acct.created }, data: docsOut(d), status: await status(s.uid, { docs: d, acct: s.acct }) };
    },
    async pull(s) { const d = await getDocs(ctx, s.uid, ['state', 'items', 'grades', 'chat', 'sync']); return { data: docsOut(d), status: await status(s.uid, { docs: d, acct: s.acct }) }; },
    async patch(s, p) {
      const out = await lockUser(s.uid, async () => {
        const d = await getDocs(ctx, s.uid, ['state', 'items', 'grades', 'chat', 'sync']), tz = tzOf(p.state || d.state, ctx), w = {};
        if (p.state && typeof p.state === 'object') {
          const st = p.state, removed = new Set(p.removedCourses || []);
          if (d.state && Array.isArray(d.state.courses)) { const have = new Set((st.courses || []).map(c => c.id)); for (const c of d.state.courses) if (!have.has(c.id) && !removed.has(c.id)) (st.courses = st.courses || []).push(c); }
          d.state = st; w.state = st; w.sched = schedFor(st, d.sync, tzOf(st, ctx));
        }
        if (p.items) { applyList(d.items.list, p.items); pruneItems(d.items.list, tz, ctx.now()); w.items = d.items; }
        if (p.grades) { applyList(d.grades.list, p.grades); if (p.grades.avgs) d.grades.avgs = p.grades.avgs; w.grades = d.grades; }
        if (p.chat) { d.chat = { msgs: (p.chat.msgs || []).slice(-60) }; w.chat = d.chat; }
        await putDocs(ctx, s.uid, w);
        return d;
      });
      return { data: docsOut(out), status: await status(s.uid, { docs: out, acct: s.acct }) };
    },
    async sync(s, b) {
      const r = await syncUser(ctx, s.uid, b.why === 'open' ? 'open' : 'manual');
      const d = await getDocs(ctx, s.uid, ['state', 'items', 'grades', 'chat', 'sync']);
      return { data: docsOut(d), status: await status(s.uid, { docs: d, acct: s.acct }), result: { added: r.added || 0, updated: r.updated || 0, skipped: r.skipped } };
    },
    async genesis(s, b) {
      if (b.off) {
        await lockUser(s.uid, async () => { const sec = await getSecrets(ctx, s.uid); delete sec.genesis; await putSecrets(ctx, s.uid, sec); const sy = await getDoc(ctx, s.uid, 'sync'); sy.genesis = null; if (sy.sources) delete sy.sources.genesis; await putDoc(ctx, s.uid, 'sync', sy); });
        return { status: await status(s.uid, { acct: s.acct }) };
      }
      const prev = (await getSecrets(ctx, s.uid)).genesis || {};
      const cfg = { url: safeUrl(String(b.url || prev.url || GENESIS_DEFAULT).trim()) || GENESIS_DEFAULT, user: String(b.user || prev.user || '').trim(), pass: b.pass ? String(b.pass) : prev.pass, studentId: b.studentId || prev.studentId || '' };
      if (!cfg.user || !cfg.pass) throw bad('Enter your Genesis username and password.');
      await limit('genesis:' + s.uid, 12, 3600, 'That’s a lot of Genesis sign-in tries. Wait a while so Genesis doesn’t lock your account.');
      const state = await getDoc(ctx, s.uid, 'state'), tz = tzOf(state, ctx), inc = newIncoming();
      let r;
      try { r = await syncGenesis(ctx, cfg, state || {}, tz, inc); } catch (e) { throw bad(friendlyError(e), 400, { code: 'genesis', debug: e.debug }); }
      await lockUser(s.uid, async () => {
        const sec = await getSecrets(ctx, s.uid); sec.genesis = cfg; await putSecrets(ctx, s.uid, sec);
        const d = await getDocs(ctx, s.uid, ['state', 'items', 'grades', 'sync']);
        if (d.state) mergeIncoming(d, inc, tz, ctx.now());
        d.sync.genesis = { on: true, url: cfg.url, user: cfg.user, student: r.student, last: ctx.now(), note: r.note, debug: r.debug, ok: true };
        d.sync.sources = Object.assign(d.sync.sources || {}, { genesis: { ok: true, at: ctx.now(), n: r.n, note: r.note } });
        await putDocs(ctx, s.uid, d.state ? { state: d.state, items: d.items, grades: d.grades, sync: d.sync } : { sync: d.sync });
      });
      const d2 = await getDocs(ctx, s.uid, ['state', 'items', 'grades', 'chat', 'sync']);
      return { data: docsOut(d2), status: await status(s.uid, { docs: d2, acct: s.acct }), result: { n: r.n, note: r.note } };
    },
    async login(s, b) {
      if (b.remove) {
        await lockUser(s.uid, async () => { const sec = await getSecrets(ctx, s.uid); if (sec.logins) delete sec.logins[b.remove]; await putSecrets(ctx, s.uid, sec); const sy = await getDoc(ctx, s.uid, 'sync'); sy.logins = (sy.logins || []).filter(l => l.id !== b.remove); await putDoc(ctx, s.uid, 'sync', sy); });
        return { status: await status(s.uid, { acct: s.acct }) };
      }
      const src = SITES.includes(b.src) ? b.src : 'personal';
      const sy0 = await getDoc(ctx, s.uid, 'sync'), existing = (sy0.logins || []).find(l => l.id === b.id || (!b.id && l.src === src && src !== 'personal'));
      const id = existing ? existing.id : 'L' + uuid().replace(/-/g, '').slice(0, 10);
      const cfg = { id, src, loginUrl: safeUrl(String(b.loginUrl || '').trim()), pageUrl: safeUrl(String(b.pageUrl || '').trim()) || safeUrl(String(b.loginUrl || '').trim()), user: String(b.user || '').trim() };
      const pass = b.pass ? String(b.pass) : ((await getSecrets(ctx, s.uid)).logins || {})[id];
      if (!cfg.loginUrl || !cfg.user || !pass) throw bad('Fill in the login page, username and password.');
      await limit('login:' + s.uid, 20, 3600, 'That’s a lot of sign-in tries. Wait a while so the site doesn’t lock your account.');
      const state = await getDoc(ctx, s.uid, 'state'), tz = tzOf(state, ctx), inc = newIncoming();
      const ai = claudeCaller(ctx, s.uid, await aiFor(ctx, s.uid, await getSecrets(ctx, s.uid)));
      let r = null;
      try { r = await runFormLogin(ctx, cfg, pass, state || {}, tz, inc, ai); Object.assign(cfg, { ok: true, note: r.note, debug: r.debug, fails: 0 }); }
      catch (e) { Object.assign(cfg, { ok: false, note: friendlyError(e), debug: e.debug || '', fails: 1 }); }
      cfg.last = ctx.now();
      await lockUser(s.uid, async () => {
        const sec = await getSecrets(ctx, s.uid); sec.logins = Object.assign(sec.logins || {}, { [id]: pass }); await putSecrets(ctx, s.uid, sec);
        const d = await getDocs(ctx, s.uid, ['state', 'items', 'grades', 'sync']);
        d.sync.logins = (d.sync.logins || []).filter(l => l.id !== id).concat([cfg]);
        if (r && d.state) mergeIncoming(d, inc, tz, ctx.now());
        await putDocs(ctx, s.uid, r && d.state ? { state: d.state, items: d.items, grades: d.grades, sync: d.sync } : { sync: d.sync });
      });
      const d2 = await getDocs(ctx, s.uid, ['state', 'items', 'grades', 'chat', 'sync']);
      return { data: docsOut(d2), status: await status(s.uid, { docs: d2, acct: s.acct }), result: { ok: cfg.ok, note: cfg.note } };
    },
    async extkey(s, b) {
      const key = await lockUser(s.uid, async () => {
        const sec = await getSecrets(ctx, s.uid);
        if (sec.extKey && !b.reset) return sec.extKey;
        if (sec.extKey) await ctx.store.del('hr:ext:' + sha256(sec.extKey));
        sec.extKey = token(30).replace(/[^A-Za-z0-9]/g, '').slice(0, 40).padEnd(40, 'x');
        await ctx.store.set('hr:ext:' + sha256(sec.extKey), s.uid); await putSecrets(ctx, s.uid, sec);
        return sec.extKey;
      });
      return { key, url: (ctx.site || '') + '/api/ext', status: await status(s.uid, { acct: s.acct }) };
    },
    async calfeed(s, b) {
      const tok = await lockUser(s.uid, async () => {
        const sec = await getSecrets(ctx, s.uid);
        if (sec.calToken && !b.reset) return sec.calToken;
        if (sec.calToken) await ctx.store.del('hr:cal:' + sha256(sec.calToken));
        sec.calToken = token(24); await ctx.store.set('hr:cal:' + sha256(sec.calToken), s.uid); await putSecrets(ctx, s.uid, sec);
        return sec.calToken;
      });
      return { url: (ctx.site || '') + '/cal/' + tok + '.ics', status: await status(s.uid, { acct: s.acct }) };
    },
    async calimport(s, b) {
      if (b.remove) {
        await lockUser(s.uid, async () => { const sec = await getSecrets(ctx, s.uid); if (sec.cals) delete sec.cals[b.remove]; await putSecrets(ctx, s.uid, sec); const sy = await getDoc(ctx, s.uid, 'sync'); sy.cals = (sy.cals || []).filter(c => c.id !== b.remove); await putDoc(ctx, s.uid, 'sync', sy); });
        return { status: await status(s.uid, { acct: s.acct }) };
      }
      const url = String(b.url || '').trim().replace(/^webcal:/i, 'https:');
      if (!safeUrl(url)) throw bad('Paste a calendar link that starts with https:// or webcal://');
      const cal = { id: 'C' + uuid().replace(/-/g, '').slice(0, 8), name: String(b.name || 'Calendar').slice(0, 60) };
      const state = await getDoc(ctx, s.uid, 'state'), tz = tzOf(state, ctx), inc = newIncoming();
      let r; try { r = await syncCalLink(ctx, cal, url, state || {}, tz, inc); } catch (e) { throw bad(friendlyError(e)); }
      Object.assign(cal, { ok: true, note: r.note, last: ctx.now() });
      await lockUser(s.uid, async () => {
        const sec = await getSecrets(ctx, s.uid); sec.cals = Object.assign(sec.cals || {}, { [cal.id]: url }); await putSecrets(ctx, s.uid, sec);
        const d = await getDocs(ctx, s.uid, ['state', 'items', 'grades', 'sync']);
        d.sync.cals = (d.sync.cals || []).concat([cal]).slice(-8);
        if (d.state) mergeIncoming(d, inc, tz, ctx.now());
        await putDocs(ctx, s.uid, d.state ? { state: d.state, items: d.items, grades: d.grades, sync: d.sync } : { sync: d.sync });
      });
      const d2 = await getDocs(ctx, s.uid, ['state', 'items', 'grades', 'chat', 'sync']);
      return { data: docsOut(d2), status: await status(s.uid, { docs: d2, acct: s.acct }), result: { note: r.note } };
    },
    async secret(s, b) {
      if (b.name !== 'anthropic') throw bad('Unknown setting.');
      const value = String(b.value || '').trim();
      if (value) { try { await claudeCaller(ctx, s.uid, { key: value, own: true })([{ role: 'user', content: 'Reply with just: ok' }], { max: 5 }); } catch (e) { throw bad('That key didn’t work: ' + friendlyError(e)); } }
      await lockUser(s.uid, async () => { const sec = await getSecrets(ctx, s.uid); if (value) sec.anthropic = value; else delete sec.anthropic; await putSecrets(ctx, s.uid, sec); });
      return { status: await status(s.uid, { acct: s.acct }) };
    },
    async ai(s, b) {
      const ai = claudeCaller(ctx, s.uid, await aiFor(ctx, s.uid, await getSecrets(ctx, s.uid)));
      if (!ai) throw bad('NO_KEY', 400, { code: 'no_key' });
      const msgs = Array.isArray(b.messages) && b.messages.length ? b.messages.slice(-30) : [{ role: 'user', content: String(b.prompt || '') }];
      const imgs = (b.images || []).slice(0, 4).filter(im => im && typeof im.b64 === 'string' && im.b64.length < 6_000_000);
      if (imgs.length) { const last = msgs[msgs.length - 1]; msgs[msgs.length - 1] = { role: 'user', content: imgs.map(im => ({ type: 'image', source: { type: 'base64', media_type: /^image\/(png|jpeg|webp|gif)$/.test(im.type) ? im.type : 'image/jpeg', data: im.b64 } })).concat([{ type: 'text', text: String(last.content) }]) }; }
      try { return { text: await ai(msgs, { system: b.system ? String(b.system).slice(0, 60000) : undefined, max: Math.min(4000, +b.max || 2500), model: b.tier === 'quick' ? 'claude-haiku-5-5' : 'claude-sonnet-5-5' }) }; }
      catch (e) { if (e.code === 'ai_limit') throw bad('AI_LIMIT', 429, { code: 'ai_limit' }); throw bad(String(e.message || e), 502); }
    },
    async push(s, b) {
      if (b.action === 'key') return { key: (await getVapid(ctx, true)).publicKey };
      if (b.action === 'subscribe') {
        const sub = b.sub || {};
        if (!/^https:\/\//.test(sub.endpoint || '') || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw bad('That browser didn’t give a usable notification address.');
        await lockUser(s.uid, async () => { const sy = await getDoc(ctx, s.uid, 'sync'); sy.push = (sy.push || []).filter(x => x.endpoint !== sub.endpoint).concat([{ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, at: ctx.now(), ua: String(b.ua || '').slice(0, 80) }]).slice(-6); await putDoc(ctx, s.uid, 'sync', sy); });
      } else if (b.action === 'unsubscribe') {
        await lockUser(s.uid, async () => { const sy = await getDoc(ctx, s.uid, 'sync'); sy.push = (sy.push || []).filter(x => x.endpoint !== b.endpoint); await putDoc(ctx, s.uid, 'sync', sy); });
      } else if (b.action === 'test') {
        const sent = await lockUser(s.uid, async () => { const sy = await getDoc(ctx, s.uid, 'sync'); const n = await notify(ctx, s.uid, sy, { title: 'Homeroom notifications work', body: 'You’ll get reminders and new-grade alerts here.', url: '/#today', tag: 'homeroom-test' }); await putDoc(ctx, s.uid, 'sync', sy); return n; });
        return { sent, status: await status(s.uid, { acct: s.acct }) };
      }
      return { status: await status(s.uid, { acct: s.acct }) };
    },
    async debug(s) {
      const sy = await getDoc(ctx, s.uid, 'sync');
      return { genesis: sy.genesis && sy.genesis.debug || '', logins: (sy.logins || []).map(l => ({ src: l.src, note: l.note, debug: l.debug })), sources: sy.sources || {}, storage: ctx.store.usage ? await ctx.store.usage() : null };
    },
    async password(s, b, req) {
      if (!(await verifyPassword(b.old, s.acct.pw))) throw bad('Your current password isn’t right.', 401);
      if (String(b.password || '').length < 8) throw bad('Use a password with at least 8 characters.');
      Object.assign(s.acct, { pw: await hashPassword(b.password), epoch: (s.acct.epoch || 0) + 1 });
      await putAccount(ctx, s.uid, s.acct);
      return json({ ok: true }, 200, { 'Set-Cookie': cookieFor(await newSession(s.acct), req) });
    },
    async deleteaccount(s, b, req) {
      if (!(await verifyPassword(b.password, s.acct.pw))) throw bad('That password isn’t right.', 401);
      await removeUser(s.uid);
      return json({ ok: true }, 200, { 'Set-Cookie': cookieFor('x'.repeat(20), req, 0) });
    },
    async owner(s, b) {
      if (!(await isOwner(s.uid))) throw bad('Only the person who runs this Homeroom can do that.', 403);
      const meta = await getMeta(ctx);
      if (b.action === 'invite') { meta.invite = { on: b.on !== false, code: b.newCode || !meta.invite ? code(2) : meta.invite.code }; await putMeta(ctx, meta); }
      if (b.action === 'maxUsers') { meta.maxUsers = Math.max(1, Math.min(500, Math.round(+b.n || 60))); await putMeta(ctx, meta); }
      if (b.action === 'aiShare') {
        if (b.key !== undefined) {
          const k = String(b.key || '').trim();
          if (k) { try { await claudeCaller(ctx, s.uid, { key: k, own: true })([{ role: 'user', content: 'Reply with just: ok' }], { max: 5 }); } catch (e) { throw bad('That key didn’t work: ' + friendlyError(e)); } }
          const ss = await getSiteSecrets(ctx); if (k) ss.anthropic = k; else delete ss.anthropic; await putSiteSecrets(ctx, ss);
        }
        meta.aiShare = { on: !!b.on, perDay: Math.max(1, Math.min(500, Math.round(+b.perDay || (meta.aiShare && meta.aiShare.perDay) || 40))) };
        await putMeta(ctx, meta);
      }
      if (b.action === 'removeUser') { if (b.uid === s.uid) throw bad('Use Settings → Your data to delete your own account.'); await removeUser(b.uid); }
      if (b.action === 'cron') await cron({ budget: 24000 });
      const uids = await ctx.store.smembers('hr:users');
      const accts = await Promise.all(uids.map(u => getAccount(ctx, u))), scheds = await Promise.all(uids.map(u => getDoc(ctx, u, 'sched')));
      const cr = await ctx.store.get('hr:cron');
      return {
        users: uids.map((u, i) => accts[i] && { uid: u, username: accts[i].username, created: accts[i].created, lastSync: scheds[i].lastSync || null, me: u === s.uid }).filter(Boolean).sort((a, b) => a.created - b.created),
        invite: meta.invite || null, maxUsers: meta.maxUsers || 60, aiShare: meta.aiShare || { on: false, perDay: 40 }, siteAiKey: !!(await getSiteSecrets(ctx)).anthropic,
        cron: Object.assign(cr ? JSON.parse(cr) : {}, { url: (ctx.site || '') + '/api/cron?key=' + cronKey }), db: ctx.store.kind, storage: ctx.store.usage ? await ctx.store.usage() : null,
      };
    },
  };

  async function removeUser(uid) {
    const [acct, sec] = await Promise.all([getAccount(ctx, uid), getSecrets(ctx, uid)]);
    const keys = userKeys(uid);
    if (acct) keys.push('hr:name:' + acct.username);
    if (sec.extKey) keys.push('hr:ext:' + sha256(sec.extKey));
    if (sec.calToken) keys.push('hr:cal:' + sha256(sec.calToken));
    await ctx.store.del(...keys);
    await ctx.store.srem('hr:users', uid);
    if (await isOwner(uid)) {
      const rest = await ctx.store.smembers('hr:users'), accts = (await Promise.all(rest.map(u => getAccount(ctx, u)))).filter(Boolean).sort((a, b) => a.created - b.created);
      if (accts[0]) await ctx.store.set('hr:owner', accts[0].uid); else await ctx.store.del('hr:owner');
    }
  }
  function applyList(list, p) {
    const idx = new Map(list.map((x, i) => [x.id, i]));
    for (const x of p.upsert || []) { if (!x || !x.id) continue; if (idx.has(x.id)) list[idx.get(x.id)] = x; else { idx.set(x.id, list.length); list.push(x); } }
    if (p.remove && p.remove.length) { const rm = new Set(p.remove); for (let i = list.length - 1; i >= 0; i--) if (rm.has(list[i].id)) list.splice(i, 1); }
  }

  /* --------------------------- Chrome extension inbox --------------------------- */
  async function extInbox(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    let body = {};
    try { body = JSON.parse(await req.text()); } catch {}
    const key = String(body.key || '');
    if (!/^[A-Za-z0-9]{24,64}$/.test(key)) return json({ ok: false, error: 'bad_key' }, 200, CORS);
    const uid = await ctx.store.get('hr:ext:' + sha256(key));
    if (!uid) return json({ ok: false, error: 'unknown_key' }, 200, CORS);
    if (body.ping) return json({ ok: true, pong: true }, 200, CORS);
    const pages = (Array.isArray(body.pages) ? body.pages : [body]).slice(0, 12).map(pg => ({
      src: String(pg.src || '').slice(0, 20), url: safeUrl(pg.url) || '', title: String(pg.title || '').slice(0, 200), loggedOut: !!pg.loggedOut,
      text: String(pg.text || '').slice(0, 40000), rows: (Array.isArray(pg.rows) ? pg.rows : []).slice(0, 250).map(r => String(r).slice(0, 300)), at: ctx.now(),
    }));
    await withLock(ctx.store, 'inbox:' + uid, async () => { const box = await getDoc(ctx, uid, 'inbox'); box.pages = box.pages.concat(pages).slice(-30); await putDoc(ctx, uid, 'inbox', box); }, { ttl: 10000 });
    let r = {};
    try { r = await syncUser(ctx, uid, 'extension', 'extension'); } catch (e) { ctx.log('extension merge failed', e); }
    return json({ ok: true, received: pages.length, added: r.added || 0, updated: r.updated || 0 }, 200, CORS);
  }

  /* ------------------------------- calendar feed ------------------------------- */
  async function feed(file) {
    const tok = String(file).replace(/\.ics$/i, '');
    const uid = /^[A-Za-z0-9_-]{20,}$/.test(tok) && await ctx.store.get('hr:cal:' + sha256(tok));
    if (!uid) return new Response('Not found', { status: 404 });
    const d = await getDocs(ctx, uid, ['state', 'items']);
    return new Response(buildFeed(d.items.list, d.state || {}, tzOf(d.state, ctx), ctx.now(), ctx.site), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=900', 'Content-Disposition': 'inline; filename="homeroom.ics"' } });
  }

  /* ---------------------------------- the timer ---------------------------------- */
  async function digest(uid, tz, today) {
    await withLock(ctx.store, 'u:' + uid, async () => {
      const d = await getDocs(ctx, uid, ['state', 'items', 'grades', 'sync', 'sched']);
      const msg = d.state ? digestMessage(d.state, d.items.list, d.grades.list, d.sync, tz, ctx.now()) : null;
      if (msg) await notify(ctx, uid, d.sync, msg);
      d.sync.lastDigest = ctx.now(); d.sync.lastDigestDay = today;
      await putDocs(ctx, uid, { sync: d.sync, sched: Object.assign(d.sched, { lastDigestDay: today }) });
    });
  }
  /** Runs every few minutes (cron-job.org or similar). Syncs whoever is due, sends morning summaries. */
  async function cron({ budget = 24000 } = {}) {
    const start = ctx.now(), uids = await ctx.store.smembers('hr:users');
    const raw = uids.length ? await ctx.store.mget(...uids.map(u => `hr:u:${u}:sched`)) : [];
    const due = [], digests = [];
    uids.forEach((uid, i) => {
      let s = {}; try { s = JSON.parse(raw[i] || '{}'); } catch {}
      if (!s.ready) return;
      if (s.auto && start - (s.lastSync || 0) >= s.every * 60000 - 90000) due.push({ uid, late: start - (s.lastSync || 0) });
      const tz = validTz(s.tz), today = dateWall(start, tz);
      if (s.digest && parts(start, tz).hh === s.hour && s.lastDigestDay !== today) digests.push({ uid, tz, today });
    });
    due.sort((a, b) => b.late - a.late);
    let next = 0, ran = 0, errors = 0;
    const left = () => budget - (ctx.now() - start);
    const worker = async () => {
      while (next < due.length && left() > 12000) {
        const { uid } = due[next++];
        try { await Promise.race([syncUser(ctx, uid, 'cron'), sleep(Math.max(1000, left() - 1500)).then(() => { throw new Error('still running'); })]); ran++; }
        catch (e) { errors++; if (!/still running|Busy/.test(e.message)) ctx.log('cron sync failed', uid, e.message); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, due.length) }, worker));
    for (const d of digests) { try { await digest(d.uid, d.tz, d.today); } catch (e) { ctx.log('digest failed', d.uid, e.message); } }
    const out = { last: start, ms: ctx.now() - start, users: uids.length, due: due.length, ran, errors, digests: digests.length };
    await ctx.store.set('hr:cron', JSON.stringify(out));
    return out;
  }

  /* ----------------------------------- router ----------------------------------- */
  async function handle(req) {
    const url = new URL(req.url);
    if (!env.HOMEROOM_URL) ctx.site = (req.headers.get('x-forwarded-proto') ? req.headers.get('x-forwarded-proto') + '://' + (req.headers.get('x-forwarded-host') || url.host) : url.origin);
    let path = url.searchParams.get('__p');
    if (path == null) path = url.pathname.replace(/^\/(api\/)?/, '');
    path = path.replace(/^\/+|\/+$/g, '');
    try {
      if (path === 'health') return json(setup());
      if (!ready()) return json({ error: 'setup', setup: setup() }, 503);
      if (path.startsWith('cal/')) return await feed(path.slice(4));
      if (path === 'ext') return await extInbox(req);
      if (path === 'cron') {
        const k = url.searchParams.get('key') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
        if (!cronKey || !safeEqual(k, cronKey)) return json({ error: 'bad_key' }, 403);
        return json(await cron());
      }
      if (req.method !== 'POST') return json({ error: 'not_found' }, 404);
      if (req.headers.get('x-homeroom') !== '1') return json({ error: 'bad_request' }, 400);
      const body = await req.json().catch(() => ({}));
      if (PUBLIC[path]) { const r = await PUBLIC[path](req, body); return r instanceof Response ? r : json(r); }
      const fn = API[path];
      if (!fn) return json({ error: 'not_found' }, 404);
      const s = await session(req);
      if (!s) return json({ error: 'signed_out', message: 'Sign in again.' }, 401);
      const r = await fn(s, body, req);
      return r instanceof Response ? r : json(r);
    } catch (e) {
      const st = e.status || 500;
      if (st >= 500) ctx.log('error in', path, e);
      return json({ error: e.code || 'error', message: st >= 500 && !e.status ? 'Something went wrong on the server: ' + String(e.message || e).slice(0, 200) : e.message, debug: e.debug }, st);
    }
  }
  return { handle, cron, ctx, cronKey };
}
