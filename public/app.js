'use strict';
// ================= core =================
const S = { user: null, lk: null, tab: {}, token: localStorage.getItem('hh_token') };
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fd = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const ym = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const today = () => { const n = new Date(); return ym(n) + '-' + String(n.getDate()).padStart(2, '0'); };
const monthName = m => new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const isHR = () => ['admin', 'hr'].includes(S.user.role);
const isMaster = () => S.user.role === 'master';
const isAdmin = () => S.user.role === 'admin';
const can = k => S.user.role === 'admin' || (S.user.perms || []).includes(k);
const isStaff = () => S.user.role === 'admin' || (S.user.perms || []).some(p => p !== 'team');
const PERM_DEFS = [
  ['team', 'Manage direct reports', "Approve their leave & expenses, see their attendance, set goals and write reviews"],
  ['employees', 'Employee records', 'View and edit every employee profile'],
  ['attendance', 'Attendance', "See everyone's attendance, correct entries, run reports"],
  ['leave', 'Leave', "Approve or reject anyone's leave requests"],
  ['expenses', 'Expenses', 'Approve expense claims for everyone'],
  ['payroll', 'Payroll & salaries', 'Run payroll, see and edit salaries, view all payslips'],
  ['recruitment', 'Recruitment', 'Job openings and the candidate pipeline'],
  ['onboarding', 'Onboarding & offboarding', 'Checklists, exits and final settlement'],
  ['performance', 'Performance', 'Goals and reviews for everyone'],
  ['helpdesk', 'Helpdesk', 'Respond to employee tickets'],
  ['assets', 'Assets', 'Track and assign company assets'],
  ['learning', 'Learning', 'Add courses and see training compliance'],
  ['announcements', 'Announcements', 'Post company announcements'],
  ['settings', 'Company settings', 'Departments, leave policy and holidays'],
];
const PW = { name: 'confirm_password', label: 'Confirm with your password', type: 'password', required: true, full: true };
const EXP_CATS = ['Travel', 'Rent', 'Accessories & equipment', 'Office supplies', 'Software & subscriptions', 'Utilities', 'Meals & entertainment', 'Accommodation', 'Marketing', 'Maintenance & repairs', 'Internet & phone', 'Training', 'Other'];
const WORK_TYPES = ['Office', 'Work from home', 'Hybrid'];
const REQ_LABEL = { resignation: '🚪 Resignation', transfer: '🔁 Transfer', work_type: '🏠 Work type change', password_reset: '🔑 Password reset' };
const reqText = r => { const p = r.payload || {};
  if (r.type === 'password_reset') return 'Forgot their password and asked for a new one';
  if (r.type === 'resignation') return `Last working day ${fd(p.last_working_day)}`;
  if (r.type === 'transfer') return `${esc(p.from_dept_name || '—')} → ${esc(p.to_dept_name || p.from_dept_name || 'same department')}${p.to_location ? ' · ' + esc(p.to_location) : ''} from ${fd(p.transfer_date)}`;
  return `${esc(p.from)} → <b>${esc(p.to)}</b> from ${fd(p.worktype_date)}`; };
function reqTable(rows, o = {}) {
  S._reqs = Object.assign(S._reqs || {}, Object.fromEntries(rows.map(r => [r.id, r])));
  return table([...(o.withEmp ? [{ h: 'Employee', f: r => `<a href="#/employee/${r.emp_id}"><b>${esc(r.emp_name)}</b></a><br><small class="muted">${esc(r.emp_code)} · ${esc(r.dept || '')}</small>` }] : []),
    { h: 'Request', f: r => `<b>${REQ_LABEL[r.type]}</b>` }, { h: 'Details', f: r => reqText(r) }, { h: 'Reason', f: r => esc(r.reason) }, { h: 'Applied', f: r => fd(r.created) },
    { h: 'Status', f: r => badge(r.status) + (r.decided_by_name ? `<br><small class="muted">by ${esc(r.decided_by_name)}</small>` : '') + (r.note ? `<br><small class="muted">${esc(r.note)}</small>` : '') },
    { h: '', f: r => r.status !== 'pending' ? '' : r.type === 'password_reset' ? (S.user.role === 'admin' && o.decide ? `<button class="btn sm ok" data-act="resetPwReq" data-id="${r.id}">Set new password</button> <button class="btn sm" data-act="decideReq" data-id="${r.id}" data-v="rejected">Dismiss</button>` : '') : o.decide ? `<button class="btn sm ok" data-act="decideReq" data-id="${r.id}" data-v="approved">Approve</button> <button class="btn sm danger" data-act="decideReq" data-id="${r.id}" data-v="rejected">Reject</button>` : r.emp_id === S.user.id ? `<button class="btn sm" data-act="withdrawReq" data-id="${r.id}">Withdraw</button>` : '' }], rows, 'No requests.');
}
const profileRequests = e => e.requests && (e.requests.length || e.requests_can_decide) ? `<div class="card"><h2>Requests</h2>${reqTable(e.requests, { decide: e.requests_can_decide })}</div>` : '';
async function requestsTab(tabs) {
  const reviewable = can('onboarding') || can('employees') || can('team');
  const [mine, me, review] = await Promise.all([api('GET', '/api/requests'), api('GET', '/api/employees/' + S.user.id), reviewable ? api('GET', '/api/requests?scope=manage') : []]);
  return head('Requests', 'Apply to resign, transfer or switch your work type', '<button class="btn primary" data-act="newRequest">+ New request</button>') + tabs +
    `<div class="card"><h2>My current setup</h2><dl class="kv"><dt>Department</dt><dd>${esc(me.dept || '—')}</dd><dt>Location</dt><dd>${esc(me.location || '—')}</dd><dt>Work type</dt><dd><b>${esc(me.work_type || 'Office')}</b></dd><dt>Reports to</dt><dd>${esc(me.manager || '—')}</dd></dl></div>
    <div class="card"><h2>My requests</h2>${reqTable(mine)}</div>
    ${reviewable ? `<div class="card"><h2>Requests to review</h2><p class="muted">Applications from the people you manage. You can also open an employee's profile to see theirs.</p>${reqTable(review, { withEmp: true, decide: true })}</div>` : ''}`;
}
const hms = s => [Math.floor(s / 3600), Math.floor(s % 3600 / 60), Math.floor(s % 60)].map(x => String(x).padStart(2, '0')).join(':');
const hm = m => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`;
const DAY_LABEL = { office: 'Full day', wfh: 'Full day · work from home', half: 'Half day', absent: 'Absent — under the half-day hours' };
function punchCard(d) {
  if (isAdmin() || !d.punch) return '';
  const p = d.punch, c = p.cfg, total = c.office_hours * 3600;
  Object.assign(S, { punchMode: p.open_mode, punchGeo: p.geo, punchAt: Date.now(), punchOpen: p.open, punchBase: p.worked_secs, punchTotal: total });
  const pct = v => Math.min(100, v * 3600 / total * 100);
  let state;
  if (!p.first_in) state = '<span class="badge">Not punched in yet</span>';
  else if (p.open) state = `<span class="badge wfh">Working now</span>${p.late ? ' <span class="badge pending">late</span>' : ''}`;
  else state = `<span class="badge ${p.status === 'half' ? 'half' : p.status === 'absent' ? 'rejected' : 'present'}">${DAY_LABEL[p.status] || p.status}</span>`;
  const note = !p.first_in ? (p.workday ? 'Punch in to start counting your working hours.' : 'Today is a weekend / holiday.')
    : p.open ? (p.projected ? `If you punch out now: <b>${DAY_LABEL[p.projected.status] || p.projected.status}</b>${p.projected.reason ? ' — ' + esc(p.projected.reason) : ''}` : '')
      : `${esc(p.reason || '')}`;
  const button = p.open ? '<button class="btn danger punch" data-act="punch">⏹ Punch out</button>' : `<button class="btn ok punch" data-act="punch" ${p.workday ? '' : 'disabled'}>▶ Punch in</button>`;
  return `<div class="card punchcard personal"><div class="punchrow">
      <div><div class="muted">Today · ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}</div><div id="punchTimer" class="timer">${hms(p.worked_secs)}</div><div>${state}</div></div>
      <div class="punchbtn">${button}${p.open ? '' : `<select id="punchMode" title="Where are you working from?">${opts([['office', '🏢 Office'], ['wfh', '🏠 Work from home']], p.default_mode)}</select>`}</div></div>
    <div class="pbar"><i id="punchBar" style="width:${pct(p.worked_secs / 3600)}%"></i><b style="left:${pct(c.half_day_hours)}%"></b><b style="left:${pct(c.full_day_hours)}%"></b></div>
    <div class="pticks"><span style="left:${pct(c.half_day_hours)}%">${c.half_day_hours}h<i> · Half day</i></span><span style="left:${pct(c.full_day_hours)}%">${c.full_day_hours}h<i> · Full day</i></span><span style="right:0">${c.office_hours}h<i> office day</i></span></div>
    <p style="margin:26px 0 4px">${note}</p>${geoNote(p.geo)}
    ${p.sessions.length ? `<small class="muted">Sessions: ${p.sessions.map(s => `${s.in} → ${s.out || 'now'}`).join(' · ')}</small><br>` : ''}
    <small class="muted">This month: short days (${c.full_day_hours}–${c.office_hours}h) used <b>${p.allowance.short_used}/${p.allowance.limit}</b> · late arrivals (within ${c.grace_minutes} min) used <b>${p.allowance.late_used}/${p.allowance.limit}</b></small></div>`;
}
const monthSummaryHtml = m => m ? `<dl class="kv"><dt>Full days</dt><dd><b>${m.present + m.wfh}</b> <small class="muted">(${m.wfh} from home)</small></dd><dt>Half days</dt><dd><b>${m.half}</b></dd><dt>Absent / short hours</dt><dd><b>${m.absent}</b></dd><dt>Hours worked</dt><dd><b>${m.hours}h</b></dd></dl>` : '';
// ---- office location / geo-fencing ----
const getPosition = (timeout = 15000) => new Promise((resolve, reject) => {
  if (!navigator.geolocation) return reject(new Error('This browser cannot share your location. Use a phone or a modern browser over HTTPS.'));
  navigator.geolocation.getCurrentPosition(p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
    e => reject(new Error(e.code === 1 ? 'Location permission denied. Allow location access for this site in your browser and try again.' : 'Could not get your location (' + e.message + ').')),
    { enableHighAccuracy: true, timeout, maximumAge: 0 });
});
const fmtDist = m => m == null ? '' : m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km';
const mapLink = (la, ln) => `https://www.google.com/maps?q=${la},${ln}`;
const geoNote = g => !g || !g.enforced ? '' : g.exempt
  ? '<small class="muted">📍 Geo-fencing exemption: you can punch from anywhere. Your location is saved with every punch.</small><br>'
  : `<small class="muted">📍 You can punch in/out only within <b>${g.radius} m</b> of ${esc(g.label || 'the office')}. Your browser will ask for location access.</small><br>`;

async function historyTab(tabs) {
  const all_ = can('attendance'), from = S.histFrom || ym(new Date()) + '-01', to = S.histTo || today(), away = S.histAway || '', emp = all_ ? (S.histEmp || '') : '';
  const r = await api('GET', `/api/attendance/history?from=${from}&to=${to}${emp ? '&emp_id=' + emp : ''}${away ? '&away=1' : ''}`);
  const place = (p, k) => { const la = p[k + '_lat'], ln = p[k + '_lng'], d = p[k + '_dist'], aw = p[k + '_away'];
    return la == null ? '<span class="muted">no location</span>' : `<a href="${mapLink(la, ln)}" target="_blank" rel="noopener">${la.toFixed(5)}, ${ln.toFixed(5)}</a>${d != null ? `<br><small class="${aw ? 'err' : 'muted'}">${fmtDist(d)} from office</small>` : ''}`; };
  return head('Punch history & locations', r.office ? `Office: ${r.office.label || 'set'} · allowed within ${r.office.radius} m` : 'No office location set yet — punches are not location-checked',
      `<input type="date" id="histFrom" value="${from}" style="width:auto"><input type="date" id="histTo" value="${to}" style="width:auto">${all_ ? `<select id="histEmp" style="width:auto">${opts(S.lk.employees.filter(e => e.role !== 'admin').map(e => [e.id, e.name]), emp, 'Everyone')}</select>` : ''}<select id="histAway" style="width:auto">${opts([['1', 'Away from office only']], away, 'All punches')}</select>`) + tabs +
    `<div class="card">${table([{ h: 'Date', f: p => fd(p.date) }, ...(all_ ? [{ h: 'Employee', f: p => `<b>${esc(p.emp_name)}</b><br><small class="muted">${esc(p.emp_code)}</small>` }] : []),
      { h: 'Mode', f: p => p.mode === 'wfh' ? '🏠 WFH' : '🏢 Office' }, { h: 'Punch in', f: p => `<b>${p.in_time.slice(0, 5)}</b><br>${place(p, 'in')}` }, { h: 'Punch out', f: p => p.out_time ? `<b>${p.out_time.slice(0, 5)}</b><br>${place(p, 'out')}` : '<span class="muted">still in</span>' },
      { h: 'Where', f: p => (p.in_lat == null && p.out_lat == null) ? '<span class="muted">—</span>' : (p.in_away || p.out_away) ? `<span class="badge rejected">Away from office</span>${p.geo_exempt ? '<br><small class="muted">geo-fencing exempt</small>' : ''}` : '<span class="badge present">At office</span>' }], r.rows, 'No punches in this period.')}</div>`;
}


// ---- employee profile, documents and the profile PDF ----
const DOC_META = {
  profile_photo: ['Profile photo', 'image'], aadhaar_front: ['Aadhaar card — front'], aadhaar_back: ['Aadhaar card — back'], pan_front: ['PAN card — front'], bank_proof: ['Bank passbook / cancelled cheque'],
  marksheet: ['Marksheets (10th, 12th, graduation…)', 'both', true], certificate: ['Certificates', 'both', true], offer_letter: ['Last company offer letter'], salary_slip: ['Last company salary slip'],
  relieving_letter: ['Last company relieving letter'], experience_letter: ['Experience letter'], other: ['Other documents', 'both', true],
};
const PROFILE_SECTIONS = [
  ['👤 Personal details', [['display_name', 'Profile name (shown to colleagues)'], ['full_name', 'Full name (as on Aadhaar)'], ['father_name', "Father's name"], ['dob', 'Date of birth', 'date'], ['gender', 'Gender', 'select', ['Male', 'Female', 'Other']],
    ['marital_status', 'Marital status', 'select', ['Single', 'Married', 'Other']], ['blood_group', 'Blood group', 'select', ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']], ['phone', 'Mobile number', 'tel'], ['alt_phone', 'Alternate mobile', 'tel'],
    ['personal_email', 'Personal email', 'email'], ['current_address', 'Current address', 'textarea'], ['permanent_address', 'Permanent address', 'textarea']]],
  ['🚨 Emergency contact', [['emergency_name', 'Name'], ['emergency_relation', 'Relationship'], ['emergency_phone', 'Mobile number', 'tel']]],
  ['🪪 Identity numbers', [['aadhaar_no', 'Aadhaar number (12 digits)'], ['pan_no', 'PAN number'], ['uan_no', 'UAN / PF number (if any)']]],
  ['🏦 Bank account (for salary)', [['bank_holder', 'Name as in bank book'], ['bank_account_no', 'Account number'], ['bank_ifsc', 'IFSC code'], ['bank_name', 'Bank name'], ['bank_branch', 'Branch'], ['bank_branch_code', 'Branch code']]],
  ['🎓 Education', [['qualification', 'Highest qualification'], ['university', 'University / board'], ['passing_year', 'Passing year']]],
  ['💼 Work history', [['experience_type', 'Are you a fresher or experienced?', 'select', [['fresher', 'Fresher'], ['experienced', 'Experienced']]], ['prev_company', 'Last company'], ['prev_designation', 'Last designation'], ['prev_from', 'From', 'date'], ['prev_to', 'To', 'date'], ['last_salary', 'Last drawn salary (₹ per year)', 'number']]],
];
const DOC_GROUPS = [['📷 Photo', ['profile_photo']], ['🪪 Identity documents', ['aadhaar_front', 'aadhaar_back', 'pan_front']], ['🏦 Bank', ['bank_proof']], ['🎓 Education & certificates', ['marksheet', 'certificate']],
  ['💼 Previous employment (needed if you are experienced)', ['offer_letter', 'salary_slip', 'relieving_letter', 'experience_letter']], ['📎 Anything else', ['other']]];
const fmtSize = b => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
const maskNo = (v, keep = 4) => v ? '•'.repeat(Math.max(0, String(v).length - keep)) + String(v).slice(-keep) : '';
const readB64 = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => no(new Error('Could not read the file')); r.readAsDataURL(f); });
async function imageToJpegB64(file, maxDim, q = 0.82) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Could not read that image. Please use a JPG or PNG photo/scan (iPhone HEIC files are not supported).')); i.src = url; });
  const k = Math.min(1, maxDim / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
  return c.toDataURL('image/jpeg', q).split(',')[1];
}
async function prepareUpload(file, type) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    if (DOC_META[type][1] === 'image') throw new Error('Please choose a photo (JPG or PNG), not a PDF');
    if (file.size > 3e6) throw new Error('This PDF is larger than 3 MB. Compress it or upload a smaller scan.');
    return { mime: 'application/pdf', data: await readB64(file), filename: file.name };
  }
  if (!/^image\//.test(file.type)) throw new Error('Choose a JPG, PNG or PDF file');
  if (file.size > 25e6) throw new Error('That image is too large');
  return { mime: 'image/jpeg', data: await imageToJpegB64(file, type === 'profile_photo' ? 700 : 1600), filename: file.name.replace(/\.\w+$/, '') + '.jpg' };
}
// documents need the login token, so they are fetched with it and shown from a blob
async function docBlob(id) { const r = await fetch('/api/documents/' + id, { headers: { Authorization: 'Bearer ' + S.token } }); if (!r.ok) throw new Error('Could not load the document'); return r.blob(); }
const docUrls = new Map();
async function docUrl(id) { if (!docUrls.has(id)) docUrls.set(id, URL.createObjectURL(await docBlob(id))); return docUrls.get(id); }
async function loadAvatar() {
  const id = S.user && S.user.photo_id; if (!id) return;
  try { const url = await docUrl(id); document.querySelectorAll('#userbox .avatar').forEach(a => { a.textContent = ''; Object.assign(a.style, { backgroundImage: `url(${url})`, backgroundSize: 'cover', backgroundPosition: 'center' }); }); } catch {}
}
async function refreshMe() { S.user = await api('GET', '/api/me'); buildNav(); loadAvatar(); }
const profileBanner = d => (d.profilePct !== undefined && d.profilePct < 100) ? `<div class="card" style="border-left:4px solid var(--brand)">🪪 Your profile is <b>${d.profilePct}%</b> complete. Please add your details and documents — <a href="#/myprofile">Complete profile</a></div>` : '';

function profileCard(e, prof) {
  if (e.id === S.user.id && !isAdmin()) return `<div class="card"><h2>🪪 My profile</h2><p class="muted">Your personal details and documents (Aadhaar, PAN, bank, letters, certificates…).</p><a class="btn primary" href="#/myprofile">Complete / update my profile</a></div>`;
  if (!prof) return '';
  const c = prof.completion, F = prof.fields, name = prof.employee.name;
  const dl = [['Full name', F.full_name], ['Date of birth', F.dob && fd(F.dob)], ['Mobile', F.phone], ['Personal email', F.personal_email], ['Aadhaar no.', F.aadhaar_no && maskNo(F.aadhaar_no)], ['PAN', F.pan_no], ['Bank account', F.bank_holder && `${F.bank_holder} · ${maskNo(F.bank_account_no)} · ${F.bank_ifsc || ''}`], ['Emergency contact', F.emergency_name && `${F.emergency_name} (${F.emergency_relation || ''}) ${F.emergency_phone || ''}`]]
    .map(([k, v]) => `<dt>${k}</dt><dd>${v ? esc(v) : '<span class="muted">—</span>'}</dd>`).join('');
  return `<div class="card"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h2 class="grow" style="margin:0">🪪 Profile & documents</h2><button class="btn primary" data-act="profilePdf" data-id="${e.id}">⬇ Download profile PDF</button></div>
    <div style="margin:10px 0"><b>${c.pct}%</b> complete (${c.done}/${c.total}) ${bar(c.pct)}${c.missing.length ? `<small class="muted">Missing: ${c.missing.map(esc).join(', ')}</small>` : '<small class="muted">Everything is on file ✓</small>'}</div>
    <dl class="kv">${dl}</dl>
    <h3 style="margin-top:14px">Documents</h3>${prof.docs.length ? prof.docs.map(d => `<div class="docfile">📎 <b>${esc(DOC_META[d.doc_type][0])}</b> — ${esc(d.filename)} <small class="muted">${fmtSize(d.size)} · ${fd(d.uploaded)}</small>
      <button class="btn sm" data-act="viewDoc" data-id="${d.id}" data-mime="${d.mime}" data-name="${esc(d.filename)}">View</button> <button class="btn sm" data-act="downloadDoc" data-id="${d.id}" data-name="${esc(d.filename)}">Download</button></div>`).join('') : '<span class="muted">No documents uploaded yet.</span>'}</div>`;
}
const profileCols = list => list.some(e => e.profile_pct !== undefined) ? [{ h: 'Profile', f: e => `<div style="min-width:70px">${e.profile_pct}%${bar(e.profile_pct)}</div>` }, { h: '', f: e => `<button class="btn sm" data-act="profilePdf" data-id="${e.id}" title="Download the full profile as a PDF">⬇ PDF</button>` }] : [];

async function loadPdfLib() {
  if (window.PDFLib) return window.PDFLib;
  await new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/vendor/pdf-lib.min.js'; s.onload = ok; s.onerror = () => no(new Error('Could not load the PDF tool')); document.head.appendChild(s); });
  return window.PDFLib;
}
// Builds one PDF: header + all details + every uploaded document (images as pages, uploaded PDFs appended page by page)
async function buildProfilePdf(empId) {
  const [lib, prof, emp] = await Promise.all([loadPdfLib(), api('GET', '/api/profile?emp_id=' + empId), api('GET', '/api/employees/' + empId)]);
  const { PDFDocument, StandardFonts, rgb } = lib, F = prof.fields, co = S.user.company || {};
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 40, ink = rgb(0.1, 0.12, 0.2), muted = rgb(0.4, 0.43, 0.5), brand = rgb(0.31, 0.27, 0.9);
  const clean = s => String(s ?? '').replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u20B9/g, 'Rs').replace(/[\u2022\u00B7]/g, '*').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');   // standard PDF fonts only cover Latin text
  let page = pdf.addPage([W, H]), y = H - M;
  const ensure = n => { if (y - n < M) { page = pdf.addPage([W, H]); y = H - M; } };
  const wrap = (t, f, size, maxW) => { const lines = []; for (const para of clean(t).split('\n')) { let cur = ''; for (const w of para.split(/\s+/)) { const test = cur ? cur + ' ' + w : w; if (f.widthOfTextAtSize(test, size) > maxW && cur) { lines.push(cur); cur = w; } else cur = test; } lines.push(cur); } return lines; };
  const section = title => { ensure(90); y -= 8; page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 20, color: rgb(0.93, 0.94, 1) }); page.drawText(clean(title), { x: M + 8, y: y + 1, size: 11, font: bold, color: brand }); y -= 26; };
  const row = (label, value) => { const lines = wrap(value || '-', font, 10, W - 2 * M - 190); ensure(lines.length * 13 + 4); page.drawText(clean(label), { x: M + 8, y, size: 9.5, font, color: muted }); lines.forEach((ln, i) => page.drawText(ln, { x: M + 180, y: y - i * 13, size: 10, font, color: ink })); y -= lines.length * 13 + 4; };
  const embedImg = async (bytes, mime) => mime === 'image/png' ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
  // header: company logo + name, employee photo
  let hx = M;
  if (co.logo_v) { try { const r = await fetch(`/api/logo/${encodeURIComponent(co.code)}?v=${co.logo_v}`), img = await embedImg(new Uint8Array(await r.arrayBuffer()), r.headers.get('content-type')), s = Math.min(46 / img.width, 46 / img.height); page.drawImage(img, { x: M, y: y - 44, width: img.width * s, height: img.height * s }); hx = M + 58; } catch {} }
  page.drawText(clean(co.name || 'Company'), { x: hx, y: y - 18, size: 17, font: bold, color: ink });
  page.drawText('Employee profile file', { x: hx, y: y - 34, size: 10, font, color: muted });
  const photo = prof.docs.find(d => d.doc_type === 'profile_photo');
  if (photo) { try { const img = await embedImg(new Uint8Array(await (await docBlob(photo.id)).arrayBuffer()), photo.mime), s = Math.min(78 / img.width, 78 / img.height); page.drawImage(img, { x: W - M - img.width * s, y: y - 78, width: img.width * s, height: img.height * s }); } catch {} }
  y -= 96;
  page.drawText(clean(F.full_name || emp.name), { x: M, y, size: 15, font: bold, color: ink }); y -= 17;
  page.drawText(clean(`${emp.emp_code}  ·  ${emp.designation || ''}${emp.dept ? '  ·  ' + emp.dept : ''}`), { x: M, y, size: 10, font, color: muted }); y -= 14;
  page.drawText(clean(`Profile ${prof.completion.pct}% complete  ·  Generated ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`), { x: M, y, size: 9, font, color: muted }); y -= 20;
  section('Employment record');
  [['Employee ID', emp.emp_code], ['Work email', emp.email], ['Department', emp.dept], ['Designation', emp.designation], ['Reports to', emp.manager], ['Date of joining', emp.join_date && fd(emp.join_date)], ['Employment type', emp.employment_type], ['Work location', emp.location]].forEach(([k, v]) => row(k, v));
  for (const [title, fields] of PROFILE_SECTIONS) {
    section(title.replace(/^\S+\s/, ''));
    fields.forEach(([k, label, type]) => row(label, type === 'date' && F[k] ? fd(F[k]) : F[k]));
  }
  section('Documents attached');
  if (!prof.docs.length) row('-', 'No documents uploaded yet'); else prof.docs.forEach(d => row(DOC_META[d.doc_type][0], `${d.filename} (${fmtSize(d.size)}, uploaded ${fd(d.uploaded)})`));
  // the documents themselves
  const order = Object.keys(DOC_META);
  for (const d of [...prof.docs].sort((a, b) => order.indexOf(a.doc_type) - order.indexOf(b.doc_type) || a.id - b.id)) {
    const caption = `${DOC_META[d.doc_type][0]}  —  ${d.filename}`;
    try {
      const bytes = new Uint8Array(await (await docBlob(d.id)).arrayBuffer());
      if (d.mime === 'application/pdf') {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true }), pages = await pdf.copyPages(src, src.getPageIndices());
        pages.forEach((p, i) => { pdf.addPage(p); if (i === 0) p.drawText(clean(caption), { x: 14, y: p.getHeight() - 11, size: 7.5, font, color: muted }); });
      } else {
        const img = await embedImg(bytes, d.mime), pg = pdf.addPage([W, H]), s = Math.min((W - 2 * M) / img.width, (H - 2 * M - 30) / img.height);
        pg.drawText(clean(caption), { x: M, y: H - M, size: 10, font: bold, color: ink });
        pg.drawImage(img, { x: (W - img.width * s) / 2, y: H - M - 20 - img.height * s, width: img.width * s, height: img.height * s });
      }
    } catch (err) { const pg = pdf.addPage([W, H]); pg.drawText(clean(caption), { x: M, y: H - M, size: 10, font: bold, color: ink }); pg.drawText('This file could not be embedded (' + clean(err.message).slice(0, 60) + '). Download it from the portal.', { x: M, y: H - M - 20, size: 9, font, color: muted }); }
  }
  pdf.setTitle(clean(`${emp.name} - profile`)); pdf.setAuthor(clean(co.name || 'HelloHR'));
  return { bytes: await pdf.save(), filename: `${(F.full_name || emp.name).replace(/[^\w]+/g, '_')}_${emp.emp_code}_profile.pdf` };
}
window.HH = { buildProfilePdf };
const saveBlob = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
const permLabel = k => (PERM_DEFS.find(p => p[0] === k) || [k, k])[1];
const accessFields = (e = {}) => [
  { name: 'account_type', label: 'Account type', type: 'select', full: true, value: e.role === 'manager' ? 'managing' : 'employee',
    options: [['employee', 'Normal employee — no management access'], ['managing', 'Managing access — choose what they can manage']] },
  { name: 'permissions', label: 'This person can manage / edit:', type: 'checks', options: PERM_DEFS, value: e.perms || [], showIf: 'account_type=managing' },
];
const PORTAL = location.pathname.startsWith('/master') ? 'master' : location.pathname.startsWith('/admin') ? 'admin' : 'employee';
const portalOf = u => u.role === 'master' ? 'master' : u.role === 'admin' ? 'admin' : 'employee';
const isMgr = () => S.user.role === 'manager';
const initials = n => String(n || '?').split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase();
const badge = s => `<span class="badge ${esc(s)}">${esc(String(s).replace('_', ' '))}</span>`;
const bar = p => `<div class="bar"><i style="width:${Math.min(100, p || 0)}%"></i></div>`;
const opts = (list, sel, blank) => (blank ? `<option value="">${esc(blank)}</option>` : '') + list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`).join('');

async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') { logoutLocal(); throw new Error('Session expired'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function toast(msg, bad) {
  const d = document.createElement('div'); d.textContent = msg; if (bad) d.className = 'bad';
  $('#toast').appendChild(d); setTimeout(() => d.remove(), 3500);
}
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); } };

// ---- modal & forms ----
// On phones CSS turns tables into stacked cards; each cell needs its column heading as a label.
function labelTables(root) {
  root.querySelectorAll('table').forEach(t => {
    const hs = [...t.querySelectorAll('thead th')].map(h => h.textContent.trim()); if (!hs.length) return;
    t.classList.add('rtable'); t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { td.setAttribute('data-label', hs[i] || ''); if (td.childNodes.length > 1 && !td.querySelector(':scope > .cell')) td.innerHTML = '<div class="cell">' + td.innerHTML + '</div>'; }));
  });
}
// Shrinks a chosen picture to at most 256px and returns it as a data URL (kept small so it loads fast on every page).
async function logoFromFile(file) {
  if (!file) return null;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('The logo must be a PNG, JPG or WebP image');
  if (file.size > 5e6) throw new Error('That image is too large (max 5 MB)');
  const url = URL.createObjectURL(file);
  const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Could not read that image')); i.src = url; });
  const k = Math.min(1, 256 / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
  return c.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9);
}
const logoImg = (co, cls = '') => co && co.logo_v ? `<img class="clogo ${cls}" alt="" src="/api/logo/${encodeURIComponent(co.code)}?v=${encodeURIComponent(co.logo_v)}">` : '';
function closeModal() { $('#modalRoot').innerHTML = ''; }
function modal(html, wide) {
  $('#modalRoot').innerHTML = `<div class="overlay"><div class="modal ${wide ? 'wide' : ''}">${html}</div></div>`;
  labelTables($('#modalRoot'));
  $('#modalRoot .overlay').addEventListener('mousedown', e => { if (e.target.classList.contains('overlay')) closeModal(); });
}
function fieldHtml(f) {
  const h = fieldHtml0(f);
  return f.showIf ? `<div class="full" data-showif="${f.showIf}">${h}</div>` : h;
}
function fieldHtml0(f) {
  const v = f.value ?? '', req = f.required ? 'required' : '', n = `name="${f.name}"`;
  let inp;
  if (f.type === 'file') return `<label class="${f.full ? 'full' : ''}">${esc(f.label)}<input ${n} type="file" accept="${f.accept || 'image/png,image/jpeg,image/webp'}"></label>`;
  if (f.type === 'checks') return `<fieldset class="perms full"><legend>${esc(f.label)}</legend>${f.options.map(([k, l, d]) => `<label class="perm"><input type="checkbox" name="${f.name}" value="${k}" ${(v || []).includes(k) ? 'checked' : ''}><span><b>${esc(l)}</b><small class="muted">${esc(d)}</small></span></label>`).join('')}</fieldset>`;
  if (f.type === 'select') inp = `<select ${n} ${req}>${opts(f.options || [], v, f.blank)}</select>`;
  else if (f.type === 'textarea') inp = `<textarea ${n} rows="3" ${req}>${esc(v)}</textarea>`;
  else if (f.type === 'checkbox') return `<label class="${f.full ? 'full' : ''}"><input type="checkbox" ${n} ${v ? 'checked' : ''}>${esc(f.label)}</label>`;
  else inp = `<input ${n} type="${f.type || 'text'}" value="${esc(v)}" ${req} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.step ? `step="${f.step}"` : ''}>`;
  return `<label class="${f.full || f.type === 'textarea' ? 'full' : ''}">${esc(f.label)}${inp}</label>`;
}
function openForm({ title, fields, submit = 'Save', onSubmit, wide, intro }) {
  modal(`<h2>${esc(title)}</h2>${intro ? `<p class="muted">${intro}</p>` : ''}<form id="mf"><div class="formgrid">${fields.map(fieldHtml).join('')}</div>
    <div class="err" id="mfErr"></div><div class="actions"><button type="button" class="btn" data-act="closeModal">Cancel</button><button class="btn primary">${esc(submit)}</button></div></form>`, wide);
  const mf = $('#mf'), sync = () => mf.querySelectorAll('[data-showif]').forEach(el => { const [n, val] = el.dataset.showif.split('='); el.style.display = mf.elements[n].value === val ? '' : 'none'; });
  mf.addEventListener('change', sync); sync();
  $('#mf').addEventListener('submit', async e => {
    e.preventDefault(); const vals = {};
    for (const f of fields) { if (f.type === 'checks') { vals[f.name] = [...e.target.querySelectorAll(`input[name="${f.name}"]:checked`)].map(x => x.value); continue; } const el = e.target.elements[f.name]; vals[f.name] = f.type === 'checkbox' ? el.checked : f.type === 'file' ? (el.files[0] || null) : el.value; }
    try { await onSubmit(vals); closeModal(); route(); } catch (err) { $('#mfErr').textContent = err.message; }
  });
}
const confirmBox = (msg, fn) => openForm({ title: 'Please confirm', intro: esc(msg), fields: [], submit: 'Confirm', onSubmit: fn });

function table(cols, rows, empty = 'Nothing here yet.') {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  return `<div class="tablewrap"><table><thead><tr>${cols.map(c => `<th>${c.h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${c.f(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}
const tabsHtml = (page, items) => {
  const cur = S.tab[page] && items.some(i => i[0] === S.tab[page]) ? S.tab[page] : items[0][0]; S.tab[page] = cur;
  return `<div class="tabs">${items.map(([k, l]) => `<button class="${k === cur ? 'active' : ''}" data-act="tab" data-page="${page}" data-id="${k}">${esc(l)}</button>`).join('')}</div>`;
};
function csv(name, rows) {
  const t = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); a.download = name; a.click();
}
const head = (title, sub, right = '') => `<div class="page-head"><div><h1>${esc(title)}</h1><div class="muted">${esc(sub || '')}</div></div><div class="grow"></div>${right}</div>`;

// ================= pages =================
const PAGES = {};

function policiesCard(p) {
  const c = p.attendance, li = t => `<li>${t}</li>`;
  const leave = p.leaveTypes.map(t => li(t.kind === 'wfh' ? `<b>${esc(t.name)}</b> — request approval to work remotely; counts as a working day and uses no leave balance` : `<b>${esc(t.name)}</b> — ${t.days_per_year ? t.days_per_year + ' days per year' : 'unlimited'}, ${t.is_paid ? 'paid' : 'unpaid (salary is cut for these days)'}`)).join('');
  return `<div class="card"><div style="display:flex;align-items:center"><h2 class="grow">📋 Office policies</h2>${can('settings') ? '<a href="#/settings">Edit attendance rules</a>' : ''}</div>
    <div class="grid g2" style="gap:24px">
      <div><h3>🕒 Attendance (automatic)</h3><ul class="policy">
        ${li(`Office hours: <b>${c.office_start} – ${c.office_end}</b> (${c.office_hours} hours); Saturday, Sunday and company holidays are off`)}
        ${li('Working hours are counted from <b>Punch In</b> to <b>Punch Out</b>. You can punch in and out several times; the time adds up')}
        ${li(`Under <b>${c.half_day_hours} hours</b> → counted <b>Absent</b>. <b>${c.half_day_hours} hours</b> or more → <b>Half day</b>. <b>${c.full_day_hours} hours</b> or more → <b>Full day</b>`)}
        ${li(`The full office day is ${c.office_hours} hours. A day of ${c.full_day_hours}–${c.office_hours} hours still counts as a Full day, but only <b>${c.allowance_days} times a month</b>. From the next time it counts as a <b>Half day</b>`)}
        ${li(`Arriving up to <b>${c.grace_minutes} minutes late</b> is allowed <b>${c.allowance_days} times a month</b>. After that it counts as a <b>Half day</b>. More than ${c.grace_minutes} minutes late is always a Half day`)}
        ${li(`No punch-in by <b>${c.grace_end}</b> → marked <b>Absent</b> automatically (changes when you punch in). Forgot to punch out → <b>Half day</b> until you do`)}
        ${li('Work from home counts the same when you punch in from the portal')}</ul></div>
      <div><h3>🌴 Leave</h3><ul class="policy">${leave}${li('Leave needs approval from your manager. Overlapping requests are not allowed')}${li('Absent days and half days (counted as 0.5) are treated as loss of pay')}</ul></div>
      <div><h3>💰 Payroll</h3><ul class="policy">
        ${li('Monthly salary = annual CTC ÷ 12: Basic 40%, HRA 50% of basic, rest special allowance')}
        ${li('Provident Fund 12% of basic (basic capped at ₹15,000). Professional tax ₹200 when gross is above ₹15,000')}
        ${li('Income tax (TDS) is deducted monthly as per the new tax regime estimate')}
        ${li('Payslips are published once payroll for the month is finalized')}</ul></div>
      <div><h3>🧾 Expenses</h3><ul class="policy">
        ${li('Submit claims with category, amount and date; your manager or the company approves them')}
        ${li('Approved claims are paid out with the next payroll')}</ul></div>
    </div></div>`;
}
PAGES.dashboard = async () => {
  const [d, attHtml] = await Promise.all([api('GET', '/api/dashboard'), isAdmin() ? '' : PAGES.attendance().catch(e => `<div class="card"><p class="err">${esc(e.message)}</p></div>`)]);
  const u = S.user, t = d.today;
  const stat = (n, l) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  let stats = '';
  if (d.stats && d.stats.headcount !== undefined) stats = `<div class="grid g4" style="margin-bottom:16px">${stat(d.stats.headcount, 'Headcount')}${stat(d.stats.present, 'Present today')}${stat(d.stats.onLeave, 'On leave today')}${stat(d.stats.newJoiners, 'Joined this month')}
    ${stat(d.stats.pendingLeaves, 'Pending leaves')}${stat(d.stats.pendingExpenses, 'Pending expenses')}${stat(d.stats.openTickets, 'Open tickets')}${stat(d.stats.openJobs, 'Open positions')}</div>`;
  else if (d.stats) stats = `<div class="grid g3" style="margin-bottom:16px">${stat(d.stats.teamSize, 'Team size')}${stat(d.stats.pendingLeaves, 'Leaves to approve')}${stat(d.stats.pendingExpenses, 'Expenses to approve')}</div>`;
  const hr = new Date().getHours(), greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const att = !t ? `<p class="muted">You haven't checked in today.</p><button class="btn primary" data-act="checkin" data-id="office">Check in (Office)</button> <button class="btn" data-act="checkin" data-id="wfh">Check in (WFH)</button>`
    : `<p>Checked in at <b>${t.check_in}</b> ${badge(t.status)}${t.late ? ' <span class="badge pending">late</span>' : ''}${t.reason ? ` <small class="muted">${esc(t.reason)}</small>` : ''}${t.check_out ? ` · out at <b>${t.check_out}</b>` : ''}</p>${t.check_out ? '<p class="muted">Have a great evening!</p>' : '<button class="btn danger" data-act="checkout">Check out</button>'}`;
  return `${head(`${greet}, ${u.name.split(' ')[0]} 👋`, new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}
  ${punchCard(d)}
  ${isAdmin() ? '' : profileBanner(d)}
  ${isAdmin() ? '' : `<div class="embed">${attHtml}</div>${policiesCard(d.policies)}`}
  ${stats}
  ${d.pendingRequests ? `<div class="card" style="border-left:4px solid var(--brand)">📨 <b>${d.pendingRequests}</b> pending employee request(s) — resignation, transfer or work type change. <a href="#" data-act="goRequests">Review now</a></div>` : ''}
  ${isAdmin() ? policiesCard(d.policies) : ''}
  <div class="grid g2 personal">
    <div class="card"><h2>📅 This month</h2>${monthSummaryHtml(d.monthSummary)}</div>
    <div class="card"><h2>Leave balance</h2>${d.balances.filter(b => b.days_per_year).map(b => `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between"><span>${esc(b.name)}</span><b>${b.balance} / ${b.days_per_year}</b></div>${bar(100 - (b.balance / b.days_per_year) * 100)}</div>`).join('')}</div>
  </div>
  <div class="grid g2">
    <div class="card"><h2>📢 Announcements</h2>${d.announcements.map(a => `<div style="margin-bottom:12px"><b>${esc(a.title)}</b> <span class="muted">· ${fd(a.created)} · ${esc(a.author)}</span><div>${esc(a.body)}</div></div>`).join('') || '<div class="empty">No announcements</div>'}</div>
    <div>
      <div class="card"><h2>🎉 Upcoming holidays</h2>${d.holidays.map(h => `<div>${fd(h.date)} — <b>${esc(h.name)}</b></div>`).join('') || '<span class="muted">None upcoming</span>'}</div>
      <div class="card staffonly"><h2>🎂 Birthdays this month</h2>${d.birthdays.map(b => `<div>${esc(b.name)} <span class="muted">· ${fd(b.dob).slice(0, 6)}</span></div>`).join('') || '<span class="muted">None</span>'}</div>
    </div>
  </div>
  <div class="grid g2 personal">
    <div class="card"><h2>🎯 My goals</h2>${d.myGoals.map(g => `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between"><span>${esc(g.title)}</span><b>${g.progress}%</b></div>${bar(g.progress)}</div>`).join('') || '<span class="muted">No active goals. <a href="#/performance">Add one</a></span>'}</div>
    <div class="card"><h2>🎓 My learning</h2>${d.myCourses.map(c => `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between"><span>${esc(c.title)}</span><b>${c.progress}%</b></div>${bar(c.progress)}</div>`).join('') || '<span class="muted">No courses yet. <a href="#/learning">Browse</a></span>'}</div>
  </div>
  ${d.byDept ? `<div class="card"><h2>Headcount by department</h2>${d.byDept.map(x => `<div style="display:flex;gap:10px;align-items:center;margin:6px 0"><span style="width:140px">${esc(x.name)}</span><div class="bar grow">${`<i style="width:${x.c / d.stats.headcount * 100}%"></i>`}</div><b>${x.c}</b></div>`).join('')}</div>` : ''}`;
};

// ---- employees ----
const empFields = (e = {}, adding) => [
  { name: 'name', label: 'Full name', value: e.name, required: true }, ...(isAdmin() ? [{ name: 'email', label: 'Work email', type: 'email', value: e.email, required: true }] : []),
  { name: 'phone', label: 'Phone', value: e.phone }, { name: 'designation', label: 'Designation', value: e.designation },
  { name: 'dept_id', label: 'Department', type: 'select', options: S.lk.departments.map(d => [d.id, d.name]), value: e.dept_id, blank: '— Select —' },
  { name: 'manager_id', label: 'Reporting manager', type: 'select', options: S.lk.employees.filter(x => x.id !== e.id).map(x => [x.id, `${x.name} (${x.emp_code})`]), value: e.manager_id, blank: '— None —' },
  { name: 'join_date', label: 'Joining date', type: 'date', value: e.join_date || today(), required: true },
  ...(isAdmin() && e.role !== 'admin' ? accessFields(e) : []),
  { name: 'employment_type', label: 'Employment type', type: 'select', options: ['Full-time', 'Part-time', 'Contract', 'Intern'].map(x => [x, x]), value: e.employment_type },
  { name: 'location', label: 'Work location', value: e.location }, { name: 'work_type', label: 'Work type', type: 'select', options: WORK_TYPES.map(x => [x, x]), value: e.work_type || 'Office' }, { name: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female', 'Other'].map(x => [x, x]), value: e.gender, blank: '—' },
  { name: 'dob', label: 'Date of birth', type: 'date', value: e.dob }, ...(can('payroll') ? [{ name: 'ctc', label: 'Annual CTC (₹)', type: 'number', value: e.ctc, min: 0 }] : []),
  { name: 'pan', label: 'PAN', value: e.pan }, { name: 'bank_account', label: 'Bank account no.', value: e.bank_account },
  { name: 'address', label: 'Address', type: 'textarea', value: e.address, full: true },
  ...(!isAdmin() ? [] : adding ? [{ name: 'password', label: 'Initial password (blank = welcome123)', type: 'text', value: '' }, PW] : [{ name: 'password', label: 'Reset password (leave blank to keep)', value: '' }, { ...PW, required: false, label: 'Your password (needed only when changing the password or account type)' }]),
];
const addEmployee = (prefill = {}, after) => openForm({ title: 'Add employee', wide: true, submit: 'Create employee', fields: empFields(prefill, true),
  onSubmit: async v => { const r = await api('POST', '/api/employees', v); S.lk = await api('GET', '/api/lookups'); setTimeout(() => modal(`<h2>Employee created ✅</h2><p>Share these login details with the employee (they sign in on the employee login page):</p><dl class="kv"><dt>Employee ID</dt><dd><b>${esc(r.emp_code)}</b></dd><dt>Password</dt><dd><b>${esc(r.password)}</b></dd></dl><div class="actions"><button class="btn primary" data-act="closeModal">Done</button></div>`), 50); if (after) await after(r.id); } });

PAGES.employees = async () => {
  const q = S.empQ || {};
  const list = await api('GET', '/api/employees');
  const rows = list.filter(e => (!q.s || (e.name + e.email + e.emp_code + (e.designation || '')).toLowerCase().includes(q.s.toLowerCase())) && (!q.d || String(e.dept_id) === q.d) && (!q.st || e.status === q.st));
  const tab = tabsHtml('employees', [['list', 'Directory'], ['org', 'Org chart']]);
  let body;
  if (S.tab.employees === 'org') {
    const by = {}; list.filter(e => e.status !== 'exited').forEach(e => (by[e.manager_id || 0] ||= []).push(e));
    const node = e => `<li><span class="node" data-act="go" data-id="employee/${e.id}"><span class="avatar">${initials(e.name)}</span><span><b>${esc(e.name)}</b><br><small class="muted">${esc(e.designation || '')}</small></span></span>${by[e.id] ? `<ul>${by[e.id].map(node).join('')}</ul>` : ''}</li>`;
    const roots = list.filter(e => e.status !== 'exited' && (!e.manager_id || !list.some(x => x.id === e.manager_id && x.status !== 'exited')));
    body = `<div class="card tree"><ul>${roots.map(node).join('')}</ul></div>`;
  } else body = `<div class="card"><div class="toolbar"><input id="eq" placeholder="Search name, email, ID…" value="${esc(q.s || '')}">
    <select id="ed">${opts(S.lk.departments.map(d => [d.id, d.name]), q.d, 'All departments')}</select>
    <select id="est">${opts([['active', 'Active'], ['notice', 'On notice'], ['exited', 'Exited']], q.st, 'All statuses')}</select>
    ${can('employees') ? '<button class="btn" data-act="exportEmps">Export CSV</button>' : ''}</div>
    ${table([{ h: 'ID', f: e => e.emp_code }, { h: 'Employee', f: e => `<a href="#/employee/${e.id}"><span class="avatar">${initials(e.name)}</span> <b>${esc(e.name)}</b></a><br><small class="muted">${esc(e.email)}</small>` },
      { h: 'Designation', f: e => esc(e.designation) }, { h: 'Department', f: e => esc(e.dept) }, { h: 'Manager', f: e => esc(e.manager) }, { h: 'Joined', f: e => fd(e.join_date) }, { h: 'Status', f: e => badge(e.status) },
      ...(list.some(e => e.today) ? [{ h: 'Today (live)', f: e => e.today ? stBadge(e.today) + (e.today.check_in ? `<br><small class="muted">${e.today.check_in}${e.today.check_out ? '–' + e.today.check_out : ''}</small>` : '') : '' }] : []), ...profileCols(list)], rows, 'No employees match.')}</div>`;
  S._emps = rows;
  return head('Employees', `${list.filter(e => e.status !== 'exited').length} active people`, isAdmin() ? '<button class="btn primary" data-act="addEmp">+ Add employee</button>' : '') + tab + body;
};
PAGES.employee = async id => {
  const e = await api('GET', '/api/employees/' + id), me = S.user, hrv = can('employees');
  const prof = (can('employees') && e.id !== me.id) ? await api('GET', '/api/profile?emp_id=' + e.id).catch(() => null) : null;
  let sal = '', bal = '';
  if (can('payroll') || e.id === me.id) { const s = await api('GET', '/api/salary-structure?emp_id=' + e.id); sal = `<div class="card"><h2>Salary structure (monthly)</h2><dl class="kv"><dt>Annual CTC</dt><dd><b>${inr(s.ctc)}</b></dd><dt>Basic</dt><dd>${inr(s.monthly.basic)}</dd><dt>HRA</dt><dd>${inr(s.monthly.hra)}</dd><dt>Special allowance</dt><dd>${inr(s.monthly.special)}</dd><dt>Gross / month</dt><dd><b>${inr(s.monthly.gross)}</b></dd><dt>Est. annual tax</dt><dd>${inr(s.annualTax)} <small class="muted">(new regime estimate)</small></dd></dl></div>`; }
  if (e.pan !== undefined) { const b = await api('GET', '/api/leaves/balance?emp_id=' + e.id); bal = `<div class="card"><h2>Leave balance</h2>${b.filter(x => x.days_per_year).map(x => `<div style="display:flex;justify-content:space-between"><span>${esc(x.name)}</span><b>${x.balance} / ${x.days_per_year}</b></div>`).join('')}</div>`; }
  const kv = [['Employee ID', e.emp_code], ['Email', e.email], ['Phone', e.phone], ['Department', e.dept], ['Designation', e.designation], ['Reports to', e.manager ? `<a href="#/employee/${e.manager_id}">${esc(e.manager)}</a>` : '—'], ['Joined', fd(e.join_date)], ['Type', e.employment_type], ['Location', e.location], ['Work type', e.work_type], ['Role', e.role],
    ...(e.pan !== undefined ? [['DOB', fd(e.dob)], ['Gender', e.gender], ['PAN', e.pan], ['Bank a/c', e.bank_account], ['Address', e.address]] : [])];
  const canEdit = hrv, own = e.id === me.id;
  return `<p><a href="#/employees">← Employees</a></p><div class="card" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"><span class="avatar lg">${initials(e.name)}</span>
    <div class="grow"><h1>${esc(e.name)} ${badge(e.status)} ${e.role === 'admin' ? '<span class="badge approved">Admin</span>' : e.role === 'manager' ? '<span class="badge pending">Managing access</span>' : ''}</h1><div class="muted">${esc(e.designation || '')} · ${esc(e.dept || '')}</div>${e.today ? `<div style="margin-top:6px">Today: ${stBadge(e.today)}${e.today.check_in ? ` <small class="muted">in ${e.today.check_in}${e.today.check_out ? ' · out ' + e.today.check_out : ''}</small>` : ''}</div>` : ''}${e.exit_date ? `<div class="err">Last working day: ${fd(e.exit_date)} ${e.exit_reason ? '— ' + esc(e.exit_reason) : ''}</div>` : ''}</div>
    ${canEdit ? `<button class="btn" data-act="editEmp" data-id="${e.id}">Edit</button>` : ''}${own && !canEdit ? `<button class="btn" data-act="editSelf" data-id="${e.id}">Update my details</button>` : ''}
    ${can('onboarding') && e.status === 'active' && e.role !== 'admin' ? `<button class="btn danger" data-act="offboard" data-id="${e.id}">Start offboarding</button>` : ''}
    ${can('onboarding') && e.status === 'notice' ? `<button class="btn" data-act="cancelExit" data-id="${e.id}">Cancel exit</button>` : ''}</div>
    <div class="grid g2"><div class="card"><h2>Profile</h2><dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${k === 'Reports to' ? v : esc(v) || '—'}</dd>`).join('')}</dl></div>
    <div>${profileCard(e, prof)}${profileRequests(e)}${(e.role === 'manager' && e.perms?.length && (e.pan !== undefined)) ? `<div class="card"><h2>Can manage</h2>${e.perms.map(p => `<span class="badge" style="margin:2px">${esc(permLabel(p))}</span>`).join(' ')}</div>` : ''}${sal}${bal}<div class="card"><h2>Assigned assets</h2>${e.assets.map(a => `<div>${esc(a.name)} <span class="muted">${esc(a.tag)}</span></div>`).join('') || '<span class="muted">None</span>'}</div>
    ${e.reports.length ? `<div class="card"><h2>Direct reports</h2>${e.reports.map(r => `<div><a href="#/employee/${r.id}">${esc(r.name)}</a> <span class="muted">${esc(r.designation || '')}</span></div>`).join('')}</div>` : ''}</div></div>`;
};

// ---- attendance ----
PAGES.attendance = async () => {
  if (isAdmin()) return adminAttendance();
  const items = [['mine', 'My attendance']]; if (can('attendance') || can('team')) items.push(['team', 'Team / daily']); if (can('attendance')) items.push(['report', 'Monthly report']); items.push(['history', 'Punch history']);
  const tabs = tabsHtml('attendance', items), tab = S.tab.attendance;
  if (tab === 'history') return historyTab(tabs);
  if (tab === 'mine') {
    const month = S.attMonth || ym(new Date()), a = await api('GET', '/api/attendance?month=' + month);
    const [y, m] = month.split('-').map(Number), firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7, days = new Date(y, m, 0).getDate();
    const byDate = Object.fromEntries(a.rows.map(r => [r.date, r])), hol = Object.fromEntries(a.holidays.map(h => [h.date, h.name]));
    let cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<div class="dh">${x}</div>`).join('') + '<div></div>'.repeat(firstDow);
    for (let d = 1; d <= days; d++) {
      const ds = `${month}-${String(d).padStart(2, '0')}`, dow = new Date(y, m - 1, d).getDay(), r = byDate[ds], lv = a.leaves.find(l => l.from_date <= ds && l.to_date >= ds);
      const off = dow === 0 || dow === 6;
      cells += `<div class="day ${off ? 'off' : ''} ${hol[ds] ? 'hol' : ''}"><b>${d}</b> ${r ? badge(r.status) : hol[ds] ? `<span class="badge">${esc(hol[ds])}</span>` : lv ? `<span class="badge approved">${esc(lv.name)}</span>` : a.days?.[ds]?.status === 'absent' ? '<span class="badge rejected">absent</span>' : ''}${r ? `<br><small>${r.check_in || ''}–${r.check_out || ''}${r.hours ? ' · ' + r.hours + 'h' : ''}</small>` : ''}${r && (r.reason || r.late) ? `<br><small class="muted">${r.late ? 'late' : esc(r.reason)}</small>` : ''}</div>`;
    }
    const cnt = s => a.rows.filter(r => r.status === s).length;
    return head('Attendance', 'Your daily check-ins', `<input type="month" id="attMonth" value="${month}" style="width:auto">`) + tabs +
      `<div class="grid g4" style="margin-bottom:16px"><div class="stat"><div class="n">${cnt('present')}</div><div class="l">Present</div></div><div class="stat"><div class="n">${cnt('wfh')}</div><div class="l">Work from home</div></div><div class="stat"><div class="n">${cnt('half')}</div><div class="l">Half days</div></div><div class="stat"><div class="n">${a.leaves.length}</div><div class="l">Leave periods</div></div></div>
      <div class="card"><div class="cal">${cells}</div></div>`;
  }
  if (tab === 'team') {
    const date = S.attDate || today(), rows = await api('GET', '/api/attendance/day?date=' + date);
    return head('Attendance', 'Who is in today?', `<a class="btn" href="#/location">📍 Office location</a> <input type="date" id="attDate" value="${date}" style="width:auto">`) + tabs +
      `<div class="card">${table([{ h: 'Employee', f: r => `<b>${esc(r.name)}</b><br><small class="muted">${esc(r.designation || '')}</small>` }, { h: 'Status', f: r => r.att ? badge(r.att.status) : r.leave ? `<span class="badge approved">${esc(r.leave.name)}</span>` : '<span class="badge rejected">absent</span>' },
        { h: 'In', f: r => r.att?.check_in || '—' }, { h: 'Out', f: r => r.att?.check_out || '—' },
        ...(can('attendance') ? [{ h: 'Mark', f: r => `<select data-mark="${r.id}" data-date="${date}" style="width:auto;margin:0">${opts([['present', 'Present'], ['wfh', 'WFH'], ['half', 'Half day'], ['absent', 'Absent']], r.att?.status || 'absent')}</select>` }] : [])], rows)}</div>`;
  }
  const month = S.repMonth || ym(new Date()), rows = await api('GET', '/api/reports/attendance?month=' + month); S._rep = rows;
  return head('Monthly attendance report', monthName(month), `<input type="month" id="repMonth" value="${month}" style="width:auto"> <button class="btn" data-act="exportRep">Export CSV</button>`) + tabs +
    `<div class="card">${table([{ h: 'ID', f: r => r.emp_code }, { h: 'Employee', f: r => esc(r.name) }, { h: 'Present', f: r => r.present }, { h: 'WFH', f: r => r.wfh }, { h: 'Half days', f: r => r.half }, { h: 'Absent', f: r => r.absent }, { h: 'Hours worked', f: r => r.hours }, { h: 'Total days', f: r => r.present + r.wfh + r.half * 0.5 }], rows)}</div>`;
};

const stBadge = r => `<span class="badge ${ST[r.status][1]}">${ST[r.status][0]}${r.leave_type ? ' · ' + esc(r.leave_type) : ''}</span>${r.in_progress ? ' <span class="badge wfh">working now</span>' : ''}${r.late ? ' <span class="badge pending">late</span>' : ''}${r.reason ? `<br><small class="muted">${esc(r.reason)}</small>` : ''}`;
const ST = { pending: ['Yet to arrive', 'pending'], office: ['In office', 'present'], wfh: ['Work from home', 'wfh'], half: ['Half day', 'half'], leave: ['On leave', 'approved'], absent: ['Absent / not in', 'rejected'], off: ['Weekend / holiday', ''] };
async function adminAttendance() {
  const tabs = tabsHtml('attendance', [['overview', 'Company attendance'], ['report', 'Monthly report'], ['history', 'Punch locations']]);
  if (S.tab.attendance === 'history') return historyTab(tabs);
  if (S.tab.attendance === 'report') {
    const month = S.repMonth || ym(new Date()), rows = await api('GET', '/api/reports/attendance?month=' + month); S._rep = rows;
    return head('Monthly attendance report', monthName(month), `<input type="month" id="repMonth" value="${month}" style="width:auto"> <button class="btn" data-act="exportRep">Export CSV</button>`) + tabs +
      `<div class="card">${table([{ h: 'ID', f: r => r.emp_code }, { h: 'Employee', f: r => esc(r.name) }, { h: 'In office', f: r => r.present }, { h: 'WFH', f: r => r.wfh }, { h: 'Half days', f: r => r.half }, { h: 'Absent', f: r => r.absent }, { h: 'Hours worked', f: r => r.hours }, { h: 'Total days', f: r => r.present + r.wfh + r.half * 0.5 }], rows)}</div>`;
  }
  const date = S.attDate || today(), o = await api('GET', '/api/attendance/overview?date=' + date), f = S.attFilter || 'all';
  const c = o.counts, cfg = o.cfg, live = new Date().toLocaleTimeString('en-IN');
  const chip = (k, label, n) => `<button class="btn ${f === k ? 'primary' : ''}" data-act="attFilter" data-id="${k}">${label} <b>${n}</b></button>`;
  const shown = o.rows.filter(r => f === 'all' || r.status === f || (f === 'late' && r.late));
  const stat = (n, l) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  return head('Company attendance', new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + (o.holiday ? ' · ' + o.holiday : !o.workday ? ' · Weekend' : ''), `<span class="muted">🟢 Live · updated ${live}</span> <input type="date" id="attDate" value="${date}" style="width:auto">`) + tabs +
    `<div class="grid g4" style="margin-bottom:16px">${stat(c.office, '🏢 In office')}${stat(c.wfh, '🏠 Work from home')}${stat(c.leave, '🌴 On leave')}${stat(c.absent, '🚫 Absent')}</div>
    <div class="card"><small class="muted"><b>Office policies</b> — office ${cfg.office_start}–${cfg.office_end} (${cfg.office_hours}h). Hours = punch-in to punch-out. Under ${cfg.half_day_hours}h → <b>Absent</b> · ${cfg.half_day_hours}–${cfg.full_day_hours}h → <b>Half day</b> · ${cfg.full_day_hours}–${cfg.office_hours}h → <b>Full day</b> for the first ${cfg.allowance_days} such days a month, then Half day · ${cfg.office_hours}h+ → <b>Full day</b>. Up to ${cfg.grace_minutes} min late is allowed ${cfg.allowance_days} days a month, then Half day (later than that is always Half day). No punch-in by ${cfg.grace_end} → <b>Absent</b>. This page refreshes itself as employees punch in and out. <a href="#/settings">Change rules</a></small></div>
    <div class="card"><div class="toolbar">${chip('all', 'Everyone', c.total)}${chip('office', 'In office', c.office)}${chip('wfh', 'WFH', c.wfh)}${chip('half', 'Half day', c.half)}${chip('leave', 'On leave', c.leave)}${chip('absent', 'Absent', c.absent)}${chip('pending', 'Yet to arrive', c.pending)}${chip('late', 'Late', c.late)}</div>
    ${table([{ h: 'Employee', f: r => `<b>${esc(r.name)}</b><br><small class="muted">${esc(r.emp_code)} · ${esc(r.designation || '')}</small>` }, { h: 'Department', f: r => esc(r.dept) }, { h: 'Status', f: stBadge },
      { h: 'In', f: r => r.check_in || '—' }, { h: 'Out', f: r => r.check_out || '—' }, { h: 'Hours', f: r => r.hours ?? '—' },
      { h: 'Correct', f: r => `<select data-mark="${r.id}" data-date="${date}" style="width:auto;margin:0">${opts([['auto', 'Automatic'], ['present', 'In office'], ['wfh', 'WFH'], ['half', 'Half day'], ['absent', 'Absent']], r.manual ? (r.status === 'office' ? 'present' : r.status) : 'auto')}</select>` }], shown, 'No employees in this view.')}</div>`;
}

// ---- leave ----
PAGES.leave = async () => {
  const items = [['mine', 'My leaves'], ['requests', 'Resign · Transfer · Work type']]; if (can('leave') || can('team')) items.push(['approve', 'Approvals']); items.push(['holidays', 'Holidays']);
  const tabs = tabsHtml('leave', items), tab = S.tab.leave;
  if (tab === 'mine') {
    const [bal, list] = await Promise.all([api('GET', '/api/leaves/balance'), api('GET', '/api/leaves')]);
    const wfhDays = list.filter(l => l.type === 'Work From Home' && l.status === 'approved').reduce((t, l) => t + l.days, 0);
    return head('Leave & work from home', 'Apply for CL, PL, sick leave or work from home and track requests', '<button class="btn primary" data-act="applyLeave">+ Apply leave / Work from home</button>') + tabs +
      `<div class="grid g4" style="margin-bottom:16px"><div class="stat"><div class="n">${wfhDays}</div><div class="l">🏠 Work-from-home days approved</div></div>${bal.map(b => `<div class="stat"><div class="n">${b.days_per_year ? b.balance : '∞'}</div><div class="l">${esc(b.name)}${b.days_per_year ? ` of ${b.days_per_year}` : ''}</div>${b.pending ? `<small class="muted">${b.pending} pending</small>` : ''}</div>`).join('')}</div>
      <div class="card">${table([{ h: 'Type', f: l => esc(l.type) }, { h: 'From', f: l => fd(l.from_date) }, { h: 'To', f: l => fd(l.to_date) }, { h: 'Days', f: l => l.days }, { h: 'Reason', f: l => esc(l.reason) }, { h: 'Status', f: l => badge(l.status) + (l.note ? `<br><small class="muted">${esc(l.note)}</small>` : '') },
        { h: '', f: l => ['pending', 'approved'].includes(l.status) ? `<button class="btn sm" data-act="cancelLeave" data-id="${l.id}">Cancel</button>` : '' }], list, 'No leave requests yet.')}</div>`;
  }
  if (tab === 'requests') return requestsTab(tabs);
  if (tab === 'approve') {
    const list = await api('GET', '/api/leaves?scope=manage');
    return head('Leave approvals', '') + tabs + `<div class="card">${table([{ h: 'Employee', f: l => `<b>${esc(l.emp_name)}</b>` }, { h: 'Type', f: l => esc(l.type) }, { h: 'Dates', f: l => `${fd(l.from_date)} → ${fd(l.to_date)}` }, { h: 'Days', f: l => l.days }, { h: 'Reason', f: l => esc(l.reason) },
      { h: 'Status', f: l => badge(l.status) + (l.approver ? `<br><small class="muted">by ${esc(l.approver)}</small>` : '') },
      { h: '', f: l => l.status === 'pending' && l.emp_id !== S.user.id ? `<button class="btn sm ok" data-act="decideLeave" data-id="${l.id}" data-v="approved">Approve</button> <button class="btn sm danger" data-act="decideLeave" data-id="${l.id}" data-v="rejected">Reject</button>` : '' }], list, 'No requests.')}</div>`;
  }
  const hs = await api('GET', '/api/holidays');
  return head('Holiday calendar', String(new Date().getFullYear())) + tabs + `<div class="card">${table([{ h: 'Date', f: h => fd(h.date) }, { h: 'Day', f: h => new Date(h.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long' }) }, { h: 'Holiday', f: h => `<b>${esc(h.name)}</b>` }], hs)}</div>`;
};

// ---- payroll ----
const slipHtml = p => `<div class="slip"><div style="display:flex;align-items:center;gap:10px">${logoImg(S.user.company, 'md')}<h2 style="margin:0">${esc(S.user.company?.name || 'Company')}</h2></div><div class="muted">Payslip for ${monthName(p.month)}</div><hr>
  <div class="grid g2"><dl class="kv"><dt>Employee</dt><dd><b>${esc(p.name)}</b></dd><dt>Emp ID</dt><dd>${esc(p.emp_code)}</dd><dt>Designation</dt><dd>${esc(p.designation)}</dd><dt>Department</dt><dd>${esc(p.dept || '—')}</dd></dl>
  <dl class="kv"><dt>PAN</dt><dd>${esc(p.pan || '—')}</dd><dt>Bank a/c</dt><dd>${esc(p.bank_account || '—')}</dd><dt>Working days</dt><dd>${p.working_days}</dd><dt>Paid days</dt><dd>${p.paid_days} <span class="muted">(LOP ${p.lop_days})</span></dd></dl></div>
  <div class="grid g2"><div><h3>Earnings</h3><table><tr><td>Basic</td><td class="right">${inr(p.basic)}</td></tr><tr><td>HRA</td><td class="right">${inr(p.hra)}</td></tr><tr><td>Special allowance</td><td class="right">${inr(p.special)}</td></tr>${p.reimbursements ? `<tr><td>Reimbursements</td><td class="right">${inr(p.reimbursements)}</td></tr>` : ''}<tr><th>Gross</th><th class="right">${inr(p.gross)}</th></tr></table></div>
  <div><h3>Deductions</h3><table><tr><td>Provident Fund</td><td class="right">${inr(p.pf)}</td></tr><tr><td>Professional Tax</td><td class="right">${inr(p.pt)}</td></tr><tr><td>Income Tax (TDS)</td><td class="right">${inr(p.tds)}</td></tr><tr><th>Total</th><th class="right">${inr(p.deductions)}</th></tr></table></div></div>
  <h2 style="text-align:right;margin-top:16px">Net pay: ${inr(p.net)}</h2><small class="muted">System-generated payslip. Tax figures are estimates.</small></div>`;
function printSlip(html) {
  const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print', true);
  w.document.write(`<html><head><title>Payslip</title><link rel="stylesheet" href="/style.css"></head><body style="padding:20px">${html}</body></html>`); w.document.close(); setTimeout(() => w.print(), 400);
}
async function adminPayroll() {
  const tabs = tabsHtml('payroll', [['all', 'All employees'], ['runs', 'Payroll runs']]);
  if (S.tab.payroll === 'runs') {
    const runs = await api('GET', '/api/payroll/runs');
    return head('Payroll runs', 'Calculate, review and finalize monthly payroll', '<button class="btn primary" data-act="runPayroll">Run payroll</button>') + tabs +
      `<div class="card">${table([{ h: 'Month', f: r => `<b>${monthName(r.month)}</b>` }, { h: 'Employees', f: r => r.count }, { h: 'Gross', f: r => inr(r.total_gross) }, { h: 'Net payout', f: r => inr(r.total_net) }, { h: 'Status', f: r => badge(r.status) }, { h: '', f: r => `<button class="btn sm" data-act="viewRun" data-id="${r.id}">Open</button>` }], runs, 'No payroll run yet.')}</div>`;
  }
  const month = S.payMonth || ym(new Date()), o = await api('GET', '/api/payroll/overview?month=' + month); S._slips = o.rows; S._payOv = o;
  const stat = (n, l) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const status = o.run ? badge(o.run.status) : '<span class="badge">not run yet · preview</span>';
  return head('Payroll — all employees', monthName(month), `<input type="month" id="payMonth" value="${month}" style="width:auto"> <button class="btn" data-act="exportPayOv">Export CSV</button> ${o.run?.status === 'finalized' ? '' : '<button class="btn primary" data-act="runPayroll">Run / recalculate payroll</button>'}`) + tabs +
    `<div class="grid g4" style="margin-bottom:16px">${stat(o.totals.employees, 'Employees on payroll')}${stat(inr(o.totals.gross), 'Total gross')}${stat(inr(o.totals.deductions), 'Total deductions')}${stat(inr(o.totals.net), 'Net payout')}</div>
    <div class="card"><p>Status: ${status} ${o.run ? '' : '<span class="muted">— figures are calculated live from attendance and approved leave; run payroll to save and publish payslips.</span>'}</p>
    ${table([{ h: 'Employee', f: p => `<a href="#/employee/${p.emp_id}"><b>${esc(p.name)}</b></a><br><small class="muted">${esc(p.emp_code)} · ${esc(p.designation || '')}</small>` }, { h: 'Annual CTC', f: p => inr(p.ctc) }, { h: 'Paid days', f: p => `${p.paid_days}/${p.working_days}` },
      { h: 'Gross', f: p => inr(p.gross) }, { h: 'PF', f: p => inr(p.pf) }, { h: 'PT', f: p => inr(p.pt) }, { h: 'TDS', f: p => inr(p.tds) }, { h: 'Reimb.', f: p => inr(p.reimbursements) }, { h: 'Net pay', f: p => `<b>${inr(p.net)}</b>` }, { h: '', f: p => `<button class="btn sm" data-act="viewSlip" data-id="${p.id}">Slip</button>` }], o.rows, 'No employees with a salary set.')}</div>`;
}
PAGES.payroll = async () => {
  if (isAdmin()) return adminPayroll();
  const items = [['slips', 'My payslips']]; if (can('payroll')) items.unshift(['runs', 'Payroll runs']);
  const tabs = tabsHtml('payroll', items), tab = S.tab.payroll;
  if (tab === 'runs') {
    const runs = await api('GET', '/api/payroll/runs');
    return head('Payroll', 'Run, review and finalize monthly payroll', '<button class="btn primary" data-act="runPayroll">Run payroll</button>') + tabs +
      `<div class="card"><p class="muted">Net pay = gross (pro-rated for loss-of-pay days) − PF (12% of basic, capped at ₹15,000 basic) − Professional Tax − TDS (new-regime estimate) + approved reimbursements.</p>
      ${table([{ h: 'Month', f: r => `<b>${monthName(r.month)}</b>` }, { h: 'Employees', f: r => r.count }, { h: 'Gross', f: r => inr(r.total_gross) }, { h: 'Net payout', f: r => inr(r.total_net) }, { h: 'Status', f: r => badge(r.status) }, { h: '', f: r => `<button class="btn sm" data-act="viewRun" data-id="${r.id}">Open</button>` }], runs, 'No payroll run yet.')}</div>`;
  }
  const [slips, sal] = await Promise.all([api('GET', '/api/payslips'), api('GET', '/api/salary-structure')]); S._slips = slips;
  return head('Payslips', 'Your salary history') + tabs + `<div class="grid g2"><div class="card"><h2>Salary structure</h2><dl class="kv"><dt>Annual CTC</dt><dd><b>${inr(sal.ctc)}</b></dd><dt>Basic</dt><dd>${inr(sal.monthly.basic)}/mo</dd><dt>HRA</dt><dd>${inr(sal.monthly.hra)}/mo</dd><dt>Special</dt><dd>${inr(sal.monthly.special)}/mo</dd><dt>Gross</dt><dd>${inr(sal.monthly.gross)}/mo</dd></dl></div>
    <div class="card"><h2>Payslips</h2>${table([{ h: 'Month', f: p => monthName(p.month) }, { h: 'Net pay', f: p => `<b>${inr(p.net)}</b>` }, { h: '', f: (p) => `<button class="btn sm" data-act="viewSlip" data-id="${p.id}">View</button>` }], slips, 'No payslips published yet.')}</div></div>`;
};

// ---- recruitment ----
const STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'];
PAGES.recruitment = async () => {
  const tabs = tabsHtml('recruitment', [['pipe', 'Candidate pipeline'], ['jobs', 'Job openings']]);
  const [jobs, cands] = await Promise.all([api('GET', '/api/jobs'), api('GET', '/api/candidates')]); S._cands = cands; S._jobs = jobs;
  if (S.tab.recruitment === 'jobs') return head('Recruitment', 'Open positions', '<button class="btn primary" data-act="addJob">+ New job</button>') + tabs +
    `<div class="card">${table([{ h: 'Title', f: j => `<b>${esc(j.title)}</b>` }, { h: 'Department', f: j => esc(j.dept) }, { h: 'Openings', f: j => j.openings }, { h: 'Location', f: j => esc(j.location) }, { h: 'Candidates', f: j => j.candidates }, { h: 'Status', f: j => badge(j.status) },
      { h: '', f: j => `<button class="btn sm" data-act="toggleJob" data-id="${j.id}" data-v="${j.status === 'open' ? 'closed' : 'open'}">${j.status === 'open' ? 'Close' : 'Reopen'}</button>` }], jobs)}</div>`;
  return head('Recruitment', 'Move candidates through the hiring funnel', '<button class="btn primary" data-act="addCand">+ Add candidate</button>') + tabs +
    `<div class="kanban">${STAGES.map(s => { const cs = cands.filter(c => c.stage === s); return `<div class="kcol"><h3>${s} <span class="badge">${cs.length}</span></h3>${cs.map(c => `<div class="kcard"><b>${esc(c.name)}</b><br><span class="muted">${esc(c.job)}</span><br><small>${esc(c.email)}${c.expected_ctc ? ' · ' + inr(c.expected_ctc) : ''}</small>
      ${s === 'Hired' ? '' : `<select data-stage="${c.id}">${opts(STAGES.filter(x => x !== 'Hired').map(x => [x, x]), c.stage)}</select>${s === 'Offer' ? (isAdmin() ? `<button class="btn sm ok block" data-act="hire" data-id="${c.id}">Hire → create employee</button>` : '<small class="muted">Admin creates the account</small>') : ''}`}</div>`).join('')}</div>`; }).join('')}</div>`;
};

// ---- onboarding / offboarding ----
PAGES.onboarding = async () => {
  const reqs = await api('GET', '/api/requests?scope=manage'), pend = reqs.filter(r => r.status === 'pending').length;
  const tabs = tabsHtml('onboarding', [['requests', `Requests${pend ? ' (' + pend + ')' : ''}`], ['onboarding', 'Onboarding'], ['offboarding', 'Offboarding']]), kind = S.tab.onboarding;
  if (kind === 'requests') return head('Employee requests', 'Resignations, transfers and work type changes — approve or reject') + tabs + `<div class="card">${reqTable(reqs, { withEmp: true, decide: true })}</div>`;
  const items = await api('GET', '/api/checklists?kind=' + kind);
  const groups = {}; items.forEach(i => (groups[i.emp_id] ||= { name: i.emp_name, code: i.emp_code, tasks: [] }).tasks.push(i));
  const cards = Object.entries(groups).map(([id, g]) => { const done = g.tasks.filter(t => t.done).length;
    return `<div class="card"><div style="display:flex;gap:10px;align-items:center"><h2 style="margin:0"><a href="#/employee/${id}">${esc(g.name)}</a> <small class="muted">${esc(g.code)}</small></h2><div class="grow"></div><b>${done}/${g.tasks.length}</b>${kind === 'offboarding' ? `<button class="btn sm danger" data-act="completeExit" data-id="${id}" ${done < g.tasks.length ? 'disabled' : ''}>Complete exit</button>` : ''}</div>
    ${bar(done / g.tasks.length * 100)}<div style="margin-top:10px">${g.tasks.map(t => `<label style="font-weight:400;margin:4px 0"><input type="checkbox" data-chk="${t.id}" ${t.done ? 'checked' : ''}> ${t.done ? `<s class="muted">${esc(t.title)}</s> <small class="muted">${fd(t.done_on)}</small>` : esc(t.title)}</label>`).join('')}</div>
    <button class="btn sm" data-act="addTask" data-id="${id}" data-kind="${kind}">+ Add task</button></div>`; }).join('');
  return head(kind === 'onboarding' ? 'Onboarding' : 'Offboarding', kind === 'onboarding' ? 'Checklists are created automatically when you add an employee' : 'Start offboarding from an employee profile; complete the checklist to finalize the exit') + tabs + (cards || '<div class="card empty">No active checklists.</div>');
};

// ---- performance ----
async function adminPerformance() {
  const tabs = tabsHtml('performance', [['rank', 'Ranking'], ['team', 'Employee detail']]);
  if (S.tab.performance === 'team') return perfTeam(tabs);
  const days = S.perfDays || '30', r = await api('GET', '/api/performance/ranking?days=' + days);
  const scored = r.rows.filter(x => x.score !== null), avg = scored.length ? Math.round(scored.reduce((t, x) => t + x.score, 0) / scored.length) : 0;
  const pct = v => v === null ? '<span class="muted">—</span>' : v + '%', medal = n => n === 1 ? '🥇' : n === 2 ? '🥈' : n === 3 ? '🥉' : n ?? '—';
  const tier = { Outstanding: 'approved', Strong: 'wfh', 'Meets expectations': 'pending', 'Needs attention': 'rejected' };
  const stat = (n, l) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  return head('Performance ranking', `Last ${r.days} days · ${fd(r.from)} to ${fd(r.to)}`, `<select id="perfDays" style="width:auto">${opts([['30', 'Last 30 days'], ['90', 'Last 90 days'], ['180', 'Last 6 months'], ['365', 'Last 12 months']], days)}</select>`) + tabs +
    `<div class="grid g4" style="margin-bottom:16px">${stat(scored.length, 'Employees ranked')}${stat(avg, 'Average score')}${stat(scored[0] ? esc(scored[0].name) : '—', 'Top performer')}${stat(scored.filter(x => x.score < 50).length, 'Need attention')}</div>
    <div class="card"><div class="tablewrap"><table><thead><tr><th>Rank</th><th>Employee</th><th>Score</th><th>Attendance</th><th>Punctuality</th><th>Goals</th><th>Review</th><th>Training</th><th>Rating</th></tr></thead><tbody>
    ${r.rows.map(x => `<tr><td style="font-size:18px">${medal(x.rank)}</td><td><a href="#" data-act="perfDetail" data-id="${x.id}"><b>${esc(x.name)}</b></a><br><small class="muted">${esc(x.designation || '')} · ${esc(x.dept || '')}</small></td>
      <td style="min-width:120px"><b>${x.score ?? '—'}</b>${x.score !== null ? bar(x.score) : ''}</td><td>${pct(x.attendance)}</td><td>${pct(x.punctuality)}</td><td>${x.goals === null ? '<span class="muted">—</span>' : x.goals + '% <small class="muted">(' + x.goals_done + '/' + x.goals_count + ' done)</small>'}</td>
      <td>${x.rating === null ? '<span class="muted">—</span>' : '<span class="stars">' + '★'.repeat(Math.round(x.rating)) + '</span> ' + x.rating}</td><td>${pct(x.training)}</td><td><span class="badge ${tier[x.tier] || ''}">${x.tier}</span></td></tr>`).join('')}</tbody></table></div>
    <p class="muted">Score = weighted average of: manager review rating (35%), goal progress (25%), attendance rate (20%), punctuality — check-in by ${r.punctual_by} (10%), mandatory training completion (10%). Paid leave is not counted against attendance; missing measures are left out and the rest re-weighted.</p>`;
}
PAGES.performance = async () => {
  if (isAdmin()) return adminPerformance();
  const items = [['goals', 'My goals'], ['reviews', 'My reviews']]; if (can('performance') || can('team')) items.push(['team', 'Team']);
  const tabs = tabsHtml('performance', items), tab = S.tab.performance, stars = n => `<span class="stars">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`;
  const goalTbl = (goals, ed) => goals.length ? goals.map(g => `<div class="card"><div style="display:flex;gap:10px;align-items:center"><div class="grow"><b>${esc(g.title)}</b> ${badge(g.status)}<div class="muted">${esc(g.description || '')} ${g.due ? '· due ' + fd(g.due) : ''}</div></div><b>${g.progress}%</b>
    <button class="btn sm" data-act="updGoal" data-id="${g.id}" data-v="${g.progress}">Update</button><button class="btn sm" data-act="delGoal" data-id="${g.id}">✕</button></div>${bar(g.progress)}</div>`).join('') : '<div class="card empty">No goals yet.</div>';
  if (tab === 'goals') return head('Goals & OKRs', 'Set objectives and track progress', '<button class="btn primary" data-act="addGoal">+ New goal</button>') + tabs + goalTbl(await api('GET', '/api/goals'));
  if (tab === 'reviews') { const r = await api('GET', '/api/reviews'); return head('Performance reviews', '') + tabs + `<div class="card">${table([{ h: 'Cycle', f: x => esc(x.cycle) }, { h: 'Rating', f: x => stars(x.rating) }, { h: 'Reviewer', f: x => esc(x.reviewer) }, { h: 'Comments', f: x => esc(x.comments) }, { h: 'Date', f: x => fd(x.created) }], r, 'No reviews yet.')}</div>`; }
  return perfTeam(tabs);
};
async function perfTeam(tabs) {
  const emps = (await api('GET', '/api/employees')).filter(e => e.status !== 'exited' && e.id !== S.user.id && (can('performance') || e.manager_id === S.user.id));
  const stars = n => `<span class="stars">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`;
  const goalTbl = (goals) => goals.length ? goals.map(g => `<div class="card"><div style="display:flex;gap:10px;align-items:center"><div class="grow"><b>${esc(g.title)}</b> ${badge(g.status)}<div class="muted">${esc(g.description || '')} ${g.due ? '· due ' + fd(g.due) : ''}</div></div><b>${g.progress}%</b><button class="btn sm" data-act="updGoal" data-id="${g.id}" data-v="${g.progress}">Update</button><button class="btn sm" data-act="delGoal" data-id="${g.id}">✕</button></div>${bar(g.progress)}</div>`).join('') : '<div class="card empty">No goals yet.</div>';
  const sel = S.perfEmp && emps.some(e => String(e.id) === String(S.perfEmp)) ? S.perfEmp : emps[0]?.id;
  if (!sel) return head('Team performance', '') + tabs + '<div class="card empty">You have no direct reports.</div>';
  const [goals, revs] = await Promise.all([api('GET', '/api/goals?emp_id=' + sel), api('GET', '/api/reviews?scope=manage')]);
  return head('Team performance', '', `<select id="perfEmp" style="width:auto">${opts(emps.map(e => [e.id, e.name]), sel)}</select> <button class="btn" data-act="addGoal" data-id="${sel}">+ Goal</button> <button class="btn primary" data-act="addReview" data-id="${sel}">Write review</button>`) + tabs +
    `<h2>Goals</h2>${goalTbl(goals)}<h2>Reviews</h2><div class="card">${table([{ h: 'Cycle', f: x => esc(x.cycle) }, { h: 'Rating', f: x => stars(x.rating) }, { h: 'Reviewer', f: x => esc(x.reviewer) }, { h: 'Comments', f: x => esc(x.comments) }], revs.filter(r => String(r.emp_id) === String(sel)), 'No reviews for this person.')}</div>`;
}

// ---- expenses ----
async function adminExpenses() {
  const tabs = tabsHtml('expenses', [['overview', 'Overview'], ['all', 'All expenses'], ['claims', 'Employee claims']]), tab = S.tab.expenses;
  const addBtn = '<button class="btn primary" data-act="addCompanyExpense">+ Add expense</button>';
  const stat = (n, l, sub = '') => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div><small class="muted">${sub}</small></div>`;
  if (tab === 'overview') {
    const s = await api('GET', '/api/expenses/summary'), max = Math.max(1, ...s.byMonth.map(m => m.total)), cmax = Math.max(1, ...s.byCategory.map(c => c.total));
    return head('Company expenses', 'Everything the company spends — rent, travel, accessories and employee claims', addBtn) + tabs +
      `<div class="grid g4" style="margin-bottom:16px">${stat(inr(s.total), 'Total expenses', 'company + approved claims')}${stat(inr(s.thisMonth), 'This month')}${stat(inr(s.company), 'Company expenses', s.companyCount + ' entries')}${stat(inr(s.claims), 'Employee claims paid', s.claimsCount + ' claims · ' + inr(s.pending) + ' pending')}</div>
      <div class="grid g2"><div class="card"><h2>By category</h2>${s.byCategory.map(c => `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between"><span>${esc(c.category)}</span><b>${inr(c.total)}</b></div>${bar(c.total / cmax * 100)}<small class="muted">Company ${inr(c.company)} · Employee claims ${inr(c.claims)}</small></div>`).join('') || '<div class="empty">No expenses yet.</div>'}</div>
      <div><div class="card"><h2>Last 6 months</h2>${s.byMonth.map(m => `<div style="display:flex;gap:10px;align-items:center;margin:6px 0"><span style="width:90px">${monthName(m.month).slice(0, 3)} ${m.month.slice(2, 4)}</span><div class="bar grow"><i style="width:${m.total / max * 100}%"></i></div><b>${inr(m.total)}</b></div>`).join('')}</div>
      <div class="card"><h2>Top claimants</h2>${s.topSpenders.map(t => `<div style="display:flex;justify-content:space-between"><span>${esc(t.name)} <small class="muted">${t.count} claims</small></span><b>${inr(t.total)}</b></div>`).join('') || '<span class="muted">No claims yet</span>'}</div></div></div>`;
  }
  if (tab === 'claims') {
    const list = await api('GET', '/api/expenses?scope=manage');
    return head('Employee expense claims', 'Approve or reject what employees submit') + tabs + `<div class="card">${table([{ h: 'Employee', f: x => esc(x.emp_name) }, { h: 'Date', f: x => fd(x.date) }, { h: 'Category', f: x => esc(x.category) }, { h: 'Description', f: x => esc(x.description) }, { h: 'Amount', f: x => `<b>${inr(x.amount)}</b>` }, { h: 'Status', f: x => badge(x.status) + (x.reimbursed_run ? ' <small class="muted">paid</small>' : '') },
      { h: '', f: x => x.status === 'pending' ? `<button class="btn sm ok" data-act="decideExp" data-id="${x.id}" data-v="approved">Approve</button> <button class="btn sm danger" data-act="decideExp" data-id="${x.id}" data-v="rejected">Reject</button>` : '' }], list, 'No claims.')}</div>`;
  }
  const all = await api('GET', '/api/expenses/all'), cat = S.expCat || '', src = S.expSrc || '';
  const rows = all.filter(x => (!cat || x.category === cat) && (!src || x.source === src));
  const total = rows.filter(x => x.source === 'Company' || x.status === 'approved').reduce((t, x) => t + x.amount, 0); S._expRows = rows;
  return head('All expenses', 'Company expenses and employee claims in one list', addBtn + ' <button class="btn" data-act="exportExp">Export CSV</button>') + tabs +
    `<div class="card"><div class="toolbar"><select id="expCat">${opts([...new Set([...EXP_CATS, ...all.map(x => x.category)])].map(c => [c, c]), cat, 'All categories')}</select>
    <select id="expSrc">${opts([['Company', 'Company expenses'], ['Employee claim', 'Employee claims']], src, 'All sources')}</select><span class="grow"></span><b>Total (approved): ${inr(total)}</b></div>
    ${table([{ h: 'Date', f: x => fd(x.date) }, { h: 'Source', f: x => x.source === 'Company' ? '<span class="badge approved">Company</span>' : '<span class="badge wfh">Employee claim</span>' }, { h: 'Category', f: x => esc(x.category) }, { h: 'Paid by / claimant', f: x => esc(x.emp_name || x.added_by || 'Company') },
      { h: 'Description', f: x => esc(x.description) }, { h: 'Amount', f: x => `<b>${inr(x.amount)}</b>` }, { h: 'Status', f: x => badge(x.status) }], rows, 'No expenses match.')}</div>`;
}
PAGES.expenses = async () => {
  if (isAdmin()) return adminExpenses();
  const items = [['mine', 'My claims']]; if (can('expenses') || can('team')) items.push(['approve', 'Approvals']);
  const tabs = tabsHtml('expenses', items), mine = S.tab.expenses === 'mine';
  const list = await api('GET', '/api/expenses' + (mine ? '' : '?scope=manage'));
  return head('Expenses & reimbursements', 'Approved claims are paid out with the next payroll', mine ? '<button class="btn primary" data-act="addExpense">+ New claim</button>' : '') + tabs +
    `<div class="card">${table([...(mine ? [] : [{ h: 'Employee', f: x => esc(x.emp_name) }]), { h: 'Date', f: x => fd(x.date) }, { h: 'Category', f: x => esc(x.category) }, { h: 'Description', f: x => esc(x.description) }, { h: 'Amount', f: x => `<b>${inr(x.amount)}</b>` },
      { h: 'Status', f: x => badge(x.status) + (x.reimbursed_run ? ' <small class="muted">paid</small>' : '') },
      ...(mine ? [] : [{ h: '', f: x => x.status === 'pending' && x.emp_id !== S.user.id ? `<button class="btn sm ok" data-act="decideExp" data-id="${x.id}" data-v="approved">Approve</button> <button class="btn sm danger" data-act="decideExp" data-id="${x.id}" data-v="rejected">Reject</button>` : '' }])], list, 'No claims.')}</div>`;
};

// ---- helpdesk ----
PAGES.helpdesk = async () => {
  const items = [['mine', 'My tickets']]; if (can('helpdesk')) items.push(['manage', 'All tickets']);
  const tabs = tabsHtml('helpdesk', items), mine = S.tab.helpdesk === 'mine';
  const list = await api('GET', '/api/tickets' + (mine ? '' : '?scope=manage'));
  return head('Employee helpdesk', 'Raise HR, payroll or IT queries', mine ? '<button class="btn primary" data-act="addTicket">+ Raise ticket</button>' : '') + tabs +
    `<div class="card">${table([...(mine ? [] : [{ h: 'Employee', f: t => esc(t.emp_name) }]), { h: '#', f: t => t.id }, { h: 'Subject', f: t => `<b>${esc(t.subject)}</b><br><small class="muted">${esc(t.description)}</small>` }, { h: 'Category', f: t => esc(t.category) }, { h: 'Raised', f: t => fd(t.created) }, { h: 'Status', f: t => badge(t.status) },
      { h: 'Response', f: t => esc(t.response) || '—' }, ...(mine ? [] : [{ h: '', f: t => `<button class="btn sm" data-act="respond" data-id="${t.id}">Respond</button>` }])], list, 'No tickets.')}</div>`;
};

// ---- assets ----
PAGES.assets = async () => {
  const list = await api('GET', '/api/assets');
  return head(can('assets') ? 'Asset management' : 'My assets', can('assets') ? 'Track company devices and who holds them' : '', can('assets') ? '<button class="btn primary" data-act="addAsset">+ Add asset</button>' : '') +
    `<div class="card">${table([{ h: 'Tag', f: a => esc(a.tag) }, { h: 'Asset', f: a => `<b>${esc(a.name)}</b>` }, { h: 'Category', f: a => esc(a.category) }, { h: 'Status', f: a => badge(a.status) }, { h: 'Assigned to', f: a => esc(a.assignee) || '—' }, { h: 'Since', f: a => fd(a.assigned_on) },
      ...(can('assets') ? [{ h: '', f: a => (a.assigned_to ? `<button class="btn sm" data-act="unassign" data-id="${a.id}">Return</button>` : `<button class="btn sm" data-act="assignAsset" data-id="${a.id}">Assign</button> <button class="btn sm" data-act="delAsset" data-id="${a.id}">✕</button>`) }] : [])], list, 'No assets.')}</div>`;
};

// ---- learning ----
PAGES.learning = async () => {
  const items = [['courses', 'Courses']]; if (can('learning')) items.push(['compliance', 'Compliance']);
  const tabs = tabsHtml('learning', items);
  if (S.tab.learning === 'compliance') { const r = await api('GET', '/api/courses/compliance'); return head('Mandatory training compliance', 'Employees with incomplete mandatory courses') + tabs + `<div class="card">${table([{ h: 'Employee', f: x => esc(x.name) }, { h: 'Course', f: x => esc(x.title) }, { h: 'Progress', f: x => x.progress + '%' }], r, 'Everyone is compliant 🎉')}</div>`; }
  const cs = await api('GET', '/api/courses');
  return head('Learning', 'Upskill with courses and mandatory training', can('learning') ? '<button class="btn primary" data-act="addCourse">+ Add course</button>' : '') + tabs +
    `<div class="grid g3">${cs.map(c => `<div class="card"><h2>${esc(c.title)} ${c.mandatory ? '<span class="badge pending">Mandatory</span>' : ''}</h2><p class="muted">${esc(c.description)}</p><small>⏱ ${esc(c.duration || '')} · ${c.learners} learners</small>
      <div style="margin:10px 0">${bar(c.progress)}<small>${c.progress ?? 0}% complete</small></div><button class="btn sm primary" data-act="courseProg" data-id="${c.id}" data-v="${c.progress ?? 0}">${c.progress == null ? 'Enroll' : c.progress >= 100 ? 'Completed ✓' : 'Update progress'}</button></div>`).join('')}</div>`;
};

// ---- announcements ----
PAGES.announcements = async () => {
  const list = await api('GET', '/api/announcements');
  return head('Announcements', 'Company-wide updates', can('announcements') ? '<button class="btn primary" data-act="addAnn">+ Post</button>' : '') +
    (list.map(a => `<div class="card"><div style="display:flex"><h2 class="grow">${esc(a.title)}</h2>${can('announcements') ? `<button class="btn sm" data-act="delAnn" data-id="${a.id}">Delete</button>` : ''}</div><div class="muted">${fd(a.created)} · ${esc(a.author)}</div><p>${esc(a.body)}</p></div>`).join('') || '<div class="card empty">Nothing posted.</div>');
};

// ---- settings (HR) ----
PAGES.settings = async () => {
  const [lk, hols, cfg] = await Promise.all([api('GET', '/api/lookups'), api('GET', '/api/holidays'), api('GET', '/api/settings/attendance')]);
  return head('Settings', 'Organisation configuration') + `<div class="grid g2"><div class="card"><div style="display:flex"><h2 class="grow">Departments</h2><button class="btn sm primary" data-act="addDept">+ Add</button></div>
    ${table([{ h: 'Name', f: d => esc(d.name) }, { h: '', f: d => `<button class="btn sm" data-act="delDept" data-id="${d.id}">Delete</button>` }], lk.departments)}</div>
    <div class="card"><div style="display:flex"><h2 class="grow">Leave policy</h2><button class="btn sm primary" data-act="addLT">+ Add type</button></div>
    ${table([{ h: 'Type', f: t => esc(t.name) }, { h: 'Days / year', f: t => t.days_per_year || 'Unlimited' }, { h: 'Paid', f: t => t.is_paid ? 'Yes' : 'No' }, { h: '', f: t => t.is_paid ? `<button class="btn sm" data-act="editLT" data-id="${t.id}" data-v="${t.days_per_year}">Edit</button>` : '' }], lk.leaveTypes)}</div></div>
    <div class="card"><div style="display:flex"><h2 class="grow">Attendance rules</h2><button class="btn sm primary" data-act="editAttRules">Edit</button></div><dl class="kv"><dt>Office hours</dt><dd>${cfg.office_start} – ${cfg.office_end} <small class="muted">(${cfg.office_hours} hours)</small></dd><dt>Absent if no punch-in by</dt><dd>${cfg.grace_end}</dd><dt>Half day / Full day</dt><dd>${cfg.half_day_hours}h = half day · ${cfg.full_day_hours}h = full day <small class="muted">(under ${cfg.half_day_hours}h = absent)</small></dd><dt>Late relaxation</dt><dd>${cfg.grace_minutes} min, ${cfg.allowance_days} days a month <small class="muted">(then half day)</small></dd><dt>Short days (${cfg.full_day_hours}–${cfg.office_hours}h)</dt><dd>${cfg.allowance_days} a month count as full <small class="muted">(then half day)</small></dd></dl></div>
    <div class="card"><div style="display:flex"><h2 class="grow">Holidays</h2><button class="btn sm primary" data-act="addHol">+ Add holiday</button></div>
    ${table([{ h: 'Date', f: h => fd(h.date) }, { h: 'Holiday', f: h => esc(h.name) }, { h: '', f: h => `<button class="btn sm" data-act="delHol" data-id="${h.id}">Delete</button>` }], hols)}</div>`;
};

// ---- profile ----
PAGES.profile = async () => `${head('My account', '')}<div class="grid g2"><div class="card"><h2>${esc(S.user.name)}</h2><p class="muted">${esc(S.user.email)} · ${esc(S.user.role)}</p><a class="btn" href="#/employee/${S.user.id}">View my profile</a></div>
  <div class="card"><h2>Change password</h2><form id="pwForm"><label>Current password<input type="password" name="current" required></label><label>New password (min 6)<input type="password" name="next" required minlength="6"></label><div class="err" id="pwErr"></div><button class="btn primary">Update password</button></form></div></div>`;

PAGES.location = async () => {
  const g = await api('GET', '/api/settings/location'), o = g.office, emps = S.lk.employees.filter(e => e.role !== 'admin' && g.exempt.includes(e.id));
  const map = o ? `<iframe title="Office map" style="width:100%;height:280px;border:0;border-radius:10px" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${o.lng - 0.004}%2C${o.lat - 0.0025}%2C${o.lng + 0.004}%2C${o.lat + 0.0025}&layer=mapnik&marker=${o.lat}%2C${o.lng}"></iframe>` : '';
  return `<p><a href="#/attendance">← Attendance</a></p>${head('Office location', o ? `Employees can punch in/out only within ${o.radius} m of this point` : 'Set where your office is — employees will only be able to punch from there', '<button class="btn primary" data-act="geoFencing">🛰️ Geo-fencing</button>')}
  <div class="grid g2"><div class="card"><h2>📍 Set office location</h2>
    <label>Office name / label<input id="locLabel" value="${esc(o?.label || '')}" placeholder="e.g. Head office, Mumbai"></label>
    <div class="formgrid"><label>Latitude<input id="locLat" type="number" step="any" value="${o?.lat ?? ''}" placeholder="19.0760"></label><label>Longitude<input id="locLng" type="number" step="any" value="${o?.lng ?? ''}" placeholder="72.8777"></label></div>
    <label>Allowed distance (metres)<input id="locRadius" type="number" min="20" max="1000" value="${o?.radius ?? 100}"></label>
    <div class="actions" style="justify-content:flex-start;flex-wrap:wrap"><button class="btn" data-act="useMyLocation">📡 Use my current location</button><button class="btn primary" data-act="saveLocation">Save office location</button>${o ? `<a class="btn" target="_blank" rel="noopener" href="${mapLink(o.lat, o.lng)}">Open in Maps</a><button class="btn danger" data-act="clearLocation">Turn off</button>` : ''}</div>
    <p class="muted" style="margin-bottom:0">Tip: stand at the office entrance, tap <b>Use my current location</b>, then save. Browsers only share location on <b>HTTPS</b> or <b>localhost</b> pages.</p></div>
  <div class="card"><h2>🛰️ Geo-fencing exemptions</h2><p class="muted">Selected employees can punch in/out from anywhere. Their punch location is still saved and shows in the Punch history with the date, marked <b>Away from office</b> when they aren't at the office.</p>
    ${emps.length ? emps.map(e => `<span class="badge approved" style="margin:2px">${esc(e.name)}</span>`).join(' ') : '<span class="muted">No one is exempt — everyone must punch at the office.</span>'}
    <div class="actions" style="justify-content:flex-start"><button class="btn" data-act="geoFencing">Select employees</button><a class="btn" href="#/attendance" data-act="goHistory">Punch history</a></div></div></div>
  ${o ? `<div class="card"><h2>Map</h2>${map}<small class="muted">Employees must be within ${o.radius} m of the marker.</small></div>` : ''}`;
};

PAGES.myprofile = async () => {
  const p = await api('GET', '/api/profile'), c = p.completion, F = p.fields;
  const optsOf = o => o.map(x => Array.isArray(x) ? x : [x, x]);
  const field = ([k, label, type = 'text', options]) => `<label class="${type === 'textarea' ? 'full' : ''}">${esc(label)}${type === 'select' ? `<select name="${k}"><option value="">—</option>${opts(optsOf(options), F[k])}</select>` : type === 'textarea' ? `<textarea name="${k}" rows="2">${esc(F[k] || '')}</textarea>` : `<input name="${k}" type="${type}" value="${esc(F[k] || '')}" ${type === 'number' ? 'min="0"' : ''}>`}</label>`;
  const slot = t => { const [label, kind, multi] = DOC_META[t], list = p.docs.filter(d => d.doc_type === t);
    return `<div class="docslot"><div class="docname"><b>${label}</b> ${list.length ? '<span class="badge present">uploaded</span>' : '<span class="badge pending">missing</span>'}</div>
      ${list.map(d => `<div class="docfile">📎 ${esc(d.filename)} <small class="muted">${fmtSize(d.size)} · ${fd(d.uploaded)}</small> <button class="btn sm" data-act="viewDoc" data-id="${d.id}" data-mime="${d.mime}" data-name="${esc(d.filename)}">View</button> <button class="btn sm" data-act="downloadDoc" data-id="${d.id}" data-name="${esc(d.filename)}">Download</button> <button class="btn sm danger" data-act="delDoc" data-id="${d.id}">✕</button></div>`).join('')}
      <label class="btn sm primary uploadbtn">${multi ? (list.length ? '+ Add another' : '+ Upload') : (list.length ? 'Replace' : 'Upload')}<input type="file" hidden data-doc="${t}" accept="${kind === 'image' ? 'image/*' : 'image/*,application/pdf'}"></label></div>`; };
  return head('Complete your profile', 'The details and documents your company keeps on file for every employee', '<button class="btn primary" data-act="saveProfile">Save details</button>') +
    `<div class="card"><div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><div style="min-width:120px"><div class="n" style="font-size:34px;font-weight:800">${c.pct}%</div><div class="muted">complete (${c.done}/${c.total})</div></div>
      <div class="grow" style="min-width:220px">${bar(c.pct)}${c.missing.length ? `<div style="margin-top:8px"><small class="muted">Still needed:</small> ${c.missing.map(m => `<span class="badge pending" style="margin:2px">${esc(m)}</span>`).join(' ')}</div>` : '<div style="margin-top:8px"><span class="badge present">Your profile is complete 🎉</span></div>'}</div></div>
      <p class="muted" style="margin:10px 0 0">Your documents are stored securely and are visible only to you and your company's admin. Photos are shrunk automatically; PDFs can be up to 3 MB each.</p></div>
    <form id="profileForm" onsubmit="return false">${PROFILE_SECTIONS.map(([title, fields]) => `<div class="card"><h2>${title}</h2><div class="formgrid">${fields.map(field).join('')}</div></div>`).join('')}</form>
    <div class="actions" style="margin-bottom:16px"><button class="btn primary" data-act="saveProfile">Save details</button></div>
    ${DOC_GROUPS.map(([title, types]) => `<div class="card"><h2>${title}</h2><div class="grid g2">${types.map(slot).join('')}</div></div>`).join('')}
    <div class="card"><h2>🔑 Password</h2><p class="muted">Change your password any time from your account page.</p><a class="btn" href="#/profile">Change password</a></div>`;
};
const PROFILE_ACTIONS = {
  saveProfile: async () => {
    const data = {}; for (const el of $('#profileForm').elements) if (el.name) data[el.name] = el.value;
    const r = await api('PUT', '/api/profile', data); toast(`Details saved — profile ${r.completion.pct}% complete`); route();
  },
  viewDoc: async (id, el) => {
    const url = await docUrl(+id), mime = el.dataset.mime, name = el.dataset.name || 'document';
    modal(`<h2>${esc(name)}</h2>${mime === 'application/pdf' ? `<iframe src="${url}" title="${esc(name)}" style="width:100%;height:68vh;border:1px solid var(--line);border-radius:8px"></iframe>` : `<div style="text-align:center"><img src="${url}" alt="${esc(name)}" style="max-width:100%;max-height:68vh;border-radius:8px"></div>`}
      <div class="actions"><button class="btn" data-act="downloadDoc" data-id="${id}" data-name="${esc(name)}">Download</button><button class="btn primary" data-act="closeModal">Close</button></div>`, true);
  },
  downloadDoc: async (id, el) => saveBlob(await docBlob(+id), el.dataset.name || 'document'),
  delDoc: id => confirmBox('Delete this file?', async () => { await api('DELETE', '/api/profile/documents/' + id); docUrls.delete(+id); await refreshMe(); }),
  profilePdf: async id => { toast('Preparing the PDF… this can take a few seconds'); const { bytes, filename } = await buildProfilePdf(+id); saveBlob(new Blob([bytes], { type: 'application/pdf' }), filename); toast('PDF downloaded'); },
  forgotPw: () => openForm({ title: 'Forgot your password?', intro: 'Enter your Employee ID. Your company admin will be notified and will give you a new password.', submit: 'Send request', fields: [{ name: 'identifier', label: 'Employee ID', required: true }, { name: 'note', label: 'Message to your admin (optional)', type: 'textarea' }],
    onSubmit: async v => { const r = await api('POST', '/api/forgot-password', v); setTimeout(() => toast(r.message), 100); } }),
  resetPwReq: id => { const r = S._reqs[id]; openForm({ title: 'Set a new password — ' + r.emp_name, intro: 'Tell the employee their new password; they can change it after signing in.', submit: 'Set password', fields: [{ name: 'password', label: 'New password (min 6 characters)', required: true }, PW],
    onSubmit: async v => { await api('POST', `/api/requests/${id}/reset-password`, v); toast('Password updated. Share it with the employee.'); } }); },
};

// ================= master panel =================
const MPAGES = {};
MPAGES.companies = async () => {
  const cs = await api('GET', '/api/master/companies'); S._cos = cs;
  const stat = (n, l) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  return head('Companies', 'Every company has its own isolated database, admin and employees', '<button class="btn" data-act="masterAddEmp">+ Add employee</button> <button class="btn primary" data-act="addCompany">+ New company</button>') +
    `<div class="grid g4" style="margin-bottom:16px">${stat(cs.length, 'Companies')}${stat(cs.filter(c => c.status === 'active').length, 'Active')}${stat(cs.filter(c => c.status !== 'active').length, 'Suspended')}${stat(cs.reduce((s, c) => s + c.employees, 0), 'Total employees')}</div>
    <div class="card">${table([{ h: 'Company', f: c => `<span style="display:flex;align-items:center;gap:8px">${c.logo_v ? logoImg(c, 'sm') : '<span class="clogo sm ph">🏢</span>'}<b>${esc(c.name)}</b></span>` }, { h: 'Admin login', f: c => esc(c.admin_email) }, { h: 'ID prefix', f: c => `<code>${esc(c.emp_prefix)}</code>` }, { h: 'Employees', f: c => c.employees }, { h: 'Admins', f: c => c.admins }, { h: 'Created', f: c => fd(c.created) }, { h: 'Status', f: c => badge(c.status === 'active' ? 'active' : 'rejected').replace('>rejected<', '>suspended<') },
      { h: '', f: c => `<button class="btn sm" data-act="resetAdmin" data-id="${c.id}">Reset admin password</button> <button class="btn sm primary" data-act="loginAs" data-id="${c.id}" ${c.status !== 'active' ? 'disabled' : ''}>Open portal</button> <button class="btn sm" data-act="changeLogo" data-id="${c.id}">Logo</button> <button class="btn sm" data-act="renameCo" data-id="${c.id}">Rename</button>
        <button class="btn sm" data-act="toggleCo" data-id="${c.id}">${c.status === 'active' ? 'Suspend' : 'Activate'}</button> <button class="btn sm danger" data-act="deleteCo" data-id="${c.id}">Delete</button>` }], cs, 'No companies yet. Create the first one.')}</div>
    <p class="muted">Each company has exactly one admin, created only here. The admin signs in at <code>/admin</code> with email + password; HR, managers and employees sign in at <code>/</code> with Employee ID + password.</p>`;
};
MPAGES.maccount = async () => `${head('Master account', S.user.email)}<div class="card" style="max-width:420px"><h2>Change password</h2><form id="pwForm"><label>Current password<input type="password" name="current" required></label><label>New password (min 6)<input type="password" name="next" required minlength="6"></label><div class="err" id="pwErr"></div><button class="btn primary">Update password</button></form></div>`;

const MASTER_ACTIONS = {
  masterAddEmp: () => {
    const cos = S._cos.filter(c => c.status === 'active'); if (!cos.length) return toast('Create a company first', true);
    openForm({ title: 'Add employee', wide: true, submit: 'Create employee', intro: 'Choose which admin this employee belongs to. Only that admin (and you) will be able to see and manage them.', fields: [
      { name: 'company_id', label: 'Belongs to admin / company', type: 'select', full: true, required: true, options: cos.map(c => [c.id, c.name + ' — admin: ' + c.admin_email]) },
      { name: 'name', label: 'Full name', required: true }, { name: 'email', label: 'Work email', type: 'email', required: true },
      { name: 'phone', label: 'Phone' }, { name: 'designation', label: 'Designation' }, { name: 'join_date', label: 'Joining date', type: 'date', value: today(), required: true },
      { name: 'ctc', label: 'Annual CTC (₹)', type: 'number', min: 0 }, { name: 'location', label: 'Work location' }, { name: 'password', label: 'Initial password (blank = welcome123)' },
      ...accessFields(), PW],
      onSubmit: async v => { const c = cos.find(x => x.id == v.company_id); const r = await api('POST', `/api/master/companies/${v.company_id}/employees`, v);
        setTimeout(() => modal(`<h2>Employee created ✅</h2><p>Added under <b>${esc(c.name)}</b> — only that company's admin can see them.</p><dl class="kv"><dt>Employee ID</dt><dd><b>${esc(r.emp_code)}</b></dd><dt>Password</dt><dd><b>${esc(r.password)}</b></dd></dl><p class="muted">They sign in at the employee login page (/).</p><div class="actions"><button class="btn primary" data-act="closeModal">Done</button></div>`), 50); } });
  },
  addCompany: () => openForm({ title: 'Create company', wide: true, intro: 'This creates a separate database for the company plus its first admin account.', submit: 'Create company', fields: [
    { name: 'name', label: 'Company name', required: true }, { name: 'code', label: 'Short code (lowercase, e.g. acme)', required: true }, { name: 'emp_prefix', label: 'Employee ID prefix (2-6 letters, e.g. ACME → ACME001)' },
    { name: 'admin_name', label: 'Admin name', required: true }, { name: 'admin_email', label: 'Admin login email (unique across all companies)', type: 'email', required: true },
    { name: 'admin_password', label: 'Admin password (min 6)', required: true }, { name: 'logo', label: 'Company logo (PNG / JPG, optional — shown in the header of the admin and employee portals)', type: 'file', full: true }, { name: 'sample_data', label: 'Fill with sample employees & data (for trying it out)', type: 'checkbox' }, PW],
    onSubmit: async v => { v.logo = await logoFromFile(v.logo); await api('POST', '/api/master/companies', v); toast(`Company created. The admin signs in at /admin with ${v.admin_email}`); } }),
  resetAdmin: async id => {
    const [ad] = await api('GET', `/api/master/companies/${id}/admins`);
    openForm({ title: 'Reset password for ' + ad.name, intro: esc(ad.email), fields: [{ name: 'password', label: 'New password (min 6)', required: true }, PW], onSubmit: async v => { await api('POST', `/api/master/companies/${id}/admins/${ad.id}/reset`, v); toast('Password reset'); } });
  },
  changeLogo: id => openForm({ title: 'Company logo', intro: 'Shown in the header of that company\'s admin and employee portals.', submit: 'Save logo', fields: [{ name: 'logo', label: 'New logo (PNG / JPG / WebP)', type: 'file', full: true }, { name: 'remove', label: 'Remove the current logo instead', type: 'checkbox', full: true }],
    onSubmit: async v => { const logo = v.remove ? null : await logoFromFile(v.logo); if (!v.remove && !logo) throw new Error('Choose an image first'); await api('POST', `/api/master/companies/${id}/logo`, { logo }); toast('Logo updated'); } }),
  renameCo: id => openForm({ title: 'Rename company', fields: [{ name: 'name', label: 'Name', required: true, value: S._cos.find(x => x.id == id).name }], onSubmit: v => api('POST', `/api/master/companies/${id}/rename`, v) }),
  toggleCo: id => { const c = S._cos.find(x => x.id == id), to = c.status === 'active' ? 'suspended' : 'active'; confirmBox(to === 'suspended' ? `Suspend ${c.name}? All their users are signed out and cannot log in.` : `Re-activate ${c.name}?`, () => api('POST', `/api/master/companies/${id}/status`, { status: to })); },
  deleteCo: id => { const c = S._cos.find(x => x.id == id); openForm({ title: 'Delete company permanently', intro: `This erases <b>all data</b> of ${esc(c.name)} and cannot be undone. Type <code>${esc(c.code)}</code> to confirm.`, submit: 'Delete forever', fields: [{ name: 'confirm', label: 'Company code', required: true }, PW], onSubmit: v => api('DELETE', `/api/master/companies/${id}`, v) }); },
  loginAs: async (id, el) => {
    const r = await api('POST', `/api/master/companies/${id}/impersonate`, el?.dataset.eid ? { emp_id: el.dataset.eid } : {});
    localStorage.setItem('hh_master_token', S.token); localStorage.setItem('hh_token', r.token);
    location.href = '/admin#/dashboard';
  },
};

// ================= nav / router =================
const NAV = [
  ['sec', 'Me'], ['dashboard', '🏠', 'Dashboard'], ['myprofile', '🪪', 'Complete profile'], ['attendance', '🕒', 'Attendance'], ['leave', '🌴', 'Leave'], ['payroll', '💰', 'Payroll'], ['performance', '🎯', 'Performance'], ['expenses', '🧾', 'Expenses'], ['learning', '🎓', 'Learning'],
  ['sec', 'Company'], ['employees', '👥', 'Employees'], ['announcements', '📢', 'Announcements'], ['helpdesk', '🛟', 'Helpdesk'], ['assets', '💻', 'Assets'],
  ['sec', 'Management', 'staff'], ['recruitment', '🧲', 'Recruitment', 'recruitment'], ['onboarding', '🚪', 'On/Offboarding', 'onboarding'], ['location', '📍', 'Office location', 'settings'], ['settings', '⚙️', 'Settings', 'settings'],
];
function buildNav() {
  // Portal title = the company's name (for that company's admin and employees); the master panel keeps the platform name.
  const co = S.user.company;
  document.title = co ? co.name + ' · HR Portal' : isMaster() ? 'HelloHR · Master panel' : 'HelloHR';
  $('#sidebar .brand').className = 'brand' + (co ? ' co' : '');
  $('#sidebar .brand').innerHTML = co ? logoImg(co, 'lg') + '<div class="cmeta"><div class="cname">' + esc(co.name) + '</div><small>HR Portal</small></div>' : 'Hello<span>HR</span><small>' + (isMaster() ? 'Master panel' : 'HR Portal') + '</small>';
  { let fav = document.querySelector('link[rel=icon]'); if (!fav) { fav = document.createElement('link'); fav.rel = 'icon'; document.head.appendChild(fav); } fav.href = co && co.logo_v ? `/api/logo/${encodeURIComponent(co.code)}?v=${co.logo_v}` : 'data:,'; }
  $('#banner').innerHTML = localStorage.getItem('hh_master_token') ? '<button class="btn sm danger" data-act="backToMaster">← Back to master panel</button>' : (S.user.company ? logoImg(S.user.company, 'sm') + '<b>' + esc(S.user.company.name) + '</b>' : '<b>Platform master panel</b>');
  if (isMaster()) { $('#nav').innerHTML = '<div class="sec">Platform</div><a href="#/companies" data-nav="companies">🏢 Companies</a><a href="#/maccount" data-nav="maccount">🔐 My account</a>'; $('#userbox').innerHTML = '<div style="text-align:right"><b>' + esc(S.user.name) + '</b><br><small class="muted">MASTER</small></div><button class="btn sm" data-act="logout">Sign out</button>'; return; }
  $('#nav').innerHTML = NAV.filter(n => !(isAdmin() && ['leave', 'learning', 'myprofile'].includes(n[0])) && !(n[0] === 'attendance' && !isAdmin()) && !(n[0] === 'employees' && !(isStaff() || can('team'))) && ((k) => !k || (k === 'staff' ? isStaff() : can(k)))(n[n[0] === 'sec' ? 2 : 3])).map(n => n[0] === 'sec' ? `<div class="sec">${n[1]}</div>` : `<a href="#/${n[0]}" data-nav="${n[0]}">${n[1]} ${n[2]}</a>`).join('');
  $('#userbox').innerHTML = `<div style="text-align:right"><b>${esc(S.user.name)}</b><br><small class="muted">${esc(S.user.role.toUpperCase())} · ${esc(S.user.emp_code)}</small></div><a href="#/profile" class="avatar" title="My account">${initials(S.user.name)}</a><button class="btn sm" data-act="logout">Sign out</button>`;
}
async function route() {
  if (!S.user) return;
  const [, page = isMaster() ? 'companies' : 'dashboard', arg] = location.hash.split('/');
  if (page === 'attendance' && !isAdmin() && !isMaster()) { location.hash = '#/dashboard'; return; }
  if (!isMaster() && ((page === 'employees' && !(isStaff() || can('team'))) || (page === 'employee' && +arg !== S.user.id && !(isStaff() || can('team'))))) { location.hash = '#/dashboard'; return; }
  const fn = (isMaster() ? MPAGES : PAGES)[page] || (isMaster() ? MPAGES.companies : PAGES.dashboard);
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === (page === 'employee' ? 'employees' : page)));
  $('#sidebar').classList.remove('open'); $('#backdrop').classList.remove('show');
  try { $('#main').innerHTML = await fn(arg); if (isAdmin()) document.querySelectorAll('#main .personal').forEach(n => n.remove()); if (!isStaff()) document.querySelectorAll('#main .staffonly').forEach(n => n.remove()); labelTables($('#main')); } catch (e) { $('#main').innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="err">${esc(e.message)}</p></div>`; }
  if (page === 'profile' || page === 'maccount') $('#pwForm')?.addEventListener('submit', async e => { e.preventDefault(); const f = e.target.elements; try { await api('POST', page === 'maccount' ? '/api/master/change-password' : '/api/change-password', { current: f.current.value, next: f.next.value }); toast('Password updated'); e.target.reset(); $('#pwErr').textContent = ''; } catch (er) { $('#pwErr').textContent = er.message; } });
}
function logoutLocal() { document.title = 'HelloHR - HR Management Portal';  localStorage.removeItem('hh_master_token'); S.user = null; S.token = null; localStorage.removeItem('hh_token'); $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }

// ================= actions =================
const A = {
  closeModal, go: id => { location.hash = '#/' + id; },
  tab: (id, el) => { S.tab[el.dataset.page] = id; route(); },
  logout: async () => { try { await api('POST', '/api/logout'); } catch {} localStorage.removeItem('hh_master_token'); logoutLocal(); },
  backToMaster: async () => { try { await api('POST', '/api/logout'); } catch {} localStorage.setItem('hh_token', localStorage.getItem('hh_master_token')); localStorage.removeItem('hh_master_token'); location.href = '/master#/companies'; },
  checkin: async mode => { await api('POST', '/api/attendance/checkin', { mode }); toast('Checked in'); route(); },
  checkout: async () => { await api('POST', '/api/attendance/checkout'); toast('Checked out'); route(); },
  addEmp: () => addEmployee(),
  exportEmps: () => csv('employees.csv', [['ID', 'Name', 'Email', 'Department', 'Designation', 'Manager', 'Joined', 'Status'], ...S._emps.map(e => [e.emp_code, e.name, e.email, e.dept, e.designation, e.manager, e.join_date, e.status])]),
  editEmp: async id => { const e = await api('GET', '/api/employees/' + id); openForm({ title: 'Edit ' + e.name, wide: true, fields: empFields(e), onSubmit: async v => { if (!v.password) delete v.password; await api('PUT', '/api/employees/' + id, v); S.lk = await api('GET', '/api/lookups'); toast('Saved'); } }); },
  editSelf: async id => { const e = await api('GET', '/api/employees/' + id); openForm({ title: 'Update my details', fields: [{ name: 'phone', label: 'Phone', value: e.phone }, { name: 'dob', label: 'Date of birth', type: 'date', value: e.dob }, { name: 'bank_account', label: 'Bank account', value: e.bank_account }, { name: 'address', label: 'Address', type: 'textarea', value: e.address }], onSubmit: v => api('PUT', '/api/employees/' + id, v) }); },
  offboard: id => openForm({ title: 'Start offboarding', intro: 'This creates an exit checklist. Access stays active until you complete the exit.', fields: [{ name: 'exit_date', label: 'Last working day', type: 'date', required: true, value: today() }, { name: 'reason', label: 'Reason', type: 'textarea' }], submit: 'Start offboarding', onSubmit: v => api('POST', `/api/employees/${id}/offboard`, v) }),
  cancelExit: id => confirmBox('Cancel the exit and mark this employee active again?', () => api('POST', `/api/employees/${id}/cancel-exit`)),
  completeExit: id => openForm({ title: 'Complete exit & delete access', intro: 'Their login is disabled and assets are released. This cannot be undone.', submit: 'Complete exit', fields: [PW], onSubmit: v => api('POST', `/api/employees/${id}/exit`, v) }),
  addTask: (id, el) => openForm({ title: 'Add task', fields: [{ name: 'title', label: 'Task', required: true }], onSubmit: v => api('POST', '/api/checklists', { emp_id: id, kind: el.dataset.kind, title: v.title }) }),
  applyLeave: () => openForm({ title: 'Apply for leave / work from home', intro: 'Pick Casual Leave (CL), Privilege Leave (PL), Sick Leave or Work From Home. Your manager will approve it.', fields: [{ name: 'type_id', label: 'Type', type: 'select', options: [...S.lk.leaveTypes].sort((x, y) => (x.kind === 'wfh') - (y.kind === 'wfh') || x.id - y.id).map(t => [t.id, t.name]), required: true },
    { name: 'from_date', label: 'From', type: 'date', required: true, value: today() }, { name: 'to_date', label: 'To', type: 'date', required: true, value: today() }, { name: 'half_day', label: 'Half day (single date only)', type: 'checkbox', full: true }, { name: 'reason', label: 'Reason', type: 'textarea', required: true }],
    submit: 'Submit request', onSubmit: async v => { const r = await api('POST', '/api/leaves', v); toast(`Request sent for ${r.days} day(s)`); } }),
  cancelLeave: id => confirmBox('Cancel this leave request?', () => api('POST', `/api/leaves/${id}/cancel`)),
  decideLeave: (id, el) => openForm({ title: el.dataset.v === 'approved' ? 'Approve leave' : 'Reject leave', fields: [{ name: 'note', label: 'Note (optional)', type: 'textarea' }], submit: 'Confirm', onSubmit: v => api('POST', `/api/leaves/${id}/decide`, { status: el.dataset.v, note: v.note }) }),
  runPayroll: () => openForm({ title: 'Run payroll', intro: 'Creates (or recalculates) a draft for the month using attendance and approved leave. Review it, then finalize to publish payslips.', fields: [{ name: 'month', label: 'Month', type: 'month', value: S.payMonth || ym(new Date()), required: true }], submit: 'Calculate', onSubmit: async v => { const r = await api('POST', '/api/payroll/runs', v); setTimeout(() => A.viewRun(r.id), 100); } }),
  viewRun: async id => {
    const { run, slips } = await api('GET', '/api/payroll/runs/' + id); S._slips = slips; S._run = run;
    modal(`<h2>Payroll — ${monthName(run.month)} ${badge(run.status)}</h2>${table([{ h: 'Employee', f: p => `<b>${esc(p.name)}</b><br><small class="muted">${esc(p.emp_code)}</small>` }, { h: 'Paid days', f: p => `${p.paid_days}/${p.working_days}` }, { h: 'Gross', f: p => inr(p.gross) }, { h: 'PF', f: p => inr(p.pf) }, { h: 'PT', f: p => inr(p.pt) }, { h: 'TDS', f: p => inr(p.tds) }, { h: 'Reimb.', f: p => inr(p.reimbursements) }, { h: 'Net', f: p => `<b>${inr(p.net)}</b>` }, { h: '', f: p => `<button class="btn sm" data-act="viewSlip" data-id="${p.id}">Slip</button>` }], slips)}
      <p><b>Total net payout: ${inr(slips.reduce((s, p) => s + p.net, 0))}</b></p><div class="actions"><button class="btn" data-act="exportRun">Export CSV</button>
      ${run.status === 'draft' ? `<button class="btn danger" data-act="delRun" data-id="${id}">Delete draft</button><button class="btn ok" data-act="finalizeRun" data-id="${id}">Finalize & publish</button>` : ''}<button class="btn" data-act="closeModal">Close</button></div>`, true);
  },
  exportPayOv: () => csv(`payroll-overview-${S._payOv.month}.csv`, [['ID', 'Name', 'CTC', 'Working days', 'Paid days', 'Gross', 'PF', 'PT', 'TDS', 'Reimbursements', 'Net'], ...S._slips.map(p => [p.emp_code, p.name, p.ctc, p.working_days, p.paid_days, p.gross, p.pf, p.pt, p.tds, p.reimbursements, p.net])]),
  perfDetail: id => { S.perfEmp = id; S.tab.performance = 'team'; route(); },
  addCompanyExpense: () => openForm({ title: 'Add company expense', intro: 'Rent, equipment, subscriptions, travel — anything the company paid for.', fields: [{ name: 'category', label: 'Category', type: 'select', options: EXP_CATS.map(c => [c, c]), required: true }, { name: 'amount', label: 'Amount (₹)', type: 'number', min: 1, step: '0.01', required: true }, { name: 'date', label: 'Date', type: 'date', value: today(), required: true }, { name: 'description', label: 'Description / vendor', type: 'textarea' }], onSubmit: v => api('POST', '/api/expenses/company', v) }),
  exportExp: () => csv('expenses.csv', [['Date', 'Source', 'Category', 'Who', 'Description', 'Amount', 'Status'], ...S._expRows.map(x => [x.date, x.source, x.category, x.emp_name || x.added_by || 'Company', x.description, x.amount, x.status])]),

  punch: async () => {
    if (S._punching) return; S._punching = true;
    const btn = document.querySelector('[data-act=punch]'), label = btn?.textContent;
    try {
      const wasOpen = S.punchOpen, g = S.punchGeo || {}, mode = wasOpen ? S.punchMode : ($('#punchMode')?.value || 'office');
      const required = g.enforced && !g.exempt && mode !== 'wfh', optional = g.enforced && !required;
      let pos = {};
      if (required || optional) {
        if (btn) { btn.disabled = true; btn.textContent = '📍 Checking your location…'; }
        try { pos = await getPosition(required ? 20000 : 8000); } catch (e) { if (required) throw e; }
      }
      const p = await api('POST', wasOpen ? '/api/attendance/checkout' : '/api/attendance/checkin', { ...(wasOpen ? {} : { mode }), ...pos });
      const where = p.checked?.dist != null ? ` · ${fmtDist(p.checked.dist)} from office${p.checked.away ? ' (away)' : ''}` : '';
      toast((wasOpen ? `Punched out — worked ${hms(p.worked_secs)} · ${DAY_LABEL[p.status] || p.status}` : 'Punched in. Have a productive day!') + where);
      await route();
    } finally { S._punching = false; if (btn) { btn.disabled = false; if (label) btn.textContent = label; } }
  },
  goHistory: () => { S.tab.attendance = 'history'; location.hash = '#/attendance'; route(); },
  useMyLocation: async () => { const p = await getPosition(20000); $('#locLat').value = p.lat.toFixed(6); $('#locLng').value = p.lng.toFixed(6); toast(`Location captured (±${Math.round(p.accuracy)} m). Press Save to apply.`); },
  saveLocation: async () => { await api('PUT', '/api/settings/location', { label: $('#locLabel').value, lat: $('#locLat').value, lng: $('#locLng').value, radius: $('#locRadius').value }); toast('Office location saved'); route(); },
  clearLocation: () => confirmBox('Turn off the location check? Employees will be able to punch from anywhere.', () => api('PUT', '/api/settings/location', { lat: '' })),
  geoFencing: async () => {
    const g = await api('GET', '/api/settings/location');
    openForm({ title: 'Geo-fencing', submit: 'Save', intro: 'Tick the employees who may punch in/out from <b>anywhere</b>. Everyone else must be at the office. Their punch location is saved with the date in the Punch history.',
      fields: [{ name: 'emp_ids', label: 'Allowed to punch from anywhere:', type: 'checks', value: g.exempt.map(String), options: S.lk.employees.filter(e => e.role !== 'admin').map(e => [String(e.id), `${e.name} (${e.emp_code})`, e.designation || '']) }],
      onSubmit: async v => { await api('PUT', '/api/settings/geofence', { emp_ids: v.emp_ids }); toast('Geo-fencing list updated'); } });
  },
  editAttRules: async () => { const c = await api('GET', '/api/settings/attendance'); openForm({ title: 'Attendance rules', intro: 'Working hours are counted from punch-in to punch-out.', fields: [
    { name: 'office_start', label: 'Office start', type: 'time', value: c.office_start, required: true }, { name: 'office_end', label: 'Office end', type: 'time', value: c.office_end, required: true },
    { name: 'grace_minutes', label: 'Late relaxation (minutes after start)', type: 'number', min: 0, max: 180, value: c.grace_minutes, required: true },
    { name: 'allowance_days', label: 'Relaxation / short days allowed per month', type: 'number', min: 0, max: 31, value: c.allowance_days, required: true },
    { name: 'half_day_hours', label: 'Hours for a half day', type: 'number', step: '0.25', min: 0.25, value: c.half_day_hours, required: true },
    { name: 'full_day_hours', label: 'Hours for a full day (short-day minimum)', type: 'number', step: '0.25', min: 0.25, value: c.full_day_hours, required: true }], onSubmit: v => api('PUT', '/api/settings/attendance', v) }); },
  attFilter: id => { S.attFilter = id; route(); },
  exportRun: () => csv(`payroll-${S._run.month}.csv`, [['ID', 'Name', 'Working days', 'Paid days', 'Gross', 'PF', 'PT', 'TDS', 'Reimbursements', 'Net'], ...S._slips.map(p => [p.emp_code, p.name, p.working_days, p.paid_days, p.gross, p.pf, p.pt, p.tds, p.reimbursements, p.net])]),
  finalizeRun: id => confirmBox('Finalize payroll? Payslips become visible to employees and the run is locked.', () => api('POST', `/api/payroll/runs/${id}/finalize`)),
  delRun: id => confirmBox('Delete this draft payroll run?', () => api('DELETE', `/api/payroll/runs/${id}`)),
  viewSlip: id => {
    const p = S._slips.find(x => x.id == id); const full = { dept: '', pan: '', bank_account: '', ...p };
    modal(`${slipHtml(full)}<div class="actions"><button class="btn" data-act="printSlip" data-id="${id}">Print / PDF</button><button class="btn" data-act="closeModal">Close</button></div>`, true);
  },
  printSlip: id => printSlip(slipHtml(S._slips.find(x => x.id == id))),
  addJob: () => openForm({ title: 'New job opening', fields: [{ name: 'title', label: 'Job title', required: true }, { name: 'dept_id', label: 'Department', type: 'select', options: S.lk.departments.map(d => [d.id, d.name]), blank: '—' }, { name: 'openings', label: 'Openings', type: 'number', value: 1, min: 1 }, { name: 'location', label: 'Location' }, { name: 'description', label: 'Description', type: 'textarea' }], onSubmit: v => api('POST', '/api/jobs', v) }),
  toggleJob: async (id, el) => { await api('PUT', '/api/jobs/' + id, { status: el.dataset.v }); route(); },
  addCand: () => openForm({ title: 'Add candidate', fields: [{ name: 'job_id', label: 'Job', type: 'select', options: S._jobs.filter(j => j.status === 'open').map(j => [j.id, j.title]), required: true }, { name: 'name', label: 'Name', required: true }, { name: 'email', label: 'Email', type: 'email', required: true }, { name: 'phone', label: 'Phone' }, { name: 'expected_ctc', label: 'Expected CTC (₹)', type: 'number' }, { name: 'notes', label: 'Notes', type: 'textarea' }], onSubmit: v => api('POST', '/api/candidates', v) }),
  hire: id => { const c = S._cands.find(x => x.id == id); const j = S._jobs.find(x => x.id === c.job_id); addEmployee({ name: c.name, email: c.email, phone: c.phone, ctc: c.expected_ctc, designation: j?.title, dept_id: j?.dept_id }, async () => { await api('POST', `/api/candidates/${id}/stage`, { stage: 'Hired' }); }); },
  addGoal: (id) => openForm({ title: 'New goal', fields: [{ name: 'title', label: 'Goal / objective', required: true }, { name: 'description', label: 'Key results', type: 'textarea' }, { name: 'due', label: 'Due date', type: 'date' }], onSubmit: v => api('POST', '/api/goals', { ...v, emp_id: id || undefined }) }),
  updGoal: (id, el) => openForm({ title: 'Update progress', fields: [{ name: 'progress', label: 'Progress (%)', type: 'number', min: 0, max: 100, value: el.dataset.v }], onSubmit: v => api('PUT', '/api/goals/' + id, v) }),
  delGoal: id => confirmBox('Delete this goal?', () => api('DELETE', '/api/goals/' + id)),
  addReview: id => openForm({ title: 'Write performance review', fields: [{ name: 'cycle', label: 'Review cycle', value: `H${new Date().getMonth() < 6 ? 1 : 2} ${new Date().getFullYear()}`, required: true }, { name: 'rating', label: 'Rating (1-5)', type: 'number', min: 1, max: 5, required: true }, { name: 'comments', label: 'Feedback', type: 'textarea' }], onSubmit: v => api('POST', '/api/reviews', { ...v, emp_id: id }) }),
  addExpense: () => openForm({ title: 'New expense claim', fields: [{ name: 'category', label: 'Category', type: 'select', options: EXP_CATS.map(x => [x, x]), required: true }, { name: 'amount', label: 'Amount (₹)', type: 'number', min: 1, step: '0.01', required: true }, { name: 'date', label: 'Expense date', type: 'date', value: today(), required: true }, { name: 'description', label: 'Description', type: 'textarea' }], onSubmit: v => api('POST', '/api/expenses', v) }),
  decideExp: (id, el) => confirmBox(`${el.dataset.v === 'approved' ? 'Approve' : 'Reject'} this claim?`, () => api('POST', `/api/expenses/${id}/decide`, { status: el.dataset.v })),
  addTicket: () => openForm({ title: 'Raise a ticket', fields: [{ name: 'category', label: 'Category', type: 'select', options: ['HR', 'Payroll', 'IT', 'Admin', 'Other'].map(x => [x, x]), required: true }, { name: 'subject', label: 'Subject', required: true }, { name: 'description', label: 'Details', type: 'textarea', required: true }], onSubmit: v => api('POST', '/api/tickets', v) }),
  respond: id => openForm({ title: 'Respond to ticket', fields: [{ name: 'response', label: 'Response', type: 'textarea' }, { name: 'status', label: 'Status', type: 'select', options: [['open', 'Open'], ['in_progress', 'In progress'], ['closed', 'Closed']], value: 'in_progress' }], onSubmit: v => api('POST', `/api/tickets/${id}/respond`, v) }),
  addAsset: () => openForm({ title: 'Add asset', fields: [{ name: 'name', label: 'Name', required: true }, { name: 'tag', label: 'Asset tag', required: true }, { name: 'category', label: 'Category' }], onSubmit: v => api('POST', '/api/assets', v) }),
  assignAsset: id => openForm({ title: 'Assign asset', fields: [{ name: 'emp_id', label: 'Employee', type: 'select', options: S.lk.employees.map(e => [e.id, e.name]), required: true }], onSubmit: v => api('POST', `/api/assets/${id}/assign`, v) }),
  unassign: async id => { await api('POST', `/api/assets/${id}/assign`, {}); toast('Asset returned'); route(); },
  delAsset: id => confirmBox('Delete this asset?', () => api('DELETE', '/api/assets/' + id)),
  addCourse: () => openForm({ title: 'Add course', fields: [{ name: 'title', label: 'Title', required: true }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'duration', label: 'Duration' }, { name: 'mandatory', label: 'Mandatory for all employees', type: 'checkbox' }], onSubmit: v => api('POST', '/api/courses', v) }),
  courseProg: (id, el) => openForm({ title: 'Course progress', fields: [{ name: 'progress', label: 'Completion (%)', type: 'number', min: 0, max: 100, value: el.dataset.v }], onSubmit: v => api('POST', `/api/courses/${id}/progress`, v) }),
  addAnn: () => openForm({ title: 'Post announcement', fields: [{ name: 'title', label: 'Title', required: true }, { name: 'body', label: 'Message', type: 'textarea', required: true }], submit: 'Post', onSubmit: v => api('POST', '/api/announcements', v) }),
  delAnn: id => confirmBox('Delete announcement?', () => api('DELETE', '/api/announcements/' + id)),
  addDept: () => openForm({ title: 'Add department', fields: [{ name: 'name', label: 'Name', required: true }], onSubmit: async v => { await api('POST', '/api/departments', v); S.lk = await api('GET', '/api/lookups'); } }),
  delDept: id => confirmBox('Delete this department?', async () => { await api('DELETE', '/api/departments/' + id); S.lk = await api('GET', '/api/lookups'); }),
  addLT: () => openForm({ title: 'Add leave type', fields: [{ name: 'name', label: 'Name', required: true }, { name: 'days_per_year', label: 'Days per year (0 = unlimited)', type: 'number', value: 0, min: 0 }, { name: 'is_paid', label: 'Paid leave', type: 'checkbox', value: true }], onSubmit: async v => { await api('POST', '/api/leave-types', v); S.lk = await api('GET', '/api/lookups'); } }),
  editLT: (id, el) => openForm({ title: 'Edit allowance', fields: [{ name: 'days_per_year', label: 'Days per year', type: 'number', min: 0, value: el.dataset.v }], onSubmit: async v => { await api('PUT', '/api/leave-types/' + id, v); S.lk = await api('GET', '/api/lookups'); } }),
  addHol: () => openForm({ title: 'Add holiday', fields: [{ name: 'date', label: 'Date', type: 'date', required: true }, { name: 'name', label: 'Name', required: true }], onSubmit: v => api('POST', '/api/holidays', v) }),
  delHol: id => confirmBox('Delete this holiday?', () => api('DELETE', '/api/holidays/' + id)),
  exportRep: () => csv(`attendance-${S.repMonth || ym(new Date())}.csv`, [['ID', 'Name', 'Present', 'WFH', 'Half days', 'Absent', 'Hours worked'], ...S._rep.map(r => [r.emp_code, r.name, r.present, r.wfh, r.half, r.absent, r.hours])]),
};

Object.assign(A, MASTER_ACTIONS);
Object.assign(A, PROFILE_ACTIONS);
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = A[el.dataset.act]; if (!fn) return; e.preventDefault();
  guard(fn)(el.dataset.id, el);
});
document.addEventListener('change', guard(async e => {
  const t = e.target;
  if (t.dataset.doc) {
    const f = t.files[0]; if (!f) return;
    try { toast('Uploading…'); const u = await prepareUpload(f, t.dataset.doc); await api('POST', '/api/profile/documents', { doc_type: t.dataset.doc, ...u }); toast('Uploaded ✓'); if (t.dataset.doc === 'profile_photo') await refreshMe(); route(); } finally { t.value = ''; }
    return;
  }
  if (t.id === 'attMonth') { S.attMonth = t.value; route(); }
  else if (t.id === 'attDate') { S.attDate = t.value; route(); }
  else if (t.id === 'repMonth') { S.repMonth = t.value; route(); }
  else if (t.id === 'histFrom') { S.histFrom = t.value; route(); }
  else if (t.id === 'histTo') { S.histTo = t.value; route(); }
  else if (t.id === 'histEmp') { S.histEmp = t.value; route(); }
  else if (t.id === 'histAway') { S.histAway = t.value; route(); }
  else if (t.id === 'payMonth') { S.payMonth = t.value; route(); }
  else if (t.id === 'perfDays') { S.perfDays = t.value; route(); }
  else if (t.id === 'expCat') { S.expCat = t.value; route(); }
  else if (t.id === 'expSrc') { S.expSrc = t.value; route(); }
  else if (t.id === 'perfEmp') { S.perfEmp = t.value; route(); }
  else if (t.id === 'ed') { (S.empQ ||= {}).d = t.value; route(); }
  else if (t.id === 'est') { (S.empQ ||= {}).st = t.value; route(); }
  else if (t.dataset.mark) { await api('POST', '/api/attendance/mark', { emp_id: t.dataset.mark, date: t.dataset.date, status: t.value }); toast('Attendance updated'); route(); }
  else if (t.dataset.stage) { await api('POST', `/api/candidates/${t.dataset.stage}/stage`, { stage: t.value }); route(); }
  else if (t.dataset.chk) { await api('POST', `/api/checklists/${t.dataset.chk}/toggle`); route(); }
}));
document.addEventListener('input', e => { if (e.target.id === 'eq') { (S.empQ ||= {}).s = e.target.value; clearTimeout(S._qt); S._qt = setTimeout(async () => { const pos = e.target.selectionStart; await route(); const n = $('#eq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 250); } });
window.addEventListener('hashchange', route);
$('#menuBtn').addEventListener('click', () => { $('#sidebar').classList.toggle('open'); $('#backdrop').classList.toggle('show', $('#sidebar').classList.contains('open')); });
$('#backdrop').addEventListener('click', () => { $('#sidebar').classList.remove('open'); $('#backdrop').classList.remove('show'); });
const LOGIN = {
  master: { t: 'Master panel', s: 'Platform owner sign-in', l: 'Email', type: 'email', demo: [['Master', 'master@hellohr.com', 'master123']] },
  admin: { t: 'Company admin', s: 'Admin sign-in', l: 'Admin email', type: 'email', demo: [['Demo admin', 'admin@hellohr.com', 'admin123']] },
  employee: { t: 'Employee portal', s: 'HR, managers and employees sign in with their Employee ID', l: 'Employee ID', type: 'text', demo: [['HR', 'HH002', 'welcome123'], ['Manager', 'HH003', 'welcome123'], ['Employee', 'HH005', 'welcome123']] },
}[PORTAL];
$('#loginTitle').textContent = LOGIN.t; $('#loginSub').textContent = LOGIN.s; $('#idLabel').textContent = LOGIN.l; $('#loginForm').elements.identifier.type = LOGIN.type;
if (PORTAL === 'employee') $('#loginForm').elements.identifier.placeholder = 'e.g. HH005';
if (PORTAL === 'employee') $('#demoBox').insertAdjacentHTML('beforebegin', '<div class="center" style="margin-top:6px"><a href="#" data-act="forgotPw">Forgot password?</a></div>');
$('#demoBox').innerHTML = '<b>Demo</b> (click to fill): ' + LOGIN.demo.map(d => `<a href="#" data-demo="${d[1]}|${d[2]}">${d[0]}</a>`).join(' · ');
document.querySelectorAll('[data-demo]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); const [id, pw] = a.dataset.demo.split('|'); const f = $('#loginForm').elements; f.identifier.value = id; f.password.value = pw; }));

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target.elements;
  try { const r = await api('POST', '/api/login', { portal: PORTAL, identifier: f.identifier.value, password: f.password.value }); S.token = r.token; localStorage.setItem('hh_token', r.token); await start(); }
  catch (err) { $('#loginErr').textContent = err.message; }
});
async function start() {
  try {
    S.user = await api('GET', '/api/me');
    if (portalOf(S.user) !== PORTAL) { logoutLocal(); return; }
    S.lk = isMaster() ? null : await api('GET', '/api/lookups');
    $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); buildNav(); loadAvatar();
    const onMasterPage = ['#/companies', '#/maccount'].includes(location.hash);
    if (!location.hash || isMaster() !== onMasterPage) location.hash = isMaster() ? '#/companies' : '#/dashboard';
    route();
  } catch { logoutLocal(); }
}
if (S.token) start(); else $('#login').classList.remove('hidden');

// ---- live updates: re-render live pages every few seconds so punch-ins/outs appear without reloading ----
setInterval(async () => {
  if (!S.user || S._live || document.hidden || $('#modalRoot').innerHTML) return;
  const page = location.hash.split('/')[1] || (isMaster() ? 'companies' : 'dashboard'), ae = document.activeElement;
  if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName) && $('#main').contains(ae)) return;
  const live = (page === 'attendance' && S.tab.attendance !== 'report') || (page === 'employees' && S.tab.employees !== 'org') || page === 'dashboard';
  if (!live) return;
  S._live = true; const y = window.scrollY;
  try { await route(); window.scrollTo(0, y); } finally { S._live = false; }
}, 8000);

// ---- live punch timer ----
setInterval(() => {
  const el = $('#punchTimer'); if (!el || S.punchBase === undefined) return;
  const secs = Math.floor(S.punchBase + (S.punchOpen ? (Date.now() - S.punchAt) / 1000 : 0));
  el.textContent = hms(secs); const bar = $('#punchBar'); if (bar) bar.style.width = Math.min(100, secs / S.punchTotal * 100) + '%';
}, 1000);
