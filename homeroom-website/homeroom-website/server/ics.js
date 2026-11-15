// Calendars: the "subscribe" feed that puts due dates on a phone's calendar with reminders,
// and a reader for calendar links students add (a Google Calendar secret address, a school calendar…).
import { parts, wallToEpoch, isoWall, addDaysWall, validTz } from './time.js';
import { pad } from './util.js';

const MAJOR = { test: 1, quiz: 1, project: 1 };
const LABEL = { test: 'Test', quiz: 'Quiz', project: 'Project' };
const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = epoch => new Date(epoch).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function fold(line) {
  const out = []; let cur = '', bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const hm = (s, def) => { const m = String(s || def).match(/^(\d{1,2}):(\d{2})/); return m ? [Number(m[1]), Number(m[2])] : null; };

/** Minutes before `start` for: the night before, the morning of, and an hour before. */
export function reminderMinutes(startEpoch, prefs, tz) {
  const out = [], sw = parts(startEpoch, tz), ev = hm(prefs.eveningAt, '19:00'), mo = hm(prefs.morningAt, '07:00');
  if (ev) { const e = wallToEpoch(addDaysWall({ y: sw.y, m: sw.m, d: sw.d, hh: ev[0], mm: ev[1] }, -1), tz); const m1 = Math.round((startEpoch - e) / 60000); if (m1 > 0 && m1 <= 40320) out.push(m1); }
  if (mo) { const e = wallToEpoch({ y: sw.y, m: sw.m, d: sw.d, hh: mo[0], mm: mo[1] }, tz); const m2 = Math.round((startEpoch - e) / 60000); if (m2 > 30) out.push(m2); }
  out.push(60);
  return [...new Set(out)].slice(0, 4);
}

export function buildFeed(items, state, tz, now = Date.now(), site = '') {
  const prefs = (state && state.prefs) || {}, course = {};
  ((state && state.courses) || []).forEach(c => { course[c.id] = c.name; });
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Homeroom//Homeroom//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Homeroom',
    'X-WR-CALDESC:Due dates and plans from Homeroom', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  const alarms = prefs.pushCal !== false;
  const alarm = (trigger, title) => ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsText(title), 'TRIGGER:' + trigger, 'END:VALARM'];
  for (const it of items) {
    if (it.status === 'done' || it.proposed || it.hidden || it.type === 'announcement' || it.type === 'absence' || !it.due) continue;
    if (it.src === 'gcal' && it.type === 'event') continue; // already on their own calendar
    const due = wallToEpoch(it.due, tz);
    if (due == null || due < now - 864e5 || due > now + 120 * 864e5) continue;
    const label = it.type === 'event' || it.type === 'study' ? '' : (MAJOR[it.type] ? LABEL[it.type] + ': ' : 'Due: ');
    const title = label + it.title + (course[it.course] ? ' \u00b7 ' + course[it.course] : '');
    const ev = ['BEGIN:VEVENT', 'UID:' + it.id + '@homeroom', 'DTSTAMP:' + utc(now), 'SUMMARY:' + icsText(title)];
    const timed = ['event', 'study'].includes(it.type) || (MAJOR[it.type] && !/T23:5\d/.test(it.due));
    if (it.allDay && !timed) {
      const d = it.due.slice(0, 10).replace(/-/g, ''), n = addDaysWall({ y: +it.due.slice(0, 4), m: +it.due.slice(5, 7), d: +it.due.slice(8, 10), hh: 0, mm: 0 }, 1);
      ev.push('DTSTART;VALUE=DATE:' + d, 'DTEND;VALUE=DATE:' + n.y + pad(n.m) + pad(n.d), 'TRANSP:TRANSPARENT');
      if (alarms) {
        const e = hm(prefs.eveningAt, '19:00'), m = hm(prefs.morningAt, '07:00');
        if (e) ev.push(...alarm('-PT' + (24 * 60 - e[0] * 60 - e[1]) + 'M', title));
        if (m) ev.push(...alarm('PT' + (m[0] * 60 + m[1]) + 'M', title));
      }
    } else {
      const start = timed ? due : due - 15 * 60000;
      const end = it.end && wallToEpoch(it.end, tz) > start ? wallToEpoch(it.end, tz) : (timed ? due + 50 * 60000 : due);
      ev.push('DTSTART:' + utc(start), 'DTEND:' + utc(end), 'TRANSP:' + (timed ? 'OPAQUE' : 'TRANSPARENT'));
      if (alarms) reminderMinutes(start, prefs, tz).forEach(min => ev.push(...alarm('-PT' + min + 'M', title)));
    }
    const url = it.url || (site ? site + '/#assignments' : '');
    if (url) ev.push('URL:' + url);
    ev.push('DESCRIPTION:' + icsText((it.url ? it.url + '\n' : '') + 'From Homeroom'), 'END:VEVENT');
    L.push(...ev);
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

const unesc = s => String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
/** Reads the events in an .ics file. Times come back as wall-clock strings in the student's time zone. */
export function parseIcs(text, tz) {
  const lines = String(text || '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = []; let cur = null, skippedRepeats = 0;
  const when = (p) => {
    if (!p) return null;
    const v = p.value.trim();
    if (/VALUE=DATE(;|$)/i.test(p.params) || /^\d{8}$/.test(v)) return { iso: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T00:00`, allDay: true };
    const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
    if (!m) return null;
    const w = { y: +m[1], m: +m[2], d: +m[3], hh: +m[4], mm: +m[5] };
    let epoch;
    if (m[7]) epoch = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm);
    else { const z = (p.params.match(/TZID=("?)([^";:]+)\1/i) || [])[2]; epoch = wallToEpoch(w, validTz(z || tz)); }
    return { iso: isoWall(epoch, tz), epoch };
  };
  for (const raw of lines) {
    if (/^BEGIN:VEVENT/i.test(raw)) { cur = {}; continue; }
    if (/^END:VEVENT/i.test(raw)) {
      if (cur) {
        if (cur.RRULE) skippedRepeats++;
        else {
          const s = when(cur.DTSTART), e = when(cur.DTEND);
          if (s && !/CANCELLED/i.test(cur.STATUS?.value || '')) events.push({ uid: cur.UID?.value || '', title: unesc(cur.SUMMARY?.value) || '(untitled)', start: s.iso, end: e && !e.allDay ? e.iso : undefined,
            allDay: s.allDay || undefined, url: cur.URL?.value || undefined, desc: unesc(cur.DESCRIPTION?.value).slice(0, 600) || undefined });
        }
      }
      cur = null; continue;
    }
    if (!cur) continue;
    const m = raw.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/i);
    if (m && !cur[m[1].toUpperCase()]) cur[m[1].toUpperCase()] = { params: m[2] || '', value: m[3] };
  }
  return { events, skippedRepeats };
}
