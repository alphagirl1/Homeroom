/* =====================================================================
   Homeroom: views (redesigned: six tabs, sub-tabs, slim rows)
   ===================================================================== */

const linkFor = it => safeUrl(it.url) || safeUrl(D.state.conn.links[it.src]) || safeUrl(SOURCES[it.src]?.url) || '';
const isNew = it => !!S.prevSeen && it.created && it.created > S.prevSeen && !['manual','sample'].includes(it.origin);
const srcChip = src => `<span class="chip" style="--c:${srcColor(src)}"><span class="dot"></span>${esc(srcName(src, true))}</span>`;
function dueBits(it){
  const st = dueState(it), d = dueOf(it);
  if (st === 'done') return {cls:'', text:'Done', sub:''};
  if (!d) return {cls:'', text:'No date', sub:''};
  if (it.type === 'absence') return {cls:'', text:relDay(d), sub:''};
  const cls = st === 'overdue' ? 'overdue' : st === 'soon' ? 'soon' : '';
  return {cls, text:st === 'overdue' ? relDay(d) : dueLabel(it), sub:it.type === 'event' ? '' : timeLeft(d)};
}
function itemRow(it, o = {}){
  const b = dueBits(it), url = linkFor(it), cn = courseName(it.course);
  const meta = [
    cn ? `<span>${esc(cn)}</span>` : '',
    `<span class="src"><span class="dot" style="--c:${srcColor(it.src)}"></span>${esc(srcName(it.src, true))}</span>`,
    MAJOR.has(it.type) || ['lab','event','study','absence'].includes(it.type) ? `<span>${TYPES[it.type].label}</span>` : '',
    it.missing && it.status !== 'done' ? '<span class="miss">Missing</span>' : '',
    it.score != null && it.max ? `<span class="num">${esc(it.score)}/${esc(it.max)}</span>` : '',
  ].filter(Boolean).join('');
  const tick = isTask(it) && !o.noTick
    ? `<button class="tick" role="checkbox" aria-checked="${it.status === 'done'}" aria-label="Mark “${esc(it.title)}” done" data-act="toggle" data-id="${it.id}">${it.status === 'done' ? ic('check') : ''}</button>` : '';
  return `<div class="it ${it.status === 'done' ? 'is-done' : ''}" style="--c:${itemColor(it)}">${tick}
    <button class="it-main" data-act="edit-item" data-id="${it.id}"><span class="it-title">${isNew(it) ? '<span class="newdot" title="New since your last visit"></span>' : ''}${esc(it.title)}</span><span class="it-meta">${meta}</span></button>
    <span class="due ${b.cls}">${esc(b.text)}${b.sub ? `<small>${esc(b.sub)}</small>` : ''}</span>
    ${url ? `<a class="icon-btn" href="${esc(url)}" target="_blank" rel="noopener" title="Open in ${esc(srcName(it.src))}" aria-label="Open in ${esc(srcName(it.src))}">${ic('ext')}</a>` : '<span style="width:2.25rem;flex:none"></span>'}
  </div>`;
}
function proposalRow(it){
  return `<div class="proposal">
    <span class="dot" style="--c:${itemColor(it)}"></span>
    <div class="grow"><b>${esc(it.title)}</b><div class="small muted">${dueOf(it) ? esc(dueLabel(it)) : 'No date'}${courseName(it.course) ? ' · ' + esc(courseName(it.course)) : ''}</div></div>
    <span class="p-acts"><button class="btn sm primary" data-act="approve" data-id="${it.id}">${ic('check')} Add</button>
    <button class="btn sm ghost" data-act="edit-item" data-id="${it.id}">Edit</button>
    <button class="icon-btn" data-act="dismiss" data-id="${it.id}" aria-label="Dismiss suggestion" title="Dismiss">${ic('x')}</button></span>
  </div>`;
}
function empty(text, btn){ return `<div class="empty"><div>${text}</div>${btn || ''}</div>`; }
function pageHead(title, lead, actions = ''){ return `<div class="page-h"><div><h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}</div>${actions ? `<div class="hstack">${actions}</div>` : ''}</div>`; }
function subTabs(){
  const nav = VIEWS[S.view].nav, subs = SUBS[nav]; if (!subs) return '';
  return `<nav class="subtabs" aria-label="${esc(VIEWS[nav].label)} sections">${subs.map(v => `<a href="#${v}" ${S.view === v ? 'aria-current="page"' : ''}>${esc(VIEWS[v].sub)}</a>`).join('')}</nav>`;
}
function sampleBanner(){
  if (S.mode === 'demo') return `<div class="banner">${ic('spark')}<p class="grow"><b>Sample data.</b> Nothing here is saved. ${BK.demoNote || ''}</p><button class="btn sm" data-act="exit-demo">Leave demo</button></div>`;
  if (hasSample()) return `<div class="banner">${ic('spark')}<p class="grow"><b>Sample classes are mixed in</b> so you can try things out.</p><button class="btn sm" data-act="remove-sample">Remove them</button></div>`;
  return '';
}
/* filter button + removable chips (shows whichever is shorter: what's shown, or what's hidden) */
function filterAll(g){ return g === 'src' ? SRC_ORDER : g === 'types' ? TYPE_ORDER : g === 'status' ? Object.keys(STATUS) : D.state.courses.map(c => c.id).concat(['_none']); }
function filterBar(extra = ''){
  const f = D.state.filters, chips = [];
  const lab = {src:k => srcName(k, true), types:k => TYPES[k]?.plural || k, status:k => STATUS[k] || k, courses:k => k === '_none' ? 'No class' : courseName(k)};
  const word = {src:'platforms', types:'kinds', status:'statuses', courses:'classes'};
  for (const g of ['src','types','status','courses']) {
    if (!f[g].length) continue;
    if (f[g].includes('__none')) { chips.push(`<span class="chip">No ${word[g]} shown<button data-act="f-all" data-g="${g}" aria-label="Show all">${ic('x')}</button></span>`); continue; }
    const all = filterAll(g), hidden = all.filter(k => !f[g].includes(k));
    if (hidden.length <= f[g].length) hidden.slice(0, 4).forEach(v => chips.push(`<span class="chip" ${g === 'src' ? `style="--c:${srcColor(v)}"` : ''}>Hiding ${esc(lab[g](v))}<button data-act="f-add" data-g="${g}" data-v="${esc(v)}" aria-label="Show ${esc(lab[g](v))} again">${ic('x')}</button></span>`));
    else f[g].slice(0, 4).forEach(v => chips.push(`<span class="chip" ${g === 'src' ? `style="--c:${srcColor(v)}"` : ''}>Only ${esc(lab[g](v))}<button data-act="f-drop" data-g="${g}" data-v="${esc(v)}" aria-label="Remove filter">${ic('x')}</button></span>`));
  }
  if (S.q) chips.push(`<span class="chip">“${esc(S.q)}”<button data-act="clear-search" aria-label="Clear search">${ic('x')}</button></span>`);
  const n = activeFilters();
  return `<div class="toolbar"><button class="btn sm ${n ? 'soft' : ''}" data-act="drawer">${ic('filter')} Filters${n ? ` · ${n}` : ''}</button>${chips.join('')}${chips.length ? '<button class="btn sm ghost" data-act="clear-filters">Clear</button>' : ''}<span class="grow"></span>${extra}</div>`;
}
function cdParts(date){
  const ms = parseDate(date) - Date.now();
  if (ms <= 0) return {done:true, d:0, h:0, m:0, s:0};
  return {done:false, d:Math.floor(ms / DAY), h:Math.floor(ms % DAY / HOUR), m:Math.floor(ms % HOUR / 6e4), s:Math.floor(ms % 6e4 / 1000)};
}
const hms = p => p.done ? 'It’s here' : `${p.h}h ${pad(p.m)}m${P().seconds ? ' ' + pad(p.s) + 's' : ''}`;
function allCountdowns(){
  const pinned = D.items.filter(i => i.pinned && dueOf(i) && !i.proposed).map(i => ({id:i.id, kind:'item', title:i.title, date:toLocalISO(dueOf(i)), color:itemColor(i), item:true, sub:courseName(i.course)}));
  return D.state.countdowns.concat(pinned).filter(c => parseDate(c.date)).sort((a, b) => parseDate(a.date) - parseDate(b.date));
}
function spark(points, color){
  if (points.length < 2) return '';
  const w = 220, h = 40, vals = points.map(p => p.pct), lo = Math.min(...vals) - 1.5, hi = Math.max(...vals) + 1.5;
  const x = i => (i / (points.length - 1) * (w - 8) + 4), y = v => h - 4 - (v - lo) / (hi - lo || 1) * (h - 10);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><line x1="0" x2="${w}" y1="${h - 2}" y2="${h - 2}" stroke="currentColor" stroke-opacity=".12"/><polygon points="4,${h - 2} ${pts} ${x(vals.length - 1).toFixed(1)},${h - 2}" fill="${color}" fill-opacity=".13"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(vals.length - 1).toFixed(1)}" cy="${y(vals[vals.length - 1]).toFixed(1)}" r="3.2" fill="${color}"/></svg>`;
}
function notifications(){
  const out = [], now = Date.now(), pv = S.prevSeen || now - DAY, al = P().alerts;
  const open = D.items.filter(i => isTask(i) && i.status !== 'done' && !i.hidden && dueOf(i));
  if (al.overdue) open.filter(i => dueOf(i) < now).sort(sortByDue).forEach(i => out.push({c:'var(--bad)', icon:'warn', text:`${i.title} is overdue`, sub:`${courseName(i.course) || srcName(i.src)} · was due ${relDay(dueOf(i))}`, act:'edit-item', id:i.id}));
  open.filter(i => dueOf(i) >= now && dueOf(i) - now < P().remindHours * HOUR).sort(sortByDue).forEach(i => out.push({c:'var(--warn)', icon:'timer', text:i.title, sub:`Due ${dueLabel(i)} · ${timeLeft(dueOf(i))}`, act:'edit-item', id:i.id}));
  if (al.grades) D.grades.filter(g => (g.created && g.created > pv && g.created > now - 14 * DAY) || (!g.created && g.date && parseDate(g.date + 'T12:00') > pv - DAY)).slice(0, 6)
    .forEach(g => out.push({c:'var(--good)', icon:'grades', text:`New grade: ${g.title} · ${g.score}/${g.max}`, sub:courseName(g.course), act:'goto-grade', id:g.course}));
  if (al.ann) D.items.filter(i => i.type === 'announcement' && !i.read && !i.hidden).forEach(i => out.push({c:'var(--info)', icon:'mega', text:`${i.teacher || courseName(i.course) || 'Announcement'}: ${i.title}`, sub:courseName(i.course), act:'goto', view:'inbox'}));
  const pr = proposals().length;
  if (pr) out.push({c:'var(--accent)', icon:'spark', text:`${pr} suggested date${pr === 1 ? '' : 's'} need${pr === 1 ? 's' : ''} your OK`, sub:'From announcements and the planner', act:'goto', view:'inbox'});
  for (const n of BK.notes ? BK.notes() : []) out.push(n);
  return out;
}

/* ---------- Today ---------- */
function vToday(){
  const now = new Date(), list = tasks().filter(i => i.status !== 'done');
  const late = list.filter(i => (dueOf(i) && dueOf(i) < now) || i.missing).sort(sortByDue);
  const today = list.filter(i => dueOf(i) && dueOf(i) >= now && dayDiff(dueOf(i)) === 0);
  const week = list.filter(i => { const d = dueOf(i); return d && d >= now && d < addDays(startOfDay(now), 7); });
  const upnext = list.filter(i => dueOf(i) && dueOf(i) >= now && dueOf(i) < addDays(startOfDay(now), 8)).sort(sortByDue);
  const groups = {}; for (const it of upnext) (groups[relDay(dueOf(it))] ||= []).push(it);
  const heads = analyze(now, 14, visible()).slice(0, 3);
  const cds = allCountdowns().filter(c => parseDate(c.date) > now).slice(0, 3);
  const props = proposals();
  const pv = S.prevSeen || now - 7 * DAY;
  const newGrades = D.grades.filter(g => (g.created && g.created > pv) || (!g.created && g.date && parseDate(g.date + 'T12:00') > now - 3 * DAY)).length;
  const unread = D.items.filter(i => i.type === 'announcement' && !i.read && !i.hidden).length;
  const parts = [];
  if (late.length) parts.push(`<b>${late.length} overdue</b>`);
  parts.push(today.length ? `<b>${today.length} due today</b>` : 'nothing else due today');
  parts.push(`<b>${week.length - today.length}</b> more this week`);
  const lead = parts.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.';
  return `${pageHead(esc(greeting()), lead)}${sampleBanner()}${BK.todayTop ? BK.todayTop() : ''}
  ${(activeFilters() || S.q) ? filterBar() : ''}
  <div class="grid-main">
    <div class="stack">
      ${late.length ? `<section class="card"><div class="card-head"><h2>${ic('warn')} Catch up</h2></div><div class="list">${late.slice(0, 5).map(i => itemRow(i)).join('')}</div>${late.length > 5 ? `<a class="btn sm ghost" href="#assignments" style="margin-top:8px">See all ${late.length}</a>` : ''}</section>` : ''}
      <section class="card"><div class="card-head"><h2>${ic('list')} Up next</h2><a class="btn sm ghost" href="#assignments">All assignments</a></div>
        ${upnext.length ? `<div class="list">${Object.entries(groups).map(([k, arr]) => `<div class="group-h">${esc(k)}</div>${arr.map(i => itemRow(i)).join('')}`).join('')}</div>` : empty('Nothing due in the next week.', `<button class="btn sm" data-act="add-item">${ic('plus')} Add something</button>`)}
      </section>
    </div>
    <div class="stack">
      <section class="card"><div class="card-head"><h2>${ic('timer')} Countdowns</h2><a class="btn sm ghost" href="#countdowns">All</a></div>
        ${cds.length ? cds.map(c => { const p = cdParts(c.date); return `<div class="cd-mini" style="--c:${esc(c.color || 'var(--accent)')}"><div class="n"><span data-cd="${esc(c.date)}" data-cd-mode="d">${p.d}</span><small>days</small></div><div style="min-width:0"><b>${esc(c.title)}</b><div class="small muted">${esc(fmtDay(parseDate(c.date)))}</div></div></div>`; }).join('') : empty('No countdowns yet.', `<button class="btn sm" data-act="cd-new">${ic('plus')} Add one</button>`)}
      </section>
      ${props.length ? `<section class="card"><div class="card-head"><h2>${ic('spark')} Needs your OK</h2><a class="btn sm ghost" href="#inbox">${props.length > 3 ? 'All ' + props.length : 'Inbox'}</a></div><div class="stack-s">${props.slice(0, 3).map(proposalRow).join('')}</div></section>` : ''}
      ${heads.length ? `<section class="card"><div class="card-head"><h2>${ic('warn')} Busy days</h2><a class="btn sm ghost" href="#planner">Plan</a></div>${heads.map(h => `<div class="note-line"><div style="min-width:0"><b>${esc(h.text)}</b><div class="small muted">${esc(h.detail)}</div></div></div>`).join('')}</section>` : ''}
      ${newGrades || unread ? `<section class="card"><div class="card-head"><h2>${ic('bell')} Since your last visit</h2></div>
        ${newGrades ? `<div class="note-line"><a href="#grades">${newGrades} new grade${newGrades === 1 ? '' : 's'}</a></div>` : ''}${unread ? `<div class="note-line"><a href="#inbox">${unread} unread announcement${unread === 1 ? '' : 's'}</a></div>` : ''}</section>` : ''}
    </div>
  </div>`;
}

/* ---------- Assignments ---------- */
function vAssignments(){
  const now = new Date(), all = tasks();
  const open = all.filter(i => i.status !== 'done'), done = all.filter(i => i.status === 'done').sort(sortByDue).reverse().slice(0, 40);
  let groups = [];
  if (S.group === 'date') {
    const b = {late:[], today:[], tom:[], week:[], next:[], later:[], none:[]};
    for (const it of open) {
      const d = dueOf(it);
      if (!d) b.none.push(it);
      else if (d < now || it.missing) b.late.push(it);
      else { const n = dayDiff(d); if (n === 0) b.today.push(it); else if (n === 1) b.tom.push(it); else if (n < 7) b.week.push(it); else if (n < 14) b.next.push(it); else b.later.push(it); }
    }
    groups = [['Overdue & missing', b.late], ['Today', b.today], ['Tomorrow', b.tom], ['This week', b.week], ['Next week', b.next], ['Later', b.later], ['No due date', b.none]];
  } else if (S.group === 'course') {
    const m = {}; for (const it of open) (m[it.course || '_'] ||= []).push(it);
    groups = Object.entries(m).map(([k, v]) => [k === '_' ? 'No class' : courseName(k) || 'Other', v]).sort((a, b) => a[0].localeCompare(b[0]));
  } else {
    const m = {}; for (const it of open) (m[it.src] ||= []).push(it);
    groups = SRC_ORDER.filter(k => m[k]).map(k => [srcName(k), m[k]]);
  }
  groups = groups.filter(g => g[1].length).map(([t, a]) => [t, a.sort(sortByDue)]);
  if (S.showDone && done.length) groups.push(['Done recently', done]);
  const seg = `<div class="seg" role="group" aria-label="Group by">${[['date','By date'],['course','By class'],['src','By platform']].map(([k, l]) => `<button aria-pressed="${S.group === k}" data-act="set" data-k="group" data-v="${k}">${l}</button>`).join('')}</div>
    <label class="toggle small"><input type="checkbox" id="show-done" data-chg="show-done" ${S.showDone ? 'checked' : ''}> Show done</label>`;
  return `${pageHead('Assignments', `${open.length} open${open.filter(i => i.missing).length ? ` · <b>${open.filter(i => i.missing).length} missing</b>` : ''}`, `<button class="btn" data-act="import">${ic('upload')} Import</button><button class="btn primary" data-act="add-item">${ic('plus')} Add</button>`)}
  ${sampleBanner()}${filterBar(seg)}
  <div class="list">${groups.length ? groups.map(([t, a]) => `<div class="group-h">${esc(t)} <span class="num">${a.length}</span></div>${a.map(i => itemRow(i)).join('')}`).join('') : `<section class="card">${empty(activeFilters() || S.q ? 'Nothing matches these filters.' : 'No assignments yet. Turn on syncing in Settings → Accounts & sync, or import from a platform.', `<button class="btn sm" data-act="settings" data-tab="accounts">${ic('plug')} Accounts &amp; sync</button>`)}</section>`}</div>`;
}

/* ---------- Calendar ---------- */
function calItems(){ return visible().filter(i => isDated(i) && i.type !== 'announcement' && i.type !== 'absence'); }
function itemsOn(list, key){ return list.filter(i => dayKey(dueOf(i)) === key).sort((a, b) => (a.allDay ? -1 : 0) - (b.allDay ? -1 : 0) || sortByDue(a, b)); }
function vCalendar(){
  const cur = S.calCursor, list = calItems(), heavy = heavyDays(), todayK = dayKey(new Date()), ws = P().weekStart;
  let title = `${MOL[cur.getMonth()]} ${cur.getFullYear()}`, body = '';
  const evPill = it => `<span class="ev ${it.status === 'done' ? 'done' : ''} ${it.proposed ? 'proposed' : ''}" style="--c:${itemColor(it)}" title="${esc(it.title)}">${!it.allDay && it.type !== 'assignment' ? esc(fmtTime(dueOf(it)).replace(':00', '')) + ' ' : ''}${esc(it.title)}</span>`;
  if (S.calMode === 'month') {
    const first = new Date(cur.getFullYear(), cur.getMonth(), 1);
    const lead = (first.getDay() - ws + 7) % 7, start = addDays(first, -lead);
    const weeks = Math.ceil((lead + new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate()) / 7);
    let cells = '';
    for (let i = 0; i < weeks * 7; i++) {
      const d = addDays(start, i), k = dayKey(d), arr = itemsOn(list, k);
      cells += `<button class="day ${d.getMonth() !== cur.getMonth() ? 'other' : ''} ${k === todayK ? 'today' : ''} ${S.calSel === k ? 'sel' : ''} ${heavy.has(k) ? 'heavy' : ''}" data-act="cal-day" data-day="${k}" aria-label="${esc(fmtDay(d, true))}, ${arr.length} items">
        <span class="dn"><b>${d.getDate()}</b>${heavy.has(k) ? '<span class="heavy-flag">busy</span>' : ''}</span>
        ${arr.slice(0, 3).map(evPill).join('')}${arr.length > 3 ? `<span class="more">+${arr.length - 3}</span>` : ''}</button>`;
    }
    body = `<div class="month">${[...Array(7)].map((_, i) => `<div class="dow">${WD[(i + ws) % 7]}</div>`).join('')}${cells}</div>`;
  } else if (S.calMode === 'week') {
    const start = addDays(startOfDay(cur), -((cur.getDay() - ws + 7) % 7)), end = addDays(start, 6);
    title = `${MO[start.getMonth()]} ${start.getDate()} – ${start.getMonth() !== end.getMonth() ? MO[end.getMonth()] + ' ' : ''}${end.getDate()}`;
    body = `<div class="week">${[...Array(7)].map((_, i) => { const d = addDays(start, i), k = dayKey(d), arr = itemsOn(list, k); return `<div class="wcol ${k === todayK ? 'today' : ''}">
      <div class="between"><span class="wd">${WD[d.getDay()]}<b>${d.getDate()}</b></span>${heavy.has(k) ? '<span class="heavy-flag">busy</span>' : ''}</div>
      ${arr.map(it => `<button class="wev" style="--c:${itemColor(it)}" data-act="edit-item" data-id="${it.id}"><b>${esc(it.title)}</b><span>${it.allDay ? 'All day' : esc(fmtTime(dueOf(it)))} · ${esc(courseName(it.course) || srcName(it.src, true))}${it.proposed ? ' · suggested' : ''}</span></button>`).join('') || '<span class="small muted">Free</span>'}
      <button class="btn sm ghost" data-act="add-item" data-day="${k}">${ic('plus')}</button></div>`; }).join('')}</div>`;
  } else {
    const start = startOfDay(new Date()), days = [];
    for (let i = 0; i < 45; i++) { const d = addDays(start, i), arr = itemsOn(list, dayKey(d)); if (arr.length) days.push([d, arr]); }
    title = 'Next 45 days';
    body = days.length ? `<div class="list">${days.map(([d, arr]) => `<div class="group-h">${esc(relDay(d))} <span>${esc(fmtDate(d))}</span>${heavy.has(dayKey(d)) ? ' <span class="heavy-flag">busy</span>' : ''}</div>${arr.map(i => i.proposed ? proposalRow(i) : itemRow(i)).join('')}`).join('')}</div>` : `<section class="card">${empty('Nothing on the calendar.')}</section>`;
  }
  let side = '';
  if (S.calSel && S.calMode === 'month') {
    const d = parseDate(S.calSel + 'T12:00'), arr = itemsOn(list, S.calSel);
    side = `<aside class="card"><div class="card-head"><h2>${esc(fmtDay(d, true))}</h2><button class="icon-btn" data-act="cal-close" aria-label="Close day">${ic('x')}</button></div>
      <div class="list">${arr.length ? arr.map(i => i.proposed ? proposalRow(i) : itemRow(i)).join('') : '<p class="small muted">Nothing on this day.</p>'}</div>
      <div class="hstack" style="margin-top:12px"><button class="btn sm" data-act="add-item" data-day="${S.calSel}">${ic('plus')} Add</button><button class="btn sm ghost" data-act="cd-new" data-day="${S.calSel}">${ic('timer')} Count down</button></div></aside>`;
  }
  const nav = `<button class="icon-btn" data-act="cal-move" data-d="-1" aria-label="Previous">${ic('left')}</button><h2 class="cal-title">${esc(title)}</h2><button class="icon-btn" data-act="cal-move" data-d="1" aria-label="Next">${ic('right')}</button><button class="btn sm" data-act="cal-today">Today</button>`;
  const seg = `<div class="seg" role="group" aria-label="Calendar view">${[['month','Month'],['week','Week'],['agenda','List']].map(([k, l]) => `<button aria-pressed="${S.calMode === k}" data-act="set" data-k="calMode" data-v="${k}">${l}</button>`).join('')}</div>`;
  return `${pageHead('Calendar', '', `<button class="btn primary" data-act="add-item">${ic('plus')} Add</button>`)}
  <div class="toolbar">${nav}<span class="grow"></span>${seg}</div>${filterBar()}
  <div class="${side ? 'cal-layout' : ''}"><div>${body}</div>${side}</div>
  <p class="small muted">Dashed entries are suggestions waiting for your OK. “Busy” days have 2+ tests, quizzes or projects, or 4+ things due.</p>`;
}

/* ---------- Inbox: announcements + email ---------- */
function vInbox(){
  const anns = visible(D.items, {types:true, status:true}).filter(i => i.type === 'announcement' && (S.annCourse === 'all' || (i.course || '_') === S.annCourse))
    .sort((a, b) => (parseDate(b.posted) || 0) - (parseDate(a.posted) || 0));
  const props = proposals();
  const courseIds = [...new Set(D.items.filter(i => i.type === 'announcement').map(i => i.course || '_'))];
  const unread = anns.filter(a => !a.read).length;
  const sel = courseIds.length > 1 ? `<select id="ann-course" data-chg="ann-course" aria-label="Class">${[['all','All classes'], ...courseIds.map(k => [k, k === '_' ? 'No class' : courseName(k) || 'Other'])].map(([k, l]) => `<option value="${esc(k)}" ${S.annCourse === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>` : '';
  return `${pageHead('Inbox', unread ? `<b>${unread} unread</b> announcement${unread === 1 ? '' : 's'}` : 'All caught up', `${unread ? '<button class="btn" data-act="ann-read-all">Mark all read</button>' : ''}<button class="btn" data-act="add-item" data-type="announcement">${ic('plus')} Paste one</button>`)}
  ${subTabs()}
  ${props.length ? `<section class="card"><div class="card-head"><h2>${ic('spark')} Dates waiting for your OK</h2><button class="btn sm" data-act="approve-all">${ic('check')} Add all ${props.length}</button></div>
    <div class="stack-s">${props.sort(sortByDue).map(proposalRow).join('')}</div></section>` : ''}
  <div class="toolbar">${sel}<span class="grow"></span>${BK.aiReady() && anns.some(a => !a.scanned) ? `<button class="btn sm soft" data-act="ann-scan-all">${ic('spark')} Find dates in new posts</button>` : ''}</div>
  <div class="stack">${anns.length ? anns.map(a => {
    const open = S.drafts['ann-open-' + a.id], long = (a.body || '').length >= 300;
    return `<article class="ann" style="--c:${itemColor(a)}">
      <div class="between"><div class="hstack"><b>${esc(courseName(a.course) || 'General')}</b>${a.teacher ? `<span class="muted small">${esc(a.teacher)}</span>` : ''}${!a.read ? '<span class="pill info">New</span>' : ''}</div>
        <span class="small muted">${a.posted ? esc(relDay(parseDate(a.posted)) + ', ' + fmtTime(parseDate(a.posted))) : ''}</span></div>
      <h3>${esc(a.title)}</h3>
      ${a.body ? `<div class="ann-body ${open || !long ? '' : 'clamp'}">${esc(a.body)}</div>` : ''}
      <div class="hstack">
        ${long ? `<button class="btn sm ghost" data-act="ann-more" data-id="${a.id}">${open ? 'Show less' : 'Show more'}</button>` : ''}
        ${linkFor(a) ? `<a class="btn sm ghost" href="${esc(linkFor(a))}" target="_blank" rel="noopener">${ic('ext')} Open</a>` : ''}
        <button class="btn sm ghost" data-act="ann-read" data-id="${a.id}">${a.read ? 'Mark unread' : 'Mark read'}</button>
        ${BK.aiReady() ? `<button class="btn sm ghost" data-act="ann-scan" data-id="${a.id}" ${a._scanning ? 'disabled' : ''}>${ic('spark')} ${a._scanning ? 'Reading…' : 'Find dates'}</button>` : ''}
      </div></article>`;
  }).join('') : `<section class="card">${empty('No announcements yet. Teacher posts from Google Classroom show up here once syncing is on.', `<button class="btn sm" data-act="settings" data-tab="accounts">${ic('plug')} Accounts &amp; sync</button>`)}</section>`}</div>`;
}
function vEmail(){
  const g = P().gmail, ib = BK.inbox();
  const threads = ib.on ? ib.threads : (S.mode === 'demo' || hasSample() ? S.sampleInbox : []);
  const kw = g.keywords.split(',').map(s => s.trim()).filter(Boolean);
  const hl = s => { let t = esc(s); for (const k of kw) t = t.replace(new RegExp(`\\b(${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'gi'), '<mark>$1</mark>'); return t; };
  const label = {important:'Important email', school:'From school platforms', teachers:'From your school', all:'Inbox', custom:'Custom search'}[g.inbox] || 'Email';
  return `${pageHead('Inbox', `${esc(label)} · last ${esc(g.days)} days`, `<button class="btn" data-act="settings" data-tab="notify">${ic('sliders')} Email settings</button>`)}
  ${subTabs()}
  ${ib.banner || ''}
  <div class="list">${threads.length ? threads.slice(0, 40).map(t => `<div class="it" style="--c:${t.unread ? 'var(--info)' : 'var(--line)'}">
    <div class="it-main" style="cursor:default"><span class="it-title">${t.unread ? '<span class="newdot"></span>' : ''}${hl(t.subject)}</span><span class="it-meta"><b>${esc(t.from || '')}</b> <span>${hl(t.snippet)}</span></span></div>
    <span class="due"><small>${t.date ? esc(relDay(new Date(t.date))) : ''}</small></span>
    ${!t.sample ? `<a class="icon-btn" href="${esc(t.link || 'https://mail.google.com/mail/u/0/#all/' + encodeURIComponent(t.id))}" target="_blank" rel="noopener" title="Open in Gmail" aria-label="Open in Gmail">${ic('ext')}</a>` : ''}
    <button class="icon-btn" data-act="mail-todo" data-id="${esc(t.id)}" title="Make a to-do" aria-label="Make a to-do from this email">${ic('plus')}</button></div>`).join('')
    : `<section class="card">${empty(ib.on ? (ib.loading ? 'Loading your mail…' : 'No emails match right now.') : 'Connect Gmail to see important mail here.', ib.on ? '' : `<button class="btn sm" data-act="settings" data-tab="accounts">${ic('plug')} Accounts &amp; sync</button>`)}</section>`}</div>`;
}

/* ---------- Grades: classes, what-if, attendance ---------- */
function vGrades(){
  const cs = D.state.courses;
  const head = pageHead('Grades', `${cs.length} class${cs.length === 1 ? '' : 'es'}`, `<button class="btn" data-act="import" data-src="genesis">${ic('upload')} Import</button><button class="btn" data-act="course-new">${ic('plus')} Class</button>`);
  if (!cs.length) return `${head}${subTabs()}<section class="card">${empty('No classes yet. Connect Genesis or Google Classroom in Settings, or import your gradebook.', `<button class="btn primary" data-act="settings" data-tab="accounts">${ic('plug')} Accounts &amp; sync</button>`)}</section>`;
  const fc = D.state.filters.courses, shown = cs.filter(c => !fc.length || fc.includes(c.id));
  const sel = S.gradeCourse && course(S.gradeCourse) ? S.gradeCourse : null;
  const cards = shown.map(c => {
    const s = courseSummary(c.id), hist = courseHistory(c.id);
    return `<button class="course" style="--c:${esc(c.color || '#888')}" data-act="grade-course" data-id="${c.id}" aria-pressed="${sel === c.id}">
      <div class="between"><b>${esc(c.name)}</b><span class="letter">${letterFor(s.pct)}</span></div>
      <div class="between"><span class="pct">${s.pct != null ? s.pct.toFixed(1) + '%' : '–'}</span>${s.delta != null && Math.abs(s.delta) >= .05 ? `<span class="${s.delta > 0 ? 'delta-up' : 'delta-down'}">${s.delta > 0 ? '▲' : '▼'} ${Math.abs(s.delta).toFixed(1)} this week</span>` : ''}</div>
      ${spark(hist, c.color || '#888')}
      <div class="small muted">${esc(c.teacher || '')}${c.teacher ? ' · ' : ''}${s.n} grade${s.n === 1 ? '' : 's'}${s.reported ? ` · ${esc(srcName(s.reported.src || 'genesis', true))} says ${esc(s.reported.pct)}%` : ''}</div></button>`;
  }).join('');
  let detail = '';
  if (sel) {
    const c = course(sel), rows = gradeRows(sel).filter(r => !r.hypo).sort((a, b) => (b.date || '').localeCompare(a.date || '')), g = calcGrade(sel, rows);
    detail = `<section class="card"><div class="card-head"><h2><span class="dot" style="--c:${esc(c.color)}"></span> ${esc(c.name)}</h2>
      <div class="hstack"><a class="btn sm soft" href="#whatif" data-act="whatif-course" data-id="${c.id}">${ic('calc')} What-if</a><button class="btn sm" data-act="grade-add" data-id="${c.id}">${ic('plus')} Grade</button><button class="btn sm ghost" data-act="course-edit" data-id="${c.id}">${ic('edit')} Weights</button></div></div>
      ${g.cats?.length ? `<div class="row-3" style="margin-bottom:12px">${g.cats.map(k => `<div class="stack-s"><div class="between small"><b>${esc(k.name)} · ${esc(k.weight)}%</b><span class="num">${k.pct != null ? k.pct.toFixed(1) + '%' : '–'}</span></div><div class="bar" style="--c:${esc(c.color)}"><i style="width:${clamp(k.pct || 0, 0, 100)}%"></i></div></div>`).join('')}</div>` : ''}
      ${g.uncategorized ? `<div class="banner warn" style="margin-bottom:10px">${ic('warn')}<p class="grow small">${g.uncategorized} grade${g.uncategorized === 1 ? ' has' : 's have'} no category and ${g.uncategorized === 1 ? 'isn’t' : 'aren’t'} counted. Use the edit button to pick one.</p></div>` : ''}
      <div class="tbl-wrap"><table><thead><tr><th>Assignment</th><th>Category</th><th class="r">Score</th><th class="r">%</th><th>Date</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.title)}</td><td>${esc(c.cats.find(k => k.id === r.catId)?.name || r.cat || '–')}</td><td class="r num">${esc(r.score)}/${esc(r.max)}</td><td class="r num">${(r.score / r.max * 100).toFixed(1)}</td><td class="num">${r.date ? esc(fmtDate(parseDate(r.date + 'T12:00'))) : ''}</td><td><button class="icon-btn" data-act="grade-edit" data-id="${r.id}" aria-label="Edit ${esc(r.title)}">${ic('edit')}</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No grades yet.</td></tr>'}
      </tbody></table></div></section>`;
  }
  return `${head}${subTabs()}${sampleBanner()}<div class="course-grid">${cards}</div>${detail}
  <p class="small muted">Percentages are worked out from the grades Homeroom has, using each class’s category weights. Genesis is the official record.</p>`;
}
function vAttendance(){
  const abs = D.items.filter(i => i.type === 'absence' && !i.hidden).sort(sortByDue).reverse();
  return `${pageHead('Grades', 'Attendance from Genesis')}${subTabs()}
  <section class="card">${abs.length ? `<div class="list">${abs.map(a => itemRow(a, {noTick:true})).join('')}</div>` : empty('No absences recorded. Genesis attendance syncs here when Genesis is connected.')}</section>`;
}
function vWhatIf(){
  const cs = D.state.courses;
  if (!cs.length) return `${pageHead('Grades')}${subTabs()}<section class="card">${empty('Add a class or import grades first.', `<button class="btn" data-act="course-new">${ic('plus')} Add a class</button>`)}</section>`;
  const cid = S.whatCourse && course(S.whatCourse) ? S.whatCourse : cs[0].id; S.whatCourse = cid;
  const c = course(cid), wi = D.state.whatif[cid] || {ov:{}, extra:[]};
  const actual = calcGrade(cid, gradeRows(cid)), rows = gradeRows(cid, wi), proj = calcGrade(cid, rows);
  const diff = proj.pct != null && actual.pct != null ? proj.pct - actual.pct : null;
  const sv = S.drafts.solve || {target:(actual.pct ?? 90) >= 93 ? 97 : 93, cat:c.cats[0]?.id || '', max:100};
  const need = neededScore(cid, rows, +sv.target, sv.cat, +sv.max);
  const wsum = sum(c.cats || [], k => k.weight);
  const catSel = r => c.scheme === 'weighted' && c.cats.length ? `<select id="wi-cat-${r.id}" data-chg="wi-cat" data-id="${r.id}" aria-label="Category">${!r.catId ? '<option value="">Pick…</option>' : ''}${c.cats.map(k => `<option value="${k.id}" ${r.catId === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select>` : '<span class="muted">–</span>';
  let needText;
  if (need == null) needText = 'Pick a category with a weight above 0.';
  else if (need <= 0) needText = `You’re already there. Even 0/${esc(sv.max)} keeps you at ${esc(sv.target)}% or above.`;
  else if (need > +sv.max) needText = `You’d need ${need.toFixed(1)}/${esc(sv.max)} (${(need / sv.max * 100).toFixed(0)}%), more than it’s worth. Try a lower target or a bigger assignment.`;
  else needText = `You need at least <b>${need.toFixed(1)}/${esc(sv.max)}</b> (${(need / sv.max * 100).toFixed(1)}%) to reach ${esc(sv.target)}%.`;
  return `${pageHead('Grades', 'What-If: try scores and see your grade change. Your real grades aren’t touched.')}${subTabs()}
  <div class="toolbar"><label class="label" for="wi-course">Class</label><select id="wi-course" data-chg="wi-course">${cs.map(k => `<option value="${k.id}" ${k.id === cid ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select>
    <span class="small muted">${c.scheme === 'weighted' && c.cats.length ? 'Weighted categories' : 'Total points'}</span><span class="grow"></span>
    <button class="btn sm" data-act="course-edit" data-id="${cid}">${ic('edit')} Weights</button><button class="btn sm ghost" data-act="wi-reset" ${Object.keys(wi.ov || {}).length || (wi.extra || []).length ? '' : 'disabled'}>Reset</button></div>
  <section class="card"><div class="result">
    <div><div class="label">Now</div><div class="big">${actual.pct != null ? actual.pct.toFixed(2) + '%' : '–'}</div><span class="letter">${letterFor(actual.pct)}</span></div>
    <div class="${diff == null || Math.abs(diff) < .005 ? 'muted' : diff > 0 ? 'delta-up' : 'delta-down'}" style="font-size:1.05rem">${diff == null || Math.abs(diff) < .005 ? '→' : (diff > 0 ? '▲ +' : '▼ ') + diff.toFixed(2)}</div>
    <div><div class="label">With your changes</div><div class="big" style="color:var(--accent-text)">${proj.pct != null ? proj.pct.toFixed(2) + '%' : '–'}</div><span class="letter">${letterFor(proj.pct)}</span></div>
  </div>
  ${proj.cats?.length ? `<div class="row-3" style="margin-top:16px">${proj.cats.map(k => `<div class="stack-s"><div class="between small"><b>${esc(k.name)} · ${esc(k.weight)}%</b><span class="num">${k.pct != null ? k.pct.toFixed(1) + '%' : 'no grades'}</span></div><div class="bar" style="--c:${esc(c.color)}"><i style="width:${clamp(k.pct || 0, 0, 100)}%"></i></div></div>`).join('')}</div>` : ''}
  ${c.scheme === 'weighted' && c.cats.length && Math.abs(wsum - 100) > .01 ? `<p class="small muted" style="margin-top:10px">Weights add up to ${wsum}%. Homeroom scales them, so the result still works.</p>` : ''}
  </section>
  <section class="card"><div class="card-head"><h2>${ic('calc')} What do I need?</h2></div>
    <form class="hstack" data-form="solve" style="align-items:flex-end">
      <div class="field"><label for="sv-target">Target grade (%)</label><input id="sv-target" name="target" type="number" step="0.1" min="0" max="120" value="${esc(sv.target)}" style="width:7rem"></div>
      ${c.scheme === 'weighted' && c.cats.length ? `<div class="field"><label for="sv-cat">Next assignment counts as</label><select id="sv-cat" name="cat">${c.cats.map(k => `<option value="${k.id}" ${sv.cat === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select></div>` : ''}
      <div class="field"><label for="sv-max">Worth (points)</label><input id="sv-max" name="max" type="number" min="1" step="1" value="${esc(sv.max)}" style="width:7rem"></div>
      <button class="btn primary" type="submit">Work it out</button></form>
    <p style="margin-top:12px" id="solve-out">${needText}</p></section>
  <section class="card"><div class="card-head"><h2>Grades in ${esc(c.name)}</h2><button class="btn sm primary" data-act="wi-add">${ic('plus')} Pretend assignment</button></div>
    <div class="tbl-wrap"><table><thead><tr><th>Count</th><th>Assignment</th><th>Category</th><th class="r">Score</th><th class="r">Out of</th><th class="r">%</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr class="${r.hypo ? 'hypo' : r.changed ? 'changed' : ''} ${r.include ? '' : 'off'}">
      <td><input type="checkbox" id="wi-inc-${r.id}" data-chg="wi-inc" data-id="${r.id}" ${r.include ? 'checked' : ''} aria-label="Count ${esc(r.title)}"></td>
      <td>${r.hypo ? `<input class="wide" id="wi-title-${r.id}" data-chg="wi-title" data-id="${r.id}" value="${esc(r.title)}" aria-label="Pretend assignment name">` : esc(r.title)}${r.hypo ? ' <span class="tag">pretend</span>' : r.changed ? ' <span class="tag">changed</span>' : ''}</td>
      <td>${catSel(r)}</td>
      <td class="r"><input type="number" step="any" id="wi-s-${r.id}" data-chg="wi-score" data-id="${r.id}" value="${esc(r.score)}" aria-label="Score"></td>
      <td class="r"><input type="number" step="any" min="0" id="wi-m-${r.id}" data-chg="wi-max" data-id="${r.id}" value="${esc(r.max)}" aria-label="Out of"></td>
      <td class="r num">${+r.max > 0 && r.score !== '' ? (r.score / r.max * 100).toFixed(1) : '–'}</td>
      <td>${r.hypo ? `<button class="icon-btn" data-act="wi-del" data-id="${r.id}" aria-label="Remove">${ic('trash')}</button>` : r.changed ? `<button class="icon-btn" data-act="wi-undo" data-id="${r.id}" aria-label="Undo change" title="Undo">${ic('refresh')}</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No grades yet. Add a pretend assignment to start.</td></tr>'}
    </tbody></table></div></section>
  <details class="card"><summary><b>Letter grade scale</b> <span class="small muted">match it to your school</span></summary>
    <div class="hstack" style="margin-top:12px">${(P().scale2 || SCALE_DEFAULT).map(([m, l], i) => `<label class="field" style="width:5.2rem"><span class="label">${esc(l)} ≥</span><input type="number" step="0.5" id="scale-${i}" data-chg="scale" data-i="${i}" value="${m}"></label>`).join('')}
    <button class="btn sm ghost" data-act="scale-reset">Reset</button></div></details>`;
}

/* ---------- Planner: AI + countdowns ---------- */
function vPlanner(){
  const crunch = analyze(new Date(), 21), props = proposals(), ready = BK.aiReady();
  const tests = D.items.filter(i => MAJOR.has(i.type) && i.status !== 'done' && dueOf(i) > Date.now() && !i.proposed).sort(sortByDue).slice(0, 12);
  const quick = ['What’s coming up this week?','Do any due dates overlap?','What should I do tonight?','Make a study plan for my next test'];
  return `${pageHead('Planner', ready ? 'Ask about your schedule. Anything it suggests waits for your OK.' : esc(BK.aiOffNote || 'The AI planner isn’t available here.'))}${subTabs()}
  <div class="grid-main">
    <section class="chat" aria-label="Planner chat">
      <div class="msgs" id="msgs" aria-live="polite">
        ${D.chat.length ? D.chat.map((m, i) => `<div class="msg ${m.role}" id="msg-${i}">${m.role === 'user' ? esc(m.content) : (md(m.content) || (m.pending ? '<span class="thinking">Thinking…</span>' : ''))}${m.error ? `<p class="small" style="color:var(--bad)">${esc(m.error)}</p>` : ''}</div>${(m.props || []).map(id => D.items.find(x => x.id === id && x.proposed)).filter(Boolean).map(proposalRow).join('')}`).join('')
          : `<div class="msg assistant"><p>Hi${D.state.profile.name ? ' ' + esc(D.state.profile.name.split(' ')[0]) : ''}! I can see your assignments, tests, events and grades. Ask what overlaps, what to do first tonight, or for a study plan.</p></div>`}
      </div>
      <div class="composer">
        ${ready ? `<div class="quick">${quick.map(q => `<button data-act="chat-quick" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>` : ''}
        <form data-form="chat"><label class="sr" for="chat-input">Message the planner</label><textarea id="chat-input" data-draft rows="1" placeholder="${ready ? 'Ask about your schedule…' : 'Not available here'}" ${ready ? '' : 'disabled'}>${esc(S.drafts['chat-input'] || '')}</textarea>
          ${S.chatBusy ? `<button class="btn" type="button" data-act="chat-stop">${ic('stop')} Stop</button>` : `<button class="btn primary" type="submit" ${ready ? '' : 'disabled'}>${ic('send')} Send</button>`}</form>
        ${D.chat.length ? '<button class="btn sm ghost" data-act="chat-clear" style="justify-self:start">Clear conversation</button>' : ''}
      </div>
    </section>
    <div class="stack">
      <details class="card" ${S.drafts.spOpen ? 'open' : ''}><summary><b>${ic('book')} Build a study plan</b></summary>
        <form class="stack-s" data-form="studyplan" style="margin-top:12px">
          <div class="field"><label for="sp-test">For</label><select id="sp-test" name="test">${tests.map(t => `<option value="${t.id}">${esc(t.title)} · ${esc(relDay(dueOf(t)))}</option>`).join('')}${allCountdowns().filter(c => c.kind === 'ap').map(c => `<option value="cd:${c.id}">${esc(c.title)} · ${esc(fmtDate(parseDate(c.date)))}</option>`).join('')}<option value="custom">Something else…</option></select></div>
          <div class="field"><label for="sp-topics">Topics (optional)</label><input id="sp-topics" name="topics" placeholder="mole ratios, limiting reactant…"></div>
          <div class="row-2"><div class="field"><label for="sp-n">Sessions</label><input id="sp-n" name="n" type="number" min="1" max="20" value="4"></div><div class="field"><label for="sp-min">Minutes each</label><input id="sp-min" name="mins" type="number" min="15" max="180" step="5" value="40"></div></div>
          <button class="btn primary" type="submit" ${ready ? '' : 'disabled'}>${ic('spark')} Draft my plan</button></form></details>
      <section class="card"><div class="card-head"><h2>${ic('warn')} Busy days ahead</h2></div>
        ${crunch.length ? crunch.slice(0, 5).map(h => `<div class="note-line"><div style="min-width:0"><b>${esc(h.text)}</b><div class="small muted">${esc(h.detail)}</div></div></div>`).join('') : '<p class="small muted">No overloaded days in the next 3 weeks.</p>'}</section>
      ${props.length ? `<section class="card"><div class="card-head"><h2>${ic('spark')} Waiting for your OK</h2><button class="btn sm" data-act="approve-all">Add all</button></div><div class="stack-s">${props.slice(0, 6).map(proposalRow).join('')}</div></section>` : ''}
    </div></div>`;
}
function vCountdowns(){
  const all = allCountdowns(), up = all.filter(c => parseDate(c.date) > Date.now()), past = all.filter(c => parseDate(c.date) <= Date.now());
  const card = c => { const p = cdParts(c.date), d = parseDate(c.date); return `<div class="cd" style="--c:${esc(c.color || 'var(--accent)')}">
    <div class="acts">${c.item ? `<button class="icon-btn" data-act="unpin" data-id="${c.id}" title="Stop counting down" aria-label="Stop counting down">${ic('x')}</button>` : `<button class="icon-btn" data-act="cd-edit" data-id="${c.id}" aria-label="Edit">${ic('edit')}</button>`}</div>
    <span class="small muted">${c.kind === 'ap' ? 'AP exam' : c.item ? esc(c.sub || 'Assignment') : 'Countdown'}</span>
    <h3 style="padding-right:2.6rem">${esc(c.title)}</h3>
    <div class="cd-n"><span data-cd="${esc(c.date)}" data-cd-mode="d">${p.d}</span><small>${p.d === 1 ? 'day' : 'days'}</small></div>
    <div class="cd-t" data-cd="${esc(c.date)}" data-cd-mode="hms">${hms(p)}</div>
    <div class="small muted">${esc(fmtDay(d, true))}${d.getFullYear() !== new Date().getFullYear() ? ', ' + d.getFullYear() : ''} · ${esc(fmtTime(d))}</div></div>`; };
  const ap = up.filter(c => c.kind === 'ap'), other = up.filter(c => c.kind !== 'ap');
  return `${pageHead('Planner', 'Countdowns. Pin any assignment from its details to count down to it.', `<button class="btn" data-act="ap-pick">${ic('grad')} My AP exams</button><button class="btn primary" data-act="cd-new">${ic('plus')} New</button>`)}${subTabs()}
  ${other.length ? `<div class="cd-grid">${other.map(card).join('')}</div>` : ''}
  <h2>AP exams · May 2027</h2>
  ${ap.length ? `<div class="cd-grid">${ap.map(card).join('')}</div>` : `<section class="card">${empty('Pick the AP exams you’re taking and Homeroom counts down to each one.', `<button class="btn" data-act="ap-pick">${ic('grad')} Choose AP exams</button>`)}</section>`}
  <p class="small muted">AP dates are College Board’s 2027 schedule. Morning exams start at 8 AM and afternoon exams at 12 PM local time; your AP coordinator confirms the room.</p>
  ${past.length ? `<details><summary class="small muted">Past (${past.length})</summary><div class="cd-grid" style="margin-top:10px">${past.map(card).join('')}</div></details>` : ''}`;
}
const VIEW_FN = {today:vToday, assignments:vAssignments, calendar:vCalendar, inbox:vInbox, email:vEmail, grades:vGrades, whatif:vWhatIf, attendance:vAttendance, planner:vPlanner, countdowns:vCountdowns};

/* ---------- filter drawer ---------- */
function drawerHTML(){
  const f = D.state.filters;
  const base = D.items.filter(i => !i.hidden && !i.proposed && i.status !== 'done');
  const cnt = (g, v) => base.filter(i => passFilters(i, {[g]:true}) && (g === 'src' ? i.src === v : g === 'types' ? i.type === v : g === 'courses' ? (i.course || '_none') === v : statusKeys(i).includes(v))).length;
  const doneCnt = D.items.filter(i => i.status === 'done' && !i.hidden && passFilters(i, {status:true})).length;
  const group = (g, title, opts, open) => `<details class="fgroup" ${open || f[g].length ? 'open' : ''}><summary><span>${title}${f[g].length ? ' ·' : ''}</span><span class="acts"><button data-act="f-all" data-g="${g}">All</button><button data-act="f-none" data-g="${g}">None</button></span></summary>
    ${opts.map(([v, label, color]) => { const on = !f[g].length || f[g].includes(v); const n = v === 'done' && g === 'status' ? doneCnt : cnt(g, v); return `<label class="fopt" for="f-${g}-${esc(v)}"><input type="checkbox" id="f-${g}-${esc(v)}" data-chg="filter" data-g="${g}" data-v="${esc(v)}" ${on ? 'checked' : ''}>${color ? `<span class="sw" style="--c:${color}"></span>` : ''}<span class="t">${esc(label)}</span><span class="n">${n || ''}</span></label>`; }).join('')}</details>`;
  return `<div class="between"><h2>Filters</h2><button class="icon-btn" data-act="drawer-close" aria-label="Close filters">${ic('x')}</button></div>
  <p class="small muted">Untick anything you don’t want to see. This applies to every tab.</p>
  ${group('src', 'Platforms', SRC_ORDER.map(k => [k, srcName(k), srcColor(k)]), true)}
  ${group('types', 'Kinds', TYPE_ORDER.map(k => [k, TYPES[k].plural]))}
  ${group('status', 'Status', Object.entries(STATUS))}
  ${D.state.courses.length ? group('courses', 'Classes', D.state.courses.map(c => [c.id, c.name, c.color]).concat([['_none','No class']])) : ''}
  <div class="fgroup"><span class="label">Saved views</span>
    ${D.state.views.map((v, i) => `<div class="fopt"><button class="btn sm ghost" style="flex:1;justify-content:flex-start" data-act="view-load" data-i="${i}">${esc(v.name)}</button><button class="icon-btn" data-act="view-del" data-i="${i}" aria-label="Delete saved view ${esc(v.name)}">${ic('x')}</button></div>`).join('') || '<p class="small muted">Save a filter combo to switch back to it in one click.</p>'}
    <form class="hstack" data-form="save-view" style="flex-wrap:nowrap;margin-top:6px"><input id="sv-name" name="name" data-draft placeholder="Name this view" value="${esc(S.drafts['sv-name'] || '')}" style="flex:1;width:100%"><button class="btn sm" type="submit" ${activeFilters() ? '' : 'disabled'}>Save</button></form></div>
  ${activeFilters() ? `<button class="btn" data-act="clear-filters">${ic('x')} Clear all filters</button>` : ''}`;
}

/* ---------- settings panel ---------- */
function setTabs(){ return BK.setTabs ? BK.setTabs() : SET_TABS; }
function settingsHTML(){
  const tab = S.setTab;
  const panes = Object.assign({profile:setProfile, look:setLook, accounts:() => BK.accountsPane(), notify:setNotify, classes:setClasses, privacy:setPrivacy, data:setData}, BK.panes || {});
  return `<div class="scrim" data-act="scrim"><div class="modal settings" role="dialog" aria-modal="true" aria-labelledby="set-title">
    <nav aria-label="Settings sections"><h2 id="set-title">Settings</h2>${setTabs().map(([k, l, i]) => `<button data-act="set-tab" data-v="${k}" aria-current="${tab === k}">${ic(i)} ${l}</button>`).join('')}</nav>
    <div class="pane" id="set-pane"><button class="icon-btn close" data-act="close-modal" aria-label="Close settings">${ic('x')}</button>${panes[tab]()}</div></div></div>`;
}
const segP = (k, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button aria-pressed="${String(P()[k]) === String(v)}" data-act="pref" data-k="${k}" data-v="${v}">${l}</button>`).join('')}</div>`;
function setProfile(){
  const pr = D.state.profile;
  return `<h2>Profile</h2><div class="set-sec">
    <div class="field"><label for="pf-name">Name</label><input id="pf-name" data-chg="profile" data-k="name" value="${esc(pr.name)}"></div>
    <div class="row-2"><div class="field"><label for="pf-grade">Grade</label><select id="pf-grade" data-chg="profile" data-k="grade">${['','9','10','11','12'].map(g => `<option value="${g}" ${pr.grade === g ? 'selected' : ''}>${g ? g + 'th grade' : '–'}</option>`).join('')}</select></div>
      <div class="field"><label for="pf-school">School</label><input id="pf-school" data-chg="profile" data-k="school" value="${esc(pr.school)}"></div></div>
    <div class="field"><span class="label">AP exams</span><div class="hstack"><span class="small">${D.state.apExams.length ? esc(D.state.apExams.join(', ')) : 'None chosen'}</span><button class="btn sm" data-act="ap-pick">Choose</button></div></div></div>
    ${BK.who ? `<p class="small muted">${BK.who()}</p>` : ''}`;
}
function setLook(){
  const p = P();
  return `<h2>Appearance</h2>
  <div class="set-sec"><div class="field"><span class="label">Color scheme</span><div class="swatches">${Object.entries(PALETTES).map(([k, v]) => `<button class="swatch" aria-pressed="${p.palette === k && !p.accent}" data-act="pref" data-k="palette" data-v="${k}"><i><span style="background:${v.b}"></span><span style="background:${v.a}"></span></i>${v.name}</button>`).join('')}</div></div>
    <div class="field"><span class="label">Light or dark</span>${segP('mode', [['system','Match device'],['light','Light'],['dark','Dark']])}</div>
    <div class="field"><label for="accent">Your own accent color</label><div class="hstack"><input type="color" id="accent" data-chg="accent" value="${esc(p.accent || PALETTES[p.palette].a)}"><button class="btn sm ghost" data-act="accent-reset" ${p.accent ? '' : 'disabled'}>Use the scheme’s color</button></div></div></div>
  <div class="set-sec"><div class="field"><span class="label">Text size</span>${segP('scale', [[0.92,'Small'],[1,'Medium'],[1.12,'Large'],[1.25,'Extra large']])}</div>
    <div class="field"><span class="label">Spacing</span>${segP('density', [['comfy','Roomy'],['compact','Compact']])}</div>
    <label class="toggle"><input type="checkbox" id="o-motion" data-chg="pref-bool" data-k="reduceMotion" ${p.reduceMotion ? 'checked' : ''}> Reduce motion</label></div>
  <div class="set-sec"><div class="field"><span class="label">Calendar colors</span>${segP('colorBy', [['src','By platform'],['course','By class']])}</div>
    <div class="field"><span class="label">Week starts on</span>${segP('weekStart', [[0,'Sunday'],[1,'Monday']])}</div>
    <label class="toggle"><input type="checkbox" id="o-secs" data-chg="pref-bool" data-k="seconds" ${p.seconds ? 'checked' : ''}> Show seconds on countdowns</label></div>
  <details class="set-sec"><summary><b>Platform colors</b></summary><div class="stack-s" style="margin-top:10px">${SRC_ORDER.map(k => `<div class="between"><span class="hstack"><span class="dot" style="--c:${srcColor(k)}"></span>${esc(srcName(k))}</span><span class="hstack"><input type="color" id="sc-${k}" data-chg="src-color" data-k="${k}" value="${srcColor(k)}" aria-label="${esc(srcName(k))} color">${p.srcColors[k] ? `<button class="btn sm ghost" data-act="src-color-reset" data-k="${k}">Reset</button>` : ''}</span></div>`).join('')}</div></details>`;
}
function setNotify(){
  const p = P(), g = p.gmail;
  return `<h2>Notifications</h2>
  ${BK.notifyPane ? BK.notifyPane() : ''}
  <div class="set-sec"><h3>Inside Homeroom</h3>
    <div class="field"><label for="o-remind">Flag things as “due soon”</label><select id="o-remind" data-chg="pref-num" data-k="remindHours">${[2,6,12,24,48,72].map(h => `<option value="${h}" ${+p.remindHours === h ? 'selected' : ''}>${h < 24 ? h + ' hours' : h / 24 + (h === 24 ? ' day' : ' days')} before</option>`).join('')}</select></div>
    ${[['overdue','Overdue work'],['grades','New grades'],['ann','New announcements']].concat(BK.hasEmail === false ? [] : [['email','Unread important email']]).map(([k, l]) => `<label class="toggle"><input type="checkbox" id="al-${k}" data-chg="alert" data-k="${k}" ${p.alerts[k] ? 'checked' : ''}> ${l} in the bell menu</label>`).join('')}</div>
  ${BK.hasEmail === false ? '' : `<div class="set-sec"><h3>Email</h3>
    <div class="field"><label for="gm-inbox">The Email tab shows</label><select id="gm-inbox" data-chg="gm" data-k="inbox">
      ${[['important','Emails Gmail marks important'],['school','School platforms (Classroom, DeltaMath, …)'],['teachers','Anything from my school’s email domain'],['all','Everything in my inbox'],['custom','A custom Gmail search']].map(([k, l]) => `<option value="${k}" ${g.inbox === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    ${g.inbox === 'custom' ? `<div class="field"><label for="gm-custom">Gmail search</label><input id="gm-custom" data-chg="gm" data-k="custom" value="${esc(g.custom)}" placeholder="from:teacher@school.org is:unread"></div>` : ''}
    <div class="row-2"><div class="field"><label for="gm-days">Look back (days)</label><input id="gm-days" type="number" min="1" max="60" data-chg="gm" data-k="days" value="${esc(g.days)}"></div>
      <div class="field"><label for="gm-dom">School email domain</label><input id="gm-dom" data-chg="gm" data-k="schoolDomain" value="${esc(g.schoolDomain)}" placeholder="yourschool.org"></div></div>
    <div class="field"><label for="gm-kw">Highlight these words</label><input id="gm-kw" data-chg="gm" data-k="keywords" value="${esc(g.keywords)}"></div></div>`}`;
}
function setClasses(){
  return `<div class="between"><h2>Classes</h2><button class="btn sm" data-act="course-new">${ic('plus')} Add class</button></div>
  ${D.state.courses.length ? `<div class="stack-s">${D.state.courses.map(c => `<div class="between" style="padding:6px 0;border-top:1px solid var(--line)"><span class="hstack"><span class="dot" style="--c:${esc(c.color)}"></span><b>${esc(c.name)}</b><span class="small muted">${esc(c.teacher || '')}</span></span><span class="hstack"><span class="small muted">${c.scheme === 'weighted' && c.cats.length ? c.cats.map(k => esc(k.name) + ' ' + esc(k.weight) + '%').join(' · ') : 'Total points'}</span><button class="icon-btn" data-act="course-edit" data-id="${c.id}" aria-label="Edit ${esc(c.name)}">${ic('edit')}</button></span></div>`).join('')}</div>` : '<p class="small muted">No classes yet. Syncing and imports add them for you.</p>'}
  <p class="small muted">Set each class’s category weights (from your syllabus or Genesis) so grades and What-If match your report card.</p>`;
}
function setPrivacy(){
  const p = P();
  return `<h2>Privacy</h2><div class="set-sec">
    <div class="privacy">${ic('lock')}<p>${BK.privacyNote ? BK.privacyNote() : ''}</p></div></div>
    ${S.mode !== 'demo' ? `<div class="set-sec"><div class="field"><span class="label">Quick lock for shared computers</span><div class="hstack">${p.pinHash ? `<button class="btn sm" data-act="pin-set">Change PIN</button><button class="btn sm ghost" data-act="pin-off">Remove PIN</button><button class="btn sm ghost" data-act="lock-now">${ic('lock')} Lock now</button>` : `<button class="btn sm" data-act="pin-set">${ic('lock')} Set a PIN</button>`}</div>
      <p class="small muted">Asks for a 4–8 digit PIN each time Homeroom opens. It hides your info on screen; it doesn’t replace signing out on a shared computer.</p></div>
      ${BK.kind === 'claude' ? `<label class="toggle"><input type="checkbox" id="o-signin" data-chg="pref-bool" data-k="alwaysSignin" ${p.alwaysSignin ? 'checked' : ''}> Show the sign-in screen every time</label>` : ''}</div>` : ''}
    ${BK.privacyExtra ? BK.privacyExtra() : ''}`;
}
function setData(){
  return `<h2>Your data</h2><div class="set-sec">
    <p class="small muted">${D.items.length} items · ${D.grades.length} grades · ${D.state.courses.length} classes</p>
    <div class="hstack">${hasSample() ? '<button class="btn sm" data-act="remove-sample">Remove sample data</button>' : S.mode !== 'demo' ? '<button class="btn sm ghost" data-act="add-sample">Add sample data</button>' : ''}
      <button class="btn sm" data-act="export">${ic('clip')} Copy a backup</button><button class="btn sm" data-act="restore">Restore a backup</button></div>
    <div class="hstack"><button class="btn sm ghost" data-act="clear-done">Remove finished items older than a month</button>${S.mode !== 'demo' ? '<button class="btn sm ghost danger" data-act="erase">Erase everything</button>' : ''}</div></div>`;
}
