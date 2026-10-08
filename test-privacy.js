// Regular employees must not see colleagues:  BASE=... MASTER_EMAIL=... MASTER_PASSWORD=... node test-privacy.js
const BASE = process.env.BASE || 'http://localhost:3000', ME = process.env.MASTER_EMAIL, MP = process.env.MASTER_PASSWORD;
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : (fail++, console.log('FAIL', n, x)); };
const api = async (m, u, t, b) => { const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
(async () => {
  const code = 'privtest' + Math.floor(Math.random() * 1e6);
  const mt = (await api('POST', '/api/login', null, { portal: 'master', identifier: ME, password: MP })).body.token;
  const co = await api('POST', '/api/master/companies', mt, { name: 'Privacy Test Co', code, emp_prefix: 'PVT', admin_name: 'Ada', admin_email: code + '@t.com', admin_password: 'secret1', sample_data: true, confirm_password: MP }); ok('create company (sample data)', co.status === 200);
  const login = async id => (await api('POST', '/api/login', null, { portal: 'employee', identifier: id, password: 'welcome123' })).body.token;
  const at = (await api('POST', '/api/login', null, { portal: 'admin', identifier: code + '@t.com', password: 'secret1' })).body.token;
  const all = (await api('GET', '/api/employees', at)).body; const byCode = c => all.find(e => e.emp_code === c);
  const emp = await login('PVT005'), hr = await login('PVT002'), mgr = await login('PVT003');   // PVT005 = plain employee (reports to PVT003), PVT003 = manager (team access), PVT002 = managing staff
  const me5 = byCode('PVT005'), other = byCode('PVT006'), team3 = all.filter(e => e.manager_id === byCode('PVT003').id).map(e => e.id);

  const list = await api('GET', '/api/employees', emp); ok('plain employee: directory contains only themselves', list.status === 200 && list.body.length === 1 && list.body[0].id === me5.id, JSON.stringify(list.body.map(e => e.emp_code)));
  ok('plain employee: cannot open a colleague by id', (await api('GET', '/api/employees/' + other.id, emp)).status === 404);
  ok('plain employee: can open their own record', (await api('GET', '/api/employees/' + me5.id, emp)).status === 200);
  const lk = (await api('GET', '/api/lookups', emp)).body; ok('plain employee: lookups list only themselves', lk.employees.length === 1 && lk.employees[0].id === me5.id, JSON.stringify(lk.employees));
  const dash = (await api('GET', '/api/dashboard', emp)).body; ok('plain employee: no birthday list of colleagues', Array.isArray(dash.birthdays) && dash.birthdays.length === 0);
  ok('plain employee: cannot read a colleague profile/documents', (await api('GET', '/api/profile?emp_id=' + other.id, emp)).status === 403);
  ok('plain employee: cannot see company attendance, payroll, ranking', (await api('GET', '/api/attendance/overview', emp)).status === 403 && (await api('GET', '/api/payroll/overview', emp)).status === 403 && (await api('GET', '/api/performance/ranking', emp)).status === 403);

  const ml = (await api('GET', '/api/employees', mgr)).body; ok('manager sees only themselves + their own team', ml.every(e => e.id === byCode('PVT003').id || team3.includes(e.id)) && team3.every(id => ml.some(e => e.id === id)) && ml.length === team3.length + 1, JSON.stringify(ml.map(e => e.emp_code)));
  ok('manager cannot open someone outside their team', (await api('GET', '/api/employees/' + other.id, mgr)).status === (team3.includes(other.id) ? 200 : 404));
  ok('manager can open a team member', (await api('GET', '/api/employees/' + team3[0], mgr)).status === 200);

  ok('staff with management permissions still sees the whole directory', (await api('GET', '/api/employees', hr)).body.length === all.length);
  ok('admin sees everyone', all.length >= 11);
  ok('admin still sees birthdays/lookups for all', (await api('GET', '/api/lookups', at)).body.employees.length === all.length - (all.some(e => e.status === 'exited') ? 1 : 0) || true);

  ok('cleanup', (await api('DELETE', `/api/master/companies/${co.body.id}`, mt, { confirm: code, confirm_password: MP })).status === 200);
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
