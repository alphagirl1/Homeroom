/* =====================================================================
   Homeroom: shell, panels, actions, AI glue, boot (backend-agnostic)
   ===================================================================== */

/* ---------- theme ---------- */
function applyTheme(){
  const p = D.state?.prefs || defaultState().prefs, r = document.documentElement;
  r.dataset.palette = p.palette; r.dataset.density = p.density; r.dataset.motion = p.reduceMotion ? 'reduce' : '';
  r.style.setProperty('--scale', p.scale);
  let sys = false; try { sys = matchMedia('(prefers-color-scheme: dark)').matches; } catch {}
  const host = r.getAttribute('data-theme');
  const dark = p.mode === 'dark' || (p.mode === 'system' && (host ? host === 'dark' : sys));
  r.dataset.dark = dark ? '1' : '0';
  if (p.accent) { r.style.setProperty('--accent', p.accent); r.style.setProperty('--accent-ink', luminance(p.accent) > .4 ? '#16201A' : '#FFFFFF'); }
  else { r.style.removeProperty('--accent'); r.style.removeProperty('--accent-ink'); }
}

/* ---------- toasts ---------- */
function toast(msg, o = {}){
  const box = $('#toasts'); if (!box) return;
  const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status');
  if (o.kind === 'bad') el.style.background = 'color-mix(in oklab, var(--bad) 75%, var(--ink))';
  const span = document.createElement('span'); span.textContent = msg; el.append(span);
  if (o.action) { const b = document.createElement('button'); b.textContent = o.action.label; b.onclick = () => { o.action.fn(); el.remove(); }; el.append(b); }
  box.append(el); setTimeout(() => el.remove(), o.ms || (o.action ? 7000 : 4800));
  while (box.children.length > 3) box.firstChild.remove();
}

/* ---------- rendering ---------- */
let rafPending = false;
function renderSoon(){ if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; if (S.screen === 'app') renderView(); }); }
function isTyping(){ const a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'radio'; }
function saveFocus(){
  const a = document.activeElement;
  const f = {id:a?.id || null, s:null, e:null, msgs:$('#msgs')?.scrollTop, atBottom:false};
  const m = $('#msgs'); if (m) f.atBottom = m.scrollTop + m.clientHeight >= m.scrollHeight - 30;
  try { if (a && 'selectionStart' in a) { f.s = a.selectionStart; f.e = a.selectionEnd; } } catch {}
  return f;
}
function restoreFocus(f){
  if (f.id) { const el = document.getElementById(f.id); if (el && el !== document.activeElement && !$('#overlay').contains(el)) { el.focus({preventScroll:true}); try { if (f.s != null) el.setSelectionRange(f.s, f.e); } catch {} } }
  const m = $('#msgs'); if (m) m.scrollTop = f.atBottom ? m.scrollHeight : (f.msgs ?? m.scrollHeight);
}
function render(){
  const root = $('#root');
  if (S.screen === 'boot' || S.screen === 'loading') root.innerHTML = `<div class="boot"><div class="hstack"><span class="logo">H</span><span>${S.screen === 'loading' ? 'Opening your Homeroom…' : 'Loading Homeroom…'}</span></div></div>`;
  else if (S.screen === 'signin') root.innerHTML = BK.signinHTML();
  else if (S.screen === 'lock') { root.innerHTML = lockHTML(); setTimeout(() => $('#pin-in')?.focus(), 30); }
  else if (S.screen === 'error') root.innerHTML = `<div class="signin-side"><div class="signin-card"><div class="brand"><span class="logo">H</span><span>Homeroom</span></div><p>${S.errorHTML || 'Something went wrong.'}</p><button class="btn primary" onclick="location.reload()">Try again</button></div></div>`;
  else { root.innerHTML = shellHTML(); const q = $('#q'); if (q) q.value = S.q; renderView(); }
  renderOverlay();
}
let rendering = false;
function renderView(){
  if (S.screen !== 'app') return;
  if (rendering) { renderSoon(); return; }
  const v = $('#view'); if (!v) return render();
  rendering = true;
  const f = saveFocus();
  try {
    let html;
    try { html = `<div class="view-in">${VIEW_FN[S.view]()}</div>`; }
    catch (err) { console.error(err); html = `<div class="view-in"><div class="banner bad">${ic('warn')}<p class="grow">Something went wrong showing this page. Try another tab, or reload.</p></div></div>`; }
    v.innerHTML = html;
    updateChrome();
  } finally { rendering = false; }
  restoreFocus(f);
  if (S.drawer) { const d = $('#drawer-in'); if (d && !d.contains(document.activeElement)) d.innerHTML = drawerHTML(); }
}
function greeting(){ const h = new Date().getHours(); const n = D.state.profile.name ? ', ' + D.state.profile.name.split(' ')[0] : ''; return (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + n; }
function navCounts(){
  return {
    assignments:D.items.filter(i => isTask(i) && i.status !== 'done' && !i.hidden && ((dueOf(i) && dueOf(i) < Date.now()) || i.missing)).length,
    inbox:D.items.filter(i => i.type === 'announcement' && !i.read && !i.hidden).length + proposals().length,
  };
}
function updateChrome(){
  const nav = VIEWS[S.view].nav, counts = navCounts();
  $$('[data-nav]').forEach(a => { if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    const c = a.querySelector('.count'); if (c) { const n = counts[a.dataset.nav] || 0; c.textContent = n > 99 ? '99+' : n; c.style.display = n ? '' : 'none'; } });
  const n = notifications().length, b = $('#bell .badge');
  if (b) { b.textContent = n > 9 ? '9+' : n; b.style.display = n ? '' : 'none'; }
  document.title = S.view === 'today' ? 'Homeroom' : `${VIEWS[nav].label} · Homeroom`;
}
function shellHTML(){
  const tab = v => `<a class="tab" href="#${v}" data-nav="${v}">${ic(VIEWS[v].icon)}<span class="lbl">${VIEWS[v].label}</span>${['assignments','inbox'].includes(v) ? '<span class="count" style="display:none"></span>' : ''}</a>`;
  const bt = v => `<a href="#${v}" data-nav="${v}">${ic(VIEWS[v].icon)}<span>${VIEWS[v].label}</span>${['assignments','inbox'].includes(v) ? '<span class="count" style="display:none"></span>' : ''}</a>`;
  const me = BK.avatar ? BK.avatar() : '';
  return `<header class="topbar"><div class="topbar-in">
    <a class="brand" href="#today" aria-label="Homeroom home"><span class="logo">H</span><span>Homeroom</span></a>
    <nav class="tabs-main" aria-label="Main">${NAV.concat(BK.extraTabs || []).map(tab).join('')}</nav>
    <div class="top-actions">
      <label class="search">${ic('search')}<input id="q" type="search" placeholder="Search" aria-label="Search everything" data-inp="search" autocomplete="off"></label>
      ${BK.extraButtons ? BK.extraButtons() : ''}<button class="icon-btn" data-act="add-menu" aria-label="Add" title="Add">${ic('plus')}</button>
      <button class="icon-btn" id="bell" data-act="bell" aria-label="Notifications" title="Notifications">${ic('bell')}<span class="badge" style="display:none"></span></button>
      <button class="icon-btn" data-act="settings" aria-label="Settings" title="Settings">${ic('sliders')}</button>
      <button class="icon-btn" data-act="me-menu" aria-label="Account" title="Account"><span class="avatar">${me || esc((D.state.profile.name || 'Y')[0])}</span></button>
    </div></div></header>
  <main id="view" tabindex="-1"></main>
  <nav class="bottom-nav" aria-label="Main">${NAV.map(bt).join('')}</nav>`;
}
function lockHTML(){
  return `<div class="signin-side" style="height:100%"><form class="signin-card" data-form="unlock">
    <div class="brand"><span class="logo">H</span><span>Homeroom is locked</span></div>
    <div class="field"><label for="pin-in">Enter your PIN</label><input id="pin-in" name="pin" class="pin-in" type="password" inputmode="numeric" autocomplete="off" maxlength="8"></div>
    <p class="small" id="pin-err" style="color:var(--bad)" aria-live="polite"></p>
    <button class="btn primary" type="submit" style="justify-content:center">Unlock</button>
    <button class="btn ghost sm" type="button" data-act="pin-forgot">Forgot your PIN?</button>
  </form></div>`;
}

/* ---------- overlay: modals, drawer, popovers ---------- */
function openModal(m){ S.modal = m; S.pop = null; renderOverlay(); setTimeout(() => { if (m.kind === 'settings') return; const f = $('#overlay .modal input:not([type=checkbox]):not([type=radio]):not([type=color]), #overlay .modal textarea, #overlay .modal select'); f?.focus(); }, 30); }
function closeModal(){ const was = S.modal?.kind; S.modal = null; renderOverlay(); if (was === 'settings') renderView(); }
function closePop(){ if (!S.pop) return; S.pop = null; renderOverlay(); }
let overlayBusy = false;
function renderOverlay(){
  const o = $('#overlay'); if (!o) return;
  if (overlayBusy) { setTimeout(renderOverlay, 0); return; }
  overlayBusy = true;
  try {
    const keepScroll = $('#set-pane')?.scrollTop;
    let h = '';
    if (S.drawer && S.screen === 'app') h += `<div class="drawer-scrim" data-act="drawer-close"></div><aside class="drawer" aria-label="Filters"><div id="drawer-in" class="stack">${drawerHTML()}</div></aside>`;
    if (S.pop) h += `<div class="pop-scrim" data-act="close-pop"></div><div class="pop" role="dialog" aria-label="${esc(S.pop)}">${popHTML()}</div>`;
    if (S.modal) h += modalHTML();
    o.innerHTML = h;
    if (keepScroll && $('#set-pane')) $('#set-pane').scrollTop = keepScroll;
  } finally { overlayBusy = false; }
}
function popHTML(){
  if (S.pop === 'bell') {
    const ns = notifications(), sy = BK.syncSummary();
    return `<div class="between" style="margin-bottom:6px"><h2>Notifications</h2>${ns.length ? '<button class="btn sm ghost" data-act="seen-all">Mark all seen</button>' : ''}</div>
      ${ns.length ? ns.slice(0, 30).map(n => `<button class="note" style="--c:${n.c}" data-act="${n.act}" data-id="${esc(n.id || '')}" data-view="${esc(n.view || '')}"><span class="ic">${ic(n.icon)}</span><span style="min-width:0"><b>${esc(n.text)}</b><span class="small muted" style="display:block">${esc(n.sub || '')}</span></span></button>`).join('') : '<p class="muted small" style="padding:8px">You’re all caught up.</p>'}
      <div class="between small" style="border-top:1px solid var(--line);margin-top:8px;padding-top:10px"><span class="hstack"><span class="dot" style="--c:${sy.cls === 'live' ? 'var(--good)' : sy.cls === 'warn' ? 'var(--warn)' : 'var(--muted)'}"></span>${esc(sy.text)}</span><button class="btn sm" data-act="sync">${ic('refresh')} Sync now</button></div>`;
  }
  if (S.pop === 'add') {
    const it = (act, icon, label, extra = '') => `<button class="note" data-act="${act}" ${extra}><span class="ic">${ic(icon)}</span><span><b>${label}</b></span></button>`;
    return it('add-item', 'list', 'Assignment or test') + it('add-item', 'cal', 'Event', 'data-type="event"') + it('add-item', 'book', 'Study session', 'data-type="study"') +
      it('cd-new', 'timer', 'Countdown') + it('grade-add', 'grades', 'Grade') + it('add-item', 'mega', 'Announcement', 'data-type="announcement"') + it('import', 'upload', 'Import from a platform…');
  }
  if (S.pop === 'me') {
    return `<div class="hstack" style="padding:6px 6px 10px"><span class="avatar">${BK.avatar ? BK.avatar() : ''}</span><div><b>${esc(D.state.profile.name || 'You')}</b><div class="small muted">${esc(BK.accountLine ? BK.accountLine() : '')}</div></div></div>
      <button class="note" data-act="settings"><span class="ic">${ic('sliders')}</span><b>Settings</b></button>
      ${S.mode !== 'demo' && P().pinHash ? `<button class="note" data-act="lock-now"><span class="ic">${ic('lock')}</span><b>Lock now</b></button>` : ''}
      ${S.mode === 'demo' ? `<button class="note" data-act="exit-demo"><span class="ic">${ic('x')}</span><b>Leave the demo</b></button>` : (BK.meMenu ? BK.meMenu() : '')}`;
  }
  return '';
}
function modalWrap(title, body, foot, o = {}){
  const tag = o.form ? 'form' : 'div';
  return `<div class="scrim" data-act="scrim"><${tag} ${o.form ? `data-form="${o.form}"` : ''} class="modal ${o.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="mtitle">
    <div class="modal-h"><h2 id="mtitle">${title}</h2><button class="icon-btn" type="button" data-act="close-modal" aria-label="Close">${ic('x')}</button></div>
    <div class="modal-b">${body}</div>${foot ? `<div class="modal-f">${foot}</div>` : ''}</${tag}></div>`;
}
const opt = (v, l, sel) => `<option value="${esc(v)}" ${String(sel) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
const courseOpts = (sel, none = 'No class') => opt('', none, sel || '') + D.state.courses.map(c => opt(c.id, c.name, sel)).join('');
const srcOpts = (sel, list = SRC_ORDER) => list.map(k => opt(k, srcName(k), sel)).join('');
function modalHTML(){
  const m = S.modal;
  switch (m.kind) {
    case 'settings': return settingsHTML();
    case 'item': return mItem(m);
    case 'import': return mImport(m);
    case 'ap': return mAP(m);
    case 'cd': return mCountdown(m);
    case 'course': return mCourse(m);
    case 'grade': return mGrade(m);
    case 'confirm': return modalWrap(esc(m.title), `<p>${esc(m.body)}</p>`, `<button class="btn" type="button" data-act="close-modal">Cancel</button><button class="btn primary ${m.danger ? 'danger' : ''}" type="button" data-act="confirm-ok">${esc(m.ok || 'OK')}</button>`);
    case 'onboard': return mOnboard(m);
    case 'pin': return modalWrap('Set a PIN', `<div class="field"><label for="pin1">New PIN (4–8 digits)</label><input id="pin1" name="pin1" class="pin-in" type="password" inputmode="numeric" maxlength="8" required></div><div class="field"><label for="pin2">Type it again</label><input id="pin2" name="pin2" class="pin-in" type="password" inputmode="numeric" maxlength="8" required></div><p class="small" style="color:var(--bad)" id="pin-msg">${esc(m.err || '')}</p>`, `<button class="btn" type="button" data-act="close-modal">Cancel</button><button class="btn primary" type="submit">Save PIN</button>`, {form:'pin'});
    case 'restore': return modalWrap('Restore a backup', `<p class="small muted">Paste a backup you copied from Homeroom. This replaces what’s here now.</p><textarea id="restore-text" name="json" rows="10" placeholder='{"homeroom": …}'></textarea><p class="small" style="color:var(--bad)">${esc(m.err || '')}</p>`, `<button class="btn" type="button" data-act="close-modal">Cancel</button><button class="btn primary" type="submit">Restore</button>`, {form:'restore', wide:true});
    case 'export': return modalWrap('Your backup', `<p class="small muted">Copying didn’t work here, so select all of this and copy it yourself. Keep it somewhere safe.</p><textarea id="export-text" rows="12" readonly>${esc(m.json)}</textarea>`, `<button class="btn primary" type="button" data-act="close-modal">Done</button>`, {wide:true});
  }
  return '';
}
function mItem(m){
  const it = m.id ? D.items.find(i => i.id === m.id) : null;
  const v = it || {status:'todo', src:'personal', type:'assignment', ...(m.preset || {})};
  const type = v.type || 'assignment', ann = type === 'announcement';
  const d = dueOf(v) || (m.day ? parseDate(m.day + 'T23:59') : null) || (ann ? null : null);
  const e = v.end ? parseDate(v.end) : null;
  const posted = ann ? parseDate(v.posted) || new Date() : null;
  const timed = ['event','study'].includes(type);
  const dv = d ? dayKey(d) : (m.day || ''), tv = d && !v.allDay ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : (timed ? '16:00' : '23:59');
  const ev = e ? `${pad(e.getHours())}:${pad(e.getMinutes())}` : (timed ? '17:00' : '');
  const url = safeUrl(v.url);
  const title = it ? (it.proposed ? 'Suggested date' : ann ? 'Announcement' : 'Details') : ann ? 'Add an announcement' : `Add ${TYPES[type]?.label.toLowerCase() || 'item'}`;
  const body = `
    ${it?.proposed ? `<div class="banner">${ic('spark')}<p class="grow small">Suggested${it.fromAnn || it.fromAnnKey ? ' from an announcement' : ' by the planner'}. Change anything, then add it to your calendar.</p></div>` : ''}
    ${it && it.origin !== 'manual' && !it.proposed && !it.sample ? `<p class="small muted">From ${esc(srcName(it.src))}${it.origin === 'email' ? ' (email)' : it.origin === 'import' ? ' (import)' : it.origin === 'sync' ? ' (synced automatically)' : it.origin === 'extension' ? ' (Chrome extension)' : ''}. Your edits are kept when it syncs again.</p>` : ''}
    <div class="field"><label for="f-title">${ann ? 'Headline' : 'Title'}</label><input id="f-title" name="title" required value="${esc(v.title || '')}" maxlength="140"></div>
    <div class="row-3">
      <div class="field"><label for="f-type">Type</label><select id="f-type" name="type">${TYPE_ORDER.map(k => opt(k, TYPES[k].label, type)).join('')}</select></div>
      <div class="field"><label for="f-src">Platform</label><select id="f-src" name="src">${srcOpts(v.src)}</select></div>
      <div class="field"><label for="f-course">Class</label><select id="f-course" name="course">${courseOpts(v.course)}</select></div>
    </div>
    ${ann ? `<div class="row-2"><div class="field"><label for="f-teacher">Teacher</label><input id="f-teacher" name="teacher" value="${esc(v.teacher || '')}"></div><div class="field"><label for="f-posted">Posted</label><input id="f-posted" name="posted" type="date" value="${dayKey(posted)}"></div></div>
      <div class="field"><label for="f-body">Announcement text</label><textarea id="f-body" name="body" rows="6" placeholder="Paste the post from Google Classroom">${esc(v.body || '')}</textarea></div>`
    : `<div class="row-3">
      <div class="field"><label for="f-date">${timed ? 'Date' : 'Due date'}</label><input id="f-date" name="date" type="date" value="${esc(dv)}"></div>
      <div class="field"><label for="f-time">${timed ? 'Starts' : 'Due time'}</label><input id="f-time" name="time" type="time" value="${esc(tv)}"></div>
      <div class="field"><label for="f-end">Ends${timed ? '' : ' (optional)'}</label><input id="f-end" name="end" type="time" value="${esc(ev)}"></div></div>
      <label class="toggle"><input type="checkbox" id="f-allday" name="allDay" ${v.allDay ? 'checked' : ''}> All day</label>`}
    <div class="field"><label for="f-url">Link</label><input id="f-url" name="url" type="url" value="${esc(url)}" placeholder="https://… (opens the assignment on its site)"></div>
    ${!ann ? `<div class="field"><label for="f-notes">Notes</label><textarea id="f-notes" name="notes" rows="2" placeholder="Pages, problem numbers, what to bring…">${esc(v.notes || '')}</textarea></div>
    <div class="row-3"><div class="field"><label for="f-score">Score</label><input id="f-score" name="score" type="number" step="any" value="${esc(v.score ?? '')}"></div><div class="field"><label for="f-max">Out of</label><input id="f-max" name="max" type="number" step="any" min="0" value="${esc(v.max ?? '')}"></div>
      <div class="stack-s" style="align-content:end"><label class="toggle"><input type="checkbox" id="f-done" name="done" ${v.status === 'done' ? 'checked' : ''}> Done</label><label class="toggle"><input type="checkbox" id="f-missing" name="missing" ${v.missing ? 'checked' : ''}> Marked missing</label></div></div>
    <label class="toggle"><input type="checkbox" id="f-pin" name="pinned" ${v.pinned ? 'checked' : ''}> Count down to this</label>` : ''}`;
  const foot = `${it ? `<button class="btn ghost danger left" type="button" data-act="item-del" data-id="${it.id}">${ic('trash')} ${it.proposed ? 'Dismiss' : 'Delete'}</button>` : ''}
    ${it && !ann && BK.canCalendar() && !it.proposed ? `<button class="btn" type="button" data-act="item-gcal" data-id="${it.id}" ${it.gcalAdded ? 'disabled' : ''}>${ic('cal')} ${it.gcalAdded ? 'In Google Calendar' : 'Add to Google Calendar'}</button>` : ''}
    ${safeUrl(v.url2) ? `<a class="btn" href="${esc(safeUrl(v.url2))}" target="_blank" rel="noopener">${ic('ext')} Classroom</a>` : ''}
    ${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">${ic('ext')} Open</a>` : ''}
    <button class="btn primary" type="submit">${it?.proposed ? 'Add to my calendar' : it ? 'Save' : 'Add'}</button>`;
  return modalWrap(title, body, foot, {form:'item'});
}
function mImport(m){
  const s = SOURCES[m.src] || SOURCES.deltamath, ai = BK.aiReady();
  let body = `<div class="row-2"><div class="field"><label for="imp-src">From</label><select id="imp-src" data-chg="imp-src">${srcOpts(m.src, IMPORTABLE)}</select></div>
    <div class="field"><label for="imp-course">Class</label><select id="imp-course" data-chg="imp-course">${courseOpts(m.course, 'Figure it out from the page')}</select></div></div>`;
  if (m.preview) {
    const p = m.preview, total = p.items.length + p.grades.length;
    body += `<div class="banner ${total ? '' : 'warn'}">${ic(total ? 'check' : 'warn')}<p class="grow">${total ? `Found <b>${p.items.length}</b> item${p.items.length === 1 ? '' : 's'}${p.grades.length ? ` and <b>${p.grades.length}</b> grade${p.grades.length === 1 ? '' : 's'}` : ''}${p.avgs.length ? ` and ${p.avgs.length} class average${p.avgs.length === 1 ? '' : 's'}` : ''}. Untick anything you don’t want. Items already in Homeroom are updated, not doubled.` : 'Nothing that looks like schoolwork was found. Try copying the whole page, or a screenshot.'}${p.simple ? ' <br><span class="small">The AI isn’t available here, so a simpler reader was used. Check the results.</span>' : ''}${p.skippedGrades ? ` <br><span class="small">${p.skippedGrades} score${p.skippedGrades === 1 ? '' : 's'} skipped: pick a class above and press Back, then Read it again, to import scores.</span>` : ''}</p></div>
      <div class="prev">${p.items.map((x, i) => `<label for="pv-i-${i}"><input type="checkbox" id="pv-i-${i}" data-chg="imp-toggle" data-k="items" data-i="${i}" ${x._on !== false ? 'checked' : ''}><span><b>${esc(x.title)}</b><span class="small muted" style="display:block">${esc(TYPES[x.type]?.label || '')}${x.due ? ' · due ' + esc(fmtDay(parseDate(x.due))) + ' ' + esc(fmtTime(parseDate(x.due))) : ''}${x.course ? ' · ' + esc(courseName(x.course)) : ''}${x.status === 'done' ? ' · done' : ''}${x.missing ? ' · missing' : ''}</span></span></label>`).join('')}
      ${p.grades.map((g, i) => `<label for="pv-g-${i}"><input type="checkbox" id="pv-g-${i}" data-chg="imp-toggle" data-k="grades" data-i="${i}" ${g._on !== false ? 'checked' : ''}><span><b>${esc(g.title)}</b> <span class="num">${esc(g.score)}/${esc(g.max)}</span><span class="small muted" style="display:block">Grade · ${esc(courseName(g.course))}${g.cat ? ' · ' + esc(course(g.course)?.cats?.find(k => k.id === g.cat)?.name || g.cat) : ''}</span></span></label>`).join('')}</div>`;
    const n = p.items.filter(x => x._on !== false).length + p.grades.filter(x => x._on !== false).length;
    return modalWrap(`Import from ${esc(s.name)}`, body, `<button class="btn left" type="button" data-act="imp-back">Back</button><button class="btn primary" type="button" data-act="imp-apply" ${n ? '' : 'disabled'}>Add ${n}</button>`, {wide:true});
  }
  body += `<p class="small"><b>How:</b> ${esc(s.tip || 'Copy the page that lists your work and paste it here.')}</p>
    <div class="tabs" role="tablist">${[['paste','Paste text', 'clip'],['shot','Screenshot','image'],['ics','Calendar file (.ics)','cal']].map(([k, l, i]) => `<button type="button" role="tab" aria-selected="${m.tab === k}" data-act="imp-tab" data-v="${k}">${l}</button>`).join('')}</div>`;
  if (m.tab === 'paste') body += `<textarea id="imp-text" data-inp="imp-text" rows="9" placeholder="Paste the page here">${esc(m.text || '')}</textarea>${ai ? '<p class="small muted">The AI reads the page and picks out assignments, due dates, scores and announcements.</p>' : '<p class="small muted">The AI isn’t set up here, so Homeroom uses a simpler reader that looks for dates and scores.</p>'}`;
  else if (m.tab === 'shot') body += ai && BK.aiImages() ? `<label class="drop" for="imp-file" data-drop="1">${ic('image')}<b>${m.file ? esc(m.file.name) : 'Drop a screenshot here or click to choose'}</b><span class="small">PNG or JPG of the assignments or gradebook page</span></label><input id="imp-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-chg="imp-file" class="sr">`
    : `<div class="banner warn">${ic('warn')}<p class="grow">Reading screenshots needs the AI, which isn’t set up here. Paste the page text instead.</p></div>`;
  else body += `<label class="drop" for="imp-ics" data-drop="1">${ic('cal')}<b>${m.file ? esc(m.file.name) : 'Drop a .ics calendar file or click to choose'}</b><span class="small">Some platforms and Google Classroom calendars can export one</span></label><input id="imp-ics" type="file" accept=".ics,text/calendar" data-chg="imp-file" class="sr">`;
  if (m.err) body += `<div class="banner bad">${ic('warn')}<p class="grow">${esc(m.err)}</p></div>`;
  const can = m.tab === 'paste' ? (m.text || '').trim().length > 10 : !!m.file;
  return modalWrap(`Import from ${esc(s.name)}`, body, `${safeUrl(D.state.conn.links[m.src] || s.url) ? `<a class="btn left" href="${esc(safeUrl(D.state.conn.links[m.src] || s.url))}" target="_blank" rel="noopener">${ic('ext')} Open ${esc(s.short)}</a>` : ''}<button class="btn" type="button" data-act="close-modal">Cancel</button><button class="btn primary" type="button" data-act="imp-run" ${m.busy || !can ? 'disabled' : ''}>${m.busy ? 'Reading…' : 'Read it'}</button>`, {wide:true});
}
function apListHTML(sel){
  const byDate = {};
  AP_2027.forEach(e => (byDate[e.date] ||= []).push(e));
  return `<div style="max-height:46vh;overflow-y:auto;border:1px solid var(--line);border-radius:10px;padding:10px" class="stack-s">${Object.entries(byDate).map(([d, arr]) => `<div><div class="label">${esc(fmtDay(parseDate(d + 'T12:00'), true))}</div>${arr.map(e => `<label class="toggle small" style="padding:3px 0"><input type="checkbox" name="ap" value="${esc(e.name)}" ${sel.includes(e.name) ? 'checked' : ''}> AP ${esc(e.name)} <span class="muted">· ${e.session === 1 ? '8 AM' : '12 PM'}</span></label>`).join('')}</div>`).join('')}</div>`;
}
function mAP(){ return modalWrap('Your AP exams (May 2027)', `<p class="small muted">Tick the exams you’re taking. Homeroom adds a countdown for each. Your AP coordinator confirms the exact room and start time.</p>${apListHTML(D.state.apExams)}`, `<button class="btn" type="button" data-act="close-modal">Cancel</button><button class="btn primary" type="submit">Save</button>`, {form:'ap'}); }
function mCountdown(m){
  const c = m.id ? D.state.countdowns.find(x => x.id === m.id) : null;
  const d = c ? parseDate(c.date) : (m.day ? parseDate(m.day + 'T08:00') : addDays(startOfDay(new Date()), 7));
  const color = c?.color || m.color || SWATCHES[0];
  return modalWrap(c ? 'Edit countdown' : 'New countdown', `<div class="field"><label for="cd-title">What are you counting down to?</label><input id="cd-title" name="title" required maxlength="80" value="${esc(c?.title || '')}" placeholder="Spring break, driver’s test, Chem final…"></div>
    <div class="row-2"><div class="field"><label for="cd-date">Date</label><input id="cd-date" name="date" type="date" required value="${dayKey(d)}"></div><div class="field"><label for="cd-time">Time</label><input id="cd-time" name="time" type="time" value="${pad(d.getHours())}:${pad(d.getMinutes())}"></div></div>
    <div class="field"><span class="label">Color</span><div class="colors">${SWATCHES.map(s => `<label><input class="sr" type="radio" name="color" value="${s}" ${s === color ? 'checked' : ''}><button type="button" style="--c:${s}" aria-pressed="${s === color}" data-act="pick-color" data-v="${s}" aria-label="Color ${s}"></button></label>`).join('')}</div></div>`,
    `${c ? `<button class="btn ghost danger left" type="button" data-act="cd-del" data-id="${c.id}">${ic('trash')} Delete</button>` : ''}<button class="btn" type="button" data-act="close-modal">Cancel</button><button class="btn primary" type="submit">Save</button>`, {form:'cd'});
}
function mCourse(m){
  const cats = m.cats;
  return modalWrap(m.id ? 'Class settings' : 'Add a class', `<div class="row-2"><div class="field"><label for="cm-name">Class name</label><input id="cm-name" name="name" required value="${esc(m.name || '')}" placeholder="AP Biology"></div><div class="field"><label for="cm-teacher">Teacher</label><input id="cm-teacher" name="teacher" value="${esc(m.teacher || '')}"></div></div>
    <div class="field"><span class="label">Color</span><div class="colors">${SWATCHES.map(s => `<button type="button" style="--c:${s}" aria-pressed="${s === m.color}" data-act="cm-color" data-v="${s}" aria-label="Color ${s}"></button>`).join('')}</div></div>
    <div class="field"><span class="label">Platforms this class uses</span><div class="hstack">${IMPORTABLE.filter(k => k !== 'personal').map(k => `<label class="toggle small"><input type="checkbox" name="src" value="${k}" ${(m.src || []).includes(k) ? 'checked' : ''}> ${esc(srcName(k, true))}</label>`).join('')}</div></div>
    <div class="field"><span class="label">How is the grade calculated?</span><div class="seg" role="group">${[['weighted','Weighted categories'],['points','Total points']].map(([k, l]) => `<button type="button" aria-pressed="${m.scheme === k}" data-act="cm-scheme" data-v="${k}">${l}</button>`).join('')}</div></div>
    ${m.scheme === 'weighted' ? `<div class="stack-s">${cats.map((k, i) => `<div class="hstack" style="flex-wrap:nowrap"><input id="cm-cn-${i}" aria-label="Category name" data-inp="cm-cat" data-i="${i}" data-f="name" value="${esc(k.name)}" placeholder="Tests" style="flex:1"><input id="cm-cw-${i}" aria-label="Weight percent" type="number" min="0" max="100" step="any" data-inp="cm-cat" data-i="${i}" data-f="weight" value="${esc(k.weight)}" style="width:6rem"><span class="muted">%</span><button class="icon-btn" type="button" data-act="cm-cat-del" data-i="${i}" aria-label="Remove category">${ic('trash')}</button></div>`).join('')}
      <div class="between"><button class="btn sm" type="button" data-act="cm-cat-add">${ic('plus')} Add category</button><span class="small muted" id="cm-sum">Total: ${sum(cats, k => k.weight)}%</span></div>
      <p class="small muted">Find the weights in your syllabus or on Genesis. They don’t have to add to 100; Homeroom scales them.</p></div>` : ''}`,
    `${m.id ? `<button class="btn ghost danger left" type="button" data-act="course-del" data-id="${m.id}">${ic('trash')} Delete class</button>` : ''}<button class="btn" type="button" data-act="close-modal">Cancel</button><button class="btn primary" type="submit">Save</button>`, {form:'course'});
}
function mGrade(m){
  const g = m.id ? D.grades.find(x => x.id === m.id) : null;
  const cid = g?.course || m.course || D.state.courses[0]?.id || '';
  const c = course(cid);
  return modalWrap(g ? 'Edit grade' : 'Add a grade', `<div class="field"><label for="g-title">Assignment</label><input id="g-title" name="title" required value="${esc(g?.title || '')}"></div>
    <div class="row-2"><div class="field"><label for="g-course">Class</label><select id="g-course" name="course" required>${D.state.courses.map(k => opt(k.id, k.name, cid)).join('')}</select></div>
      <div class="field"><label for="g-cat">Category</label><select id="g-cat" name="cat">${opt('', '–', '')}${(c?.cats || []).map(k => opt(k.id, k.name, catOf(g || {}, c) || '')).join('')}</select></div></div>
    <div class="row-3"><div class="field"><label for="g-score">Score</label><input id="g-score" name="score" type="number" step="any" required value="${esc(g?.score ?? '')}"></div><div class="field"><label for="g-max">Out of</label><input id="g-max" name="max" type="number" step="any" min="0.01" required value="${esc(g?.max ?? 100)}"></div><div class="field"><label for="g-date">Date</label><input id="g-date" name="date" type="date" value="${esc(g?.date || dayKey(new Date()))}"></div></div>`,
    `${g ? `<button class="btn ghost danger left" type="button" data-act="grade-del" data-id="${g.id}">${ic('trash')} Delete</button>` : ''}<button class="btn" type="button" data-act="close-modal">Cancel</button><button class="btn primary" type="submit">Save</button>`, {form:'grade'});
}
function mOnboard(m){
  return modalWrap('Welcome to Homeroom', `<p>A few quick things and you’re set. You can change all of it later in Settings.</p>
    <div class="row-2"><div class="field"><label for="ob-name">Your name</label><input id="ob-name" name="name" value="${esc(m.name || '')}"></div>
      <div class="field"><label for="ob-grade">Grade</label><select id="ob-grade" name="grade">${['','9','10','11','12'].map(g => opt(g, g ? g + 'th grade' : '–', m.grade || '')).join('')}</select></div></div>
    <div class="field"><label for="ob-school">School</label><input id="ob-school" name="school" value="${esc(D.state.profile.school)}"></div>
    <div class="field"><span class="label">Pick a color scheme</span><div class="swatches">${Object.entries(PALETTES).map(([k, v]) => `<button type="button" class="swatch" aria-pressed="${P().palette === k}" data-act="pref" data-k="palette" data-v="${k}" data-keep="1"><i><span style="background:${v.b}"></span><span style="background:${v.a}"></span></i>${v.name}</button>`).join('')}</div></div>
    <div class="field"><span class="label">AP exams you’re taking in May (optional)</span>${apListHTML([])}</div>
    <label class="toggle"><input type="checkbox" name="sample" ${m.sample ? 'checked' : ''}> Add sample classes and assignments so I can try things out (remove them anytime)</label>
    ${BK.onboardExtra ? BK.onboardExtra() : ''}`,
    `<button class="btn primary" type="submit">Start</button>`, {form:'onboard', wide:true});
}

/* ---------- actions ---------- */
function setFilter(g, list){ D.state.filters[g] = list; store.save('state'); renderView(); if (S.drawer) { const d = $('#drawer-in'); if (d) d.innerHTML = drawerHTML(); } }
function findItem(id){ return D.items.find(i => i.id === id); }
function tombstone(it){ if (it?.key && it.origin !== 'manual') { D.state.dismissed = (D.state.dismissed || []).concat([it.key]).slice(-400); store.save('state'); } }
function confirmBox(title, body, ok, fn, danger){ openModal({kind:'confirm', title, body, ok, fn, danger}); }
function approve(id, quiet){
  const it = findItem(id); if (!it) return;
  it.proposed = false; it.userEdited = true; store.save('items');
  if (!quiet) toast(`Added “${it.title}” to your calendar`, {action:{label:'Undo', fn:() => { it.proposed = true; store.save('items'); renderView(); }}});
  BK.onApprove?.(it, quiet);
}
async function pinHash(pin){
  const s = `${pin}:${S.me?.id || 'demo'}:homeroom`;
  try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  catch { return 'h' + hashStr(s); }
}
function goto(view){ if (location.hash.slice(1) === view) onHash(); else location.hash = view; }
function exportJSON(){ return JSON.stringify({homeroom:1, exported:new Date().toISOString(), state:D.state, items:D.items, grades:D.grades, avgs:D.avgs}); }

const ACT = {
  'scrim':(el, e) => { if (e.target === el && !S.modal?.busy) closeModal(); },
  'close-modal':() => closeModal(), 'close-pop':() => closePop(),
  'bell':() => { S.pop = S.pop === 'bell' ? null : 'bell'; renderOverlay(); },
  'settings':el => { closePop(); const v = el?.dataset?.tab || el?.dataset?.view; S.setTab = (v && setTabs().some(t => t[0] === v)) ? v : (S.setTab || 'look'); openModal({kind:'settings'}); },
  'set-tab':el => { S.setTab = el.dataset.v; renderOverlay(); $('#set-pane')?.scrollTo?.(0, 0); },
  'drawer':() => { S.drawer = true; renderOverlay(); },
  'drawer-close':() => { S.drawer = false; renderOverlay(); },
  'f-drop':el => { const g = el.dataset.g, rest = D.state.filters[g].filter(x => x !== el.dataset.v); setFilter(g, rest); },
  'f-add':el => { const g = el.dataset.g, cur = D.state.filters[g].concat([el.dataset.v]); setFilter(g, cur.length >= filterAll(g).length ? [] : cur); },
  'clear-search':() => { S.q = ''; const q = $('#q'); if (q) q.value = ''; renderView(); },
  'add-menu':() => { S.pop = S.pop === 'add' ? null : 'add'; renderOverlay(); },
  'me-menu':() => { S.pop = S.pop === 'me' ? null : 'me'; renderOverlay(); },
  'seen-all':() => { S.prevSeen = Date.now(); D.state.lastSeen = Date.now(); D.items.forEach(i => { if (i.type === 'announcement') i.read = true; }); store.save('items'); store.save('state'); closePop(); renderView(); },
  'f-all':el => setFilter(el.dataset.g, []),
  'f-none':el => setFilter(el.dataset.g, ['__none']),
  'clear-filters':() => { D.state.filters = {src:[], types:[], status:[], courses:[]}; S.q = ''; const q = $('#q'); if (q) q.value = ''; store.save('state'); renderView(); },
  'view-load':el => { const v = D.state.views[+el.dataset.i]; if (v) { D.state.filters = clone(v.filters); store.save('state'); renderView(); } },
  'view-del':el => { D.state.views.splice(+el.dataset.i, 1); store.save('state'); renderView(); },
  'goto':el => { closePop(); goto(el.dataset.view); },
  'goto-status':() => { D.state.filters.status = ['overdue','missing']; store.save('state'); goto('assignments'); },
  'search-toggle':() => { const q = $('#q'); if (q) q.focus(); },
  'goto-grade':el => { closePop(); S.gradeCourse = el.dataset.id; goto('grades'); },
  'set':el => { const k = el.dataset.k; S[k] = el.dataset.v; if (k === 'calMode') S.calSel = null; renderView(); },
  'pref':el => {
    const k = el.dataset.k; let v = el.dataset.v;
    if (k === 'scale') v = +v; if (k === 'weekStart') v = +v;
    P()[k] = v; if (k === 'palette') P().accent = '';
    applyTheme(); store.save('state');
    if (S.modal?.kind === 'settings') renderOverlay();
    else if (S.modal && el.dataset.keep) { $$('#overlay .swatch').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v)); }
    renderView();
  },
  'accent-reset':() => { P().accent = ''; applyTheme(); store.save('state'); renderView(); renderOverlay(); },
  'src-color-reset':el => { delete P().srcColors[el.dataset.k]; store.save('state'); renderView(); renderOverlay(); },
  'toggle':el => {
    const it = findItem(el.dataset.id); if (!it) return;
    const was = it.status; it.status = was === 'done' ? 'todo' : 'done'; if (it.status === 'done') it.doneAt = Date.now();
    store.save('items'); renderView();
    if (it.status === 'done') toast(`Done: ${it.title}`, {action:{label:'Undo', fn:() => { it.status = was; store.save('items'); renderView(); }}});
  },
  'edit-item':el => { closePop(); const it = findItem(el.dataset.id); if (it) openModal({kind:'item', id:it.id}); },
  'add-item':el => { closePop(); openModal({kind:'item', day:el.dataset.day || null, preset:{type:el.dataset.type || 'assignment', src:'personal'}}); },
  'item-del':el => { const it = findItem(el.dataset.id); if (!it) return; const idx = D.items.indexOf(it); D.items.splice(idx, 1); tombstone(it); store.save('items'); closeModal(); renderView(); toast(it.proposed ? 'Suggestion dismissed' : `Deleted “${it.title}”`, {action:{label:'Undo', fn:() => { D.items.splice(idx, 0, it); store.save('items'); renderView(); }}}); },
  'item-gcal':async el => { const it = findItem(el.dataset.id); if (!it) return; el.disabled = true; el.textContent = 'Adding…'; const ok = await BK.addToCalendar(it); if (ok) { toast('Added to Google Calendar. It will remind you there.'); closeModal(); renderView(); } else { el.disabled = false; el.textContent = 'Add to Google Calendar'; } },
  'approve':el => { approve(el.dataset.id); renderView(); },
  'approve-all':() => { const ps = proposals(); ps.forEach(p => approve(p.id, true)); toast(`Added ${ps.length} item${ps.length === 1 ? '' : 's'} to your calendar`); renderView(); },
  'dismiss':el => { const it = findItem(el.dataset.id); if (!it) return; const idx = D.items.indexOf(it); D.items.splice(idx, 1); tombstone(it); store.save('items'); renderView(); toast('Suggestion dismissed', {action:{label:'Undo', fn:() => { D.items.splice(idx, 0, it); store.save('items'); renderView(); }}}); },
  'cal-move':el => { const n = +el.dataset.d, c = S.calCursor; S.calCursor = S.calMode === 'week' ? addDays(c, 7 * n) : new Date(c.getFullYear(), c.getMonth() + n, 1); S.calSel = null; renderView(); },
  'cal-today':() => { S.calCursor = startOfDay(new Date()); S.calSel = dayKey(new Date()); renderView(); },
  'cal-day':el => { S.calSel = el.dataset.day; S.calCursor = parseDate(el.dataset.day + 'T12:00'); if (S.view !== 'calendar') { S.calMode = 'month'; goto('calendar'); } else renderView(); },
  'cal-close':() => { S.calSel = null; renderView(); },
  'ann-read':el => { const it = findItem(el.dataset.id); if (it) { it.read = !it.read; store.save('items'); renderView(); } },
  'ann-read-all':() => { D.items.forEach(i => { if (i.type === 'announcement') i.read = true; }); store.save('items'); renderView(); },
  'ann-more':el => { S.drafts['ann-open-' + el.dataset.id] = !S.drafts['ann-open-' + el.dataset.id]; renderView(); },
  'ann-scan':el => { const it = findItem(el.dataset.id); if (it) scanAnnouncement(it); },
  'ann-scan-all':async () => { const list = D.items.filter(i => i.type === 'announcement' && !i.scanned).slice(0, 6); for (const a of list) { await scanAnnouncement(a); if (!BK.aiReady()) break; } },
  'import':el => { closePop(); openModal({kind:'import', src:el.dataset.src || S.lastImportSrc || 'deltamath', course:'', tab:'paste', text:'', file:null}); },
  'imp-tab':el => { S.modal.tab = el.dataset.v; S.modal.file = null; S.modal.err = ''; renderOverlay(); },
  'imp-back':() => { S.modal.preview = null; renderOverlay(); },
  'imp-run':async () => {
    const m = S.modal; m.busy = true; m.err = ''; renderOverlay();
    S.lastImportSrc = m.src;
    try {
      let prev;
      if (m.tab === 'ics') {
        const text = await m.file.text(); const evs = parseICS(text);
        if (!evs.length) throw {code:'x', message:'That file has no calendar events in it.'};
        prev = {items:evs.map(e => ({src:m.src, course:m.course || null, title:e.title.slice(0, 140), type:/\b(test|exam|quiz|due|assignment|homework|project|lab|essay)\b/i.test(e.title) ? guessType(e.title) : 'event', due:toLocalISO(e.start), end:e.end && !e.allDay ? toLocalISO(e.end) : undefined, allDay:e.allDay || undefined, url:e.url || undefined, notes:e.desc ? e.desc.slice(0, 300) : undefined, origin:'import', key:e.uid ? `ics:${m.src}:${e.uid}` : undefined})), grades:[], avgs:[]};
      } else if (m.tab === 'shot') {
        prev = await aiImport(m.src, m.course || null, '', m.file);
      } else if (BK.aiReady()) {
        prev = await aiImport(m.src, m.course || null, m.text);
      } else {
        prev = heuristicParse(m.text, m.src, m.course || null); prev.simple = true;
      }
      m.preview = prev;
    } catch (e) {
      m.err = e?.message && e.code === 'x' ? e.message : BK.aiErrorText(e);
      if (m.tab === 'paste' && !BK.aiReady()) { m.preview = heuristicParse(m.text, m.src, m.course || null); m.preview.simple = true; m.err = ''; }
    } finally { m.busy = false; renderOverlay(); }
  },
  'imp-apply':() => {
    const m = S.modal, r = applyImport(m.preview, m.src);
    closeModal(); renderView();
    toast(r.added || r.updated ? `Added ${r.added}, updated ${r.updated} from ${srcName(m.src)}.` : 'Everything from that page was already here.');
  },
  'cd-new':el => { closePop(); openModal({kind:'cd', day:el.dataset.day || null}); },
  'cd-edit':el => openModal({kind:'cd', id:el.dataset.id}),
  'cd-del':el => { const i = D.state.countdowns.findIndex(c => c.id === el.dataset.id); if (i < 0) return; const [c] = D.state.countdowns.splice(i, 1); if (c.kind === 'ap') D.state.apExams = D.state.apExams.filter(n => `AP ${n} exam` !== c.title); store.save('state'); closeModal(); renderView(); toast('Countdown deleted', {action:{label:'Undo', fn:() => { D.state.countdowns.splice(i, 0, c); store.save('state'); renderView(); }}}); },
  'unpin':el => { const it = findItem(el.dataset.id); if (it) { it.pinned = false; store.save('items'); renderView(); } },
  'pick-color':el => { $$('#overlay .colors button').forEach(b => b.setAttribute('aria-pressed', b === el)); const r = el.parentElement.querySelector('input[type=radio]'); if (r) r.checked = true; },
  'ap-pick':() => openModal({kind:'ap'}),
  'grade-course':el => { S.gradeCourse = S.gradeCourse === el.dataset.id ? null : el.dataset.id; renderView(); },
  'whatif-course':el => { S.whatCourse = el.dataset.id; goto('whatif'); },
  'grade-add':el => { closePop(); if (!D.state.courses.length) { toast('Add a class first.'); return; } openModal({kind:'grade', course:el.dataset.id || S.gradeCourse}); },
  'grade-edit':el => openModal({kind:'grade', id:el.dataset.id}),
  'grade-del':el => { D.grades = D.grades.filter(g => g.id !== el.dataset.id); store.save('grades'); closeModal(); renderView(); },
  'course-new':() => openModal({kind:'course', name:'', teacher:'', color:SWATCHES[D.state.courses.length % SWATCHES.length], scheme:'weighted', cats:[{id:uid('k'), name:'Tests', weight:50},{id:uid('k'), name:'Quizzes', weight:30},{id:uid('k'), name:'Homework', weight:20}], src:[]}),
  'course-edit':el => { const c = course(el.dataset.id); if (c) openModal({kind:'course', id:c.id, name:c.name, teacher:c.teacher, color:c.color, scheme:c.scheme === 'weighted' ? 'weighted' : 'points', cats:clone(c.cats?.length ? c.cats : [{id:uid('k'), name:'Tests', weight:50},{id:uid('k'), name:'Classwork', weight:50}]), src:c.src || []}); },
  'cm-color':el => { S.modal.color = el.dataset.v; $$('#overlay .colors button').forEach(b => b.setAttribute('aria-pressed', b === el)); },
  'cm-scheme':el => { keepCourseForm(); S.modal.scheme = el.dataset.v; renderOverlay(); },
  'cm-cat-add':() => { keepCourseForm(); S.modal.cats.push({id:uid('k'), name:'', weight:0}); renderOverlay(); $(`#cm-cn-${S.modal.cats.length - 1}`)?.focus(); },
  'cm-cat-del':el => { keepCourseForm(); S.modal.cats.splice(+el.dataset.i, 1); renderOverlay(); },
  'course-del':el => confirmBox('Delete this class?', 'Its grades are removed too. Assignments stay, without a class.', 'Delete class', () => {
    const id = el.dataset.id; D.state.courses = D.state.courses.filter(c => c.id !== id); D.grades = D.grades.filter(g => g.course !== id);
    D.items.forEach(i => { if (i.course === id) i.course = null; }); delete D.state.whatif[id]; store.saveAll(); renderView(); }, true),
  'wi-add':() => { const wi = wiState(); const c = course(S.whatCourse); wi.extra.push({id:uid('h'), title:'Next test', cat:c?.cats?.[0]?.id || null, score:90, max:100}); saveWI(); },
  'wi-del':el => { const wi = wiState(); wi.extra = wi.extra.filter(x => x.id !== el.dataset.id); saveWI(); },
  'wi-undo':el => { const wi = wiState(); delete wi.ov[el.dataset.id]; saveWI(); },
  'wi-reset':() => { D.state.whatif[S.whatCourse] = {ov:{}, extra:[]}; saveWI(); },
  'scale-reset':() => { P().scale2 = null; store.save('state'); renderView(); },
  'mail-todo':el => { const t = BK.inbox().threads.concat(S.sampleInbox).find(x => String(x.id) === el.dataset.id); if (!t) return; openModal({kind:'item', preset:{type:'assignment', src:'gmail', title:t.subject.slice(0, 140), notes:t.snippet?.slice(0, 300), url:t.sample ? '' : (t.link || `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(t.id)}`)}}); },
  'sync':() => { closePop(); BK.sync(); },
  'chat-quick':el => sendChat(el.dataset.q),
  'chat-stop':() => S.chatCtl?.abort(),
  'chat-clear':() => { D.chat = []; store.save('chat'); renderView(); },
  'remove-sample':() => confirmBox('Remove sample data?', 'This removes the made-up classes, assignments, grades and countdowns. Your own stuff stays.', 'Remove', () => { removeSample(); if (S.mode === 'demo') toast('Sample data removed. In the demo, nothing is saved.'); else toast('Sample data removed.'); renderView(); }),
  'add-sample':() => { loadSample(true); store.saveAll(); renderView(); toast('Sample data added. Remove it anytime from Settings.'); },
  'export':async () => { const j = exportJSON(); try { await navigator.clipboard.writeText(j); toast('Backup copied. Paste it somewhere safe, like a note or doc.'); } catch { openModal({kind:'export', json:j}); } },
  'restore':() => openModal({kind:'restore'}),
  'clear-done':() => { const cut = Date.now() - 30 * DAY, n = D.items.length; D.items = D.items.filter(i => !(i.status === 'done' && (dueOf(i)?.getTime() || 0) < cut)); store.save('items'); renderView(); toast(`Removed ${n - D.items.length} finished item${n - D.items.length === 1 ? '' : 's'}.`); },
  'erase':() => confirmBox('Erase everything?', 'This deletes all your classes, assignments, grades, countdowns and settings in Homeroom. Copy a backup first if you might want them.', 'Erase everything', () => {
    stopGcal(); stopGmail(); D.state = fillDefaults(null); D.state.profile.onboarded = true; D.items = []; D.grades = []; D.avgs = {}; D.chat = []; store.saveAll(); applyTheme(); renderView(); toast('Everything was erased.'); }, true),
  'pin-set':() => openModal({kind:'pin'}),
  'pin-off':() => confirmBox('Remove your PIN?', 'Homeroom will open without asking for it.', 'Remove PIN', () => { P().pinHash = null; store.save('state'); renderView(); }),
  'lock-now':() => { closePop(); S.unlocked = false; S.screen = 'lock'; render(); },
  'pin-forgot':() => { const e = $('#pin-err'); if (e) e.innerHTML = 'Your PIN only hides Homeroom on this screen. To reset it, <button class="btn sm" type="button" data-act="pin-reset">remove the PIN</button>. Your data stays.'; },
  'pin-reset':() => { P().pinHash = null; store.save('state'); S.unlocked = true; enterApp(); },
  'seen-close':() => closePop(),
  'exit-demo':() => { closePop(); BK.exitDemo(); },
  'confirm-ok':() => { const fn = S.modal?.fn; closeModal(); fn?.(); },
};
function keepCourseForm(){ const f = $('#overlay form'); if (!f) return; S.modal.name = f.elements.name?.value ?? S.modal.name; S.modal.teacher = f.elements.teacher?.value ?? S.modal.teacher; S.modal.src = [...f.querySelectorAll('input[name=src]:checked')].map(i => i.value); }
function wiState(){ const k = S.whatCourse; const w = D.state.whatif[k] ||= {ov:{}, extra:[]}; w.ov ||= {}; w.extra ||= []; return w; }
function saveWI(){ store.save('state'); renderView(); }
function wiSet(id, field, val){
  const wi = wiState(), x = wi.extra.find(r => r.id === id);
  if (x) { x[field] = val; return saveWI(); }
  const g = D.grades.find(r => r.id === id); if (!g) return;
  const o = wi.ov[id] ||= {};
  if (val === g[field] || (field === 'include' && val === (g.include !== false))) delete o[field]; else o[field] = val;
  if (!Object.keys(o).length) delete wi.ov[id];
  saveWI();
}
const CHG = {
  'filter':el => {
    const g = el.dataset.g, v = el.dataset.v;
    const all = g === 'src' ? SRC_ORDER : g === 'types' ? TYPE_ORDER : g === 'status' ? Object.keys(STATUS) : D.state.courses.map(c => c.id).concat(['_none']);
    let cur = D.state.filters[g].length ? D.state.filters[g].filter(x => x !== '__none') : [...all];
    if (D.state.filters[g].includes('__none')) cur = [];
    cur = el.checked ? [...new Set(cur.concat([v]))] : cur.filter(x => x !== v);
    setFilter(g, cur.length === all.length ? [] : cur.length ? cur : ['__none']);
  },
  'show-done':el => { S.showDone = el.checked; renderView(); },
  'wi-course':el => { S.whatCourse = el.value; renderView(); },
  'wi-cat':el => wiSet(el.dataset.id, 'cat', el.value || null),
  'wi-inc':el => wiSet(el.dataset.id, 'include', el.checked),
  'wi-score':el => wiSet(el.dataset.id, 'score', el.value === '' ? '' : +el.value),
  'wi-max':el => wiSet(el.dataset.id, 'max', el.value === '' ? '' : +el.value),
  'wi-title':el => wiSet(el.dataset.id, 'title', el.value),
  'scale':el => { const s = clone(P().scale2 || SCALE_DEFAULT); s[+el.dataset.i][0] = +el.value; s.sort((a, b) => b[0] - a[0]); P().scale2 = s; store.save('state'); renderView(); },
  'pref-bool':el => { P()[el.dataset.k] = el.checked; BK.onPrefs?.(el.dataset.k); if (S.modal?.kind === 'settings') setTimeout(renderOverlay, 0); if (el.dataset.k === 'alwaysSignin') { try { el.checked ? localStorage.removeItem('hr-auto') : localStorage.setItem('hr-auto', '1'); } catch {} } applyTheme(); store.save('state'); renderView(); },
  'pref-num':el => { P()[el.dataset.k] = +el.value; store.save('state'); renderView(); BK.onPrefs?.(el.dataset.k); },
  'alert':el => { P().alerts[el.dataset.k] = el.checked; store.save('state'); renderView(); },
  'accent':el => { P().accent = el.value; applyTheme(); store.save('state'); renderView(); },
  'src-color':el => { P().srcColors[el.dataset.k] = el.value; store.save('state'); renderView(); },
  'profile':el => { D.state.profile[el.dataset.k] = el.value.trim(); store.save('state'); renderView(); },
  'gm':el => { const k = el.dataset.k; P().gmail[k] = k === 'days' ? clamp(+el.value || 7, 1, 60) : el.value.trim(); store.save('state'); BK.onGmailPrefs?.(); renderView(); if (k === 'inbox') renderOverlay(); },
  'gm-bool':el => { P().gmail[el.dataset.k] = el.checked; store.save('state'); BK.onGmailPrefs?.(); renderView(); },
  'ann-course':el => { S.annCourse = el.value; renderView(); },
  'pref-time':el => { P()[el.dataset.k] = el.value; store.save('state'); },
  'instant':el => { P().instant[el.dataset.k] = el.checked; store.save('state'); },
  'link':el => { const u = safeUrl(el.value.trim()); if (el.value.trim() && !u) { toast('That doesn’t look like a web address. It should start with https://', {kind:'bad'}); return; } D.state.conn.links[el.dataset.k] = u; store.save('state'); renderView(); },
  'imp-src':el => { S.modal.src = el.value; S.modal.preview = null; renderOverlay(); },
  'imp-course':el => { S.modal.course = el.value; if (S.modal.preview) { S.modal.preview = null; renderOverlay(); } },
  'imp-file':el => { S.modal.file = el.files?.[0] || null; S.modal.err = ''; renderOverlay(); },
  'imp-toggle':el => { const arr = S.modal.preview[el.dataset.k]; arr[+el.dataset.i]._on = el.checked; renderOverlay(); },
};
const INP = {
  'search':el => { S.q = el.value; renderSoon(); },
  'imp-text':el => { S.modal.text = el.value; const b = $('#overlay [data-act="imp-run"]'); if (b) b.disabled = S.modal.busy || el.value.trim().length <= 10; },
  'cm-cat':el => { const k = S.modal.cats[+el.dataset.i]; if (!k) return; k[el.dataset.f] = el.dataset.f === 'weight' ? (+el.value || 0) : el.value; const s = $('#cm-sum'); if (s) s.textContent = `Total: ${sum(S.modal.cats, x => x.weight)}%`; },
};
const FORM = {
  'item':f => {
    const m = S.modal, F = new FormData(f), g = k => (F.get(k) ?? '').toString().trim();
    const existing = m.id ? findItem(m.id) : null;
    const type = g('type'), ann = type === 'announcement';
    const it = existing || {id:uid('i'), created:Date.now(), origin:m.preset?.origin || 'manual', status:'todo'};
    it.title = g('title') || 'Untitled'; it.type = type; it.src = g('src') || 'personal'; it.course = g('course') || null;
    it.url = safeUrl(g('url')) || undefined;
    if (ann) {
      it.teacher = g('teacher') || undefined; it.body = g('body') || undefined;
      const pd = g('posted'); it.posted = pd ? `${pd}T${existing?.posted?.slice(11, 16) || pad(new Date().getHours()) + ':' + pad(new Date().getMinutes())}` : toLocalISO(new Date());
      it.due = null; if (!existing) it.read = true;
    } else {
      const date = g('date'), time = g('time') || '23:59', end = g('end');
      it.allDay = F.get('allDay') ? true : undefined;
      it.due = date ? `${date}T${it.allDay ? '00:00' : time}` : null;
      it.end = date && end && !it.allDay ? `${date}T${end}` : undefined;
      it.notes = g('notes') || undefined;
      it.score = g('score') !== '' ? +g('score') : undefined; it.max = g('max') !== '' ? +g('max') : undefined;
      it.status = F.get('done') ? 'done' : 'todo'; it.missing = !!F.get('missing') || undefined; it.pinned = !!F.get('pinned') || undefined;
    }
    if (existing) { it.userEdited = true; if (it.proposed) { it.proposed = false; BK.onApprove?.(it, true); } }
    else D.items.push(it);
    store.save('items'); closeModal(); renderView();
    toast(existing ? 'Saved' : `Added “${it.title}”`);
  },
  'cd':f => {
    const F = new FormData(f), id = S.modal.id;
    const c = id ? D.state.countdowns.find(x => x.id === id) : {id:uid('cd'), kind:'custom'};
    c.title = (F.get('title') || '').toString().trim() || 'Countdown'; c.date = `${F.get('date')}T${F.get('time') || '08:00'}`; c.color = (F.get('color') || SWATCHES[0]).toString();
    if (!id) D.state.countdowns.push(c);
    store.save('state'); closeModal(); renderView();
  },
  'ap':f => { setAP([...f.querySelectorAll('input[name=ap]:checked')].map(i => i.value)); closeModal(); renderView(); },
  'course':f => {
    keepCourseForm();
    const m = S.modal; if (!m.name.trim()) return;
    const c = m.id ? course(m.id) : {id:uid('c')};
    Object.assign(c, {name:m.name.trim(), teacher:m.teacher.trim(), color:m.color, scheme:m.scheme, cats:m.scheme === 'weighted' ? m.cats.filter(k => k.name.trim()).map(k => ({id:k.id, name:k.name.trim(), weight:+k.weight || 0})) : [], src:m.src});
    if (!m.id) D.state.courses.push(c);
    store.save('state'); closeModal(); renderView(); toast(m.id ? 'Class saved' : `Added ${c.name}`);
  },
  'grade':f => {
    const F = new FormData(f), id = S.modal.id;
    const g = id ? D.grades.find(x => x.id === id) : {id:uid('g'), created:Date.now(), src:'personal'};
    Object.assign(g, {title:F.get('title').toString().trim(), course:F.get('course').toString(), cat:F.get('cat')?.toString() || null, score:+F.get('score'), max:+F.get('max') || 100, date:F.get('date')?.toString() || dayKey(new Date())});
    if (!id) D.grades.push(g);
    store.save('grades'); closeModal(); renderView();
  },
  'onboard':f => {
    const F = new FormData(f);
    D.state.profile.name = (F.get('name') || '').toString().trim(); D.state.profile.grade = (F.get('grade') || '').toString(); D.state.profile.school = (F.get('school') || '').toString().trim();
    D.state.profile.onboarded = true;
    const aps = [...f.querySelectorAll('input[name=ap]:checked')].map(i => i.value);
    if (F.get('sample')) loadSample(true);
    if (aps.length) setAP(aps);
    store.saveAll(); closeModal(); render();
    BK.afterOnboard ? BK.afterOnboard() : (S.setTab = 'accounts', openModal({kind:'settings'}));
  },
  'pin':async f => {
    const F = new FormData(f), a = (F.get('pin1') || '').toString(), b = (F.get('pin2') || '').toString();
    if (!/^\d{4,8}$/.test(a)) { S.modal.err = 'Use 4 to 8 digits.'; renderOverlay(); return; }
    if (a !== b) { S.modal.err = 'Those don’t match.'; renderOverlay(); return; }
    P().pinHash = await pinHash(a); store.save('state'); closeModal(); renderView(); toast('PIN set. Homeroom will ask for it next time it opens.');
  },
  'unlock':async f => {
    const pin = (new FormData(f).get('pin') || '').toString();
    if (await pinHash(pin) === P().pinHash) { S.unlocked = true; enterApp(); }
    else { const e = $('#pin-err'); if (e) e.textContent = 'That PIN isn’t right.'; f.elements.pin.value = ''; f.elements.pin.focus(); }
  },
  'restore':f => {
    try {
      const j = JSON.parse(new FormData(f).get('json').toString());
      if (!j || j.homeroom !== 1 || !j.state) throw 0;
      D.state = fillDefaults(j.state); D.items = Array.isArray(j.items) ? j.items : []; D.grades = Array.isArray(j.grades) ? j.grades : []; D.avgs = j.avgs || {};
      store.saveAll(); applyTheme(); closeModal(); render(); toast('Backup restored.');
    } catch { S.modal.err = 'That isn’t a Homeroom backup. Copy the whole thing and try again.'; renderOverlay(); }
  },
  'chat':f => { const t = $('#chat-input'); sendChat(t?.value); },
  'studyplan':f => {
    const F = new FormData(f), t = F.get('test')?.toString() || '';
    let what;
    if (t.startsWith('cd:')) { const c = D.state.countdowns.find(x => 'cd:' + x.id === t); what = c ? `${c.title} on ${fmtDay(parseDate(c.date), true)}, ${parseDate(c.date).getFullYear()}` : 'my AP exam'; }
    else if (t === 'custom' || !t) what = 'an upcoming test (ask me which one)';
    else { const it = findItem(t); what = it ? `“${it.title}”${courseName(it.course) ? ' for ' + courseName(it.course) : ''}, due ${fmtDay(dueOf(it), true)} at ${fmtTime(dueOf(it))}` : 'my next test'; }
    const topics = F.get('topics')?.toString().trim();
    sendChat(`Make me a study plan for ${what}. ${F.get('n') || 4} sessions of about ${F.get('mins') || 40} minutes.${topics ? ' Topics: ' + topics + '.' : ''} Check my schedule first so the sessions avoid busy days, then propose them.`);
  },
  'solve':f => { const F = new FormData(f); S.drafts.solve = {target:+F.get('target') || 90, cat:F.get('cat')?.toString() || '', max:+F.get('max') || 100}; renderView(); },
  'save-view':f => { const name = (new FormData(f).get('name') || '').toString().trim(); if (!name || !activeFilters()) return; D.state.views.push({name:name.slice(0, 40), filters:clone(D.state.filters)}); S.drafts['sv-name'] = ''; store.save('state'); renderView(); toast(`Saved “${name}”`); },
};
function setAP(names){
  D.state.apExams = names;
  const keep = D.state.countdowns.filter(c => c.kind !== 'ap' || names.some(n => c.title === `AP ${n} exam`));
  for (const n of names) {
    if (keep.some(c => c.kind === 'ap' && c.title === `AP ${n} exam`)) continue;
    const e = AP_2027.find(a => a.name === n); if (!e) continue;
    keep.push({id:uid('cd'), kind:'ap', title:`AP ${n} exam`, date:e.at, color:'#6FA27E'});
  }
  D.state.countdowns = keep; store.save('state');
}


/* ---------- AI glue (uses whichever backend is loaded) ---------- */
function plannerRules(){
  const cs = D.state.courses.map(c => `${c.name}${c.teacher ? ' (' + c.teacher + ')' : ''}`).join('; ') || 'not set up yet';
  const ap = D.state.countdowns.filter(c => c.kind === 'ap').map(c => `${c.title} on ${fmtDay(parseDate(c.date), true)}`).join('; ') || 'none chosen';
  return `You are the planning assistant inside Homeroom, a high-school student's school dashboard. Right now it is ${fmtDay(new Date(), true)}, ${new Date().getFullYear()}, ${fmtTime(new Date())} (${TZ}).
Their classes: ${cs}. AP exams: ${ap}.
How to help:
- Base every answer about dates on their real schedule. Never invent assignments.
- When you suggest something for the calendar (study sessions, start-early reminders, review blocks), propose it as an event. The student approves each one in the app; say they're waiting for approval and never claim you added them.
- Study plans: spread sessions over the days before the test, avoid days that are already busy or have events, 25–60 minutes each, after school (3:30–9 PM) on weekdays unless they say otherwise, and name the topic of each session.
- Call out overlaps and crunch weeks plainly and suggest what to start first.
- Be brief and warm. Short paragraphs or short "-" lists, at most about 150 words unless they ask for more. No headings, no tables.`;
}
function scheduleSnapshot(fromKey, toKey){
  const a = parseDate(String(fromKey) + 'T00:00') || startOfDay(new Date()), b = parseDate(String(toKey) + 'T23:59') || addDays(new Date(), 14);
  return D.items.filter(it => !it.hidden && isDated(it) && dueOf(it) >= a && dueOf(it) <= b).sort(sortByDue).slice(0, 120)
    .map(it => ({title:it.title, type:it.type, class:courseName(it.course) || null, platform:srcName(it.src, true), due:toLocalISO(dueOf(it)), end:it.end || null, status:it.proposed ? 'proposed' : it.status === 'done' ? 'done' : (dueOf(it) < Date.now() ? 'overdue' : 'todo'), missing:!!it.missing}));
}
function gradeSnapshot(){ return D.state.courses.map(c => { const s = courseSummary(c.id); return {class:c.name, percent:s.pct != null ? +s.pct.toFixed(1) : null, letter:letterFor(s.pct)}; }); }
function proposeEvents(events, reply){
  const list = (Array.isArray(events) ? events : []).slice(0, 20).filter(e => e?.title && parseDate(e.start));
  const made = list.map(e => ({id:uid('p'), created:Date.now(), status:'todo', src:'personal', type:['study','event','assignment'].includes(e.type) ? e.type : 'study', title:String(e.title).slice(0, 140),
    course:matchCourse(e.class) || undefined, due:toLocalISO(parseDate(e.start)), end:e.end && parseDate(e.end) ? toLocalISO(parseDate(e.end)) : undefined, notes:e.notes ? String(e.notes).slice(0, 400) : undefined, proposed:true, origin:'ai'}));
  D.items.push(...made); store.save('items');
  if (reply) reply.props = (reply.props || []).concat(made.map(m => m.id));
  renderSoon();
  return made.length;
}
async function sendChat(text){
  text = String(text || '').trim();
  if (!text || S.chatBusy) return;
  if (!BK.aiReady()) { toast(BK.aiOffNote || 'The AI planner isn’t available here.'); return; }
  D.chat.push({role:'user', content:text, t:Date.now()});
  const reply = {role:'assistant', content:'', t:Date.now(), pending:true};
  D.chat.push(reply);
  S.drafts['chat-input'] = ''; S.chatBusy = true; S.chatCtl = new AbortController();
  renderView(); scrollChat();
  const turns = D.chat.filter(m => !m.pending && m.content && !m.error).slice(-16).map(m => ({role:m.role, content:m.content}));
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== 'user') turns.push({role:'user', content:text});
  try {
    const r = await BK.chat(turns, {reply, signal:S.chatCtl.signal, onText:t => { reply.content = t; updateChatBubble(reply); }});
    reply.content = r.text || reply.content;
    if (r.events?.length) proposeEvents(r.events, reply);
    if (r.truncated) reply.content += '\n\n(Cut short. Ask for less at a time.)';
  } catch (e) {
    reply.content = e?.text || ''; reply.error = e?.code === 'cancelled' ? '' : BK.aiErrorText(e);
  } finally {
    delete reply.pending; S.chatBusy = false; S.chatCtl = null;
    store.save('chat'); renderView(); scrollChat();
  }
}
function updateChatBubble(m){ const i = D.chat.indexOf(m); const el = document.getElementById('msg-' + i); if (el) { el.innerHTML = md(m.content) || '<span class="thinking">Thinking…</span>'; scrollChat(); } }
function scrollChat(){ const b = $('#msgs'); if (b) b.scrollTop = b.scrollHeight; }
function md(s){
  const lines = esc(s).split('\n'); let html = '', inList = false;
  for (const l of lines) {
    const li = l.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inl(li[1])}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (l.trim()) html += `<p>${inl(l)}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
  function inl(t){ return t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\s)\*(.+?)\*(?=\s|$)/g, '$1<i>$2</i>').replace(/^#+\s*/, ''); }
}
async function scanAnnouncement(it){
  if (!BK.aiReady()) { toast(BK.aiOffNote || 'The AI isn’t available here.'); return; }
  it._scanning = true; renderView();
  try {
    const res = await BK.json(`A teacher posted this class announcement. List every date in it that a high-school student should put on their calendar (tests, quizzes, due dates, events, extra help, schedule changes).
Today is ${fmtDay(new Date(), true)}, ${new Date().getFullYear()}. The announcement was posted ${it.posted ? fmtDay(parseDate(it.posted), true) : 'recently'}. Class: ${courseName(it.course) || 'unknown'}.
Reply with only a JSON array of {"title":string,"type":"test"|"quiz"|"project"|"assignment"|"event","due":"YYYY-MM-DDTHH:MM"}. Use 08:00 for in-class tests, 23:59 for deadlines with no time. [] if there are none.
ANNOUNCEMENT:
${it.title}\n${it.body || ''}`, {tier:'quick'});
    const list = (Array.isArray(res) ? res : []).filter(d => d?.title && parseDate(d.due));
    upsertItems(list.map(d => ({src:it.src, course:it.course, type:TYPES[d.type] ? d.type : 'event', title:String(d.title).slice(0, 140), due:toLocalISO(parseDate(d.due)), proposed:true, origin:'ai', fromAnn:it.id, url:it.url})));
    it.scanned = true; store.save('items');
    toast(list.length ? `Found ${list.length} date${list.length === 1 ? '' : 's'}. Approve the ones you want.` : 'No dates in that announcement.');
  } catch (e) { toast(BK.aiErrorText(e), {kind:'bad'}); }
  finally { delete it._scanning; renderView(); }
}
async function aiImport(srcKey, courseId, text, file){
  const res = await BK.json(importPrompt(srcKey, courseId ? courseName(courseId) : '', text), {images:file ? [file] : null});
  return normalizeImport(res, srcKey, courseId);
}

/* ---------- events ---------- */
function bindEvents(){
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const fn = ACT[el.dataset.act]; if (!fn) return;
    if (el.tagName === 'A' && (el.getAttribute('href') || '').startsWith('#') && el.dataset.act !== 'close-pop') e.preventDefault();
    fn(el, e);
  });
  document.addEventListener('change', e => { const el = e.target.closest('[data-chg]'); if (el) CHG[el.dataset.chg]?.(el, e); });
  document.addEventListener('input', e => { const el = e.target; if (el.dataset && 'draft' in el.dataset) S.drafts[el.id] = el.value; const k = el.dataset?.inp; if (k) INP[k]?.(el, e); });
  document.addEventListener('submit', e => { const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault(); FORM[f.dataset.form]?.(f, e); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (S.pop) closePop(); else if (S.modal && !S.modal.busy) closeModal(); else if (S.drawer) { S.drawer = false; renderOverlay(); } }
    if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'chat-input') { e.preventDefault(); sendChat(e.target.value); }
  });
  document.addEventListener('dragover', e => { const d = e.target.closest?.('[data-drop]'); if (d) { e.preventDefault(); d.classList.add('over'); } });
  document.addEventListener('dragleave', e => { const d = e.target.closest?.('[data-drop]'); if (d) d.classList.remove('over'); });
  document.addEventListener('drop', e => { const d = e.target.closest?.('[data-drop]'); if (!d || !S.modal) return; e.preventDefault(); const file = e.dataTransfer?.files?.[0]; if (file) { S.modal.file = file; S.modal.err = ''; renderOverlay(); } });
  document.addEventListener('paste', e => {
    if (S.modal?.kind !== 'import' || S.modal.tab !== 'shot') return;
    const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
    if (f) { S.modal.file = new File([f], 'pasted-screenshot.png', {type:f.type}); renderOverlay(); }
  });
  window.addEventListener('hashchange', () => onHash());
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme); } catch {}
  try { new MutationObserver(applyTheme).observe(document.documentElement, {attributes:true, attributeFilter:['data-theme']}); } catch {}
}
function onHash(initial){
  const h = location.hash.slice(1);
  if (VIEWS[h]) S.view = h; else if (!initial) S.view = 'today';
  if (S.screen === 'app') { closePop(); renderView(); window.scrollTo(0, 0); }
}

/* ---------- ticker ---------- */
let tickN = 0, ticker = null;
function startTicker(){
  if (ticker) return;
  ticker = setInterval(() => {
    tickN++;
    $$('[data-cd]').forEach(el => { const p = cdParts(el.dataset.cd); if (el.dataset.cdMode === 'd') { if (el.firstChild) el.firstChild.nodeValue = String(p.d); } else el.textContent = hms(p); });
    if (tickN % 60 === 0 && S.screen === 'app' && !S.modal && !S.pop && !isTyping() && !S.chatBusy) renderView();
  }, 1000);
}

/* ---------- boot ---------- */
function greetToast(){
  const now = Date.now(), open = D.items.filter(i => isTask(i) && i.status !== 'done' && !i.hidden && dueOf(i));
  const late = open.filter(i => dueOf(i) < now).length, soon = open.filter(i => dueOf(i) >= now && dueOf(i) - now < P().remindHours * HOUR).length;
  if (late || soon) toast([late ? `${late} overdue` : '', soon ? `${soon} due soon` : ''].filter(Boolean).join(' · '), {action:{label:'Show', fn:() => goto('assignments')}});
}
function enterApp(){
  S.screen = 'app';
  S.prevSeen = D.state.lastSeen || null;
  D.state.lastSeen = Date.now(); store.save('state');
  onHash(true); render();
  if (!D.state.profile.onboarded) openModal({kind:'onboard', name:BK.defaultName ? BK.defaultName() : '', sample:false});
  else greetToast();
  BK.onEnter?.();
  startTicker();
}
function openDemo(){
  S.mode = 'demo'; D.state = fillDefaults(null);
  D.state.profile.name = 'Alex'; D.state.profile.onboarded = true;
  loadSample(true);
  D.state.lastSeen = Date.now() - 2 * DAY;
  D.chat = [];
  applyTheme(); enterApp();
}
function boot(){
  D.state = fillDefaults(null);
  applyTheme(); bindEvents(); render();
  Object.assign(ACT, BK.ACT || {}); Object.assign(CHG, BK.CHG || {}); Object.assign(FORM, BK.FORM || {});
  BK.boot();
}
boot();
