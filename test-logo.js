// Checks the company-logo feature against a running server:  BASE=... MASTER_EMAIL=... MASTER_PASSWORD=... node test-logo.js
const zlib = require('zlib');
const BASE = process.env.BASE || 'http://localhost:3000', ME = process.env.MASTER_EMAIL, MP = process.env.MASTER_PASSWORD;
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : (fail++, console.log('FAIL', n, x)); };
const api = async (m, u, t, b) => { const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
// build a small valid PNG (a coloured disc) without any image library
function png(size = 96, rgb = [79, 70, 229]) {
  const raw = Buffer.alloc((size * 4 + 1) * size), c = size / 2;
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; for (let x = 0; x < size; x++) { const o = y * (size * 4 + 1) + 1 + x * 4, d = Math.hypot(x - c, y - c); raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; raw[o + 3] = d < c - 2 ? 255 : 0; } }
  const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]), cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([l, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
(async () => {
  const code = 'logotest' + Math.floor(Math.random() * 1e6), dataUrl = 'data:image/png;base64,' + png().toString('base64');
  const mt = (await api('POST', '/api/login', null, { portal: 'master', identifier: ME, password: MP })).body.token; ok('master login', !!mt);
  ok('rejects a non-image', (await api('POST', '/api/master/companies', mt, { name: 'Bad', code: code + 'x', admin_name: 'a', admin_email: code + 'x@t.com', admin_password: 'secret1', logo: 'data:text/html;base64,PHNjcmlwdD4=', confirm_password: MP })).status === 400);
  ok('rejects svg', (await api('POST', '/api/master/companies', mt, { name: 'Bad', code: code + 'y', admin_name: 'a', admin_email: code + 'y@t.com', admin_password: 'secret1', logo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', confirm_password: MP })).status === 400);
  const co = await api('POST', '/api/master/companies', mt, { name: 'Logo Test Co', code, emp_prefix: 'LGT', admin_name: 'Lola', admin_email: code + '@t.com', admin_password: 'secret1', logo: dataUrl, confirm_password: MP }); ok('create company with logo', co.status === 200, JSON.stringify(co.body));
  const list = (await api('GET', '/api/master/companies', mt)).body.find(c => c.code === code); ok('list shows logo version but not the image', list.logo_v && !('logo' in list), JSON.stringify(list).slice(0, 200));
  const img = await fetch(`${BASE}/api/logo/${code}`); const buf = Buffer.from(await img.arrayBuffer()); ok('logo served as an image', img.status === 200 && /image\/png/.test(img.headers.get('content-type')) && buf.subarray(1, 4).toString() === 'PNG', img.status + ' ' + img.headers.get('content-type')); ok('served bytes match', buf.equals(png()));
  const ad = await api('POST', '/api/login', null, { portal: 'admin', identifier: code + '@t.com', password: 'secret1' }); ok('admin login returns logo_v', ad.body.company?.logo_v === list.logo_v, JSON.stringify(ad.body.company));
  ok('admin /api/me has logo_v + name', (await api('GET', '/api/me', ad.body.token)).body.company?.logo_v === list.logo_v);
  const e = await api('POST', '/api/employees', ad.body.token, { name: 'Eli', email: 'eli@t.com', join_date: '2026-10-01', confirm_password: 'secret1' });
  const el = await api('POST', '/api/login', null, { portal: 'employee', identifier: e.body.emp_code, password: e.body.password }); ok('employee sees the same company logo', el.body.company?.logo_v === list.logo_v && el.body.company?.name === 'Logo Test Co');
  const other = await fetch(`${BASE}/api/logo/doesnotexist`); ok('unknown company -> 404', other.status === 404);
  ok('change logo', (await api('POST', `/api/master/companies/${co.body.id}/logo`, mt, { logo: 'data:image/png;base64,' + png(64, [220, 38, 38]).toString('base64') })).status === 200);
  const buf2 = Buffer.from(await (await fetch(`${BASE}/api/logo/${code}`)).arrayBuffer()); ok('new logo is served', buf2.equals(png(64, [220, 38, 38])));
  ok('new version number after change', (await api('GET', '/api/me', ad.body.token)).body.company.logo_v !== list.logo_v);
  ok('company admin cannot change it', (await api('POST', `/api/master/companies/${co.body.id}/logo`, ad.body.token, { logo: null })).status === 403);
  ok('remove logo', (await api('POST', `/api/master/companies/${co.body.id}/logo`, mt, { logo: null })).status === 200);
  ok('removed -> 404 and no logo_v', (await fetch(`${BASE}/api/logo/${code}`)).status === 404 && (await api('GET', '/api/me', ad.body.token)).body.company.logo_v === null);
  ok('cleanup', (await api('DELETE', `/api/master/companies/${co.body.id}`, mt, { confirm: code, confirm_password: MP })).status === 200);
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
