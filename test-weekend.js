// Company weekly off days through the real API:  BASE=http://localhost:3000 MASTER_EMAIL=... MASTER_PASSWORD=... node test-weekend.js
const BASE = process.env.BASE || 'http://localhost:3000', ME = process.env.MASTER_EMAIL, MP = process.env.MASTER_PASSWORD;
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : (fail++, console.log('FAIL', n, x)); };
const api = async (m, u, t, b) => { const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
const addD = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }, dow = s => new Date(s + 'T00:00:00Z').getUTCDay();
const nextDow = (from, w) => { let d = from; while (dow(d) !== w) d = addD(d, 1); return d; };
(async () => {
  const code = 'wk' + Math.floor(Math.random() * 1e6), mt = (await api('POST', '/api/login', null, { portal: 'master', identifier: ME, password: MP })).body.token;
  await api('POST', '/api/master/companies', mt, { name: 'Weekend Co', code, emp_prefix: 'WKD', admin_name: 'Ada', admin_email: code + '@t.com', admin_password: 'secret1', confirm_password: MP });
  const at = (await api('POST', '/api/login', null, { portal: 'admin', identifier: code + '@t.com', password: 'secret1' })).body.token;
  const e = (await api('POST', '/api/employees', at, { name: 'Emp', email: 'e@t.com', join_date: '2025-01-01', confirm_password: 'secret1' })).body;
  const et = (await api('POST', '/api/login', null, { portal: 'employee', identifier: e.emp_code, password: e.password })).body.token;
  const future = addD(new Date().toISOString().slice(0, 10), 30), fri = nextDow(future, 5), sat = addD(fri, 1), sun = addD(fri, 2), mon = addD(fri, 3), thu = addD(fri, -1);
  const workday = async d => (await api('GET', '/api/attendance/overview?date=' + d, at)).body.workday;

  ok('default: Saturday and Sunday off', JSON.stringify((await api('GET', '/api/lookups', et)).body.weekend) === '[0,6]');
  ok('default: Friday works, Sunday off', (await workday(fri)) === true && (await workday(sun)) === false);
  ok('employee cannot change the weekend', (await api('PUT', '/api/settings/weekend', et, { days: [0] })).status === 403);
  ok('invalid day refused', (await api('PUT', '/api/settings/weekend', at, { days: [7] })).status === 400);
  ok('seven off days refused', (await api('PUT', '/api/settings/weekend', at, { days: [0, 1, 2, 3, 4, 5, 6] })).status === 400);

  // Friday + Saturday off (Gulf-style week)
  ok('set Friday + Saturday off', (await api('PUT', '/api/settings/weekend', at, { days: [5, 6] })).status === 200);
  ok('lookups carry it to every user', JSON.stringify((await api('GET', '/api/lookups', et)).body.weekend) === '[5,6]');
  ok('Friday and Saturday are now off, Sunday works', (await workday(fri)) === false && (await workday(sat)) === false && (await workday(sun)) === true);
  const cl = (await api('GET', '/api/lookups', et)).body.leaveTypes.find(l => l.kind !== 'wfh');
  const lv = await api('POST', '/api/leaves', et, { type_id: cl.id, from_date: thu, to_date: mon, reason: 'trip' });
  ok('leave Thu to Mon counts Thu, Sun, Mon only (Fri + Sat are off)', lv.status === 200 && lv.body.days === 3, JSON.stringify(lv.body));
  ok('the attendance policy shows the new weekend', JSON.stringify((await api('GET', '/api/settings/attendance', at)).body.weekend) === '[5,6]');
  ok('the dashboard policies carry it for employees', JSON.stringify((await api('GET', '/api/dashboard', et)).body.policies.attendance.weekend) === '[5,6]');

  // only Sunday off, then a seven-day week
  ok('only Sunday off', (await api('PUT', '/api/settings/weekend', at, { days: [0] })).status === 200 && (await workday(sat)) === true && (await workday(sun)) === false);
  ok('no weekly off at all', (await api('PUT', '/api/settings/weekend', at, { days: [] })).status === 200 && (await workday(sun)) === true && (await workday(sat)) === true);
  ok('back to the default', (await api('PUT', '/api/settings/weekend', at, { days: [0, 6] })).status === 200 && (await workday(sat)) === false);
  await api('DELETE', '/api/master/companies/' + (await api('GET', '/api/master/companies', mt)).body.find(x => x.code === code).id, mt, { confirm: code, confirm_password: MP });
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
