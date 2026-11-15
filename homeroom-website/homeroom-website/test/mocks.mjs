// Pretend school sites for testing (no real accounts touched).
//   Genesis, hosted like MCMS:  https://students.c2.genesis.test/mcmsnj/...   user "student" / "right"
//   Genesis, older parent style: https://parents.mcms.test/genesis/...         user "parent"  / "right"
//   VHL-like form login:         https://www.vhl.test/login                    user "nethra"  / "pw"
//   A calendar link:             https://cal.test/basic.ics
//   Claude API (key sk-good), and a push service at https://push.test/...
export const log = [];
export const pushes = [];
let aiCalls = 0;
export const counters = { get ai() { return aiCalls; } };

const MC = 'https://students.c2.genesis.test', GEN = 'https://parents.mcms.test/genesis';
const loginPage = '<html><body><form method="post" action="j_security_check"><input name="j_username"><input type="password" name="j_password"></form></body></html>';
const mcLogin = '<html><body><form name="loginForm" method="post" action="j_security_check"><input type="hidden" name="loginToken" value="tk42"><input type="text" name="j_username"><input type="password" name="j_password"></form></body></html>';
const homePage = '<html><body><a href="/genesis/parents?tab1=studentdata&tab2=studentsummary&action=form&studentid=7654321">Summary</a></body></html>';
const mcHome = '<html><body><a href="students?tab1=studentdata&tab2=studentsummary&action=form&studentid=1234567">Student Data</a> <a href="students?tab1=studentdata&tab2=gradebook&tab3=weeklysummary&action=form&studentid=1234567">Gradebook</a></body></html>';
const summary = `<table><tr class="listheading"><td>Course</td><td>MP2</td></tr>
<tr class="listrowodd"><td><div>AP Calculus BC</div><div>Patel, Raj</div></td><td>93.5%</td></tr>
<tr class="listroweven"><td><div>HON CHEMISTRY</div><div>Goldberg, Ann</div></td><td>88.1%</td></tr></table>`;
export const state = { extraAssignment: false };
const assigns = () => `<table><tr class="listheading"><td>MP</td><td>Due</td><td>Course</td><td>Category</td><td>Assignment</td><td>Grade</td></tr>
<tr class="listrowodd"><td>MP2</td><td><div>Fri</div><div>11/13</div></td><td><div>AP Calculus BC</div><div>Patel, Raj</div></td><td>Quizzes</td><td><b>Quiz 3.2</b><div>derivatives</div></td><td>18 / 20<div style="font-weight:bold">90%</div></td></tr>
<tr class="listroweven"><td>MP2</td><td><div>Tue</div><div>11/24</div></td><td><div>HON CHEMISTRY</div><div>Goldberg, Ann</div></td><td>Tests</td><td><b>Unit 4 Test</b></td><td>Not Graded</td></tr>
<tr class="listrowodd"><td>MP2</td><td><div>Mon</div><div>11/9</div></td><td><div>HON CHEMISTRY</div><div>Goldberg, Ann</div></td><td>Homework</td><td><b>Ch 6 Problems</b></td><td>Missing</td></tr>
${state.extraAssignment ? '<tr class="listroweven"><td>MP2</td><td><div>Wed</div><div>11/18</div></td><td><div>AP Calculus BC</div><div>Patel, Raj</div></td><td>Tests</td><td><b>Unit 3 Test</b></td><td>47 / 50</td></tr>' : ''}</table>`;
const attendance = `<table><tr class="listrowodd"><td>11/02/2026</td><td>Absent Excused</td></tr><tr class="listroweven"><td>10/20/2026</td><td>Tardy</td></tr></table>`;
const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:ev1', 'DTSTART;TZID=America/New_York:20261119T150000', 'DTEND;TZID=America/New_York:20261119T163000', 'SUMMARY:Robotics\\, build night', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:ev2', 'DTSTART;VALUE=DATE:20261126', 'SUMMARY:Thanksgiving break', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:ev3', 'DTSTART:20261120T140000Z', 'SUMMARY:Chem lab practical', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:ev4', 'DTSTART:20261116T130000Z', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Weekly club', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

function resp(status, body, headers = {}) {
  const h = new Headers();
  for (const [k, v] of Object.entries(headers)) (Array.isArray(v) ? v : [v]).forEach(x => h.append(k, x));
  if (!h.has('content-type')) h.set('content-type', 'text/html; charset=utf-8');
  return new Response(status === 204 || status === 302 ? null : body, { status, headers: h });
}

export async function mockFetch(input, o = {}) {
  const url = typeof input === 'string' ? input : input.url;
  const method = (o.method || 'GET').toUpperCase();
  const cookie = (o.headers && (o.headers.Cookie || o.headers.cookie)) || '';
  const form = typeof o.body === 'string' && /x-www-form-urlencoded/.test((o.headers || {})['Content-Type'] || '') ? Object.fromEntries(new URLSearchParams(o.body)) : {};
  log.push({ url, method, form });
  if (url.startsWith('https://api.anthropic.com')) {
    aiCalls++;
    const body = JSON.parse(o.body);
    if (o.headers['x-api-key'] !== 'sk-good' && o.headers['x-api-key'] !== 'sk-site') return resp(401, JSON.stringify({ error: { message: 'invalid x-api-key' } }), { 'content-type': 'application/json' });
    const p = JSON.stringify(body.messages);
    let text = 'ok';
    if (/PAGE TEXT/.test(p)) text = JSON.stringify({ items: [{ kind: 'assignment', title: 'Lección 4 práctica', course: 'Spanish III Honors', type: 'assignment', due: '2026-11-19T23:59', status: 'todo' }], grades: [] });
    else if (/reply/i.test(body.system || '')) text = JSON.stringify({ reply: 'Plan ready.', events: [] });
    return resp(200, JSON.stringify({ content: [{ type: 'text', text }] }), { 'content-type': 'application/json' });
  }
  if (url.startsWith('https://push.test/')) { pushes.push({ url, headers: o.headers, bytes: o.body ? o.body.length : 0 }); return resp(url.includes('/gone') ? 410 : 201, ''); }
  if (url === 'https://cal.test/basic.ics') return resp(200, ics, { 'content-type': 'text/calendar' });
  if (url === 'https://cal.test/notcal') return resp(200, '<html>hi</html>');
  if (url.startsWith(GEN)) {
    if (/sis\/view\?gohome/.test(url)) return resp(200, loginPage, { 'Set-Cookie': 'JSESSIONID=abc123; Path=/genesis' });
    if (/j_security_check/.test(url)) {
      if (!/sis\/j_security_check/.test(url)) return resp(404, 'nope');
      return form.j_password === 'right' ? resp(302, '', { Location: '/genesis/parents?gohome=true', 'Set-Cookie': 'JSESSIONID=authed; Path=/genesis' }) : resp(200, loginPage + ' Invalid user name or password');
    }
    if (!/JSESSIONID=authed/.test(cookie)) return resp(200, loginPage);
    if (/gohome/.test(url)) return resp(200, homePage);
    if (/weeklysummary/.test(url)) return resp(200, summary);
    if (/listassignments/.test(url)) return resp(200, assigns());
    if (/attendance/.test(url)) return resp(200, attendance);
  }
  if (url.startsWith(MC)) {
    if (/\/mcmsnj\/sis\/view\?gohome/.test(url) && !/JSESSIONID=mcauthed/.test(cookie)) return resp(200, mcLogin, { 'Set-Cookie': 'JSESSIONID=mc1; Path=/mcmsnj; HttpOnly' });
    if (/\/mcmsnj\/sis\/j_security_check$/.test(url)) {
      const okLogin = form.j_password === 'right' && form.j_username === 'student' && form.loginToken === 'tk42' && /JSESSIONID=mc1/.test(cookie);
      return okLogin ? resp(302, '', { Location: '/mcmsnj/students?gohome=true', 'Set-Cookie': ['JSESSIONID=mcauthed; Path=/mcmsnj', 'lb=2; Path=/'] }) : resp(200, mcLogin + ' Invalid user name or password');
    }
    if (!/JSESSIONID=mcauthed/.test(cookie)) return resp(200, mcLogin);
    if (/\/mcmsnj\/students\?gohome/.test(url) || /sis\/view\?gohome/.test(url)) return resp(200, mcHome);
    if (!/\/mcmsnj\/students\?tab1=studentdata&action=form&studentid=1234567/.test(url)) return resp(404, 'bad path ' + url);
    if (/weeklysummary/.test(url)) return resp(200, summary);
    if (/listassignments/.test(url)) return resp(200, assigns());
    if (/attendance/.test(url)) return resp(200, attendance);
  }
  if (url.startsWith('https://www.vhl.test')) {
    if (url === 'https://www.vhl.test/login' && method === 'GET') return resp(200, '<form action="/session" method="post"><input type="hidden" name="authenticity_token" value="tok"><input type="text" name="user[login]"><input type="password" name="user[password]"></form>', { 'Set-Cookie': 'sess=1' });
    if (url === 'https://www.vhl.test/session') return form['user[password]'] === 'pw' && form.authenticity_token === 'tok' ? resp(302, '', { Location: '/dashboard', 'Set-Cookie': 'sess=ok' }) : resp(200, '<form><input type="password" name="p"></form>');
    if (url === 'https://www.vhl.test/dashboard') return resp(200, 'Welcome');
    if (url === 'https://www.vhl.test/assignments') return /sess=ok/.test(cookie) ? resp(200, '<ul><li>Lección 4 Vocabulario quiz due 11/20 11:00 am</li><li>Estructura 4.1 práctica due Nov 18</li><li>About us</li></ul>') : resp(200, '<form><input type="password" name="p"></form>');
  }
  return resp(404, 'not found');
}
