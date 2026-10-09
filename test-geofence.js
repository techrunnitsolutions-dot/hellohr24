// Per-employee geo-fencing switch through the real API:  BASE=http://localhost:3000 MASTER_EMAIL=... MASTER_PASSWORD=... node test-geofence.js
const BASE = process.env.BASE || 'http://localhost:3000', ME = process.env.MASTER_EMAIL, MP = process.env.MASTER_PASSWORD;
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : (fail++, console.log('FAIL', n, x)); };
const api = async (m, u, t, b) => { const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
(async () => {
  const code = 'geo' + Math.floor(Math.random() * 1e6), mt = (await api('POST', '/api/login', null, { portal: 'master', identifier: ME, password: MP })).body.token;
  await api('POST', '/api/master/companies', mt, { name: 'Geo Co', code, emp_prefix: 'GEO', admin_name: 'Ada', admin_email: code + '@t.com', admin_password: 'secret1', confirm_password: MP });
  const at = (await api('POST', '/api/login', null, { portal: 'admin', identifier: code + '@t.com', password: 'secret1' })).body.token, PW = { confirm_password: 'secret1' };
  const mk = async (n, e, x = {}) => (await api('POST', '/api/employees', at, { name: n, email: e, join_date: '2025-01-01', ...x, ...PW })).body;
  const a = await mk('Strict', 's@t.com'), b = await mk('Roamer', 'r@t.com', { punch_anywhere: true });
  const login = async x => (await api('POST', '/api/login', null, { portal: 'employee', identifier: x.emp_code, password: x.password })).body.token;
  const at1 = await login(a), bt = await login(b), FAR = { mode: 'office', lat: 19.2, lng: 72.9, accuracy: 10 }, NEAR = { mode: 'office', lat: 19.0763, lng: 72.8778, accuracy: 10 };
  await api('PUT', '/api/settings/location', at, { label: 'HQ', lat: 19.076, lng: 72.8777, radius: 100 });
  ok('created with the switch ON: shown on the details', (await api('GET', '/api/employees/' + b.id, at)).body.geo_exempt === 1);
  ok('created without it: OFF', (await api('GET', '/api/employees/' + a.id, at)).body.geo_exempt === 0);
  ok('OFF employee far from office is refused', (await api('POST', '/api/attendance/checkin', at1, FAR)).status === 403);
  ok('ON employee can punch in from anywhere', (await api('POST', '/api/attendance/checkin', bt, FAR)).status === 200);
  ok('ON employee can punch out from anywhere', (await api('POST', '/api/attendance/checkout', bt, FAR)).status === 200);
  // flip them with the switch
  ok('admin switches the strict one ON', (await api('POST', `/api/employees/${a.id}/geofence`, at, { punch_anywhere: true })).body.punch_anywhere === true);
  ok('now they can punch in from anywhere', (await api('POST', '/api/attendance/checkin', at1, FAR)).status === 200);
  await api('POST', '/api/attendance/checkout', at1, FAR);
  ok('admin switches the roamer OFF', (await api('POST', `/api/employees/${b.id}/geofence`, at, { punch_anywhere: false })).body.punch_anywhere === false);
  ok('the roamer now has to be at the office', (await api('POST', '/api/attendance/checkin', bt, FAR)).status === 403);
  ok('...and can punch when at the office', (await api('POST', '/api/attendance/checkin', bt, NEAR)).status === 200);
  // via the edit form
  ok('edit form can switch it ON', (await api('PUT', '/api/employees/' + b.id, at, { punch_anywhere: true })).status === 200 && (await api('GET', '/api/employees/' + b.id, at)).body.geo_exempt === 1);
  ok('edit form can switch it OFF', (await api('PUT', '/api/employees/' + b.id, at, { punch_anywhere: false })).status === 200 && (await api('GET', '/api/employees/' + b.id, at)).body.geo_exempt === 0);
  // still consistent with the Office location page list
  await api('POST', `/api/employees/${a.id}/geofence`, at, { punch_anywhere: true });
  ok('office-location exemption list agrees', (await api('GET', '/api/settings/location', at)).body.exempt.includes(a.id));
  // permissions
  ok('an employee cannot flip it for themselves', (await api('POST', `/api/employees/${b.id}/geofence`, bt, { punch_anywhere: true })).status === 403);
  ok('an employee cannot use the edit route for it', (await api('PUT', '/api/employees/' + b.id, bt, { punch_anywhere: true })).status === 403 || (await api('GET', '/api/employees/' + b.id, at)).body.geo_exempt === 0);
  const me = (await api('GET', '/api/attendance/punch-state', bt)).status; // route may not exist; ignore status, just make sure nothing crashed
  ok('admin accounts cannot be switched', (await api('POST', `/api/employees/1/geofence`, at, { punch_anywhere: true })).status === 400);
  await api('DELETE', '/api/master/companies/' + (await api('GET', '/api/master/companies', mt)).body.find(x => x.code === code).id, mt, { confirm: code, confirm_password: MP });
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
