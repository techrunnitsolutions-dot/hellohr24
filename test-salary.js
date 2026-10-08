// Salary basis (annual CTC vs annual in-hand) through the real API:
//   BASE=http://localhost:3000 MASTER_EMAIL=... MASTER_PASSWORD=... node test-salary.js
const BASE = process.env.BASE || 'http://localhost:3000', ME = process.env.MASTER_EMAIL, MP = process.env.MASTER_PASSWORD;
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : (fail++, console.log('FAIL', n, x)); };
const api = async (m, u, t, b) => { const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
(async () => {
  const code = 'sal' + Math.floor(Math.random() * 1e6), mt = (await api('POST', '/api/login', null, { portal: 'master', identifier: ME, password: MP })).body.token;
  ok('create company', (await api('POST', '/api/master/companies', mt, { name: 'Salary Co', code, emp_prefix: 'SAL', admin_name: 'Ada', admin_email: code + '@t.com', admin_password: 'secret1', confirm_password: MP })).status === 200);
  const at = (await api('POST', '/api/login', null, { portal: 'admin', identifier: code + '@t.com', password: 'secret1' })).body.token, PW = { confirm_password: 'secret1' };
  const mk = (n, e, extra) => api('POST', '/api/employees', at, { name: n, email: e, join_date: '2025-01-01', ...extra, ...PW });
  const a = await mk('Ctc Person', 'a@t.com', { salary_type: 'ctc', salary_amount: 1200000 }), b = await mk('Inhand Person', 'b@t.com', { salary_type: 'inhand', salary_amount: 1000000 }), c = await mk('Legacy Person', 'c@t.com', { ctc: 600000 });
  ok('create with CTC', a.status === 200 && a.body.salary.ctc === 1200000 && a.body.salary.type === 'ctc', JSON.stringify(a.body));
  ok('create with in-hand: CTC is above in-hand', b.status === 200 && b.body.salary.type === 'inhand' && b.body.salary.ctc > 1000000 && Math.abs(b.body.salary.inhand_annual - 1000000) < 2, JSON.stringify(b.body));
  ok('legacy ctc field still works', c.status === 200 && c.body.salary.ctc === 600000);
  ok('bad basis refused', (await mk('X', 'x@t.com', { salary_type: 'hourly', salary_amount: 5 })).status === 400);
  ok('negative amount refused', (await mk('Y', 'y@t.com', { salary_type: 'ctc', salary_amount: -4 })).status === 400);

  // a full (future) month nets in-hand / 12
  const ov = (await api('GET', '/api/payroll/overview?month=2099-01', at)).body, rb = ov.rows.find(r => r.emp_id === b.body.id), ra = ov.rows.find(r => r.emp_id === a.body.id);
  ok('payroll pays in-hand / 12 for an in-hand employee', rb && Math.abs(rb.net * 12 - 1000000) < 30, JSON.stringify(rb && rb.net));
  ok('payroll uses the CTC for a CTC employee', ra && ra.ctc === 1200000);

  // list / preview
  const list = (await api('GET', '/api/salary', at)).body;
  ok('salary list has everybody but the admin', list.length === 3 && list.every(r => r.inhand_monthly > 0), JSON.stringify(list.length));
  const pv = (await api('POST', '/api/salary/preview', at, { salary_type: 'inhand', salary_amount: 500000 })).body;
  ok('preview', pv.ctc > 500000 && Math.abs(pv.inhand_annual - 500000) < 2);

  // editing needs the password and is logged
  ok('edit without password refused', (await api('PUT', '/api/salary', at, { changes: [{ emp_id: a.body.id, salary_type: 'ctc', salary_amount: 1500000 }] })).status === 403);
  ok('edit with wrong password refused', (await api('PUT', '/api/salary', at, { changes: [{ emp_id: a.body.id, salary_type: 'ctc', salary_amount: 1500000 }], confirm_password: 'nope' })).status === 403);
  const sv = await api('PUT', '/api/salary', at, { changes: [{ emp_id: a.body.id, salary_type: 'ctc', salary_amount: 1500000 }, { emp_id: c.body.id, salary_type: 'inhand', salary_amount: 400000 }], ...PW });
  ok('save changes', sv.status === 200 && sv.body.changed === 2, JSON.stringify(sv.body));
  const after = (await api('GET', '/api/salary', at)).body, ea = after.find(r => r.id === a.body.id), ec = after.find(r => r.id === c.body.id);
  ok('CTC person now 15L', ea.ctc === 1500000 && ea.salary_type === 'ctc'); ok('legacy person now in-hand 4L', ec.salary_type === 'inhand' && Math.abs(ec.inhand_annual - 400000) < 2, JSON.stringify(ec));

  // switching the basis keeps the pay
  const before = after.map(r => [r.id, r.ctc]);
  ok('switch everyone to in-hand needs the password', (await api('POST', '/api/salary/switch-type', at, { salary_type: 'inhand' })).status === 403);
  const sw = await api('POST', '/api/salary/switch-type', at, { salary_type: 'inhand', ...PW });
  ok('switch to in-hand', sw.status === 200 && sw.body.changed === 1, JSON.stringify(sw.body));   // only the CTC person (A) changes; the others are already in-hand
  const sw2 = (await api('GET', '/api/salary', at)).body;
  ok('everyone is in-hand and the pay (CTC) did not move', sw2.every(r => r.salary_type === 'inhand') && before.every(([id, ctc]) => sw2.find(r => r.id === id).ctc === ctc), JSON.stringify(sw2.map(r => [r.salary_type, r.ctc])));
  ok('in-hand amount shown matches the pay', Math.abs(sw2.find(r => r.id === a.body.id).salary_amount - sw2.find(r => r.id === a.body.id).inhand_annual) < 2);
  await api('POST', '/api/salary/switch-type', at, { salary_type: 'ctc', ...PW });
  const sw3 = (await api('GET', '/api/salary', at)).body;
  ok('and back to CTC: pay still unchanged', sw3.every(r => r.salary_type === 'ctc') && before.every(([id, ctc]) => sw3.find(r => r.id === id).ctc === ctc));
  // saving a re-expressed row (as the page does) must not move the pay either
  const rowB = sw3.find(r => r.id === b.body.id), ib = Math.round(rowB.inhand_annual);
  await api('PUT', '/api/salary', at, { changes: [{ emp_id: rowB.id, salary_type: 'inhand', salary_amount: ib }], ...PW });
  ok('saving the same pay under the other basis keeps the CTC', (await api('GET', '/api/salary', at)).body.find(r => r.id === rowB.id).ctc === rowB.ctc);

  // employee page edit
  const one = await api('PUT', '/api/employees/' + a.body.id, at, { salary_amount: 1800000, ...PW }); ok('edit one employee amount', one.status === 200 && (await api('GET', '/api/salary', at)).body.find(r => r.id === a.body.id).ctc === 1800000);
  ok('edit one employee amount without password refused', (await api('PUT', '/api/employees/' + a.body.id, at, { salary_amount: 1900000 })).status === 403);
  const detail = (await api('GET', '/api/salary-structure?emp_id=' + a.body.id, at)).body; ok('salary structure carries the basis and take-home', detail.salary_type === 'ctc' && detail.breakdown.inhand_monthly > 0);

  const log = (await api('GET', '/api/salary/log', at)).body; ok('changes are logged', log.length >= 5 && log.every(x => x.by_name), JSON.stringify(log.length));

  // a plain employee cannot see or touch any of it
  const el = (await api('POST', '/api/login', null, { portal: 'employee', identifier: a.body.emp_code, password: a.body.password })).body.token;
  ok('employee cannot list salaries', (await api('GET', '/api/salary', el)).status === 403);
  ok('employee cannot change salaries', (await api('PUT', '/api/salary', el, { changes: [{ emp_id: a.body.id, salary_type: 'ctc', salary_amount: 9e6 }], confirm_password: a.body.password })).status === 403);
  ok('employee cannot see the log', (await api('GET', '/api/salary/log', el)).status === 403);
  const me = (await api('GET', '/api/employees/' + a.body.id, el)).body; ok('employee sees their own salary basis', me.salary_type !== undefined);
  await api('DELETE', '/api/master/companies/' + (await api('GET', '/api/master/companies', mt)).body.find(x => x.code === code).id, mt, { confirm: code, confirm_password: MP });
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
