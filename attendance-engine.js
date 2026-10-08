// Pure attendance rules (no database access) so they can be unit-tested.
//
// Policy implemented:
//  - Working hours = time between punch-in and punch-out (several sessions in a day are added up).
//  - Under "half day" hours (default 4h)            -> Absent for the day (not enough hours).
//  - 4h up to under "full day" hours (default 8h)   -> Half day.
//  - 8h up to under the 9h office day               -> Full day, but only for the first 3 such "short" days in a month; the 4th onward is a Half day.
//  - 9h or more                                     -> Full day.
//  - Arriving up to 30 min after office start       -> allowed for the first 3 days in a month; the 4th onward is a Half day.
//  - Arriving more than 30 min after office start   -> Half day.
//  - Still punched in 60 min after office end (or on a past day) with no punch-out -> Half day ("No punch-out").
const toMin = t => { const p = String(t).split(':').map(Number); return p[0] * 60 + (p[1] || 0); };
const toSec = t => { const p = String(t).split(':').map(Number); return p[0] * 3600 + (p[1] || 0) * 60 + (p[2] || 0); };
const fmtMin = n => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
const fmtHM = m => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`;

function normCfg(r = {}) {
  const num = (v, d) => (v !== undefined && v !== null && v !== '' && !isNaN(+v)) ? +v : d;
  const c = {
    office_start: r.office_start || '09:30', office_end: r.office_end || '18:30',
    grace_minutes: num(r.grace_minutes, 30), half_day_hours: num(r.half_day_hours, 4), full_day_hours: num(r.full_day_hours, 8), allowance_days: num(r.allowance_days, 3),
  };
  c.grace_end = fmtMin(toMin(c.office_start) + c.grace_minutes);
  c.office_hours = (toMin(c.office_end) - toMin(c.office_start)) / 60;
  return c;
}

const isOpen = (rec, sessions) => sessions.length ? sessions.some(s => !s.out_time) : !!(rec && rec.check_in && !rec.check_out);

// seconds worked on a day. An unclosed session counts up to "now" only on today; on a past day it counts as zero (forgot to punch out).
function workedSecs(rec, sessions, date, nowS, todayS) {
  const nowSecs = toSec(nowS);
  if (sessions.length) return sessions.reduce((t, s) => t + Math.max(0, (s.out_time ? toSec(s.out_time) : date === todayS ? nowSecs : toSec(s.in_time)) - toSec(s.in_time)), 0);
  if (!rec || !rec.check_in) return 0;
  if (rec.check_out) return Math.max(0, toSec(rec.check_out) - toSec(rec.check_in));
  return date === todayS ? Math.max(0, nowSecs - toSec(rec.check_in)) : 0;
}

// ctx = how many "late relaxation" / "short day" allowances were already used earlier in the same month.
function derive(rec, date, cfg, ctx = { late_used: 0, short_used: 0 }, sessions = [], nowS = '00:00:00', todayS = '') {
  const nowT = nowS.slice(0, 5);
  if (rec && rec.manual) return { status: rec.status === 'present' ? 'office' : rec.status, reason: 'Set by admin', late: false, minutes: Math.floor(workedSecs(rec, sessions, date, nowS, todayS) / 60) };
  if (!rec) {
    if (date > todayS) return { status: 'pending', minutes: 0 };
    if (date === todayS && nowT < cfg.grace_end) return { status: 'pending', reason: 'Office starts ' + cfg.office_start, minutes: 0 };
    return { status: 'absent', reason: 'No punch-in', minutes: 0 };
  }
  const mode = rec.mode === 'wfh' ? 'wfh' : 'office';
  const secs = workedSecs(rec, sessions, date, nowS, todayS), minutes = Math.floor(secs / 60), open = isOpen(rec, sessions);
  const lateBy = rec.check_in ? Math.max(0, toMin(rec.check_in) - toMin(cfg.office_start)) : 0;
  const base = { minutes, late: lateBy > 0, late_by: lateBy, open };
  if (open) {
    if (date < todayS || (date === todayS && toMin(nowT) >= toMin(cfg.office_end) + 60)) return { ...base, status: 'half', reason: 'No punch-out' };
    return { ...base, status: mode, in_progress: true, reason: null };
  }
  const A = cfg.allowance_days, officeMin = Math.round(cfg.office_hours * 60), halfMin = cfg.half_day_hours * 60, fullMin = cfg.full_day_hours * 60;
  if (minutes < halfMin) return { ...base, status: 'absent', reason: `Only ${fmtHM(minutes)} worked (needs ${cfg.half_day_hours}h for a half day)` };
  let halfBy = null;
  if (lateBy > cfg.grace_minutes) halfBy = `Arrived ${lateBy} min late (more than the ${cfg.grace_minutes} min relaxation)`;
  else if (lateBy > 0 && ctx.late_used >= A) halfBy = `Late arrival — the ${A} relaxation days this month are used up`;
  const shortDay = minutes >= fullMin && minutes < officeMin;
  if (!halfBy) {
    if (minutes < fullMin) halfBy = `Worked ${fmtHM(minutes)} — under ${cfg.full_day_hours}h`;
    else if (shortDay && ctx.short_used >= A) halfBy = `Worked ${fmtHM(minutes)} — under ${cfg.office_hours}h and the ${A} short days this month are used up`;
  }
  if (halfBy) return { ...base, status: 'half', reason: halfBy };
  const pieces = [];
  if (lateBy > 0) pieces.push(`Late ${lateBy} min (relaxation ${ctx.late_used + 1}/${A})`);
  if (shortDay) pieces.push(`Short day ${fmtHM(minutes)} (allowance ${ctx.short_used + 1}/${A})`);
  return { ...base, status: mode, reason: pieces.join(' · ') || null, consumed: { late: lateBy > 0, short: shortDay } };
}

// Walks a month's records in date order so the monthly allowances are consumed chronologically.
function monthWalk(recs, punchesByDate, cfg, nowS, todayS) {
  const ctx = { late_used: 0, short_used: 0 }, days = {}, before = {};
  for (const rec of [...recs].sort((a, b) => a.date < b.date ? -1 : 1)) {
    before[rec.date] = { ...ctx };
    const d = derive(rec, rec.date, cfg, ctx, punchesByDate[rec.date] || [], nowS, todayS);
    days[rec.date] = d;
    if (d.consumed?.late) ctx.late_used++;
    if (d.consumed?.short) ctx.short_used++;
  }
  return { days, before, ctx };
}

// "If you punch out right now" preview for an open session.
function projectNow(rec, sessions, date, cfg, ctxBefore, nowS, todayS) {
  const closed = sessions.map(s => s.out_time ? s : { ...s, out_time: nowS });
  return derive({ ...rec, check_out: nowS.slice(0, 5) }, date, cfg, ctxBefore, closed, nowS, todayS);
}

module.exports = { toMin, toSec, fmtMin, fmtHM, normCfg, isOpen, workedSecs, derive, monthWalk, projectNow };
