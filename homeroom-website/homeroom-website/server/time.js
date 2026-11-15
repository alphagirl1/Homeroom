// Time zones without surprises: the server runs in UTC, students live in their own time zone.
// Due dates are stored as wall-clock strings ("2026-11-20T23:59") in the student's time zone.
import { pad } from './util.js';

const cache = new Map();
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAY = 864e5;

export function validTz(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return 'America/New_York'; } }
function dtf(tz) {
  let f = cache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23', weekday: 'short' }); cache.set(tz, f); }
  return f;
}
/** Wall-clock parts of an instant in a time zone. */
export function parts(epoch, tz) {
  const p = {};
  for (const x of dtf(tz).formatToParts(new Date(epoch))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: (+p.hour) % 24, mm: +p.minute, dow: DOW.indexOf(p.weekday) };
}
export const wall = (y, m, d, hh = 23, mm = 59) => `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}`;
export const isoWall = (epoch, tz) => { const p = parts(epoch, tz); return wall(p.y, p.m, p.d, p.hh, p.mm); };
export const dateWall = (epoch, tz) => isoWall(epoch, tz).slice(0, 10);
export function parseWall(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  return m ? { y: +m[1], m: +m[2], d: +m[3], hh: m[4] != null ? +m[4] : 23, mm: m[5] != null ? +m[5] : 59 } : null;
}
/** "2026-11-20T23:59" in a time zone → milliseconds since 1970. */
export function wallToEpoch(s, tz) {
  const w = typeof s === 'string' ? parseWall(s) : s;
  if (!w) return null;
  const target = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm);
  let t = target;
  for (let i = 0; i < 3; i++) {
    const p = parts(t, tz), shown = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm), diff = shown - target;
    if (!diff) break;
    t -= diff;
  }
  return t;
}
export function addDaysWall(w, n) { const d = new Date(Date.UTC(w.y, w.m - 1, w.d + n)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: w.hh, mm: w.mm }; }
export const dowOf = w => new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay();
export function longDate(epoch, tz, withTime) {
  return new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }, withTime ? { hour: 'numeric', minute: '2-digit' } : {})).format(new Date(epoch));
}
/** "Fri Nov 20" or "Fri 11:59 PM" style label for a stored wall time. */
export function shortWhen(s, o = {}) {
  const w = parseWall(s); if (!w) return '';
  const day = `${DOW[dowOf(w)]} ${MONTHS[w.m - 1]} ${w.d}`;
  if (o.allDay) return day;
  const h = w.hh % 12 || 12, ap = w.hh < 12 ? 'AM' : 'PM';
  return `${o.dayOnly ? '' : day + ' '}${h}${w.mm ? ':' + pad(w.mm) : ''} ${ap}`.trim();
}
export function schoolYear(month0, ref) { const y = ref.m - 1 >= 6 ? ref.y : ref.y - 1; return month0 >= 6 ? y : y + 1; }

const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
/** Dates mentioned in a line of text ("Quiz Fri", "due 11/20", "Nov. 24th at 3pm"), as wall times in tz. */
export function findDates(text, refEpoch, tz) {
  const out = [], t = String(text), ref = parts(refEpoch, tz);
  const time = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  const hh = time ? (Number(time[1]) % 12 + (/pm/i.test(time[3]) ? 12 : 0)) : (/\b(test|quiz|exam|seminar|presentation|lab)\b/i.test(t) && !/\bdue\b/i.test(t) ? 8 : 23);
  const mm = time ? Number(time[2] || 0) : (hh === 23 ? 59 : 0);
  const push = (y, m0, d) => {
    if (m0 < 0 || m0 > 11 || d < 1 || d > 31) return;
    const dt = new Date(Date.UTC(y, m0, d));
    if (dt.getUTCMonth() !== m0) return; // Feb 30 and friends
    const iso = wall(dt.getUTCFullYear(), m0 + 1, d, hh, mm);
    out.push({ iso, epoch: wallToEpoch(iso, tz) });
  };
  let m;
  const re = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/ig;
  while ((m = re.exec(t))) { const k = m[1].toLowerCase(); const mo = MON[k.startsWith('sept') ? 'sept' : k.slice(0, 3)]; push(m[3] ? Number(m[3]) : schoolYear(mo, ref), mo, Number(m[2])); }
  const re2 = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
  while ((m = re2.exec(t))) { const mo = Number(m[1]) - 1, da = Number(m[2]); if (mo > 11 || da > 31) continue; push(m[3] ? (Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3])) : schoolYear(mo, ref), mo, da); }
  const base = { y: ref.y, m: ref.m, d: ref.d, hh, mm };
  if (/\btomorrow\b/i.test(t)) { const w = addDaysWall(base, 1); push(w.y, w.m - 1, w.d); }
  if (/\btoday\b|\btonight\b/i.test(t)) push(ref.y, ref.m - 1, ref.d);
  const re3 = /\b(next\s+|this\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/ig;
  while ((m = re3.exec(t))) {
    const target = WD.indexOf(m[2].toLowerCase().slice(0, 3));
    let steps = 0, w = base;
    do { w = addDaysWall(w, 1); steps++; } while (dowOf(w) !== target && steps < 8);
    if (m[1] && /next/i.test(m[1]) && steps < 7 - ref.dow) w = addDaysWall(w, 7);
    push(w.y, w.m - 1, w.d);
  }
  return out;
}
