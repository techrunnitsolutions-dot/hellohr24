// Database layer with two interchangeable backends behind the same synchronous API (all / get / run / tx):
//  - SQLite files (built-in node:sqlite)  -> local development and hosts with a persistent disk
//  - PostgreSQL (DATABASE_URL / POSTGRES_URL, e.g. Neon on Vercel) -> serverless hosting. The `pg` driver runs in a worker thread and the
//    main thread waits on it with Atomics, so the rest of the app can keep using simple blocking calls.
// Each company gets its own SQLite file, or its own Postgres schema (c_<code>). Platform tables (masters, companies, sessions) live in the "public" schema.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { isMainThread, workerData, parentPort, Worker, MessageChannel, receiveMessageOnPort } = require('worker_threads');

const PG_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || '';
const IS_PG = !!PG_URL;

// ================= Postgres worker thread =================
function runPgWorker() {
  let Client, loadError = null;
  try {
    const pg = require('pg'); Client = pg.Client;
    pg.types.setTypeParser(20, v => parseInt(v, 10));    // bigint (COUNT, SUM of ints) -> number
    pg.types.setTypeParser(1700, v => parseFloat(v));    // numeric -> number
  } catch (e) { loadError = e; }                        // reported to the caller instead of crashing the whole function
  let client = null, inTx = false;
  const connect = async () => {
    const c = new Client({ connectionString: workerData.url, connectionTimeoutMillis: 15000, query_timeout: 25000, keepAlive: true });
    c.on('error', () => { if (client === c) client = null; });
    await c.connect(); client = c; return c;
  };
  parentPort.on('message', async ({ sab, port, text, params, simple }) => {
    const flag = new Int32Array(sab); let out;
    if (loadError) { port.postMessage({ ok: false, message: 'Postgres driver unavailable: ' + loadError.message, code: loadError.code }); Atomics.store(flag, 0, 1); Atomics.notify(flag, 0); return; }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const c = client || await connect();
        const r = simple ? await c.query(text) : await c.query(text, params);
        const last = Array.isArray(r) ? r[r.length - 1] : r;
        if (simple) { const t = text.trim().toUpperCase(); if (t === 'BEGIN') inTx = true; else if (t === 'COMMIT' || t === 'ROLLBACK') inTx = false; }
        out = { ok: true, rows: last.rows || [], rowCount: last.rowCount };
        break;
      } catch (e) {
        const lost = /ECONNRESET|EPIPE|terminated|Connection|closed|not queryable|timeout/i.test(String(e.code) + ' ' + e.message) || ['57P01', '08006', '08003', '08001'].includes(e.code);
        if (lost) client = null;
        if (attempt === 0 && lost && !inTx) continue;
        if (lost) inTx = false;
        out = { ok: false, message: e.message, code: e.code };
        break;
      }
    }
    port.postMessage(out); Atomics.store(flag, 0, 1); Atomics.notify(flag, 0);
  });
}
if (!isMainThread && workerData && workerData.hellohrPg) { runPgWorker(); return; }

let worker = null, workerFailure = null, queryCount = 0;
function pgCall(text, params = [], simple = false) {
  queryCount++;
  if (!worker) { worker = new Worker(__filename, { workerData: { hellohrPg: true, url: PG_URL } }); worker.unref(); worker.on('error', e => { workerFailure = e; worker = null; }); }
  const { port1, port2 } = new MessageChannel(), sab = new SharedArrayBuffer(4), flag = new Int32Array(sab);
  worker.postMessage({ sab, port: port2, text, params, simple }, [port2]);
  const waited = Atomics.wait(flag, 0, 0, 120000);
  const m = receiveMessageOnPort(port1); port1.close();
  if (waited === 'timed-out' || !m) { const f = workerFailure; workerFailure = null; worker = null; throw new Error(f ? 'Database worker failed: ' + f.message : 'Database did not respond in time'); }
  if (!m.message.ok) { const e = new Error(m.message.message); e.code = m.message.code; throw e; }
  return m.message;
}

// ================= schema =================
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
const MASTER_SCHEMA = `
CREATE TABLE IF NOT EXISTS masters(id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS companies(id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, db_file TEXT NOT NULL, status TEXT DEFAULT 'active', created TEXT, admin_email TEXT, emp_prefix TEXT, logo TEXT, logo_v TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, company_id INTEGER, emp_id INTEGER, master_id INTEGER, created TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS ux_co_admin ON companies(lower(admin_email));
CREATE UNIQUE INDEX IF NOT EXISTS ux_co_prefix ON companies(upper(emp_prefix));
`;
const TENANT_TABLES = ['departments', 'employees', 'attendance', 'punches', 'settings', 'requests', 'leave_types', 'leaves', 'holidays', 'payruns', 'payslips', 'jobs', 'candidates', 'checklists', 'goals', 'reviews', 'expenses', 'tickets', 'assets', 'announcements', 'courses', 'enrollments'];
const MASTER_TABLES = ['masters', 'companies', 'sessions'];

// ================= SQLite -> Postgres translation =================
const NO_ID = new Set(['settings', 'sessions']);
const ddlToPg = ddl => ddl.replace(/INTEGER PRIMARY KEY/g, 'SERIAL PRIMARY KEY').replace(/\bREAL\b/g, 'DOUBLE PRECISION');
const pgCache = new Map();
function toPg(sql, schema, tables) {
  const key = schema + '\u0000' + sql; if (pgCache.has(key)) return pgCache.get(key);
  let s = sql;
  const target = /^\s*INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(\w+)/i.exec(s)?.[1]?.toLowerCase();
  const names = tables.join('|');
  s = s.replace(new RegExp(`\\b(FROM|JOIN|INTO|UPDATE)(\\s+)(${names})\\b`, 'gi'), (m, kw, sp, t) => `${kw}${sp}"${schema}"."${t.toLowerCase()}"`);
  const orIgnore = /^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(s);
  if (orIgnore) s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO');
  let n = 0, out = '', q = false;
  for (const ch of s) { if (ch === "'") q = !q; if (ch === '?' && !q) out += '$' + (++n); else out += ch; }
  s = out.trim().replace(/;$/, '');
  if (orIgnore && !/ON\s+CONFLICT/i.test(s)) s += ' ON CONFLICT DO NOTHING';
  if (target && !NO_ID.has(target) && !/RETURNING/i.test(s)) s += ' RETURNING id';
  pgCache.set(key, s); return s;
}
// A bad id typed in a URL (e.g. /employees/abc) should behave like "not found", as it does on SQLite
const tolerant = fn => { try { return fn(); } catch (e) { if (e.code === '22P02') return null; throw e; } };
function pgHandle(schema, tables) {
  return {
    prepare(sql) {
      const text = toPg(sql, schema, tables);
      return {
        all: (...p) => tolerant(() => pgCall(text, p).rows) || [],
        get: (...p) => (tolerant(() => pgCall(text, p).rows) || [])[0],
        run: (...p) => { const r = tolerant(() => pgCall(text, p)); return r ? { changes: r.rowCount, lastInsertRowid: r.rows[0]?.id } : { changes: 0 }; },
      };
    },
    exec(sql) { pgCall(sql, [], true); },
  };
}
const schemaOf = file => 'c_' + String(file).replace(/\.db$/, '').replace(/[^a-z0-9]/gi, '_').toLowerCase();
function pgEnsureSchema(schema, ddl) {
  pgCall(`BEGIN; SELECT pg_advisory_xact_lock(727274); CREATE SCHEMA IF NOT EXISTS "${schema}"; SET LOCAL search_path TO "${schema}"; ${ddlToPg(ddl)} COMMIT;`, [], true);
}

// ================= handles =================
const als = new AsyncLocalStorage();
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
let master, tenantDb, dropTenant, deleteTenant, tenantExists;
const tenants = new Map();

if (IS_PG) {
  pgEnsureSchema('public', MASTER_SCHEMA);
  pgCall('ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS logo TEXT; ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS logo_v TEXT;', [], true);
  master = pgHandle('public', MASTER_TABLES);
  tenantDb = file => {
    if (!tenants.has(file)) { const s = schemaOf(file); pgEnsureSchema(s, SCHEMA); tenants.set(file, pgHandle(s, TENANT_TABLES)); }
    return tenants.get(file);
  };
  dropTenant = file => tenants.delete(file);
  deleteTenant = file => { tenants.delete(file); pgCall(`DROP SCHEMA IF EXISTS "${schemaOf(file)}" CASCADE`, [], true); };
  tenantExists = file => pgCall('SELECT 1 x FROM information_schema.schemata WHERE schema_name=$1', [schemaOf(file)]).rows.length > 0;
} else {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(DATA, { recursive: true });
  const open = (file, schema) => { const d = new DatabaseSync(file); d.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;'); d.exec(schema); return d; };
  const columns = (db, table) => db.prepare('PRAGMA table_info(' + table + ')').all().map(c => c.name);
  const ensure = (db, table, cols) => { const have = columns(db, table); for (const [c, type] of Object.entries(cols)) if (!have.includes(c)) db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + c + ' ' + type); };
  master = open(path.join(process.env.DATA_DIR ? DATA : __dirname, 'master.db'), MASTER_SCHEMA.replace(/, admin_email TEXT, emp_prefix TEXT, logo TEXT, logo_v TEXT/, '').replace(/CREATE UNIQUE INDEX[^\n]*\n/g, ''));
  ensure(master, 'companies', { admin_email: 'TEXT', emp_prefix: 'TEXT', logo: 'TEXT', logo_v: 'TEXT' });
  master.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_co_admin ON companies(lower(admin_email)); CREATE UNIQUE INDEX IF NOT EXISTS ux_co_prefix ON companies(upper(emp_prefix));');
  tenantDb = file => {
    if (!tenants.has(file)) {
      const t = open(path.isAbsolute(file) ? file : path.join(DATA, file), SCHEMA);
      ensure(t, 'employees', { permissions: 'TEXT', work_type: "TEXT DEFAULT 'Office'", geo_exempt: 'INTEGER DEFAULT 0' });
      ensure(t, 'attendance', { manual: 'INTEGER DEFAULT 0' });
      ensure(t, 'leave_types', { kind: "TEXT DEFAULT 'leave'" });
      ensure(t, 'punches', { in_lat: 'REAL', in_lng: 'REAL', in_acc: 'REAL', in_dist: 'REAL', in_away: 'INTEGER DEFAULT 0', out_lat: 'REAL', out_lng: 'REAL', out_acc: 'REAL', out_dist: 'REAL', out_away: 'INTEGER DEFAULT 0' });
      tenants.set(file, t);
    }
    return tenants.get(file);
  };
  dropTenant = file => { const d = tenants.get(file); if (d) { d.close(); tenants.delete(file); } };
  const filePath = file => path.isAbsolute(file) ? file : path.join(DATA, file);
  deleteTenant = file => { dropTenant(file); for (const x of ['', '-wal', '-shm']) fs.rmSync(filePath(file) + x, { force: true }); };
  tenantExists = file => fs.existsSync(filePath(file));
}

const cur = () => { const s = als.getStore(); if (!s) throw new Error('No company context'); return s.db; };
const ctx = () => als.getStore();
const inCompany = (company, fn) => als.run({ db: tenantDb(company.db_file), company }, fn);
const nul = p => p.map(v => v ?? null);
const M = {
  all: (sql, ...p) => master.prepare(sql).all(...nul(p)),
  get: (sql, ...p) => master.prepare(sql).get(...nul(p)),
  run: (sql, ...p) => master.prepare(sql).run(...nul(p)),
};
const clean = p => p.map(v => (v === undefined ? null : typeof v === 'boolean' ? +v : v));
const all = (sql, ...p) => cur().prepare(sql).all(...clean(p));
const get = (sql, ...p) => cur().prepare(sql).get(...clean(p));
const run = (sql, ...p) => cur().prepare(sql).run(...clean(p));
const tx = fn => { cur().exec('BEGIN'); try { const r = fn(); cur().exec('COMMIT'); return r; } catch (e) { try { cur().exec('ROLLBACK'); } catch {} throw e; } };

const hash = pw => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(pw, s, 32).toString('hex'); };
const verify = (pw, h) => { const [s, k] = h.split(':'); return crypto.timingSafeEqual(Buffer.from(k, 'hex'), crypto.scryptSync(pw, s, 32)); };

const queries = () => queryCount;
module.exports = { queries, all, get, run, tx, hash, verify, M, ctx, inCompany, tenantDb, dropTenant, deleteTenant, tenantExists, DATA, als, IS_PG };
