// Run: node test-attendance.js
const E = require('./attendance-engine');
const cfg = E.normCfg({});
const T = '2026-10-20', rec = (inT, outT, mode = 'office', date = T) => ({ date, check_in: inT, check_out: outT, mode, manual: 0 });
let pass = 0, fail = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : (fail++, console.log('FAIL', name, 'got', JSON.stringify(got), 'want', JSON.stringify(want))); };
const day = (inT, outT, ctx = { late_used: 0, short_used: 0 }, now = '23:00:00', today = '2026-10-30') => E.derive(rec(inT, outT), T, cfg, ctx, [], now, today);
const st = d => d.status;

eq('9h full', st(day('09:30', '18:30')), 'office');
eq('9h+ full', st(day('09:30', '19:15')), 'office');
eq('8h30 short-day #1 allowed', st(day('09:30', '18:00')), 'office');
eq('8h exactly short-day allowed', st(day('09:30', '17:30')), 'office');
eq('short day #4 -> half', st(day('09:30', '18:00', { late_used: 0, short_used: 3 })), 'half');
eq('short day #3 still full', st(day('09:30', '18:00', { late_used: 0, short_used: 2 })), 'office');
eq('7h59 -> half', st(day('09:30', '17:29')), 'half');
eq('4h exactly -> half', st(day('09:30', '13:30')), 'half');
eq('3h59 -> absent', st(day('09:30', '13:29')), 'absent');
eq('late 20min with 9h from late start', st(day('09:50', '18:50')), 'office');
eq('late 30min allowed (#1)', st(day('10:00', '19:00')), 'office');
eq('late 4th time (within 30) -> half', st(day('09:45', '18:45', { late_used: 3, short_used: 0 })), 'half');
eq('late 3rd time ok', st(day('09:45', '18:45', { late_used: 2, short_used: 0 })), 'office');
eq('late 31 min -> half', st(day('10:01', '19:01')), 'half');
eq('late allowance consumed', day('09:45', '18:45').consumed, { late: true, short: false });
eq('short allowance consumed', day('09:30', '18:00').consumed, { late: false, short: true });
eq('both consumed', day('09:45', '18:15').consumed, { late: true, short: true });
eq('half day does not consume allowances', day('09:30', '16:00').consumed, undefined);
eq('late 31 + short does not consume short', day('10:05', '18:40').consumed, undefined);
eq('on time no consumption', day('09:30', '18:30').consumed, { late: false, short: false });
// open sessions
eq('in progress today', st(E.derive(rec('09:30', null), T, cfg, undefined, [{ in_time: '09:30:00', out_time: null }], '12:00:00', T)), 'office');
eq('in progress flag', E.derive(rec('09:30', null), T, cfg, undefined, [{ in_time: '09:30:00', out_time: null }], '12:00:00', T).in_progress, true);
eq('forgot punch-out, 60 min after office end', st(E.derive(rec('09:30', null), T, cfg, undefined, [{ in_time: '09:30:00', out_time: null }], '19:31:00', T)), 'half');
eq('still working at 19:00 is fine', st(E.derive(rec('09:30', null), T, cfg, undefined, [{ in_time: '09:30:00', out_time: null }], '19:00:00', T)), 'office');
eq('forgot punch-out on past day', st(E.derive(rec('09:30', null), T, cfg, undefined, [{ in_time: '09:30:00', out_time: null }], '09:00:00', '2026-10-21')), 'half');
// multiple sessions are added up
const two = [{ in_time: '09:30:00', out_time: '13:30:00' }, { in_time: '14:30:00', out_time: '18:30:00' }];
eq('two sessions = 8h -> short-day full', st(E.derive(rec('09:30', '18:30'), T, cfg, undefined, two, '23:00:00', '2026-10-30')), 'office');
eq('two sessions minutes', E.derive(rec('09:30', '18:30'), T, cfg, undefined, two, '23:00:00', '2026-10-30').minutes, 480);
eq('lunch gap not counted for 9h', E.derive(rec('09:30', '18:30'), T, cfg, undefined, [{ in_time: '09:30:00', out_time: '13:00:00' }, { in_time: '14:00:00', out_time: '18:30:00' }], '23:00:00', '2026-10-30').minutes, 480);
// no record
eq('no punch before grace end', st(E.derive(null, T, cfg, undefined, [], '09:50:00', T)), 'pending');
eq('no punch after grace end -> absent', st(E.derive(null, T, cfg, undefined, [], '10:05:00', T)), 'absent');
eq('future', st(E.derive(null, '2026-10-25', cfg, undefined, [], '10:05:00', T)), 'pending');
// WFH keeps its mode
eq('wfh full day', st(E.derive(rec('09:30', '18:30', 'wfh'), T, cfg, undefined, [], '23:00:00', '2026-10-30')), 'wfh');
// month walk: 5 short days -> first 3 full, then half
const days = [1, 2, 3, 4, 5].map(i => rec('09:30', '18:00', 'office', '2026-10-0' + i));
const w = E.monthWalk(days, {}, cfg, '23:00:00', '2026-10-30');
eq('month walk statuses', days.map(d => w.days[d.date].status), ['office', 'office', 'office', 'half', 'half']);
eq('month walk short used', w.ctx.short_used, 3);
// late relaxation across the month, mixed
const mix = [rec('09:40', '18:40', 'office', '2026-10-01'), rec('09:35', '18:35', 'office', '2026-10-02'), rec('09:50', '18:50', 'office', '2026-10-03'), rec('09:40', '18:40', 'office', '2026-10-04'), rec('09:30', '18:30', 'office', '2026-10-05')];
const w2 = E.monthWalk(mix, {}, cfg, '23:00:00', '2026-10-30');
eq('late relaxation: 3 ok, 4th half, on-time fine', mix.map(d => w2.days[d.date].status), ['office', 'office', 'office', 'half', 'office']);
// projection
const proj = E.projectNow(rec('09:30', null), [{ in_time: '09:30:00', out_time: null }], T, cfg, { late_used: 0, short_used: 0 }, '14:00:00', T);
eq('projection at 4h30 = half', proj.status, 'half');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
