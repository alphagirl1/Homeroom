const $ = s => document.querySelector(s);
const ago = t => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function load() {
  const c = await chrome.storage.local.get(['code', 'sites', 'status', 'last']);
  const defaults = (await chrome.runtime.getManifest()) && null;
  const sites = (c.sites && c.sites.length ? c.sites : null);
  const status = c.status || {}, last = c.last;
  if (!c.code) { $('#status').innerHTML = '<p>Connect this extension to your Homeroom first.</p><a class="btn" href="options.html" target="_blank">Paste connection code</a>'; $('#sync').disabled = true; return; }
  const list = (sites || []).filter(s => s.on);
  $('#status').innerHTML = `<div class="row" style="justify-content:space-between"><b>Last sync</b><span class="muted">${esc(ago(last && last.at))}</span></div>
    ${last && last.error ? `<div class="note bad">${esc(last.error)}</div>` : ''}
    ${list.length ? list.map(s => { const st = status[s.src] || {}; return `<div class="row" style="justify-content:space-between"><span>${esc(s.name)}</span>${st.loggedOut ? '<span class="pill bad">Sign in to it</span>' : st.error ? '<span class="pill bad">Problem</span>' : st.at ? `<span class="pill good">${st.rows} rows</span>` : '<span class="pill">Waiting</span>'}</div>`; }).join('') : '<p class="muted">No sites turned on. Open Settings to pick them.</p>'}`;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && /^https:/.test(tab.url || '')) {
    const { src } = await chrome.runtime.sendMessage({ type: 'hostFor', url: tab.url });
    const all = await allSites();
    const site = all.find(s => s.src === src);
    $('#here').innerHTML = site ? `<div class="card stack"><b>This page is ${esc(site.name)}</b><small class="muted">Open the page that lists your assignments, then save it so Homeroom checks it automatically.</small><button class="btn" id="use">Use this page for ${esc(site.name)}</button></div>` : '';
    if (site) $('#use').onclick = async () => { site.url = tab.url; site.on = true; await chrome.storage.local.set({ sites: all }); $('#use').textContent = 'Saved. Syncing it…'; const r = await chrome.runtime.sendMessage({ type: 'sync', only: site.src }); $('#use').textContent = r.error ? r.error : 'Saved and sent to Homeroom'; load(); };
  }
}
async function allSites() {
  const c = await chrome.storage.local.get(['sites']);
  const base = [['deltamath','DeltaMath','https://www.deltamath.com/app/student'],['vhl','VHL Central','https://www.vhlcentral.com/'],['savvas','Savvas Realize','https://www.savvasrealize.com/dashboard/classes'],['albert','Albert','https://www.albert.io/assignments'],['mcgraw','McGraw Hill','https://my.mheducation.com/'],['pearson','Pearson','https://mlm.pearson.com/'],['apclassroom','AP Classroom','https://apclassroom.collegeboard.org/'],['classroom','Google Classroom to-do','https://classroom.google.com/a/not-turned-in/all'],['genesis','Genesis (MCMS)','https://students.c2.genesisedu.net/mcmsnj/sis/view?gohome=true']];
  return base.map(([src, name, url]) => Object.assign({ src, name, url, on: src === 'deltamath' || src === 'vhl' || src === 'classroom' }, (c.sites || []).find(s => s.src === src) || {}));
}
$('#sync').onclick = async () => { $('#sync').disabled = true; $('#sync').textContent = 'Syncing… (opens a minimized window)'; const r = await chrome.runtime.sendMessage({ type: 'sync' }); $('#sync').disabled = false; $('#sync').textContent = r && r.error ? 'Sync now' : 'Sent to Homeroom'; load(); };
load();
