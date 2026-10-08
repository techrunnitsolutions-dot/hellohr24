// Employee profile / documents / forgot-password checks against a running server:
//   BASE=... MASTER_EMAIL=... MASTER_PASSWORD=... node test-profile.js
const BASE = process.env.BASE || 'http://localhost:3000', ME = process.env.MASTER_EMAIL, MP = process.env.MASTER_PASSWORD;
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : (fail++, console.log('FAIL', n, x)); };
const api = async (m, u, t, b) => { const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
const JPG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0]), Buffer.alloc(300, 7), Buffer.from([0xFF, 0xD9])]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const up = (t, type, buf, mime, name) => api('POST', '/api/profile/documents', t, { doc_type: type, filename: name || 'file', mime, data: buf.toString('base64') });
(async () => {
  const code = 'proftest' + Math.floor(Math.random() * 1e6);
  const mt = (await api('POST', '/api/login', null, { portal: 'master', identifier: ME, password: MP })).body.token;
  const co = await api('POST', '/api/master/companies', mt, { name: 'Profile Test Co', code, emp_prefix: 'PRT', admin_name: 'Pia', admin_email: code + '@t.com', admin_password: 'secret1', confirm_password: MP }); ok('create company', co.status === 200, JSON.stringify(co.body));
  const at = (await api('POST', '/api/login', null, { portal: 'admin', identifier: code + '@t.com', password: 'secret1' })).body.token;
  const mk = async (n, e) => { const r = await api('POST', '/api/employees', at, { name: n, email: e, join_date: '2026-10-01', confirm_password: 'secret1' }); const l = await api('POST', '/api/login', null, { portal: 'employee', identifier: r.body.emp_code, password: r.body.password }); return { id: r.body.id, code: r.body.emp_code, pw: r.body.password, t: l.body.token }; };
  const e1 = await mk('Ravi Kumar', 'ravi@t.com'), e2 = await mk('Sita Rao', 'sita@t.com');

  let p = await api('GET', '/api/profile', e1.t); ok('empty profile starts at a low %', p.status === 200 && p.body.completion.pct === 0 && p.body.completion.missing.length >= 15, JSON.stringify(p.body.completion));
  ok('invalid Aadhaar rejected', (await api('PUT', '/api/profile', e1.t, { aadhaar_no: '1234' })).status === 400);
  ok('invalid PAN rejected', (await api('PUT', '/api/profile', e1.t, { pan_no: 'abc' })).status === 400);
  ok('invalid IFSC rejected', (await api('PUT', '/api/profile', e1.t, { bank_ifsc: 'XYZ' })).status === 400);
  ok('invalid phone rejected', (await api('PUT', '/api/profile', e1.t, { phone: '123' })).status === 400);
  const save = await api('PUT', '/api/profile', e1.t, { display_name: 'Ravi', full_name: 'Ravi Kumar Sharma', father_name: 'Mohan Sharma', dob: '1995-03-12', gender: 'Male', phone: '9876543210', current_address: '12 MG Road, Pune', emergency_name: 'Mohan', emergency_relation: 'Father', emergency_phone: '9811122233',
    aadhaar_no: '1234 5678 9012', pan_no: 'abcde1234f', bank_holder: 'Ravi Kumar Sharma', bank_account_no: '123456789012', bank_ifsc: 'hdfc0001234', bank_name: 'HDFC Bank', bank_branch: 'Pune', bank_branch_code: '001234', experience_type: 'experienced', prev_company: 'Acme', last_salary: '600000' });
  ok('valid details saved', save.status === 200 && save.body.completion.pct > 40, JSON.stringify(save.body));
  p = await api('GET', '/api/profile', e1.t); ok('values normalised (PAN/IFSC upper, Aadhaar digits only)', p.body.fields.pan_no === 'ABCDE1234F' && p.body.fields.bank_ifsc === 'HDFC0001234' && p.body.fields.aadhaar_no === '123456789012');
  const me = await api('GET', '/api/employees/' + e1.id, at); ok('main employee record synced (PAN, bank a/c, phone)', me.body.pan === 'ABCDE1234F' && me.body.bank_account === '123456789012' && me.body.phone === '9876543210', JSON.stringify(me.body).slice(0, 200));

  ok('upload Aadhaar front (jpg)', (await up(e1.t, 'aadhaar_front', JPG, 'image/jpeg', 'aadhaar-front.jpg')).status === 200);
  ok('upload Aadhaar back (pdf)', (await up(e1.t, 'aadhaar_back', PDF, 'application/pdf', 'aadhaar-back.pdf')).status === 200);
  ok('upload PAN', (await up(e1.t, 'pan_front', JPG, 'image/jpeg')).status === 200);
  ok('upload bank proof', (await up(e1.t, 'bank_proof', PDF, 'application/pdf')).status === 200);
  ok('upload profile photo', (await up(e1.t, 'profile_photo', JPG, 'image/jpeg', 'me.jpg')).status === 200);
  ok('photo must be an image', (await up(e1.t, 'profile_photo', PDF, 'application/pdf')).status === 400);
  ok('two marksheets (multi)', (await up(e1.t, 'marksheet', JPG, 'image/jpeg', '10th.jpg')).status === 200 && (await up(e1.t, 'marksheet', PDF, 'application/pdf', '12th.pdf')).status === 200);
  for (const [t, n] of [['offer_letter', 'offer.pdf'], ['salary_slip', 'slip.pdf'], ['relieving_letter', 'relieving.pdf'], ['experience_letter', 'exp.pdf']]) ok('upload ' + t, (await up(e1.t, t, PDF, 'application/pdf', n)).status === 200);
  ok('certificates (multi)', (await up(e1.t, 'certificate', PDF, 'application/pdf', 'cert.pdf')).status === 200);
  ok('re-uploading a single slot replaces it', (await up(e1.t, 'pan_front', JPG, 'image/jpeg', 'pan2.jpg')).body.docs.filter(d => d.doc_type === 'pan_front').length === 1);
  ok('unknown type rejected', (await up(e1.t, 'passport_hack', JPG, 'image/jpeg')).status === 400);
  ok('fake pdf rejected (content check)', (await up(e1.t, 'other', JPG, 'application/pdf')).status === 400);
  ok('html rejected', (await up(e1.t, 'other', Buffer.from('<script>alert(1)</script>'), 'text/html')).status === 400);
  ok('oversized pdf rejected', (await up(e1.t, 'other', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(3.2e6, 1)]), 'application/pdf')).status === 400);
  p = await api('GET', '/api/profile', e1.t); ok('profile is 100% complete', p.body.completion.pct === 100, JSON.stringify(p.body.completion));
  ok('document list does not leak file contents', p.body.docs.every(d => !('data' in d)) && p.body.docs.length >= 12);

  const doc = p.body.docs.find(d => d.doc_type === 'aadhaar_back'), raw = await fetch(`${BASE}/api/documents/${doc.id}`, { headers: { Authorization: 'Bearer ' + e1.t } });
  ok('owner downloads own document (bytes identical)', raw.status === 200 && raw.headers.get('content-type') === 'application/pdf' && Buffer.from(await raw.arrayBuffer()).equals(PDF));
  ok('admin can download it', (await fetch(`${BASE}/api/documents/${doc.id}`, { headers: { Authorization: 'Bearer ' + at } })).status === 200);
  ok('another employee cannot download it', (await fetch(`${BASE}/api/documents/${doc.id}`, { headers: { Authorization: 'Bearer ' + e2.t } })).status === 403);
  ok('no login -> 401', (await fetch(`${BASE}/api/documents/${doc.id}`)).status === 401);
  ok('another employee cannot read the profile', (await api('GET', '/api/profile?emp_id=' + e1.id, e2.t)).status === 403);
  const ap = await api('GET', '/api/profile?emp_id=' + e1.id, at); ok('admin reads the profile', ap.status === 200 && ap.body.fields.aadhaar_no === '123456789012' && ap.body.editable === false);
  ok('admin cannot edit the employee profile via PUT', (await api('PUT', '/api/profile', at, { full_name: 'Hacked' })).status === 200 && (await api('GET', '/api/profile?emp_id=' + e1.id, at)).body.fields.full_name === 'Ravi Kumar Sharma');
  const list = (await api('GET', '/api/employees', at)).body; ok('employees list shows profile %', list.find(e => e.id === e1.id)?.profile_pct === 100 && list.find(e => e.id === e2.id)?.profile_pct === 0, JSON.stringify(list.map(e => e.profile_pct)));
  ok('regular employees do not get profile %', (await api('GET', '/api/employees', e2.t)).body.every(e => e.profile_pct === undefined));
  ok('dashboard reports profile %', (await api('GET', '/api/dashboard', e2.t)).body.profilePct === 0);
  ok('/api/me exposes the photo id', (await api('GET', '/api/me', e1.t)).body.photo_id === p.body.docs.find(d => d.doc_type === 'profile_photo').id);
  ok('delete a document', (await api('DELETE', '/api/profile/documents/' + p.body.docs.find(d => d.doc_type === 'certificate').id, e1.t)).status === 200);
  ok('cannot delete someone else\'s document', (await api('DELETE', '/api/profile/documents/' + doc.id, e2.t)).status === 404);

  // forgot password
  const fp = await api('POST', '/api/forgot-password', null, { identifier: e2.code, note: 'I forgot it' }); ok('forgot-password accepted', fp.status === 200 && /notified/.test(fp.body.message), JSON.stringify(fp.body));
  ok('unknown id gets the same answer (no account enumeration)', (await api('POST', '/api/forgot-password', null, { identifier: 'PRT999' })).body.message === fp.body.message);
  ok('admin accounts cannot be reset this way', (await api('POST', '/api/forgot-password', null, { identifier: 'PRT001' })).status === 200);
  await api('POST', '/api/forgot-password', null, { identifier: e2.code });
  const reqs = (await api('GET', '/api/requests?scope=manage', at)).body.filter(r => r.type === 'password_reset'); ok('admin sees exactly one pending reset (no duplicates)', reqs.length === 1 && reqs[0].emp_id === e2.id && reqs[0].status === 'pending', JSON.stringify(reqs));
  ok('employee cannot approve it', (await api('POST', `/api/requests/${reqs[0].id}/reset-password`, e1.t, { password: 'newpass1', confirm_password: 'secret1' })).status === 403);
  ok('admin needs their password to confirm', (await api('POST', `/api/requests/${reqs[0].id}/reset-password`, at, { password: 'newpass1' })).status === 403);
  ok('short password refused', (await api('POST', `/api/requests/${reqs[0].id}/reset-password`, at, { password: '123', confirm_password: 'secret1' })).status === 400);
  ok('plain approve is blocked', (await api('POST', `/api/requests/${reqs[0].id}/decide`, at, { status: 'approved' })).status === 400);
  ok('admin sets a new password', (await api('POST', `/api/requests/${reqs[0].id}/reset-password`, at, { password: 'newpass1', confirm_password: 'secret1' })).status === 200);
  ok('old password no longer works', (await api('POST', '/api/login', null, { portal: 'employee', identifier: e2.code, password: e2.pw })).status === 401);
  ok('new password works', (await api('POST', '/api/login', null, { portal: 'employee', identifier: e2.code, password: 'newpass1' })).status === 200);
  ok('old session was signed out', (await api('GET', '/api/me', e2.t)).status === 401);

  ok('cleanup', (await api('DELETE', `/api/master/companies/${co.body.id}`, mt, { confirm: code, confirm_password: MP })).status === 200);
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
