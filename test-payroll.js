// Run: node test-payroll.js
const P = require('./payroll-engine'), E = require('./attendance-engine');
const cfg = E.normCfg({}); let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = typeof want === 'number' ? Math.abs(got - want) < 0.011 : JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : (fail++, console.log('FAIL', n, 'got', JSON.stringify(got), 'want', JSON.stringify(want))); };
const emp = { id: 1, ctc: 1200000, join_date: '2020-01-01' };            // 100000 / month
const MONTH = '2026-09', TODAY = '2026-10-15', HOLS = new Set();
// Sept 2026 has 22 working days (Tue 1st ... Wed 30th)
const wdays = []; for (let d = 1; d <= 30; d++) { const s = `2026-09-${String(d).padStart(2, '0')}`, w = new Date(s + 'T00:00:00Z').getUTCDay(); if (w !== 0 && w !== 6) wdays.push(s); }
eq('22 working days', wdays.length, 22);
const slip = (over = {}, extra = {}) => P.buildSlip({ emp, month: MONTH, today: TODAY, cfg, hols: HOLS, dayOf: d => over[d] || { status: 'office', minutes: 540 }, ...extra });

let s = slip(); eq('all present: paid days', s.paid_days, 22); eq('all present: gross', s.gross, 100000); eq('no overtime', s.ot_pay, 0); eq('hourly rate = 100000 / (22 x 9)', s.hourly_rate, 505.05);
s = slip({ [wdays[0]]: { status: 'absent', minutes: 0 } }); eq('one absent day: 1 day of loss of pay', s.lop_days, 1); eq('absent: gross', s.gross, 100000 * 21 / 22);
s = slip({ [wdays[0]]: { status: 'half', minutes: 300 } }); eq('half day = 0.5 loss of pay', s.lop_days, 0.5);

// worked less than half a day (2h) -> paid for the hours only, not a day
s = slip({ [wdays[0]]: { status: 'absent', minutes: 120 } });
eq('2h day: loss of pay is 1 - 2/9 of a day', s.lop_days, 1 - 2 / 9); eq('2h day: hours reported', s.partial_hours, 2);
eq('2h day: pays exactly 2 hours at the hourly rate', s.gross - 100000 * 21 / 22, 2 * 100000 / (22 * 9));
s = slip({ [wdays[0]]: { status: 'absent', minutes: 239 } }); eq('3h59 is still an hourly day', s.partial_hours, 3.98);
s = slip({ [wdays[0]]: { status: 'absent', minutes: 120, manual: true } }); eq('admin-set absent is NOT paid hourly', s.lop_days, 1);
s = slip({ [wdays[0]]: { status: 'absent', minutes: 120 } }, { leaves: [{ from_date: wdays[0], to_date: wdays[0], is_paid: 1 }] }); eq('paid leave covers a short day entirely', s.lop_days, 0);
s = slip({ [wdays[0]]: { status: 'absent', minutes: 120 } }, { leaves: [{ from_date: wdays[0], to_date: wdays[0], is_paid: 0 }] }); eq('unpaid leave: still hourly pay for hours worked', s.lop_days, 1 - 2 / 9);

// overtime: beyond 9 hours, hourly rate + 75%
s = slip({ [wdays[3]]: { status: 'office', minutes: 660 } });   // 11 h => 2 h overtime
eq('overtime hours', s.ot_hours, 2); eq('overtime pay = 2h x hourly x 1.75', s.ot_pay, 2 * (100000 / (22 * 9)) * 1.75); eq('net includes overtime', s.net, s.gross - s.deductions + s.ot_pay);
s = slip({ [wdays[3]]: { status: 'office', minutes: 540 } }); eq('exactly 9h = no overtime', s.ot_hours, 0);
s = slip({ [wdays[3]]: { status: 'office', minutes: 570 }, [wdays[4]]: { status: 'wfh', minutes: 600 } }); eq('overtime adds up across days (0.5h + 1h)', s.ot_hours, 1.5);
s = slip({ [wdays[3]]: { status: 'half', minutes: 600 } }); eq('overtime counts on half days too (late arrival, long stay)', s.ot_hours, 1);
s = slip({ [wdays[3]]: { status: 'office', minutes: 700, manual: true } }); eq('admin-set days have no overtime', s.ot_hours, 0);
s = slip({ [wdays[3]]: { status: 'office', minutes: 700, in_progress: true } }); eq('a day still in progress has no overtime yet', s.ot_hours, 0);
s = P.buildSlip({ emp, month: MONTH, today: TODAY, cfg: { ...cfg, ot_premium: 0 }, hols: HOLS, dayOf: d => d === wdays[3] ? { status: 'office', minutes: 660 } : { status: 'office', minutes: 540 } }); eq('premium 0% = plain hourly pay', s.ot_pay, 2 * 100000 / (22 * 9));
s = P.buildSlip({ emp, month: MONTH, today: TODAY, cfg: { ...cfg, ot_premium: 100 }, hols: HOLS, dayOf: d => d === wdays[3] ? { status: 'office', minutes: 660 } : { status: 'office', minutes: 540 } }); eq('premium 100% = double pay', s.ot_pay, 2 * 100000 / (22 * 9) * 2);

// joining mid-month, exit, holidays
s = slip({}, { emp: { ...emp, join_date: '2026-09-15' } }); eq('joined mid-month: earlier days are loss of pay', s.lop_days, wdays.filter(d => d < '2026-09-15').length);
s = P.buildSlip({ emp, month: MONTH, today: TODAY, cfg, hols: new Set([wdays[5]]), dayOf: () => ({ status: 'office', minutes: 540 }) }); eq('a holiday is not a working day', s.working_days, 21);
s = P.buildSlip({ emp, month: '2026-10', today: '2026-10-08', cfg, hols: HOLS, dayOf: () => ({ status: 'office', minutes: 540 }) }); eq('days after today are not penalised', s.lop_days, 0);

// salary day
eq('salary day: September salary is paid on 7 October', P.payDate('2026-09', 7), '2026-10-07'); eq('December salary rolls into January', P.payDate('2026-12', 7), '2027-01-07'); eq('salary day is capped at 28', P.payDate('2026-01', 31), '2026-02-28');
eq('config defaults', [cfg.salary_day, cfg.ot_premium], [7, 75]); eq('config overrides', [E.normCfg({ salary_day: '10', ot_premium_percent: '50' }).salary_day, E.normCfg({ salary_day: '10', ot_premium_percent: '50' }).ot_premium], [10, 50]);

// ---- salary basis: annual CTC vs annual in-hand ----
for (const H of [150000, 180000, 240000, 300000, 480000, 600000, 960000, 1100000, 1200000, 1500000, 2400000, 3600000, 6000000]) {
  const c = P.ctcFromInhand(H); eq(`in-hand ${H} -> CTC ${c} gives back ${H} (within Rs 2)`, Math.abs(P.annualNet(c) - H) < 2, true); eq(`CTC ${c} is above the in-hand ${H}`, c >= H, true);
}
eq('CTC order follows in-hand order', [240000, 480000, 960000, 1500000, 3000000].map(P.ctcFromInhand).every((c, i, a) => i === 0 || c > a[i - 1]), true);
eq('zero / negative in-hand', [P.ctcFromInhand(0), P.ctcFromInhand(-5)], [0, 0]);
// the slip really pays the typed in-hand: a full month at that CTC nets 1/12 of it (within a few rupees of rounding)
{ const H = 1000000, c = P.ctcFromInhand(H), s = P.buildSlip({ emp: { id: 1, ctc: c, join_date: '2020-01-01' }, month: '2026-09', today: '2026-10-15', cfg, hols: new Set(), dayOf: () => ({ status: 'office', minutes: 540 }) });
  eq('full month at the derived CTC nets in-hand / 12', Math.abs(s.net * 12 - H) < 30, true); }
{ const b = P.salaryBreakdown(1200000); eq('breakdown of a 12L CTC: gross/month', b.gross_monthly, 100000); eq('breakdown: PF is 12% of basic capped at 15000 basic', b.pf, 1800); eq('breakdown: in-hand annual = 12 x monthly', Math.abs(b.inhand_annual - b.inhand_monthly * 12) < 1, true); }
{ const a = P.resolveSalary('ctc', 1200000), b = P.resolveSalary('inhand', a.inhand_annual); eq('resolve ctc keeps the CTC', a.ctc, 1200000); eq('resolve in-hand of that CTC returns (about) the same CTC', Math.abs(b.ctc - 1200000) <= 2, true); }
eq('bad basis refused', (() => { try { P.resolveSalary('hourly', 1); } catch (e) { return e.message; } })(), 'Choose annual CTC or annual in-hand');
eq('bad amount refused', (() => { try { P.resolveSalary('ctc', -1); } catch (e) { return e.message; } })(), 'Enter a valid annual amount');
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
