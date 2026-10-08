const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('crypto');


const SCHEMA = `
CREATE TABLE IF NOT EXISTS departments(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS employees(
  id INTEGER PRIMARY KEY, emp_code TEXT UNIQUE, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'employee',
  phone TEXT, dept_id INTEGER REFERENCES departments(id), designation TEXT,
  manager_id INTEGER REFERENCES employees(id), join_date TEXT, status TEXT NOT NULL DEFAULT 'active',
  gender TEXT, dob TEXT, address TEXT, ctc REAL DEFAULT 0, pan TEXT, bank_account TEXT,
  location TEXT, employment_type TEXT DEFAULT 'Full-time', exit_date TEXT, exit_reason TEXT, permissions TEXT, work_type TEXT DEFAULT 'Office', geo_exempt INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS attendance(
  id INTEGER PRIMARY KEY, emp_id INTEGER NOT NULL, date TEXT NOT NULL, check_in TEXT, check_out TEXT,
  status TEXT NOT NULL DEFAULT 'present', mode TEXT DEFAULT 'office', manual INTEGER DEFAULT 0, UNIQUE(emp_id,date));
CREATE TABLE IF NOT EXISTS punches(id INTEGER PRIMARY KEY, emp_id INTEGER NOT NULL, date TEXT NOT NULL, in_time TEXT NOT NULL, out_time TEXT, mode TEXT DEFAULT 'office', in_lat REAL, in_lng REAL, in_acc REAL, in_dist REAL, in_away INTEGER DEFAULT 0, out_lat REAL, out_lng REAL, out_acc REAL, out_dist REAL, out_away INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_punches ON punches(emp_id,date);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY, emp_id INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT, reason TEXT, status TEXT DEFAULT 'pending', decided_by INTEGER, note TEXT, created TEXT, decided_on TEXT);
CREATE TABLE IF NOT EXISTS leave_types(id INTEGER PRIMARY KEY, name TEXT UNIQUE, days_per_year REAL, is_paid INTEGER DEFAULT 1, kind TEXT DEFAULT 'leave');
CREATE TABLE IF NOT EXISTS leaves(
  id INTEGER PRIMARY KEY, emp_id INTEGER NOT NULL, type_id INTEGER NOT NULL, from_date TEXT, to_date TEXT,
  days REAL, reason TEXT, status TEXT DEFAULT 'pending', approver_id INTEGER, note TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS holidays(id INTEGER PRIMARY KEY, date TEXT UNIQUE, name TEXT);
CREATE TABLE IF NOT EXISTS payruns(id INTEGER PRIMARY KEY, month TEXT UNIQUE, status TEXT DEFAULT 'draft', created TEXT, finalized TEXT);
CREATE TABLE IF NOT EXISTS payslips(
  id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL, emp_id INTEGER NOT NULL, month TEXT,
  working_days REAL, paid_days REAL, lop_days REAL, basic REAL, hra REAL, special REAL, gross REAL,
  pf REAL, pt REAL, tds REAL, reimbursements REAL, deductions REAL, net REAL);
CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY, title TEXT, dept_id INTEGER, openings INTEGER DEFAULT 1, location TEXT, description TEXT, status TEXT DEFAULT 'open', created TEXT);
CREATE TABLE IF NOT EXISTS candidates(id INTEGER PRIMARY KEY, job_id INTEGER, name TEXT, email TEXT, phone TEXT, stage TEXT DEFAULT 'Applied', notes TEXT, expected_ctc REAL, created TEXT);
CREATE TABLE IF NOT EXISTS checklists(id INTEGER PRIMARY KEY, emp_id INTEGER, kind TEXT, title TEXT, done INTEGER DEFAULT 0, done_on TEXT);
CREATE TABLE IF NOT EXISTS goals(id INTEGER PRIMARY KEY, emp_id INTEGER, title TEXT, description TEXT, progress INTEGER DEFAULT 0, due TEXT, status TEXT DEFAULT 'active');
CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY, emp_id INTEGER, reviewer_id INTEGER, cycle TEXT, rating INTEGER, comments TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY, emp_id INTEGER, category TEXT, amount REAL, date TEXT, description TEXT, status TEXT DEFAULT 'pending', decided_by INTEGER, reimbursed_run INTEGER, created TEXT);
CREATE TABLE IF NOT EXISTS tickets(id INTEGER PRIMARY KEY, emp_id INTEGER, subject TEXT, category TEXT, description TEXT, status TEXT DEFAULT 'open', response TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS assets(id INTEGER PRIMARY KEY, name TEXT, tag TEXT UNIQUE, category TEXT, assigned_to INTEGER, status TEXT DEFAULT 'available', assigned_on TEXT);
CREATE TABLE IF NOT EXISTS announcements(id INTEGER PRIMARY KEY, title TEXT, body TEXT, author_id INTEGER, created TEXT);
CREATE TABLE IF NOT EXISTS courses(id INTEGER PRIMARY KEY, title TEXT, description TEXT, duration TEXT, mandatory INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS enrollments(id INTEGER PRIMARY KEY, emp_id INTEGER, course_id INTEGER, progress INTEGER DEFAULT 0, UNIQUE(emp_id,course_id));
`;

const als = new AsyncLocalStorage();
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });
const open = (file, schema) => { const d = new DatabaseSync(file); d.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;'); d.exec(schema); return d; };
const MASTER_SCHEMA = `
CREATE TABLE IF NOT EXISTS masters(id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS companies(id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, db_file TEXT NOT NULL, status TEXT DEFAULT 'active', created TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, company_id INTEGER, emp_id INTEGER, master_id INTEGER, created TEXT);
`;
const master = open(path.join(process.env.DATA_DIR ? DATA : __dirname, 'master.db'), MASTER_SCHEMA);
for (const col of ['admin_email', 'emp_prefix'])
  if (!master.prepare('PRAGMA table_info(companies)').all().some(c => c.name === col)) master.exec('ALTER TABLE companies ADD COLUMN ' + col + ' TEXT');
master.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_co_admin ON companies(lower(admin_email)); CREATE UNIQUE INDEX IF NOT EXISTS ux_co_prefix ON companies(upper(emp_prefix));');
const tenants = new Map();
const tenantDb = file => {
  if (!tenants.has(file)) {
    const t = open(path.isAbsolute(file) ? file : path.join(DATA, file), SCHEMA);
    if (!t.prepare('PRAGMA table_info(employees)').all().some(c => c.name === 'permissions')) t.exec('ALTER TABLE employees ADD COLUMN permissions TEXT');
    if (!t.prepare('PRAGMA table_info(attendance)').all().some(c => c.name === 'manual')) t.exec('ALTER TABLE attendance ADD COLUMN manual INTEGER DEFAULT 0');
    if (!t.prepare('PRAGMA table_info(leave_types)').all().some(c => c.name === 'kind')) t.exec("ALTER TABLE leave_types ADD COLUMN kind TEXT DEFAULT 'leave'");
    if (!t.prepare('PRAGMA table_info(employees)').all().some(c => c.name === 'work_type')) t.exec("ALTER TABLE employees ADD COLUMN work_type TEXT DEFAULT 'Office'");
    const ensure = (table, cols) => { const have = t.prepare('PRAGMA table_info(' + table + ')').all().map(c => c.name); for (const [c, type] of Object.entries(cols)) if (!have.includes(c)) t.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + c + ' ' + type); };
    ensure('employees', { geo_exempt: 'INTEGER DEFAULT 0' });
    ensure('punches', { in_lat: 'REAL', in_lng: 'REAL', in_acc: 'REAL', in_dist: 'REAL', in_away: 'INTEGER DEFAULT 0', out_lat: 'REAL', out_lng: 'REAL', out_acc: 'REAL', out_dist: 'REAL', out_away: 'INTEGER DEFAULT 0' });
    tenants.set(file, t);
  }
  return tenants.get(file);
};
const dropTenant = file => { const d = tenants.get(file); if (d) { d.close(); tenants.delete(file); } };
const cur = () => { const s = als.getStore(); if (!s) throw new Error('No company context'); return s.db; };
const ctx = () => als.getStore();
const inCompany = (company, fn) => als.run({ db: tenantDb(company.db_file), company }, fn);
const M = {
  all: (sql, ...p) => master.prepare(sql).all(...p.map(v => v ?? null)),
  get: (sql, ...p) => master.prepare(sql).get(...p.map(v => v ?? null)),
  run: (sql, ...p) => master.prepare(sql).run(...p.map(v => v ?? null)),
};

const clean = p => p.map(v => (v === undefined ? null : typeof v === 'boolean' ? +v : v));
const all = (sql, ...p) => cur().prepare(sql).all(...clean(p));
const get = (sql, ...p) => cur().prepare(sql).get(...clean(p));
const run = (sql, ...p) => cur().prepare(sql).run(...clean(p));
const tx = fn => { cur().exec("BEGIN"); try { const r = fn(); cur().exec("COMMIT"); return r; } catch (e) { cur().exec("ROLLBACK"); throw e; } };

const hash = pw => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(pw, s, 32).toString('hex'); };
const verify = (pw, h) => { const [s, k] = h.split(':'); return crypto.timingSafeEqual(Buffer.from(k, 'hex'), crypto.scryptSync(pw, s, 32)); };

module.exports = { all, get, run, tx, hash, verify, M, ctx, inCompany, tenantDb, dropTenant, DATA, als };
