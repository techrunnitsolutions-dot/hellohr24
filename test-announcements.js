// Announcements with audience, attachment, required file / reply:  BASE=http://localhost:3000 MASTER_EMAIL=... MASTER_PASSWORD=... node test-announcements.js
const BASE = process.env.BASE || 'http://localhost:3000', ME = process.env.MASTER_EMAIL, MP = process.env.MASTER_PASSWORD;
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : (fail++, console.log('FAIL', n, x)); };
const api = async (m, u, t, b) => { const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
const raw = async (u, t) => { const r = await fetch(BASE + u, { headers: t ? { Authorization: 'Bearer ' + t } : {} }); return { status: r.status, type: r.headers.get('content-type'), buf: Buffer.from(await r.arrayBuffer()) }; };
const PDF = { filename: 'notice.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4\n% test notice\n').toString('base64') };
const PNG = { filename: 'proof.png', mime: 'image/png', data: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4]).toString('base64') };
(async () => {
  const code = 'ann' + Math.floor(Math.random() * 1e6), mt = (await api('POST', '/api/login', null, { portal: 'master', identifier: ME, password: MP })).body.token;
  await api('POST', '/api/master/companies', mt, { name: 'Ann Co', code, emp_prefix: 'ANN', admin_name: 'Ada', admin_email: code + '@t.com', admin_password: 'secret1', confirm_password: MP });
  const at = (await api('POST', '/api/login', null, { portal: 'admin', identifier: code + '@t.com', password: 'secret1' })).body.token, PW = { confirm_password: 'secret1' };
  const mk = async (n, e) => (await api('POST', '/api/employees', at, { name: n, email: e, join_date: '2025-01-01', ...PW })).body;
  const e1 = await mk('One', '1@t.com'), e2 = await mk('Two', '2@t.com'), e3 = await mk('Three', '3@t.com');
  const login = async x => (await api('POST', '/api/login', null, { portal: 'employee', identifier: x.emp_code, password: x.password })).body.token;
  const t1 = await login(e1), t2 = await login(e2), t3 = await login(e3);
  const post = (b, t = at) => api('POST', '/api/announcements', t, b);

  ok('employee cannot post', (await post({ title: 'x', body: 'y' }, t1)).status === 403);
  ok('selected audience needs people', (await post({ title: 'x', body: 'y', audience: 'selected', emp_ids: [] })).status === 400);
  ok('unknown employee id refused', (await post({ title: 'x', body: 'y', audience: 'selected', emp_ids: [99999] })).status === 400);
  ok('bad attachment type refused', (await post({ title: 'x', body: 'y', attachment: { filename: 'a.exe', mime: 'application/x-msdownload', data: 'AAAA' } })).status === 400);
  ok('attachment whose content does not match refused', (await post({ title: 'x', body: 'y', attachment: { filename: 'a.pdf', mime: 'application/pdf', data: Buffer.from('not a pdf').toString('base64') } })).status === 400);

  // 1) everyone, attachment, both a file and a reply required
  const a1 = await post({ title: 'Submit your ID copy', body: 'Please send it.', audience: 'all', attachment: PDF, ask_file: true, ask_reply: true }); ok('posted to everyone', a1.status === 200, JSON.stringify(a1.body));
  // 2) only employees 1 and 2, reply text only
  const a2 = await post({ title: 'Team lunch?', body: 'Tell us.', audience: 'selected', emp_ids: [e1.id, e2.id], ask_reply: true }); ok('posted to selected people', a2.status === 200);
  // 3) only employee 3, no reply needed
  const a3 = await post({ title: 'For Three', body: 'FYI', audience: 'selected', emp_ids: [e3.id] }); ok('plain targeted notice', a3.status === 200);
  const titles = async t => (await api('GET', '/api/announcements', t)).body.map(a => a.title).filter(x => !/^Welcome/.test(x)).sort();   // a welcome post is created with every company
  ok('employee 1 sees all-employee + own selected', JSON.stringify(await titles(t1)) === JSON.stringify(['Submit your ID copy', 'Team lunch?']), JSON.stringify(await titles(t1)));
  ok('employee 3 sees only theirs and the general one', JSON.stringify(await titles(t3)) === JSON.stringify(['For Three', 'Submit your ID copy']));
  ok('admin sees all', (await titles(at)).length === 3);
  const dash = (await api('GET', '/api/dashboard', t3)).body.announcements.map(a => a.title); ok('dashboard respects the audience', !dash.includes('Team lunch?') && dash.includes('For Three'));

  // downloads
  const list1 = (await api('GET', '/api/announcements', t1)).body, ann1 = list1.find(a => a.id === a1.body.id);
  ok('attachment metadata present', ann1.attachment && ann1.attachment.filename === 'notice.pdf');
  const dl = await raw('/api/announcement-files/' + ann1.attachment.file_id, t2); ok('target employee downloads the attachment', dl.status === 200 && dl.type === 'application/pdf' && dl.buf.toString().startsWith('%PDF-'));
  ok('download needs login', (await raw('/api/announcement-files/' + ann1.attachment.file_id)).status === 401);
  const sec = await post({ title: 'Secret', body: 'x', audience: 'selected', emp_ids: [e1.id], attachment: PDF }); const secFile = (await api('GET', '/api/announcements', at)).body.find(a => a.title === 'Secret').attachment.file_id;
  ok('another employee cannot open an attachment not meant for them', sec.status === 200 && (await raw('/api/announcement-files/' + secFile, t3)).status === 403);
  await api('DELETE', '/api/announcements/' + sec.body.id, at);

  // pending / popup list
  const pend = async t => (await api('GET', '/api/announcements/pending', t)).body.map(a => a.title);
  ok('employee 1 has two things to answer', JSON.stringify(await pend(t1)) === JSON.stringify(['Submit your ID copy', 'Team lunch?']), JSON.stringify(await pend(t1)));
  ok('employee 3 has one (the general one); FYI needs nothing', JSON.stringify(await pend(t3)) === JSON.stringify(['Submit your ID copy']));
  ok('admin has nothing pending', (await pend(at)).length === 0);

  // replying
  const R = id => `/api/announcements/${id}/reply`;
  ok('reply without the file is refused', (await api('POST', R(a1.body.id), t1, { text: 'here' })).status === 400);
  ok('reply without the text is refused', (await api('POST', R(a1.body.id), t1, { file: PNG })).status === 400);
  ok('wrong file type refused', (await api('POST', R(a1.body.id), t1, { text: 'x', file: { filename: 'x.exe', mime: 'application/x-msdownload', data: 'AAAA' } })).status === 400);
  ok('still pending after failed tries', (await pend(t1)).includes('Submit your ID copy'));
  ok('employee 1 submits file + text', (await api('POST', R(a1.body.id), t1, { text: 'ID attached', file: PNG })).status === 200);
  ok('cannot reply twice', (await api('POST', R(a1.body.id), t1, { text: 'again', file: PNG })).status === 400);
  ok('no longer pending for employee 1 (only the lunch one is left)', JSON.stringify(await pend(t1)) === JSON.stringify(['Team lunch?']));
  ok('text-only announcement needs no file', (await api('POST', R(a2.body.id), t1, { text: 'Yes please' })).status === 200 && (await pend(t1)).length === 0);
  ok('employee 3 cannot reply to one not addressed to them', (await api('POST', R(a2.body.id), t3, { text: 'me too' })).status === 404);
  ok('no reply is needed on a plain notice', (await api('POST', R(a3.body.id), t3, { text: 'ok' })).status === 400);
  ok('admin cannot reply', (await api('POST', R(a1.body.id), at, { text: 'x', file: PNG })).status === 403);

  // admin side: per-announcement and per-employee views, download of the reply document
  const st = (await api('GET', `/api/announcements/${a1.body.id}/replies`, at)).body; ok('per-announcement status lists everyone, one replied', st.people.length === 3 && st.people.filter(p => p.reply).length === 1, JSON.stringify(st.people.map(p => !!p.reply)));
  const mine = (await api('GET', `/api/employees/${e1.id}/replies`, at)).body; ok('employee page lists their replies', mine.length === 2 && mine.some(r => r.title === 'Submit your ID copy' && r.text === 'ID attached' && r.file && r.file.filename === 'proof.png'), JSON.stringify(mine));
  const rf = mine.find(r => r.file).file, got = await raw('/api/announcement-files/' + rf.file_id, at); ok('admin downloads the employee reply document', got.status === 200 && got.type === 'image/png' && got.buf.length === 12);
  ok('the owner can download their own reply', (await raw('/api/announcement-files/' + rf.file_id, t1)).status === 200);
  ok('another employee cannot', (await raw('/api/announcement-files/' + rf.file_id, t2)).status === 403);
  ok('employees cannot list replies', (await api('GET', `/api/employees/${e1.id}/replies`, t2)).status === 403 && (await api('GET', `/api/announcements/${a1.body.id}/replies`, t2)).status === 403);
  const ep = (await api('GET', '/api/employees/' + e1.id, at)).body; ok('employee details carry the reply count', ep.reply_count === 2);
  ok('counts on the announcement for admin', (await api('GET', '/api/announcements', at)).body.find(a => a.id === a1.body.id).reply_count === 1);

  // deleting removes files and replies
  ok('admin deletes the announcement', (await api('DELETE', '/api/announcements/' + a1.body.id, at)).status === 200);
  ok('its reply document is gone', (await raw('/api/announcement-files/' + rf.file_id, at)).status === 404);
  await api('DELETE', '/api/master/companies/' + (await api('GET', '/api/master/companies', mt)).body.find(x => x.code === code).id, mt, { confirm: code, confirm_password: MP });
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
