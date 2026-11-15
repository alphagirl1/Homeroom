/* =====================================================================
   Homeroom: logic (status, filters, crunch detection, grade math,
   sample data, importers)
   ===================================================================== */

function dueOf(it){ return parseDate(it.due); }
function dueState(it){
  if (it.status === 'done') return 'done';
  const d = dueOf(it);
  if (!d) return 'none';
  const ms = d - Date.now();
  if (ms < 0) return 'overdue';
  if (ms < Math.max(P().remindHours, 1) * HOUR) return 'soon';
  if (ms < 3 * DAY) return 'near';
  return 'later';
}
function dueLabel(it){
  const d = dueOf(it); if (!d) return 'No due date';
  const day = relDay(d);
  if (it.allDay) return day;
  if (it.end && it.type === 'event' || it.type === 'study') { const e = parseDate(it.end); return `${day} · ${fmtTime(d)}${e ? '–' + fmtTime(e) : ''}`; }
  return `${day} · ${fmtTime(d)}`;
}
function statusKeys(it){
  const k = [];
  if (it.status === 'done') k.push('done');
  else {
    if (it.missing) k.push('missing');
    const d = dueOf(it);
    if (!d) k.push('nodate'); else if (d < Date.now()) k.push('overdue'); else k.push('upcoming');
  }
  return k;
}
const isTask = it => !['announcement','absence'].includes(it.type) && !it.proposed;
const isDated = it => !!dueOf(it) && !['announcement'].includes(it.type);

function activeFilters(){ const f = D.state.filters; return ['src','types','status','courses'].filter(g => f[g].length).length; }
function passFilters(it, skip = {}){
  const f = D.state.filters;
  if (!skip.src && f.src.length && !f.src.includes(it.src)) return false;
  if (!skip.types && f.types.length && !f.types.includes(it.type)) return false;
  if (!skip.courses && f.courses.length && !f.courses.includes(it.course || '_none')) return false;
  if (!skip.status && f.status.length && !statusKeys(it).some(k => f.status.includes(k))) return false;
  if (S.q) {
    const q = norm(S.q);
    const hay = norm([it.title, courseName(it.course), srcName(it.src), it.notes, it.body, it.teacher].join(' '));
    if (!q.split(' ').every(w => hay.includes(w))) return false;
  }
  return true;
}
const visible = (list = D.items, skip) => list.filter(it => !it.hidden && passFilters(it, skip));
const tasks = () => visible().filter(isTask);
const proposals = () => D.items.filter(it => it.proposed);
const sortByDue = (a, b) => (dueOf(a)?.getTime() ?? 9e15) - (dueOf(b)?.getTime() ?? 9e15);

/* Crunch detection: days with several big things, back-to-back clusters, and clashing times. */
function analyze(fromDate = new Date(), days = 21, list = D.items){
  const start = startOfDay(fromDate), end = addDays(start, days);
  const pool = list.filter(it => !it.hidden && it.status !== 'done' && isDated(it) && it.type !== 'absence');
  const inRange = pool.filter(it => { const d = dueOf(it); return d >= start && d < end; });
  const byDay = {};
  for (const it of inRange) { const k = dayKey(dueOf(it)); (byDay[k] ||= []).push(it); }
  const out = [];
  for (const [k, arr] of Object.entries(byDay)) {
    const majors = arr.filter(i => MAJOR.has(i.type));
    const work = arr.filter(i => !['event','study'].includes(i.type));
    if (majors.length >= 2 || work.length >= 4) {
      const d = parseDate(k + 'T12:00');
      out.push({kind:'heavy', day:k, date:d, items:arr.map(i => i.id),
        text:`${relDay(d)} has ${majors.length >= 2 ? majors.length + ' tests/quizzes/projects' : work.length + ' things due'}`,
        detail:arr.map(i => i.title).join(' · ')});
    }
  }
  // clusters: 3+ major items within any 3-day window
  const majorsAll = inRange.filter(i => MAJOR.has(i.type)).sort(sortByDue);
  for (let i = 0; i < majorsAll.length; i++) {
    const a = dueOf(majorsAll[i]);
    const win = majorsAll.filter(x => { const d = dueOf(x); return d >= startOfDay(a) && d < addDays(startOfDay(a), 3); });
    if (win.length >= 3 && !out.some(o => o.kind === 'cluster' && Math.abs(o.date - a) < 3 * DAY)) {
      out.push({kind:'cluster', day:dayKey(a), date:a, items:win.map(x => x.id),
        text:`${win.length} big assessments between ${relDay(a)} and ${relDay(dueOf(win[win.length-1]))}`,
        detail:win.map(x => `${x.title} (${WD[dueOf(x).getDay()]})`).join(' · ')});
    }
  }
  // time clashes between timed events / sessions
  const timed = inRange.filter(i => (i.type === 'event' || i.type === 'study' || i.type === 'test') && !i.allDay && i.end);
  for (let i = 0; i < timed.length; i++) for (let j = i + 1; j < timed.length; j++) {
    const A = timed[i], B = timed[j], as = dueOf(A), ae = parseDate(A.end), bs = dueOf(B), be = parseDate(B.end);
    if (as < be && bs < ae) out.push({kind:'overlap', day:dayKey(as), date:as, items:[A.id, B.id], text:`${A.title} overlaps ${B.title}`, detail:`${relDay(as)} ${fmtTime(as)}`});
  }
  return out.sort((a, b) => a.date - b.date);
}
function heavyDays(){ const set = new Set(); analyze(addDays(new Date(), -40), 120).forEach(a => { if (a.kind === 'heavy') set.add(a.day); }); return set; }

/* ---------- grade math ---------- */
function catOf(g, c){
  if (!c?.cats?.length) return null;
  if (c.cats.some(k => k.id === g.cat)) return g.cat;
  const n = norm(g.cat);
  const hit = n && c.cats.find(k => norm(k.name) === n || n.includes(norm(k.name)) || norm(k.name).includes(n) || norm(k.name).replace(/zes$|s$/, '') === n.replace(/zes$|s$/, ''));
  return hit ? hit.id : null;
}
function gradeRows(courseId, wi){
  const c = course(courseId);
  const ov = wi?.ov || {};
  const rows = D.grades.filter(g => g.course === courseId).map(g => {
    const o = ov[g.id] || {};
    return {...g, score:o.score ?? g.score, max:o.max ?? g.max, include:o.include ?? (g.include !== false), cat:o.cat ?? g.cat,
      changed:!!(ov[g.id] && (o.score !== undefined || o.max !== undefined || o.include !== undefined || o.cat !== undefined))};
  });
  for (const x of wi?.extra || []) rows.push({...x, include:x.include !== false, hypo:true, course:courseId});
  return rows.map(r => ({...r, catId:catOf(r, c)}));
}
function calcGrade(courseId, rows, extraRow){
  const c = course(courseId); if (!c) return {pct:null, cats:[]};
  const all = extraRow ? rows.concat([extraRow]) : rows;
  const valid = all.filter(r => r.include && r.score !== '' && r.score != null && isFinite(+r.score) && +r.max > 0);
  if (c.scheme !== 'weighted' || !c.cats?.length) {
    const Sx = sum(valid, r => r.score), Px = sum(valid, r => r.max);
    return {pct:Px ? Sx / Px * 100 : null, S:Sx, P:Px, cats:[]};
  }
  const cats = c.cats.map(k => {
    const rs = valid.filter(r => r.catId === k.id);
    const Sx = sum(rs, r => r.score), Px = sum(rs, r => r.max);
    return {...k, S:Sx, P:Px, n:rs.length, pct:Px ? Sx / Px * 100 : null};
  });
  const act = cats.filter(k => k.P > 0 && +k.weight > 0);
  const W = sum(act, k => k.weight);
  const pct = W ? act.reduce((a, k) => a + (+k.weight) * (k.S / k.P), 0) / W * 100 : null;
  const unc = valid.filter(r => !r.catId).length;
  return {pct, cats, W, uncategorized:unc};
}
/* score needed on one more assignment (worth `max` points, in category `catId`) to reach `target` percent */
function neededScore(courseId, rows, target, catId, max){
  const c = course(courseId); if (!c || !(max > 0)) return null;
  const t = target / 100;
  const valid = rows.filter(r => r.include && r.score !== '' && r.score != null && isFinite(+r.score) && +r.max > 0);
  if (c.scheme !== 'weighted' || !c.cats?.length) {
    const Sx = sum(valid, r => r.score), Px = sum(valid, r => r.max);
    return t * (Px + max) - Sx;
  }
  const k = c.cats.find(x => x.id === catId); if (!k || !(+k.weight > 0)) return null;
  let A = 0, W = +k.weight, Sc = 0, Pc = 0;
  for (const cat of c.cats) {
    const rs = valid.filter(r => r.catId === cat.id);
    const Sx = sum(rs, r => r.score), Px = sum(rs, r => r.max);
    if (cat.id === catId) { Sc = Sx; Pc = Px; continue; }
    if (Px > 0 && +cat.weight > 0) { A += (+cat.weight) * (Sx / Px); W += +cat.weight; }
  }
  return ((t * W - A) / (+k.weight)) * (Pc + max) - Sc;
}
function courseHistory(courseId){
  const rows = gradeRows(courseId).filter(r => !r.hypo && r.date);
  const dates = [...new Set(rows.map(r => r.date.slice(0, 10)))].sort();
  return dates.map(d => ({d, pct:calcGrade(courseId, rows.filter(r => r.date.slice(0, 10) <= d)).pct})).filter(p => p.pct != null);
}
function courseSummary(courseId){
  const rows = gradeRows(courseId);
  const now = calcGrade(courseId, rows).pct;
  const weekAgo = dayKey(addDays(new Date(), -7));
  const before = calcGrade(courseId, rows.filter(r => !r.date || r.date.slice(0, 10) <= weekAgo)).pct;
  const reported = D.avgs[courseId];
  return {pct:now ?? reported?.pct ?? null, computed:now, reported, delta:(now != null && before != null) ? now - before : null, n:rows.length};
}

/* ---------- merge / upsert (keeps what the student changed) ---------- */
const USER_FIELDS = ['status','notes','pinned','hidden','read','gcalAdded','userEdited'];
function itemKey(it){ return it.key || `${it.src}:${norm(it.title).slice(0, 60)}:${it.due ? dayKey(dueOf(it) || new Date(0)) : ''}`; }
function upsertItems(incoming, opts = {}){
  let added = 0, updated = 0;
  const byKey = new Map(D.items.map(i => [itemKey(i), i]));
  const loose = i => `${i.src}:${norm(i.title).slice(0, 60)}`;
  const byLoose = new Map();
  for (const i of D.items) { if (i.type === 'announcement') continue; (byLoose.get(loose(i)) || byLoose.set(loose(i), []).get(loose(i))).push(i); }
  const sameDay = (a, b) => !a.due || !b.due || (dueOf(a) && dueOf(b) && dayKey(dueOf(a)) === dayKey(dueOf(b)));
  const gone = new Set(D.state.dismissed || []);
  for (const raw of incoming) {
    if (raw.key && gone.has(raw.key)) continue;
    const it = {...raw};
    it.key = it.key || itemKey(it);
    let ex = byKey.get(it.key);
    if (!ex && it.type !== 'announcement') ex = (byLoose.get(loose(it)) || []).find(c => sameDay(c, it) && !(c.key && it.key && c.key.startsWith('gcal:') && it.key.startsWith('gcal:')));
    if (ex) {
      if (ex.userEdited && !opts.force) {
        if (it.status === 'done' && ex.status !== 'done') { ex.status = 'done'; updated++; }
        if (it.score != null && ex.score == null) { ex.score = it.score; ex.max = it.max; updated++; }
        continue;
      }
      const keep = {}; USER_FIELDS.forEach(f => { if (ex[f] !== undefined) keep[f] = ex[f]; });
      const before = JSON.stringify(ex);
      Object.assign(ex, it, keep, {id:ex.id, created:ex.created, key:ex.key || it.key, url:ex.url && !it.url ? ex.url : (it.url || ex.url), course:it.course || ex.course});
      if (it.status === 'done') ex.status = 'done';
      if (it.missing === false) ex.missing = false;
      if (JSON.stringify(ex) !== before) { ex.updated = Date.now(); updated++; }
    } else {
      const n = {id:uid('i'), created:Date.now(), status:'todo', ...it};
      D.items.push(n); byKey.set(n.key, n); (byLoose.get(loose(n)) || byLoose.set(loose(n), []).get(loose(n))).push(n); added++;
    }
  }
  if (added || updated) store.save('items');
  return {added, updated};
}
function upsertGrades(list){
  let added = 0, updated = 0;
  for (const g of list) {
    const key = g.key || `${g.course}:${norm(g.title).slice(0, 60)}`;
    const ex = D.grades.find(x => (x.key || `${x.course}:${norm(x.title).slice(0, 60)}`) === key);
    if (ex) { const b = JSON.stringify(ex); Object.assign(ex, g, {id:ex.id, key}); if (JSON.stringify(ex) !== b) { ex.updated = Date.now(); updated++; } }
    else { D.grades.push({id:uid('g'), key, created:Date.now(), ...g}); added++; }
  }
  if (added || updated) store.save('grades');
  return {added, updated};
}

/* ---------- importers ---------- */
function parseICS(text){
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const evs = []; let cur = null;
  for (const l of lines) {
    if (l === 'BEGIN:VEVENT') cur = {};
    else if (l === 'END:VEVENT') { if (cur) evs.push(cur); cur = null; }
    else if (cur) {
      const i = l.indexOf(':'); if (i < 0) continue;
      const [name, ...params] = l.slice(0, i).split(';');
      cur[name.toUpperCase()] = {val:l.slice(i + 1), params:params.join(';')};
    }
  }
  const un = s => String(s || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
  const dt = p => {
    if (!p) return null;
    const m = p.val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/); if (!m) return null;
    if (!m[4]) return new Date(+m[1], +m[2]-1, +m[3], 0, 0);
    if (m[7]) return new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +(m[6] || 0)));
    return new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5]);
  };
  return evs.map(e => {
    const desc = un(e.DESCRIPTION?.val);
    const allDay = /VALUE=DATE(?!-)/.test(e.DTSTART?.params || '') || /^\d{8}$/.test(e.DTSTART?.val || '');
    return {title:un(e.SUMMARY?.val) || 'Untitled', start:dt(e.DTSTART), end:dt(e.DTEND), allDay, desc,
      url:safeUrl(e.URL?.val) || safeUrl((desc.match(/https?:\/\/[^\s<>"]+/) || [])[0]), uid:e.UID?.val};
  }).filter(e => e.start);
}
function guessType(title){
  const t = norm(title);
  if (/\b(test|exam|midterm|final|unit test|prueba|examen)\b/.test(t)) return 'test';
  if (/\b(quiz|quizzes|check ?point|progress check)\b/.test(t)) return /progress check/.test(t) ? 'assignment' : 'quiz';
  if (/\b(project|essay|paper|dbq|leq|presentation|portfolio|research)\b/.test(t)) return 'project';
  if (/\blab\b/.test(t)) return 'lab';
  return 'assignment';
}
/* Fallback when Claude isn't available: pull dated lines and x/y scores out of pasted text. */
function heuristicParse(text, src, courseId){
  const lines = text.split(/\n+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const MON = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11};
  const dateRe = /\b(?:(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?|(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?)\b/i;
  const timeRe = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
  const scoreRe = /\b(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\b/;
  const items = [], grades = []; let skipped = 0;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const sm = L.match(scoreRe), dm = L.match(dateRe);
    const dateOk = dm && (dm[1] || (+dm[4] >= 1 && +dm[4] <= 12 && +dm[5] >= 1 && +dm[5] <= 31));
    const scoreOk = sm && +sm[2] > 0 && +sm[2] <= 1000 && +sm[1] <= +sm[2] * 1.5;
    const sameSpot = dm && sm && L.indexOf(sm[0]) === L.indexOf(dm[0]);
    if (scoreOk && (!dateOk || (sameSpot && !/\bdue\b/i.test(L) && !timeRe.test(L)))) {
      if (!courseId) { skipped++; continue; }
      const title = L.replace(scoreRe, '').replace(dateRe, '').replace(/[|•\t]+/g, ' ').replace(/\s+/g, ' ').trim() || lines[i-1] || 'Grade';
      grades.push({course:courseId, title:title.slice(0, 90), score:+sm[1], max:+sm[2], date:dayKey(new Date()), src});
      continue;
    }
    if (!dateOk) continue;
    let mo, da, yr;
    if (dm[1]) { mo = MON[dm[1].toLowerCase().slice(0, dm[1].toLowerCase().startsWith('sept') ? 4 : 3)]; da = +dm[2]; yr = dm[3] ? +dm[3] : inferYear(mo); }
    else { mo = +dm[4] - 1; da = +dm[5]; yr = dm[6] ? (+dm[6] < 100 ? 2000 + +dm[6] : +dm[6]) : inferYear(mo); }
    if (mo == null || mo > 11 || da < 1 || da > 31) continue;
    const tm = L.match(timeRe);
    let h = 23, mi = 59;
    if (tm) { h = +tm[1] % 12 + (tm[3].toLowerCase() === 'pm' ? 12 : 0); mi = +(tm[2] || 0); }
    let title = L.replace(dateRe, '').replace(timeRe, '').replace(/\b(due|assigned|on|by|at)\b:?/gi, ' ').replace(/[|•\t–—-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (title.length < 3) title = lines[i-1] || 'Assignment';
    const done = /\b(complete|completed|submitted|turned in|done|100%)\b/i.test(L);
    const missing = /\b(missing|past due|late)\b/i.test(L);
    items.push({src, course:courseId, title:title.slice(0, 120), type:guessType(title), due:toLocalISO(new Date(yr, mo, da, h, mi)), status:done ? 'done' : 'todo', missing, origin:'import'});
  }
  return {items, grades, avgs:[], skippedGrades:skipped};
}
function importPrompt(srcKey, courseHint, text){
  const cs = D.state.courses.map(c => c.name).join('; ') || 'unknown';
  return `You are reading a page a high-school student copied from ${srcName(srcKey)}${courseHint ? ` for the class "${courseHint}"` : ''}. Extract every assignment, grade, announcement and absence it shows.
Today is ${fmtDay(new Date(), true)}, ${new Date().getFullYear()} (time zone ${TZ}). The school year runs Sep ${schoolYearStart()} to Jun ${schoolYearStart() + 1}; for dates without a year, pick the year inside that school year.
The student's classes: ${cs}. Use one of these names for "course" when it clearly matches; otherwise use the class name shown.
Reply with only JSON in this shape:
{"items":[{"kind":"assignment"|"announcement"|"absence","title":string,"course":string|null,"type":"assignment"|"test"|"quiz"|"project"|"lab"|"event","due":"YYYY-MM-DDTHH:MM" or null,"status":"todo"|"done"|"missing","score":number|null,"max":number|null,"url":string|null,"teacher":string|null,"body":string|null}],
 "grades":[{"course":string,"title":string,"category":string|null,"score":number,"max":number,"date":"YYYY-MM-DD"|null}],
 "averages":[{"course":string,"percent":number,"letter":string|null}]}
Rules: a due time of 11:59 PM is "23:59". Put graded work in "grades" (and also in "items" only if it still needs doing). Attendance rows (absent, tardy, early dismissal) are items with kind "absence" and the date in "due". Leave out navigation menus, ads and anything that is not schoolwork. Empty arrays are fine.
${text ? '\nPAGE TEXT:\n' + text.slice(0, 60000) : '\nThe page is in the attached screenshot.'}`;
}
function normalizeImport(res, srcKey, courseId){
  const out = {items:[], grades:[], avgs:[]};
  const arr = x => Array.isArray(x) ? x : [];
  for (const r of arr(res?.items)) {
    if (!r || !r.title) continue;
    const cid = courseId || matchCourse(r.course, true);
    const kind = r.kind === 'announcement' ? 'announcement' : r.kind === 'absence' ? 'absence' : null;
    const due = r.due && parseDate(r.due) ? toLocalISO(parseDate(r.due)) : null;
    out.items.push({src:srcKey, course:cid, title:String(r.title).slice(0, 140), type:kind || (TYPES[r.type] ? r.type : guessType(r.title)),
      due:kind === 'announcement' ? null : due, posted:kind === 'announcement' ? (due || toLocalISO(new Date())) : undefined,
      status:r.status === 'done' ? 'done' : 'todo', missing:r.status === 'missing', score:isFinite(+r.score) && r.score !== null ? +r.score : undefined,
      max:isFinite(+r.max) && r.max !== null ? +r.max : undefined, url:safeUrl(r.url) || undefined, teacher:r.teacher || undefined,
      body:r.body ? String(r.body).slice(0, 4000) : undefined, origin:'import', read:kind === 'announcement' ? false : undefined});
  }
  for (const g of arr(res?.grades)) {
    if (!g || !g.title || !isFinite(+g.score) || !(+g.max > 0)) continue;
    const cid = courseId || matchCourse(g.course, true); if (!cid) continue;
    const c = course(cid);
    let cat = g.category || null;
    if (cat && c?.scheme === 'weighted') cat = catOf({cat}, c) || cat;
    out.grades.push({course:cid, title:String(g.title).slice(0, 120), cat, score:+g.score, max:+g.max, date:g.date && /^\d{4}-\d{2}-\d{2}/.test(g.date) ? g.date.slice(0, 10) : dayKey(new Date()), src:srcKey});
  }
  for (const a of arr(res?.averages)) {
    const cid = courseId || matchCourse(a?.course, true);
    if (cid && isFinite(+a.percent)) out.avgs.push({course:cid, pct:+a.percent, letter:a.letter || null});
  }
  return out;
}
function applyImport(prev, srcKey){
  const items = prev.items.filter(x => x._on !== false).map(({_on, ...x}) => x);
  const grades = prev.grades.filter(x => x._on !== false).map(({_on, ...x}) => x);
  const r1 = upsertItems(items);
  const r2 = upsertGrades(grades);
  for (const a of prev.avgs) D.avgs[a.course] = {pct:a.pct, letter:a.letter, asOf:Date.now(), src:srcKey};
  if (prev.avgs.length) store.save('grades');
  D.state.conn.imports[srcKey] = Date.now(); store.save('state');
  return {added:r1.added + r2.added, updated:r1.updated + r2.updated, grades:r2.added + r2.updated};
}

/* ---------- sample data (clearly labeled; removable in one click) ---------- */
function makeSample(){
  const T = startOfDay(new Date());
  const at = (d, h = 23, m = 59) => { const x = addDays(T, d); x.setHours(h, m, 0, 0); return toLocalISO(x); };
  const ds = d => dayKey(addDays(T, d));
  const courses = [
    {id:'c-calc', name:'AP Calculus BC', teacher:'Mr. Patel', color:'#6C8EBF', period:1, src:['deltamath','apclassroom'], scheme:'weighted', cats:[{id:'t',name:'Tests',weight:50},{id:'q',name:'Quizzes',weight:30},{id:'h',name:'Homework',weight:20}]},
    {id:'c-bio', name:'AP Biology', teacher:'Dr. Okafor', color:'#6FA27E', period:2, src:['pearson','apclassroom','classroom'], scheme:'weighted', cats:[{id:'t',name:'Tests',weight:45},{id:'l',name:'Labs',weight:25},{id:'q',name:'Quizzes',weight:15},{id:'h',name:'Homework',weight:15}]},
    {id:'c-span', name:'Spanish III Honors', teacher:'Sra. Morales', color:'#D08C8C', period:3, src:['vhl'], scheme:'weighted', cats:[{id:'a',name:'Assessments',weight:50},{id:'c',name:'Classwork',weight:25},{id:'h',name:'VHL Homework',weight:25}]},
    {id:'c-apush', name:'AP U.S. History', teacher:'Ms. Chen', color:'#C9A15F', period:4, src:['albert','apclassroom','classroom'], scheme:'weighted', cats:[{id:'M',name:'Major',weight:60},{id:'m',name:'Minor',weight:40}]},
    {id:'c-eng', name:'English 11 Honors', teacher:'Mr. Rivera', color:'#8C7FB8', period:5, src:['classroom'], scheme:'points', cats:[]},
    {id:'c-chem', name:'Chemistry Honors', teacher:'Mrs. Goldberg', color:'#5FA3A8', period:6, src:['savvas'], scheme:'weighted', cats:[{id:'t',name:'Tests',weight:50},{id:'l',name:'Labs',weight:30},{id:'h',name:'Homework',weight:20}]},
    {id:'c-phys', name:'Physics Honors', teacher:'Mr. Novak', color:'#B5739A', period:7, src:['mcgraw'], scheme:'weighted', cats:[{id:'t',name:'Tests',weight:50},{id:'l',name:'Labs',weight:25},{id:'h',name:'Homework',weight:25}]},
  ].map(c => ({...c, sample:true}));
  const I = (o) => ({id:uid('s'), created:Date.now() - 3*DAY, status:'todo', origin:'sample', sample:true, ...o});
  const items = [
    I({src:'deltamath', course:'c-calc', type:'assignment', title:'Related Rates Practice (15 problems)', due:at(-2), url:SOURCES.deltamath.url}),
    I({src:'vhl', course:'c-span', type:'assignment', title:'Lección 3 · Estructura 3.2 Práctica', due:at(-1), missing:true, url:SOURCES.vhl.url}),
    I({src:'savvas', course:'c-chem', type:'assignment', title:'Lesson Check 6.2', due:at(-3), status:'done', url:SOURCES.savvas.url}),
    I({src:'albert', course:'c-apush', type:'assignment', title:'Period 4 Stimulus-Based MCQs', due:at(0), url:SOURCES.albert.url, created:Date.now() - 6*HOUR}),
    I({src:'classroom', course:'c-eng', type:'assignment', title:'Gatsby Ch. 4–5 annotations', due:at(1, 8, 0), url:SOURCES.classroom.home}),
    I({src:'pearson', course:'c-bio', type:'assignment', title:'Mastering Biology: Ch. 9 Cellular Respiration', due:at(1), url:SOURCES.pearson.url}),
    I({src:'mcgraw', course:'c-phys', type:'assignment', title:"Connect: Newton's Laws HW 4.3", due:at(2), url:SOURCES.mcgraw.url}),
    I({src:'deltamath', course:'c-calc', type:'assignment', title:'Implicit Differentiation', due:at(3), url:SOURCES.deltamath.url, created:Date.now() - 20*HOUR}),
    I({src:'classroom', course:'c-chem', type:'test', title:'Unit 4 Test: Stoichiometry', due:at(4, 8, 0), url:SOURCES.classroom.home, pinned:true}),
    I({src:'deltamath', course:'c-calc', type:'quiz', title:'Quiz 3.4–3.6 (derivatives)', due:at(4, 9, 30), url:SOURCES.deltamath.url}),
    I({src:'classroom', course:'c-apush', type:'project', title:'DBQ Essay: The Market Revolution', due:at(4), url:SOURCES.classroom.home}),
    I({src:'vhl', course:'c-span', type:'quiz', title:'Lección 4 Vocabulario Quiz', due:at(5, 11, 0), url:SOURCES.vhl.url}),
    I({src:'apclassroom', course:'c-bio', type:'assignment', title:'Unit 3 Progress Check: MCQ', due:at(6), url:SOURCES.apclassroom.url}),
    I({src:'classroom', course:'c-phys', type:'lab', title:'Lab Report: Projectile Motion', due:at(7), url:SOURCES.classroom.home}),
    I({src:'savvas', course:'c-chem', type:'assignment', title:'Ch. 7 Reading Guide', due:at(8), url:SOURCES.savvas.url}),
    I({src:'albert', course:'c-apush', type:'test', title:'Unit 4 Practice Test', due:at(9), url:SOURCES.albert.url}),
    I({src:'classroom', course:'c-eng', type:'project', title:'Research paper: thesis + outline', due:at(11), url:SOURCES.classroom.home}),
    I({src:'apclassroom', course:'c-calc', type:'assignment', title:'Unit 2 Progress Check: FRQ', due:at(12), url:SOURCES.apclassroom.url}),
    I({src:'gcal', type:'event', title:'Science Olympiad practice', due:at(2, 15, 0), end:at(2, 17, 0), url:SOURCES.gcal.url}),
    I({src:'gcal', type:'event', title:'Dentist appointment', due:at(3, 16, 30), end:at(3, 17, 30), url:SOURCES.gcal.url}),
    I({src:'gcal', type:'event', title:'Math League meet', due:at(5, 15, 15), end:at(5, 17, 0), url:SOURCES.gcal.url}),
    I({src:'pearson', course:'c-bio', type:'assignment', title:'Ch. 8 Photosynthesis Dynamic Study Module', due:at(-4), status:'done', url:SOURCES.pearson.url}),
    I({src:'classroom', course:'c-eng', type:'project', title:'Personal essay: final draft', due:at(-5), status:'done', score:46, max:50, url:SOURCES.classroom.home}),
    I({src:'genesis', type:'absence', title:'Absent (excused), full day', due:at(-9, 8, 0), allDay:true}),
    I({src:'genesis', type:'absence', title:'Tardy, Period 1', due:at(-16, 8, 0), allDay:true}),
  ];
  const ann1 = uid('s'), ann2 = uid('s');
  items.push(
    I({id:ann1, src:'classroom', course:'c-eng', type:'announcement', teacher:'Mr. Rivera', title:'Socratic seminar next week', posted:at(-1, 18, 20), read:false, url:SOURCES.classroom.home,
      body:'Reminder: our Socratic seminar on Gatsby chapters 1–5 is next Thursday. Bring your annotated copy and two discussion questions. The vocab quiz moves to Friday.'}),
    I({id:ann2, src:'classroom', course:'c-chem', type:'announcement', teacher:'Mrs. Goldberg', title:'Unit 4 test review', posted:at(-2, 7, 45), read:false, url:SOURCES.classroom.home,
      body:`The Unit 4 test is on ${fmtDay(addDays(T, 4), true)}. Review packet answers are posted on Savvas. Extra help in room 214 on ${WDL[addDays(T, 3).getDay()]} after school.`}),
    I({src:'classroom', course:'c-bio', type:'announcement', teacher:'Dr. Okafor', title:'Lab coats on Monday', posted:at(-3, 14, 5), read:true, url:SOURCES.classroom.home,
      body:'Lab coats and goggles required Monday. We start the cellular respiration lab, and the pre-lab questions are due at the start of class.'}),
    I({src:'classroom', course:'c-apush', type:'announcement', teacher:'Ms. Chen', title:'Albert Period 4 is live', posted:at(0, 7, 30), read:false, url:SOURCES.classroom.home,
      body:'The Albert assignment for Period 4 is live. Aim for 80% or higher; you can retry each question once.'}),
  );
  const nextDow = (dow) => { let d = addDays(T, 1); while (d.getDay() !== dow) d = addDays(d, 1); if (dayDiff(d) < 4) d = addDays(d, 7); return d; };
  const thu = nextDow(4), fri = addDays(thu, 1);
  items.push(
    I({src:'classroom', course:'c-eng', type:'event', title:'Gatsby Socratic seminar (bring annotations)', due:toLocalISO(new Date(thu.setHours(10, 0, 0, 0))), proposed:true, origin:'ai', fromAnn:ann1}),
    I({src:'classroom', course:'c-eng', type:'quiz', title:'English vocab quiz (moved)', due:toLocalISO(new Date(fri.setHours(10, 0, 0, 0))), proposed:true, origin:'ai', fromAnn:ann1}),
    I({src:'classroom', course:'c-chem', type:'event', title:'Chem extra help, room 214', due:at(3, 14, 45), end:at(3, 15, 30), proposed:true, origin:'ai', fromAnn:ann2}),
  );
  const G = (course, cat, title, score, max, d, src = 'genesis') => ({id:uid('sg'), course, cat, title, score, max, date:ds(d), src, sample:true});
  const grades = [
    G('c-calc','t','Unit 1 Test: Limits',88,100,-45), G('c-calc','t','Unit 2 Test: Derivatives',92,100,-20), G('c-calc','q','Quiz 1.1',9,10,-55),
    G('c-calc','q','Quiz 2.3',17,20,-30), G('c-calc','q','Quiz 3.2',19,20,-4), G('c-calc','h','DeltaMath: Limits Review',10,10,-50,'deltamath'),
    G('c-calc','h','DeltaMath: Power Rule',10,10,-35,'deltamath'), G('c-calc','h','DeltaMath: Chain Rule',9,10,-18,'deltamath'), G('c-calc','h','DeltaMath: Product/Quotient',8,10,-9,'deltamath'),
    G('c-bio','t','Unit 1 Test: Chemistry of Life',41,50,-38), G('c-bio','t','Unit 2 Test: Cell Structure',45,50,-14), G('c-bio','l','Osmosis Lab',23,25,-42),
    G('c-bio','l','Enzyme Lab',22,25,-21), G('c-bio','q','Quiz: Macromolecules',18,20,-48), G('c-bio','q','Quiz: Membranes',16,20,-25),
    G('c-bio','h','Mastering Ch. 6',10,10,-33,'pearson'), G('c-bio','h','Mastering Ch. 7',9.5,10,-16,'pearson'), G('c-bio','h','Mastering Ch. 8',10,10,-4,'pearson'),
    G('c-span','a','Lección 2 Prueba',47,50,-31), G('c-span','a','Lección 3 Prueba',44,50,-6), G('c-span','a','Presentación oral',18,20,-19),
    G('c-span','c','Diálogo en parejas',10,10,-27), G('c-span','c','Lectura: Cuentos',9,10,-12), G('c-span','h','VHL Lección 2',95,100,-33,'vhl'),
    G('c-span','h','VHL Lección 3',88,100,-8,'vhl'),
    G('c-apush','M','Unit 1 Test',85,100,-44), G('c-apush','M','LEQ: Colonial Regions',5,6,-29), G('c-apush','M','Unit 2 Test',90,100,-15),
    G('c-apush','m','Albert Period 2',17,20,-36,'albert'), G('c-apush','m','Albert Period 3',18,20,-11,'albert'), G('c-apush','m','Reading quiz: Ch. 7',9,10,-3),
    G('c-eng',null,'Personal essay: final draft',46,50,-5,'classroom'), G('c-eng',null,'Vocab quiz 1',19,20,-40), G('c-eng',null,'Vocab quiz 2',18,20,-22),
    G('c-eng',null,'Gatsby reading check',9,10,-8), G('c-eng',null,'Poetry analysis',42,50,-30),
    G('c-chem','t','Unit 2 Test',86,100,-41), G('c-chem','t','Unit 3 Test',81,100,-12), G('c-chem','l','Density Lab',18,20,-37), G('c-chem','l','Flame Test Lab',19,20,-17),
    G('c-chem','h','Savvas Ch. 4',10,10,-39,'savvas'), G('c-chem','h','Savvas Ch. 5',8,10,-24,'savvas'), G('c-chem','h','Savvas Ch. 6',10,10,-6,'savvas'),
    G('c-phys','t','Kinematics Test',78,100,-25), G('c-phys','l','Free-fall Lab',22,25,-18), G('c-phys','h','Connect 3.1',9,10,-34,'mcgraw'),
    G('c-phys','h','Connect 3.2',10,10,-27,'mcgraw'), G('c-phys','h','Connect 4.1',7,10,-10,'mcgraw'), G('c-phys','h','Connect 4.2',10,10,-2,'mcgraw'),
  ];
  const tg = (() => { const y = new Date().getFullYear(); const f = y => { const d = new Date(y, 10, 1); while (d.getDay() !== 4) d.setDate(d.getDate() + 1); d.setDate(d.getDate() + 21); return d; }; let d = f(y); if (d < T) d = f(y + 1); return d; })();
  const apPick = ['Biology','United States History','Calculus BC','Spanish Language and Culture'];
  const countdowns = [
    ...apPick.map(n => { const e = AP_2027.find(a => a.name === n); return {id:uid('s'), kind:'ap', title:`AP ${n} exam`, date:e.at, color:'#6FA27E', sample:true}; }),
    {id:uid('s'), kind:'custom', title:'Thanksgiving break', date:toLocalISO(new Date(tg.getFullYear(), tg.getMonth(), tg.getDate() - 1, 15, 0)), color:'#C9A15F', sample:true},
  ];
  const inbox = [
    {id:'demo1', subject:'New announcement: Socratic seminar next week', from:'Google Classroom', date:Date.now() - 22*HOUR, snippet:'Mr. Rivera posted in English 11 Honors: Reminder: our Socratic seminar on Gatsby chapters 1–5 is next Thursday…', sample:true},
    {id:'demo2', subject:'Reminder: Mastering Biology assignment due tomorrow', from:'Pearson Mastering', date:Date.now() - 5*HOUR, snippet:'Ch. 9 Cellular Respiration is due tomorrow at 11:59 PM.', sample:true},
    {id:'demo3', subject:'Science Olympiad: invitational sign-ups close Friday', from:'Club advisor', date:Date.now() - 30*HOUR, snippet:'If you want a spot on the invitational team, sign up on the sheet by Friday…', sample:true},
    {id:'demo4', subject:'Your AP Exam registration is confirmed', from:'College Board', date:Date.now() - 3*DAY, snippet:'You are registered for 4 AP Exams in May 2027.', sample:true},
  ];
  return {courses, items, grades, countdowns, inbox, apExams:apPick};
}
function loadSample(intoState){
  const s = makeSample();
  if (intoState) {
    D.state.courses = D.state.courses.filter(c => !c.sample).concat(s.courses);
    D.state.countdowns = D.state.countdowns.filter(c => !c.sample).concat(s.countdowns);
    if (!D.state.apExams.length) D.state.apExams = s.apExams;
    D.items = D.items.filter(i => !i.sample).concat(s.items);
    D.grades = D.grades.filter(g => !g.sample).concat(s.grades);
  }
  S.sampleInbox = s.inbox;
  return s;
}
function removeSample(){
  D.items = D.items.filter(i => !i.sample);
  D.grades = D.grades.filter(g => !g.sample);
  D.state.courses = D.state.courses.filter(c => !c.sample);
  D.state.countdowns = D.state.countdowns.filter(c => !c.sample);
  S.sampleInbox = [];
  Object.keys(D.avgs).forEach(k => { if (!course(k)) delete D.avgs[k]; });
  store.saveAll();
}
const hasSample = () => D.items.some(i => i.sample) || D.grades.some(g => g.sample);
