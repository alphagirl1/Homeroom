// The sync engine: signs in to school sites, reads pages from the Chrome extension and calendar links,
// and merges everything into each student's Homeroom without undoing what they changed themselves.
import { norm, hash, htmlToText, snippet, hasPassword, loginForm, resolveUrl, decodeEntities, rows, headerMap, lineRows,
  titleCase, guessType, findCourse, parseJsonLoose, safeUrl, clone, SWATCH, PLATFORMS, pad } from './util.js';
import { findDates, isoWall, dateWall, wallToEpoch, longDate, schoolYear, parts, validTz, shortWhen } from './time.js';
import { parseIcs } from './ics.js';
import { getDoc, getDocs, putDoc, putDocs, getSecrets, getMeta, getSiteSecrets } from './data.js';
import { withLock } from './store.js';
import { uuid } from './crypto.js';
import { sendPush, makeVapidKeys } from './push.js';

export const GENESIS_DEFAULT = 'https://students.c2.genesisedu.net/mcmsnj/sis/view?gohome=true';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 Homeroom';
export const newIncoming = () => ({ items: [], grades: [], avgs: {}, courses: [], scopes: [], annTexts: [] });
export const tzOf = (state, ctx) => validTz((state && state.prefs && state.prefs.tz) || ctx.tz || 'America/New_York');

/* ------------------------------- web pages ------------------------------- */
export async function http(ctx, url, opts, jar) {
  let hops = 0, method = (opts.method || 'GET').toUpperCase(), cur = url;
  let body = opts.form ? new URLSearchParams(opts.form).toString() : null;
  for (;;) {
    const headers = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' };
    const ck = Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
    if (ck) headers.Cookie = ck;
    if (method === 'POST' && body != null) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const res = await ctx.fetch(cur, { method, headers, body: method === 'POST' ? body : undefined, redirect: 'manual', signal: AbortSignal.timeout(opts.timeout || 20000) });
    const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    for (const c of sc) { const kv = String(c).split(';')[0], i = kv.indexOf('='); if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); }
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc && hops < 8) { cur = resolveUrl(loc, cur); method = 'GET'; body = null; hops++; continue; }
    const html = (await res.text()).slice(0, 4_000_000);
    return { code: res.status, html, url: cur };
  }
}
const fail = (msg, debug) => Object.assign(new Error(msg), { debug: debug || '' });

/* -------------------------------- Genesis -------------------------------- */
// Signs in the way GradeScout does: the portal's j_security_check form, then the gradebook pages.
// Hosted Genesis uses a district code (/mcmsnj) where older installs use /genesis; both work.
export function genesisBase(url) {
  const m = String(url || GENESIS_DEFAULT).trim().match(/^(https?:\/\/[^/?#]+)(\/[^?#]*)?/i);
  if (!m) throw fail('That Genesis link doesn’t look right. Copy the address of the Genesis login page.');
  let path = (m[2] || '').replace(/\/+$/, '');
  const cut = path.search(/\/(sis|parents|students|j_security_check)(\/|$)/i);
  if (cut >= 0) path = path.slice(0, cut);
  else { const gi = path.toLowerCase().indexOf('/genesis'); if (gi >= 0) path = path.slice(0, gi + 8); }
  return m[1] + (path || '/genesis');
}
function genesisModule(base, html) {
  const stu = /students\?(tab1|gohome)=/i.test(html), par = /parents\?(tab1|gohome)=/i.test(html);
  if (stu !== par) return stu ? 'students' : 'parents';
  return /^https?:\/\/students\./i.test(base) ? 'students' : 'parents';
}
const genesisLoginPage = html => /j_security_check/i.test(html) || (hasPassword(html) && !/studentid=\d+/i.test(html));
async function genesisLogin(ctx, cfg) {
  const base = genesisBase(cfg.url || GENESIS_DEFAULT), jar = {};
  const first = await http(ctx, base + '/sis/view?gohome=true', {}, jar);
  const form = loginForm(first.html), payload = {}, tries = [];
  if (form) {
    Object.assign(payload, form.hidden);
    payload[form.userField] = cfg.user; payload[form.passField] = cfg.pass;
    if (form.action) tries.push(resolveUrl(decodeEntities(form.action), first.url || base + '/sis/view'));
  }
  payload.j_username = cfg.user; payload.j_password = cfg.pass;
  for (const u of [base + '/sis/j_security_check', base + '/j_security_check']) if (!tries.includes(u)) tries.push(u);
  const guess = genesisModule(base, first.html);
  const homes = [base + '/' + guess + '?gohome=true', base + '/sis/view?gohome=true', base + '/' + (guess === 'students' ? 'parents' : 'students') + '?gohome=true'];
  let r = null, ok = false, rejected = null;
  for (let i = 0; i < tries.length && !ok; i++) {
    r = await http(ctx, tries[i], { method: 'POST', form: payload }, jar);
    if (r.code < 400 && /invalid|incorrect|failed|not recognized/i.test(r.html) && genesisLoginPage(r.html)) { rejected = r; break; }
    ok = r.code < 400 && /studentid=\d+/i.test(r.html) && !genesisLoginPage(r.html);
    if (!ok && r.code < 400 && !genesisLoginPage(r.html)) {
      for (let h = 0; h < homes.length && !ok; h++) { const home = await http(ctx, homes[h], {}, jar); if (/studentid=\d+/i.test(home.html) && !genesisLoginPage(home.html)) { r = home; ok = true; } }
    }
  }
  if (!ok) throw fail(rejected ? 'Genesis didn’t accept that username or password.' : 'Couldn’t sign in to Genesis. Check the link, username and password.', 'base: ' + base + '\n' + snippet((rejected || r || {}).html));
  const ids = []; const re = /studentid=(\d+)/gi; let m;
  while ((m = re.exec(r.html))) if (!ids.includes(m[1])) ids.push(m[1]);
  return { base, jar, mod: genesisModule(base, r.html), sid: cfg.studentId && ids.includes(cfg.studentId) ? cfg.studentId : ids[0], home: r.html };
}
function genesisCourse(state, inc, name, teacher) {
  name = String(name || '').replace(/\s+/g, ' ').trim();
  const hit = findCourse(state, name) || inc.courses.find(c => norm(c.name) === norm(name));
  if (hit) return hit.id;
  const c = { id: 'ge-' + hash(norm(name)), name: titleCase(name), teacher: String(teacher || '').replace(/\s+/g, ' ').trim(), src: ['genesis'] };
  inc.courses.push(c);
  return c.id;
}
export async function syncGenesis(ctx, cfg, state, tz, inc) {
  const s = await genesisLogin(ctx, cfg), base = s.base + '/' + s.mod + '?tab1=studentdata&action=form&studentid=' + s.sid;
  const [sum, list, att] = await Promise.all([
    http(ctx, base + '&tab2=gradebook&tab3=weeklysummary', {}, s.jar),
    http(ctx, base + '&tab2=gradebook&tab3=listassignments&dateRange=allMP&courseAndSection=&status=', { timeout: 30000 }, s.jar),
    http(ctx, base + '&tab2=attendance&tab3=daily', {}, s.jar),
  ]);
  const dbg = ['home: ' + snippet(s.home), 'summary: ' + snippet(sum.html), 'assignments: ' + snippet(list.html), 'attendance: ' + snippet(att.html)];
  const now = ctx.now();
  for (const c of rows(sum.html)) {
    const pctCell = c.map(x => x.text).find(t => /\d{1,3}(?:\.\d+)?%/.test(t));
    const name = (c[0] && (c[0].divs[0] || c[0].text)) || '';
    if (!pctCell || !name || name.length > 80) continue;
    inc.avgs[genesisCourse(state, inc, name, c[0].divs[1] || '')] = { pct: Number(pctCell.match(/(\d{1,3}(?:\.\d+)?)%/)[1]), letter: null, asOf: now, src: 'genesis' };
  }
  const head = headerMap(list.html); let n = 0, seenRows = 0;
  for (const c of rows(list.html)) {
    if (c.length < 5) continue;
    seenRows++;
    const get = (k, d) => c[head[k] !== undefined ? head[k] : d] || { text: '', divs: [], bold: '' };
    const courseCell = get('course', 2), title = get('title', 4).bold || get('title', 4).text, dueText = get('due', 1).text, gradeText = get('grade', 5).text, cat = get('cat', 3).text;
    if (!title) continue;
    const cname = courseCell.divs[0] || courseCell.text, cid = genesisCourse(state, inc, cname, courseCell.divs[1] || '');
    const dd = findDates(dueText, now, tz)[0], due = dd ? dd.iso.slice(0, 10) + 'T23:59' : null;
    const sc = gradeText.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
    inc.items.push({ key: 'ge:' + norm(cname).slice(0, 30) + ':' + norm(title).slice(0, 50) + ':' + (due || '').slice(0, 10), src: 'genesis', course: cid, title: title.slice(0, 140),
      type: guessType(title + ' ' + cat), due, allDay: due ? true : undefined, status: sc ? 'done' : 'todo', missing: /missing/i.test(gradeText) || undefined,
      score: sc ? Number(sc[1]) : undefined, max: sc ? Number(sc[2]) : undefined, url: cfg.url || GENESIS_DEFAULT, origin: 'sync' });
    if (sc && Number(sc[2]) > 0) inc.grades.push({ key: 'ge:' + norm(cname).slice(0, 30) + ':' + norm(title).slice(0, 60), course: cid, title: title.slice(0, 120), cat: cat || null, score: Number(sc[1]), max: Number(sc[2]), date: due ? due.slice(0, 10) : dateWall(now, tz), src: 'genesis' });
    n++;
  }
  for (const c of rows(att.html)) {
    const line = c.map(x => x.text).join(' ');
    const kind = (line.match(/\b(absent[^|]{0,30}|tardy[^|]{0,20}|early dismissal|dismissed early)\b/i) || [])[0];
    const dm = line.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
    if (!kind || !dm) continue;
    const y = Number(dm[3]) < 100 ? 2000 + Number(dm[3]) : Number(dm[3]), iso = y + '-' + pad(dm[1]) + '-' + pad(dm[2]);
    inc.items.push({ key: 'gea:' + iso + ':' + norm(kind).slice(0, 20), src: 'genesis', type: 'absence', title: kind.replace(/\s+/g, ' ').trim(), due: iso + 'T08:00', allDay: true, origin: 'sync' });
  }
  inc.scopes.push({ prefix: 'ge:' });
  const avgs = Object.keys(inc.avgs).length;
  return { n, student: s.sid, note: n + ' assignments' + (avgs ? ', ' + avgs + ' class averages' : '') + (seenRows ? '' : ' (no assignment table found)'), debug: dbg.join('\n\n').slice(0, 9000) };
}

/* ----------------------- saved username + password sites ----------------------- */
export async function runFormLogin(ctx, cfg, pass, state, tz, inc, ai) {
  const jar = {}, page = await http(ctx, cfg.loginUrl, {}, jar), form = loginForm(page.html);
  if (!form) throw fail('No login form on that page. This site signs in with JavaScript, so use the Chrome extension for it.', snippet(page.html));
  const fields = Object.assign({}, form.hidden, { [form.userField]: cfg.user, [form.passField]: pass });
  const after = await http(ctx, resolveUrl(form.action || page.url, page.url), { method: form.method === 'get' ? 'GET' : 'POST', form: fields }, jar);
  if (hasPassword(after.html)) throw fail('The site didn’t accept the login (wrong password, a CAPTCHA, or it needs JavaScript). Use the Chrome extension for it.', snippet(after.html));
  const target = await http(ctx, cfg.pageUrl || cfg.loginUrl, {}, jar);
  if (hasPassword(target.html)) throw fail('Signed in, but the assignments page asked to sign in again. Use the Chrome extension for this site.', snippet(target.html));
  const parsed = await parsePage(ctx, cfg.src, htmlToText(target.html), lineRows(target.html), state, tz, ai);
  for (const it of parsed.items) { it.key = it.key || 'pw:' + cfg.src + ':' + norm(it.title).slice(0, 60) + ':' + String(it.due || '').slice(0, 10); it.origin = 'sync'; it.url = it.url || cfg.pageUrl; inc.items.push(it); }
  inc.grades.push(...parsed.grades); inc.courses.push(...parsed.courses);
  return { n: parsed.items.length, note: parsed.items.length + ' items found', debug: snippet(target.html) };
}

/* ------------------------- reading a page's schoolwork ------------------------- */
function courseFor(state, out, name) {
  const hit = findCourse(state, name) || out.courses.find(c => norm(c.name) === norm(name));
  if (hit) return hit.id;
  const c = { id: 'x-' + hash(norm(name)), name: String(name).slice(0, 60), teacher: '', src: [] };
  out.courses.push(c); return c.id;
}
function importPrompt(src, text, lines, state, tz, now) {
  const y = schoolYear(8, parts(now, tz));
  return 'You are reading a page from ' + src + ' that lists a high-school student’s schoolwork. Extract every assignment, grade, announcement and absence it shows.\n' +
    'Today is ' + longDate(now, tz) + ' (' + tz + '). The school year runs Sep ' + y + ' to Jun ' + (y + 1) + '; for dates without a year, pick the year inside that school year.\n' +
    'The student’s classes: ' + (((state && state.courses) || []).map(c => c.name).join('; ') || 'unknown') + '. Use one of these names for "course" when it clearly matches.\n' +
    'Reply with only JSON: {"items":[{"kind":"assignment"|"announcement"|"absence","title":string,"course":string|null,"type":"assignment"|"test"|"quiz"|"project"|"lab"|"event","due":"YYYY-MM-DDTHH:MM" or null,"status":"todo"|"done"|"missing","score":number|null,"max":number|null,"url":string|null,"body":string|null}],"grades":[{"course":string,"title":string,"category":string|null,"score":number,"max":number,"date":"YYYY-MM-DD"|null}]}\n' +
    'A due time of 11:59 PM is "23:59". Leave out menus and anything that is not schoolwork.\nROWS:\n' + (lines || []).slice(0, 250).join('\n').slice(0, 30000) + '\nPAGE TEXT:\n' + String(text || '').slice(0, 25000);
}
/** Turns a page into items: Claude when an AI key is available, otherwise a date and score reader. */
export async function parsePage(ctx, src, text, lines, state, tz, ai) {
  const out = { items: [], grades: [], courses: [] }, now = ctx.now();
  if (ai) {
    try {
      const res = parseJsonLoose(await ai([{ role: 'user', content: importPrompt(src, text, lines, state, tz, now) }], { max: 3500, model: 'claude-haiku-5-5' })) || {};
      for (const r of res.items || []) {
        if (!r || !r.title) continue;
        const cid = r.course ? courseFor(state, out, r.course) : undefined, kind = r.kind === 'announcement' ? 'announcement' : r.kind === 'absence' ? 'absence' : null;
        const due = r.due && wallToEpoch(String(r.due), tz) ? String(r.due).slice(0, 16) : null;
        out.items.push({ src, course: cid, title: String(r.title).slice(0, 140), type: kind || (['assignment', 'test', 'quiz', 'project', 'lab', 'event'].includes(r.type) ? r.type : guessType(r.title)),
          due: kind === 'announcement' ? undefined : due, posted: kind === 'announcement' ? isoWall(now, tz) : undefined,
          status: r.status === 'done' ? 'done' : 'todo', missing: r.status === 'missing' || undefined,
          score: Number.isFinite(r.score) ? Number(r.score) : undefined, max: Number.isFinite(r.max) ? Number(r.max) : undefined,
          url: safeUrl(r.url) || undefined, body: r.body ? String(r.body).slice(0, 3000) : undefined, read: kind === 'announcement' ? false : undefined });
      }
      for (const g of res.grades || []) if (g && g.title && Number.isFinite(g.score) && g.max > 0 && g.course) out.grades.push({ course: courseFor(state, out, g.course), title: String(g.title).slice(0, 120), cat: g.category || null, score: Number(g.score), max: Number(g.max), date: g.date || dateWall(now, tz), src });
      return out;
    } catch (e) { if (ctx.log) ctx.log('AI page reading failed, using the simple reader:', e.message); }
  }
  const L = (lines && lines.length ? lines : String(text || '').split(/\n+/)).map(s => String(s).replace(/\s+/g, ' ').trim()).filter(Boolean);
  L.forEach((line, i) => {
    const ds = findDates(line, now, tz).filter(d => Math.abs(d.epoch - now) < 200 * 864e5);
    if (!ds.length) return;
    let title = line.replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?/ig, '').replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, '')
      .replace(/\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/ig, '').replace(/\b(due|assigned|on|by|at|sunday|monday|tuesday|wednesday|thursday|friday|saturday|today|tonight|tomorrow)\b:?/ig, ' ')
      .replace(/\b\d+\s*\/\s*\d+\b/g, ' ').replace(/[|•\t–—-]+/g, ' ').replace(/\b(complete|completed|submitted|turned in|not started|in progress|missing|past due|late)\b/ig, ' ').replace(/\s+/g, ' ').replace(/\s+([,;:])/g, '$1').replace(/^[\s,;:.]+|[\s,;:.(]+$/g, '').trim();
    if (title.length < 3) title = L[i - 1] || 'Assignment';
    out.items.push({ src, title: title.slice(0, 140), type: guessType(title), due: ds[0].iso,
      status: /\b(complete|completed|submitted|turned in|done|100%)\b/i.test(line) ? 'done' : 'todo', missing: /\b(missing|past due|late)\b/i.test(line) || undefined });
  });
  return out;
}

/* --------------------------- calendar links (.ics) --------------------------- */
export async function syncCalLink(ctx, cal, url, state, tz, inc) {
  const res = await ctx.fetch(url.replace(/^webcal:/i, 'https:'), { headers: { 'User-Agent': UA, Accept: 'text/calendar,*/*' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw fail('The calendar link answered ' + res.status + '. Check that it’s the secret or public iCal address.');
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) throw fail('That link isn’t a calendar (.ics) file. In Google Calendar use “Secret address in iCal format”.');
  const { events, skippedRepeats } = parseIcs(text, tz);
  const now = ctx.now(), from = now - 14 * 864e5, to = now + 150 * 864e5, prefix = 'ics:' + cal.id + ':';
  let n = 0;
  for (const e of events) {
    const at = wallToEpoch(e.start, tz);
    if (at == null || at < from || at > to) continue;
    const isClass = /classroom/i.test(cal.name || '') || /classroom\.google\.com/i.test((e.url || '') + ' ' + (e.desc || ''));
    const title = e.title.slice(0, 140);
    inc.items.push({ key: prefix + (e.uid || hash(e.title + e.start)) + ':' + e.start.slice(0, 10), src: isClass ? 'classroom' : 'gcal', title,
      type: isClass ? guessType(title) : (/\b(test|exam|quiz)\b/i.test(title) ? guessType(title) : 'event'), course: isClass ? (findCourse(state, cal.name) || {}).id : undefined,
      due: e.start, end: e.end, allDay: e.allDay, url: safeUrl(e.url) || undefined, notes: e.desc ? e.desc.slice(0, 300) : undefined, origin: 'sync' });
    n++;
  }
  inc.scopes.push({ prefix, from, to });
  return { n, note: n + ' events' + (skippedRepeats ? ` (${skippedRepeats} repeating skipped)` : '') };
}

/* ------------------- announcements: dates for the student to approve ------------------- */
async function announcementDates(ctx, inc, state, tz, sync, ai) {
  if (!inc.annTexts.length) return;
  sync.scanned = sync.scanned || [];
  const fresh = inc.annTexts.filter(a => !sync.scanned.includes(a.key)).slice(0, 12);
  if (!fresh.length) return;
  const now = ctx.now();
  if (ai) {
    try {
      const prompt = 'For each class announcement below, list the dates a high-school student should put on their calendar (tests, quizzes, due dates, events, extra help, schedule changes). Today is ' + longDate(now, tz) + '.\n' +
        'Reply with only a JSON object mapping each announcement key to an array of {"title":string,"type":"test"|"quiz"|"project"|"assignment"|"event","due":"YYYY-MM-DDTHH:MM"}. Use 08:00 for in-class tests and 23:59 for deadlines with no time. Use [] when there are none.\n' +
        JSON.stringify(fresh.map(a => ({ key: a.key, posted: a.posted, text: a.text.slice(0, 2500) })));
      const res = parseJsonLoose(await ai([{ role: 'user', content: prompt }], { max: 2500, model: 'claude-haiku-5-5' })) || {};
      for (const a of fresh) (Array.isArray(res[a.key]) ? res[a.key] : []).forEach((d, i) => {
        if (d && d.title && wallToEpoch(String(d.due || ''), tz)) inc.items.push({ key: 'annp:' + a.key + ':' + i, src: a.src, course: a.course, type: ['test', 'quiz', 'project', 'assignment'].includes(d.type) ? d.type : 'event', title: String(d.title).slice(0, 140), due: String(d.due).slice(0, 16), proposed: true, origin: 'ai', fromAnnKey: a.key, url: a.url });
      });
      sync.scanned = sync.scanned.concat(fresh.map(a => a.key)).slice(-400);
      return;
    } catch {}
  }
  for (const a of fresh) {
    let i = 0;
    for (const sen of String(a.text).split(/(?<=[.!?])\s+|\n+/)) {
      if (!/\b(test|quiz|exam|due|project|essay|presentation|seminar|lab|deadline|field trip|extra help|review|dbq|leq|frq|turn in|submit)\b/i.test(sen)) continue;
      const ds = findDates(sen, wallToEpoch(a.posted, tz) || now, tz);
      if (!ds.length) continue;
      const type = /\b(test|exam)\b/i.test(sen) ? 'test' : /\bquiz\b/i.test(sen) ? 'quiz' : /\b(project|essay|presentation|dbq|leq)\b/i.test(sen) ? 'project' : /\b(due|turn in|submit)\b/i.test(sen) ? 'assignment' : 'event';
      inc.items.push({ key: 'annp:' + a.key + ':' + (i++), src: a.src, course: a.course, type, title: sen.replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '').slice(0, 90), due: ds[0].iso, proposed: true, origin: 'ai', fromAnnKey: a.key, url: a.url });
    }
    sync.scanned.push(a.key);
  }
  sync.scanned = sync.scanned.slice(-400);
}

/* ------------------------------------ AI ------------------------------------ */
export async function aiFor(ctx, uid, sec) {
  if (sec && sec.anthropic) return { key: sec.anthropic, own: true };
  const meta = await getMeta(ctx);
  if (!meta.aiShare || !meta.aiShare.on) return null;
  const site = await getSiteSecrets(ctx);
  return site.anthropic ? { key: site.anthropic, own: false, perDay: meta.aiShare.perDay || 40 } : null;
}
export function claudeCaller(ctx, uid, access) {
  if (!access) return null;
  return async (messages, o = {}) => {
    if (!access.own) {
      const n = await ctx.store.incr(`hr:aiuse:${uid}:${dateWall(ctx.now(), ctx.tz)}`, 2 * 86400);
      if (n > access.perDay) throw Object.assign(new Error('AI_LIMIT'), { code: 'ai_limit' });
    }
    const body = { model: o.model || 'claude-haiku-5-5', max_tokens: o.max || 1500, messages };
    if (o.system) body.system = o.system;
    const res = await ctx.fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': access.key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body), signal: AbortSignal.timeout(o.timeout || 50000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('AI ' + res.status + ': ' + ((j.error && j.error.message) || 'request failed'));
    return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  };
}

/* -------------------------------- merging -------------------------------- */
const USER_FIELDS = ['status', 'notes', 'pinned', 'hidden', 'read', 'gcalAdded', 'userEdited', 'doneAt'];
const sameDay = (a, b) => !a || !b || String(a).slice(0, 10) === String(b).slice(0, 10);
export function mergeIncoming(docs, inc, tz, now) {
  const state = docs.state || {}, list = docs.items.list, gdoc = docs.grades;
  const dismissed = new Set(state.dismissed || []);
  const out = { added: 0, updated: 0, newGrades: [], newItems: [], newMissing: [], newAnns: [] };
  state.courses = state.courses || [];
  for (const c of inc.courses) {
    const ex = state.courses.find(x => x.id === c.id);
    if (!ex) { state.courses.push(Object.assign({ color: SWATCH[state.courses.length % SWATCH.length], scheme: 'points', cats: [] }, c)); }
    else if (!ex.teacher && c.teacher) ex.teacher = c.teacher;
  }
  const byKey = new Map(), byLoose = new Map();
  for (const it of list) { if (it.key) byKey.set(it.key, it); const lk = it.src + ':' + norm(it.title).slice(0, 60); if (!byLoose.has(lk)) byLoose.set(lk, []); byLoose.get(lk).push(it); }
  const seen = new Set();
  for (const raw of inc.items) {
    if (!raw || !raw.title || (raw.key && dismissed.has(raw.key))) continue;
    seen.add(raw.key);
    let ex = raw.key && byKey.get(raw.key);
    if (!ex && raw.type !== 'announcement') ex = (byLoose.get(raw.src + ':' + norm(raw.title).slice(0, 60)) || []).find(c => sameDay(c.due, raw.due) && !(c.key && /^ics:/.test(c.key) && /^ics:/.test(raw.key || '')));
    if (ex) {
      if (ex.userEdited) {
        if (raw.status === 'done' && ex.status !== 'done') { ex.status = 'done'; out.updated++; }
        if (raw.score != null && ex.score == null) { ex.score = raw.score; ex.max = raw.max; out.updated++; }
        continue;
      }
      const before = JSON.stringify(ex), keep = {}, wasMissing = !!ex.missing;
      for (const f of USER_FIELDS) if (ex[f] !== undefined) keep[f] = ex[f];
      for (const [k, v] of Object.entries(raw)) if (v !== undefined) ex[k] = v;
      Object.assign(ex, keep);
      if (raw.status === 'done') ex.status = 'done';
      if (!raw.missing && raw.key) delete ex.missing;
      ex.key = ex.key || raw.key;
      if (JSON.stringify(ex) !== before) { ex.updated = now; out.updated++; if (ex.missing && !wasMissing) out.newMissing.push(ex); }
    } else {
      const n = clone(raw); n.id = 'i-' + uuid().slice(0, 12); n.created = now; n.status = n.status || 'todo';
      for (const k of Object.keys(n)) if (n[k] === undefined) delete n[k];
      list.push(n); if (n.key) byKey.set(n.key, n); out.added++;
      if (n.type === 'announcement') out.newAnns.push(n); else if (!n.proposed) { out.newItems.push(n); if (n.missing) out.newMissing.push(n); }
    }
  }
  for (const sc of inc.scopes) {
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (!it.key || !it.key.startsWith(sc.prefix) || seen.has(it.key) || it.userEdited) continue;
      const d = wallToEpoch(it.due || it.posted || '', tz);
      if (sc.from && d && (d < sc.from || d > sc.to)) continue;
      list.splice(i, 1); out.updated++;
    }
  }
  const gl = gdoc.list, gByKey = new Map(gl.map(g => [g.key || (g.course + ':' + norm(g.title).slice(0, 60)), g]));
  for (const g of inc.grades) {
    const key = g.key || (g.course + ':' + norm(g.title).slice(0, 60)), ex = gByKey.get(key);
    if (ex) { if (ex.score !== g.score || ex.max !== g.max) { ex.score = g.score; ex.max = g.max; ex.updated = now; out.newGrades.push(ex); } if (!ex.cat && g.cat) ex.cat = g.cat; }
    else { const ng = Object.assign(clone(g), { id: 'g-' + uuid().slice(0, 12), key, created: now }); gl.push(ng); gByKey.set(key, ng); out.newGrades.push(ng); }
  }
  gdoc.avgs = Object.assign(gdoc.avgs || {}, inc.avgs);
  docs.state = state;
  return out;
}
export function pruneItems(list, tz, now) {
  const cutoff = now - 150 * 864e5;
  for (let i = list.length - 1; i >= 0; i--) {
    const it = list[i];
    if (it.pinned || (it.status !== 'done' && it.type !== 'announcement' && it.type !== 'absence')) continue;
    const d = wallToEpoch(it.due || it.posted || '', tz);
    if (d && d < cutoff) list.splice(i, 1);
  }
}

/* ------------------------------ notifications ------------------------------ */
/** The site's push keys, made once and shared by every student's phone. */
export async function getVapid(ctx, create) {
  let s = await ctx.store.get('hr:vapid');
  if (!s && create) {
    const k = makeVapidKeys();
    await ctx.store.set('hr:vapid', JSON.stringify({ publicKey: k.publicKey, privateKey: ctx.seal.seal(k.privateKey, 'vapid') }), { nx: true });
    s = await ctx.store.get('hr:vapid');
  }
  if (!s) return null;
  const v = JSON.parse(s);
  return { publicKey: v.publicKey, privateKey: ctx.seal.open(v.privateKey, 'vapid') };
}
export async function notify(ctx, uid, sync, message) {
  const subs = sync.push || [];
  if (!subs.length) return 0;
  const keys = await getVapid(ctx, false);
  if (!keys) return 0;
  let sent = 0; const keep = [];
  for (const sub of subs) {
    const r = await sendPush(sub, message, keys, ctx.site || 'https://homeroom.vercel.app', ctx.fetch);
    if (r.ok) sent++;
    if (!r.gone) keep.push(sub);
  }
  sync.push = keep;
  return sent;
}
export function instantMessage(state, m, tz) {
  const on = (state.prefs && state.prefs.instant) || {}, lines = [], name = {};
  (state.courses || []).forEach(c => { name[c.id] = c.name; });
  if (on.grades) m.newGrades.slice(0, 8).forEach(g => lines.push(`New grade: ${g.title} ${g.score}/${g.max}${name[g.course] ? ' (' + name[g.course] + ')' : ''}`));
  if (on.missing) m.newMissing.slice(0, 8).forEach(i => lines.push(`Marked missing: ${i.title}${name[i.course] ? ' (' + name[i.course] + ')' : ''}`));
  if (on.assignments) m.newItems.slice(0, 10).forEach(i => lines.push(`New: ${i.title}${i.due ? ', due ' + shortWhen(i.due, { allDay: i.allDay }) : ''}`));
  if (on.announcements) m.newAnns.slice(0, 5).forEach(a => lines.push(`Announcement${name[a.course] ? ' in ' + name[a.course] : ''}: ${a.title}`));
  if (!lines.length) return null;
  return { title: lines[0].slice(0, 90), body: lines.length > 1 ? lines.slice(1, 5).join('\n') + (lines.length > 5 ? `\n+${lines.length - 5} more` : '') : 'Open Homeroom to see it.', url: '/#today', tag: 'homeroom-new' };
}
export function digestMessage(state, items, grades, sync, tz, now) {
  const open = items.filter(i => i.status !== 'done' && !i.proposed && !i.hidden && i.type !== 'announcement' && i.type !== 'absence' && i.due && wallToEpoch(i.due, tz));
  const today = dateWall(now, tz), tom = dateWall(now + 864e5, tz);
  const late = open.filter(i => wallToEpoch(i.due, tz) < now), dueToday = open.filter(i => wallToEpoch(i.due, tz) >= now && i.due.slice(0, 10) === today), dueTom = open.filter(i => i.due.slice(0, 10) === tom);
  const since = sync.lastDigest || now - 864e5, newGrades = grades.filter(g => (g.created || 0) > since || (g.updated || 0) > since).length;
  const bits = [late.length && `${late.length} overdue`, dueToday.length && `${dueToday.length} due today`, dueTom.length && `${dueTom.length} due tomorrow`, newGrades && `${newGrades} new grade${newGrades === 1 ? '' : 's'}`].filter(Boolean);
  if (!bits.length) return null;
  const first = (state.profile && state.profile.name || '').split(' ')[0];
  const top = late.concat(dueToday, dueTom).slice(0, 4).map(i => `• ${i.title}${i.due ? ' (' + shortWhen(i.due, { allDay: i.allDay }) + ')' : ''}`);
  return { title: `Good morning${first ? ', ' + first : ''}: ${bits.join(', ')}`, body: top.join('\n') || 'Open Homeroom to plan your day.', url: '/#today', tag: 'homeroom-digest' };
}

/* --------------------------------- the sync --------------------------------- */
export function friendlyError(e) {
  const m = String(e && e.message || e);
  if (/abort|timed? ?out|ETIMEDOUT|ECONNRESET|ENOTFOUND|fetch failed/i.test(m)) return 'Couldn’t reach the site. It will try again next time.';
  return m.slice(0, 240);
}
async function drainPages(ctx, uid, box0, state, tz, inc, sync, ai) {
  if (!box0 || !box0.pages || !box0.pages.length) return 0;
  const box = await withLock(ctx.store, 'inbox:' + uid, async () => { const b = await getDoc(ctx, uid, 'inbox'); if (b.pages.length) await putDoc(ctx, uid, 'inbox', { pages: [] }); return b; }, { ttl: 10000 });
  if (!box.pages.length) return 0;
  sync.extSites = sync.extSites || {};
  let n = 0;
  await Promise.all(box.pages.map(async pg => {
    const src = PLATFORMS.includes(pg.src) ? pg.src : 'personal';
    if (pg.loggedOut) { sync.extSites[src] = { at: pg.at, loggedOut: true, url: pg.url }; return; }
    const parsed = await parsePage(ctx, src, pg.text, pg.rows || [], state, tz, ai);
    for (const it of parsed.items) { it.key = it.key || 'ext:' + src + ':' + norm(it.title).slice(0, 60) + ':' + String(it.due || '').slice(0, 10); it.origin = 'extension'; it.url = it.url || pg.url; inc.items.push(it); }
    inc.grades.push(...parsed.grades); inc.courses.push(...parsed.courses);
    sync.extSites[src] = { at: pg.at, n: parsed.items.length, url: pg.url };
    n++;
  }));
  return n;
}

/** Syncs one student. why: 'manual' | 'cron' | 'open' | 'extension' */
export async function syncUser(ctx, uid, why, only = null) {
  const d0 = await getDocs(ctx, uid, ['state', 'items', 'grades', 'sync', 'inbox']);
  const state = d0.state;
  if (!state || !state.profile || !state.profile.onboarded) return { skipped: 'Finish setting up Homeroom first.' };
  const tz = tzOf(state, ctx), sec = await getSecrets(ctx, uid), sync = d0.sync;
  const ai = claudeCaller(ctx, uid, await aiFor(ctx, uid, sec));
  const inc = newIncoming(), res = {}, now = ctx.now();
  sync.sources = sync.sources || {};
  const run = async (name, fn) => {
    try { const r = (await fn()) || {}; sync.sources[name] = { ok: true, at: ctx.now(), n: r.n || 0, note: r.note || '' }; res[name] = r; return r; }
    catch (e) { sync.sources[name] = { ok: false, at: ctx.now(), error: friendlyError(e) }; res[name] = { error: String(e.message || e), debug: e.debug }; return null; }
  };
  const jobs = [];
  const want = k => !only || only === k || (only === 'login' && k.startsWith('login:')) || (only === 'cal' && k.startsWith('cal:'));
  if (sec.genesis && want('genesis')) jobs.push(run('genesis', async () => {
    const r = await syncGenesis(ctx, sec.genesis, state, tz, inc);
    sync.genesis = Object.assign(sync.genesis || {}, { last: ctx.now(), note: r.note, debug: r.debug, student: r.student, ok: true });
    return r;
  }).then(r => { if (!r && sync.genesis) { sync.genesis.ok = false; sync.genesis.note = sync.sources.genesis.error; sync.genesis.debug = res.genesis && res.genesis.debug; } }));
  for (const l of sync.logins || []) {
    const pass = sec.logins && sec.logins[l.id];
    if (!pass || !want('login:' + l.id)) continue;
    if (why === 'cron' && (l.fails || 0) >= 3) continue; // stop retrying a failing login so the site doesn't lock the account
    jobs.push(run('login:' + l.src, () => runFormLogin(ctx, l, pass, state, tz, inc, ai))
      .then(r => { l.last = ctx.now(); l.ok = !!r; l.fails = r ? 0 : (l.fails || 0) + 1; l.note = r ? r.note : sync.sources['login:' + l.src].error; l.debug = r ? r.debug : (res['login:' + l.src] || {}).debug; }));
  }
  for (const c of sync.cals || []) {
    const url = sec.cals && sec.cals[c.id];
    if (!url || !want('cal:' + c.id)) continue;
    jobs.push(run('cal:' + c.id, () => syncCalLink(ctx, c, url, state, tz, inc)).then(r => { c.last = ctx.now(); c.ok = !!r; c.note = r ? r.note : sync.sources['cal:' + c.id].error; }));
  }
  if (!only || only === 'extension') jobs.push(drainPages(ctx, uid, d0.inbox, state, tz, inc, sync, ai).then(n => { if (n) sync.sources.extension = { ok: true, at: ctx.now(), n, note: 'pages from the Chrome extension' }; }));
  await Promise.all(jobs);
  for (const it of inc.items) if (it.type === 'announcement' && it.body) inc.annTexts.push({ key: it.key, text: it.body, posted: it.posted || isoWall(now, tz), course: it.course, url: it.url, src: it.src });
  await announcementDates(ctx, inc, state, tz, sync, ai).catch(() => {});

  // Would this change anything? (Most background runs find nothing new, so they skip rewriting the big documents.)
  const probe = { state: clone(d0.state), items: clone(d0.items), grades: clone(d0.grades) }, was = JSON.stringify([probe.state, probe.items, probe.grades]);
  mergeIncoming(probe, inc, tz, ctx.now()); pruneItems(probe.items.list, tz, ctx.now());
  const changed = JSON.stringify([probe.state, probe.items, probe.grades]) !== was;

  const summary = await withLock(ctx.store, 'u:' + uid, async () => {
    const d = await getDocs(ctx, uid, changed ? ['state', 'items', 'grades', 'sync'] : ['sync']);
    let m = { added: 0, updated: 0, newGrades: [], newItems: [], newMissing: [], newAnns: [] };
    const out = {};
    if (changed) {
      const before = JSON.stringify([d.state, d.items, d.grades]);
      m = mergeIncoming(d, inc, tz, ctx.now());
      pruneItems(d.items.list, tz, ctx.now());
      if (JSON.stringify([d.state, d.items, d.grades]) !== before) Object.assign(out, { state: d.state, items: d.items, grades: d.grades });
    }
    // Keep anything that changed on the sync record meanwhile (a new phone, a login added), then add this run's results.
    const fresh = d.sync;
    fresh.sources = Object.assign(fresh.sources || {}, sync.sources);
    if (sync.genesis && fresh.genesis) Object.assign(fresh.genesis, pick(sync.genesis, ['last', 'note', 'debug', 'student', 'ok']));
    fresh.extSites = Object.assign(fresh.extSites || {}, sync.extSites || {});
    if (sync.scanned) fresh.scanned = sync.scanned;
    for (const k of ['logins', 'cals']) for (const x of fresh[k] || []) { const y = (sync[k] || []).find(z => z.id === x.id); if (y) Object.assign(x, pick(y, ['last', 'ok', 'note', 'debug', 'fails'])); }
    fresh.lastSync = ctx.now();
    const msg = why === 'cron' && fresh.firstDone ? instantMessage(changed ? d.state : state, m, tz) : null;
    if (msg) await notify(ctx, uid, fresh, msg);
    fresh.firstDone = true;
    out.sync = fresh; out.sched = schedFor(changed ? d.state : state, fresh, tz);
    await putDocs(ctx, uid, out);
    return m;
  });
  return { at: ctx.now(), added: summary.added, updated: summary.updated, sources: Object.keys(res), results: res };
}
const pick = (o, ks) => { const r = {}; for (const k of ks) if (o[k] !== undefined) r[k] = o[k]; return r; };

/** A tiny per-student record the timer reads for everyone at once. */
export function schedFor(state, sync, tz) {
  const p = (state && state.prefs) || {};
  return { auto: p.autoSync !== false, every: [15, 30, 60].includes(+p.syncMinutes) ? +p.syncMinutes : 30, tz: tz || validTz(p.tz || 'America/New_York'), digest: p.digest !== false,
    hour: Number.isFinite(+p.digestHour) ? +p.digestHour : 6, lastSync: (sync && sync.lastSync) || 0, lastDigestDay: (sync && sync.lastDigestDay) || '', ready: !!(state && state.profile && state.profile.onboarded) };
}
