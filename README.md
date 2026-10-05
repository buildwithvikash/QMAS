# QMAS — Incoming Material Inspection & Defect Notification

Digitises the IQC lifecycle across the Western Refrigeration plants: SAP inward lot → inspection
format → IMIR on tablets (offline capable) → review → deviation (SCM / VD) → senior escalation →
closure, plus Defect Notification with CAPA. Around it: quality insights and AI assistance, reports,
an audit trail, SAP sync and system monitoring, a help & support desk, guided tours, and light / dark
themes.

The design (requirements, decisions, workflow, database, API) is in [docs/design-rev4.html](docs/design-rev4.html).

## Status

| Sprint | Scope | State |
|---|---|---|
| **A — Foundation** | Auth (own accounts, lockout, rotating refresh tokens), roles & plant-scoped permissions, users, masters (plants, vendors, items, categories, UOM, instruments), sampling table, configurable numbering, audit trail, logging, migrations, web app shell | **Done** |
| **B — Inspection formats** | One format per item; drafts from current version / SAN-SIR (mock) / copy / blank; Git-style versioning (fast-forward, three-way merge, conflict resolution, replace for unrelated first drafts); approval queue by submission time; version history and compare; Excel bulk import with template | **Done** |
| **C — IMIR & inspection** | SAP QA32 adapter (mock) with scheduled pull and retry; IMIR opening (number, pinned format, sampling, reliability due per item + vendor); inspection sheet with server-side OK/NOK, photos/PDFs per visual sample; tablets: registration, checkout locks, replay-safe offline sync, installable offline web app (the same app on desktops and tablets; no separate native app) | **Done** |
| **D — Review & deviation** | Incharge review (approve — a failed lot with a final approval remark — / reject / send back / escalate, checkpoint remarks); IQC Head approve (final approval remark) or hold → deviation offered to SCM and VD, the first to accept owns it; recommendation to reject → own department Head (approve / send back) → IQC Head rejects; admin reversal of any IMIR, deviation or DN / CAPA step on request, with an audit trail; Deviation Form with revisions; configurable department approval chain (Sub-Head, optionally Head); IQC Head final decision bound by the senior outcome; parallel senior escalation (highest rank wins, CQA waits for PDC, 24 h Operations Head timeout adds CQA, CQA / Central Ops / Admin override, append-only decisions); OK / Not-OK quantities with 14-day auto-close; workflow history; My Tasks inbox | **Done** |
| **E — DN/CAPA, reports, notifications** | Defect Notification (Incoming) raised from an escalated lot: DN number and date stamped once, pre-filled defect table, 4 images, CAPA applicable Y/N; CAPA cycles (submit → approve or resubmit) with vendor documents kept as evidence; 3-day CAPA due with reminders every 2 days; DN and IMIR (JIR layout) PDFs; "mail to myself" with the DN attached; in-app bell and e-mail for every hand-off through a transactional outbox with retries; dashboard tiles; reports (IMIR register, pending ageing, vendor quality with rejected PPM, deviation register, DN/CAPA ageing) on screen or as Excel | **Done** |
| **After E — enhancements** | Custom format builder (palette, table view, paste from Excel) with change history and an inspector-view preview; format import with on-screen review and correction; redesigned IMIR page; reports with charts; audit trail; SAP sync monitor; System Health, Error Log, crash screen and alerts; quality insights and AI with one permission per feature; help & support desk; guided tours; dark mode; local PostgreSQL setup (see [What is in the app](#what-is-in-the-app)) | **Done** |

## What is in the app

| Area | What it does |
|---|---|
| **Sign-in** | Employee code and password, one session per user, sign-out after 30 minutes idle (`IDLE_TIMEOUT_MIN`), forgot / reset password by mail, "Remember me" keeps only the employee code on the device |
| **Dashboard & My Tasks** | Work waiting for you, most urgent first; incoming quality charts; bell and mail notifications for every hand-off |
| **Incoming inspection (IMIR)** | Card layout: general information, inspection status, supplier risk, "Before you inspect" (repeat defects, drift), model and additional details; dimensional, visual and reliability sections one after another with a check point search, a Result column (red out of spec, amber near a limit) and a remark per row; sign-off; full history beside linked records and stage history |
| **Tablets** | The same web app, installable and offline capable (see [Tablets](#tablets)) |
| **Inspection formats** | Format library per item; Git-style drafts, approval, merge and conflict resolution; version history and changes. **Format builder:** field palette with search (lot details: text, number, date, yes / no, dropdown; inspection fields: measurement, OK / Not OK, choice per sample, reliability test), numbered sections shown as editable tables (or a list), drag to reorder, duplicate / collapse / move sections, **paste measurements from Excel** (limits read from a specification like `57 ± 0.3`), a field settings panel, and a **Preview** that is the real inspection sheet on sample data. **Inspector view** tabs on the item and version pages show a format exactly as the inspector fills it. Empty drafts started before a newer version was approved are closed automatically, and the builder warns when a draft is behind. **Excel import** (its own permission, `formats.import`): after the file check each item can be reviewed with a preview, corrected on screen (edit, add or delete rows) and checked again; the corrected data is imported and marked as such |
| **Deviation, DN & CAPA** | SCM / VD deviation with the department approval chain and senior escalation; Defect Notification with CAPA cycles, reminders and PDFs |
| **Reports & insights** | Overview, lot, vendor, item, deviation and ageing reports with charts and Excel / CSV download; Quality Insights (history, drift, supplier risk, chance a lot fails); AI summaries, CAPA assessment, root-cause suggestions and **Ask QMAS** when an AI provider is configured. Each AI feature has its own permission (`ai.insights`, `ai.failure_chance`, `ai.imir_summary`, `ai.capa_review`, `ai.root_cause`, `ai.search`, `ai.ask`, `ai.voice_tidy`), so it can be given role by role |
| **Master config** | Plants and instruments (count cards, search, activate / deactivate), number series (patterns with live preview), sampling table, deviation approval chains |
| **Administration** | Users and sessions; **Roles & Permissions** (each role's permissions by module, custom roles; see [Permissions](#permissions)); tablets; **SAP Sync** monitor (runs, errors, pull now); **Audit Trail** of every change and the sign-in log, with CSV export; **System Health** and **Error Log** (see [Monitoring and logs](#monitoring-and-logs)) |
| **Help & Support** | Help Center (searchable guides per module); **Report a problem** from any page ("?" in the top bar) with screenshots (paste with Ctrl+V) and the page and browser details; tickets `HLP-00001…` with conversation, internal notes, assignment, priority and status; notices in the bell and by mail. Holders of the `support.manage` permission (System Admin by default) work the tickets |
| **Guided tours** | Step-by-step tours that highlight parts of a page with a short explanation (dashboard, incoming lots, inspecting a lot, format library, format builder, import, deviations, DNs, reports, help). Offered on a first visit to a page ("Not now", "Don't show again", or stop offers); start any time from **? → Tour of this page** or **Help Center → Guided tours**, which shows progress. Tours are defined in `frontend/src/app/tours.js`; steps point at `data-tour` anchors |
| **Appearance** | Light, dark or system theme (sun / moon in the top bar, or Appearance in the account menu), remembered per device; the sign-in pages always stay light. Questions such as "Delete this section?" use the app's own dialog, not the browser's |

## Permissions

Menus and actions follow the permissions of a user's roles (the API checks them again on every
request). System Admin holds all of them; the other built-in roles get the defaults in
`packages/shared/src/constants/permissions.js`, and any role can be changed on the Roles &
Permissions page. Pages without a permission (Help Center, My Tickets) are open to everyone signed in.

| Area | Permissions |
|---|---|
| Home | `dashboard.view` |
| Administration | `users.view`, `users.manage`, `roles.manage`, `audit.view`, `devices.manage`, `integration.monitor`, `system.monitor`, `workflow.reverse` (Reversal Requests) |
| Master Config | `masters.view`, `masters.manage`, `numbering.manage`, `sampling.manage` |
| Inspection Formats | `formats.view`, `formats.create`, `formats.approve`, `formats.import` |
| Incoming Inspection | `imir.view`, `imir.inspect`, `imir.review`, `imir.head_decide` |
| Deviation | `deviation.view`, `deviation.initiate`, `deviation.approve`, `deviation.final_decide`, `escalation.decide`, `escalation.override` |
| Defect Notification | `dn.view`, `dn.manage`, `dn.approve_capa` |
| Reports | `reports.view` |
| AI Assistant | `ai.insights` (Quality Insights page), `ai.failure_chance` (chance a lot fails), `ai.imir_summary`, `ai.capa_review`, `ai.root_cause`, `ai.search` (search in plain words), `ai.ask` (Ask QMAS), `ai.voice_tidy` (tidy dictated text) |
| Help & Support | `support.manage` (work on everyone's tickets) |

`ai.insights` and `ai.failure_chance` work from history without an AI service; the others need
`ANTHROPIC_API_KEY` (or the Puter trial).

## Tablets

Tablets use this same web app; there is no separate Android app. On each tablet:

1. Open QMAS in Chrome, sign in, and choose **Install app** from the browser menu.
2. Open **Incoming Inspection → This Tablet**, enter the device code registered under
   Administration → Tablets, and tap **Protect storage** so Android does not clear offline data.
3. Take lots onto the tablet while online; inspect them with or without a connection.

Offline entries are stamped with the inspector who recorded them and are sent only under that
inspector's sign-in. **Save backup** on the tablet page writes everything not yet sent to a file,
which can be restored on the same tablet if its storage is ever lost.

## Layout

```
packages/shared   constants, permissions, zod schemas, pure rules (numbering, sampling, inspection,
                  insights) — used by the API and the web app
backend           Express 5 API · modules (routes → services → SQL) · migrations 0001–0019 · worker · tests
  logs/            daily log files (not in git)
frontend          React 19 + Vite + Tailwind 4 + RTK Query, WRL Tool Report look and feel
  src/styles/dark.css   dark theme, generated by frontend/scripts/build-dark-theme.py
docs              design document
```

The dark theme remaps the Tailwind palette under `html.dark` instead of adding `dark:` classes to
every element. After changing colours in `frontend/src/index.css`, regenerate it:

```bash
python frontend/scripts/build-dark-theme.py
```

## Local development (Windows)

```bash
npm install
```

Copy `backend/.env.example` to `backend/.env`, set a random `JWT_ACCESS_SECRET` (the example file
shows a one-liner) and `COOKIE_SECURE=false`. Then choose a database:

- **PostgreSQL installed on the machine (recommended).** Install PostgreSQL (18 is tested), then run
  `npm run db:setup-local`. It asks for the `postgres` password (typed hidden, never stored),
  creates the login role `qmas_app` with a random password and the database `qmas`, copies the data
  from the database currently in `.env` (or starts empty), backs up `.env` and points
  `DATABASE_URL` at the new database. Safe to run again.
- **Embedded dev database (no install).** `npm run db:dev` starts PostgreSQL 17 from
  `node_modules` on port 54329, migrates, and prints the `DATABASE_URL` to paste into `.env`.

After pulling new code, apply migrations and reference data (this also adds new permissions):

```bash
npm run db:migrate
```

Then:

```bash
npm run create-admin -- --employee-code ADMIN01 --name "System Administrator"
npm run dev:api           # http://localhost:4000
npm run dev:web           # http://localhost:5173 (proxies /api)
npm -w @qmas/backend run worker   # SAP pull, deviation timers and CAPA reminders (5 min), mail outbox (30 s)
npm run lint              # web app lint
npm run build:web         # production build of the web app
```

`create-admin` asks for a temporary password; the admin must change it at first sign-in.

To look inside the database, use pgAdmin (installed with PostgreSQL) or `psql` with the
`DATABASE_URL` from `backend/.env`; the tables are in the schemas `core`, `mst`, `qms`, `intg`,
`sync` and `audit`.

**Demo accounts for testing** (never in production): `npm run demo-users` creates one account per role
(`DEMO-INSP`, `DEMO-INCH`, `DEMO-IQCHEAD`, `DEMO-SCM`, `DEMO-SCMSUB`, … `DEMO-CQA`, `DEMO-OPSHEAD`,
`DEMO-AUDIT`), plant-scoped roles on plant 1115, all with one password that is printed once (or taken
from `DEMO_PASSWORD`). Running it again resets them.

**AI (optional):** set `ANTHROPIC_API_KEY` (and `ANTHROPIC_MODEL`) in `backend/.env` for the AI
features. Without a key the app runs normally; the quality insights do not need AI. For a trial on
demo data only, `npm run puter-login` signs in to Puter and uses Claude through it instead
(see `AI_PROVIDER` in `backend/.env.example`).

**Mail:** set the SMTP values in `backend/.env` and run `npm run check-mail` to test the login (it
sends nothing). While testing, `MAIL_REDIRECT_TO=<your address>` sends every notification to you,
with the intended recipient in the subject. The worker (`npm -w @qmas/backend run worker`) sends
queued mail every 30 seconds.

## Monitoring and logs

- **Administration → System Health** (permission *System monitoring*, System Admin by default):
  API and worker processes (each writes a heartbeat every 30 s), database response time, size and
  connections, mail queue with **Retry failed mails**, SAP sync, errors, disk and file storage, users
  online. Refreshes every 30 seconds.
- **Administration → Error Log:** server errors (500s and crashes), background job failures and
  crashes in users' browsers, grouped by kind with a count, the users affected, the reference number
  shown to the user, the stack trace and a 14-day chart. Resolve with a note; an error that comes
  back opens again by itself.
- **Crash screen:** if a page breaks, the user sees *Something went wrong* with **Reload**,
  **Report this problem** (a Help & Support ticket filled in with the error) and the reference.
- **Alerts** (checked by the API every 5 minutes, at most one per kind an hour) to users with the
  permission, in the bell and by mail: the worker stopped, 3+ mails failed in an hour, 10+ errors in
  15 minutes. While the worker is stopped only the bell notice arrives (the worker sends mail).
- **Log files:** `backend/logs/api-YYYY-MM-DD.log` and `worker-YYYY-MM-DD.log`, one JSON line per
  event, kept 14 days (`LOG_TO_FILE`, `LOG_DIR`, `LOG_FILE_DAYS`); passwords, tokens and cookies are
  never written. In AWS set `LOG_TO_FILE=false` (CloudWatch collects stdout).
- **Health checks** for load balancers: `GET /api/v1/health` (process up) and `GET /api/v1/ready`
  (database answers).

## Tests

```bash
npm test
```

Starts a throwaway PostgreSQL 17, applies the real migrations, and runs unit tests (shared rules)
and API tests through the full HTTP stack: auth and lockout, token rotation and theft detection,
permissions and plant scope, users, masters, sampling, numbering under concurrency, audit trail,
migration integrity, formats and merges, IMIR inspection and offline sync, and the review /
deviation / escalation workflow including its timers, DN / CAPA, notifications and the mail
outbox, PDFs and reports, the SAP sync monitor, roles and the per-feature permissions, the format
builder, format import with on-screen correction, closing of stale empty drafts, help & support
tickets (privacy, internal notes, status rules, attachments), and monitoring (health, error log
grouping and reopening, mail retry, alerts, log file rotation).

The web app has its own unit tests (`npm -w @qmas/frontend test`): the offline sheet model, the
inspector-view preview (readings judged like a real lot), crash reporting, and the guided tours
(every tour step points at an element that exists, the right tour per page and role).

## Configuration

All settings come from environment variables (see `backend/.env.example`); nothing secret is in
the code. In AWS they come from the ECS task definition and AWS Secrets Manager.

Mail: with `MAIL_TRANSPORT=log` (default) notifications are queued and logged but nothing is sent,
which suits development. Set `MAIL_TRANSPORT=smtp` with the SES SMTP endpoint (`SMTP_HOST`,
`SMTP_USER`, `SMTP_PASS` from Secrets Manager), `MAIL_FROM` and `APP_BASE_URL` (used in mail links)
to send real mail. Mail is sent by the worker; users need an e-mail address on their account.

## Deployment (AWS, Mumbai)

One image (`Dockerfile`) serves the API and the built web app. Run `node backend/scripts/migrate.js`
with the same image as a one-off task before each release, then roll the service. Target setup:
CloudFront + WAF → ALB → ECS Fargate (API, later a worker) → RDS PostgreSQL Multi-AZ; S3 for
files; SES for mail; site-to-site VPN to SAP. Set `DB_SSL=true`, `COOKIE_SECURE=true`,
`TRUST_PROXY=2` behind CloudFront + ALB.
