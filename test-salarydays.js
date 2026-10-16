// "Salary counted over" setting (working days / 30 / 31 / calendar month) through the real API:  BASE=... MASTER_EMAIL=... MASTER_PASSWORD=... node test-salarydays.js
const BASE = process.env.BASE || 'http://localhost:3000', ME = process.env.MASTER_EMAIL, MP = process.env.MASTER_PASSWORD;
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : (fail++, console.log('FAIL', n, x)); };
const api = async (m, u, t, b) => { const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
(async () => {
  const code = 'sd' + Math.floor(Math.random() * 1e6), mt = (await api('POST', '/api/login', null, { portal: 'master', identifier: ME, password: MP })).body.token;
  const pre = String.fromCharCode(...[0, 0, 0, 0].map(() => 65 + Math.floor(Math.random() * 26)));
  await api('POST', '/api/master/companies', mt, { name: 'Days Co', code, emp_prefix: pre, admin_name: 'Ada', admin_email: code + '@t.com', admin_password: 'secret1', confirm_password: MP });
  const at = (await api('POST', '/api/login', null, { portal: 'admin', identifier: code + '@t.com', password: 'secret1' })).body.token;
  const e = (await api('POST', '/api/employees', at, { name: 'Emp', email: 'e@t.com', join_date: '2025-01-01', ctc: 1200000, confirm_password: 'secret1' })).body;
  const et = (await api('POST', '/api/login', null, { portal: 'employee', identifier: e.emp_code, password: e.password })).body.token;
  const row = async month => (await api('GET', '/api/payroll/overview?month=' + month, at)).body.rows.find(r => r.emp_id === e.id);
  const setB = (b, t = at) => api('PUT', '/api/settings/salary-days', t, { basis: b });
  // a far-future month: nobody is absent yet, so it shows the full-month figures. 2099-01 has 31 days, 2099-02 has 28
  ok('default is working days', (await api('GET', '/api/settings/attendance', at)).body.salary_days === 'working');
  const w31 = await row('2099-01'); ok('working days basis: 22 working days in January 2099', w31.working_days >= 20 && w31.working_days <= 23, JSON.stringify(w31.working_days));
  ok('employee cannot change it', (await setB('30', et)).status === 403);
  ok('invalid choice refused', (await setB('banana')).status === 400);
  ok('set 30 days', (await setB('30')).status === 200 && (await api('GET', '/api/settings/attendance', et)).body.salary_days === '30');
  ok('31-day month counts 30 days', (await row('2099-01')).working_days === 30); ok('28-day month still counts 30', (await row('2099-02')).working_days === 30);
  ok('a full month pays the full salary', Math.abs((await row('2099-01')).gross - 100000) < 0.01);
  ok('set 31 days', (await setB('31')).status === 200 && (await row('2099-02')).working_days === 31);
  ok('set calendar month: 31, 28 days', (await setB('calendar')).status === 200 && (await row('2099-01')).working_days === 31 && (await row('2099-02')).working_days === 28);
  ok('employees see it in the policy', (await api('GET', '/api/dashboard', et)).body.policies.attendance.salary_days === 'calendar');
  // a past month with no attendance at all: every working day is an absence, weekends and holidays stay paid on a fixed basis
  const now = new Date(), y = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear(), m = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth(), month = `${y}-${String(m).padStart(2, '0')}`, dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pastCal = await row(month); ok('calendar basis: weekly offs are paid, so paid days = days in month - working days', pastCal.paid_days === dim - pastCal.lop_days && pastCal.paid_days > 0, JSON.stringify([pastCal.paid_days, pastCal.lop_days, dim]));
  await setB('working'); const pastW = await row(month); ok('working-days basis: no absence-free paid days when nobody punched', pastW.paid_days === 0, JSON.stringify(pastW.paid_days));
  ok('back to working days', (await api('GET', '/api/settings/attendance', at)).body.salary_days === 'working');
  await api('DELETE', '/api/master/companies/' + (await api('GET', '/api/master/companies', mt)).body.find(x => x.code === code).id, mt, { confirm: code, confirm_password: MP });
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
