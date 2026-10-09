// Multi-day holidays through the real API:  BASE=http://localhost:3000 MASTER_EMAIL=... MASTER_PASSWORD=... node test-holidays.js
const BASE = process.env.BASE || 'http://localhost:3000', ME = process.env.MASTER_EMAIL, MP = process.env.MASTER_PASSWORD;
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : (fail++, console.log('FAIL', n, x)); };
const api = async (m, u, t, b) => { const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
const addD = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }, wk = s => ![0, 6].includes(new Date(s + 'T00:00:00Z').getUTCDay());
(async () => {
  const code = 'hol' + Math.floor(Math.random() * 1e6), mt = (await api('POST', '/api/login', null, { portal: 'master', identifier: ME, password: MP })).body.token;
  await api('POST', '/api/master/companies', mt, { name: 'Holiday Co', code, emp_prefix: 'HOL', admin_name: 'Ada', admin_email: code + '@t.com', admin_password: 'secret1', confirm_password: MP });
  const at = (await api('POST', '/api/login', null, { portal: 'admin', identifier: code + '@t.com', password: 'secret1' })).body.token;
  const e = (await api('POST', '/api/employees', at, { name: 'Emp', email: 'e@t.com', join_date: '2025-01-01', confirm_password: 'secret1' })).body;
  const et = (await api('POST', '/api/login', null, { portal: 'employee', identifier: e.emp_code, password: e.password })).body.token;
  let start = addD(new Date().toISOString().slice(0, 10), 40); while (!wk(start)) start = addD(start, 1);   // a weekday well in the future
  const bad = async (b, n) => ok(n, (await api('POST', '/api/holidays', at, b)).status === 400, JSON.stringify(b));
  await bad({ name: 'X', date: start, days: 0 }, '0 days refused'); await bad({ name: 'X', date: start, days: 61 }, '61 days refused'); await bad({ date: start, days: 2 }, 'name required'); await bad({ name: 'X', date: 'soon', days: 2 }, 'bad date refused');
  ok('employee cannot add holidays', (await api('POST', '/api/holidays', et, { name: 'Free', date: start, days: 1 })).status === 403);
  const r = await api('POST', '/api/holidays', at, { name: 'Diwali', date: start, days: 3 }); ok('3-day holiday added', r.status === 200 && r.body.added === 3, JSON.stringify(r.body));
  const list = (await api('GET', '/api/holidays', et)).body.filter(h => h.name === 'Diwali'); ok('three consecutive dates, same name', list.length === 3 && list.map(h => h.date).join() === [start, addD(start, 1), addD(start, 2)].join(), JSON.stringify(list));
  const r2 = await api('POST', '/api/holidays', at, { name: 'Diwali extra', date: addD(start, 2), days: 2 }); ok('overlap keeps the existing day and adds the new one', r2.status === 200 && r2.body.added === 1 && r2.body.skipped === 1, JSON.stringify(r2.body));
  ok('adding only already-taken dates is refused', (await api('POST', '/api/holidays', at, { name: 'Again', date: start, days: 1 })).status === 400);
  ok('single-day form (no days field) still works', (await api('POST', '/api/holidays', at, { name: 'One day', date: addD(start, 20) })).status === 200);
  const month = start.slice(0, 7), cal = (await api('GET', '/api/attendance?month=' + month, et)).body; ok('employee attendance calendar carries the holiday names', cal.holidays.some(h => h.date === start && h.name === 'Diwali'), JSON.stringify(cal.holidays));
  const dash = (await api('GET', '/api/dashboard', et)).body; ok('employee dashboard lists upcoming holidays', dash.holidays.some(h => h.name === 'Diwali'));
  // a leave spanning the holiday does not use leave days for it
  const cl = (await api('GET', '/api/lookups', et)).body.leaveTypes.find(l => l.kind !== 'wfh');
  let from = addD(start, -1); while (!wk(from)) from = addD(from, -1); let to = addD(start, 3); while (!wk(to)) to = addD(to, 1);
  const lv = await api('POST', '/api/leaves', et, { type_id: cl.id, from_date: from, to_date: to, reason: 'trip' });
  let want = 0; const hs = new Set([start, addD(start, 1), addD(start, 2), addD(start, 3)]); for (let d = from; d <= to; d = addD(d, 1)) if (wk(d) && !hs.has(d)) want++;
  ok('leave over a holiday counts only the working days', lv.status === 200 && lv.body.days === want, JSON.stringify([lv.body, want]));
  ok('admin can delete a holiday', (await api('DELETE', '/api/holidays/' + list[0].id, at)).status === 200);
  await api('DELETE', '/api/master/companies/' + (await api('GET', '/api/master/companies', mt)).body.find(x => x.code === code).id, mt, { confirm: code, confirm_password: MP });
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
