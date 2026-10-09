// Attendance correction requests (missed punch / leave entered late / site visit) through the real API. Local SQLite only (reads the company file):
//   BASE=http://localhost:3000 MASTER_EMAIL=... MASTER_PASSWORD=... DATA_DIR=... node test-regularise.js
const { DatabaseSync } = require('node:sqlite'), path = require('path');
const BASE = process.env.BASE || 'http://localhost:3000', ME = process.env.MASTER_EMAIL, MP = process.env.MASTER_PASSWORD, DATA = process.env.DATA_DIR || 'D:/hellohr/data';
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : (fail++, console.log('FAIL', n, x)); };
const api = async (m, u, t, b) => { const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
const addD = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }, wk = s => ![0, 6].includes(new Date(s + 'T00:00:00Z').getUTCDay());
(async () => {
  const code = 'reg' + Math.floor(Math.random() * 1e6), mt = (await api('POST', '/api/login', null, { portal: 'master', identifier: ME, password: MP })).body.token;
  ok('create company', (await api('POST', '/api/master/companies', mt, { name: 'Reg Co', code, emp_prefix: 'REG', admin_name: 'Ada', admin_email: code + '@t.com', admin_password: 'secret1', confirm_password: MP })).status === 200);
  const at = (await api('POST', '/api/login', null, { portal: 'admin', identifier: code + '@t.com', password: 'secret1' })).body.token, PW = { confirm_password: 'secret1' };
  const mk = async (n, e, extra = {}) => (await api('POST', '/api/employees', at, { name: n, email: e, join_date: '2025-01-01', ...extra, ...PW })).body;
  const mgr = await mk('Boss Manager', 'm@t.com', { account_type: 'managing', permissions: ['team', 'leave'] });
  const emp = await mk('Emp Worker', 'e@t.com', { manager_id: mgr.id }), other = await mk('Other Person', 'o@t.com');
  const login = async x => (await api('POST', '/api/login', null, { portal: 'employee', identifier: x.emp_code, password: x.password })).body.token;
  const et = await login(emp), mgrT = await login(mgr), ot = await login(other);
  const t = new Date().toISOString().slice(0, 10), days = []; for (let d = addD(t, -1); days.length < 6; d = addD(d, -1)) if (wk(d)) days.push(d);
  const [d1, d2, d3, d4, d5] = days;
  const db = new DatabaseSync(path.join(DATA, code + '.db'), { readOnly: false });
  // d1: forgot to punch out (open session on a past day -> half day); d2: came at 11:30 by mistake of the punch (late, shows half); the rest: no record
  db.prepare("INSERT INTO punches(emp_id,date,in_time,out_time,mode) VALUES(?,?,?,NULL,'office')").run(emp.id, d1, '09:30:00'); db.prepare("INSERT INTO attendance(emp_id,date,check_in,status,mode,manual) VALUES(?,?,?,'present','office',0)").run(emp.id, d1, '09:30');
  const att = (id, d) => db.prepare('SELECT * FROM attendance WHERE emp_id=? AND date=?').get(id, d);
  const ltypes = (await api('GET', '/api/lookups', et)).body.leaveTypes, cl = ltypes.find(l => l.kind !== 'wfh');

  // ---- missed punch ----
  const bad = async (b, n) => ok(n, (await api('POST', '/api/requests', et, b)).status === 400, JSON.stringify(b));
  await bad({ type: 'missed_punch', date: addD(t, 1), out_time: '18:00', reason: 'x' }, 'future date refused');
  await bad({ type: 'missed_punch', date: d1, reason: 'x' }, 'no times refused');
  await bad({ type: 'missed_punch', date: d1, out_time: '09:00', reason: 'x' }, 'punch-out before punch-in refused');
  await bad({ type: 'missed_punch', date: d1, out_time: '25:99', reason: 'x' }, 'bad time refused');
  await bad({ type: 'missed_punch', date: d2, out_time: '18:30', reason: 'x' }, 'punch-out only, with nothing recorded that day, refused');
  await bad({ type: 'missed_punch', date: addD(t, -200), in_time: '09:00', out_time: '18:00', reason: 'x' }, 'older than 90 days refused');
  await bad({ type: 'missed_punch', date: d1, out_time: '18:30' }, 'reason required');
  const r1 = await api('POST', '/api/requests', et, { type: 'missed_punch', date: d1, out_time: '18:30', reason: 'Forgot to punch out' }); ok('missed punch request sent', r1.status === 200, JSON.stringify(r1.body));
  await bad({ type: 'missed_punch', date: d1, out_time: '18:45', reason: 'again' }, 'a second pending request for the same day refused');
  ok('attendance unchanged until approved', att(emp.id, d1).check_out == null);

  const mine = (await api('GET', '/api/requests', et)).body.filter(r => r.type === 'missed_punch'); ok('employee sees own request', mine.length === 1 && mine[0].status === 'pending' && mine[0].payload.final_out === '18:30');
  const seen = async tok => (await api('GET', '/api/requests?scope=manage', tok)).body.filter(r => r.type === 'missed_punch');
  ok('reporting manager sees it', (await seen(mgrT)).length === 1); ok('admin sees it', (await seen(at)).length === 1); ok('an unrelated employee does not', (await seen(ot)).length === 0);
  const id1 = mine[0].id;
  ok('employee cannot approve own request', (await api('POST', `/api/requests/${id1}/decide`, et, { status: 'approved' })).status === 403);
  ok('unrelated employee cannot approve', (await api('POST', `/api/requests/${id1}/decide`, ot, { status: 'approved' })).status === 403);
  ok('manager approves', (await api('POST', `/api/requests/${id1}/decide`, mgrT, { status: 'approved', note: 'ok' })).status === 200);
  const a1 = att(emp.id, d1); ok('punch-out recorded, day recalculated from 09:30-18:30 (9h = full day)', a1.check_out === '18:30' && a1.status === 'present' && !a1.manual, JSON.stringify(a1));
  ok('punch session closed', db.prepare('SELECT out_time FROM punches WHERE emp_id=? AND date=?').get(emp.id, d1).out_time === '18:30:00');
  ok('the change is in the audit trail', db.prepare('SELECT COUNT(*) c FROM attendance_edits WHERE emp_id=? AND date=?').get(emp.id, d1).c === 1);
  ok('cannot decide twice', (await api('POST', `/api/requests/${id1}/decide`, at, { status: 'rejected' })).status === 400);

  // both times, short day -> half day by the real hours
  const r2 = await api('POST', '/api/requests', et, { type: 'missed_punch', date: d2, in_time: '09:30', out_time: '14:00', reason: 'Left early, forgot to punch' }); ok('both-times request sent', r2.status === 200);
  const id2 = (await api('GET', '/api/requests', et)).body.find(r => r.type === 'missed_punch' && r.payload.date === d2).id;
  await api('POST', `/api/requests/${id2}/decide`, at, { status: 'approved' }); const a2 = att(emp.id, d2); ok('4.5h day becomes a half day', a2 && a2.status === 'half' && a2.check_in === '09:30' && a2.check_out === '14:00', JSON.stringify(a2));

  // rejected request changes nothing
  const r3 = await api('POST', '/api/requests', et, { type: 'missed_punch', date: d3, in_time: '09:00', out_time: '18:00', reason: 'test' }); ok('request for an empty day sent', r3.status === 200);
  const id3 = (await api('GET', '/api/requests', et)).body.find(r => r.type === 'missed_punch' && r.payload.date === d3).id;
  await api('POST', `/api/requests/${id3}/decide`, at, { status: 'rejected', note: 'no proof' }); ok('rejected: nothing changed', att(emp.id, d3) === undefined);

  // ---- leave entered late ----
  await bad({ type: 'leave_regularise', date: d4, type_id: cl.id }, 'reason required for leave');
  await bad({ type: 'leave_regularise', date: addD(t, 2), to_date: addD(t, 2), type_id: cl.id, reason: 'x' }, 'leave in the future refused here');
  await bad({ type: 'leave_regularise', date: d4, to_date: addD(d4, -1), type_id: cl.id, reason: 'x' }, 'end before start refused');
  const r4 = await api('POST', '/api/requests', et, { type: 'leave_regularise', date: d4, to_date: d4, type_id: cl.id, reason: 'Was ill, forgot to apply' }); ok('late leave request sent', r4.status === 200, JSON.stringify(r4.body));
  const id4 = (await api('GET', '/api/requests', et)).body.find(r => r.type === 'leave_regularise').id;
  ok('late leave request visible to the manager', (await api('GET', '/api/requests?scope=manage', mgrT)).body.some(r => r.id === id4));
  ok('admin approves late leave', (await api('POST', `/api/requests/${id4}/decide`, at, { status: 'approved' })).status === 200);
  const lv = db.prepare('SELECT * FROM leaves WHERE emp_id=? AND from_date=?').get(emp.id, d4); ok('approved leave is on record', lv && lv.status === 'approved' && lv.days === 1 && lv.type_id === cl.id, JSON.stringify(lv));
  const day4 = (await api('GET', `/api/leaves/balance?emp_id=${emp.id}`, at)).body.find(b => b.id === cl.id || b.name === cl.name); ok('leave balance reflects it', day4 && day4.balance < day4.days_per_year, JSON.stringify(day4));

  // ---- site visit ----
  await bad({ type: 'visit', date: d5, start_time: '10:00', end_time: '09:00', place: 'Client', reason: 'x' }, 'end before start refused');
  await bad({ type: 'visit', date: d5, start_time: '10:00', end_time: '17:00', reason: 'x' }, 'place required');
  const r5 = await api('POST', '/api/requests', et, { type: 'visit', date: d5, start_time: '10:00', end_time: '17:00', place: 'ACME site, Pune', reason: 'Installation work' }); ok('visit request sent', r5.status === 200, JSON.stringify(r5.body));
  const id5 = (await api('GET', '/api/requests', et)).body.find(r => r.type === 'visit').id;
  ok('manager approves visit', (await api('POST', `/api/requests/${id5}/decide`, mgrT, { status: 'approved' })).status === 200);
  const a5 = att(emp.id, d5); ok('visit day shows present, 10:00-17:00', a5 && a5.status === 'present' && a5.check_in === '10:00' && a5.check_out === '17:00' && a5.manual === 1, JSON.stringify(a5));

  // plain admin accounts and the old request types keep working
  ok('admin cannot raise correction requests', (await api('POST', '/api/requests', at, { type: 'visit', date: d5, start_time: '10:00', end_time: '12:00', place: 'x', reason: 'x' })).status === 403);
  ok('old request types still work', (await api('POST', '/api/requests', et, { type: 'work_type', worktype_date: t, to_work_type: 'Hybrid', reason: 'test' })).status === 200);
  db.close();
  await api('DELETE', '/api/master/companies/' + (await api('GET', '/api/master/companies', mt)).body.find(x => x.code === code).id, mt, { confirm: code, confirm_password: MP });
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
