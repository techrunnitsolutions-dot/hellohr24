// Diagnostics for deployments: GET /api/health  (add ?app=1 to also try to boot the whole app).
// Reveals only whether things are configured / reachable - never credentials or hostnames.
const path = require('path'), fs = require('fs');
const redact = s => String(s || '').replace(/postgres(ql)?:\/\/\S+/gi, 'postgres://***').replace(/\b[\w.-]+\.(neon\.tech|vercel-storage\.com)\b/gi, '<host>').slice(0, 300);

module.exports = async (req, res) => {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || '';
  const out = { node: process.version, vercel: !!process.env.VERCEL, region: process.env.VERCEL_REGION || null,
    env: { DATABASE_URL: !!process.env.DATABASE_URL, POSTGRES_URL: !!process.env.POSTGRES_URL, MASTER_EMAIL: !!process.env.MASTER_EMAIL, MASTER_PASSWORD: !!process.env.MASTER_PASSWORD },
    files: { server: fs.existsSync(path.join(__dirname, '..', 'server.js')), db: fs.existsSync(path.join(__dirname, '..', 'db.js')), publicIndex: fs.existsSync(path.join(__dirname, '..', 'public', 'index.html')) } };
  try { require('pg'); out.pgDriver = 'ok'; } catch (e) { out.pgDriver = 'missing: ' + redact(e.message); }
  try {
    const { Worker } = require('worker_threads');
    await new Promise((ok, no) => { const w = new Worker('require("worker_threads").parentPort.postMessage(1)', { eval: true }); w.on('message', ok); w.on('error', no); setTimeout(() => no(new Error('timeout')), 5000); });
    out.workerThreads = 'ok';
  } catch (e) { out.workerThreads = 'failed: ' + redact(e.message); }
  if (url) {
    try {
      const { Client } = require('pg'); const c = new Client({ connectionString: url, connectionTimeoutMillis: 8000, query_timeout: 8000 });
      await c.connect(); const r = await c.query('select current_database() d'); out.database = { ok: true, name: r.rows[0].d }; await c.end();
    } catch (e) { out.database = { ok: false, error: redact(e.message) }; }
  } else out.database = { ok: false, error: 'no DATABASE_URL / POSTGRES_URL set' };
  if (req.url.includes('app=1')) {
    try { require('../server.js'); out.app = 'booted'; } catch (e) { out.app = 'failed: ' + (e.code ? e.code + ' ' : '') + redact(e.message); }
  }
  res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(out, null, 2));
};
