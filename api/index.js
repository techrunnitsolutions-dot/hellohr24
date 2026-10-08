// Vercel serverless entry: every request (pages and /api/*) is handled by the same HelloHR request handler.
// If the app cannot start (most often: no database connected yet) we answer with a readable message instead of a bare 500.
process.env.HH_SERVERLESS = '1';   // tells server.js not to open its own port
let handler = null, startupError = null;
try { handler = require('../server.js'); } catch (e) { startupError = e; console.error('HelloHR failed to start:', e); }

const redact = s => String(s || '').replace(/postgres(ql)?:\/\/\S+/gi, 'postgres://***').slice(0, 300);
module.exports = (req, res) => {
  if (handler) return handler(req, res);
  const hasDb = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING);
  const hasMaster = !!(process.env.MASTER_EMAIL && process.env.MASTER_PASSWORD);
  res.statusCode = 503; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  res.end(!hasDb
    ? 'HelloHR is not configured yet: no database is connected.\nIn Vercel open the project -> Storage -> Create Database -> Neon (Postgres), connect it to this project, then Redeploy.'
    : `HelloHR could not start.\nReason: ${startupError && (startupError.code ? startupError.code + ': ' : '')}${redact(startupError && startupError.message)}${hasMaster ? '' : '\nAlso set the MASTER_EMAIL and MASTER_PASSWORD environment variables.'}`);
};
