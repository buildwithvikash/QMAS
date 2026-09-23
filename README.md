# QMAS — Incoming Material Inspection & Defect Notification

Digitises the IQC lifecycle across the Western Refrigeration plants: SAP inward lot → inspection
format → IMIR on tablets (offline capable) → review → deviation (SCM / VD) → senior escalation →
closure, plus Defect Notification with CAPA.

The design (requirements, decisions, workflow, database, API) is in [docs/design-rev4.html](docs/design-rev4.html).

## Status

| Sprint | Scope | State |
|---|---|---|
| **A — Foundation** | Auth (own accounts, lockout, rotating refresh tokens), roles & plant-scoped permissions, users, masters (plants, vendors, items, categories, UOM, instruments), sampling table, configurable numbering, audit trail, logging, migrations, web app shell | **Done** |
| **B — Inspection formats** | One format per item; drafts from current version / SAN-SIR (mock) / copy / blank; Git-style versioning (fast-forward, three-way merge, conflict resolution, replace for unrelated first drafts); approval queue by submission time; version history and compare; Excel bulk import with template | **Done** |
| **C — IMIR & inspection** | SAP QA32 adapter (mock) with scheduled pull and retry; IMIR opening (number, pinned format, sampling, reliability due per item + vendor); inspection sheet with server-side OK/NOK, photos/PDFs per visual sample; tablets: registration, checkout locks, replay-safe offline sync, installable offline web app | **Done** (Capacitor Android packaging pending) |
| **D — Review & deviation** | Incharge review (approve passed lots / send back / escalate, checkpoint remarks); IQC Head approve or hold → deviation for SCM or VD; Deviation Form with revisions; configurable department approval chain (Sub-Head, optionally Head); IQC Head final decision bound by the senior outcome; parallel senior escalation (highest rank wins, CQA waits for PDC, 24 h Operations Head timeout adds CQA, CQA / Central Ops / Admin override, append-only decisions); OK / Not-OK quantities with 14-day auto-close; workflow history; My Tasks inbox | **Done** |
| E | DN/CAPA, reports, notifications | |

## Layout

```
packages/shared   constants, zod schemas, pure rules (numbering, sampling) — used by API and web app
backend           Express 5 API · routes → services → SQL · PostgreSQL migrations · tests
frontend          React 19 + Vite + Tailwind 4 + RTK Query, WRL Tool Report look and feel
docs              design document
```

## Local development (Windows, no Docker or PostgreSQL install needed)

```bash
npm install
npm run db:dev            # starts PostgreSQL 17 from node_modules, migrates, prints DATABASE_URL
```

Copy `backend/.env.example` to `backend/.env`, paste the printed `DATABASE_URL`, set a random
`JWT_ACCESS_SECRET` (the example file shows a one-liner) and `COOKIE_SECURE=false`. Then:

```bash
npm run create-admin -- --employee-code ADMIN01 --name "System Administrator"
npm run dev:api           # http://localhost:4000
npm run dev:web           # http://localhost:5173 (proxies /api)
npm -w @qmas/backend run worker   # optional: SAP pull every SAP_SYNC_INTERVAL_MIN, deviation timers every 5 min
```

`create-admin` asks for a temporary password; the admin must change it at first sign-in.

## Tests

```bash
npm test
```

Starts a throwaway PostgreSQL 17, applies the real migrations, and runs unit tests (shared rules)
and API tests through the full HTTP stack: auth and lockout, token rotation and theft detection,
permissions and plant scope, users, masters, sampling, numbering under concurrency, audit trail,
migration integrity, formats and merges, IMIR inspection and offline sync, and the review /
deviation / escalation workflow including its timers.

## Configuration

All settings come from environment variables (see `backend/.env.example`); nothing secret is in
the code. In AWS they come from the ECS task definition and AWS Secrets Manager.

## Deployment (AWS, Mumbai)

One image (`Dockerfile`) serves the API and the built web app. Run `node backend/scripts/migrate.js`
with the same image as a one-off task before each release, then roll the service. Target setup:
CloudFront + WAF → ALB → ECS Fargate (API, later a worker) → RDS PostgreSQL Multi-AZ; S3 for
files; SES for mail; site-to-site VPN to SAP. Set `DB_SSL=true`, `COOKIE_SECURE=true`,
`TRUST_PROXY=2` behind CloudFront + ALB.
