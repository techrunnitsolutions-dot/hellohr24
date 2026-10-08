// Pure payroll maths (no database), so it can be unit-tested.
//
// Rules implemented:
//  - Salary = annual CTC / 12 (basic 40%, HRA 50% of basic, rest special allowance), pro-rated by paid days.
//  - Full day / WFH = 1 day, half day = 0.5 day, absent = 0 (loss of pay), unless covered by a paid leave.
//  - A day with fewer hours than a half day (and not set by an admin) is NOT counted as a day: the hours worked are paid
//    hourly, i.e. 1 - hours/office-hours of that day is loss of pay.
//  - Hours beyond the office day (default 9h) on a working day are overtime: paid at the hourly rate plus the overtime premium (default +75%).
//    hourly rate = monthly gross / (working days in the month x office hours).
//  - Salary day (default the 7th) is the date the previous month's salary is paid.
const round = n => Math.round(n * 100) / 100;

function annualTax(ctc) {
  const taxable = Math.max(0, ctc - 75000);
  const slabs = [[400000, 0], [800000, .05], [1200000, .10], [1600000, .15], [2000000, .20], [2400000, .25], [Infinity, .30]];
  let tax = 0, prev = 0;
  for (const [lim, r] of slabs) { if (taxable > prev) tax += (Math.min(taxable, lim) - prev) * r; prev = lim; }
  if (taxable <= 1200000) tax = 0; // 87A rebate
  return tax * 1.04;
}
function structure(ctc) {
  const gross = ctc / 12, basic = gross * 0.4, hra = basic * 0.5, special = gross - basic - hra;
  return { gross, basic, hra, special };
}
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const lastDay = month => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).toISOString().slice(0, 10);
// the day the salary for `month` is paid: the salary day of the following month
function payDate(month, day = 7) {
  let y = +month.slice(0, 4), m = +month.slice(5) + 1; if (m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(28, Math.max(1, Math.round(day)))).padStart(2, '0')}`;
}

// dayOf(date) must return the derived attendance of that day: { status, minutes, manual, in_progress }
function buildSlip({ emp, month, today, cfg, hols, dayOf, leaves = [], reimb = 0 }) {
  const first = month + '-01', last = lastDay(month), officeMin = Math.round(cfg.office_hours * 60), halfMin = cfg.half_day_hours * 60;
  let working = 0, lop = 0, partialMin = 0, otMin = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const w = new Date(d + 'T00:00:00Z').getUTCDay();
    if (w === 0 || w === 6 || hols.has(d)) continue;
    working++;
    if (d < emp.join_date) { lop++; continue; }
    if (emp.exit_date && d > emp.exit_date) { lop++; continue; }
    if (d > today) continue;
    const dv = dayOf(d), st = dv.status, final = !dv.manual && !dv.in_progress && !dv.open;
    if (final && ['office', 'wfh', 'half'].includes(st) && dv.minutes > officeMin) otMin += dv.minutes - officeMin;   // overtime beyond the office day
    if (st === 'pending' || st === 'office' || st === 'wfh') continue;
    if (st === 'half') { lop += 0.5; continue; }
    const lv = leaves.find(l => l.from_date <= d && l.to_date >= d);
    if (lv && lv.is_paid) continue;
    if (final && dv.minutes > 0 && dv.minutes < halfMin) { lop += 1 - Math.min(dv.minutes, officeMin) / officeMin; partialMin += dv.minutes; continue; }   // short day: paid for the hours only
    lop++;
  }
  const s = structure(emp.ctc), ratio = working ? (working - lop) / working : 0;
  const basic = s.basic * ratio, hra = s.hra * ratio, special = s.special * ratio, gross = basic + hra + special;
  const pf = Math.min(basic, 15000) * 0.12, pt = gross > 15000 ? 200 : 0, tds = annualTax(emp.ctc) / 12 * ratio;
  const hourly = working ? s.gross / (working * cfg.office_hours) : 0;
  const otHours = otMin / 60, otPay = otHours * hourly * (1 + (cfg.ot_premium || 0) / 100), deductions = pf + pt + tds;
  return { emp_id: emp.id, month, working_days: working, paid_days: round(working - lop), lop_days: round(lop),
    basic: round(basic), hra: round(hra), special: round(special), gross: round(gross),
    pf: round(pf), pt: round(pt), tds: round(tds), reimbursements: round(reimb),
    ot_hours: round(otHours), ot_pay: round(otPay), partial_hours: round(partialMin / 60), hourly_rate: round(hourly),
    deductions: round(deductions), net: round(gross - deductions + reimb + otPay) };
}
module.exports = { round, annualTax, structure, buildSlip, payDate };
