// End-to-end test of the website server with pretend school sites. Run with:  TZ=UTC node test/server_test.mjs
import crypto from 'node:crypto';
import { createApp } from '../server/app.js';
import { memoryStore } from '../server/store.js';
import { mockFetch, pushes, state as mock, counters } from './mocks.mjs';
import { b64u } from '../server/crypto.js';

let failed = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) failed++; };
const section = t => console.log('\n' + t);
const clock = { t: Date.UTC(2026, 10, 15, 22, 0) }; // Sun Nov 15 2026, 5:00 PM in New York
// HR_TEST_STORE=upstash runs everything through the Upstash REST client against a fake Upstash server.
const backing = memoryStore();
let store = backing;
if (process.env.HR_TEST_STORE === 'upstash') {
  const { upstashStore } = await import('../server/store.js');
  const fake = async (url, o) => {
    if (o.headers.Authorization !== 'Bearer tok') return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    const [cmd, ...a] = JSON.parse(o.body), C = String(cmd).toUpperCase();
    let result;
    if (C === 'GET') result = await backing.get(a[0]);
    else if (C === 'MGET') result = await backing.mget(...a);
    else if (C === 'SET') { const opt = {}; for (let i = 2; i < a.length; i++) { const f = String(a[i]).toUpperCase(); if (f === 'EX') opt.ex = +a[++i]; else if (f === 'PX') opt.px = +a[++i]; else if (f === 'NX') opt.nx = true; } result = (await backing.set(a[0], a[1], opt)) ? 'OK' : null; }
    else if (C === 'MSET') { const pairs = {}; for (let i = 0; i < a.length; i += 2) pairs[a[i]] = a[i + 1]; result = await backing.mset(pairs); }
    else if (C === 'DEL') result = await backing.del(...a);
    else if (C === 'INCR') result = await backing.incr(a[0]);
    else if (C === 'EXPIRE') { const v = await backing.get(a[0]); if (v != null) await backing.set(a[0], v, { ex: +a[1] }); result = 1; }
    else if (C === 'EVAL') { if (!/redis\.call\('get', KEYS\[1\]\) == ARGV\[1\]/.test(a[0]) || a[1] !== '1') throw new Error('unexpected script'); result = await backing.delIf(a[2], a[3]); }
    else if (C === 'SADD') result = await backing.sadd(...a);
    else if (C === 'SREM') result = await backing.srem(...a);
    else if (C === 'SMEMBERS') result = await backing.smembers(a[0]);
    else if (C === 'DBSIZE') result = (await backing.usage()).keys;
    else return new Response(JSON.stringify({ error: 'ERR unknown command ' + C }), { status: 400 });
    if (a.some(x => typeof x !== 'string')) return new Response(JSON.stringify({ error: 'non-string argument' }), { status: 400 });
    return new Response(JSON.stringify({ result }), { status: 200 });
  };
  store = upstashStore({ url: 'https://fake.upstash.io', token: 'tok' }, fake);
  store.dump = () => backing.dump();
  Object.defineProperty(store, 'calls', { get: () => backing.calls });
  console.log('(using the Upstash REST client against a fake Upstash server)');
}
const env = { HOMEROOM_SECRET: 'test-secret-that-is-long-enough-123' };
const app = createApp(env, { store, fetch: mockFetch, now: () => clock.t, log: () => {} });
const ORIGIN = 'https://hr.test';

async function call(path, body = {}, cookie = '', o = {}) {
  const headers = { 'content-type': 'application/json', cookie };
  if (!o.noCsrf) headers['x-homeroom'] = '1';
  const r = await app.handle(new Request(`${ORIGIN}/api/${path}`, { method: 'POST', headers, body: JSON.stringify(body) }));
  const set = r.headers.getSetCookie();
  return { status: r.status, j: await r.json().catch(() => ({})), cookie: set.length ? set[0].split(';')[0] : cookie, setCookie: set[0] || '' };
}
const get = async (path, headers = {}) => app.handle(new Request(ORIGIN + path, { headers }));

section('1. Setup checks');
const bare = createApp({}, { store: null, fetch: mockFetch });
let r0 = await bare.handle(new Request(ORIGIN + '/api/bootstrap', { method: 'POST', headers: { 'x-homeroom': '1' } }));
let j0 = await r0.json();
ok(r0.status === 503 && j0.setup && !j0.setup.db && !j0.setup.secret && j0.setup.suggestedSecret.length >= 40, 'missing database and secret → setup screen with a ready-made secret');
ok((await (await get('/api/health')).json()).ready === true, 'health says ready when configured');

section('2. Accounts');
let r = await call('signup', { username: 'Nethra', password: 'correct horse' });
const owner = r.cookie;
ok(r.status === 200 && r.j.owner === true && /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(r.j.recovery), 'first account becomes the owner and gets a recovery code');
ok(/HttpOnly/.test(r.setCookie) && /SameSite=Lax/.test(r.setCookie) && /Secure/.test(r.setCookie), 'session cookie is HttpOnly, SameSite=Lax, Secure');
const ownerRecovery = r.j.recovery;
ok((await call('bootstrap', {}, owner, { noCsrf: true })).status === 400, 'requests without the Homeroom header are refused (CSRF guard)');
ok((await call('bootstrap', {}, '')).status === 401, 'signed-out requests get 401');
r = await call('bootstrap', {}, owner);
ok(r.status === 200 && r.j.user.username === 'nethra' && r.j.data.state === null && r.j.status.owner, 'bootstrap: new student, no data yet, owner flag');
const baseState = { v: 1, profile: { name: 'Nethra R', onboarded: true }, prefs: { tz: 'America/New_York', instant: { grades: true, missing: true, assignments: false, announcements: false }, digest: true, digestHour: 6, syncMinutes: 30, eveningAt: '19:00', morningAt: '07:00' }, courses: [{ id: 'c-calc', name: 'AP Calculus BC', color: '#6C8EBF', scheme: 'points', cats: [] }], dismissed: [] };
r = await call('patch', { state: baseState }, owner);
ok(r.status === 200 && r.j.data.state.profile.onboarded, 'saved onboarding');
r = await call('signup', { username: 'friend1', password: 'password123' });
ok(r.status === 403 && /invite/i.test(r.j.message), 'a second person needs the invite code');
let info = (await call('owner', {}, owner)).j;
ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(info.invite.code) && info.users.length === 1 && /\/api\/cron\?key=[a-f0-9]{32}$/.test(info.cron.url), 'owner tools: invite code, user list, timer link');
r = await call('signup', { username: 'friend1', password: 'password123', invite: info.invite.code.toLowerCase().replace('-', ' ') });
const friend = r.cookie;
ok(r.status === 200 && r.j.owner === false, 'friend joins with the invite code (case and spacing don’t matter)');
ok((await call('signup', { username: 'FRIEND1', password: 'password123', invite: info.invite.code })).status === 409, 'usernames are unique regardless of capitals');
ok((await call('owner', {}, friend)).status === 403, 'only the owner sees owner tools');
ok((await call('signin', { username: 'nethra', password: 'wrong pass' })).status === 401, 'wrong password refused');
r = await call('signin', { username: 'NETHRA', password: 'correct horse' });
ok(r.status === 200 && r.cookie && r.cookie !== owner, 'sign in works (username not case-sensitive)');

section('3. Genesis (MCMS-style hosted portal)');
r = await call('genesis', { url: 'https://students.c2.genesis.test/mcmsnj/sis/view?gohome=true', user: 'student', pass: 'nope' }, owner);
ok(r.status === 400 && /didn’t accept/.test(r.j.message), 'wrong Genesis password is explained: ' + r.j.message);
r = await call('genesis', { url: 'https://students.c2.genesis.test/mcmsnj/sis/view?gohome=true', user: 'student', pass: 'right' }, owner);
ok(r.status === 200 && r.j.result.n === 3, 'Genesis connected: ' + (r.j.result && r.j.result.note));
let items = r.j.data.items.list;
const u4 = items.find(i => i.title === 'Unit 4 Test');
ok(u4 && u4.due === '2026-11-24T23:59' && u4.type === 'test' && u4.allDay, 'due date kept in New York time on a UTC server (Unit 4 Test, Nov 24)');
ok(items.some(i => i.title === 'Ch 6 Problems' && i.missing), 'missing work flagged');
ok(r.j.data.grades.list.some(g => g.title === 'Quiz 3.2' && g.score === 18 && g.max === 20), 'grade read: Quiz 3.2 18/20');
ok(r.j.data.grades.avgs['c-calc'] && r.j.data.grades.avgs['c-calc'].pct === 93.5, 'class average attached to the existing AP Calculus BC class');
ok(items.filter(i => i.type === 'absence').length === 2, 'attendance read');
ok(r.j.status.genesis.on && r.j.status.genesis.user === 'student' && !JSON.stringify(r.j).includes('"right"'), 'status shows Genesis connected, never the password');
const dump = JSON.stringify(store.dump());
ok(!dump.includes('"right"') && !dump.includes('correct horse'), 'database has no readable passwords (Genesis or Homeroom)');

section('4. Saved-password site (VHL-like form)');
r = await call('login', { src: 'vhl', loginUrl: 'https://www.vhl.test/login', pageUrl: 'https://www.vhl.test/assignments', user: 'nethra', pass: 'pw' }, owner);
ok(r.j.result && r.j.result.ok, 'signed in to the VHL-like site: ' + (r.j.result && r.j.result.note));
items = r.j.data.items.list;
const vq = items.find(i => /Vocabulario quiz/.test(i.title));
ok(vq && vq.due === '2026-11-20T11:00' && vq.type === 'quiz' && vq.src === 'vhl', 'VHL quiz due Fri 11:00 AM');
r = await call('login', { src: 'albert', loginUrl: 'https://www.vhl.test/login', pageUrl: 'https://www.vhl.test/assignments', user: 'nethra', pass: 'bad' }, owner);
ok(r.status === 200 && r.j.result.ok === false && /didn’t accept/.test(r.j.result.note), 'a failing login is saved with a clear note');
const albertId = r.j.status.logins.find(l => l.src === 'albert').id;
ok((await call('login', { remove: albertId }, owner)).j.status.logins.length === 1, 'remove a saved login');

section('5. Calendar links in, calendar feed out');
r = await call('calimport', { url: 'webcal://cal.test/notcal', name: 'x' }, owner);
ok(r.status === 400 && /isn’t a calendar/.test(r.j.message), 'a non-calendar link is explained');
r = await call('calimport', { url: 'https://cal.test/basic.ics', name: 'Personal' }, owner);
items = r.j.data.items.list;
const rob = items.find(i => i.title === 'Robotics, build night'), tg = items.find(i => i.title === 'Thanksgiving break'), lab = items.find(i => i.title === 'Chem lab practical');
ok(rob && rob.due === '2026-11-19T15:00' && rob.end === '2026-11-19T16:30', 'event with a time zone read at 3:00–4:30 PM');
ok(tg && tg.allDay && tg.due === '2026-11-26T00:00', 'all-day event read');
ok(lab && lab.due === '2026-11-20T09:00', 'UTC event converted to 9:00 AM New York');
ok(/1 repeating skipped/.test(r.j.result.note), 'repeating events are skipped and counted');
r = await call('calfeed', {}, owner);
const feedUrl = r.j.url;
ok(/^https:\/\/hr\.test\/cal\/[A-Za-z0-9_-]{20,}\.ics$/.test(feedUrl), 'calendar subscribe link made');
let fr = await get(new URL(feedUrl).pathname);
let ics = await fr.text();
ok(fr.status === 200 && /text\/calendar/.test(fr.headers.get('content-type')) && ics.startsWith('BEGIN:VCALENDAR'), 'feed serves a calendar');
ok(/SUMMARY:Test: Unit 4 Test · Hon Chemistry/.test(ics) && /DTSTART;VALUE=DATE:20261124/.test(ics), 'Genesis test is an all-day event on Nov 24');
ok(/DTSTART:20261120T160000Z/.test(ics) && /SUMMARY:Quiz: Lección 4 Vocabulario quiz/.test(ics), 'VHL quiz at 11:00 AM New York (16:00 UTC)');
ok(/TRIGGER:-PT960M/.test(ics) && /TRIGGER:-PT240M/.test(ics) && /TRIGGER:-PT60M/.test(ics), 'reminders: 7 PM the night before, 7 AM that morning, 1 hour before');
ok(!/Robotics/.test(ics), 'events from your own calendar aren’t copied back into it');
ok(ics.split('\r\n').every(l => Buffer.byteLength(l) <= 75), 'calendar lines folded to 75 bytes');
ok((await get('/cal/' + 'x'.repeat(30) + '.ics')).status === 404, 'unknown feed link → 404');

section('6. Chrome extension');
r = await call('extkey', {}, owner);
const key = r.j.key;
ok(/^[A-Za-z0-9]{40}$/.test(key) && r.j.url === 'https://hr.test/api/ext', 'extension key and address');
const ext = async body => { const x = await app.handle(new Request(ORIGIN + '/api/ext', { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })); return { status: x.status, j: await x.json(), cors: x.headers.get('access-control-allow-origin') }; };
let e = await ext({ key: 'x'.repeat(40), ping: true });
ok(e.j.ok === false && e.j.error === 'unknown_key' && e.cors === '*', 'unknown key refused (with CORS for the extension)');
ok((await app.handle(new Request(ORIGIN + '/api/ext', { method: 'OPTIONS' }))).status === 204, 'CORS preflight answered');
ok((await ext({ key, ping: true })).j.pong, 'extension test ping');
e = await ext({ key, pages: [{ src: 'deltamath', url: 'https://www.deltamath.com/app/student', title: 'DeltaMath', text: 'Assignments', rows: ['Implicit Differentiation Due Nov 21, 11:59 PM 0/12', 'Related Rates Due 11/18 Complete'] }, { src: 'vhl', url: 'https://www.vhlcentral.com/', loggedOut: true }] });
ok(e.j.ok && e.j.received === 2 && e.j.added >= 2, 'pages accepted and merged right away (' + e.j.added + ' new)');
r = await call('pull', {}, owner);
items = r.j.data.items.list;
ok(items.some(i => i.src === 'deltamath' && i.title === 'Implicit Differentiation' && i.due === '2026-11-21T23:59' && i.status === 'todo'), 'DeltaMath row → assignment due Sat 11:59 PM');
ok(items.some(i => i.src === 'deltamath' && i.title === 'Related Rates' && i.status === 'done'), '“Complete” rows marked done');
ok(r.j.status.ext.sites.vhl && r.j.status.ext.sites.vhl.loggedOut, 'signed-out site reported');

section('7. AI (optional)');
ok((await call('ai', { prompt: 'hi' }, owner)).j.error === 'no_key', 'AI without a key says so');
ok((await call('secret', { name: 'anthropic', value: 'sk-bad' }, owner)).status === 400, 'a bad key is refused');
r = await call('secret', { name: 'anthropic', value: 'sk-good' }, owner);
ok(r.j.status.aiKey, 'a good key is saved');
ok((await call('ai', { system: 'reply with JSON', messages: [{ role: 'user', content: 'plan' }] }, owner)).j.text.includes('Plan ready'), 'AI planner call goes through the server');
await ext({ key, pages: [{ src: 'vhl', url: 'https://www.vhlcentral.com/x', text: 'stuff', rows: ['row'] }] });
r = await call('pull', {}, owner);
ok(r.j.data.items.list.some(i => i.title === 'Lección 4 práctica' && i.src === 'vhl') && r.j.data.state.courses.some(c => c.name === 'Spanish III Honors'), 'extension page read by the AI, new class added');
ok((await call('ai', { prompt: 'x' }, friend)).j.error === 'no_key', 'a friend without a key can’t use the owner’s key unless it’s shared');
await call('owner', { action: 'aiShare', on: true, perDay: 2, key: 'sk-site' }, owner);
r = await call('bootstrap', {}, friend);
ok(r.j.status.aiSite === true, 'owner shares an AI key; the friend sees AI available');
await call('ai', { prompt: '1' }, friend); await call('ai', { prompt: '2' }, friend);
ok((await call('ai', { prompt: '3' }, friend)).status === 429, 'shared AI has a daily limit per person');

section('8. Phone notifications');
r = await call('push', { action: 'key' }, owner);
const pub = r.j.key;
ok(/^[A-Za-z0-9_-]{86,88}$/.test(pub), 'push key for this site');
ok((await call('push', { action: 'key' }, friend)).j.key === pub, 'same push key for everyone');
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const sub = { endpoint: 'https://push.test/abc', keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(crypto.randomBytes(16)) } };
await call('push', { action: 'subscribe', sub }, owner);
await call('push', { action: 'subscribe', sub: Object.assign({}, sub, { endpoint: 'https://push.test/gone' }) }, owner);
r = await call('push', { action: 'test' }, owner);
ok(r.j.sent === 1 && pushes.length === 2 && /^vapid t=/.test(pushes[0].headers.Authorization) && pushes[0].headers['Content-Encoding'] === 'aes128gcm', 'test notification sent, encrypted and signed');
ok(r.j.status.push.n === 1, 'a phone that unsubscribed is forgotten');

section('9. Background timer');
ok((await get('/api/cron?key=nope')).status === 403, 'timer link needs its key');
r = await call('patch', { state: Object.assign({}, baseState, { courses: (await call('pull', {}, owner)).j.data.state.courses }) }, owner);
const before = pushes.length;
clock.t += 31 * 60000; mock.extraAssignment = true;
let cr = await (await get('/api/cron?key=' + app.cronKey)).json();
ok(cr.ran >= 1 && cr.errors === 0, `timer synced students who were due (ran ${cr.ran}, ${cr.ms} ms)`);
r = await call('pull', {}, owner);
ok(r.j.data.grades.list.some(g => g.title === 'Unit 3 Test' && g.score === 47), 'new Genesis grade arrived in the background');
ok(pushes.length > before, 'instant “new grade” notification sent');
cr = await (await get('/api/cron?key=' + app.cronKey)).json();
ok(cr.ran === 0, 'not synced again until it’s due');
clock.t = Date.UTC(2026, 10, 16, 11, 5); // Mon 6:05 AM New York
const p0 = pushes.length;
cr = await (await get('/api/cron?key=' + app.cronKey)).json();
ok(cr.digests >= 1 && pushes.length > p0, 'morning summary sent at 6 AM local time');
cr = await (await get('/api/cron?key=' + app.cronKey, {})).json();
ok(cr.digests === 0, 'only one morning summary a day');

section('10. Keeping your changes');
r = await call('pull', {}, owner);
items = r.j.data.items.list;
const t4 = items.find(i => i.title === 'Unit 4 Test');
t4.pinned = true; t4.notes = 'Study ch 4';
const gone = items.find(i => i.title === 'Ch 6 Problems');
const st = r.j.data.state; st.dismissed = [gone.key];
await call('patch', { items: { upsert: [t4], remove: [gone.id] }, state: st }, owner);
r = await call('sync', {}, owner);
items = r.j.data.items.list;
ok(items.find(i => i.title === 'Unit 4 Test').pinned && items.find(i => i.title === 'Unit 4 Test').notes === 'Study ch 4', 'pins and notes survive a sync');
ok(!items.some(i => i.title === 'Ch 6 Problems'), 'deleted synced items don’t come back');
ok(items.filter(i => i.title === 'Unit 4 Test').length === 1, 'no duplicates after syncing again');

section('11. Password reset, sign out, delete');
ok((await call('reset', { username: 'nethra', recovery: 'AAAA-BBBB-CCCC', password: 'new password 1' })).status === 401, 'wrong recovery code refused');
r = await call('reset', { username: 'nethra', recovery: ownerRecovery.toLowerCase(), password: 'new password 1' });
const owner2 = r.cookie;
ok(r.status === 200 && r.j.recovery && r.j.recovery !== ownerRecovery, 'recovery code resets the password and gives a new code');
ok((await call('bootstrap', {}, owner)).status === 401, 'old sessions are signed out after a reset');
ok((await call('bootstrap', {}, owner2)).status === 200, 'new session works');
ok((await call('signin', { username: 'nethra', password: 'new password 1' })).status === 200, 'new password works');
ok((await call('signout', {}, friend)).status === 200 && (await call('bootstrap', {}, friend)).status === 401, 'sign out ends the session');
const fr2 = (await call('signin', { username: 'friend1', password: 'password123' })).cookie;
ok((await call('deleteaccount', { password: 'nope' }, fr2)).status === 401, 'deleting needs the password');
ok((await call('deleteaccount', { password: 'password123' }, fr2)).status === 200, 'account deleted');
{ const left = Object.keys(store.dump().kv).filter(k => k.includes('friend1') || JSON.stringify(store.dump().kv[k]).includes('friend1')); console.log('    keys mentioning friend1:', left.join(', ')); ok(left.every(k => k.startsWith('hr:rl:')) && (await store.smembers('hr:users')).length === 1, 'all of that student’s data is gone (only short-lived sign-in counters remain)'); }
ok((await call('signin', { username: 'friend1', password: 'password123' })).status === 401, 'deleted account can’t sign in');

section('12. Database budget (free Upstash: 500,000 commands a month)');
let c0 = store.calls; await call('pull', {}, owner2); const pullCost = store.calls - c0;
r = await call('pull', {}, owner2); const one = r.j.data.items.list[0]; one.notes = 'x';
c0 = store.calls; await call('patch', { items: { upsert: [one], remove: [] } }, owner2); const patchCost = store.calls - c0;
clock.t += 31 * 60000;
c0 = store.calls; cr = await app.cron(); const cronCost = store.calls - c0;
c0 = store.calls; cr = await app.cron(); const idleCron = store.calls - c0;
const syncCost = cronCost - idleCron;
const month = 30 * (48 * syncCost + 30 * pullCost + 40 * patchCost);
console.log(`    pull ${pullCost}, save ${patchCost}, background sync ${syncCost}, idle timer run ${idleCron} commands`);
console.log(`    ≈ ${Math.round(month / 1000)}K a month per active student, plus ${Math.round(144 * 30 * idleCron / 1000)}K for the timer every 10 minutes`);
ok(pullCost <= 6 && patchCost <= 10 && syncCost <= 14, 'each action uses only a few database commands');
ok(month < 30000, 'about 15+ active students fit in the free database');

section('13. Rate limits');
let last;
for (let i = 0; i < 9; i++) last = await call('signin', { username: 'nethra', password: 'guess' + i });
ok(last.status === 429, 'too many wrong passwords → wait 15 minutes');

console.log(`\nAI calls made: ${counters.ai}`);
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll server checks passed.');
process.exit(failed ? 1 : 0);
