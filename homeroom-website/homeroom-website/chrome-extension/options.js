const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BASE = [['deltamath','DeltaMath','https://www.deltamath.com/app/student'],['vhl','VHL Central','https://www.vhlcentral.com/'],['savvas','Savvas Realize','https://www.savvasrealize.com/dashboard/classes'],['albert','Albert','https://www.albert.io/assignments'],['mcgraw','McGraw Hill','https://my.mheducation.com/'],['pearson','Pearson','https://mlm.pearson.com/'],['apclassroom','AP Classroom','https://apclassroom.collegeboard.org/'],['classroom','Google Classroom to-do','https://classroom.google.com/a/not-turned-in/all'],['genesis','Genesis (MCMS)','https://students.c2.genesisedu.net/mcmsnj/sis/view?gohome=true']];
let sites = [];
async function load() {
  const c = await chrome.storage.local.get(['code', 'sites', 'minutes', 'status']);
  $('#code').value = c.code || '';
  $('#minutes').value = String(c.minutes || 30);
  sites = BASE.map(([src, name, url]) => Object.assign({ src, name, url, on: src === 'deltamath' || src === 'vhl' || src === 'classroom' }, (c.sites || []).find(s => s.src === src) || {}));
  const st = c.status || {};
  $('#sites').innerHTML = sites.map((s, i) => `<div class="site"><input type="checkbox" id="on${i}" ${s.on ? 'checked' : ''} aria-label="Check ${esc(s.name)}"><label for="on${i}"><b>${esc(s.name)}</b></label>
    <span>${st[s.src] ? (st[s.src].loggedOut ? '<span class="pill bad">Signed out</span>' : st[s.src].error ? '<span class="pill bad">Problem</span>' : `<span class="pill good">${st[s.src].rows} rows</span>`) : ''}</span>
    <span></span><input type="url" id="url${i}" value="${esc(s.url)}" placeholder="https://… page that lists your assignments"><span></span></div>`).join('');
}
$('#save').onclick = async () => {
  const code = $('#code').value.trim();
  try { const o = JSON.parse(atob(code.replace(/^HR1:/, ''))); const origin = new URL(o.u).origin; if (!/script\.google/.test(origin)) await chrome.permissions.request({ origins: [origin + '/*'] }); } catch {}
  $('#codeMsg').innerHTML = '<span class="muted">Testing…</span>';
  const r = await chrome.runtime.sendMessage({ type: 'test', code });
  if (r.ok) { await chrome.storage.local.set({ code }); $('#codeMsg').innerHTML = '<div class="note">Connected to your Homeroom.</div>'; }
  else $('#codeMsg').innerHTML = `<div class="note bad">${esc(r.error)}</div>`;
};
$('#saveSites').onclick = async () => {
  const origins = [];
  sites.forEach((s, i) => {
    s.on = $('#on' + i).checked; s.url = $('#url' + i).value.trim();
    if (s.on && s.url) { try { const u = new URL(s.url); origins.push(u.origin + '/*'); } catch { s.on = false; } }
  });
  if (origins.length) { try { await chrome.permissions.request({ origins }); } catch {} }
  await chrome.storage.local.set({ sites, minutes: Number($('#minutes').value) });
  await chrome.runtime.sendMessage({ type: 'schedule' });
  $('#sitesMsg').textContent = 'Saved.';
  load();
};
$('#syncNow').onclick = async () => { $('#sitesMsg').textContent = 'Syncing… a minimized window opens and closes.'; const r = await chrome.runtime.sendMessage({ type: 'sync' }); $('#sitesMsg').textContent = r.error || 'Sent to Homeroom.'; load(); };
load();
