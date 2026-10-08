# HelloHR - HRMS Portal

Employee management system with zero npm dependencies (Node 22.5+ with built-in SQLite).

## Run
    cd D:\hellohr
    npm start        # http://localhost:3000

## Login pages (separate for each panel)
| Panel | URL | Sign in with | Demo |
|---|---|---|---|
| Master (platform owner) | http://localhost:3000/master | email + password | master@hellohr.com / master123 |
| Company admin | http://localhost:3000/admin | email + password | admin@hellohr.com / admin123 |
| HR, managers, employees | http://localhost:3000/ | Employee ID + password | HH002 (HR), HH003 (manager), HH005 (employee) / welcome123 |

Rules: no self sign-up anywhere. Only the master creates companies and their admin (one admin per company, which keeps data separate).
Only the admin creates employee accounts and assigns positions (employee / manager / HR). Each company has its own database in `data/`,
so one admin can never see or manage another company's people. Employee IDs use a per-company prefix (e.g. ACME001).
Change the master password after first login.

## Modules
Core HR (profiles, directory, org chart) - Attendance (check-in/out, calendar, team view, report) - Leave (policies, balances, approvals, holidays) -
Payroll (salary structure, LOP, PF/PT/TDS estimates, payslips) - Recruitment (jobs, pipeline, hire) - Onboarding/Offboarding checklists + FnF exit -
Performance (goals/OKRs, reviews) - Expenses - Helpdesk - Assets - Learning (LMS) - Announcements - Settings.

Roles: admin, hr, manager (approves for direct reports), employee. Tax calculations are simplified estimates.



## Account types and permissions
When the admin (or the master) creates an employee they choose:
- **Normal employee** - self-service only.
- **Managing access** - then tick what the person can manage: direct reports, employee records, attendance, leave, expenses, payroll & salaries,
  recruitment, onboarding/offboarding, performance, helpdesk, assets, learning, announcements, company settings.
The master can add an employee under any admin's company from the Companies page (+ Add employee); only that company's admin sees them.

## Automatic attendance
Statuses are worked out live from punch-in/out times and the company's office rules (Settings -> Attendance rules; defaults 09:30-18:30, 15 min grace, half-day time 13:30):
no punch-in by start+grace = Absent - punch-in after the half-day time, punch-out before it, or no punch-out by office end = Half day - punch-in after grace = Late.
The admin Attendance page, Employees directory and dashboard refresh every few seconds, so punches show up without reloading. Admins can override a day, or set it back to "Automatic".

## Working-hours attendance (punch in / punch out)
Employees punch in/out from the top of their dashboard (the button toggles and a live timer counts the hours; several sessions a day add up).
Under 4h = Absent - 4h+ = Half day - 8h+ = Full day. The office day is 9h: 8-9h still counts as Full day, but only 3 times a month (then Half day).
Arriving up to 30 min late is allowed 3 days a month (then Half day); more than 30 min late is Half day. Forgot to punch out = Half day until they do.
Rules live in `attendance-engine.js` (unit tests: `node test-attendance.js`) and can be changed in Settings -> Attendance rules.

## Office location & geo-fencing
Admin -> **Office location** (or the button on the Attendance page): set the office point (use your current location or type latitude/longitude) and an allowed distance (default 100 m).
Once set, employees can punch in/out only within that distance; the browser shares their GPS position with each punch. **Geo-fencing** lets you pick employees who may punch from anywhere -
their location is still stored and appears in **Punch history** (Attendance -> Punch locations / Punch history) with the date, flagged "Away from office". Clear the location to switch the check off.
Browsers only share location on HTTPS or localhost pages, so use HTTPS when you deploy. Work-from-home punches need an approved WFH request (or the employee's work type set to Work from home) once an office location is set.

## Deploying on Vercel (serverless + Postgres)
Vercel has no persistent disk, so on Vercel HelloHR stores everything in **Postgres** (each company gets its own schema). Locally it still uses SQLite files - the same code runs on both.
1. Vercel -> **Add New -> Project** -> import this GitHub repo (no build settings needed; `vercel.json` routes everything to `api/index.js`).
2. Project -> **Storage** -> **Create Database** -> **Neon (Postgres)** -> connect it to the project. This adds `DATABASE_URL` automatically. Pick the Neon region closest to the function region (default `iad1`, US East) - the app makes many small queries, so latency matters.
3. Project -> **Settings -> Environment Variables**: `MASTER_EMAIL`, `MASTER_PASSWORD` (mark as Sensitive; creates the platform owner on first start). Optional: `APP_TZ` (default `Asia/Kolkata`), `MASTER_NAME`.
4. **Deploy**, then open `https://<your-project>.vercel.app/master` and sign in. Create companies from there; admins use `/admin`, everyone else `/`.
The demo company is never seeded on Vercel. Tables are created automatically on first start.

## Other hosts
Any Docker host with a persistent disk works too (`Dockerfile`, mount a volume at `/data`; or `render.yaml` for Render). Environment: `MASTER_EMAIL`, `MASTER_PASSWORD`, `DATA_DIR`, `NODE_ENV=production`. Set `DATABASE_URL` instead to use Postgres anywhere.

## Tests
`npm test` (attendance rules) and, against a running server, `BASE=http://localhost:3000 MASTER_EMAIL=... MASTER_PASSWORD=... node test-api.js` (end-to-end; creates and deletes a throw-away company; works on SQLite and Postgres).
