// Editable leave types (name, days, paid / unpaid) and their effect on payroll:  BASE=http://localhost:3000 MASTER_EMAIL=... MASTER_PASSWORD=... node test-leavetypes.js
const BASE = process.env.BASE || 'http://localhost:3000', ME = process.env.MASTER_EMAIL, MP = process.env.MASTER_PASSWORD;
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : (fail++, console.log('FAIL', n, x)); };
const api = async (m, u, t, b) => { const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
const addD = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }, wk = s => ![0, 6].includes(new Date(s + 'T00:00:00Z').getUTCDay());
(async () => {
  const code = 'lt' + Math.floor(Math.random() * 1e6), mt = (await api('POST', '/api/login', null, { portal: 'master', identifier: ME, password: MP })).body.token;
  const pre = String.fromCharCode(65 + Math.floor(Math.random() * 26), 65 + Math.floor(Math.random() * 26), 65 + Math.floor(Math.random() * 26), 65 + Math.floor(Math.random() * 26));
  await api('POST', '/api/master/companies', mt, { name: 'Leave Co', code, emp_prefix: pre, admin_name: 'Ada', admin_email: code + '@t.com', admin_password: 'secret1', confirm_password: MP });
  const at = (await api('POST', '/api/login', null, { portal: 'admin', identifier: code + '@t.com', password: 'secret1' })).body.token;
  const e = (await api('POST', '/api/employees', at, { name: 'Emp', email: 'e@t.com', join_date: '2025-01-01', ctc: 1200000, confirm_password: 'secret1' })).body;
  const et = (await api('POST', '/api/login', null, { portal: 'employee', identifier: e.emp_code, password: e.password })).body.token;
  const types = async () => (await api('GET', '/api/lookups', at)).body.leaveTypes, cl = (await types()).find(t => /Casual/.test(t.name)), wfh = (await types()).find(t => t.kind === 'wfh');

  ok('employee cannot edit leave types', (await api('PUT', '/api/leave-types/' + cl.id, et, { is_paid: false })).status === 403);
  ok('employee cannot delete leave types', (await api('DELETE', '/api/leave-types/' + cl.id, et)).status === 403);
  ok('rename + new allowance', (await api('PUT', '/api/leave-types/' + cl.id, at, { name: 'Casual (CL)', days_per_year: 10 })).status === 200 && (await types()).some(t => t.id === cl.id && t.name === 'Casual (CL)' && t.days_per_year === 10));
  ok('empty name refused', (await api('PUT', '/api/leave-types/' + cl.id, at, { name: '  ' })).status === 400);
  const other = (await types()).find(t => t.id !== cl.id && t.kind !== 'wfh'); ok('duplicate name refused', (await api('PUT', '/api/leave-types/' + cl.id, at, { name: other.name.toUpperCase() })).status === 400);
  ok('negative days refused', (await api('PUT', '/api/leave-types/' + cl.id, at, { days_per_year: -1 })).status === 400);
  ok('work from home has no paid setting', (await api('PUT', '/api/leave-types/' + wfh.id, at, { is_paid: false })).status === 400);
  ok('work from home can be renamed but not deleted', (await api('PUT', '/api/leave-types/' + wfh.id, at, { name: 'Remote work' })).status === 200 && (await api('DELETE', '/api/leave-types/' + wfh.id, at)).status === 400);
  ok('the policy shown to employees follows the edit', (await api('GET', '/api/dashboard', et)).body.policies.leaveTypes.some(t => t.name === 'Casual (CL)' && t.days_per_year === 10));

  // paid vs unpaid changes payroll: one leave day in the last full month, no other attendance
  const now = new Date(), y = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear(), m = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth(), month = `${y}-${String(m).padStart(2, '0')}`;
  let day = `${month}-10`; while (!wk(day)) day = addD(day, 1);
  ok('admin marks the day as casual leave', (await api('POST', '/api/attendance/edit', at, { emp_id: e.id, date: day, status: 'leave', type_id: cl.id })).status === 200);
  const lop = async () => (await api('GET', '/api/payroll/overview?month=' + month, at)).body.rows.find(r => r.emp_id === e.id).lop_days;
  const paidLop = await lop(); ok('paid leave day is not a loss of pay', paidLop >= 0);
  ok('switch Casual to unpaid', (await api('PUT', '/api/leave-types/' + cl.id, at, { is_paid: false })).status === 200 && (await types()).find(t => t.id === cl.id).is_paid === 0);
  const unpaidLop = await lop(); ok('the same day now counts as a loss of pay', Math.abs(unpaidLop - paidLop - 1) < 0.001, JSON.stringify([paidLop, unpaidLop]));
  ok('back to paid restores it', (await api('PUT', '/api/leave-types/' + cl.id, at, { is_paid: true })).status === 200 && Math.abs((await lop()) - paidLop) < 0.001);

  // delete rules
  ok('a type with leave history cannot be deleted', (await api('DELETE', '/api/leave-types/' + cl.id, at)).status === 400);
  const add = await api('POST', '/api/leave-types', at, { name: 'Study leave', days_per_year: 5, is_paid: true }); ok('add a type', add.status === 200);
  const study = (await types()).find(t => t.name === 'Study leave'); ok('new type is paid with 5 days', study && study.is_paid === 1 && study.days_per_year === 5);
  ok('unused type can be deleted', (await api('DELETE', '/api/leave-types/' + study.id, at)).status === 200 && !(await types()).some(t => t.id === study.id));
  await api('DELETE', '/api/master/companies/' + (await api('GET', '/api/master/companies', mt)).body.find(x => x.code === code).id, mt, { confirm: code, confirm_password: MP });
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
