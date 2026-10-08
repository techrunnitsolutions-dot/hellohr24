// Payroll hours/overtime through the real API (local SQLite only - it writes past attendance straight into the company database file):
//   BASE=http://localhost:3000 MASTER_EMAIL=... MASTER_PASSWORD=... node test-payroll-api.js
const { DatabaseSync } = require('node:sqlite'), path = require('path');
const BASE = process.env.BASE || 'http://localhost:3000', ME = process.env.MASTER_EMAIL, MP = process.env.MASTER_PASSWORD;
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : (fail++, console.log('FAIL', n, x)); }; const near = (a, b, e = 0.02) => Math.abs(a - b) <= e;
const api = async (m, u, t, b) => { const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
const addD = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }, wk = s => ![0, 6].includes(new Date(s + 'T00:00:00Z').getUTCDay());
const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
(async () => {
  const code = 'payhrs' + Math.floor(Math.random() * 1e6), mt = (await api('POST', '/api/login', null, { portal: 'master', identifier: ME, password: MP })).body.token;
  const co = await api('POST', '/api/master/companies', mt, { name: 'Pay Hours Co', code, emp_prefix: 'PAY', admin_name: 'Ada', admin_email: code + '@t.com', admin_password: 'secret1', confirm_password: MP }); ok('create company', co.status === 200);
  const at = (await api('POST', '/api/login', null, { portal: 'admin', identifier: code + '@t.com', password: 'secret1' })).body.token;
  const mk = async (n, e, ctc) => (await api('POST', '/api/employees', at, { name: n, email: e, join_date: '2025-01-01', ctc, confirm_password: 'secret1' })).body;
  const A = await mk('Hours Worker', 'a@t.com', 1200000), B = await mk('Steady Worker', 'b@t.com', 1200000);   // 100000 / month each
  // a fully finished month (last month) so everything is final
  const now = new Date(), y = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear(), m = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth(), month = `${y}-${String(m).padStart(2, '0')}`;
  const days = []; for (let d = `${month}-01`; d.slice(0, 7) === month; d = addD(d, 1)) if (wk(d)) days.push(d);
  const db = new DatabaseSync(path.join('D:/hellohr/data', code + '.db'));
  const rec = (id, date, inMin, outMin) => db.prepare("INSERT INTO attendance(emp_id,date,check_in,check_out,status,mode) VALUES(?,?,?,?,'present','office')").run(id, date, hm(inMin), hm(outMin));
  const start = 9 * 60 + 30;   // 09:30, office day is 9h
  for (const d of days) { rec(B.id, d, start, start + 540); rec(A.id, d, start, start + 540); }   // everybody full 9h days...
  db.prepare('DELETE FROM attendance WHERE emp_id=? AND date IN (?,?,?)').run(A.id, days[0], days[1], days[2]);
  rec(A.id, days[0], start, start + 120);        // 2 h only            -> hourly pay, not a day
  rec(A.id, days[1], start, start + 660);        // 11 h                -> 2 h overtime
  rec(A.id, days[2], start, start + 600);        // 10.5 h? (630) use 10h -> 1 h overtime
  db.prepare('DELETE FROM attendance WHERE emp_id=? AND date=?').run(A.id, days[3]);   // no record at all -> absent, full LOP
  const wd = days.length, hourly = 100000 / (wd * 9);

  const ov = (await api('GET', '/api/payroll/overview?month=' + month, at)).body, a = ov.rows.find(r => r.emp_id === A.id), b = ov.rows.find(r => r.emp_id === B.id);
  ok('control employee: all days paid, no overtime', b.lop_days === 0 && b.ot_pay === 0 && near(b.gross, 100000), JSON.stringify(b));
  ok('short day paid by the hour: 1 - 2/9 of a day lost, plus 1 full absent day', near(a.lop_days, (1 - 2 / 9) + 1), JSON.stringify([a.lop_days, 1 - 2 / 9 + 1]));
  ok('short-day hours reported', near(a.partial_hours, 2), a.partial_hours);
  ok('overtime hours = 2 + 1', near(a.ot_hours, 3), a.ot_hours);
  ok('overtime pay = hours x hourly rate x 1.75', near(a.ot_pay, 3 * hourly * 1.75, 0.05), JSON.stringify([a.ot_pay, 3 * hourly * 1.75]));
  ok('hourly rate = monthly gross / (working days x 9)', near(a.hourly_rate, hourly, 0.02), JSON.stringify([a.hourly_rate, hourly]));
  ok('net pay includes the overtime', near(a.net, a.gross - a.deductions + a.reimbursements + a.ot_pay, 0.05));
  ok('gross reflects loss of pay (exact: 22 days minus 1 absent minus the unworked 7/9 of the short day)', near(a.gross, 100000 * (wd - ((1 - 2 / 9) + 1)) / wd, 0.05), JSON.stringify([a.gross, 100000 * (wd - ((1 - 2 / 9) + 1)) / wd]));
  ok('salary date is the 7th of the following month', ov.totals.pay_date === `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-07`, ov.totals.pay_date);
  ok('company totals include overtime', near(ov.totals.ot_hours, 3) && near(ov.totals.ot_pay, a.ot_pay, 0.05));

  const lk = (await api('GET', '/api/settings/attendance', at)).body; ok('settings expose salary day and overtime extra', lk.salary_day === 7 && lk.ot_premium === 75, JSON.stringify(lk));
  ok('change overtime extra to 50% and salary day to 10', (await api('PUT', '/api/settings/attendance', at, { ...lk, grace_minutes: lk.grace_minutes, half_day_hours: lk.half_day_hours, full_day_hours: lk.full_day_hours, allowance_days: lk.allowance_days, salary_day: 10, ot_premium_percent: 50 })).status === 200);
  const ov2 = (await api('GET', '/api/payroll/overview?month=' + month, at)).body, a2 = ov2.rows.find(r => r.emp_id === A.id);
  ok('new premium applies', near(a2.ot_pay, 3 * hourly * 1.5, 0.05) && ov2.totals.pay_date.endsWith('-10'), JSON.stringify([a2.ot_pay, ov2.totals.pay_date]));
  ok('bad salary day refused', (await api('PUT', '/api/settings/attendance', at, { ...lk, salary_day: 31 })).status === 400);
  ok('bad overtime extra refused', (await api('PUT', '/api/settings/attendance', at, { ...lk, ot_premium_percent: 500 })).status === 400);

  // run + finalize: the saved payslip keeps the numbers, the employee sees them
  const run = await api('POST', '/api/payroll/runs', at, { month }); ok('run payroll', run.status === 200);
  await api('POST', `/api/payroll/runs/${run.body.id}/finalize`, at);
  const login = await api('POST', '/api/login', null, { portal: 'employee', identifier: A.emp_code, password: A.password });
  const slip = (await api('GET', '/api/payslips', login.body.token)).body.find(p => p.month === month);
  ok('employee payslip carries overtime, short-day hours, hourly rate and salary date', slip && near(slip.ot_hours, 3) && near(slip.ot_pay, a2.ot_pay, 0.05) && near(slip.partial_hours, 2) && slip.hourly_rate > 0 && slip.pay_date.endsWith('-10'), JSON.stringify(slip));
  const rd = (await api('GET', '/api/payroll/runs/' + run.body.id, at)).body.slips.find(p => p.emp_id === A.id); ok('run detail has the same figures', near(rd.net, slip.net, 0.01));
  const dash = (await api('GET', '/api/dashboard', login.body.token)).body; ok('Office policies carry salary day + overtime rule', dash.policies.attendance.salary_day === 10 && dash.policies.attendance.ot_premium === 50);
  const att = (await api('GET', `/api/attendance/overview?date=${days[1]}`, at)).body.rows.find(r => r.id === A.id); ok('admin attendance shows the overtime of the day', att && near(att.overtime, 2, 0.05), JSON.stringify(att));
  db.close();
  ok('cleanup', (await api('DELETE', `/api/master/companies/${co.body.id}`, mt, { confirm: code, confirm_password: MP })).status === 200);
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
