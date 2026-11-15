// Homeroom Sync: every so often, open each school site's assignment page in a minimized window
// (using the sign-ins already in Chrome), read the list, and send it to your Homeroom.

const DEFAULT_SITES = [
  { src: 'deltamath', name: 'DeltaMath', url: 'https://www.deltamath.com/app/student', on: true },
  { src: 'vhl', name: 'VHL Central', url: 'https://www.vhlcentral.com/', on: true },
  { src: 'savvas', name: 'Savvas Realize', url: 'https://www.savvasrealize.com/dashboard/classes', on: false },
  { src: 'albert', name: 'Albert', url: 'https://www.albert.io/assignments', on: false },
  { src: 'mcgraw', name: 'McGraw Hill', url: 'https://my.mheducation.com/', on: false },
  { src: 'pearson', name: 'Pearson', url: 'https://mlm.pearson.com/', on: false },
  { src: 'apclassroom', name: 'AP Classroom', url: 'https://apclassroom.collegeboard.org/', on: false },
  { src: 'classroom', name: 'Google Classroom to-do', url: 'https://classroom.google.com/a/not-turned-in/all', on: true },
  { src: 'genesis', name: 'Genesis (MCMS)', url: 'https://students.c2.genesisedu.net/mcmsnj/sis/view?gohome=true', on: false },
];
const HOSTS = { deltamath: /deltamath\.com/, vhl: /vhlcentral\.com/, savvas: /savvas/, albert: /albert\.io/, mcgraw: /mheducation\.com|mcgraw/, pearson: /pearson\.com/, apclassroom: /collegeboard\.org/, classroom: /classroom\.google\.com/, genesis: /genesis/ };

async function cfg() {
  const c = await chrome.storage.local.get(['code', 'sites', 'minutes', 'status', 'last']);
  const saved = c.sites || [];
  const sites = DEFAULT_SITES.map(d => Object.assign({}, d, saved.find(s => s.src === d.src) || {}));
  return { code: c.code || '', sites, minutes: c.minutes || 30, status: c.status || {}, last: c.last || null };
}
function decode(code) {
  const m = String(code || '').trim().match(/^HR1:(.+)$/);
  if (!m) return null;
  try { const o = JSON.parse(atob(m[1])); return o.u && o.k ? o : null; } catch { return null; }
}
async function schedule() {
  const { minutes } = await cfg();
  await chrome.alarms.clear('sync');
  chrome.alarms.create('sync', { periodInMinutes: Math.max(15, minutes), delayInMinutes: 1 });
}
chrome.runtime.onInstalled.addListener(async () => { await schedule(); chrome.runtime.openOptionsPage(); });
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'sync') runSync('timer'); });

function waitForLoad(tabId, ms) {
  return new Promise(resolve => {
    const done = () => { chrome.tabs.onUpdated.removeListener(fn); clearTimeout(t); resolve(); };
    const fn = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const t = setTimeout(done, ms);
    chrome.tabs.onUpdated.addListener(fn);
  });
}

/* Runs inside the school site's page: waits for it to finish drawing, then collects the rows that mention dates. */
async function extractPage() {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let last = -1, stable = 0;
  for (let i = 0; i < 36; i++) {
    const n = document.body ? document.body.innerText.length : 0;
    if (i >= 2 && document.querySelector('input[type=password]')) break;
    if (n === last && (n > 150 || i >= 6)) { if (++stable >= 3) break; } else stable = 0;
    last = n; await sleep(500);
  }
  const text = (document.body ? document.body.innerText : '').slice(0, 40000);
  const pw = !!document.querySelector('input[type=password]');
  const loggedOut = pw && (text.length < 4000 || /sign in|log in|login/i.test(document.title + ' ' + location.href));
  const dateRe = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b|\b(today|tomorrow)\b|\bdue\b/i;
  const rowSel = 'tr, li, [role=row], [role=listitem], article, [class*=assignment], [class*=Assignment], [class*=card], [class*=Card], [class*=item], [class*=row]';
  const rows = [], seen = new Set();
  for (const el of document.querySelectorAll(rowSel)) {
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (t.length < 6 || t.length > 300 || !dateRe.test(t) || seen.has(t)) continue;
    let inner = false;
    for (const ch of el.querySelectorAll(rowSel)) { const ct = (ch.innerText || '').trim(); if (ct.length >= 6 && ct.length < t.length && dateRe.test(ct)) { inner = true; break; } }
    if (inner) continue;
    seen.add(t); rows.push(t);
    if (rows.length >= 250) break;
  }
  return { url: location.href, title: document.title, text, rows, loggedOut };
}

let running = false;
async function runSync(why, only) {
  if (running) return { error: 'Already syncing' };
  const c = await cfg(), conn = decode(c.code);
  if (!conn) return { error: 'Paste your connection code from Homeroom first.' };
  const sites = c.sites.filter(s => s.on && s.url && (!only || s.src === only));
  if (!sites.length) return { error: 'Turn on at least one site.' };
  running = true;
  const status = c.status, pages = [];
  let win = null;
  try {
    win = await chrome.windows.create({ url: 'about:blank', focused: false, state: 'minimized' });
    for (const s of sites) {
      try {
        const tab = await chrome.tabs.create({ windowId: win.id, url: s.url, active: false });
        await waitForLoad(tab.id, 30000);
        const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPage });
        const r = res && res.result || {};
        pages.push({ src: s.src, url: r.url, title: r.title, text: r.text, rows: r.rows, loggedOut: r.loggedOut });
        status[s.src] = { at: Date.now(), rows: (r.rows || []).length, loggedOut: !!r.loggedOut };
        chrome.tabs.remove(tab.id).catch(() => {});
      } catch (e) { status[s.src] = { at: Date.now(), error: String(e.message || e).slice(0, 160) }; }
    }
  } finally { if (win) chrome.windows.remove(win.id).catch(() => {}); running = false; }
  let result;
  if (!pages.length) {
    result = { error: 'Couldn’t open any of your sites. Check your internet connection and the page addresses in Settings.' };
    await chrome.storage.local.set({ status, last: { at: Date.now(), why, ...result } });
    chrome.action.setBadgeText({ text: '!' });
    return result;
  }
  try {
    const res = await fetch(conn.u, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: conn.k, pages }) });
    const j = await res.json().catch(() => ({}));
    result = j.ok ? { ok: true, sent: pages.length } : { error: j.error === 'unknown_key' ? 'Homeroom didn’t recognize this code. Get a new one in Homeroom → Logins → Chrome extension.' : 'Homeroom didn’t accept the pages (' + (j.error || res.status) + ').' };
  } catch (e) { result = { error: 'Couldn’t reach your Homeroom. Check your internet connection and the connection code.' }; }
  await chrome.storage.local.set({ status, last: { at: Date.now(), why, ...result } });
  const bad = Object.values(status).some(s => s.loggedOut || s.error) || result.error;
  chrome.action.setBadgeText({ text: bad ? '!' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#B4544F' });
  return result;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'sync') { runSync('manual', msg.only).then(reply); return true; }
  if (msg.type === 'schedule') { schedule().then(() => reply({ ok: true })); return true; }
  if (msg.type === 'test') {
    const conn = decode(msg.code);
    if (!conn) { reply({ error: 'That isn’t a Homeroom connection code. It starts with HR1:' }); return; }
    fetch(conn.u, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: conn.k, ping: true }) })
      .then(r => r.json()).then(j => reply(j.ok ? { ok: true } : { error: j.error === 'unknown_key' ? 'Homeroom didn’t recognize this code.' : 'Homeroom answered with an error: ' + j.error }))
      .catch(() => reply({ error: 'Couldn’t reach your Homeroom. Check your internet connection, then copy the code again from Homeroom → Logins.' }));
    return true;
  }
  if (msg.type === 'hostFor') { const k = Object.keys(HOSTS).find(k => HOSTS[k].test(msg.url)); reply({ src: k || null }); }
});
