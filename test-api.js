// End-to-end API check against a running server:  BASE=http://localhost:3000 MASTER_EMAIL=... MASTER_PASSWORD=... node test-api.js
// Creates a throw-away company, exercises the main features, then deletes the company again.
const BASE = process.env.BASE || 'http://localhost:3000', ME = process.env.MASTER_EMAIL, MP = process.env.MASTER_PASSWORD;
if (!ME || !MP) { console.error('Set MASTER_EMAIL and MASTER_PASSWORD'); process.exit(2); }
let pass = 0, fail = 0;
const api = async (method, url, token, body) => { const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
const ok = (name, cond, extra = '') => { cond ? pass++ : (fail++, console.log('FAIL', name, extra)); };
const code = 'apitest' + Math.floor(Math.random() * 1e6);
(async () => {
  const m = await api('POST', '/api/login', null, { portal: 'master', identifier: ME, password: MP }); ok('master login', m.status === 200, JSON.stringify(m.body)); const mt = m.body.token;
  const co = await api('POST', '/api/master/companies', mt, { name: 'API Test Co', code, emp_prefix: 'APT', admin_name: 'Test Admin', admin_email: code + '@test.com', admin_password: 'secret1', sample_data: true, confirm_password: MP });
  ok('create company (with sample data)', co.status === 200, JSON.stringify(co.body)); const coId = co.body.id;
  const ad = await api('POST', '/api/login', null, { portal: 'admin', identifier: code + '@test.com', password: 'secret1' }); ok('admin login', ad.status === 200 && ad.body.company?.name === 'API Test Co', JSON.stringify(ad.body)); const at = ad.body.token;
  const emp = await api('POST', '/api/login', null, { portal: 'employee', identifier: 'APT005', password: 'welcome123' }); ok('employee login by id', emp.status === 200, JSON.stringify(emp.body)); const et = emp.body.token;
  const hr = (await api('POST', '/api/login', null, { portal: 'employee', identifier: 'APT002', password: 'welcome123' })).body.token;
  const mg = (await api('POST', '/api/login', null, { portal: 'employee', identifier: 'APT003', password: 'welcome123' })).body.token;
  for (const [who, tok, urls] of [
    ['admin', at, ['/api/me', '/api/lookups', '/api/dashboard', '/api/employees', '/api/employees/5', '/api/attendance', '/api/attendance/day', '/api/attendance/overview', '/api/attendance/history', '/api/reports/attendance', '/api/holidays', '/api/leaves?scope=manage', '/api/payroll/runs', '/api/payroll/overview', '/api/jobs', '/api/candidates', '/api/checklists?kind=onboarding', '/api/performance/ranking', '/api/reviews?scope=manage', '/api/expenses?scope=manage', '/api/expenses/all', '/api/expenses/summary', '/api/tickets?scope=manage', '/api/assets', '/api/announcements', '/api/courses', '/api/courses/compliance', '/api/requests?scope=manage', '/api/settings/attendance', '/api/settings/location']],
    ['employee', et, ['/api/me', '/api/dashboard', '/api/employees', '/api/attendance', '/api/attendance/history', '/api/leaves', '/api/leaves/balance', '/api/payslips', '/api/salary-structure', '/api/goals', '/api/reviews', '/api/expenses', '/api/tickets', '/api/assets', '/api/courses', '/api/requests']],
    ['hr', hr, ['/api/dashboard', '/api/payroll/overview', '/api/requests?scope=manage']],
    ['manager', mg, ['/api/dashboard', '/api/leaves?scope=manage', '/api/attendance/day']],
  ]) for (const u of urls) { const r = await api('GET', u, tok); ok(`${who} GET ${u}`, r.status === 200, r.status + ' ' + JSON.stringify(r.body).slice(0, 200)); }

  // punch with geo-fence
  ok('set office location', (await api('PUT', '/api/settings/location', at, { label: 'HQ', lat: 19.076, lng: 72.8777, radius: 100 })).status === 200);
  ok('punch far rejected', (await api('POST', '/api/attendance/checkin', et, { mode: 'office', lat: 19.09, lng: 72.8777, accuracy: 10 })).status === 403);
  const pin = await api('POST', '/api/attendance/checkin', et, { mode: 'office', lat: 19.0763, lng: 72.8778, accuracy: 10 }); ok('punch in near', pin.status === 200 && pin.body.open === true, JSON.stringify(pin.body).slice(0, 200));
  ok('double punch-in rejected', (await api('POST', '/api/attendance/checkin', et, { mode: 'office', lat: 19.0763, lng: 72.8778 })).status === 400);
  const pout = await api('POST', '/api/attendance/checkout', et, { lat: 19.0763, lng: 72.8778, accuracy: 10 }); ok('punch out', pout.status === 200 && pout.body.open === false, JSON.stringify(pout.body).slice(0, 200));
  const hist = await api('GET', '/api/attendance/history', at); ok('history has the punch with distance', hist.body.rows?.some(r => r.in_dist != null && r.in_dist < 100), JSON.stringify(hist.body).slice(0, 300));
  const ov = await api('GET', '/api/attendance/overview', at); ok('overview counts', ov.status === 200 && ov.body.counts.total > 0);
  // leave + requests
  const lk = (await api('GET', '/api/lookups', et)).body; const cl = lk.leaveTypes.find(t => /Casual/.test(t.name));
  const d = new Date(Date.now() + 25 * 864e5); while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1); const ds = d.toISOString().slice(0, 10);
  const lv = await api('POST', '/api/leaves', et, { type_id: cl.id, from_date: ds, to_date: ds, reason: 'test' }); ok('apply leave', lv.status === 200, JSON.stringify(lv.body));
  const pending = (await api('GET', '/api/leaves?scope=manage', mg)).body.find(l => l.reason === 'test'); ok('manager sees leave', !!pending);
  if (pending) ok('manager approves leave', (await api('POST', `/api/leaves/${pending.id}/decide`, mg, { status: 'approved' })).status === 200);
  ok('work type request', (await api('POST', '/api/requests', et, { type: 'work_type', to_work_type: 'Hybrid', worktype_date: ds, reason: 'trial' })).status === 200);
  const rq = (await api('GET', '/api/requests?scope=manage', at)).body.find(r => r.type === 'work_type'); ok('admin sees request', !!rq);
  if (rq) ok('admin approves request', (await api('POST', `/api/requests/${rq.id}/decide`, at, { status: 'approved' })).status === 200);
  // expenses, payroll
  ok('company expense', (await api('POST', '/api/expenses/company', at, { category: 'Rent', amount: 5000, date: ds })).status === 200);
  const sm = await api('GET', '/api/expenses/summary', at); ok('expense summary total', sm.body.company >= 5000, JSON.stringify(sm.body).slice(0, 200));
  const month = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 7);
  const run = await api('POST', '/api/payroll/runs', at, { month }); ok('payroll run', run.status === 200, JSON.stringify(run.body));
  if (run.body.id) { const rd = await api('GET', '/api/payroll/runs/' + run.body.id, at); ok('payroll slips', rd.body.slips?.length > 5, JSON.stringify(rd.body).slice(0, 150)); ok('finalize', (await api('POST', `/api/payroll/runs/${run.body.id}/finalize`, at)).status === 200); }
  // admin-created employee needs password confirmation
  ok('create employee needs password', (await api('POST', '/api/employees', at, { name: 'X', email: 'x@y.com', join_date: ds })).status === 403);
  const ne = await api('POST', '/api/employees', at, { name: 'New Hire', email: 'hire@y.com', join_date: ds, account_type: 'managing', permissions: ['leave'], confirm_password: 'secret1' }); ok('create employee', ne.status === 200 && /^APT/.test(ne.body.emp_code), JSON.stringify(ne.body));
  ok('new employee can log in', (await api('POST', '/api/login', null, { portal: 'employee', identifier: ne.body.emp_code, password: ne.body.password })).status === 200);
  ok('bad id in url is a clean 404', (await api('GET', '/api/employees/abc', at)).status === 404);
  ok('wrong password lockout path', (await api('POST', '/api/login', null, { portal: 'admin', identifier: code + '@test.com', password: 'nope' })).status === 401);
  // cleanup
  const del = await api('DELETE', '/api/master/companies/' + coId, mt, { confirm: code, confirm_password: MP }); ok('delete company', del.status === 200, JSON.stringify(del.body));
  ok('deleted company cannot log in', (await api('POST', '/api/login', null, { portal: 'admin', identifier: code + '@test.com', password: 'secret1' })).status === 401);
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
