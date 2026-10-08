const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { all, get, run, tx, hash, verify, M, ctx, inCompany, dropTenant, deleteTenant, tenantExists, IS_PG, queries } = require('./db');
const AE = require('./attendance-engine');
const CO_COLS = 'id,code,name,db_file,status,created,admin_email,emp_prefix,logo_v';   // everything except the (large) logo image
const { seedDemo, seedBasics, normalizeRoles, ensureLeaveTypes, PERMS } = require('./seed');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');

// ---------- helpers ----------
const iso = d => d.toISOString().slice(0, 10);
const TZ = process.env.APP_TZ || 'Asia/Kolkata';
const tzFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const tzNow = () => { const o = {}; for (const p of tzFmt.formatToParts(new Date())) o[p.type] = p.value; return o; };
const todayStr = () => { const o = tzNow(); return `${o.year}-${o.month}-${o.day}`; };
const nowTime = () => { const o = tzNow(); return `${o.hour}:${o.minute}`; };
const utc = s => new Date(s + 'T00:00:00Z');
// ---- automatic attendance engine (the rules themselves live in attendance-engine.js) ----
const toMin = AE.toMin, fmtMin = AE.fmtMin;
const nowSec = () => { const o = tzNow(); return `${o.hour}:${o.minute}:${o.second}`; };
const attCfg = () => AE.normCfg(Object.fromEntries(all('SELECT key,value FROM settings').map(x => [x.key, x.value])));
const hrs1 = m => Math.round(m / 6) / 10;
function monthMap(empId, month, cfg, nowS = nowSec(), todayS = todayStr()) {
  const recs = all('SELECT * FROM attendance WHERE emp_id=? AND substr(date,1,7)=? ORDER BY date', empId, month), pb = {};
  for (const p of all('SELECT * FROM punches WHERE emp_id=? AND substr(date,1,7)=? ORDER BY id', empId, month)) (pb[p.date] ||= []).push(p);
  return { ...AE.monthWalk(recs, pb, cfg, nowS, todayS), recs, pb };
}
const toStored = st => st === 'office' ? 'present' : st;
function dayStatus(empId, date, cfg, work) {
  const rec = get('SELECT * FROM attendance WHERE emp_id=? AND date=?', empId, date);
  const cover = kind => get(`SELECT t.name FROM leaves l JOIN leave_types t ON t.id=l.type_id WHERE l.emp_id=? AND l.status='approved' AND l.from_date<=? AND l.to_date>=? AND ${kind}`, empId, date, date);
  const lv = cover("t.kind!='wfh'"), wfh = !rec && work ? cover("t.kind='wfh'") : null;
  const dv = rec ? monthMap(empId, date.slice(0, 7), cfg).days[date] : !work ? (lv ? { status: 'leave' } : { status: 'off' }) : wfh ? { status: 'wfh', reason: 'Approved work from home' } : lv ? { status: 'leave' } : AE.derive(null, date, cfg, undefined, [], nowSec(), todayStr());
  return { status: dv.status, reason: dv.reason || null, late: !!dv.late, in_progress: !!dv.in_progress, manual: !!rec?.manual, leave_type: lv?.name || null, check_in: rec?.check_in || null, check_out: rec?.check_out || null, hours: dv.minutes ? hrs1(dv.minutes) : null, worked_min: dv.minutes || 0, mode: rec?.mode || null };
}
// Everything the employee dashboard punch widget needs.
function buildPunch(empId) {
  const today = todayStr(), cfg = attCfg(), nowS = nowSec(), mm = monthMap(empId, today.slice(0, 7), cfg, nowS, today);
  const rec = mm.recs.find(r => r.date === today) || null, sess = mm.pb[today] || [], open = AE.isOpen(rec, sess), d = rec ? mm.days[today] : null;
  const before = mm.before[today] || { ...mm.ctx };
  const proj = rec && open ? AE.projectNow(rec, sess, today, cfg, before, nowS, today) : null;
  const emp = get('SELECT work_type FROM employees WHERE id=?', empId);
  const wfhToday = get("SELECT 1 x FROM leaves l JOIN leave_types t ON t.id=l.type_id WHERE l.emp_id=? AND l.status='approved' AND t.kind='wfh' AND l.from_date<=? AND l.to_date>=?", empId, today, today);
  const counts = { present: 0, wfh: 0, half: 0, absent: 0, minutes: 0 };
  for (const x of Object.values(mm.days)) { if (x.status === 'office') counts.present++; else if (x.status === 'wfh') counts.wfh++; else if (x.status === 'half') counts.half++; else if (x.status === 'absent') counts.absent++; counts.minutes += x.minutes || 0; }
  return {
    open, worked_secs: rec ? AE.workedSecs(rec, sess, today, nowS, today) : 0, first_in: rec?.check_in || null, last_out: rec && !open ? rec.check_out : null,
    sessions: sess.length ? sess.map(s => ({ in: s.in_time.slice(0, 5), out: s.out_time ? s.out_time.slice(0, 5) : null })) : rec ? [{ in: rec.check_in, out: rec.check_out }] : [],
    status: d?.status || null, reason: d?.reason || null, late: !!d?.late, in_progress: !!d?.in_progress, projected: proj ? { status: proj.status, reason: proj.reason } : null,
    allowance: { short_used: mm.ctx.short_used, late_used: mm.ctx.late_used, limit: cfg.allowance_days }, workday: isWorkday(today, holidaySet()),
    geo: geoInfo(empId), open_mode: (sess.find(x => !x.out_time) || {}).mode || rec?.mode || 'office',
    default_mode: wfhToday || emp?.work_type === 'Work from home' ? 'wfh' : 'office', cfg, month: { ...counts, hours: Math.round(counts.minutes / 60) },
  };
}
const addDays = (s, n) => { const d = utc(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const round = n => Math.round(n * 100) / 100;
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (msg, code = 400) => { throw new HttpError(code, msg); };
const parsePerms = p => { try { return JSON.parse(p || '[]'); } catch { return []; } };
const can = (u, k) => u.role === 'admin' || (u.perms || []).includes(k);
const isStaff = u => u.role === 'admin' || (u.perms || []).some(p => p !== 'team');
const need = (cond, msg = 'Forbidden') => { if (!cond) bad(msg, 403); };
const req_ = (b, ...f) => f.forEach(k => { if (b[k] === undefined || b[k] === null || b[k] === '') bad(`${k} is required`); });
const holidaySet = () => new Set(all('SELECT date FROM holidays').map(h => h.date));
const isWorkday = (ds, hols) => { const w = utc(ds).getUTCDay(); return w !== 0 && w !== 6 && !hols.has(ds); };
const workdaysBetween = (from, to) => {
  const hols = holidaySet(); let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkday(d, hols)) n++;
  return n;
};
const teamIds = u => can(u, 'team') ? all('SELECT id FROM employees WHERE manager_id=?', u.id).map(e => e.id) : [];
const canSee = (u, empId, key = 'employees') => u.id === empId || can(u, 'employees') || can(u, key) || teamIds(u).includes(empId);
const publicEmp = e => { if (!e) return e; const { password_hash, permissions, ...rest } = e; rest.perms = parsePerms(permissions); return rest; };
const EMP_SQL = `SELECT e.*, d.name dept, m.name manager FROM employees e
  LEFT JOIN departments d ON d.id=e.dept_id LEFT JOIN employees m ON m.id=e.manager_id`;

function nextEmpCode() {
  const p = ctx().company.emp_prefix || 'HH';
  const r = get('SELECT MAX(CAST(SUBSTR(emp_code,?) AS INTEGER)) m FROM employees WHERE emp_code LIKE ?', p.length + 1, p + '%');
  return p + String((r.m || 0) + 1).padStart(3, '0');
}

// ---------- payroll math (India, simplified; estimates only) ----------
function annualTax(ctc) {
  const taxable = Math.max(0, ctc - 75000);
  const slabs = [[400000, 0], [800000, .05], [1200000, .10], [1600000, .15], [2000000, .20], [2400000, .25], [Infinity, .30]];
  let tax = 0, prev = 0;
  for (const [lim, r] of slabs) { if (taxable > prev) tax += (Math.min(taxable, lim) - prev) * r; prev = lim; }
  if (taxable <= 1200000) tax = 0; // 87A rebate
  return tax * 1.04;
}
function structure(ctc) {
  const gross = ctc / 12, basic = gross * 0.4, hra = basic * 0.5, special = gross - basic - hra;
  return { gross, basic, hra, special };
}
function buildPayslip(emp, month) {
  const first = month + '-01';
  const last = iso(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)));
  const hols = holidaySet(), today = todayStr();
  const cfg = attCfg();
  const mm = monthMap(emp.id, month, cfg);
  const leaves = all(`SELECT l.from_date,l.to_date,t.is_paid FROM leaves l JOIN leave_types t ON t.id=l.type_id
    WHERE l.emp_id=? AND l.status='approved' AND l.from_date<=? AND l.to_date>=?`, emp.id, last, first);
  let working = 0, lop = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    if (!isWorkday(d, hols)) continue;
    working++;
    if (d < emp.join_date) { lop++; continue; }
    if (emp.exit_date && d > emp.exit_date) { lop++; continue; }
    if (d > today) continue;
    const dv = (mm.days[d] || AE.derive(null, d, cfg, undefined, [], nowSec(), today)).status;
    if (dv === 'pending' || dv === 'office' || dv === 'wfh') continue;
    if (dv === 'half') { lop += 0.5; continue; }
    const lv = leaves.find(l => l.from_date <= d && l.to_date >= d);
    if (lv && lv.is_paid) continue;
    lop++;
  }
  const s = structure(emp.ctc), ratio = working ? (working - lop) / working : 0;
  const basic = s.basic * ratio, hra = s.hra * ratio, special = s.special * ratio, gross = basic + hra + special;
  const pf = Math.min(basic, 15000) * 0.12;
  const pt = gross > 15000 ? 200 : 0;
  const tds = annualTax(emp.ctc) / 12 * ratio;
  const reimb = get("SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE emp_id=? AND status='approved' AND reimbursed_run IS NULL", emp.id).s;
  const deductions = pf + pt + tds;
  return { emp_id: emp.id, month, working_days: working, paid_days: working - lop, lop_days: lop,
    basic: round(basic), hra: round(hra), special: round(special), gross: round(gross),
    pf: round(pf), pt: round(pt), tds: round(tds), reimbursements: round(reimb),
    deductions: round(deductions), net: round(gross - deductions + reimb) };
}

// ---------- leave helpers ----------
function leaveBalance(empId, year = +todayStr().slice(0, 4)) {
  return all("SELECT * FROM leave_types WHERE kind!='wfh' ORDER BY id").map(t => {
    const used = get(`SELECT COALESCE(SUM(days),0) s FROM leaves WHERE emp_id=? AND type_id=? AND status='approved' AND substr(from_date,1,4)=?`, empId, t.id, String(year)).s;
    const pending = get(`SELECT COALESCE(SUM(days),0) s FROM leaves WHERE emp_id=? AND type_id=? AND status='pending' AND substr(from_date,1,4)=?`, empId, t.id, String(year)).s;
    return { ...t, used, pending, balance: t.days_per_year ? t.days_per_year - used - pending : null };
  });
}

// ---------- routes ----------
const routes = [];
const route = (method, p, handler, opts = {}) =>
  routes.push({ method, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, public: opts.public, master: opts.master, any: opts.any });

// auth
const fails = new Map();
const throttle = key => { const n = Date.now(), f = (fails.get(key) || []).filter(t => n - t < 9e5); fails.set(key, f); if (f.length >= 10) bad('Too many failed attempts. Try again in 15 minutes.', 429); };
// Sensitive actions (creating/deleting accounts, credentials) must be re-confirmed with the acting user's own password.
function confirmPw(user, body) {
  if (!body || !body.confirm_password) bad('Enter your password to confirm this action', 403);
  const key = 'confirm:' + user.role + ':' + user.id; throttle(key);
  const row = user.role === 'master' ? M.get('SELECT password_hash h FROM masters WHERE id=?', user.id) : get('SELECT password_hash h FROM employees WHERE id=?', user.id);
  if (!row || !verify(String(body.confirm_password), row.h)) { fails.set(key, [...(fails.get(key) || []), Date.now()]); bad('Your password is incorrect', 403); }
  fails.delete(key);
}
route('POST', '/api/login', ({ body }) => {
  req_(body, 'identifier', 'password');
  const portal = body.portal, id = String(body.identifier).trim(), key = portal + ':' + id.toLowerCase();
  throttle(key);
  const fail = (msg = 'Invalid credentials', code = 401) => { fails.set(key, [...(fails.get(key) || []), Date.now()]); bad(msg, code); };
  const token = crypto.randomBytes(24).toString('hex'), now = new Date().toISOString();
  if (portal === 'master') {
    const m = M.get('SELECT * FROM masters WHERE lower(email)=lower(?)', id);
    if (!m || !verify(body.password, m.password_hash)) fail();
    M.run('INSERT INTO sessions(token,master_id,created) VALUES(?,?,?)', token, m.id, now); fails.delete(key);
    return { token, user: { id: m.id, name: m.name, email: m.email, role: 'master' } };
  }
  let c;
  if (portal === 'admin') c = M.get('SELECT ' + CO_COLS + ' FROM companies WHERE lower(admin_email)=lower(?)', id);
  else if (portal === 'employee') { const m = /^([A-Za-z]+)(\d+)$/.exec(id); c = m && M.get('SELECT ' + CO_COLS + ' FROM companies WHERE upper(emp_prefix)=upper(?)', m[1]); }
  else bad('Unknown login portal');
  if (!c) fail();
  return inCompany(c, () => {
    const e = portal === 'admin' ? get("SELECT * FROM employees WHERE lower(email)=lower(?) AND role='admin'", id) : get("SELECT * FROM employees WHERE upper(emp_code)=upper(?) AND role!='admin'", id);
    if (!e || !verify(body.password, e.password_hash)) fail();
    if (c.status !== 'active') fail('This company account is suspended. Contact the platform owner.', 403);
    if (e.status === 'exited') fail('This account has been deactivated', 403);
    M.run('INSERT INTO sessions(token,company_id,emp_id,created) VALUES(?,?,?,?)', token, c.id, e.id, now); fails.delete(key);
    return { token, user: publicEmp(e), company: { name: c.name, code: c.code, logo_v: c.logo_v || null } };
  });
}, { public: true });
route('POST', '/api/logout', ({ token }) => { M.run('DELETE FROM sessions WHERE token=?', token); return { ok: true }; }, { any: true });
route('GET', '/api/me', ({ user }) => {
  if (user.role === 'master') return user;
  const c = ctx().company; return { ...publicEmp(get(EMP_SQL + ' WHERE e.id=?', user.id)), photo_id: get("SELECT id FROM documents WHERE emp_id=? AND doc_type='profile_photo'", user.id)?.id || null, company: { name: c.name, code: c.code, logo_v: c.logo_v || null } };
}, { any: true });
route('POST', '/api/change-password', ({ user, body }) => {
  req_(body, 'current', 'next');
  if (body.next.length < 6) bad('New password must be at least 6 characters');
  const e = get('SELECT * FROM employees WHERE id=?', user.id);
  if (!verify(body.current, e.password_hash)) bad('Current password is incorrect');
  run('UPDATE employees SET password_hash=? WHERE id=?', hash(body.next), user.id);
  return { ok: true };
});

// lookups & dashboard
route('GET', '/api/lookups', () => ({
  departments: all('SELECT * FROM departments ORDER BY name'),
  leaveTypes: all('SELECT * FROM leave_types ORDER BY id'),
  employees: all("SELECT id,emp_code,name,role,designation FROM employees WHERE status!='exited' ORDER BY name"),
}));
route('GET', '/api/dashboard', ({ user }) => {
  const today = todayStr(), month = today.slice(0, 7), out = {};
  out.announcements = all('SELECT a.*, e.name author FROM announcements a LEFT JOIN employees e ON e.id=a.author_id ORDER BY a.id DESC LIMIT 5');
  out.holidays = all('SELECT * FROM holidays WHERE date>=? ORDER BY date LIMIT 4', today);
  { const pu = buildPunch(user.id); out.punch = pu; out.today = pu.first_in ? { status: toStored(pu.status), check_in: pu.first_in, check_out: pu.last_out } : null; out.monthSummary = pu.month; }
  out.balances = leaveBalance(user.id);
  out.pendingRequests = reviewableRequests(user).filter(r => r.status === 'pending').length;
  if (user.role !== 'admin') out.profilePct = completion(getProfile(user.id), docList(user.id)).pct;
  out.policies = { attendance: attCfg(), leaveTypes: all('SELECT name,days_per_year,is_paid,kind FROM leave_types ORDER BY id') };
  out.birthdays = all(`SELECT name, dob FROM employees WHERE status!='exited' AND dob IS NOT NULL AND substr(dob,6,2)=?`, today.slice(5, 7));
  out.myGoals = all("SELECT * FROM goals WHERE emp_id=? AND status='active'", user.id);
  out.myCourses = all('SELECT c.title, en.progress FROM enrollments en JOIN courses c ON c.id=en.course_id WHERE en.emp_id=?', user.id);
  if (isStaff(user)) {
    out.stats = {
      headcount: get("SELECT COUNT(*) c FROM employees WHERE status!='exited'").c,
      present: get('SELECT COUNT(*) c FROM attendance WHERE date=?', today).c,
      onLeave: get("SELECT COUNT(*) c FROM leaves l JOIN leave_types t ON t.id=l.type_id WHERE l.status='approved' AND t.kind!='wfh' AND l.from_date<=? AND l.to_date>=?", today, today).c,
      pendingLeaves: get("SELECT COUNT(*) c FROM leaves WHERE status='pending'").c,
      pendingExpenses: get("SELECT COUNT(*) c FROM expenses WHERE status='pending'").c,
      openTickets: get("SELECT COUNT(*) c FROM tickets WHERE status!='closed'").c,
      openJobs: get("SELECT COUNT(*) c FROM jobs WHERE status='open'").c,
      newJoiners: get("SELECT COUNT(*) c FROM employees WHERE join_date LIKE ?", month + '%').c,
    };
    out.byDept = all("SELECT d.name, COUNT(e.id) c FROM departments d LEFT JOIN employees e ON e.dept_id=d.id AND e.status!='exited' GROUP BY d.id ORDER BY c DESC");
  } else if (can(user, 'team')) {
    const ids = teamIds(user);
    out.stats = { teamSize: ids.length, pendingLeaves: ids.length ? get(`SELECT COUNT(*) c FROM leaves WHERE status='pending' AND emp_id IN (${ids.join(',')})`).c : 0,
      pendingExpenses: ids.length ? get(`SELECT COUNT(*) c FROM expenses WHERE status='pending' AND emp_id IN (${ids.join(',')})`).c : 0 };
  }
  return out;
});

// departments
route('POST', '/api/departments', ({ user, body }) => { need(can(user, 'settings')); req_(body, 'name'); try { run('INSERT INTO departments(name) VALUES(?)', body.name.trim()); } catch { bad('Department already exists'); } return { ok: true }; });
route('DELETE', '/api/departments/:id', ({ user, params }) => {
  need(can(user, 'settings'));
  if (get('SELECT COUNT(*) c FROM employees WHERE dept_id=?', params.id).c) bad('Department has employees; reassign them first');
  run('DELETE FROM departments WHERE id=?', params.id); return { ok: true };
});

// employees
const SENSITIVE = ['ctc', 'pan', 'bank_account', 'address', 'dob', 'exit_reason', 'gender'];
const without = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
function shape(user, e, team) {
  if (!(e.id === user.id || can(user, 'employees') || team.has(e.id))) return without(e, SENSITIVE);
  return e.id === user.id || can(user, 'payroll') ? e : without(e, ['ctc']);
}
route('GET', '/api/employees', ({ user, query }) => {
  const team = new Set(teamIds(user));
  const live = can(user, 'attendance'), cfg = live && attCfg(), work = isWorkday(todayStr(), holidaySet()), profPct = can(user, 'employees') ? profileCompletionMap() : null;
  return all(EMP_SQL + ' ORDER BY e.emp_code').map(publicEmp).map(e => shape(user, e, team)).filter(e => !query.status || e.status === query.status)
    .map(e => live && e.status !== 'exited' && e.role !== 'admin' ? { ...e, today: dayStatus(e.id, todayStr(), cfg, work) } : e)
    .map(e => profPct ? { ...e, profile_pct: profPct(e.id) } : e);
});
route('GET', '/api/employees/:id', ({ user, params }) => {
  const e = get(EMP_SQL + ' WHERE e.id=?', params.id); if (!e) bad('Not found', 404);
  const pub = shape(user, publicEmp(e), new Set(teamIds(user)));
  const assets = pub.pan !== undefined ? all('SELECT * FROM assets WHERE assigned_to=?', e.id) : [];
  if (can(user, 'attendance') && e.role !== 'admin' && e.status !== 'exited') pub.today = dayStatus(e.id, todayStr(), attCfg(), isWorkday(todayStr(), holidaySet()));
  if (user.id === e.id || canReviewReq(user, e.id)) { pub.requests = all(REQ_SQL + ' WHERE r.emp_id=? ORDER BY r.id DESC', e.id).map(parseReq); pub.requests_can_decide = canReviewReq(user, e.id); }
  return { ...pub, assets, reports: all('SELECT id,name,designation FROM employees WHERE manager_id=?', e.id) };
});

// account type: "employee" (normal) or "managing" (chosen permissions)
function parseAccess(body) {
  if (body.account_type !== 'managing') return { role: 'employee', permissions: null };
  const perms = [...new Set(Array.isArray(body.permissions) ? body.permissions : [])];
  if (perms.some(p => !PERMS.includes(p))) bad('Unknown permission');
  if (!perms.length) bad('Pick at least one thing this person can manage, or make them a normal employee');
  return { role: 'manager', permissions: JSON.stringify(perms) };
}
function createEmployee(body) {
  req_(body, 'name', 'email', 'join_date');
  const acc = parseAccess(body);
  if (get('SELECT id FROM employees WHERE lower(email)=lower(?)', body.email)) bad('Email already in use');
  const pw = body.password || 'welcome123';
  const id = tx(() => {
    const r = run(`INSERT INTO employees(emp_code,name,email,password_hash,role,permissions,phone,dept_id,designation,manager_id,join_date,gender,dob,address,ctc,pan,bank_account,location,employment_type)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, nextEmpCode(), body.name, body.email, hash(pw), acc.role, acc.permissions, body.phone, body.dept_id || null,
      body.designation, body.manager_id || null, body.join_date, body.gender, body.dob, body.address, +body.ctc || 0, body.pan, body.bank_account, body.location, body.employment_type || 'Full-time');
    const eid = r.lastInsertRowid;
    ['Collect signed offer letter & ID proofs', 'Create email & system accounts', 'Issue laptop & access card', 'Complete HR induction', 'Assign buddy / reporting manager intro', 'Enroll in mandatory training']
      .forEach(t => run('INSERT INTO checklists(emp_id,kind,title) VALUES(?,?,?)', eid, 'onboarding', t));
    all('SELECT id FROM courses WHERE mandatory=1').forEach(c => run('INSERT OR IGNORE INTO enrollments(emp_id,course_id) VALUES(?,?)', eid, c.id));
    return eid;
  });
  return { id, password: pw, emp_code: get('SELECT emp_code FROM employees WHERE id=?', id).emp_code };
}
route('POST', '/api/employees', ({ user, body }) => {
  need(user.role === 'admin', 'Only the company admin (or the master) can create employee accounts');
  confirmPw(user, body);
  return createEmployee(body);
});
route('PUT', '/api/employees/:id', ({ user, params, body }) => {
  const id = +params.id; const e = get('SELECT * FROM employees WHERE id=?', id); if (!e) bad('Not found', 404);
  const isAdm = user.role === 'admin';
  if (isAdm || can(user, 'employees')) {
    if (e.role === 'admin' && !isAdm) bad('Only the admin can edit the admin account', 403);
    if (isAdm && e.role !== 'admin' && 'account_type' in body) {
      const acc = parseAccess(body), norm = p => JSON.stringify(parsePerms(p).sort());
      if (acc.role !== e.role || norm(acc.permissions) !== norm(e.permissions)) confirmPw(user, body);
    }
    if (isAdm && body.password) confirmPw(user, body);
    const f = ['name', 'phone', 'dept_id', 'designation', 'manager_id', 'join_date', 'gender', 'dob', 'address', 'pan', 'bank_account', 'location', 'employment_type', 'work_type'];
    if (isAdm) f.push('email');
    if (can(user, 'payroll')) f.push('ctc');
    if (isAdm && body.email && body.email !== e.email && get('SELECT id FROM employees WHERE lower(email)=lower(?) AND id!=?', body.email, id)) bad('Email already in use');
    if (body.manager_id && +body.manager_id === id) bad('An employee cannot report to themselves');
    const upd = f.filter(k => k in body);
    if (upd.length) run(`UPDATE employees SET ${upd.map(k => k + '=?').join(',')} WHERE id=?`, ...upd.map(k => k === 'ctc' ? +body[k] || 0 : (body[k] === '' ? null : body[k])), id);
    if (isAdm && e.role !== 'admin' && 'account_type' in body) { const acc = parseAccess(body); run('UPDATE employees SET role=?, permissions=? WHERE id=?', acc.role, acc.permissions, id); }
    if (isAdm && body.password) run('UPDATE employees SET password_hash=? WHERE id=?', hash(body.password), id);
  } else {
    need(user.id === id);
    const f = ['phone', 'address', 'bank_account', 'dob', 'gender'].filter(k => k in body);
    if (f.length) run(`UPDATE employees SET ${f.map(k => k + '=?').join(',')} WHERE id=?`, ...f.map(k => body[k]), id);
  }
  return { ok: true };
});
route('POST', '/api/employees/:id/offboard', ({ user, params, body }) => {
  need(can(user, 'onboarding')); req_(body, 'exit_date');
  const e = get('SELECT * FROM employees WHERE id=?', params.id); if (!e) bad('Not found', 404);
  if (e.role === 'admin') bad('Cannot offboard admin');
  tx(() => {
    run("UPDATE employees SET status='notice', exit_date=?, exit_reason=? WHERE id=?", body.exit_date, body.reason, e.id);
    if (!get("SELECT id FROM checklists WHERE emp_id=? AND kind='offboarding'", e.id))
      ['Accept resignation & confirm last working day', 'Knowledge transfer', 'Return laptop & assets', 'Revoke system access', 'Exit interview', 'Full & Final settlement']
        .forEach(t => run('INSERT INTO checklists(emp_id,kind,title) VALUES(?,?,?)', e.id, 'offboarding', t));
  });
  return { ok: true };
});
route('POST', '/api/employees/:id/exit', ({ user, params, body }) => {
  need(can(user, 'onboarding'));
  confirmPw(user, body);
  const open = get("SELECT COUNT(*) c FROM checklists WHERE emp_id=? AND kind='offboarding' AND done=0", params.id).c;
  if (open) bad(`${open} offboarding task(s) still pending`);
  tx(() => {
    run("UPDATE employees SET status='exited' WHERE id=?", params.id);
    M.run('DELETE FROM sessions WHERE company_id=? AND emp_id=?', ctx().company.id, +params.id);
    run("UPDATE assets SET assigned_to=NULL, status='available' WHERE assigned_to=?", params.id);
    run('UPDATE employees SET manager_id=NULL WHERE manager_id=?', params.id);
  });
  return { ok: true };
});
route('POST', '/api/employees/:id/cancel-exit', ({ user, params }) => {
  need(can(user, 'onboarding'));
  run("UPDATE employees SET status='active', exit_date=NULL, exit_reason=NULL WHERE id=? AND status='notice'", params.id);
  run("DELETE FROM checklists WHERE emp_id=? AND kind='offboarding'", params.id);
  return { ok: true };
});

// checklists (onboarding / offboarding)
route('GET', '/api/checklists', ({ user, query }) => {
  need(can(user, 'onboarding'));
  return all(`SELECT c.*, e.name emp_name, e.emp_code FROM checklists c JOIN employees e ON e.id=c.emp_id
    WHERE (CAST(? AS TEXT) IS NULL OR c.kind=?) AND (CAST(? AS INTEGER) IS NULL OR c.emp_id=?) ORDER BY c.emp_id, c.id`, query.kind, query.kind, query.emp_id, query.emp_id);
});
route('POST', '/api/checklists', ({ user, body }) => { need(can(user, 'onboarding')); req_(body, 'emp_id', 'kind', 'title'); run('INSERT INTO checklists(emp_id,kind,title) VALUES(?,?,?)', body.emp_id, body.kind, body.title); return { ok: true }; });
route('POST', '/api/checklists/:id/toggle', ({ user, params }) => {
  need(can(user, 'onboarding'));
  run("UPDATE checklists SET done=1-done, done_on=CASE WHEN done=0 THEN ? ELSE NULL END WHERE id=?", todayStr(), params.id); return { ok: true };
});
route('DELETE', '/api/checklists/:id', ({ user, params }) => { need(can(user, 'onboarding')); run('DELETE FROM checklists WHERE id=?', params.id); return { ok: true }; });

// attendance
route('GET', '/api/attendance', ({ user, query }) => {
  const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : todayStr().slice(0, 7), eid = +query.emp_id || user.id;
  need(canSee(user, eid, 'attendance'));
  const cfg = attCfg(), hols = holidaySet(), t = todayStr();
  const first = month + '-01', last = iso(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)));
  const mm = monthMap(eid, month, cfg), recs = mm.recs;
  const leaves = all(`SELECT l.from_date,l.to_date,t.name,t.kind FROM leave_types t JOIN leaves l ON t.id=l.type_id WHERE l.emp_id=? AND l.status='approved' AND l.from_date<=? AND l.to_date>=?`, eid, last, first);
  const byDate = Object.fromEntries(recs.map(r => [r.date, r])), days = {};
  for (let d = first; d <= last && d <= t; d = addDays(d, 1)) {
    if (byDate[d]) days[d] = mm.days[d];
    else if (isWorkday(d, hols)) { const lv = leaves.find(l => l.from_date <= d && l.to_date >= d); days[d] = lv ? (lv.kind === 'wfh' ? { status: 'wfh', reason: 'Approved work from home' } : { status: 'leave', leave_type: lv.name }) : AE.derive(null, d, cfg, undefined, [], nowSec(), t); }
  }
  const rows = recs.map(r => { const dv = mm.days[r.date]; return { ...r, status: toStored(dv.status), reason: dv.reason, late: dv.late, hours: dv.minutes ? hrs1(dv.minutes) : null }; });
  return { rows, days, leaves, holidays: all('SELECT * FROM holidays WHERE substr(date,1,7)=?', month), cfg };
});
route('GET', '/api/attendance/day', ({ user, query }) => {
  need(can(user, 'attendance') || can(user, 'team'));
  const date = query.date || todayStr(), cfg = attCfg();
  const scope = can(user, 'attendance') ? null : teamIds(user);
  const emps = all("SELECT id,emp_code,name,designation FROM employees WHERE status!='exited' AND join_date<=? ORDER BY name", date)
    .filter(e => !scope || scope.includes(e.id));
  return emps.map(e => {
    const rec = get('SELECT * FROM attendance WHERE emp_id=? AND date=?', e.id, date);
    const dv = rec && monthMap(e.id, date.slice(0, 7), cfg).days[date];
    return { ...e, att: rec ? { ...rec, status: toStored(dv.status), reason: dv.reason, hours: dv.minutes ? hrs1(dv.minutes) : null } : null,
      leave: get(`SELECT t.name FROM leaves l JOIN leave_types t ON t.id=l.type_id WHERE l.emp_id=? AND l.status='approved' AND l.from_date<=? AND l.to_date>=? AND t.kind!='wfh'`, e.id, date, date) || null };
  });
});
// Office geo-fence: punches must happen within the configured radius of the office, unless the employee is exempt (geo-fencing) or on approved WFH.
function checkPunchLocation(user, body, mode) {
  const loc = officeLoc(), emp = get('SELECT geo_exempt, work_type FROM employees WHERE id=?', user.id), exempt = !!emp.geo_exempt;
  const num = v => (v === undefined || v === null || v === '') ? NaN : +v;
  const lat = num(body.lat), lng = num(body.lng), acc = num(body.accuracy);
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const dist = loc && hasLoc ? distM(loc.lat, loc.lng, lat, lng) : null;
  if (loc && !exempt) {
    if (mode === 'wfh') {
      const approved = get("SELECT 1 x FROM leaves l JOIN leave_types t ON t.id=l.type_id WHERE l.emp_id=? AND l.status='approved' AND t.kind='wfh' AND l.from_date<=? AND l.to_date>=?", user.id, todayStr(), todayStr());
      if (emp.work_type !== 'Work from home' && !approved) bad('Working from home needs an approved Work From Home request for today. Otherwise punch from the office.', 403);
    } else {
      if (!hasLoc) bad('Your location is needed to punch. Please allow location access in your browser and try again.', 403);
      if (Number.isFinite(acc) && acc > 300) bad(`Your location is too imprecise (±${Math.round(acc)} m). Turn on GPS / go outdoors and try again.`, 403);
      if (dist > loc.radius) bad(`You are ${fmtDist(dist)} from ${loc.label || 'the office'}. You must be within ${loc.radius} m to punch.`, 403);
    }
  }
  return { lat: hasLoc ? lat : null, lng: hasLoc ? lng : null, acc: Number.isFinite(acc) ? acc : null, dist, away: loc ? (dist === null || dist > loc.radius ? 1 : 0) : 0 };
}
route('POST', '/api/attendance/checkin', ({ user, body }) => {
  const d = todayStr();
  if (!isWorkday(d, holidaySet())) bad('Today is a weekend/holiday');
  if (get('SELECT id FROM punches WHERE emp_id=? AND date=? AND out_time IS NULL', user.id, d)) bad('You are already punched in');
  const t = nowSec(), mode = body.mode === 'wfh' ? 'wfh' : 'office', g = checkPunchLocation(user, body, mode);
  tx(() => {
    run('INSERT INTO punches(emp_id,date,in_time,mode,in_lat,in_lng,in_acc,in_dist,in_away) VALUES(?,?,?,?,?,?,?,?,?)', user.id, d, t, mode, g.lat, g.lng, g.acc, g.dist, g.away);
    const rec = get('SELECT * FROM attendance WHERE emp_id=? AND date=?', user.id, d);
    if (!rec) run('INSERT INTO attendance(emp_id,date,check_in,status,mode) VALUES(?,?,?,?,?)', user.id, d, t.slice(0, 5), 'present', mode);
    else run('UPDATE attendance SET check_out=NULL WHERE id=?', rec.id);
  });
  return { ...buildPunch(user.id), checked: { dist: g.dist, away: !!g.away } };
});
route('POST', '/api/attendance/checkout', ({ user, body }) => {
  const d = todayStr(), open = get('SELECT * FROM punches WHERE emp_id=? AND date=? AND out_time IS NULL', user.id, d);
  if (!open) bad('You are not punched in');
  const g = checkPunchLocation(user, body, open.mode), t = nowSec();
  tx(() => {
    run('UPDATE punches SET out_time=?, out_lat=?, out_lng=?, out_acc=?, out_dist=?, out_away=? WHERE id=?', t, g.lat, g.lng, g.acc, g.dist, g.away, open.id);
    const rec = get('SELECT * FROM attendance WHERE emp_id=? AND date=?', user.id, d);
    run('UPDATE attendance SET check_out=? WHERE id=?', t.slice(0, 5), rec.id);
    if (!rec.manual) { const dv = monthMap(user.id, d.slice(0, 7), attCfg()).days[d]; run('UPDATE attendance SET status=? WHERE id=?', toStored(dv.status), rec.id); }
  });
  return { ...buildPunch(user.id), checked: { dist: g.dist, away: !!g.away } };
});
route('POST', '/api/attendance/mark', ({ user, body }) => {
  need(can(user, 'attendance')); req_(body, 'emp_id', 'date', 'status');
  if (body.status === 'absent') { run('DELETE FROM attendance WHERE emp_id=? AND date=?', body.emp_id, body.date); return { ok: true }; }
  if (body.status === 'auto') { run('UPDATE attendance SET manual=0 WHERE emp_id=? AND date=?', body.emp_id, body.date); return { ok: true }; }
  if (!['present', 'wfh', 'half'].includes(body.status)) bad('Invalid status');
  const cfg = attCfg();
  run(`INSERT INTO attendance(emp_id,date,check_in,check_out,status,mode,manual) VALUES(?,?,?,?,?,?,1)
    ON CONFLICT(emp_id,date) DO UPDATE SET status=excluded.status, mode=excluded.mode, manual=1`, body.emp_id, body.date, cfg.office_start, cfg.office_end, body.status, body.status === 'wfh' ? 'wfh' : 'office');
  return { ok: true };
});
route('GET', '/api/settings/attendance', () => attCfg());
route('PUT', '/api/settings/attendance', ({ user, body }) => {
  need(can(user, 'settings'));
  const ok = t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || '');
  if (![body.office_start, body.office_end].every(ok)) bad('Times must look like 09:30');
  if (!(body.office_start < body.office_end)) bad('Office end must be after office start');
  const g = Math.round(+body.grace_minutes), hh = +body.half_day_hours, fh = +body.full_day_hours, al = Math.round(+body.allowance_days);
  const officeH = (toMin(body.office_end) - toMin(body.office_start)) / 60;
  if (!(g >= 0 && g <= 180)) bad('Late relaxation must be between 0 and 180 minutes');
  if (!(hh > 0 && hh < fh && fh <= officeH)) bad(`Hours must satisfy: half-day hours < full-day hours <= office hours (${officeH}h)`);
  if (!(al >= 0 && al <= 31)) bad('Allowance days must be between 0 and 31');
  for (const [k, v] of Object.entries({ office_start: body.office_start, office_end: body.office_end, grace_minutes: g, half_day_hours: hh, full_day_hours: fh, allowance_days: al }))
    run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v));
  return attCfg();
});
// holidays & leave types
route('GET', '/api/holidays', () => all('SELECT * FROM holidays ORDER BY date'));
route('POST', '/api/holidays', ({ user, body }) => { need(can(user, 'settings')); req_(body, 'date', 'name'); try { run('INSERT INTO holidays(date,name) VALUES(?,?)', body.date, body.name); } catch { bad('A holiday already exists on that date'); } return { ok: true }; });
route('DELETE', '/api/holidays/:id', ({ user, params }) => { need(can(user, 'settings')); run('DELETE FROM holidays WHERE id=?', params.id); return { ok: true }; });
route('POST', '/api/leave-types', ({ user, body }) => { need(can(user, 'settings')); req_(body, 'name'); try { run('INSERT INTO leave_types(name,days_per_year,is_paid) VALUES(?,?,?)', body.name, +body.days_per_year || 0, body.is_paid ? 1 : 0); } catch { bad('Leave type already exists'); } return { ok: true }; });
route('PUT', '/api/leave-types/:id', ({ user, params, body }) => { need(can(user, 'settings')); run('UPDATE leave_types SET days_per_year=? WHERE id=?', +body.days_per_year || 0, params.id); return { ok: true }; });

// leaves
route('GET', '/api/leaves/balance', ({ user, query }) => { const id = +query.emp_id || user.id; need(canSee(user, id, 'leave')); return leaveBalance(id); });
route('GET', '/api/leaves', ({ user, query }) => {
  const base = `SELECT l.*, t.name type, e.name emp_name, e.emp_code, a.name approver FROM leaves l JOIN leave_types t ON t.id=l.type_id
    JOIN employees e ON e.id=l.emp_id LEFT JOIN employees a ON a.id=l.approver_id`;
  if (query.scope === 'manage') {
    need(can(user, 'leave') || can(user, 'team'));
    if (can(user, 'leave')) return all(base + ' ORDER BY (l.status=\'pending\') DESC, l.from_date DESC');
    const ids = teamIds(user); if (!ids.length) return [];
    return all(base + ` WHERE l.emp_id IN (${ids.join(',')}) ORDER BY (l.status='pending') DESC, l.from_date DESC`);
  }
  return all(base + ' WHERE l.emp_id=? ORDER BY l.from_date DESC', user.id);
});
route('POST', '/api/leaves', ({ user, body }) => {
  req_(body, 'type_id', 'from_date', 'to_date', 'reason');
  if (body.to_date < body.from_date) bad('End date is before start date');
  const t = get('SELECT * FROM leave_types WHERE id=?', body.type_id); if (!t) bad('Invalid leave type');
  let days = workdaysBetween(body.from_date, body.to_date);
  if (body.half_day) { if (body.from_date !== body.to_date) bad('Half day applies to a single day'); days = days ? 0.5 : 0; }
  if (days === 0) bad('Selected dates are all weekends/holidays');
  const overlap = get("SELECT id FROM leaves WHERE emp_id=? AND status IN ('pending','approved') AND from_date<=? AND to_date>=?", user.id, body.to_date, body.from_date);
  if (overlap) bad('You already have a leave request overlapping these dates');
  if (t.days_per_year) {
    const b = leaveBalance(user.id, +body.from_date.slice(0, 4)).find(x => x.id === t.id);
    if (days > b.balance) bad(`Insufficient ${t.name} balance (${b.balance} day(s) left)`);
  }
  run('INSERT INTO leaves(emp_id,type_id,from_date,to_date,days,reason,created) VALUES(?,?,?,?,?,?,?)', user.id, t.id, body.from_date, body.to_date, days, body.reason, todayStr());
  return { ok: true, days };
});
route('POST', '/api/leaves/:id/decide', ({ user, params, body }) => {
  const l = get('SELECT * FROM leaves WHERE id=?', params.id); if (!l) bad('Not found', 404);
  need(can(user, 'leave') || teamIds(user).includes(l.emp_id));
  need(l.emp_id !== user.id, 'You cannot approve your own request');
  if (l.status !== 'pending') bad('Request already ' + l.status);
  if (!['approved', 'rejected'].includes(body.status)) bad('Invalid status');
  run('UPDATE leaves SET status=?, approver_id=?, note=? WHERE id=?', body.status, user.id, body.note, l.id);
  return { ok: true };
});
route('POST', '/api/leaves/:id/cancel', ({ user, params }) => {
  const l = get('SELECT * FROM leaves WHERE id=?', params.id); if (!l) bad('Not found', 404);
  need(l.emp_id === user.id || can(user, 'leave'));
  if (l.status === 'rejected' || l.status === 'cancelled') bad('Cannot cancel');
  if (l.status === 'approved' && l.from_date <= todayStr() && !can(user, 'leave')) bad('Leave already started; contact HR');
  run("UPDATE leaves SET status='cancelled' WHERE id=?", l.id); return { ok: true };
});

// payroll
route('GET', '/api/payroll/runs', ({ user }) => { need(can(user, 'payroll')); return all('SELECT r.*, (SELECT COUNT(*) FROM payslips WHERE run_id=r.id) count, (SELECT COALESCE(SUM(net),0) FROM payslips WHERE run_id=r.id) total_net, (SELECT COALESCE(SUM(gross),0) FROM payslips WHERE run_id=r.id) total_gross FROM payruns r ORDER BY month DESC'); });
route('POST', '/api/payroll/runs', ({ user, body }) => {
  need(can(user, 'payroll')); req_(body, 'month');
  if (!/^\d{4}-\d{2}$/.test(body.month)) bad('Month must be YYYY-MM');
  if (body.month > todayStr().slice(0, 7)) bad('Cannot run payroll for a future month');
  let run_ = get('SELECT * FROM payruns WHERE month=?', body.month);
  if (run_ && run_.status === 'finalized') bad('Payroll for this month is already finalized');
  tx(() => {
    if (!run_) run('INSERT INTO payruns(month,created) VALUES(?,?)', body.month, todayStr());
    run_ = get('SELECT * FROM payruns WHERE month=?', body.month);
    run('DELETE FROM payslips WHERE run_id=?', run_.id);
    const last = iso(new Date(Date.UTC(+body.month.slice(0, 4), +body.month.slice(5), 0)));
    const emps = all(`SELECT * FROM employees WHERE ctc>0 AND join_date<=? AND (status!='exited' OR exit_date>=?)`, last, body.month + '-01');
    for (const e of emps) {
      const p = buildPayslip(e, body.month);
      run(`INSERT INTO payslips(run_id,emp_id,month,working_days,paid_days,lop_days,basic,hra,special,gross,pf,pt,tds,reimbursements,deductions,net) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        run_.id, p.emp_id, p.month, p.working_days, p.paid_days, p.lop_days, p.basic, p.hra, p.special, p.gross, p.pf, p.pt, p.tds, p.reimbursements, p.deductions, p.net);
    }
  });
  return { id: run_.id };
});
route('GET', '/api/payroll/runs/:id', ({ user, params }) => {
  need(can(user, 'payroll'));
  const r = get('SELECT * FROM payruns WHERE id=?', params.id); if (!r) bad('Not found', 404);
  return { run: r, slips: all('SELECT p.*, e.name, e.emp_code, e.designation FROM payslips p JOIN employees e ON e.id=p.emp_id WHERE run_id=? ORDER BY e.emp_code', r.id) };
});
route('POST', '/api/payroll/runs/:id/finalize', ({ user, params }) => {
  need(can(user, 'payroll'));
  const r = get('SELECT * FROM payruns WHERE id=?', params.id); if (!r) bad('Not found', 404);
  if (r.status === 'finalized') bad('Already finalized');
  tx(() => {
    run("UPDATE payruns SET status='finalized', finalized=? WHERE id=?", todayStr(), r.id);
    for (const p of all('SELECT emp_id FROM payslips WHERE run_id=?', r.id))
      run("UPDATE expenses SET reimbursed_run=? WHERE emp_id=? AND status='approved' AND reimbursed_run IS NULL", r.id, p.emp_id);
  });
  return { ok: true };
});
route('DELETE', '/api/payroll/runs/:id', ({ user, params }) => {
  need(can(user, 'payroll'));
  const r = get('SELECT * FROM payruns WHERE id=?', params.id); if (!r) bad('Not found', 404);
  if (r.status === 'finalized') bad('Finalized payroll cannot be deleted');
  run('DELETE FROM payslips WHERE run_id=?', r.id); run('DELETE FROM payruns WHERE id=?', r.id); return { ok: true };
});
route('GET', '/api/payslips', ({ user, query }) => {
  const id = +query.emp_id || user.id; need(can(user, 'payroll') || id === user.id);
  return all(`SELECT p.*, e.name, e.emp_code, e.designation, e.pan, e.bank_account, e.join_date, d.name dept FROM payslips p JOIN payruns r ON r.id=p.run_id
    JOIN employees e ON e.id=p.emp_id LEFT JOIN departments d ON d.id=e.dept_id WHERE p.emp_id=? AND r.status='finalized' ORDER BY p.month DESC`, id);
});
route('GET', '/api/salary-structure', ({ user, query }) => {
  const id = +query.emp_id || user.id; need(can(user, 'payroll') || id === user.id);
  const e = get('SELECT ctc FROM employees WHERE id=?', id); const s = structure(e.ctc);
  return { ctc: e.ctc, monthly: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, round(v)])), annualTax: round(annualTax(e.ctc)) };
});

// recruitment
route('GET', '/api/jobs', ({ user }) => { need(can(user, 'recruitment')); return all('SELECT j.*, d.name dept, (SELECT COUNT(*) FROM candidates c WHERE c.job_id=j.id) candidates FROM jobs j LEFT JOIN departments d ON d.id=j.dept_id ORDER BY j.id DESC'); });
route('POST', '/api/jobs', ({ user, body }) => { need(can(user, 'recruitment')); req_(body, 'title'); run('INSERT INTO jobs(title,dept_id,openings,location,description,created) VALUES(?,?,?,?,?,?)', body.title, body.dept_id || null, +body.openings || 1, body.location, body.description, todayStr()); return { ok: true }; });
route('PUT', '/api/jobs/:id', ({ user, params, body }) => { need(can(user, 'recruitment')); run('UPDATE jobs SET status=? WHERE id=?', body.status === 'closed' ? 'closed' : 'open', params.id); return { ok: true }; });
route('GET', '/api/candidates', ({ user }) => { need(can(user, 'recruitment')); return all('SELECT c.*, j.title job FROM candidates c JOIN jobs j ON j.id=c.job_id ORDER BY c.id DESC'); });
route('POST', '/api/candidates', ({ user, body }) => { need(can(user, 'recruitment')); req_(body, 'job_id', 'name', 'email'); run('INSERT INTO candidates(job_id,name,email,phone,expected_ctc,notes,created) VALUES(?,?,?,?,?,?,?)', body.job_id, body.name, body.email, body.phone, +body.expected_ctc || 0, body.notes, todayStr()); return { ok: true }; });
const STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'];
route('POST', '/api/candidates/:id/stage', ({ user, params, body }) => {
  need(can(user, 'recruitment')); if (!STAGES.includes(body.stage)) bad('Invalid stage');
  const c = get('SELECT * FROM candidates WHERE id=?', params.id); if (!c) bad('Not found', 404);
  if (c.stage === 'Hired') bad('Candidate already hired');
  run('UPDATE candidates SET stage=? WHERE id=?', body.stage, c.id); return { ok: true };
});
route('DELETE', '/api/candidates/:id', ({ user, params }) => { need(can(user, 'recruitment')); run('DELETE FROM candidates WHERE id=?', params.id); return { ok: true }; });

// performance
route('GET', '/api/goals', ({ user, query }) => {
  const id = +query.emp_id || user.id; need(canSee(user, id, 'performance'));
  return all('SELECT * FROM goals WHERE emp_id=? ORDER BY id DESC', id);
});
route('POST', '/api/goals', ({ user, body }) => {
  req_(body, 'title'); const id = +body.emp_id || user.id; need(canSee(user, id, 'performance'));
  run('INSERT INTO goals(emp_id,title,description,due) VALUES(?,?,?,?)', id, body.title, body.description, body.due); return { ok: true };
});
route('PUT', '/api/goals/:id', ({ user, params, body }) => {
  const g = get('SELECT * FROM goals WHERE id=?', params.id); if (!g) bad('Not found', 404); need(canSee(user, g.emp_id, 'performance'));
  const p = Math.max(0, Math.min(100, +body.progress || 0));
  run('UPDATE goals SET progress=?, status=? WHERE id=?', p, p >= 100 ? 'completed' : 'active', g.id); return { ok: true };
});
route('DELETE', '/api/goals/:id', ({ user, params }) => { const g = get('SELECT * FROM goals WHERE id=?', params.id); if (!g) bad('Not found', 404); need(canSee(user, g.emp_id, 'performance')); run('DELETE FROM goals WHERE id=?', g.id); return { ok: true }; });
route('GET', '/api/reviews', ({ user, query }) => {
  const sql = 'SELECT r.*, e.name emp_name, rv.name reviewer FROM reviews r JOIN employees e ON e.id=r.emp_id LEFT JOIN employees rv ON rv.id=r.reviewer_id';
  if (query.scope === 'manage') { need(can(user, 'performance') || can(user, 'team')); if (can(user, 'performance')) return all(sql + ' ORDER BY r.id DESC'); const ids = teamIds(user); return ids.length ? all(sql + ` WHERE r.emp_id IN (${ids.join(',')}) ORDER BY r.id DESC`) : []; }
  return all(sql + ' WHERE r.emp_id=? ORDER BY r.id DESC', user.id);
});
route('POST', '/api/reviews', ({ user, body }) => {
  req_(body, 'emp_id', 'cycle', 'rating'); const id = +body.emp_id;
  need(can(user, 'performance') || teamIds(user).includes(id)); need(id !== user.id, 'You cannot review yourself');
  const r = +body.rating; if (!(r >= 1 && r <= 5)) bad('Rating must be 1-5');
  run('INSERT INTO reviews(emp_id,reviewer_id,cycle,rating,comments,created) VALUES(?,?,?,?,?,?)', id, user.id, body.cycle, r, body.comments, todayStr()); return { ok: true };
});

// expenses
route('GET', '/api/expenses', ({ user, query }) => {
  const sql = 'SELECT x.*, e.name emp_name FROM expenses x JOIN employees e ON e.id=x.emp_id';
  if (query.scope === 'manage') { need(can(user, 'expenses') || can(user, 'team')); if (can(user, 'expenses')) return all(sql + " ORDER BY (x.status='pending') DESC, x.id DESC"); const ids = teamIds(user); return ids.length ? all(sql + ` WHERE x.emp_id IN (${ids.join(',')}) ORDER BY (x.status='pending') DESC, x.id DESC`) : []; }
  return all(sql + ' WHERE x.emp_id=? ORDER BY x.id DESC', user.id);
});
route('POST', '/api/expenses', ({ user, body }) => {
  req_(body, 'category', 'amount', 'date'); if (!(+body.amount > 0)) bad('Amount must be greater than 0');
  run('INSERT INTO expenses(emp_id,category,amount,date,description,created) VALUES(?,?,?,?,?,?)', user.id, body.category, +body.amount, body.date, body.description, todayStr()); return { ok: true };
});
route('POST', '/api/expenses/:id/decide', ({ user, params, body }) => {
  const x = get('SELECT * FROM expenses WHERE id=?', params.id); if (!x) bad('Not found', 404);
  need(can(user, 'expenses') || teamIds(user).includes(x.emp_id)); need(x.emp_id !== user.id, 'You cannot approve your own claim');
  if (x.status !== 'pending') bad('Already ' + x.status); if (!['approved', 'rejected'].includes(body.status)) bad('Invalid status');
  run('UPDATE expenses SET status=?, decided_by=? WHERE id=?', body.status, user.id, x.id); return { ok: true };
});

// helpdesk
route('GET', '/api/tickets', ({ user, query }) => {
  const sql = 'SELECT t.*, e.name emp_name FROM tickets t JOIN employees e ON e.id=t.emp_id';
  if (query.scope === 'manage') { need(can(user, 'helpdesk')); return all(sql + " ORDER BY (t.status='closed'), t.id DESC"); }
  return all(sql + ' WHERE t.emp_id=? ORDER BY t.id DESC', user.id);
});
route('POST', '/api/tickets', ({ user, body }) => { req_(body, 'subject', 'category', 'description'); run('INSERT INTO tickets(emp_id,subject,category,description,created) VALUES(?,?,?,?,?)', user.id, body.subject, body.category, body.description, todayStr()); return { ok: true }; });
route('POST', '/api/tickets/:id/respond', ({ user, params, body }) => {
  need(can(user, 'helpdesk')); const st = ['open', 'in_progress', 'closed'].includes(body.status) ? body.status : 'in_progress';
  run('UPDATE tickets SET response=COALESCE(?,response), status=? WHERE id=?', body.response, st, params.id); return { ok: true };
});

// assets
route('GET', '/api/assets', ({ user }) => {
  const sql = 'SELECT a.*, e.name assignee FROM assets a LEFT JOIN employees e ON e.id=a.assigned_to';
  return can(user, 'assets') ? all(sql + ' ORDER BY a.id') : all(sql + ' WHERE a.assigned_to=?', user.id);
});
route('POST', '/api/assets', ({ user, body }) => { need(can(user, 'assets')); req_(body, 'name', 'tag'); try { run('INSERT INTO assets(name,tag,category) VALUES(?,?,?)', body.name, body.tag, body.category); } catch { bad('Asset tag already exists'); } return { ok: true }; });
route('POST', '/api/assets/:id/assign', ({ user, params, body }) => {
  need(can(user, 'assets'));
  if (body.emp_id) {
    const a = get('SELECT * FROM assets WHERE id=?', params.id); if (a.assigned_to) bad('Asset already assigned');
    run("UPDATE assets SET assigned_to=?, status='assigned', assigned_on=? WHERE id=?", body.emp_id, todayStr(), params.id);
  } else run("UPDATE assets SET assigned_to=NULL, status='available', assigned_on=NULL WHERE id=?", params.id);
  return { ok: true };
});
route('DELETE', '/api/assets/:id', ({ user, params }) => { need(can(user, 'assets')); run('DELETE FROM assets WHERE id=?', params.id); return { ok: true }; });

// announcements
route('POST', '/api/announcements', ({ user, body }) => { need(can(user, 'announcements')); req_(body, 'title', 'body'); run('INSERT INTO announcements(title,body,author_id,created) VALUES(?,?,?,?)', body.title, body.body, user.id, todayStr()); return { ok: true }; });
route('DELETE', '/api/announcements/:id', ({ user, params }) => { need(can(user, 'announcements')); run('DELETE FROM announcements WHERE id=?', params.id); return { ok: true }; });
route('GET', '/api/announcements', () => all('SELECT a.*, e.name author FROM announcements a LEFT JOIN employees e ON e.id=a.author_id ORDER BY a.id DESC'));

// learning
route('GET', '/api/courses', ({ user }) => all(`SELECT c.*, (SELECT progress FROM enrollments WHERE emp_id=? AND course_id=c.id) progress,
  (SELECT COUNT(*) FROM enrollments WHERE course_id=c.id) learners FROM courses c ORDER BY c.id`, user.id));
route('POST', '/api/courses', ({ user, body }) => { need(can(user, 'learning')); req_(body, 'title'); run('INSERT INTO courses(title,description,duration,mandatory) VALUES(?,?,?,?)', body.title, body.description, body.duration, body.mandatory ? 1 : 0); return { ok: true }; });
route('POST', '/api/courses/:id/progress', ({ user, params, body }) => {
  const p = Math.max(0, Math.min(100, +body.progress || 0));
  run('INSERT INTO enrollments(emp_id,course_id,progress) VALUES(?,?,?) ON CONFLICT(emp_id,course_id) DO UPDATE SET progress=excluded.progress', user.id, params.id, p); return { ok: true };
});
route('GET', '/api/courses/compliance', ({ user }) => {
  need(can(user, 'learning'));
  return all(`SELECT e.name, c.title, COALESCE(en.progress,0) progress FROM employees e CROSS JOIN courses c
    LEFT JOIN enrollments en ON en.emp_id=e.id AND en.course_id=c.id WHERE c.mandatory=1 AND e.status!='exited' AND COALESCE(en.progress,0)<100 ORDER BY e.name`);
});

// reports
route('GET', '/api/reports/attendance', ({ user, query }) => {
  need(can(user, 'attendance')); const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : todayStr().slice(0, 7), cfg = attCfg();
  return all("SELECT id, emp_code, name FROM employees WHERE status!='exited' ORDER BY emp_code").map(e => {
    const c = { present: 0, wfh: 0, half: 0, absent: 0 }; let mins = 0;
    for (const x of Object.values(monthMap(e.id, month, cfg).days)) { if (x.status === 'office') c.present++; else if (x.status === 'wfh') c.wfh++; else if (x.status === 'half') c.half++; else if (x.status === 'absent') c.absent++; mins += x.minutes || 0; }
    return { emp_code: e.emp_code, name: e.name, ...c, hours: Math.round(mins / 60) };
  });
});

// ---------- employee requests: resignation / transfer / work type ----------
const WORK_TYPES = ['Office', 'Work from home', 'Hybrid'];
const canReviewReq = (u, empId) => u.id !== empId && (can(u, 'onboarding') || can(u, 'employees') || teamIds(u).includes(empId));
const REQ_SQL = `SELECT r.*, e.name emp_name, e.emp_code, e.designation, d.name dept, a.name decided_by_name FROM requests r JOIN employees e ON e.id=r.emp_id
  LEFT JOIN departments d ON d.id=e.dept_id LEFT JOIN employees a ON a.id=r.decided_by`;
const parseReq = r => ({ ...r, payload: JSON.parse(r.payload || '{}') });
function reviewableRequests(user) {
  const broad = can(user, 'onboarding') || can(user, 'employees'), team = new Set(teamIds(user));
  if (!broad && !team.size) return [];
  return all(REQ_SQL + " ORDER BY (r.status='pending') DESC, r.id DESC").filter(r => r.emp_id !== user.id && (broad || team.has(r.emp_id)) && (r.type !== 'password_reset' || user.role === 'admin')).map(parseReq);
}
route('GET', '/api/requests', ({ user, query }) => {
  if (query.scope === 'manage') return reviewableRequests(user);
  const id = +query.emp_id || user.id; need(id === user.id || canReviewReq(user, id));
  return all(REQ_SQL + ' WHERE r.emp_id=? ORDER BY r.id DESC', id).map(parseReq);
});
route('POST', '/api/requests', ({ user, body }) => {
  need(user.role !== 'admin', 'Admin accounts do not raise requests');
  req_(body, 'type', 'reason');
  const emp = get('SELECT * FROM employees WHERE id=?', user.id);
  if (!['resignation', 'transfer', 'work_type'].includes(body.type)) bad('Unknown request type');
  if (get("SELECT id FROM requests WHERE emp_id=? AND type=? AND status='pending'", user.id, body.type)) bad('You already have a pending request of this type');
  let payload;
  if (body.type === 'resignation') {
    req_(body, 'last_working_day');
    if (body.last_working_day < todayStr()) bad('Last working day cannot be in the past');
    if (emp.status === 'notice') bad('You are already serving notice');
    payload = { last_working_day: body.last_working_day };
  } else if (body.type === 'transfer') {
    req_(body, 'transfer_date');
    const toDept = body.to_dept_id ? get('SELECT * FROM departments WHERE id=?', body.to_dept_id) : null, toLoc = String(body.to_location || '').trim();
    if (!toDept && !toLoc) bad('Choose a new department and/or a new location');
    if ((!toDept || toDept.id === emp.dept_id) && (!toLoc || toLoc === emp.location)) bad('That is where you already work');
    payload = { to_dept_id: toDept?.id || null, to_dept_name: toDept?.name || null, from_dept_name: get('SELECT name FROM departments WHERE id=?', emp.dept_id)?.name || null, to_location: toLoc || null, from_location: emp.location, transfer_date: body.transfer_date };
  } else {
    req_(body, 'worktype_date');
    if (!WORK_TYPES.includes(body.to_work_type)) bad('Choose a work type');
    if (body.to_work_type === (emp.work_type || 'Office')) bad('You already work in that mode');
    payload = { from: emp.work_type || 'Office', to: body.to_work_type, worktype_date: body.worktype_date };
  }
  run('INSERT INTO requests(emp_id,type,payload,reason,created) VALUES(?,?,?,?,?)', user.id, body.type, JSON.stringify(payload), body.reason, todayStr());
  return { ok: true };
});
route('POST', '/api/requests/:id/withdraw', ({ user, params }) => {
  const r = get('SELECT * FROM requests WHERE id=?', params.id); if (!r) bad('Not found', 404);
  need(r.emp_id === user.id); if (r.status !== 'pending') bad('Only pending requests can be withdrawn');
  run("UPDATE requests SET status='withdrawn', decided_on=? WHERE id=?", todayStr(), r.id); return { ok: true };
});
route('POST', '/api/requests/:id/decide', ({ user, params, body }) => {
  const r = get('SELECT * FROM requests WHERE id=?', params.id); if (!r) bad('Not found', 404);
  need(canReviewReq(user, r.emp_id));
  if (r.type === 'password_reset') { need(user.role === 'admin', 'Only the company admin can handle password resets'); if (body.status === 'approved') bad('Use "Set new password" to approve a password reset'); }
  if (r.status !== 'pending') bad('Already ' + r.status);
  if (!['approved', 'rejected'].includes(body.status)) bad('Invalid status');
  const p = JSON.parse(r.payload || '{}'), emp = get('SELECT * FROM employees WHERE id=?', r.emp_id);
  tx(() => {
    run('UPDATE requests SET status=?, decided_by=?, note=?, decided_on=? WHERE id=?', body.status, user.id, body.note, todayStr(), r.id);
    if (body.status !== 'approved') return;
    if (r.type === 'work_type') run('UPDATE employees SET work_type=? WHERE id=?', p.to, emp.id);
    else if (r.type === 'transfer') {
      if (p.to_dept_id) run('UPDATE employees SET dept_id=? WHERE id=?', p.to_dept_id, emp.id);
      if (p.to_location) run('UPDATE employees SET location=? WHERE id=?', p.to_location, emp.id);
    } else if (r.type === 'resignation' && emp.status === 'active') {
      run("UPDATE employees SET status='notice', exit_date=?, exit_reason=? WHERE id=?", p.last_working_day, r.reason, emp.id);
      if (!get("SELECT id FROM checklists WHERE emp_id=? AND kind='offboarding'", emp.id))
        ['Accept resignation & confirm last working day', 'Knowledge transfer', 'Return laptop & assets', 'Revoke system access', 'Exit interview', 'Full & Final settlement']
          .forEach(t => run('INSERT INTO checklists(emp_id,kind,title) VALUES(?,?,?)', emp.id, 'offboarding', t));
    }
  });
  return { ok: true };
});

// ---------- office location, geo-fencing exemptions and punch location history ----------
const distM = (la1, lo1, la2, lo2) => { const R = 6371000, r = x => x * Math.PI / 180, dLa = r(la2 - la1), dLo = r(lo2 - lo1); const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(la1)) * Math.cos(r(la2)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const fmtDist = m => m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km';
function officeLoc() {
  const r = Object.fromEntries(all("SELECT key,value FROM settings WHERE substr(key,1,4)='geo_'").map(x => [x.key, x.value]));
  if (!r.geo_lat || !r.geo_lng || isNaN(+r.geo_lat) || isNaN(+r.geo_lng)) return null;
  return { lat: +r.geo_lat, lng: +r.geo_lng, radius: +r.geo_radius || 100, label: r.geo_label || '' };
}
function geoInfo(empId) {
  const loc = officeLoc(), emp = get('SELECT geo_exempt FROM employees WHERE id=?', empId);
  return { enforced: !!loc, radius: loc?.radius || null, label: loc?.label || null, exempt: !!emp?.geo_exempt };
}
const exemptIds = () => all('SELECT id FROM employees WHERE geo_exempt=1').map(e => e.id);
route('GET', '/api/settings/location', ({ user }) => {
  need(can(user, 'settings') || can(user, 'attendance'));
  return { office: officeLoc(), exempt: exemptIds() };
});
route('PUT', '/api/settings/location', ({ user, body }) => {
  need(can(user, 'settings'));
  const set = (k, v) => run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v));
  if (body.lat === '' || body.lat === null || body.lat === undefined) { run("DELETE FROM settings WHERE substr(key,1,4)='geo_'"); return { office: null, exempt: exemptIds() }; }
  const lat = +body.lat, lng = +body.lng, radius = Math.round(+body.radius || 100);
  if (!(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180) || isNaN(lat) || isNaN(lng)) bad('Enter a valid latitude (-90 to 90) and longitude (-180 to 180)');
  if (!(radius >= 20 && radius <= 1000)) bad('Allowed distance must be between 20 and 1000 metres');
  set('geo_lat', lat); set('geo_lng', lng); set('geo_radius', radius); set('geo_label', String(body.label || '').trim().slice(0, 80));
  return { office: officeLoc(), exempt: exemptIds() };
});
route('PUT', '/api/settings/geofence', ({ user, body }) => {
  need(can(user, 'settings'));
  const ids = [...new Set((Array.isArray(body.emp_ids) ? body.emp_ids : []).map(Number).filter(Number.isInteger))];
  tx(() => { run('UPDATE employees SET geo_exempt=0'); for (const id of ids) run("UPDATE employees SET geo_exempt=1 WHERE id=? AND role!='admin'", id); });
  return { exempt: exemptIds() };
});
route('GET', '/api/attendance/history', ({ user, query }) => {
  const okd = x => /^\d{4}-\d{2}-\d{2}$/.test(x || ''), t = todayStr();
  const from = okd(query.from) ? query.from : t.slice(0, 8) + '01', to = okd(query.to) ? query.to : t;
  let empId = +query.emp_id || null;
  if (empId) need(canSee(user, empId, 'attendance')); else if (!can(user, 'attendance')) empId = user.id;
  const rows = all(`SELECT p.*, e.name emp_name, e.emp_code, e.geo_exempt FROM punches p JOIN employees e ON e.id=p.emp_id
    WHERE p.date BETWEEN ? AND ? ${empId ? 'AND p.emp_id=?' : ''} ${query.away ? 'AND (p.in_away=1 OR p.out_away=1)' : ''} ORDER BY p.date DESC, p.id DESC LIMIT 1000`, ...[from, to].concat(empId ? [empId] : []));
  const o = officeLoc();
  return { from, to, rows, office: o ? { label: o.label, radius: o.radius } : null };
});
// ---------- company-wide views (admin dashboards) ----------
const hoursBetween = (a, b) => { if (!a || !b) return null; const [h1, m1] = a.split(':').map(Number), [h2, m2] = b.split(':').map(Number); const m = (h2 * 60 + m2) - (h1 * 60 + m1); return m > 0 ? Math.round(m / 6) / 10 : null; };
const validMonth = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || '') ? m : todayStr().slice(0, 7);

route('GET', '/api/attendance/overview', ({ user, query }) => {
  need(can(user, 'attendance'));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(query.date || '') ? query.date : todayStr(), hols = holidaySet(), work = isWorkday(date, hols), cfg = attCfg();
  const hol = get('SELECT name FROM holidays WHERE date=?', date);
  const emps = all("SELECT e.id,e.emp_code,e.name,e.designation,d.name dept FROM employees e LEFT JOIN departments d ON d.id=e.dept_id WHERE e.status!='exited' AND e.role!='admin' AND e.join_date<=? ORDER BY e.name", date);
  const counts = { office: 0, wfh: 0, half: 0, leave: 0, absent: 0, pending: 0, late: 0, total: emps.length };
  const rows = emps.map(e => {
    const st = dayStatus(e.id, date, cfg, work);
    if (counts[st.status] !== undefined) counts[st.status]++;
    if (st.late) counts.late++;
    return { ...e, ...st };
  });
  return { date, workday: work, holiday: hol?.name || null, counts, rows, cfg, now: nowTime() };
});

route('GET', '/api/payroll/overview', ({ user, query }) => {
  need(can(user, 'payroll'));
  const month = validMonth(query.month), first = month + '-01', last = iso(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)));
  const run_ = get('SELECT * FROM payruns WHERE month=?', month);
  const saved = run_ ? Object.fromEntries(all('SELECT * FROM payslips WHERE run_id=?', run_.id).map(p => [p.emp_id, p])) : {};
  const emps = all(`SELECT e.*, d.name dept FROM employees e LEFT JOIN departments d ON d.id=e.dept_id WHERE e.ctc>0 AND e.join_date<=? AND (e.status!='exited' OR e.exit_date>=?) ORDER BY e.emp_code`, last, first);
  const rows = emps.map(e => {
    const p = saved[e.id] || buildPayslip(e, month);
    return { id: e.id, emp_id: e.id, emp_code: e.emp_code, name: e.name, designation: e.designation, dept: e.dept, pan: e.pan, bank_account: e.bank_account, ctc: e.ctc, month,
      working_days: p.working_days, paid_days: p.paid_days, lop_days: p.lop_days, basic: p.basic, hra: p.hra, special: p.special, gross: p.gross, pf: p.pf, pt: p.pt, tds: p.tds,
      reimbursements: p.reimbursements, deductions: p.deductions, net: p.net };
  });
  const sum = k => round(rows.reduce((t, r) => t + r[k], 0));
  return { month, run: run_ ? { id: run_.id, status: run_.status } : null, rows, totals: { employees: rows.length, gross: sum('gross'), deductions: sum('deductions'), reimbursements: sum('reimbursements'), net: sum('net'), annualCtc: sum('ctc') } };
});

route('GET', '/api/performance/ranking', ({ user, query }) => {
  need(can(user, 'performance'));
  const days = [30, 90, 180, 365].includes(+query.days) ? +query.days : 90, to = todayStr(), from = addDays(to, 1 - days), hols = holidaySet();
  const mandatory = all('SELECT id FROM courses WHERE mandatory=1').map(c => c.id);
  const emps = all("SELECT e.id,e.emp_code,e.name,e.designation,e.join_date,d.name dept FROM employees e LEFT JOIN departments d ON d.id=e.dept_id WHERE e.status!='exited' AND e.role!='admin' ORDER BY e.name");
  const cfg = attCfg();
  const W = { review: 35, goals: 25, attendance: 20, punctuality: 10, training: 10 };
  const rows = emps.map(e => {
    const start = e.join_date > from ? e.join_date : from; let expected = 0;
    const leaves = all("SELECT l.from_date,l.to_date FROM leaves l JOIN leave_types t ON t.id=l.type_id WHERE l.emp_id=? AND l.status='approved' AND t.is_paid=1 AND l.from_date<=? AND l.to_date>=?", e.id, to, start);
    for (let d = start; d <= to; d = addDays(d, 1)) if (isWorkday(d, hols) && !leaves.some(l => l.from_date <= d && l.to_date >= d)) expected++;
    const att = [], nm = m => { const x = new Date(m + '-01T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + 1); return x.toISOString().slice(0, 7); };
    for (let m = start.slice(0, 7); m <= to.slice(0, 7); m = nm(m)) { const mm = monthMap(e.id, m, cfg); for (const r of mm.recs) if (r.date >= start && r.date <= to) att.push({ ...r, dv: mm.days[r.date] }); }
    const attended = att.reduce((t, a) => t + (a.dv.status === 'half' ? 0.5 : (a.dv.status === 'office' || a.dv.status === 'wfh') ? 1 : 0), 0);
    const attendance = expected > 0 ? Math.min(100, round(attended / expected * 100)) : null;
    const timed = att.filter(a => a.check_in);
    const punctuality = timed.length ? round(timed.filter(a => a.check_in <= cfg.grace_end).length / timed.length * 100) : null;
    const goals = all("SELECT progress, status FROM goals WHERE emp_id=?", e.id);
    const goalsAvg = goals.length ? round(goals.reduce((t, g) => t + g.progress, 0) / goals.length) : null;
    const revs = all('SELECT rating FROM reviews WHERE emp_id=? ORDER BY id DESC', e.id);
    const rating = revs.length ? round(revs.reduce((t, r) => t + r.rating, 0) / revs.length) : null;
    let training = null;
    if (mandatory.length) { const pr = all(`SELECT course_id, progress FROM enrollments WHERE emp_id=? AND course_id IN (${mandatory.join(',')})`, e.id); training = round(mandatory.reduce((t, c) => t + (pr.find(x => x.course_id === c)?.progress || 0), 0) / mandatory.length); }
    const parts = { review: rating === null ? null : rating * 20, goals: goalsAvg, attendance, punctuality, training };
    let tw = 0, ts = 0; for (const [k, v] of Object.entries(parts)) if (v !== null) { tw += W[k]; ts += W[k] * v; }
    const score = tw ? round(ts / tw) : null;
    return { id: e.id, emp_code: e.emp_code, name: e.name, designation: e.designation, dept: e.dept, score, attendance, punctuality, goals: goalsAvg, goals_count: goals.length, goals_done: goals.filter(g => g.status === 'completed').length, rating, reviews: revs.length, training };
  });
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.rank = r.score === null ? null : (i > 0 && rows[i - 1].score === r.score ? rows[i - 1].rank : i + 1); r.tier = r.score === null ? 'Not enough data' : r.score >= 80 ? 'Outstanding' : r.score >= 65 ? 'Strong' : r.score >= 50 ? 'Meets expectations' : 'Needs attention'; });
  return { days, from, to, weights: W, punctual_by: cfg.grace_end, rows };
});

const EXP_APPROVED = "(emp_id IS NULL OR status='approved')";
route('GET', '/api/expenses/all', ({ user }) => {
  need(can(user, 'expenses'));
  return all(`SELECT x.*, e.name emp_name, e.emp_code, a.name added_by, CASE WHEN x.emp_id IS NULL THEN 'Company' ELSE 'Employee claim' END source
    FROM expenses x LEFT JOIN employees e ON e.id=x.emp_id LEFT JOIN employees a ON a.id=x.decided_by ORDER BY x.date DESC, x.id DESC`);
});
route('GET', '/api/expenses/summary', ({ user }) => {
  need(can(user, 'expenses'));
  const month = todayStr().slice(0, 7), one = (sql, ...p) => get(sql, ...p) || {};
  const company = one(`SELECT COALESCE(SUM(amount),0) s, COUNT(*) c FROM expenses WHERE emp_id IS NULL`);
  const claims = one(`SELECT COALESCE(SUM(amount),0) s, COUNT(*) c FROM expenses WHERE emp_id IS NOT NULL AND status='approved'`);
  const pending = one(`SELECT COALESCE(SUM(amount),0) s, COUNT(*) c FROM expenses WHERE emp_id IS NOT NULL AND status='pending'`);
  const thisMonth = one(`SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE ${EXP_APPROVED} AND substr(date,1,7)=?`, month).s;
  const byCategory = all(`SELECT category, SUM(amount) total, SUM(CASE WHEN emp_id IS NULL THEN amount ELSE 0 END) company, SUM(CASE WHEN emp_id IS NULL THEN 0 ELSE amount END) claims, COUNT(*) count FROM expenses WHERE ${EXP_APPROVED} GROUP BY category ORDER BY total DESC`);
  const months = []; { let y = +month.slice(0, 4), m = +month.slice(5); for (let i = 0; i < 6; i++) { months.unshift(y + '-' + String(m).padStart(2, '0')); if (--m === 0) { m = 12; y--; } } }
  const byMonth = months.map(m => ({ month: m, total: one(`SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE ${EXP_APPROVED} AND substr(date,1,7)=?`, m).s }));
  const topSpenders = all("SELECT e.name, SUM(x.amount) total, COUNT(*) count FROM expenses x JOIN employees e ON e.id=x.emp_id WHERE x.status='approved' GROUP BY x.emp_id, e.name ORDER BY total DESC LIMIT 5");
  return { total: round(company.s + claims.s), company: round(company.s), companyCount: company.c, claims: round(claims.s), claimsCount: claims.c, pending: round(pending.s), pendingCount: pending.c, thisMonth: round(thisMonth), byCategory, byMonth, topSpenders };
});
route('POST', '/api/expenses/company', ({ user, body }) => {
  need(can(user, 'expenses')); req_(body, 'category', 'amount', 'date');
  if (!(+body.amount > 0)) bad('Amount must be greater than 0');
  run("INSERT INTO expenses(emp_id,category,amount,date,description,status,decided_by,created) VALUES(NULL,?,?,?,?,'approved',?,?)", body.category, +body.amount, body.date, body.description, user.id, todayStr());
  return { ok: true };
});

// ---------- employee profile: personal details + document uploads (Aadhaar, PAN, bank, letters, certificates...) ----------
const DOC_TYPES = { profile_photo: { img: true }, aadhaar_front: {}, aadhaar_back: {}, pan_front: {}, bank_proof: {}, marksheet: { multi: true }, certificate: { multi: true },
  offer_letter: {}, salary_slip: {}, relieving_letter: {}, experience_letter: {}, other: { multi: true } };
const MAX_PER_TYPE = 10, MAX_IMG_BYTES = 2.6e6, MAX_PDF_BYTES = 3e6;
const PROFILE_FIELDS = ['display_name', 'full_name', 'father_name', 'dob', 'gender', 'marital_status', 'blood_group', 'personal_email', 'phone', 'alt_phone', 'current_address', 'permanent_address',
  'emergency_name', 'emergency_relation', 'emergency_phone', 'aadhaar_no', 'pan_no', 'uan_no', 'bank_holder', 'bank_account_no', 'bank_ifsc', 'bank_name', 'bank_branch', 'bank_branch_code',
  'qualification', 'university', 'passing_year', 'experience_type', 'prev_company', 'prev_designation', 'prev_from', 'prev_to', 'last_salary'];
const digits = v => String(v).replace(/[\s-]/g, '');
const FIELD_RULES = {
  aadhaar_no: [v => /^\d{12}$/.test(digits(v)), 'Aadhaar number must be 12 digits'],
  pan_no: [v => /^[A-Z]{5}\d{4}[A-Z]$/.test(v.toUpperCase()), 'PAN must look like ABCDE1234F'],
  bank_ifsc: [v => /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(v), 'IFSC must look like HDFC0001234'],
  bank_account_no: [v => /^\d{6,20}$/.test(digits(v)), 'Bank account number must be 6-20 digits'],
  phone: [v => /^(\+?91)?\d{10}$/.test(digits(v)), 'Phone must be a 10-digit mobile number'],
  alt_phone: [v => /^(\+?91)?\d{10}$/.test(digits(v)), 'Alternate phone must be a 10-digit mobile number'],
  emergency_phone: [v => /^(\+?91)?\d{10}$/.test(digits(v)), 'Emergency phone must be a 10-digit mobile number'],
  personal_email: [v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Personal email is not valid'],
  dob: [v => /^\d{4}-\d{2}-\d{2}$/.test(v), 'Date of birth is not valid'],
  experience_type: [v => ['fresher', 'experienced'].includes(v), 'Choose fresher or experienced'],
  gender: [v => ['Male', 'Female', 'Other'].includes(v), 'Choose a gender'],
  passing_year: [v => /^(19|20)\d{2}$/.test(v), 'Passing year is not valid'],
};
function getProfile(empId) { const r = get('SELECT data FROM profiles WHERE emp_id=?', empId); try { return r ? JSON.parse(r.data) : {}; } catch { return {}; } }
const docList = empId => all('SELECT id,doc_type,filename,mime,size,uploaded FROM documents WHERE emp_id=? ORDER BY doc_type,id', empId);
// what the company needs on file; experience documents only count for "experienced" joiners
function completion(f, docs) {
  const has = new Set(docs.map(d => d.doc_type));
  const checks = [['Full name', !!f.full_name], ['Date of birth', !!f.dob], ['Phone number', !!f.phone], ['Current address', !!f.current_address], ['Emergency contact', !!(f.emergency_name && f.emergency_phone)],
    ['Aadhaar number', !!f.aadhaar_no], ['PAN number', !!f.pan_no], ['Bank account details', !!(f.bank_holder && f.bank_account_no && f.bank_ifsc && f.bank_name)], ['Fresher / experienced', !!f.experience_type],
    ['Profile photo', has.has('profile_photo')], ['Aadhaar card — front', has.has('aadhaar_front')], ['Aadhaar card — back', has.has('aadhaar_back')], ['PAN card', has.has('pan_front')],
    ['Bank passbook / cheque', has.has('bank_proof')], ['Marksheet', has.has('marksheet')],
    ...(f.experience_type === 'experienced' ? [['Last company offer letter', has.has('offer_letter')], ['Last company salary slip', has.has('salary_slip')], ['Relieving letter', has.has('relieving_letter')], ['Experience letter', has.has('experience_letter')]] : [])];
  const done = checks.filter(c => c[1]).length;
  return { pct: Math.round(done / checks.length * 100), done, total: checks.length, missing: checks.filter(c => !c[1]).map(c => c[0]) };
}
function profileCompletionMap() {
  const profs = Object.fromEntries(all('SELECT emp_id,data FROM profiles').map(r => { let d = {}; try { d = JSON.parse(r.data); } catch {} return [r.emp_id, d]; }));
  const docs = {}; for (const r of all('SELECT emp_id, doc_type FROM documents GROUP BY emp_id, doc_type')) (docs[r.emp_id] ||= []).push({ doc_type: r.doc_type });
  return id => completion(profs[id] || {}, docs[id] || []).pct;
}
route('GET', '/api/profile', ({ user, query }) => {
  const id = +query.emp_id || user.id; need(id === user.id || can(user, 'employees'));
  const e = get('SELECT id,name,emp_code,email,designation,role FROM employees WHERE id=?', id); if (!e) bad('Not found', 404);
  const fields = getProfile(id), docs = docList(id);
  return { employee: e, fields, docs, completion: completion(fields, docs), editable: id === user.id };
});
route('PUT', '/api/profile', ({ user, body }) => {
  const f = {};
  for (const k of PROFILE_FIELDS) if (k in body) {
    const v = String(body[k] ?? '').trim().slice(0, k.endsWith('address') ? 500 : 200);
    if (v && FIELD_RULES[k] && !FIELD_RULES[k][0](v)) bad(FIELD_RULES[k][1]);
    f[k] = k === 'pan_no' || k === 'bank_ifsc' ? v.toUpperCase() : (k === 'aadhaar_no' ? digits(v) : v);
  }
  const data = { ...getProfile(user.id), ...f };
  tx(() => {
    run('INSERT INTO profiles(emp_id,data,updated) VALUES(?,?,?) ON CONFLICT(emp_id) DO UPDATE SET data=excluded.data, updated=excluded.updated', user.id, JSON.stringify(data), todayStr());
    // keep the main employee record (used by payroll / payslips) in step
    run('UPDATE employees SET phone=COALESCE(NULLIF(?,\'\'),phone), dob=COALESCE(NULLIF(?,\'\'),dob), gender=COALESCE(NULLIF(?,\'\'),gender), address=COALESCE(NULLIF(?,\'\'),address), pan=COALESCE(NULLIF(?,\'\'),pan), bank_account=COALESCE(NULLIF(?,\'\'),bank_account) WHERE id=?',
      data.phone || '', data.dob || '', data.gender || '', data.current_address || '', data.pan_no || '', data.bank_account_no || '', user.id);
  });
  return { ok: true, completion: completion(data, docList(user.id)) };
});
route('POST', '/api/profile/documents', ({ user, body }) => {
  const type = body.doc_type, cfg = DOC_TYPES[type]; if (!cfg) bad('Unknown document type');
  const mime = String(body.mime || ''); if (!['image/jpeg', 'image/png', 'application/pdf'].includes(mime)) bad('Upload a JPG, PNG or PDF file');
  if (cfg.img && mime === 'application/pdf') bad('The profile photo must be an image');
  const buf = Buffer.from(String(body.data || ''), 'base64'); if (!buf.length) bad('The file is empty');
  const isPdf = buf.subarray(0, 5).toString() === '%PDF-', isJpg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF, isPng = buf.subarray(1, 4).toString() === 'PNG';
  if ((mime === 'application/pdf' && !isPdf) || (mime === 'image/jpeg' && !isJpg) || (mime === 'image/png' && !isPng)) bad('The file content does not match its type');
  if (mime === 'application/pdf' ? buf.length > MAX_PDF_BYTES : buf.length > MAX_IMG_BYTES) bad(mime === 'application/pdf' ? 'PDF is too large (max 3 MB)' : 'Image is too large');
  const filename = String(body.filename || 'file').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 120);
  tx(() => {
    if (!cfg.multi) run('DELETE FROM documents WHERE emp_id=? AND doc_type=?', user.id, type);
    else if (get('SELECT COUNT(*) c FROM documents WHERE emp_id=? AND doc_type=?', user.id, type).c >= MAX_PER_TYPE) bad(`You can upload at most ${MAX_PER_TYPE} files here`);
    run('INSERT INTO documents(emp_id,doc_type,filename,mime,size,data,uploaded) VALUES(?,?,?,?,?,?,?)', user.id, type, filename, mime, buf.length, buf.toString('base64'), todayStr());
  });
  const docs = docList(user.id); return { ok: true, docs, completion: completion(getProfile(user.id), docs) };
});
route('DELETE', '/api/profile/documents/:id', ({ user, params }) => {
  const r = run('DELETE FROM documents WHERE id=? AND emp_id=?', params.id, user.id); if (!r.changes) bad('Not found', 404);
  const docs = docList(user.id); return { ok: true, docs, completion: completion(getProfile(user.id), docs) };
});
route('GET', '/api/documents/:id', ({ user, params }) => {
  const d = get('SELECT * FROM documents WHERE id=?', params.id); if (!d) bad('Not found', 404);
  need(d.emp_id === user.id || can(user, 'employees'));
  return { __raw: { type: d.mime, buf: Buffer.from(d.data, 'base64'), cache: 'private, no-store', filename: d.filename } };
});

// "Forgot password": the employee asks from the login page, the company admin sets a new one
route('POST', '/api/forgot-password', ({ body }) => {
  const id = String(body.identifier || '').trim(), key = 'forgot:' + id.toLowerCase();
  throttle(key); fails.set(key, [...(fails.get(key) || []), Date.now()]);
  const m = /^([A-Za-z]+)(\d+)$/.exec(id), c = m && M.get('SELECT ' + CO_COLS + ' FROM companies WHERE upper(emp_prefix)=upper(?)', m[1]);
  if (c && c.status === 'active') inCompany(c, () => {
    const e = get("SELECT id FROM employees WHERE upper(emp_code)=upper(?) AND role!='admin' AND status!='exited'", id);
    if (e && !get("SELECT id FROM requests WHERE emp_id=? AND type='password_reset' AND status='pending'", e.id))
      run('INSERT INTO requests(emp_id,type,payload,reason,created) VALUES(?,?,?,?,?)', e.id, 'password_reset', '{}', String(body.note || '').trim().slice(0, 200) || 'Forgot password', todayStr());
  });
  return { ok: true, message: 'If that Employee ID exists, your admin has been notified and will set a new password for you.' };
}, { public: true });
route('POST', '/api/requests/:id/reset-password', ({ user, params, body }) => {
  need(user.role === 'admin', 'Only the company admin can reset passwords'); confirmPw(user, body);
  const r = get('SELECT * FROM requests WHERE id=?', params.id); if (!r || r.type !== 'password_reset') bad('Not found', 404);
  if (r.status !== 'pending') bad('Already ' + r.status);
  const pw = String(body.password || ''); if (pw.length < 6) bad('The new password must be at least 6 characters');
  tx(() => {
    run('UPDATE employees SET password_hash=? WHERE id=?', hash(pw), r.emp_id);
    run("UPDATE requests SET status='approved', decided_by=?, note=?, decided_on=? WHERE id=?", user.id, 'New password set by admin', todayStr(), r.id);
  });
  M.run('DELETE FROM sessions WHERE company_id=? AND emp_id=?', ctx().company.id, r.emp_id);
  return { ok: true };
});

// ---------- master panel ----------
const CODE_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
const mroute = (m, p, h) => route(m, p, h, { master: true });
// Company logo: a small image stored as a data URL (the browser shrinks it to <=256px before upload).
function cleanLogo(l) {
  if (l === undefined || l === null || l === '') return null;
  if (typeof l !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(l)) bad('Logo must be a PNG, JPG or WebP image');
  if (l.length > 600000) bad('Logo image is too large (keep it under about 400 KB)');
  return l;
}
route('GET', '/api/logo/:code', ({ params, query }) => {
  const row = M.get('SELECT logo FROM companies WHERE code=?', String(params.code).toLowerCase());
  const m = row?.logo && /^data:(image\/\w+);base64,(.+)$/.exec(row.logo);
  if (!m) bad('No logo', 404);
  // versioned URLs (?v=<logo_v>, which the app always uses) can be cached forever; a bare URL must always be re-checked
  return { __raw: { type: m[1], buf: Buffer.from(m[2], 'base64'), cache: query.v ? 'public, max-age=31536000, immutable' : 'no-cache' } };
}, { public: true });
mroute('POST', '/api/master/companies/:id/logo', ({ params, body }) => {
  const c = company_(params.id), logo = cleanLogo(body.logo);
  M.run('UPDATE companies SET logo=?, logo_v=? WHERE id=?', logo, logo ? String(Date.now()) : null, c.id);
  return { ok: true };
});
const company_ = id => M.get('SELECT ' + CO_COLS + ' FROM companies WHERE id=?', id) || bad('Company not found', 404);
const pub_ = c => { const { db_file, ...r } = c; return r; };
const adminsOf = c => inCompany(c, () => all("SELECT id,emp_code,name,email,status FROM employees WHERE role='admin' ORDER BY id"));

mroute('GET', '/api/master/companies', () => M.all('SELECT ' + CO_COLS + ' FROM companies ORDER BY id').map(c => inCompany(c, () => ({ ...pub_(c),
  employees: get("SELECT COUNT(*) c FROM employees WHERE status!='exited'").c, admins: get("SELECT COUNT(*) c FROM employees WHERE role='admin' AND status!='exited'").c }))));
mroute('POST', '/api/master/companies', ({ user, body }) => {
  confirmPw(user, body);
  req_(body, 'name', 'code', 'admin_name', 'admin_email', 'admin_password');
  const code = String(body.code).trim().toLowerCase();
  if (!CODE_RE.test(code) || code === 'master') bad('Company code must be 2-31 chars: lowercase letters, digits, hyphen (not "master")');
  if (M.get('SELECT id FROM companies WHERE code=?', code)) bad('Company code already in use');
  if (String(body.admin_password).length < 6) bad('Admin password must be at least 6 characters');
  const prefix = String(body.emp_prefix || code.replace(/[^a-z]/g, '').slice(0, 4)).trim().toUpperCase();
  if (!/^[A-Z]{2,6}$/.test(prefix)) bad('Employee ID prefix must be 2-6 letters (e.g. ACME)');
  if (M.get('SELECT id FROM companies WHERE upper(emp_prefix)=?', prefix)) bad('That employee ID prefix is already used by another company');
  if (M.get('SELECT id FROM companies WHERE lower(admin_email)=lower(?)', body.admin_email)) bad('That admin email already belongs to another company');
  const logo = cleanLogo(body.logo);
  const file = code + '.db';
  if (tenantExists(file)) bad('Data for this company code already exists; choose another code');
  const id = M.run('INSERT INTO companies(code,name,db_file,created,admin_email,emp_prefix,logo,logo_v) VALUES(?,?,?,?,?,?,?,?)', code, body.name.trim(), file, todayStr(), body.admin_email.trim(), prefix, logo, logo ? String(Date.now()) : null).lastInsertRowid;
  const c = company_(id);
  try {
    inCompany(c, () => {
      const a = { name: c.name, adminName: body.admin_name, adminEmail: body.admin_email.trim(), adminPassword: body.admin_password, prefix };
      if (body.sample_data) { seedDemo(); run("UPDATE employees SET name=?,email=?,password_hash=? WHERE emp_code='HH001'", a.adminName, a.adminEmail, hash(a.adminPassword)); if (prefix !== 'HH') run('UPDATE employees SET emp_code = ? || SUBSTR(emp_code,3)', prefix); }
      else seedBasics(a);
    });
  } catch (e) { M.run('DELETE FROM companies WHERE id=?', id); deleteTenant(file); throw e; }
  return { id, code };
});
mroute('POST', '/api/master/companies/:id/status', ({ params, body }) => {
  const c = company_(params.id); if (!['active', 'suspended'].includes(body.status)) bad('Invalid status');
  M.run('UPDATE companies SET status=? WHERE id=?', body.status, c.id);
  if (body.status === 'suspended') M.run('DELETE FROM sessions WHERE company_id=?', c.id);
  return { ok: true };
});
mroute('POST', '/api/master/companies/:id/rename', ({ params, body }) => { req_(body, 'name'); company_(params.id); M.run('UPDATE companies SET name=? WHERE id=?', body.name.trim(), params.id); return { ok: true }; });
mroute('DELETE', '/api/master/companies/:id', ({ user, params, body }) => {
  confirmPw(user, body);
  const c = company_(params.id); if (body.confirm !== c.code) bad('Type the company code to confirm deletion');
  M.run('DELETE FROM sessions WHERE company_id=?', c.id); M.run('DELETE FROM companies WHERE id=?', c.id); deleteTenant(c.db_file);
  return { ok: true };
});
mroute('GET', '/api/master/companies/:id/admins', ({ params }) => adminsOf(company_(params.id)));
mroute('POST', '/api/master/companies/:id/admins/:eid/reset', ({ user, params, body }) => {
  confirmPw(user, body);
  req_(body, 'password'); const c = company_(params.id);
  if (String(body.password).length < 6) bad('Password must be at least 6 characters');
  inCompany(c, () => { const r = run("UPDATE employees SET password_hash=? WHERE id=? AND role='admin'", hash(body.password), params.eid); if (!r.changes) bad('Admin not found', 404); });
  M.run('DELETE FROM sessions WHERE company_id=? AND emp_id=?', c.id, +params.eid); return { ok: true };
});
mroute('POST', '/api/master/companies/:id/impersonate', ({ params, body }) => {
  const c = company_(params.id); if (c.status !== 'active') bad('Company is suspended');
  return inCompany(c, () => {
    const e = body.emp_id ? get("SELECT * FROM employees WHERE id=? AND role='admin' AND status!='exited'", body.emp_id) : get("SELECT * FROM employees WHERE role='admin' AND status!='exited' ORDER BY id LIMIT 1");
    if (!e) bad('No active admin in this company');
    const token = crypto.randomBytes(24).toString('hex');
    M.run('INSERT INTO sessions(token,company_id,emp_id,created) VALUES(?,?,?,?)', token, c.id, e.id, new Date().toISOString());
    return { token, user: publicEmp(e), company: { name: c.name, code: c.code, logo_v: c.logo_v || null } };
  });
});
mroute('POST', '/api/master/companies/:id/employees', ({ user, params, body }) => {
  confirmPw(user, body);
  const c = company_(params.id); if (c.status !== 'active') bad('Company is suspended');
  return inCompany(c, () => createEmployee(body));
});
mroute('POST', '/api/master/change-password', ({ user, body }) => {
  req_(body, 'current', 'next'); if (body.next.length < 6) bad('New password must be at least 6 characters');
  const m = M.get('SELECT * FROM masters WHERE id=?', user.id);
  if (!verify(body.current, m.password_hash)) bad('Current password is incorrect');
  M.run('UPDATE masters SET password_hash=? WHERE id=?', hash(body.next), user.id); return { ok: true };
});

// ---------- bootstrap ----------
// Master (platform owner) account. In production set MASTER_EMAIL / MASTER_PASSWORD (and optionally MASTER_NAME) as environment variables -
// credentials never live in the repository. The built-in dev default is only created outside production.
const MASTER_EMAIL = (process.env.MASTER_EMAIL || '').trim(), MASTER_PASSWORD = process.env.MASTER_PASSWORD || '';
if (MASTER_EMAIL && MASTER_PASSWORD) {
  if (!M.get('SELECT id FROM masters WHERE lower(email)=lower(?)', MASTER_EMAIL)) {
    M.run('INSERT INTO masters(name,email,password_hash) VALUES(?,?,?)', process.env.MASTER_NAME || 'Platform Owner', MASTER_EMAIL, hash(MASTER_PASSWORD));
    console.log('Created master account ' + MASTER_EMAIL);
  }
} else if (!M.get('SELECT id FROM masters')) {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) console.error('No master account: set MASTER_EMAIL and MASTER_PASSWORD environment variables.');
  else { M.run('INSERT INTO masters(name,email,password_hash) VALUES(?,?,?)', 'Platform Owner', 'master@hellohr.com', hash('master123')); console.log('Created dev master account master@hellohr.com / master123 - change it after first login.'); }
}
const SEED_DEMO = process.env.SEED_DEMO === '1' || (process.env.SEED_DEMO !== '0' && !process.env.VERCEL && process.env.NODE_ENV !== 'production');
if (!M.get('SELECT id FROM companies') && SEED_DEMO) {
  const legacy = path.join(__dirname, 'hellohr.db');
  if (!IS_PG && fs.existsSync(legacy)) M.run("INSERT INTO companies(code,name,db_file,created) VALUES('demo','Demo Company',?,?)", legacy, todayStr());
  else { M.run("INSERT INTO companies(code,name,db_file,created) VALUES('demo','Demo Company','demo.db',?)", todayStr()); inCompany(M.get("SELECT " + CO_COLS + " FROM companies WHERE code='demo'"), seedDemo); }
}

for (const c of M.all('SELECT * FROM companies WHERE admin_email IS NULL OR emp_prefix IS NULL')) {
  const a = inCompany(c, () => get("SELECT email, emp_code FROM employees WHERE role='admin' ORDER BY id LIMIT 1"));
  const pre = c.emp_prefix || (a && /^[A-Za-z]+/.exec(a.emp_code)?.[0].toUpperCase()) || c.code.replace(/[^a-z]/g, '').toUpperCase().slice(0, 4) || 'CO';
  M.run('UPDATE companies SET admin_email=COALESCE(admin_email,?), emp_prefix=COALESCE(emp_prefix,?) WHERE id=?', a?.email, pre, c.id);
}

for (const c of M.all('SELECT ' + CO_COLS + ' FROM companies')) inCompany(c, () => { normalizeRoles(); ensureLeaveTypes(); });

// ---------- server ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

const handler = (req, res) => {
  if (process.env.HH_DEBUG) { const q0 = queries(), t0 = Date.now(); res.on('finish', () => console.log(`${req.method} ${req.url.split('?')[0]} ${res.statusCode} ${queries() - q0} db-queries ${Date.now() - t0}ms`)); }
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'SAMEORIGIN'); res.setHeader('Referrer-Policy', 'same-origin');
  const url = new URL(req.url, 'http://x');
  const send = (code, obj) => {
    if (obj && obj.__raw) { res.writeHead(code, { 'Content-Type': obj.__raw.type, 'Cache-Control': obj.__raw.cache || 'no-cache', ...(obj.__raw.filename ? { 'Content-Disposition': 'inline; filename="' + encodeURIComponent(obj.__raw.filename) + '"' } : {}) }); return res.end(obj.__raw.buf); }
    res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj));
  };

  if (!url.pathname.startsWith('/api/')) {
    let f = path.normalize(path.join(PUB, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUB, 'index.html');
    res.writeHead(200, { 'Content-Type': (MIME[path.extname(f)] || 'application/octet-stream') + '; charset=utf-8' });
    const rs = fs.createReadStream(f); rs.on('error', () => { if (!res.headersSent) res.writeHead(404); res.end('Not found'); }); return rs.pipe(res);
  }

  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 6e6) req.destroy(); });
  req.on('end', () => {
    if (!raw && req.method !== 'GET' && req.method !== 'HEAD' && req.body) raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body);
    try {
      const r = routes.find(r => r.method === req.method && r.re.test(url.pathname));
      if (!r) return send(404, { error: 'Not found' });
      const params = r.re.exec(url.pathname).groups || {};
      let body = {}; if (raw) { try { body = JSON.parse(raw); } catch { return send(400, { error: 'Invalid JSON' }); } }
      const query = Object.fromEntries(url.searchParams);
      let user = null; const token = (req.headers.authorization || '').replace('Bearer ', '');
      if (!r.public) {
        const s = token && M.get('SELECT * FROM sessions WHERE token=?', token);
        if (!s) return send(401, { error: 'Please sign in' });
        if (s.master_id) {
          const m = M.get('SELECT id,name,email FROM masters WHERE id=?', s.master_id);
          if (!m) return send(401, { error: 'Please sign in' });
          if (!r.master && !r.any) return send(403, { error: 'Master accounts cannot use company screens' });
          return send(200, r.handler({ user: { ...m, role: 'master' }, params, body, query, token }));
        }
        if (r.master) return send(403, { error: 'Forbidden' });
        const c = M.get('SELECT ' + CO_COLS + ' FROM companies WHERE id=?', s.company_id);
        if (!c || c.status !== 'active') return send(401, { error: 'Please sign in' });
        return send(200, inCompany(c, () => {
          user = get("SELECT * FROM employees WHERE id=? AND status!='exited'", s.emp_id);
          if (!user) throw new HttpError(401, 'Please sign in');
          user.perms = parsePerms(user.permissions);
          return r.handler({ user, params, body, query, token });
        }));
      }
      send(200, r.handler({ user, params, body, query, token }));
    } catch (e) {
      if (e instanceof HttpError) return send(e.code, { error: e.message });
      console.error(e); send(500, { error: 'Server error: ' + e.message });
    }
  });
};

module.exports = handler;
if (require.main === module || (process.env.VERCEL && !process.env.HH_SERVERLESS)) http.createServer(handler).listen(PORT, () => console.log(`HelloHR running at http://localhost:${PORT}${IS_PG ? ' (PostgreSQL)' : ' (SQLite)'}`));
