// Small helpers shared by the Homeroom server (HTML reading, text cleanup, matching).

export const pad = n => String(n).padStart(2, '0');
export const clone = o => JSON.parse(JSON.stringify(o));
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\u00fc]+/g, ' ').trim();
export function hash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
export const safeUrl = u => /^https?:\/\/[^\s]+$/i.test(String(u || '')) ? String(u) : '';
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function decodeEntities(s) {
  return String(s || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
export function htmlToText(h) {
  return decodeEntities(String(h || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v\u00a0]+/g, ' ').replace(/\n\s*/g, '\n').trim();
}
export function snippet(h) { const b = String(h || ''); const i = b.search(/<body/i); return htmlToText(i >= 0 ? b.slice(i) : b).slice(0, 2500); }
export function attr(tag, name) {
  const m = String(tag).match(new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  return m ? decodeEntities(m[1] || m[2] || m[3] || '') : '';
}
export function hasPassword(html) { return /<input[^>]+type\s*=\s*["']?password/i.test(String(html || '')); }
export function resolveUrl(u, base) { try { return new URL(u, base).href; } catch { return u; } }

/** Finds the first form with a password box: where it posts, its hidden fields, and the user/password field names. */
export function loginForm(html) {
  const forms = String(html).match(/<form[\s\S]*?<\/form>/gi) || [];
  for (const f of forms) {
    if (!/type=["']?password/i.test(f)) continue;
    const hidden = {}; let userField = null, passField = null;
    for (const inp of f.match(/<input[^>]*>/gi) || []) {
      const name = attr(inp, 'name'), type = (attr(inp, 'type') || 'text').toLowerCase();
      if (!name) continue;
      if (type === 'hidden') hidden[name] = attr(inp, 'value') || '';
      else if (type === 'password' && !passField) passField = name;
      else if ((type === 'text' || type === 'email') && !userField) userField = name;
    }
    const open = f.match(/<form[^>]*>/i)[0];
    if (userField && passField) return { action: attr(open, 'action'), method: (attr(open, 'method') || 'post').toLowerCase(), hidden, userField, passField };
  }
  return null;
}

/* Genesis-style tables: rows with class "listrow…", cells with their <div> lines and bold text. */
export function cells(rowHtml) {
  return (rowHtml.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(td => {
    const divs = (td.match(/<div[^>]*>[\s\S]*?<\/div>/gi) || []).map(d => htmlToText(d).trim()).filter(Boolean);
    const b = td.match(/<b[^>]*>([\s\S]*?)<\/b>/i);
    return { text: htmlToText(td).replace(/\s+/g, ' ').trim(), divs, bold: b ? htmlToText(b[1]).trim() : '' };
  });
}
export function rows(html) { return (String(html).match(/<tr[^>]*class=["'][^"']*listrow[^"']*["'][^>]*>[\s\S]*?<\/tr>/gi) || []).map(cells); }
export function headerMap(html) {
  const row = (String(html).match(/<tr[^>]*class=["'][^"']*listheading[^"']*["'][^>]*>[\s\S]*?<\/tr>/i) || [])[0];
  if (!row) return {};
  const out = {};
  cells(row).forEach((c, i) => {
    const t = c.text.toLowerCase();
    if (/due|date/.test(t) && out.due === undefined) out.due = i;
    else if (/course|class/.test(t)) out.course = i;
    else if (/categ/.test(t)) out.cat = i;
    else if (/assignment|description/.test(t) && out.title === undefined) out.title = i;
    else if (/grade|score|points/.test(t) && out.grade === undefined) out.grade = i;
  });
  return out;
}
/** Any page: the text of each table row or list item, for date-finding. */
export function lineRows(html) {
  return (String(html).match(/<(tr|li)[^>]*>[\s\S]*?<\/\1>/gi) || []).map(r => htmlToText(r).replace(/\s+/g, ' ').trim())
    .filter(r => r.length > 3 && r.length < 300).slice(0, 300);
}

export function firstLine(t) { const l = String(t || '').split(/\n/).map(x => x.trim()).filter(Boolean)[0] || 'Announcement'; return l.length > 90 ? l.slice(0, 87) + '\u2026' : l; }
export function titleCase(s) { return /[a-z]/.test(s) ? s : String(s).toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\b(Ap|Ib|Ii|Iii|Iv)\b/g, w => w.toUpperCase()); }
export function guessType(title) {
  const t = norm(title);
  if (/\b(test|exam|midterm|final|prueba|examen)\b/.test(t)) return 'test';
  if (/\bprogress check\b/.test(t)) return 'assignment';
  if (/\b(quiz|quizzes)\b/.test(t)) return 'quiz';
  if (/\b(project|essay|paper|dbq|leq|presentation|portfolio|research)\b/.test(t)) return 'project';
  if (/\blab\b/.test(t)) return 'lab';
  return 'assignment';
}
export function findCourse(state, name) {
  const n = norm(name); if (!n) return null;
  const cs = (state && state.courses) || [];
  let hit = cs.find(c => norm(c.name) === n) || cs.find(c => { const cn = norm(c.name); return cn && (n.includes(cn) || cn.includes(n)); });
  if (hit) return hit;
  const words = n.split(' ').filter(w => w.length > 2 && !['honors', 'the', 'and', 'class', 'period', 'hon'].includes(w));
  let best = null, score = 0;
  for (const c of cs) { const cn = norm(c.name), s = words.filter(w => cn.includes(w)).length; if (s > score) { score = s; best = c; } }
  return best && score >= Math.min(2, words.length) ? best : null;
}
export function parseJsonLoose(s) {
  s = String(s || '').trim();
  try { return JSON.parse(s); } catch {}
  const f = s.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) { try { return JSON.parse(f[1]); } catch {} }
  const a = [s.indexOf('{'), s.indexOf('[')].filter(x => x >= 0), b = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (a.length && b > Math.min(...a)) { try { return JSON.parse(s.slice(Math.min(...a), b + 1)); } catch {} }
  return null;
}
export const SWATCH = ['#6C8EBF', '#6FA27E', '#D08C8C', '#C9A15F', '#8C7FB8', '#5FA3A8', '#D49A6A', '#B5739A', '#7C9BAA', '#97A35E'];
export const PLATFORMS = ['classroom', 'deltamath', 'vhl', 'savvas', 'genesis', 'albert', 'mcgraw', 'pearson', 'apclassroom', 'gmail', 'gcal', 'personal'];
