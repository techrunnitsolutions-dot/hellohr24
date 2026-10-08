// Admin attendance editing:  BASE=... MASTER_EMAIL=... MASTER_PASSWORD=... node test-dayedit.js
const BASE = process.env.BASE || 'http://localhost:3000', ME = process.env.MASTER_EMAIL, MP = process.env.MASTER_PASSWORD;
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : (fail++, console.log('FAIL', n, x)); };
const api = async (m, u, t, b) => { const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
const ymd = d => d.toISOString().slice(0, 10), addD = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const workday = s => ![0, 6].includes(new Date(s + 'T00:00:00Z').getUTCDay());
(async () => {
  const code = 'dayedit' + Math.floor(Math.random() * 1e6);
  const mt = (await api('POST', '/api/login', null, { portal: 'master', identifier: ME, password: MP })).body.token;
  const co = await api('POST', '/api/master/companies', mt, { name: 'Day Edit Co', code, emp_prefix: 'DYE', admin_name: 'Ada', admin_email: code + '@t.com', admin_password: 'secret1', sample_data: true, confirm_password: MP }); ok('create company', co.status === 200);
  const at = (await api('POST', '/api/login', null, { portal: 'admin', identifier: code + '@t.com', password: 'secret1' })).body.token;
  const emp = (await api('POST', '/api/login', null, { portal: 'employee', identifier: 'DYE005', password: 'welcome123' })).body, et = emp.token;
  const mgr = (await api('POST', '/api/login', null, { portal: 'employee', identifier: 'DYE003', password: 'welcome123' })).body.token;
  const eid = emp.user.id, lk = (await api('GET', '/api/lookups', at)).body, cl = lk.leaveTypes.find(t => /Casual/.test(t.name)), lop = lk.leaveTypes.find(t => /Loss/.test(t.name)), wfhT = lk.leaveTypes.find(t => t.kind === 'wfh');
  const today = ymd(new Date()); let d1 = addD(today, -12); while (!workday(d1)) d1 = addD(d1, -1);
  const month = d1.slice(0, 7), cal = async () => (await api('GET', `/api/attendance?month=${month}&emp_id=${eid}`, at)).body, day = async d => (await cal()).days[d];
  const edit = (d, status, extra = {}) => api('POST', '/api/attendance/edit', at, { emp_id: eid, date: d, status, ...extra });

  const start = await day(d1); ok('seeded day has an automatic status', !!start && start.status && start.reason !== 'Set by admin', JSON.stringify(start));
  let r = await edit(d1, 'absent', { note: 'Did not come' }); ok('set a past day to Absent', r.status === 200 && r.body.after.startsWith('absent'), JSON.stringify(r.body));
  let c = await day(d1); ok('calendar shows absent, set by admin', c.status === 'absent' && c.reason === 'Set by admin', JSON.stringify(c));
  ok('half day', (await edit(d1, 'half')).status === 200 && (await day(d1)).status === 'half');
  ok('work from home', (await edit(d1, 'wfh')).status === 200 && (await day(d1)).status === 'wfh');
  ok('present (full day)', (await edit(d1, 'present')).status === 200 && (await day(d1)).status === 'office');
  const bal0 = (await api('GET', '/api/leaves/balance?emp_id=' + eid, at)).body.find(b => b.id === cl.id).used;
  r = await edit(d1, 'leave', { type_id: cl.id }); c = await day(d1); ok('mark leave (casual) on that day', r.status === 200 && c.status === 'leave' && /Casual/.test(c.leave_type), JSON.stringify(c));
  ok('leave balance reflects it', (await api('GET', '/api/leaves/balance?emp_id=' + eid, at)).body.find(b => b.id === cl.id).used === bal0 + 1);
  ok('back to present cancels that leave day', (await edit(d1, 'present')).status === 200 && (await day(d1)).status === 'office' && (await api('GET', '/api/leaves/balance?emp_id=' + eid, at)).body.find(b => b.id === cl.id).used === bal0);
  ok('unpaid leave type (loss of pay)', (await edit(d1, 'leave', { type_id: lop.id })).status === 200 && /Loss/.test((await day(d1)).leave_type));
  ok('back to automatic', (await edit(d1, 'auto')).status === 200);
  c = await day(d1); ok('automatic again (leave day stays until changed, punches decide otherwise)', !!c);
  await edit(d1, 'present');   // leave day cleared, manual present
  ok('automatic removes the manual override', (await edit(d1, 'auto')).status === 200 && (await day(d1)).reason !== 'Set by admin');

  // multi-day leave is split around the edited day
  let a = addD(today, 20); while (!workday(a)) a = addD(a, 1); let b = a, n = 0; while (n < 2) { b = addD(b, 1); if (workday(b)) n++; }   // three working days a..b
  const days3 = []; for (let d = a; d <= b; d = addD(d, 1)) if (workday(d)) days3.push(d);
  const lv = await api('POST', '/api/leaves', et, { type_id: cl.id, from_date: days3[0], to_date: days3[2], reason: 'trip' }); ok('employee applies 3-day leave', lv.status === 200 && lv.body.days === 3, JSON.stringify(lv.body));
  const pend = (await api('GET', '/api/leaves?scope=manage', mgr)).body.find(l => l.reason === 'trip'); await api('POST', `/api/leaves/${pend.id}/decide`, mgr, { status: 'approved' });
  ok('middle day edited to present', (await edit(days3[1], 'present')).status === 200);
  const mine = (await api('GET', '/api/leaves?scope=manage', at)).body.filter(l => l.emp_id === eid && l.status === 'approved' && l.reason === 'trip');
  ok('leave split into two approved parts of one day each', mine.length === 2 && mine.every(l => l.days === 1) && mine.some(l => l.from_date === days3[0]) && mine.some(l => l.from_date === days3[2]), JSON.stringify(mine.map(l => [l.from_date, l.to_date, l.days])));
  const cm = (await api('GET', `/api/attendance?month=${days3[0].slice(0, 7)}&emp_id=${eid}`, at)).body.days; ok('first and last day still leave, middle present', cm[days3[0]]?.status === 'leave' && cm[days3[2]]?.status === 'leave' && cm[days3[1]]?.status === 'office', JSON.stringify([days3.map(d => cm[d]?.status)]));

  // validation + permissions
  let sat = d1; while (workday(sat)) sat = addD(sat, 1);
  ok('leave on a weekend refused', (await edit(sat, 'leave', { type_id: cl.id })).status === 400);
  ok('present on a weekend (worked) allowed', (await edit(sat, 'present')).status === 200 && (await day(sat)).status === 'office');
  ok('wfh is not a leave type', (await edit(d1, 'leave', { type_id: wfhT.id })).status === 400);
  ok('unknown status refused', (await edit(d1, 'holiday')).status === 400);
  ok('before joining refused', (await edit('2019-01-02', 'present')).status === 400);
  ok('too far in the future refused', (await edit(addD(today, 800), 'present')).status === 400);
  ok('admin accounts have no attendance', (await api('POST', '/api/attendance/edit', at, { emp_id: (await api('GET', '/api/me', at)).body.id, date: d1, status: 'present' })).status === 400);
  ok('an employee cannot edit attendance', (await api('POST', '/api/attendance/edit', et, { emp_id: eid, date: d1, status: 'present' })).status === 403);
  ok('a manager (team access only) cannot edit attendance', (await api('POST', '/api/attendance/edit', mgr, { emp_id: eid, date: d1, status: 'present' })).status === 403);

  // payroll follows the edit
  let d2 = addD(today, -3); while (!workday(d2)) d2 = addD(d2, -1); const pm = d2.slice(0, 7);
  await edit(d2, 'present'); const p1 = (await api('GET', '/api/payroll/overview?month=' + pm, at)).body.rows.find(x => x.emp_id === eid);
  await edit(d2, 'absent'); const p2 = (await api('GET', '/api/payroll/overview?month=' + pm, at)).body.rows.find(x => x.emp_id === eid);
  ok('payroll: marking a day absent adds a loss-of-pay day and lowers net pay', p2.lop_days === p1.lop_days + 1 && p2.net < p1.net, JSON.stringify([p1.lop_days, p2.lop_days, p1.net, p2.net]));
  await edit(d2, 'half'); const p3 = (await api('GET', '/api/payroll/overview?month=' + pm, at)).body.rows.find(x => x.emp_id === eid); ok('payroll: half day = half a day of LOP', Math.abs(p3.lop_days - (p1.lop_days + 0.5)) < 1e-9, JSON.stringify([p1.lop_days, p3.lop_days]));

  // audit trail
  const log = (await api('GET', '/api/attendance/edits?emp_id=' + eid, at)).body; ok('every change is logged with who/when/before/after', log.length >= 15 && log.every(x => x.by_name && x.at && x.before_text && x.after_text), JSON.stringify(log[0]));
  ok('log is admin-only', (await api('GET', '/api/attendance/edits?emp_id=' + eid, et)).status === 403);
  ok('the old company-attendance dropdown still works (mark)', (await api('POST', '/api/attendance/mark', at, { emp_id: eid, date: d1, status: 'half' })).status === 200 && (await day(d1)).status === 'half');
  ok('cleanup', (await api('DELETE', `/api/master/companies/${co.body.id}`, mt, { confirm: code, confirm_password: MP })).status === 200);
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
