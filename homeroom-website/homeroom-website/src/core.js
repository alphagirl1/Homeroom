'use strict';
/* =====================================================================
   Homeroom: core (constants, helpers, state, storage)
   ===================================================================== */

// Middlesex County Magnet Schools student portal (sign-in page)
const GENESIS_URL = 'https://students.c2.genesisedu.net/mcmsnj/sis/view?gohome=true';
const SOURCES = {
  classroom:  {name:'Google Classroom', short:'Classroom',  mono:'GC', color:'#6FA27E', url:'https://classroom.google.com/a/not-turned-in/all', home:'https://classroom.google.com',
               how:'Updates by itself: Classroom emails you new work and announcements, and puts due dates on your Google Calendar. Connect Gmail and Google Calendar below.',
               tip:'Open Classroom → To-do (classroom.google.com/a/not-turned-in/all), select the page (Ctrl/Cmd + A), copy, and paste here. Or take a screenshot.', senders:['classroom.google.com']},
  deltamath:  {name:'DeltaMath', short:'DeltaMath', mono:'Δ', color:'#6C8EBF', url:'https://www.deltamath.com/app/student', home:'https://www.deltamath.com',
               how:'DeltaMath has no way for other apps to read your account. Import your assignment list in one step. If your teacher posts DeltaMath links in Classroom, those arrive on their own.',
               tip:'Open DeltaMath → your class → Assignments. Copy the whole list or screenshot it.', senders:['deltamath.com']},
  vhl:        {name:'VHL Central', short:'VHL', mono:'VH', color:'#D08C8C', url:'https://www.vhlcentral.com', home:'https://www.vhlcentral.com',
               how:'VHL has no way for other apps to read your account. Import from your Assignments or Gradebook page; Homeroom updates what changed.',
               tip:'Open VHL Central → Assignments (or Gradebook). Copy the table or screenshot it.', senders:['vhlcentral.com','vistahigherlearning.com']},
  savvas:     {name:'Savvas Realize', short:'Savvas', mono:'Sv', color:'#C9A15F', url:'https://www.savvasrealize.com', home:'https://www.savvasrealize.com',
               how:'Savvas has no student API. Import from Classes → Assignments; Savvas work your teacher shares to Classroom arrives on its own.',
               tip:'Open Savvas Realize → Classes → your class → Assignments. Copy or screenshot.', senders:['savvas.com','savvasrealize.com']},
  genesis:    {name:'Genesis', short:'Genesis', mono:'Ge', color:'#8C7FB8', url:GENESIS_URL, home:GENESIS_URL,
               how:'Genesis has no public API. Import your Gradebook and Attendance pages. If your school sends Genesis email alerts, Homeroom picks those up from Gmail.',
               tip:'Open Genesis (MCMS student portal) → Gradebook (or Attendance). Copy the page or screenshot it.', senders:['genesisedu.com','genesisedu.net']},
  albert:     {name:'Albert', short:'Albert', mono:'Al', color:'#D49A6A', url:'https://www.albert.io/assignments', home:'https://www.albert.io',
               how:'Albert has no student API. Import your Assignments page; Albert assignments shared to Classroom arrive on their own.',
               tip:'Open Albert → Assignments. Copy the list or screenshot it.', senders:['albert.io']},
  mcgraw:     {name:'McGraw Hill', short:'McGraw Hill', mono:'Mc', color:'#B5739A', url:'https://my.mheducation.com', home:'https://my.mheducation.com',
               how:'McGraw Hill has no student API. Import from your To-Do / assignments page. Connect due-date reminder emails come in through Gmail.',
               tip:'Open McGraw Hill (Connect, ConnectED or ALEKS) → assignments. Copy or screenshot.', senders:['mheducation.com','mcgraw-hill.com']},
  pearson:    {name:'Pearson', short:'Pearson', mono:'Pe', color:'#7C9BAA', url:'https://mlm.pearson.com', home:'https://mlm.pearson.com',
               how:'Pearson has no student API. Import from your course Assignments page; due-date reminder emails come in through Gmail.',
               tip:'Open Pearson MyLab / Mastering → Assignments. Copy or screenshot.', senders:['pearson.com','pearsoncmg.com']},
  apclassroom:{name:'AP Classroom', short:'AP Classroom', mono:'AP', color:'#97A35E', url:'https://apclassroom.collegeboard.org', home:'https://apclassroom.collegeboard.org',
               how:'College Board has no student API. Import your Assignments page. AP exam countdowns are built in.',
               tip:'Open AP Classroom → Assignments (or My Progress). Copy or screenshot.', senders:['collegeboard.org']},
  gcal:       {name:'Google Calendar', short:'Calendar', mono:'Ca', color:'#5FA3A8', url:'https://calendar.google.com', home:'https://calendar.google.com', live:true,
               how:'Live. New events show up on their own every few minutes while Homeroom is open.'},
  gmail:      {name:'Gmail', short:'Gmail', mono:'Gm', color:'#C27F6E', url:'https://mail.google.com', home:'https://mail.google.com', live:true,
               how:'Live. Important mail shows in Inbox; school notification emails become assignments, grades and announcements.'},
  personal:   {name:'Personal', short:'Personal', mono:'Me', color:'#A0907E', url:'', home:''},
};
const SRC_ORDER = ['classroom','deltamath','vhl','savvas','genesis','albert','mcgraw','pearson','apclassroom','gcal','gmail','personal'];
const IMPORTABLE = ['classroom','deltamath','vhl','savvas','genesis','albert','mcgraw','pearson','apclassroom','personal'];

const TYPES = {
  assignment:{label:'Assignment', plural:'Assignments'},
  test:{label:'Test', plural:'Tests'},
  quiz:{label:'Quiz', plural:'Quizzes'},
  project:{label:'Project / essay', plural:'Projects & essays'},
  lab:{label:'Lab', plural:'Labs'},
  event:{label:'Event', plural:'Events'},
  study:{label:'Study session', plural:'Study sessions'},
  announcement:{label:'Announcement', plural:'Announcements'},
  absence:{label:'Attendance', plural:'Attendance'},
};
const TYPE_ORDER = ['assignment','test','quiz','project','lab','event','study','announcement','absence'];
const MAJOR = new Set(['test','quiz','project']);
const STATUS = {overdue:'Overdue', missing:'Missing', upcoming:'Upcoming', nodate:'No due date', done:'Done'};

/* 2027 AP Exam schedule (College Board). Session 1 = 8 AM local, Session 2 = 12 PM local. */
const AP_2027 = [
  ['2027-05-03',1,['Human Geography','Physics C: Mechanics']],['2027-05-03',2,['Biology','Italian Language and Culture']],
  ['2027-05-04',1,['Business with Personal Finance','United States Government and Politics']],['2027-05-04',2,['European History','Microeconomics']],
  ['2027-05-05',1,['Cybersecurity','English Literature and Composition']],['2027-05-05',2,['Physics 1: Algebra-Based','Physics C: Electricity and Magnetism']],
  ['2027-05-06',1,['French Language and Culture','Physics 2: Algebra-Based','World History: Modern']],['2027-05-06',2,['African American Studies','Chemistry']],
  ['2027-05-07',1,['German Language and Culture','United States History']],['2027-05-07',2,['Macroeconomics','Networking (pilot schools)']],
  ['2027-05-10',1,['Calculus AB','Calculus BC']],['2027-05-10',2,['Music Theory','Seminar']],
  ['2027-05-11',1,['Japanese Language and Culture','Precalculus']],['2027-05-11',2,['Statistics']],
  ['2027-05-12',1,['English Language and Composition']],['2027-05-12',2,['Art History','Computer Science A']],
  ['2027-05-13',1,['Spanish Language and Culture']],['2027-05-13',2,['Chinese Language and Culture','Environmental Science']],
  ['2027-05-14',1,['Comparative Government and Politics','Computer Science Principles','Spanish Literature and Culture']],['2027-05-14',2,['Latin','Psychology']],
].flatMap(([d,s,names]) => names.map(n => ({name:n, date:d, session:s, at:`${d}T${s===1?'08:00':'12:00'}`})));

const SCALE_DEFAULT = [[97,'A+'],[93,'A'],[90,'A-'],[87,'B+'],[83,'B'],[80,'B-'],[77,'C+'],[73,'C'],[70,'C-'],[67,'D+'],[65,'D'],[0,'F']];
const PALETTES = {
  sage:{name:'Sage', a:'#5B8263', b:'#F2F4EF'}, lavender:{name:'Lavender', a:'#7A68A3', b:'#F4F2F8'}, blush:{name:'Blush', a:'#A9666B', b:'#F8F2F1'},
  sky:{name:'Sky', a:'#4C7C9F', b:'#EEF3F6'}, sand:{name:'Sand', a:'#93744A', b:'#F5F1EA'}, mist:{name:'Mist', a:'#5F6E86', b:'#F1F2F4'},
};
const SWATCHES = ['#6C8EBF','#6FA27E','#D08C8C','#C9A15F','#8C7FB8','#5FA3A8','#D49A6A','#B5739A','#7C9BAA','#97A35E','#A0907E','#C27F6E'];
const VIEWS = {
  today:{label:'Today', icon:'home', nav:'today'},
  assignments:{label:'Assignments', icon:'list', nav:'assignments'},
  calendar:{label:'Calendar', icon:'cal', nav:'calendar'},
  grades:{label:'Grades', icon:'grades', nav:'grades', sub:'Classes'},
  whatif:{label:'What-If', icon:'calc', nav:'grades', sub:'What-If'},
  attendance:{label:'Attendance', icon:'user', nav:'grades', sub:'Attendance'},
  inbox:{label:'Inbox', icon:'mega', nav:'inbox', sub:'Announcements'},
  email:{label:'Email', icon:'mail', nav:'inbox', sub:'Email'},
  planner:{label:'Planner', icon:'spark', nav:'planner', sub:'AI planner'},
  countdowns:{label:'Countdowns', icon:'timer', nav:'planner', sub:'Countdowns'},
};
const NAV = ['today','assignments','calendar','grades','inbox','planner'];
const SUBS = {grades:['grades','whatif','attendance'], inbox:['inbox','email'], planner:['planner','countdowns']};
const SET_TABS = [['profile','Profile','user'],['look','Appearance','sliders'],['accounts','Accounts & sync','plug'],['notify','Notifications','bell'],['classes','Classes','grad'],['privacy','Privacy','lock'],['data','Your data','clip']];

/* ---------- small helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = (p = 'i') => p + '-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const clone = o => JSON.parse(JSON.stringify(o));
const pad = n => String(n).padStart(2, '0');
const DAY = 864e5, HOUR = 36e5;
const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const WDL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MOL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9áéíóúñü]+/g, ' ').trim();
const sum = (a, f = x => x) => a.reduce((t, x) => t + (+f(x) || 0), 0);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; } catch { return 'America/New_York'; } })();

function startOfDay(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function toLocalISO(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function dayKey(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function isoOffset(d){ const o = -d.getTimezoneOffset(), s = o >= 0 ? '+' : '-', a = Math.abs(o); return `${toLocalISO(d)}:00${s}${pad(Math.floor(a/60))}:${pad(a%60)}`; }
function parseDate(s){
  if (!s) return null;
  if (s instanceof Date) return isNaN(s) ? null : s;
  if (typeof s === 'number') return new Date(s);
  s = String(s).trim();
  if (/^\d{10,13}$/.test(s)) return new Date(+s < 1e12 ? +s * 1000 : +s);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3], 23, 59);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function fmtTime(d){ let h = d.getHours(); const m = d.getMinutes(), ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return m ? `${h}:${pad(m)} ${ap}` : `${h} ${ap}`; }
function fmtDay(d, long){ return long ? `${WDL[d.getDay()]}, ${MOL[d.getMonth()]} ${d.getDate()}` : `${WD[d.getDay()]}, ${MO[d.getMonth()]} ${d.getDate()}`; }
function fmtDate(d){ return `${MO[d.getMonth()]} ${d.getDate()}${d.getFullYear() !== new Date().getFullYear() ? ', ' + d.getFullYear() : ''}`; }
function dayDiff(d){ return Math.round((startOfDay(d) - startOfDay(new Date())) / DAY); }
function relDay(d){
  const n = dayDiff(d);
  if (n === 0) return 'Today'; if (n === 1) return 'Tomorrow'; if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return WDL[d.getDay()];
  return fmtDay(d);
}
function ago(ts){
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.round(s/60)} min ago`;
  if (s < 86400) return `${Math.round(s/3600)} h ago`; return `${Math.round(s/86400)} days ago`;
}
function timeLeft(d){
  const ms = d - Date.now(), late = ms < 0, a = Math.abs(ms);
  let t;
  if (a < HOUR) t = `${Math.max(1, Math.round(a/6e4))} min`;
  else if (a < DAY) t = `${Math.round(a/HOUR)} h`;
  else { const n = Math.round(a/DAY); t = `${n} day${n === 1 ? '' : 's'}`; }
  return late ? `${t} late` : `in ${t}`;
}
function safeUrl(u){ try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } }
function hashStr(s){ let h = 2166136261; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
function schoolYearStart(){ const n = new Date(); return n.getMonth() >= 6 ? n.getFullYear() : n.getFullYear() - 1; }
function inferYear(month0){ const y = schoolYearStart(); return month0 >= 6 ? y : y + 1; }
function luminance(hex){ const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return .5; const n = parseInt(m[1], 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v/12.92 : ((v+.055)/1.055) ** 2.4; }); return .2126*c[0] + .7152*c[1] + .0722*c[2]; }

/* ---------- icons ---------- */
const ICONS = {
  home:'<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
  list:'<path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10"/><path d="m4 6.5 1.2 1.2L7.4 5.5M4 12l1.2 1.2L7.4 11M4 17.5l1.2 1.2 2.2-2.2"/>',
  cal:'<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  mega:'<path d="M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1Z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  grades:'<path d="M5.5 19v-7M11 19V5.5M16.5 19v-9.5M3 19.5h18"/>',
  calc:'<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7h7M8.5 11h.5M12 11h.5M15 11h.5M8.5 14.5h.5M12 14.5h.5M8.5 18h.5M12 18h.5M15.2 14.5v3.5"/>',
  timer:'<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9.5 2.5h5"/>',
  mail:'<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  spark:'<path d="M12 3.5 13.8 9a2 2 0 0 0 1.2 1.2l5.5 1.8-5.5 1.8a2 2 0 0 0-1.2 1.2L12 20.5 10.2 15A2 2 0 0 0 9 13.8L3.5 12 9 10.2A2 2 0 0 0 10.2 9Z"/>',
  plug:'<path d="M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0V7ZM12 16v5"/>',
  sliders:'<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', bell:'<path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>', check:'<path d="m5 12.5 4.5 4.5L19 7.5"/>', x:'<path d="M6 6l12 12M18 6 6 18"/>',
  ext:'<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  refresh:'<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
  left:'<path d="m15 5-7 7 7 7"/>', right:'<path d="m9 5 7 7-7 7"/>', down:'<path d="m6 9 6 6 6-6"/>',
  filter:'<path d="M4 5h16l-6 7.5V19l-4 1.5v-8Z"/>', edit:'<path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4"/>',
  trash:'<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>', pin:'<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5ZM12 14v6"/>',
  upload:'<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>', lock:'<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  dots:'<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  send:'<path d="M4 12 20 4l-6 16-2.5-6.5Z"/>', warn:'<path d="M12 4 2.5 20h19Z"/><path d="M12 10v4.5M12 17.5v.3"/>',
  user:'<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>', book:'<path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3Z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>',
  clip:'<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4.5V3h6v1.5M9 10h6M9 14h6"/>', image:'<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5.5-5 4 3.5 2.5-2 4 3.5"/>',
  link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  stop:'<rect x="7" y="7" width="10" height="10" rx="1.5"/>', grad:'<path d="M3 9.5 12 5l9 4.5-9 4.5Z"/><path d="M7 11.5V16c3 2 7 2 10 0v-4.5M21 9.5V15"/>',
  eye:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  key:'<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M16.5 6.5l2.5 2.5M14 9l2 2"/>',
  live:'<circle cx="12" cy="12" r="3"/><path d="M7.5 7.5a6.5 6.5 0 0 0 0 9M16.5 7.5a6.5 6.5 0 0 1 0 9"/>',
};
const ic = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

/* ---------- app state ---------- */
const S = {
  screen:'boot', identity:'checking', me:null, user:null, dbNS:null,
  mode:'demo', view:'today', q:'', modal:null, pop:null,
  calCursor:startOfDay(new Date()), calMode:'month', calSel:null,
  group:'date', showDone:false, annCourse:'all',
  drafts:{}, chatBusy:false, chatCtl:null, whatCourse:null, gradeCourse:null,
  aiBlocked:false, unlocked:false, loaded:{}, setTab:'look', drawer:false, sampleInbox:[],
};
const D = { state:null, items:[], grades:[], avgs:{}, chat:[] };

function defaultState(){
  return {
    v:1,
    profile:{name:'', school:'Middlesex County Magnet Schools', grade:'', onboarded:false},
    prefs:{palette:'sage', mode:'system', accent:'', scale:1, density:'comfy', reduceMotion:false, seconds:false, weekStart:0,
      colorBy:'src', remindHours:24, alerts:{grades:true, ann:true, overdue:true, email:true}, gcalReminders:false,
      srcColors:{}, scale2:null, gmail:{inbox:'important', custom:'', days:7, autoAI:false, schoolDomain:'', keywords:'test, quiz, exam, due, missing, late'},
      pinHash:null, alwaysSignin:false, pushCal:true, eveningAt:'19:00', morningAt:'07:00', digest:true, digestHour:6,
      instant:{grades:true, assignments:false, missing:true, announcements:false}, syncMinutes:30, tz:TZ},
    courses:[], countdowns:[], apExams:[], filters:{src:[], types:[], status:[], courses:[]}, views:[],
    conn:{gcal:{on:false, cals:[], last:null}, gmail:{on:false, last:null}, links:{}, imports:{}, genesis:{on:false, url:'', user:'', last:null}, classroom:{on:false}},
    processed:[], whatif:{}, lastSeen:null, dismissed:[],
  };
}
function fillDefaults(st){
  const d = defaultState();
  const out = Object.assign(d, st || {});
  out.profile = Object.assign(defaultState().profile, st?.profile || {});
  out.prefs = Object.assign(defaultState().prefs, st?.prefs || {});
  out.prefs.alerts = Object.assign(defaultState().prefs.alerts, st?.prefs?.alerts || {});
  out.prefs.gmail = Object.assign(defaultState().prefs.gmail, st?.prefs?.gmail || {});
  out.prefs.instant = Object.assign(defaultState().prefs.instant, st?.prefs?.instant || {});
  out.filters = Object.assign(defaultState().filters, st?.filters || {});
  out.conn = Object.assign(defaultState().conn, st?.conn || {});
  out.conn.gcal = Object.assign({on:false, cals:[], last:null}, st?.conn?.gcal || {});
  out.conn.gmail = Object.assign({on:false, last:null}, st?.conn?.gmail || {});
  out.conn.links = out.conn.links || {}; out.conn.imports = out.conn.imports || {};
  out.conn.genesis = Object.assign({on:false, url:'', user:'', last:null}, st?.conn?.genesis || {});
  out.conn.classroom = Object.assign({on:false}, st?.conn?.classroom || {});
  ['courses','countdowns','apExams','views','processed','dismissed'].forEach(k => { if (!Array.isArray(out[k])) out[k] = []; });
  if (!out.whatif || typeof out.whatif !== 'object') out.whatif = {};
  return out;
}
const P = () => D.state.prefs;

/* ---------- lookups ---------- */
function srcColor(src){ return P()?.srcColors?.[src] || SOURCES[src]?.color || '#999'; }
function srcName(src, short){ const s = SOURCES[src]; return s ? (short ? s.short : s.name) : 'Other'; }
function course(id){ return D.state.courses.find(c => c.id === id) || null; }
function courseName(id){ const c = course(id); return c ? c.name : (id && !String(id).startsWith('c-') ? String(id) : ''); }
function itemColor(it){
  if (P().colorBy === 'course') { const c = course(it.course); if (c?.color) return c.color; }
  return srcColor(it.src);
}
function matchCourse(name, create){
  if (!name) return null;
  const n = norm(name);
  if (!n) return null;
  const cs = D.state.courses;
  let hit = cs.find(c => norm(c.name) === n) || cs.find(c => n.includes(norm(c.name)) || norm(c.name).includes(n));
  if (!hit) {
    const words = n.split(' ').filter(w => w.length > 2 && !['honors','the','and','class','period'].includes(w));
    let best = null, score = 0;
    for (const c of cs) { const cn = norm(c.name); const s = words.filter(w => cn.includes(w)).length; if (s > score) { score = s; best = c; } }
    if (best && score >= Math.min(2, words.length)) hit = best;
  }
  if (!hit && create) {
    hit = {id:uid('c'), name:String(name).trim().slice(0, 60), teacher:'', color:SWATCHES[cs.length % SWATCHES.length], scheme:'points', cats:[], src:[]};
    cs.push(hit); store.save('state');
  }
  return hit ? hit.id : null;
}
function letterFor(pct){
  if (pct == null || !isFinite(pct)) return '–';
  const scale = P().scale2 || SCALE_DEFAULT;
  for (const [min, l] of scale) if (pct >= min - 1e-9) return l;
  return 'F';
}
