const { all, get, run, tx, hash } = require('./db');

const iso = d => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

const PERMS = ['team', 'employees', 'attendance', 'leave', 'expenses', 'payroll', 'recruitment', 'onboarding', 'performance', 'helpdesk', 'assets', 'learning', 'announcements', 'settings'];
// Legacy roles -> new model: 'hr' becomes a managing account with every permission; 'manager' manages their direct reports.
function normalizeRoles() {
  run("UPDATE employees SET permissions=?, role='manager' WHERE role='hr'", JSON.stringify(PERMS));
  run("UPDATE employees SET permissions='[\"team\"]' WHERE role='manager' AND permissions IS NULL");
}
// Casual Leave (CL), Privilege Leave (PL), Sick Leave and a Work From Home request type that uses no leave balance.
function ensureLeaveTypes() {
  run("UPDATE leave_types SET name='Casual Leave (CL)' WHERE name='Casual Leave'");
  run("UPDATE leave_types SET name='Privilege Leave (PL)' WHERE name='Earned Leave'");
  if (!get("SELECT id FROM leave_types WHERE kind='wfh'")) run("INSERT OR IGNORE INTO leave_types(name,days_per_year,is_paid,kind) VALUES('Work From Home',0,1,'wfh')");
}
function seedDemo() {
  if (get('SELECT COUNT(*) c FROM employees').c > 0) return;
  tx(() => {
    const depts = ['Executive', 'Human Resources', 'Engineering', 'Sales', 'Finance', 'Operations'];
    depts.forEach(n => run('INSERT INTO departments(name) VALUES(?)', n));
    const D = Object.fromEntries(all('SELECT * FROM departments').map(d => [d.name, d.id]));

    const emp = (code, name, email, role, dept, desig, mgr, join, ctc, gender, loc, pw) => run(
      `INSERT INTO employees(emp_code,name,email,password_hash,role,dept_id,designation,manager_id,join_date,ctc,gender,location,phone,pan,bank_account,dob)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      code, name, email, hash(pw), role, D[dept], desig, mgr, join, ctc, gender, loc,
      '98' + String(Math.floor(10000000 + Math.random() * 89999999)), 'ABCDE' + (1000 + code.slice(-3)) + 'F',
      '5010' + String(Math.floor(1e9 + Math.random() * 8e9)), '1992-04-15').lastInsertRowid;

    const admin = emp('HH001', 'Aarav Mehta', 'admin@hellohr.com', 'admin', 'Executive', 'Chief Executive Officer', null, '2020-01-06', 4800000, 'Male', 'Mumbai', 'admin123');
    const hr = emp('HH002', 'Priya Sharma', 'hr@hellohr.com', 'hr', 'Human Resources', 'HR Manager', admin, '2020-03-02', 1800000, 'Female', 'Mumbai', 'welcome123');
    const eng = emp('HH003', 'Rohan Verma', 'manager@hellohr.com', 'manager', 'Engineering', 'Engineering Manager', admin, '2020-06-15', 3000000, 'Male', 'Bengaluru', 'welcome123');
    const sales = emp('HH004', 'Neha Kapoor', 'sales.lead@hellohr.com', 'manager', 'Sales', 'Sales Lead', admin, '2021-02-01', 2400000, 'Female', 'Delhi', 'welcome123');
    emp('HH005', 'Karan Singh', 'karan@hellohr.com', 'employee', 'Engineering', 'Senior Software Engineer', eng, '2021-08-09', 2000000, 'Male', 'Bengaluru', 'welcome123');
    emp('HH006', 'Ananya Iyer', 'ananya@hellohr.com', 'employee', 'Engineering', 'Software Engineer', eng, '2022-07-18', 1400000, 'Female', 'Bengaluru', 'welcome123');
    emp('HH007', 'Vikram Rao', 'vikram@hellohr.com', 'employee', 'Engineering', 'QA Engineer', eng, '2023-01-23', 1100000, 'Male', 'Hyderabad', 'welcome123');
    emp('HH008', 'Sneha Joshi', 'sneha@hellohr.com', 'employee', 'Sales', 'Account Executive', sales, '2022-04-11', 960000, 'Female', 'Delhi', 'welcome123');
    emp('HH009', 'Arjun Nair', 'arjun@hellohr.com', 'employee', 'Sales', 'Sales Associate', sales, '2023-09-04', 720000, 'Male', 'Delhi', 'welcome123');
    emp('HH010', 'Meera Pillai', 'meera@hellohr.com', 'employee', 'Finance', 'Accountant', hr, '2021-11-15', 840000, 'Female', 'Mumbai', 'welcome123');
    emp('HH011', 'Rahul Desai', 'rahul@hellohr.com', 'employee', 'Operations', 'Operations Executive', hr, '2024-05-20', 600000, 'Male', 'Mumbai', 'welcome123');

    [['Casual Leave', 12, 1], ['Sick Leave', 10, 1], ['Earned Leave', 15, 1], ['Loss of Pay', 0, 0]]
      .forEach(([n, d, p]) => run('INSERT INTO leave_types(name,days_per_year,is_paid) VALUES(?,?,?)', n, d, p));

    const y = new Date().getUTCFullYear();
    [[`${y}-01-01`, "New Year's Day"], [`${y}-01-26`, 'Republic Day'], [`${y}-03-14`, 'Holi'], [`${y}-08-15`, 'Independence Day'],
     [`${y}-10-02`, 'Gandhi Jayanti'], [`${y}-11-08`, 'Diwali'], [`${y}-12-25`, 'Christmas']]
      .forEach(([d, n]) => run('INSERT OR IGNORE INTO holidays(date,name) VALUES(?,?)', d, n));

    // attendance for last 70 days (weekdays, mostly present)
    const today = new Date(iso(new Date()) + 'T00:00:00Z');
    const hols = new Set(all('SELECT date FROM holidays').map(h => h.date));
    const emps = all("SELECT id, join_date FROM employees");
    for (let i = 70; i >= 1; i--) {
      const d = addDays(today, -i), ds = iso(d), wd = d.getUTCDay();
      if (wd === 0 || wd === 6 || hols.has(ds)) continue;
      for (const e of emps) {
        if (ds < e.join_date) continue;
        const r = Math.random();
        if (r < 0.04) continue; // absent
        const inH = 9 + Math.floor(Math.random() * 2), inM = Math.floor(Math.random() * 59);
        const status = r < 0.08 ? 'half' : r < 0.2 ? 'wfh' : 'present';
        const pad = n => String(n).padStart(2, '0');
        run('INSERT INTO attendance(emp_id,date,check_in,check_out,status,mode) VALUES(?,?,?,?,?,?)',
          e.id, ds, `${pad(inH)}:${pad(inM)}`, `${pad(status === 'half' ? 13 : 18)}:${pad(Math.floor(Math.random() * 59))}`, status, status === 'wfh' ? 'wfh' : 'office');
      }
    }

    const lt = Object.fromEntries(all('SELECT * FROM leave_types').map(l => [l.name, l.id]));
    const ids = Object.fromEntries(all('SELECT id,emp_code FROM employees').map(e => [e.emp_code, e.id]));
    const lv = (c, t, f, to, days, reason, st) => run(
      'INSERT INTO leaves(emp_id,type_id,from_date,to_date,days,reason,status,approver_id,created) VALUES(?,?,?,?,?,?,?,?,?)',
      ids[c], lt[t], f, to, days, reason, st, st === 'pending' ? null : eng, iso(new Date()));
    lv('HH005', 'Casual Leave', iso(addDays(today, 7)), iso(addDays(today, 8)), 2, 'Family function', 'pending');
    lv('HH006', 'Sick Leave', iso(addDays(today, -20)), iso(addDays(today, -19)), 2, 'Fever', 'approved');
    lv('HH008', 'Earned Leave', iso(addDays(today, 14)), iso(addDays(today, 18)), 3, 'Vacation', 'pending');

    // jobs & candidates
    run("INSERT INTO jobs(title,dept_id,openings,location,description,created) VALUES('Senior Backend Engineer',?,2,'Bengaluru','Build scalable services.',?)", D.Engineering, iso(today));
    run("INSERT INTO jobs(title,dept_id,openings,location,description,created) VALUES('Sales Executive',?,3,'Delhi','Drive new business.',?)", D.Sales, iso(today));
    [['Ishaan Gupta', 'ishaan@example.com', 'Interview', 1800000], ['Pooja Reddy', 'pooja@example.com', 'Screening', 1500000],
     ['Manish Tiwari', 'manish@example.com', 'Applied', 900000], ['Divya Menon', 'divya@example.com', 'Offer', 800000]]
      .forEach(([n, e, s, c], i) => run('INSERT INTO candidates(job_id,name,email,phone,stage,expected_ctc,created) VALUES(?,?,?,?,?,?,?)', i < 2 ? 1 : 2, n, e, '9876500000', s, c, iso(today)));

    // goals, courses, assets, announcements, tickets
    run("INSERT INTO goals(emp_id,title,description,progress,due) VALUES(?,?,?,?,?)", ids.HH005, 'Migrate billing service', 'Move to new architecture', 60, `${y}-12-31`);
    run("INSERT INTO goals(emp_id,title,description,progress,due) VALUES(?,?,?,?,?)", ids.HH008, 'Close 15 enterprise deals', 'Q4 target', 40, `${y}-12-31`);
    run("INSERT INTO reviews(emp_id,reviewer_id,cycle,rating,comments,created) VALUES(?,?,?,?,?,?)", ids.HH005, eng, `H1 ${y}`, 4, 'Strong delivery and mentoring.', iso(today));
    [['Code of Conduct', 'Company policies and ethics', '1 hr', 1], ['POSH Awareness', 'Prevention of sexual harassment', '45 min', 1],
     ['Effective Communication', 'Workplace communication skills', '2 hrs', 0], ['Data Security Basics', 'Keep company data safe', '1 hr', 1]]
      .forEach(([t, d, du, m]) => run('INSERT INTO courses(title,description,duration,mandatory) VALUES(?,?,?,?)', t, d, du, m));
    run('INSERT INTO assets(name,tag,category,assigned_to,status,assigned_on) VALUES(?,?,?,?,?,?)', 'MacBook Pro 14"', 'AST-001', 'Laptop', ids.HH005, 'assigned', iso(today));
    run('INSERT INTO assets(name,tag,category,assigned_to,status,assigned_on) VALUES(?,?,?,?,?,?)', 'Dell Latitude 5440', 'AST-002', 'Laptop', ids.HH008, 'assigned', iso(today));
    run("INSERT INTO assets(name,tag,category,status) VALUES('Dell Latitude 5440','AST-003','Laptop','available')");
    run("INSERT INTO assets(name,tag,category,status) VALUES('iPhone 15','AST-004','Mobile','available')");
    run('INSERT INTO announcements(title,body,author_id,created) VALUES(?,?,?,?)', 'Welcome to HelloHR 🎉', 'Our new HR portal is live. Mark attendance, apply for leave, raise tickets and view payslips - all in one place.', hr, iso(today));
    run('INSERT INTO tickets(emp_id,subject,category,description,created) VALUES(?,?,?,?,?)', ids.HH006, 'Update bank account', 'Payroll', 'Please update my salary account details.', iso(today));
    run('INSERT INTO expenses(emp_id,category,amount,date,description,created) VALUES(?,?,?,?,?,?)', ids.HH008, 'Travel', 3200, iso(addDays(today, -3)), 'Client visit cab fare', iso(today));
  });
  normalizeRoles();
  ensureLeaveTypes();
  console.log('Database seeded with demo data.');
}
function seedBasics({ name, adminName, adminEmail, adminPassword, prefix = 'HH' }) {
  tx(() => {
    ['Management', 'Human Resources', 'Engineering', 'Sales', 'Finance', 'Operations'].forEach(n => run('INSERT OR IGNORE INTO departments(name) VALUES(?)', n));
    [['Casual Leave', 12, 1], ['Sick Leave', 10, 1], ['Earned Leave', 15, 1], ['Loss of Pay', 0, 0]]
      .forEach(([n, d, p]) => run('INSERT OR IGNORE INTO leave_types(name,days_per_year,is_paid) VALUES(?,?,?)', n, d, p));
    const dept = get("SELECT id FROM departments WHERE name='Management'").id;
    const id = run(`INSERT INTO employees(emp_code,name,email,password_hash,role,dept_id,designation,join_date,status)
      VALUES(?,?,?,?,'admin',?,'Administrator',?,'active')`, prefix + '001', adminName, adminEmail, hash(adminPassword), dept, iso(new Date())).lastInsertRowid;
    ensureLeaveTypes();
    run('INSERT INTO announcements(title,body,author_id,created) VALUES(?,?,?,?)', 'Welcome to ' + name, 'Your HR portal is ready. Add departments, holidays and employees from Settings and Employees.', id, iso(new Date()));
  });
}
module.exports = { seedDemo, seedBasics, normalizeRoles, ensureLeaveTypes, PERMS };
