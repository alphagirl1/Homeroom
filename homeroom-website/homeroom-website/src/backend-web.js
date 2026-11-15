/* =====================================================================
   Homeroom backend for the website version (your own server on Vercel
   or your computer): Homeroom accounts, saved logins, background sync,
   phone notifications, calendar subscription.
   ===================================================================== */

VIEWS.logins = {label:'Logins', icon:'key', nav:'logins'};
SUBS.inbox = ['inbox'];
const W = {status:null, user:null, busy:{}, debug:null, extCode:'', feedUrl:'', pollTimer:null, auth:{tab:'signin', err:'', recovery:'', site:null, setup:null}, owner:null, pushOn:null, open:{}};
const LOGIN_SITES = {
  vhl:{login:'https://www.vhlcentral.com/', page:'https://www.vhlcentral.com/', hint:'Has a normal login page, so saving your password here often works.'},
  mcgraw:{login:'https://my.mheducation.com/', page:'https://my.mheducation.com/', js:true},
  savvas:{login:'https://www.savvasrealize.com/', page:'https://www.savvasrealize.com/dashboard/classes', js:true},
  deltamath:{login:'https://www.deltamath.com/app/', page:'https://www.deltamath.com/app/student', js:true},
  albert:{login:'https://www.albert.io/log-in', page:'https://www.albert.io/assignments', js:true},
  pearson:{login:'https://login.pearson.com/', page:'https://mlm.pearson.com/', js:true},
  apclassroom:{login:'https://apclassroom.collegeboard.org/', page:'https://apclassroom.collegeboard.org/', js:true},
};

/* ---------- talking to the server ---------- */
async function api(fn, body = {}){
  let res;
  try { res = await fetch('/api/' + fn, {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json', 'X-Homeroom':'1'}, body:JSON.stringify(body)}); }
  catch { throw {code:'offline', message:'Couldn’t reach Homeroom. Check your internet connection.'}; }
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 && j.error === 'signed_out') { signedOut(); throw {code:'signed_out', message:'Sign in again.'}; }
  if (res.status === 503 && j.error === 'setup') { W.auth.setup = j.setup; S.screen = 'signin'; W.auth.tab = 'setup'; render(); throw {code:'setup', message:'Homeroom isn’t set up yet.'}; }
  if (!res.ok) throw {code:j.error || 'error', message:j.message || 'Something went wrong.', debug:j.debug, status:res.status};
  return j;
}
function signedOut(){ clearInterval(W.pollTimer); S.mode = 'demo'; S.modal = null; S.screen = 'signin'; W.auth.tab = 'signin'; W.auth.err = ''; render(); }

/* ---------- storage: send only what changed ---------- */
const store = {
  snap:{items:new Map(), grades:new Map(), state:'', chat:'', avgs:'', courses:new Set()},
  timer:null, busy:false, again:false, pending:null,
  save(){ if (S.mode !== 'web') return; clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 800); },
  saveAll(){ this.save(); },
  take(){
    this.snap.items = new Map(D.items.map(i => [i.id, JSON.stringify(i)]));
    this.snap.grades = new Map(D.grades.map(g => [g.id, JSON.stringify(g)]));
    this.snap.state = JSON.stringify(D.state); this.snap.chat = JSON.stringify(D.chat.slice(-40)); this.snap.avgs = JSON.stringify(D.avgs);
    this.snap.courses = new Set(D.state.courses.map(c => c.id));
  },
  diff(){
    const p = {}, sn = this.snap;
    const list = (arr, map) => { const up = arr.filter(x => map.get(x.id) !== JSON.stringify(x)), ids = new Set(arr.map(x => x.id)), rm = [...map.keys()].filter(id => !ids.has(id)); return up.length || rm.length ? {upsert:up, remove:rm} : null; };
    const it = list(D.items, sn.items); if (it) p.items = it;
    const gr = list(D.grades, sn.grades); if (gr || JSON.stringify(D.avgs) !== sn.avgs) { p.grades = gr || {upsert:[], remove:[]}; p.grades.avgs = D.avgs; }
    if (JSON.stringify(D.state) !== sn.state) { p.state = D.state; const now = new Set(D.state.courses.map(c => c.id)); p.removedCourses = [...sn.courses].filter(id => !now.has(id)); }
    const chat = JSON.stringify(D.chat.slice(-40)); if (chat !== sn.chat) p.chat = {msgs:D.chat.slice(-40)};
    return Object.keys(p).length ? p : null;
  },
  async flush(){
    if (S.mode !== 'web') return;
    if (this.busy) { this.again = true; return this.pending; }
    const patch = this.diff(); if (!patch) return;
    this.busy = true;
    const sent = {items:new Map((patch.items?.upsert || []).map(i => [i.id, JSON.stringify(i)])), grades:new Map((patch.grades?.upsert || []).map(g => [g.id, JSON.stringify(g)]))};
    this.pending = (async () => {
      try {
        const r = await api('patch', patch);
        for (const [id, j] of sent.items) this.snap.items.set(id, j);
        for (const id of patch.items?.remove || []) this.snap.items.delete(id);
        for (const [id, j] of sent.grades) this.snap.grades.set(id, j);
        for (const id of patch.grades?.remove || []) this.snap.grades.delete(id);
        if (patch.grades) this.snap.avgs = JSON.stringify(patch.grades.avgs);
        if (patch.state) { this.snap.state = JSON.stringify(patch.state); this.snap.courses = new Set(patch.state.courses.map(c => c.id)); }
        if (patch.chat) this.snap.chat = JSON.stringify(patch.chat.msgs);
        W.status = r.status; applyServer(r.data);
      } catch (e) { if (e.code !== 'signed_out') { toast('Couldn’t save that change. Homeroom will try again.', {kind:'bad'}); setTimeout(() => this.save(), 8000); } }
      finally { this.busy = false; if (this.again) { this.again = false; this.flush(); } }
    })();
    return this.pending;
  },
};
/* Merge a fresh server copy without losing edits made since the last save. */
function applyServer(data, o = {}){
  if (!data) return;
  const sn = store.snap;
  if (o.initial) {
    D.state = fillDefaults(data.state); D.items = data.items?.list || []; D.grades = data.grades?.list || []; D.avgs = data.grades?.avgs || {}; D.chat = data.chat?.msgs || [];
    store.take();
    if (P().tz !== TZ) { P().tz = TZ; store.save(); }
    return;
  }
  const mergeList = (local, server, map) => {
    const byId = new Map(local.map(x => [x.id, x])), sIds = new Set();
    for (const sx of server) {
      sIds.add(sx.id);
      const lx = byId.get(sx.id), sj = JSON.stringify(sx);
      if (!lx) { if (!map.has(sx.id)) { local.push(sx); map.set(sx.id, sj); } }
      else if (JSON.stringify(lx) === map.get(sx.id) && sj !== map.get(sx.id)) { Object.keys(lx).forEach(k => delete lx[k]); Object.assign(lx, sx); map.set(sx.id, sj); }
    }
    for (let i = local.length - 1; i >= 0; i--) { const lx = local[i]; if (!sIds.has(lx.id) && map.has(lx.id) && JSON.stringify(lx) === map.get(lx.id)) { local.splice(i, 1); map.delete(lx.id); } }
  };
  mergeList(D.items, data.items?.list || [], sn.items);
  mergeList(D.grades, data.grades?.list || [], sn.grades);
  if (JSON.stringify(D.avgs) === sn.avgs) { D.avgs = data.grades?.avgs || {}; sn.avgs = JSON.stringify(D.avgs); }
  if (data.state) {
    if (JSON.stringify(D.state) === sn.state) { D.state = fillDefaults(data.state); sn.state = JSON.stringify(D.state); sn.courses = new Set(D.state.courses.map(c => c.id)); applyTheme(); }
    else { const have = new Set(D.state.courses.map(c => c.id)); for (const c of data.state.courses || []) if (!have.has(c.id) && !sn.courses.has(c.id)) { D.state.courses.push(c); sn.courses.add(c.id); } }
  }
  renderSoon();
  if (S.modal?.kind === 'settings') renderOverlay();
}
async function poll(){
  if (document.hidden || S.screen !== 'app' || store.busy) return;
  try { const r = await api('pull'); W.status = r.status; applyServer(r.data); } catch {}
}

/* ---------- AI (the student's own key, or one the site owner shares) ---------- */
function parseLoose(s){
  s = String(s || '').trim();
  try { return JSON.parse(s); } catch {}
  const f = s.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) { try { return JSON.parse(f[1]); } catch {} }
  const a = [s.indexOf('{'), s.indexOf('[')].filter(x => x >= 0), b = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (a.length && b > Math.min(...a)) { try { return JSON.parse(s.slice(Math.min(...a), b + 1)); } catch {} }
  throw {code:'invalid_json'};
}
async function fileToB64(file){
  const img = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return {b64:c.toDataURL('image/jpeg', .85).split(',')[1], type:'image/jpeg'};
}
function aiErrorText(e){
  const m = String(e?.message || '');
  if (e?.code === 'invalid_json') return 'The AI’s answer wasn’t in the expected format. Try again.';
  if (e?.code === 'no_key' || /NO_KEY/.test(m)) return 'Add a Claude API key in Settings → Sync & calendar to use this.';
  if (e?.code === 'ai_limit') return `You’ve used today’s shared AI (${W.status?.aiPerDay || ''} requests). It resets tomorrow, or add your own key in Settings.`;
  if (/AI 401|invalid x-api-key|authentication/i.test(m)) return 'The Claude API key didn’t work. Check it in Settings → Sync & calendar.';
  if (/AI 429|rate/i.test(m)) return 'The AI is busy or hit a usage limit. Try again in a minute.';
  if (/AI 4\d\d/.test(m)) return 'The AI couldn’t handle that. Try a smaller page or a clearer screenshot.';
  return m ? m.slice(0, 160) : 'Something went wrong. Try again.';
}

/* ---------- small helpers for the panes ---------- */
const ago2 = t => t ? ago(t) : 'never';
const bb = (k, label, busy) => W.busy[k] ? `<button class="btn sm" disabled>${busy || 'Working…'}</button>` : label;
async function busy(k, fn){ W.busy[k] = true; rerender(); try { return await fn(); } finally { W.busy[k] = false; rerender(); } }
function rerender(){ if (S.modal?.kind === 'settings') renderOverlay(); if (S.view === 'logins' || S.screen !== 'app') { S.screen === 'app' ? renderView() : render(); } }
function srcPill(name){ const s = W.status?.sources?.[name]; if (!s) return '<span class="pill none">Not checked yet</span>'; return s.ok ? `<span class="pill good">${ic('check')} Working · ${esc(ago2(s.at))}</span>` : '<span class="pill warn">Needs attention</span>'; }
const cronOk = () => { const c = W.status?.cron; return !!(c && Date.now() - c.last < 45 * 60e3); };
async function copyText(t, okMsg){ try { await navigator.clipboard.writeText(t); toast(okMsg || 'Copied'); } catch { toast('Select the text and copy it (Ctrl+C or ⌘C).'); } }
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function b64ToBytes(s){ const p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); }
async function pushState(){
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); return sub ? 'on' : (Notification.permission === 'denied' ? 'blocked' : 'off'); } catch { return 'off'; }
}

/* ---------- sign in / create account / reset / first-time setup ---------- */
function authHTML(){
  const a = W.auth, site = a.site || {}, t = a.tab;
  const brand = `<div class="brand" style="font-size:1.25rem"><span class="logo">H</span><span>${esc(site.name || 'Homeroom')}</span></div>`;
  if (t === 'setup') return setupHTML();
  if (t === 'recovery') return `<div class="signin-side"><div class="signin-card">${brand}
    <h2>Save your recovery code</h2>
    <p>If you ever forget your password, this code is the only way back into your account. Write it down or save it in your notes app.</p>
    <div class="codebox" id="rec-code">${esc(a.recovery)}</div>
    <div class="hstack"><button class="btn" data-act="w-copy" data-text="${esc(a.recovery)}">${ic('clip')} Copy</button></div>
    <button class="btn primary" data-act="w-continue" style="justify-content:center">I saved it, continue</button></div></div>`;
  const tabs = `<div class="signin-tabs" role="tablist"><button role="tab" aria-pressed="${t === 'signin'}" data-act="w-tab" data-v="signin">Sign in</button><button role="tab" aria-pressed="${t === 'signup'}" data-act="w-tab" data-v="signup">Create account</button></div>`;
  const err = a.err ? `<div class="banner bad" role="alert">${ic('warn')}<p class="grow small">${esc(a.err)}</p></div>` : '';
  const pw = (id, label, ac) => `<div class="field"><label for="${id}">${label}</label><div class="pw-wrap"><input id="${id}" name="password" type="password" required minlength="${ac === 'current-password' ? 1 : 8}" autocomplete="${ac}"><button class="icon-btn" type="button" data-act="w-peek" data-for="${id}" aria-label="Show password" title="Show password">${ic('eye')}</button></div></div>`;
  let body = '';
  if (t === 'signin') body = `<form class="stack-s" data-form="w-signin">
      <div class="field"><label for="a-user">Username</label><input id="a-user" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required value="${esc(a.username || '')}"></div>
      ${pw('a-pass', 'Password', 'current-password')}
      ${err}<button class="btn primary" type="submit" style="justify-content:center" ${W.busy.auth ? 'disabled' : ''}>${W.busy.auth ? 'Signing in…' : 'Sign in'}</button>
      <button class="btn ghost sm" type="button" data-act="w-tab" data-v="reset">Forgot your password?</button></form>`;
  else if (t === 'signup') body = `<form class="stack-s" data-form="w-signup">
      ${site.hasOwner === false ? `<div class="banner">${ic('spark')}<p class="grow small">You’re the first one here, so this account runs this Homeroom. You’ll get an invite link to send your friends.</p></div>` : ''}
      <div class="field"><label for="a-user">Pick a username</label><input id="a-user" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required pattern="[A-Za-z0-9._\\-]{3,30}" title="3–30 letters, numbers, dots, dashes or underscores" value="${esc(a.username || '')}"></div>
      ${pw('a-pass', 'Pick a password (8+ characters)', 'new-password')}
      ${site.inviteRequired ? `<div class="field"><label for="a-inv">Invite code</label><input id="a-inv" name="invite" autocapitalize="characters" spellcheck="false" required placeholder="ABCD-1234" value="${esc(a.invite || '')}"><span class="small muted">From the person who sent you this Homeroom.</span></div>` : ''}
      ${err}<button class="btn primary" type="submit" style="justify-content:center" ${W.busy.auth ? 'disabled' : ''}>${W.busy.auth ? 'Creating…' : 'Create account'}</button>
      <p class="small muted">Use a password you don’t use anywhere else. Homeroom doesn’t need your email.</p></form>`;
  else if (t === 'reset') body = `<form class="stack-s" data-form="w-reset"><h2>Reset your password</h2>
      <div class="field"><label for="a-user">Username</label><input id="a-user" name="username" autocapitalize="none" required value="${esc(a.username || '')}"></div>
      <div class="field"><label for="a-rec">Recovery code</label><input id="a-rec" name="recovery" autocapitalize="characters" required placeholder="ABCD-EFGH-JKLM"><span class="small muted">You saved it when you made your account. Lost it? Ask the person who runs this Homeroom to remove your account so you can make a new one.</span></div>
      ${pw('a-pass', 'New password (8+ characters)', 'new-password')}
      ${err}<button class="btn primary" type="submit" style="justify-content:center" ${W.busy.auth ? 'disabled' : ''}>${W.busy.auth ? 'Saving…' : 'Reset password'}</button>
      <button class="btn ghost sm" type="button" data-act="w-tab" data-v="signin">Back to sign in</button></form>`;
  return `<div class="signin-side"><div class="signin-card">${brand}
    <p class="muted">Assignments, grades, due dates and announcements from all your school sites, in one place.</p>
    ${t === 'reset' ? '' : tabs}${body}
    <div class="privacy">${ic('lock')}<p>Your account is private. Passwords you save for school sites are encrypted.</p></div></div></div>`;
}
function setupHTML(){
  const s = W.auth.setup || {}, row = (ok, title, how) => `<li class="check ${ok ? 'ok' : ''}"><span class="ic">${ok ? ic('check') : ic('warn')}</span><div><b>${title}</b>${ok ? '' : `<div class="small">${how}</div>`}</div></li>`;
  return `<div class="signin-side"><div class="signin-card" style="width:min(560px,100%)"><div class="brand" style="font-size:1.25rem"><span class="logo">H</span><span>Almost there</span></div>
    <p>Homeroom is online but needs two things from its settings in Vercel. Do both, then press <b>Redeploy</b> in Vercel and reload this page.</p>
    <ol class="checklist">
      ${row(s.db, 'A database', 'In Vercel open your project → <b>Storage</b> → <b>Create Database</b> → <b>Upstash for Redis</b> (free) → <b>Connect</b>.')}
      ${row(s.secret, 'A secret key', `In Vercel open <b>Settings → Environment Variables</b>, add the name <code>HOMEROOM_SECRET</code> with this value, and save:${s.suggestedSecret ? `<div class="codebox" style="margin-top:6px">${esc(s.suggestedSecret)}</div><button class="btn sm" style="margin-top:6px" data-act="w-copy" data-text="${esc(s.suggestedSecret)}">${ic('clip')} Copy</button>` : ''}${s.secretTooShort ? '<div class="small" style="color:var(--bad)">The one you set is too short. Use at least 16 characters.</div>' : ''}`)}
    </ol>
    <button class="btn primary" onclick="location.reload()" style="justify-content:center">I did both, check again</button>
    <p class="small muted">The secret encrypts saved passwords. Never share it or change it later (saved logins would stop working).</p></div></div>`;
}

/* ---------- the Logins page ---------- */
function loginCard(k){
  const st = W.status || {}, l = (st.logins || []).find(x => x.src === k), d = LOGIN_SITES[k], ext = st.ext?.sites?.[k], open = W.open[k] || (!l && W.open._all);
  const status = l ? (l.ok ? `<span class="pill good">${ic('check')} Signed in · ${esc(ago2(l.last))}</span>` : `<span class="pill warn">Not working</span>`) : ext ? (ext.loggedOut ? '<span class="pill warn">Extension: signed out</span>' : `<span class="pill good">Extension · ${esc(ago2(ext.at))}</span>`) : '<span class="pill none">Not added</span>';
  return `<div class="site-card" style="--c:${srcColor(k)}">
    <button class="site-head" type="button" data-act="w-open" data-k="${k}" aria-expanded="${!!open}"><span class="mono">${esc(SOURCES[k]?.mono || '?')}</span><span class="grow"><b>${esc(srcName(k))}</b>${l ? `<span class="small muted" style="display:block">${esc(l.user)}${l.note ? ' · ' + esc(l.note) : ''}</span>` : ''}</span>${status}${ic(open ? 'down' : 'right')}</button>
    ${open ? `<form class="stack-s site-body" data-form="w-login" data-src="${k}">
      ${d.js ? `<p class="small muted">${ic('warn')} ${esc(srcName(k))} signs in with JavaScript, so a saved password often can’t work from the server. If it says “Not working”, the Chrome extension below reads it using your Chrome sign-in instead.</p>` : `<p class="small muted">${esc(d.hint || '')}</p>`}
      <div class="row-2"><div class="field"><label for="lg-u-${k}">Username or email</label><input id="lg-u-${k}" name="user" autocomplete="off" autocapitalize="none" spellcheck="false" required value="${esc(l?.user || '')}"></div>
        <div class="field"><label for="lg-p-${k}">Password</label><input id="lg-p-${k}" name="pass" type="password" autocomplete="new-password" ${l ? 'placeholder="Saved. Leave blank to keep it"' : 'required'}></div></div>
      <details ${l && !l.ok ? 'open' : ''}><summary class="small">Page addresses</summary><div class="stack-s" style="margin-top:8px">
        <div class="field"><label for="lg-l-${k}">Login page</label><input id="lg-l-${k}" name="loginUrl" type="url" required value="${esc(l?.loginUrl || d.login)}"></div>
        <div class="field"><label for="lg-g-${k}">Page that lists your assignments</label><input id="lg-g-${k}" name="pageUrl" type="url" value="${esc(l?.pageUrl || d.page)}"><span class="small muted">Sign in on that site, open your assignments, and copy the address from the top of the browser.</span></div></div></details>
      ${l && !l.ok && l.note ? `<div class="banner warn">${ic('warn')}<p class="grow small">${esc(l.note)}${l.fails >= 3 ? ' Homeroom stopped trying automatically so the site doesn’t lock your account. Save it again to retry.' : ''}</p></div>` : ''}
      <div class="hstack">${bb('login-' + k, `<button class="btn sm primary" type="submit">${l ? 'Save &amp; test' : 'Save &amp; sign in'}</button>`, 'Signing in…')}${l ? `<button class="btn sm ghost danger" type="button" data-act="w-login-del" data-id="${esc(l.id)}">Remove</button>` : ''}<a class="btn sm ghost" href="${esc(d.login)}" target="_blank" rel="noopener">${ic('ext')} Open ${esc(srcName(k, true))}</a></div>
    </form>` : ''}</div>`;
}
function loginsPage(){
  const st = W.status || {}, g = st.genesis, ext = Object.entries(st.ext?.sites || {});
  const gOpen = W.open.genesis ?? !g?.on;
  return `${pageHead('Logins', 'Save your usernames and passwords for school sites. Homeroom signs in for you and checks for new work on its own.')}
  <div class="banner">${ic('lock')}<p class="grow small">Passwords are encrypted and only used to sign in for you. The person who runs this Homeroom site could technically get to them, so only use a Homeroom run by someone you trust.</p></div>
  <div class="logins-grid">
  <section class="card stack-s"><div class="card-head"><h2>${ic('grades')} Genesis</h2>${g?.on ? srcPill('genesis') : '<span class="pill none">Not connected</span>'}</div>
    <p class="small muted">Grades, assignments, missing work and attendance, the same way GradeScout gets them.</p>
    ${g?.on ? `<div class="between"><span class="small">Signed in as <b>${esc(g.user)}</b>${g.note ? ' · ' + esc(g.note) : ''}</span><button class="btn sm ghost" data-act="w-open" data-k="genesis">${gOpen ? 'Hide' : 'Change'}</button></div>` : ''}
    ${!g?.ok && g?.on && st.sources?.genesis?.error ? `<div class="banner warn">${ic('warn')}<p class="grow small">${esc(st.sources.genesis.error)}</p></div>` : ''}
    ${gOpen ? `<form class="stack-s" data-form="w-genesis">
      <div class="row-2"><div class="field"><label for="gen-user">Genesis username</label><input id="gen-user" name="user" autocomplete="off" autocapitalize="none" spellcheck="false" required value="${esc(g?.user || '')}"></div>
        <div class="field"><label for="gen-pass">Genesis password</label><input id="gen-pass" name="pass" type="password" autocomplete="new-password" ${g?.on ? 'placeholder="Saved. Leave blank to keep it"' : 'required'}></div></div>
      <details><summary class="small">Genesis address</summary><div class="field" style="margin-top:8px"><label for="gen-url">Login page</label><input id="gen-url" name="url" type="url" required value="${esc(g?.url || GENESIS_URL)}"><span class="small muted">Set to the Middlesex County Magnet Schools student portal. <a href="${GENESIS_URL}" target="_blank" rel="noopener">Open it</a>.</span></div></details>
      <div class="hstack">${bb('genesis', `<button class="btn sm primary" type="submit">${g?.on ? 'Save &amp; test' : 'Connect Genesis'}</button>`, 'Signing in to Genesis…')}${g?.on ? '<button class="btn sm ghost danger" type="button" data-act="w-genesis-off">Disconnect</button>' : ''}<button class="btn sm ghost" type="button" data-act="w-debug">Debug info</button></div>
    </form>` : ''}
    ${W.debug ? `<pre class="debug" id="dbg">${esc(W.debug)}</pre><div class="hstack"><button class="btn sm" data-act="w-copy" data-text="${esc(W.debug)}">${ic('clip')} Copy debug info</button><span class="small muted">It includes some of your grades. Only share it with someone you trust.</span></div>` : ''}
  </section>
  <section class="card stack-s"><div class="card-head"><h2>${ic('plug')} Chrome extension</h2>${ext.length ? `<span class="pill good">Connected</span>` : '<span class="pill none">Not set up</span>'}</div>
    <p class="small">For sites that use “Sign in with Google” or won’t take a saved password: <b>Google Classroom, DeltaMath, Savvas, McGraw Hill, Pearson, AP Classroom, Albert</b>. Every 30 minutes it opens each site in a hidden window with the sign-ins already in your Chrome and sends the list here.</p>
    <ol class="steps small"><li><a href="/homeroom-chrome-extension.zip" download>Download the extension</a> and unzip it somewhere you’ll keep it.</li><li>In Chrome go to <b>chrome://extensions</b>, turn on <b>Developer mode</b>, click <b>Load unpacked</b>, and pick the unzipped folder.</li><li>Paste your connection code into the extension.</li></ol>
    <div class="hstack">${W.extCode ? '' : `<button class="btn sm primary" data-act="w-extcode">${ic('link')} Get my connection code</button>`}${st.ext?.key ? '<button class="btn sm ghost" data-act="w-extreset">Make a new code</button>' : ''}</div>
    ${W.extCode ? `<div class="field"><label for="ext-code">Your connection code</label><div class="hstack" style="flex-wrap:nowrap"><input id="ext-code" readonly value="${esc(W.extCode)}" style="flex:1"><button class="btn sm" data-act="w-copy" data-text="${esc(W.extCode)}" data-msg="Copied. Paste it into the extension.">${ic('clip')} Copy</button></div><span class="small muted">Works only for your account. Don’t share it.</span></div>` : ''}
    ${ext.length ? `<div class="stack-s">${ext.map(([k, s]) => `<div class="between small"><span class="hstack"><span class="dot" style="--c:${srcColor(k)}"></span>${esc(srcName(k))}</span><span class="${s.loggedOut ? 'pill warn' : 'muted'}">${s.loggedOut ? 'Signed out. Sign in to it in Chrome' : `${s.n || 0} items · ${esc(ago2(s.at))}`}</span></div>`).join('')}</div>` : ''}
    <p class="small muted">It only runs while Chrome is open on a computer. School-managed Chromebooks usually block it.</p>
  </section>
  </div>
  <section class="card stack-s" style="margin-top:var(--gap)"><div class="card-head"><h2>${ic('key')} School sites</h2><button class="btn sm ghost" data-act="w-open" data-k="_all">${W.open._all ? 'Collapse' : 'Show all'}</button></div>
    <p class="small muted">Save a username and password, and Homeroom tries to sign in from its server. It works for sites with a plain login page; the extension covers the rest.</p>
    <div class="sites">${Object.keys(LOGIN_SITES).map(loginCard).join('')}</div>
  </section>
  <section class="card stack-s" style="margin-top:var(--gap)"><div class="card-head"><h2>${ic('cal')} Calendar links</h2></div>
    <p class="small">Add any calendar that has an iCal (.ics) link: your own Google Calendar, a school or team calendar, a Classroom class calendar. In Google Calendar: <b>Settings → click the calendar → Integrate calendar → Secret address in iCal format</b>.</p>
    ${(st.cals || []).map(c => `<div class="between small"><span class="hstack"><span class="dot" style="--c:${srcColor('gcal')}"></span><b>${esc(c.name)}</b><span class="muted">${esc(c.note || '')}</span></span><span class="hstack">${c.ok === false ? '<span class="pill warn">Problem</span>' : `<span class="muted">${esc(ago2(c.last))}</span>`}<button class="icon-btn" data-act="w-cal-del" data-id="${esc(c.id)}" aria-label="Remove ${esc(c.name)}">${ic('trash')}</button></span></div>`).join('')}
    <form class="row-2" data-form="w-calimport" style="align-items:end"><div class="field"><label for="ci-name">Name</label><input id="ci-name" name="name" required placeholder="My calendar"></div>
      <div class="field"><label for="ci-url">iCal link</label><div class="hstack" style="flex-wrap:nowrap"><input id="ci-url" name="url" type="url" required placeholder="https://calendar.google.com/…/basic.ics" style="flex:1">${bb('calimport', '<button class="btn sm primary" type="submit">Add</button>', 'Checking…')}</div></div></form>
  </section>`;
}

/* ---------- settings panes ---------- */
function syncPane(){
  const st = W.status || {}, p = P();
  return `<h2>Sync &amp; calendar</h2>
  <div class="set-sec"><div class="between"><div><b>Automatic sync</b><div class="small muted">${p.autoSync === false ? 'Off. Homeroom updates when you press Sync now.' : cronOk() ? `On · checks every ${esc(p.syncMinutes)} minutes, even when Homeroom is closed · last ${esc(ago2(st.lastSync))}` : `On · last ${esc(ago2(st.lastSync))}. ${st.owner ? 'Finish the timer setup in Settings → Run this site so it also runs while Homeroom is closed.' : 'Right now it updates when you open Homeroom; the background timer isn’t running on this site yet.'}`}</div></div>
      <span class="hstack">${bb('sync', `<button class="btn sm" data-act="sync">${ic('refresh')} Sync now</button>`, 'Syncing…')}</span></div>
    <label class="toggle"><input type="checkbox" id="o-auto" data-chg="pref-bool" data-k="autoSync" ${p.autoSync !== false ? 'checked' : ''}> Sync automatically</label>
    <div class="field"><label for="o-every">Check every</label><select id="o-every" data-chg="pref-num" data-k="syncMinutes" style="max-width:220px">${[15, 30, 60].map(m => `<option value="${m}" ${+p.syncMinutes === m ? 'selected' : ''}>${m} minutes</option>`).join('')}</select></div>
    <a class="btn sm" href="#logins" data-act="w-go" data-view="logins" style="justify-self:start">${ic('key')} Manage logins</a></div>
  <div class="set-sec"><h3>Your due dates on your phone’s calendar</h3>
    <p class="small">Subscribe once and your Homeroom due dates show up in Google Calendar or Apple Calendar, with reminders the night before and that morning.</p>
    ${W.feedUrl ? `<div class="field"><label for="feed-url">Your private calendar link</label><div class="hstack" style="flex-wrap:nowrap"><input id="feed-url" readonly value="${esc(W.feedUrl)}" style="flex:1"><button class="btn sm" data-act="w-copy" data-text="${esc(W.feedUrl)}">${ic('clip')} Copy</button></div></div>
      <div class="hstack"><a class="btn sm primary" href="https://calendar.google.com/calendar/r?cid=${encodeURIComponent(W.feedUrl.replace(/^https?:/, 'webcal:'))}" target="_blank" rel="noopener">${ic('cal')} Add to Google Calendar</a><a class="btn sm" href="${esc(W.feedUrl.replace(/^https?:/, 'webcal:'))}">${ic('cal')} Add to Apple Calendar</a><button class="btn sm ghost" data-act="w-feedreset">New link</button></div>
      <p class="small muted">Google Calendar can take several hours to pick up changes; Apple Calendar checks more often. Anyone with this link can see your due dates, so keep it to yourself. “New link” turns off the old one.</p>`
      : `<button class="btn sm primary" data-act="w-feed" style="justify-self:start">${ic('link')} Get my calendar link</button>`}
    <label class="toggle"><input type="checkbox" id="o-pushcal" data-chg="pref-bool" data-k="pushCal" ${p.pushCal !== false ? 'checked' : ''}> Include reminders</label>
    <div class="row-2"><div class="field"><label for="o-eve">Night-before reminder</label><input id="o-eve" type="time" data-chg="pref-time" data-k="eveningAt" value="${esc(p.eveningAt || '19:00')}"></div>
      <div class="field"><label for="o-morn">Same-day reminder</label><input id="o-morn" type="time" data-chg="pref-time" data-k="morningAt" value="${esc(p.morningAt || '07:00')}"></div></div></div>
  <div class="set-sec"><h3>AI (optional)</h3>
    ${st.aiSite ? `<div class="banner">${ic('spark')}<p class="grow small">The person who runs this Homeroom shares an AI key: up to ${esc(st.aiPerDay)} AI requests a day for you. Add your own key for unlimited use.</p></div>` : ''}
    <p class="small">A Claude API key turns on the AI planner, smarter reading of pages, and date-finding in announcements. You pay Anthropic per use (usually cents a day). Get one at console.anthropic.com.</p>
    <form class="hstack" data-form="w-aikey" style="flex-wrap:nowrap"><label class="sr" for="ai-key">Claude API key</label><input id="ai-key" name="key" type="password" autocomplete="off" placeholder="${st.aiKey ? 'Key saved. Paste a new one to replace it' : 'sk-ant-…'}" style="flex:1">${bb('aikey', `<button class="btn sm" type="submit">${st.aiKey ? 'Replace' : 'Save'}</button>`, 'Checking…')}${st.aiKey ? '<button class="btn sm ghost danger" type="button" data-act="w-aikey-off">Remove</button>' : ''}</form></div>
  <div class="set-sec"><h3>Import a page by hand</h3><p class="small muted">Copy a page or take a screenshot of any site, and Homeroom adds what’s new.</p><div class="hstack">${IMPORTABLE.filter(k => k !== 'personal').map(k => `<button class="btn sm" data-act="import" data-src="${k}">${esc(srcName(k, true))}</button>`).join('')}</div></div>`;
}
function notifyPane(){
  const p = P(), i = p.instant, ps = W.pushOn;
  let device;
  if (ps === 'unsupported' || (isIOS() && !standalone())) device = `<div class="banner">${ic('bell')}<p class="grow small">${isIOS() ? 'On iPhone or iPad: open Homeroom in <b>Safari</b>, tap <b>Share → Add to Home Screen</b>, open Homeroom from your home screen, and turn notifications on there.' : 'This browser can’t show notifications. Try Chrome, Edge, Firefox or Safari.'}</p></div>`;
  else if (ps === 'blocked') device = `<div class="banner warn">${ic('warn')}<p class="grow small">Notifications are blocked for this site. Allow them in your browser’s site settings (the icon next to the address), then come back.</p></div>`;
  else if (ps === 'on') device = `<div class="between"><span class="pill good">${ic('check')} On for this device</span><span class="hstack">${bb('ptest', '<button class="btn sm" data-act="w-push-test">Send a test</button>', 'Sending…')}<button class="btn sm ghost" data-act="w-push-off">Turn off here</button></span></div>`;
  else device = `<div>${bb('pon', `<button class="btn sm primary" data-act="w-push-on">${ic('bell')} Turn on notifications on this device</button>`, 'Turning on…')}</div>`;
  return `<div class="set-sec"><h3>Phone and computer notifications</h3>
    ${device}
    <p class="small muted">${W.status?.push?.n ? `${W.status.push.n} device${W.status.push.n === 1 ? '' : 's'} get notifications.` : 'Turn it on on each phone or computer you use.'} ${cronOk() ? '' : 'They arrive when Homeroom syncs, so they work best once the site’s background timer is running.'}</p>
    <span class="label">Tell me right away about</span>
    ${[['grades', 'New grades'], ['missing', 'Work marked missing'], ['assignments', 'New assignments'], ['announcements', 'New announcements']].map(([k, l]) => `<label class="toggle small"><input type="checkbox" id="in-${k}" data-chg="instant" data-k="${k}" ${i[k] ? 'checked' : ''}> ${l}</label>`).join('')}
    <label class="toggle"><input type="checkbox" id="o-digest" data-chg="pref-bool" data-k="digest" ${p.digest !== false ? 'checked' : ''}> Morning summary</label>
    <div class="field"><label for="o-dhour">Send it at</label><select id="o-dhour" data-chg="pref-num" data-k="digestHour" style="max-width:200px">${[5, 6, 7, 8, 15, 16, 17, 18, 19, 20].map(h => `<option value="${h}" ${+p.digestHour === h ? 'selected' : ''}>${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}</option>`).join('')}</select></div></div>
  <div class="set-sec"><h3>Calendar reminders</h3><p class="small">Set in Settings → Sync &amp; calendar, with your private calendar link.</p><button class="btn sm" data-act="set-tab" data-v="accounts" style="justify-self:start">Open Sync &amp; calendar</button></div>`;
}
function ownerPane(){
  const o = W.owner;
  if (!o) { if (!W.busy.owner) setTimeout(loadOwner, 0); return '<h2>Run this site</h2><p class="muted">Loading…</p>'; }
  const invite = o.invite?.code ? `${location.origin}/#join=${o.invite.code}` : location.origin;
  const c = o.cron || {}, live = c.last && Date.now() - c.last < 45 * 60e3;
  return `<h2>Run this site</h2>
  <div class="set-sec"><h3>Invite friends</h3>
    ${o.invite?.on !== false ? `<p class="small">Send this link. It fills in the invite code for them.</p>
      <div class="hstack" style="flex-wrap:nowrap"><input readonly value="${esc(invite)}" aria-label="Invite link" style="flex:1"><button class="btn sm primary" data-act="w-copy" data-text="${esc(invite)}" data-msg="Invite link copied">${ic('clip')} Copy link</button></div>
      <p class="small muted">Invite code: <b>${esc(o.invite.code)}</b> · ${o.users.length} of ${o.maxUsers} spots used</p>
      <div class="hstack"><button class="btn sm" data-act="w-owner" data-a="invite" data-new="1">New code</button><button class="btn sm ghost" data-act="w-owner" data-a="invite" data-on="0">Let anyone with the link join</button></div>`
      : `<p class="small">Anyone with the link can make an account.</p><button class="btn sm" data-act="w-owner" data-a="invite" data-on="1">Require an invite code</button>`}
    <div class="field"><label for="ow-max">Most accounts allowed</label><input id="ow-max" type="number" min="1" max="500" value="${esc(o.maxUsers)}" data-chg="w-maxusers" style="max-width:120px"></div></div>
  <div class="set-sec"><h3>Background timer ${live ? `<span class="pill good">${ic('check')} Running</span>` : '<span class="pill warn">Not set up</span>'}</h3>
    <p class="small">${live ? `Last ran ${esc(ago2(c.last))}: ${c.ran || 0} synced, ${c.users || 0} accounts.` : 'Homeroom needs something to wake it up every few minutes so it syncs while nobody has it open. A free service does that:'}</p>
    <ol class="steps small"><li>Go to <a href="https://cron-job.org" target="_blank" rel="noopener">cron-job.org</a> and make a free account.</li><li>Click <b>Create cronjob</b>. Title: Homeroom. URL: the link below.</li><li>Set it to run <b>every 5 minutes</b>, then <b>Create</b>.</li></ol>
    <div class="hstack" style="flex-wrap:nowrap"><input readonly value="${esc(c.url || '')}" aria-label="Timer link" style="flex:1"><button class="btn sm" data-act="w-copy" data-text="${esc(c.url || '')}">${ic('clip')} Copy</button></div>
    <p class="small muted">Keep this link private; it only starts a sync. ${bb('cron', '<button class="btn sm ghost" data-act="w-owner" data-a="cron">Run it once now</button>', 'Running…')}</p></div>
  <div class="set-sec"><h3>Share your AI key</h3>
    <p class="small">Let your friends use the AI planner with your Claude API key, with a daily limit for each person. You pay for their use.</p>
    <form class="stack-s" data-form="w-aishare"><label class="toggle"><input type="checkbox" name="on" ${o.aiShare?.on ? 'checked' : ''}> Share my key</label>
      <div class="row-2"><div class="field"><label for="ow-key">Claude API key</label><input id="ow-key" name="key" type="password" autocomplete="off" placeholder="${o.siteAiKey ? 'Saved. Leave blank to keep it' : 'sk-ant-…'}"></div>
        <div class="field"><label for="ow-day">Requests per person per day</label><input id="ow-day" name="perDay" type="number" min="1" max="500" value="${esc(o.aiShare?.perDay || 40)}"></div></div>
      <div>${bb('aishare', '<button class="btn sm" type="submit">Save</button>', 'Saving…')}</div></form></div>
  <div class="set-sec"><h3>Accounts (${o.users.length})</h3>
    ${o.users.map(u => `<div class="between small" style="border-top:1px solid var(--line);padding-top:6px"><span><b>${esc(u.username)}</b>${u.me ? ' (you)' : ''} <span class="muted">joined ${esc(fmtDate(new Date(u.created)))} · synced ${esc(ago2(u.lastSync))}</span></span>${u.me ? '' : `<button class="btn sm ghost danger" data-act="w-owner-rm" data-uid="${esc(u.uid)}" data-name="${esc(u.username)}">Remove</button>`}</div>`).join('')}
    <p class="small muted">Removing an account deletes all of its data. Storage: ${esc(o.db)}${o.storage?.keys ? ' · ' + o.storage.keys + ' keys' : ''}.</p></div>`;
}
async function loadOwner(){ if (W.busy.owner) return; W.busy.owner = true; try { W.owner = await api('owner', {}); } catch (e) { toast(e.message, {kind:'bad'}); } W.busy.owner = false; if (S.modal?.kind === 'settings') renderOverlay(); }
function accountExtra(){
  return `<div class="set-sec"><h3>Your Homeroom account</h3>
    <div class="between"><span>Signed in as <b>${esc(W.user?.username || '')}</b></span><button class="btn sm" data-act="w-signout">Sign out</button></div>
    <details><summary class="small"><b>Change password</b></summary><form class="stack-s" data-form="w-password" style="margin-top:8px">
      <div class="row-2"><div class="field"><label for="pw-old">Current password</label><input id="pw-old" name="old" type="password" autocomplete="current-password" required></div>
      <div class="field"><label for="pw-new">New password</label><input id="pw-new" name="password" type="password" autocomplete="new-password" minlength="8" required></div></div><div><button class="btn sm" type="submit">Change password</button></div></form></details>
    <details><summary class="small"><b>Delete my account</b></summary><form class="stack-s" data-form="w-delete" style="margin-top:8px">
      <p class="small">This erases your Homeroom account and everything in it, including saved logins. It can’t be undone.</p>
      <div class="field"><label for="del-pw">Your password</label><input id="del-pw" name="password" type="password" autocomplete="current-password" required></div><div><button class="btn sm danger" type="submit">Delete my account</button></div></form></details></div>`;
}

const BK = {
  kind:'web', hasEmail:false,
  demoNote:'',
  extraTabs:['logins'],
  extraButtons:() => `<a class="icon-btn mob-only" href="#logins" data-nav="logins" aria-label="Logins" title="Logins">${ic('key')}</a>`,
  setTabs:() => [['profile','Profile','user'],['look','Appearance','sliders'],['logins','Logins','key'],['accounts','Sync & calendar','refresh'],['notify','Notifications','bell'],['classes','Classes','grad'],['privacy','Privacy & account','lock'],['data','Your data','clip']].concat(W.status?.owner ? [['owner','Run this site','plug']] : []),
  panes:{
    logins:() => `<h2>Logins</h2><p>Your saved usernames and passwords for Genesis, VHL and other sites, plus the Chrome extension, are on their own page.</p><a class="btn primary" href="#logins" data-act="w-go" data-view="logins" style="justify-self:start">${ic('key')} Open Logins</a>
      <div class="stack-s">${['genesis', ...Object.keys(LOGIN_SITES)].map(k => { const ok = k === 'genesis' ? W.status?.genesis?.on : (W.status?.logins || []).some(l => l.src === k && l.ok); return `<div class="between small"><span class="hstack"><span class="dot" style="--c:${srcColor(k)}"></span>${esc(srcName(k))}</span>${ok ? `<span class="pill good">${ic('check')} Saved</span>` : '<span class="muted">Not added</span>'}</div>`; }).join('')}</div>`,
    owner:() => ownerPane(),
  },
  aiOffNote:'The AI planner needs a Claude API key (Settings → Sync & calendar). Everything else works without it.',
  aiReady:() => !!(W.status?.aiKey || W.status?.aiSite),
  aiImages:() => true,
  aiErrorText,
  async json(prompt, o = {}){
    const images = o.images ? await Promise.all([...o.images].map(fileToB64)) : [];
    const r = await api('ai', {prompt, images, tier:o.tier || 'default', max:3500});
    return parseLoose(r.text);
  },
  async chat(turns){
    const system = plannerRules() + `\n\nTheir schedule for the next 3 weeks:\n${JSON.stringify(scheduleSnapshot(dayKey(new Date()), dayKey(addDays(new Date(), 21)))).slice(0, 24000)}
Busy days: ${JSON.stringify(analyze(new Date(), 21).map(a => a.text + ': ' + a.detail))}
Grades: ${JSON.stringify(gradeSnapshot())}
Reply with only JSON: {"reply": your message to the student, "events": [{"title":string,"start":"YYYY-MM-DDTHH:MM","end":"YYYY-MM-DDTHH:MM","type":"study"|"event"|"assignment","class":string,"notes":string}]}. Use "events": [] when you aren't suggesting calendar entries.`;
    const r = await api('ai', {system, messages:turns.map(t => ({role:t.role, content:String(t.content)})), tier:'default', max:2000});
    try { const j = parseLoose(r.text); return {text:String(j.reply || ''), events:Array.isArray(j.events) ? j.events : []}; }
    catch { return {text:r.text, events:[]}; }
  },
  syncSummary(){
    const st = W.status; if (!st) return {cls:'', text:'Connecting…'};
    if (P().autoSync === false) return {cls:'warn', text:'Automatic sync is off'};
    const bad = Object.values(st.sources || {}).some(s => !s.ok);
    return {cls:bad ? 'warn' : 'live', text:`${cronOk() ? 'Auto-sync on' : 'Syncs when you open Homeroom'} · last ${ago2(st.lastSync)}${bad ? ' · needs attention' : ''}`};
  },
  async sync(o = {}){
    if (W.busy.sync) return;
    W.busy.sync = true; if (!o.quiet) { renderOverlay(); toast('Syncing… this can take up to a minute.'); }
    try { await store.flush(); const r = await api('sync', {why:o.why || 'manual'}); W.status = r.status; applyServer(r.data); const x = r.result || {}; if (!o.quiet) toast(x.skipped ? x.skipped : `Synced: ${x.added || 0} new, ${x.updated || 0} updated.`); }
    catch (e) { if (!o.quiet && e.code !== 'signed_out') toast('Sync failed: ' + (e.message || 'unknown error'), {kind:'bad'}); }
    finally { W.busy.sync = false; if (!o.quiet) renderOverlay(); renderSoon(); }
  },
  canCalendar:() => false,
  addToCalendar:async () => false,
  inbox:() => ({on:false, threads:[], loading:false, banner:''}),
  notes(){
    const out = [], st = W.status; if (!st) return out;
    for (const [k, s] of Object.entries(st.ext?.sites || {})) if (s.loggedOut) out.push({c:srcColor(k), icon:'user', text:`Sign in to ${srcName(k)} in Chrome`, sub:'The Chrome extension found a sign-in page', act:'goto', view:'logins'});
    for (const [k, s] of Object.entries(st.sources || {})) if (!s.ok) out.push({c:'var(--warn)', icon:'warn', text:`${k.startsWith('login:') ? srcName(k.slice(6)) : k.startsWith('cal:') ? 'A calendar link' : srcName(k)} didn’t sync`, sub:s.error || '', act:'goto', view:'logins'});
    if (st.owner && !cronOk() && D.state.profile.onboarded) out.push({c:'var(--info)', icon:'refresh', text:'Set up the background timer', sub:'So Homeroom syncs while it’s closed', act:'settings', view:'owner'});
    return out;
  },
  todayTop(){
    const st = W.status; if (!st || S.mode !== 'web') return '';
    const any = st.genesis?.on || (st.logins || []).length || Object.keys(st.ext?.sites || {}).length || (st.cals || []).length;
    return any ? '' : `<div class="banner" style="margin-bottom:var(--gap)">${ic('key')}<p class="grow"><b>Connect your school accounts.</b> Add your Genesis login and other sites so your work shows up here on its own.</p><a class="btn sm primary" href="#logins">Open Logins</a></div>`;
  },
  meMenu:() => `<a class="note" href="#logins" data-act="close-pop"><span class="ic">${ic('key')}</span><b>Logins</b></a><button class="note" data-act="w-signout"><span class="ic">${ic('x')}</span><b>Sign out</b></button>`,
  who:() => W.user ? `Signed in to Homeroom as ${esc(W.user.username)}.` : '',
  avatar:() => esc(((D.state?.profile?.name || W.user?.username || 'Y')[0] || 'Y').toUpperCase()),
  accountLine:() => W.user?.username || '',
  defaultName:() => (W.user?.username || '').replace(/[._\-\d]+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase()),
  privacyNote:() => 'Your schoolwork, grades and settings are stored on this Homeroom site’s server under your account, and other people who use the site can’t see them. Passwords you save for Genesis or other sites are encrypted and only used to sign in for you. The person who runs the site manages the server, so only use a Homeroom run by someone you trust.',
  privacyExtra:() => accountExtra(),
  signinHTML:() => authHTML(),
  exitDemo(){},
  onboardExtra:() => `<div class="banner">${ic('key')}<p class="grow small">Next you’ll add your Genesis login (and any other sites) on the Logins page, so Homeroom can fill itself in.</p></div>`,
  async afterOnboard(){ store.save(); await store.flush(); location.hash = '#logins'; toast('Add your Genesis login to get your grades and assignments.'); },
  onEnter(){
    clearInterval(W.pollTimer); W.pollTimer = setInterval(poll, 180000);
    const st = W.status;
    if (D.state.profile.onboarded && P().autoSync !== false && (!st?.lastSync || Date.now() - st.lastSync > (+P().syncMinutes || 30) * 60e3)) BK.sync({quiet:true, why:'open'});
    pushState().then(s => { W.pushOn = s; });
  },
  onPrefs(k){ if (k === 'pushCal' || k === 'eveningAt' || k === 'morningAt') toast('Your calendar link updates within the hour.'); },
  onGmailPrefs(){},
  accountsPane:() => syncPane(),
  notifyPane:() => notifyPane(),
  ACT:{
    'w-go':el => { closePop(); if (S.modal) closeModal(); location.hash = '#' + (el.dataset.view || 'logins'); },
    'w-tab':el => { W.auth.tab = el.dataset.v; W.auth.err = ''; const u = $('#a-user')?.value; if (u) W.auth.username = u; render(); setTimeout(() => $('#a-user')?.focus(), 20); },
    'w-peek':el => { const i = document.getElementById(el.dataset.for); if (i) i.type = i.type === 'password' ? 'text' : 'password'; },
    'w-copy':el => copyText(el.dataset.text || '', el.dataset.msg),
    'w-continue':() => { W.auth.recovery = ''; BK.boot(); },
    'w-open':el => { const k = el.dataset.k; W.open[k] = !(W.open[k] ?? (k === 'genesis' ? !W.status?.genesis?.on : false)); renderView(); },
    'w-signout':() => confirmBox('Sign out?', 'You’ll need your username and password to get back in.', 'Sign out', async () => { try { await store.flush(); await api('signout'); } catch {} location.hash = ''; signedOut(); }),
    'w-genesis-off':() => confirmBox('Disconnect Genesis?', 'Homeroom forgets your Genesis password and stops checking it. Grades already here stay.', 'Disconnect', async () => { try { const r = await api('genesis', {off:true}); W.status = r.status; renderView(); } catch (e) { toast(e.message, {kind:'bad'}); } }),
    'w-debug':async () => { try { const r = await api('debug'); W.debug = [r.genesis ? 'GENESIS\n' + r.genesis : 'Genesis: no debug info yet. Connect it first.', ...(r.logins || []).map(l => `${String(l.src).toUpperCase()}: ${l.note || ''}\n${l.debug || ''}`), 'SOURCES ' + JSON.stringify(r.sources)].join('\n\n'); renderView(); setTimeout(() => $('#dbg')?.scrollIntoView({block:'center'}), 50); } catch (e) { toast(e.message, {kind:'bad'}); } },
    'w-login-del':el => confirmBox('Remove this login?', 'Homeroom forgets the password and stops signing in to that site.', 'Remove', async () => { try { const r = await api('login', {remove:el.dataset.id}); W.status = r.status; renderView(); } catch (e) { toast(e.message, {kind:'bad'}); } }),
    'w-extcode':async () => { try { const r = await api('extkey'); W.status = r.status; W.extCode = 'HR1:' + btoa(JSON.stringify({u:r.url || location.origin + '/api/ext', k:r.key})); renderView(); } catch (e) { toast(e.message, {kind:'bad'}); } },
    'w-extreset':() => confirmBox('Make a new connection code?', 'The old code stops working. Paste the new one into the extension.', 'New code', async () => { try { const r = await api('extkey', {reset:true}); W.status = r.status; W.extCode = 'HR1:' + btoa(JSON.stringify({u:r.url || location.origin + '/api/ext', k:r.key})); renderView(); } catch (e) { toast(e.message, {kind:'bad'}); } }),
    'w-cal-del':el => confirmBox('Remove this calendar?', 'Its events leave Homeroom on the next sync.', 'Remove', async () => { try { const r = await api('calimport', {remove:el.dataset.id}); W.status = r.status; renderView(); } catch (e) { toast(e.message, {kind:'bad'}); } }),
    'w-feed':async () => { try { const r = await api('calfeed'); W.feedUrl = r.url; W.status = r.status; renderOverlay(); } catch (e) { toast(e.message, {kind:'bad'}); } },
    'w-feedreset':() => confirmBox('Make a new calendar link?', 'The old link stops working. You’ll need to subscribe again with the new one.', 'New link', async () => { try { const r = await api('calfeed', {reset:true}); W.feedUrl = r.url; S.setTab = 'accounts'; openModal({kind:'settings'}); } catch (e) { toast(e.message, {kind:'bad'}); } }),
    'w-aikey-off':() => confirmBox('Remove your Claude API key?', 'AI features turn off unless this site shares one. Everything else keeps working.', 'Remove', async () => { try { const r = await api('secret', {name:'anthropic', value:''}); W.status = r.status; S.setTab = 'accounts'; openModal({kind:'settings'}); renderView(); } catch (e) { toast(e.message, {kind:'bad'}); } }),
    'w-push-on':() => {
      // Ask first, while the tap still counts as the student's action (Safari requires that).
      let perm;
      try { perm = Notification.requestPermission(); } catch (e) { perm = Promise.resolve('default'); }
      return busy('pon', async () => {
        try {
          if (await perm !== 'granted') { W.pushOn = Notification.permission === 'denied' ? 'blocked' : 'off'; toast('Notifications weren’t allowed.', {kind:'bad'}); return; }
          await navigator.serviceWorker.register('/sw.js'); const reg = await navigator.serviceWorker.ready;
          const {key} = await api('push', {action:'key'});
          const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:b64ToBytes(key)});
          const r = await api('push', {action:'subscribe', sub:sub.toJSON(), ua:navigator.userAgent.slice(0, 80)});
          W.status = r.status; W.pushOn = 'on'; toast('Notifications are on for this device.');
        } catch (e) { toast('Couldn’t turn on notifications: ' + (e.message || e), {kind:'bad'}); }
      });
    },
    'w-push-off':() => busy('pon', async () => { try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); if (sub) { await api('push', {action:'unsubscribe', endpoint:sub.endpoint}); await sub.unsubscribe(); } W.pushOn = 'off'; const r = await api('pull'); W.status = r.status; } catch (e) { toast(e.message || 'Couldn’t turn it off', {kind:'bad'}); } }),
    'w-push-test':() => busy('ptest', async () => { try { const r = await api('push', {action:'test'}); W.status = r.status; toast(r.sent ? 'Sent. It should pop up in a few seconds.' : 'No device got it. Turn notifications off and on again here.', {kind:r.sent ? '' : 'bad'}); } catch (e) { toast(e.message, {kind:'bad'}); } }),
    'w-owner':el => busy(el.dataset.a === 'cron' ? 'cron' : 'owner2', async () => {
      const b = {action:el.dataset.a}; if (el.dataset.new) b.newCode = true; if (el.dataset.on) b.on = el.dataset.on === '1';
      try { W.owner = await api('owner', b); if (b.action === 'cron') { const r = await api('pull'); W.status = r.status; applyServer(r.data); toast(`Timer ran: ${W.owner.cron?.ran || 0} synced.`); } } catch (e) { toast(e.message, {kind:'bad'}); }
    }),
    'w-owner-rm':el => confirmBox(`Remove ${el.dataset.name}?`, 'This deletes their account and all their Homeroom data, including saved logins.', 'Remove', async () => { try { W.owner = await api('owner', {action:'removeUser', uid:el.dataset.uid}); S.setTab = 'owner'; openModal({kind:'settings'}); } catch (e) { toast(e.message, {kind:'bad'}); } }, true),
  },
  CHG:{
    'w-maxusers':async el => { try { W.owner = await api('owner', {action:'maxUsers', n:+el.value}); toast('Saved'); } catch (e) { toast(e.message, {kind:'bad'}); } },
  },
  FORM:{
    'w-signin':f => authSubmit('signin', f), 'w-signup':f => authSubmit('signup', f), 'w-reset':f => authSubmit('reset', f),
    'w-genesis':f => busy('genesis', async () => {
      const F = new FormData(f);
      try { const r = await api('genesis', {url:F.get('url'), user:F.get('user'), pass:F.get('pass')}); W.status = r.status; applyServer(r.data); W.open.genesis = false; toast(`Genesis connected: ${r.result?.note || 'synced'}.`, {ms:7000}); }
      catch (e) { if (e.debug) W.debug = 'GENESIS\n' + e.debug; toast(e.message || 'Couldn’t connect Genesis.', {kind:'bad', ms:9000}); }
    }),
    'w-login':f => busy('login-' + f.dataset.src, async () => {
      const o = Object.fromEntries(new FormData(f).entries()); o.src = f.dataset.src;
      try { const r = await api('login', o); W.status = r.status; applyServer(r.data); toast(r.result?.ok ? `Signed in to ${srcName(o.src)}: ${r.result.note}` : `${srcName(o.src)}: ${r.result?.note || 'didn’t work'}`, {kind:r.result?.ok ? '' : 'bad', ms:9000}); }
      catch (e) { toast(e.message, {kind:'bad'}); }
    }),
    'w-calimport':f => busy('calimport', async () => {
      const F = new FormData(f);
      try { const r = await api('calimport', {name:F.get('name'), url:F.get('url')}); W.status = r.status; applyServer(r.data); toast('Calendar added: ' + (r.result?.note || '')); }
      catch (e) { toast(e.message, {kind:'bad', ms:8000}); }
    }),
    'w-aikey':f => busy('aikey', async () => {
      const key = String(new FormData(f).get('key') || '').trim(); if (!key) return;
      try { const r = await api('secret', {name:'anthropic', value:key}); W.status = r.status; toast('AI turned on.'); renderView(); }
      catch (e) { toast(e.message, {kind:'bad'}); }
    }),
    'w-aishare':f => busy('aishare', async () => {
      const F = new FormData(f), b = {action:'aiShare', on:F.get('on') === 'on', perDay:+F.get('perDay') || 40}; if (F.get('key')) b.key = F.get('key');
      try { W.owner = await api('owner', b); const r = await api('pull'); W.status = r.status; toast('Saved'); }
      catch (e) { toast(e.message, {kind:'bad'}); }
    }),
    'w-password':async f => { const F = new FormData(f); try { await api('password', {old:F.get('old'), password:F.get('password')}); toast('Password changed. Other devices are signed out.'); f.reset(); } catch (e) { toast(e.message, {kind:'bad'}); } },
    'w-delete':async f => {
      const pw = new FormData(f).get('password');
      confirmBox('Delete your account for good?', 'Everything in your Homeroom is erased right away.', 'Delete forever', async () => { try { await api('deleteaccount', {password:pw}); location.hash = ''; S.mode = 'demo'; signedOut(); toast('Your account was deleted.'); } catch (e) { toast(e.message, {kind:'bad'}); } }, true);
    },
  },
  async boot(){
    VIEW_FN.logins = loginsPage;
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const join = (location.hash.match(/^#join=([A-Za-z0-9-]+)/) || [])[1];
    if (join) { W.auth.invite = join.toUpperCase(); W.auth.tab = 'signup'; history.replaceState(null, '', location.pathname); }
    S.screen = 'loading'; render();
    try {
      const r = await api('bootstrap');
      W.user = r.user; W.status = r.status; S.mode = 'web';
      applyServer(r.data, {initial:true}); applyTheme();
      if (P().pinHash && !S.unlocked) { S.screen = 'lock'; render(); return; }
      enterApp();
    } catch (e) {
      if (e.code === 'signed_out') { try { W.auth.site = await api('site'); } catch {} if (join || W.auth.site?.hasOwner === false) W.auth.tab = 'signup'; render(); return; }
      if (e.code === 'setup') return;
      S.screen = 'error'; S.errorHTML = esc(e.message || 'Couldn’t load Homeroom.'); render();
    }
  },
};
async function authSubmit(kind, f){
  const o = Object.fromEntries(new FormData(f).entries());
  W.auth.username = o.username; W.auth.err = ''; W.busy.auth = true; render();
  try {
    const r = await api(kind, o);
    W.busy.auth = false;
    if (r.recovery) { W.auth.tab = 'recovery'; W.auth.recovery = r.recovery; render(); return; }
    BK.boot();
  } catch (e) {
    W.busy.auth = false; W.auth.err = e.message || 'That didn’t work.'; render();
    setTimeout(() => (kind === 'signin' ? $('#a-pass') : $('#a-user'))?.focus(), 20);
  }
}
