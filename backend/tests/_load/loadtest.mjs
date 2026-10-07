// TEMPORARY capacity test (deleted after the run). Throwaway embedded PostgreSQL + a separate API
// process started from src/server.js; nothing touches the developer database or servers.
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '../..');
const OUT = process.env.LT_OUT;
const DAYS = Number(process.env.LT_DAYS ?? 90);
const LOTS_PER_DAY = 6000;
const USERS = 500;
const results = { machine: { cpu: os.cpus()[0].model, cores: os.cpus().length, ramGb: Math.round(os.totalmem() / 2 ** 30), node: process.version } };
const save = () => writeFileSync(OUT, JSON.stringify(results, null, 2));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const ms = (t0) => Math.round(performance.now() - t0);

const freePort = () => new Promise((res, rej) => { const s = createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

const dir = path.join(BACKEND, `.pgtest-load-${process.pid}`);
const pgPort = await freePort();
const pgPass = randomBytes(12).toString('hex');
const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'qmas', password: pgPass, port: pgPort, persistent: false, onLog: () => {}, initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-c', 'shared_buffers=512MB', '-c', 'max_connections=200', '-c', 'work_mem=16MB'] });
const DB_URL = `postgres://qmas:${pgPass}@localhost:${pgPort}/qmas_load`;
const stopAll = [];
const cleanup = async () => {
  for (const f of stopAll) { try { f(); } catch {} }
  try { await pool?.end(); } catch {}
  try { await pg.stop(); } catch {}
  rmSync(dir, { recursive: true, force: true });
};
process.on('SIGINT', async () => { await cleanup(); process.exit(1); });

let pool;
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('qmas_load');
  process.env.SAP_MODE = 'mock';
  process.env.NODE_ENV = 'test';
  process.env.LOG_TO_FILE = 'false';
  const { setEnv, loadEnv } = await import('../../src/config/env.js');
  setEnv(loadEnv({ NODE_ENV: 'test', DATABASE_URL: DB_URL, JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'), COOKIE_SECURE: 'false', LOG_LEVEL: 'silent' }));
  const { createPool, initPool } = await import('../../src/db/pool.js');
  const { runMigrations } = await import('../../src/db/migrate.js');
  const { seedReferenceData } = await import('../../src/db/seed.js');
  const { hashPassword } = await import('../../src/modules/auth/password.js');
  const mig = createPool({ connectionString: DB_URL, max: 2 });
  await runMigrations(mig); await seedReferenceData(mig); await mig.end();
  pool = initPool({ connectionString: DB_URL, max: 10 });
  const q = (sql, args) => pool.query(sql, args);
  log('db ready');

  // ── Users: 500, realistic role mix over 7 plants ──
  const password = `Lt${randomBytes(6).toString('hex')}9`;
  const hash = await hashPassword(password);
  const plants = (await q('SELECT id, sap_code FROM core.plant ORDER BY id')).rows;
  const perPlant = [['IQC_INSPECTOR', 40], ['IQC_INCHARGE', 8], ['IQC_HEAD', 2], ['SCM_REQUESTOR', 6], ['SCM_SUB_HEAD', 2], ['SCM_HEAD', 1], ['VD_REQUESTOR', 4], ['PLANT_HEAD', 1], ['PLANT_QA_HEAD', 1]];
  const global = [['VD_SUB_HEAD', 4], ['VD_HEAD', 2], ['CQA_HEAD', 2], ['PDC_HEAD', 2], ['CENTRAL_OPS_HEAD', 2], ['SYSTEM_ADMIN', 5]];
  const users = [];
  let n = 0;
  const addUser = async (role, plantId) => {
    const code = `LT${String(++n).padStart(4, '0')}`;
    const { rows } = await q('INSERT INTO core.app_user (employee_code, full_name, password_hash, must_change_password) VALUES ($1, $2, $3, false) RETURNING id', [code, `Load ${code}`, hash]);
    await q('INSERT INTO core.user_role (user_id, role_code, plant_id) VALUES ($1, $2, $3)', [rows[0].id, role, plantId]);
    users.push({ id: rows[0].id, code, role, plantId });
  };
  for (const p of plants) for (const [r, c] of perPlant) for (let i = 0; i < c; i++) await addUser(r, p.id);
  for (const [r, c] of global) for (let i = 0; i < c; i++) await addUser(r, null);
  while (users.length < USERS) await addUser('AUDITOR', null);
  log('users', users.length);

  // ── API process (as shipped: DB_POOL_MAX default 10, one process) ──
  const POOL_MAX = process.env.LT_POOL_MAX ?? '10';
  const servers = [];
  const startServer = async () => {
  const apiPort = await freePort();
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: BACKEND, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'development', PORT: String(apiPort), DATABASE_URL: DB_URL, DB_POOL_MAX: POOL_MAX,
      JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'), COOKIE_SECURE: 'false', TRUST_PROXY: '1', LOG_LEVEL: 'info', LOG_TO_FILE: 'false', SAP_MODE: 'mock', SAP_BATCH_SIZE: '6000' },
  });
  server.stdout.on('data', (b) => { stdoutBytes += b.length; });
  server.stderr.on('data', (b) => { serverErr += b; });
  const base = `http://127.0.0.1:${apiPort}/api/v1`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 300)); }
  servers.push({ proc: server, base });
  stopAll.push(() => server.kill());
  log('api up', apiPort);
  };
  let stdoutBytes = 0;
  let serverErr = '';
  await startServer();
  const BASE = servers[0].base;

  // Minimal cookie-keeping client per user. X-Forwarded-For gives each user its own office IP.
  const session = (u, ip) => {
    const jar = new Map();
    const call = async (method, url, body, base = BASE) => {
      const t0 = performance.now();
      const res = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined });
      for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      return { status: res.status, json, ms: performance.now() - t0, bytes: text.length };
    };
    // Like the web app: on 401 refresh the access token once and retry.
    const callR = async (method, url, body, base) => {
      const r = await call(method, url, body, base);
      if (r.status !== 401 || url.startsWith('/auth/')) return r;
      const t0 = performance.now();
      await call('POST', '/auth/refresh', undefined, base);
      const again = await call(method, url, body, base);
      return { ...again, ms: r.ms + (performance.now() - t0) };
    };
    return { u, ip, call: callR };
  };
  const ipOf = (i) => `10.${20 + (i >> 16)}.${(i >> 8) & 255}.${i & 255}`;

  // ── Formats for 40 items (3 more without a format → lots wait for one) ──
  const head = session(users.find((u) => u.role === 'IQC_HEAD'), '10.9.9.9');
  if ((await head.call('POST', '/auth/login', { employeeCode: head.u.code, password })).status !== 200) throw new Error('head login failed');
  const DIM = { section: 'DIMENSIONAL', checkpoint: 'Dia', specification: '10 ± 0.1', nominal: 10, lsl: 9.9, usl: 10.1, uom: 'mm', instrument: 'DVC' };
  const VIS = { section: 'VISUAL', checkpoint: 'Aesthetic', specification: 'No burr', instrument: 'Visual' };
  const items = [];
  for (let i = 0; i < 43; i++) {
    const code = `LTITEM${String(i).padStart(3, '0')}`;
    items.push(code);
    if (i >= 40) continue;
    const { rows } = await q("INSERT INTO mst.item (item_code, description) VALUES ($1, 'Load test part') RETURNING id", [code]);
    const d = (await head.call('POST', `/formats/items/${rows[0].id}/drafts`, { from: 'BLANK' })).json.data;
    const cps = [DIM, { ...DIM, checkpoint: 'Length', nominal: 50, lsl: 49.8, usl: 50.2, specification: '50 ± 0.2' }, { ...DIM, checkpoint: 'Thk', nominal: 2, lsl: 1.9, usl: 2.1, specification: '2 ± 0.1' }, VIS, { ...VIS, checkpoint: 'Rust' }];
    const s = (await head.call('PUT', `/formats/versions/${d.id}`, { checkpoints: cps, rowVersion: d.rowVersion, refStandard: 'IS 2500' })).json.data;
    const p = (await head.call('POST', `/formats/versions/${s.id}/actions`, { action: 'submit', rowVersion: s.rowVersion })).json.data.version;
    const a = await head.call('POST', `/formats/versions/${p.id}/actions`, { action: 'approve', rowVersion: p.rowVersion });
    if (a.status !== 200) throw new Error(`format approve failed ${JSON.stringify(a.json)}`);
  }
  log('formats ready');

  // ── SAP: one day's volume (6,000 lots) in a single pull, measured ──
  const vendorCount = 300;
  await q(`INSERT INTO intg.sap_mock_lot (sap_lot_no, payload)
           SELECT '89' || lpad(g::text, 10, '0'), jsonb_build_object(
             'plantSapCode', (ARRAY[${plants.map((p) => `'${p.sap_code}'`).join(',')}])[1 + g % ${plants.length}],
             'itemCode', 'LTITEM' || lpad((g % 43)::text, 3, '0'), 'itemDescription', 'Load test part', 'itemCategory', 'Sheet Metal', 'uom', 'nos',
             'vendorCode', 'LTV' || lpad((g % ${vendorCount})::text, 4, '0'), 'vendorName', 'Load vendor ' || (g % ${vendorCount}),
             'grnNo', 'GRN' || g, 'grnDate', current_date::text, 'invoiceNo', 'INV' || g, 'inwardQty', 40 + (g % 900))
           FROM generate_series(1, ${LOTS_PER_DAY}) g`);
  process.env.SAP_BATCH_SIZE = String(LOTS_PER_DAY);
  const { runSapSync } = await import('../../src/modules/integration/sapSync.service.js');
  let t0 = performance.now();
  const sync = await runSapSync({});
  const syncMs = ms(t0);
  results.sapIngest = { lots: sync.fetched, created: sync.createdLots, opened: sync.openedImirs, errors: sync.errors.length, totalMs: syncMs, perLotMs: +(syncMs / sync.fetched).toFixed(2), lotsPerSecond: +(sync.fetched / (syncMs / 1000)).toFixed(1) };
  log('sap ingest', results.sapIngest);

  // The API adapter asks again from the last inspection date, so lots already pulled come back:
  // each costs a SELECT + UPDATE transaction. Measured for 6,000 seen lots.
  const { withTransaction } = await import('../../src/db/tx.js');
  const lotNos = (await q('SELECT sap_lot_no FROM intg.sap_inspection_lot')).rows.map((r) => r.sap_lot_no);
  t0 = performance.now();
  for (const no of lotNos) {
    await withTransaction({}, async (db) => {
      const { rows } = await db.query('SELECT id FROM intg.sap_inspection_lot WHERE sap_lot_no = $1', [no]);
      await db.query('UPDATE intg.sap_inspection_lot SET last_seen_at = now() WHERE id = $1', [rows[0].id]);
    });
  }
  results.sapReseen = { lots: lotNos.length, totalMs: ms(t0) };
  const auditPerLot = (await q("SELECT count(*)::int AS n, pg_total_relation_size('audit.audit_log')::bigint AS b FROM audit.audit_log")).rows[0];
  results.auditAfterIngest = { rows: auditPerLot.n, bytes: Number(auditPerLot.b) };
  save();

  // ── History: DAYS-1 earlier days of closed lots (bulk copy, triggers off) + notifications ──
  t0 = performance.now();
  const c2 = async (fn) => { const x = await pool.connect(); try { await fn(x); } finally { x.release(); } };
  const c = await pool.connect();
  try {
    await c.query('SET session_replication_role = replica');
    await c.query('SET statement_timeout = 0');
    await c.query(`INSERT INTO intg.sap_inspection_lot (sap_lot_no, plant_sap_code, grn_no, grn_date, invoice_no, vendor_code, vendor_name, item_code, item_description, item_category, uom, inward_qty, payload, first_seen_at, last_seen_at)
                   SELECT 'H' || d || '-' || l.sap_lot_no, l.plant_sap_code, l.grn_no, l.grn_date - d, l.invoice_no, l.vendor_code, l.vendor_name, l.item_code, l.item_description, l.item_category, l.uom, l.inward_qty, l.payload,
                          l.first_seen_at - make_interval(days => d), l.last_seen_at - make_interval(days => d)
                     FROM intg.sap_inspection_lot l CROSS JOIN generate_series(1, ${DAYS - 1}) d`);
    await c.query(`INSERT INTO qms.imir (imir_no, sap_lot_id, plant_id, item_id, vendor_id, grn_no, grn_date, invoice_no, inward_qty, uom, status, format_version_id, sampling_plan_id, lot_size, sample_size, accept_no, reject_no,
                                         sampling_basis, result, opened_at, inspection_started_at, submitted_at, inspected_by, submitted_by, created_at, updated_at)
                   SELECT m.imir_no || '-H' || d, h.id, m.plant_id, m.item_id, m.vendor_id, m.grn_no, m.grn_date - d, m.invoice_no, m.inward_qty, m.uom,
                          CASE WHEN r < 0.90 THEN 'CLOSED_ACCEPTED' WHEN r < 0.96 THEN 'CLOSED_REJECTED' ELSE 'CLOSED_UNDER_DEVIATION' END,
                          m.format_version_id, m.sampling_plan_id, m.lot_size, m.sample_size, m.accept_no, m.reject_no, m.sampling_basis,
                          CASE WHEN r < 0.90 THEN 'OK' ELSE 'NOK' END, ts, ts + interval '1 hour', ts + interval '2 hours', $1::uuid, $1::uuid, ts, ts + interval '6 hours'
                     FROM qms.imir m JOIN intg.sap_inspection_lot l ON l.id = m.sap_lot_id CROSS JOIN generate_series(1, ${DAYS - 1}) d
                     JOIN intg.sap_inspection_lot h ON h.sap_lot_no = 'H' || d || '-' || l.sap_lot_no
                     CROSS JOIN LATERAL (SELECT random() AS r, m.created_at - make_interval(days => d) AS ts) x
                    WHERE m.status <> 'AWAITING_FORMAT'`, [users[0].id]);
    await c.query(`INSERT INTO qms.imir_action (imir_id, action, from_status, to_status, actor_id, acting_role, at)
                   SELECT m.id, a.action, a.f, a.t, $1::uuid, 'IQC_INSPECTOR', m.created_at + a.off
                     FROM qms.imir m CROSS JOIN (VALUES ('START', 'OPEN', 'IN_INSPECTION', interval '1 hour'), ('SUBMIT', 'IN_INSPECTION', 'SUBMITTED', interval '2 hours'),
                                                        ('APPROVE', 'SUBMITTED', 'CLOSED_ACCEPTED', interval '6 hours')) a(action, f, t, off)
                    WHERE m.imir_no LIKE '%-H%'`, [users[0].id]);
    await c.query(`INSERT INTO core.notification (user_id, kind, title, body, link, created_at, read_at)
                   SELECT u.id, 'INFO', 'Lot waiting', 'Load test notification', '/imirs', now() - make_interval(mins => g * 37), CASE WHEN g > 5 THEN now() END
                     FROM core.app_user u CROSS JOIN generate_series(1, 200) g WHERE u.employee_code LIKE 'LT%'`);
    await c.query('SET session_replication_role = origin');
  } finally { c.release(); }
  await c2(async (x) => { await x.query('SET statement_timeout = 0'); await x.query('VACUUM ANALYZE'); });
  const sizes = (await q(`SELECT (SELECT count(*) FROM qms.imir)::int AS imirs, (SELECT count(*) FROM qms.imir_action)::int AS actions,
                                 (SELECT count(*) FROM qms.imir WHERE status IN ('OPEN','IN_INSPECTION'))::int AS open_lots,
                                 pg_database_size(current_database())::bigint AS db_bytes,
                                 pg_total_relation_size('qms.imir')::bigint AS imir_bytes, pg_total_relation_size('intg.sap_inspection_lot')::bigint AS sap_bytes,
                                 pg_total_relation_size('qms.imir_action')::bigint AS action_bytes`)).rows[0];
  results.dataset = { days: DAYS, buildMs: ms(t0), ...Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, Number(v)])) };
  log('dataset', results.dataset);
  save();

  // ── Query plans of the hot queries at this volume ──
  const explain = async (name, sql, args = []) => {
    const { rows } = await q(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, args);
    const plan = rows[0]['QUERY PLAN'][0];
    const nodes = [];
    const walk = (p) => { if (/Seq Scan/.test(p['Node Type'])) nodes.push(`${p['Node Type']} on ${p['Relation Name']} (${p['Actual Rows']} rows)`); (p.Plans ?? []).forEach(walk); };
    walk(plan.Plan);
    results.plans ??= {};
    results.plans[name] = { ms: +plan['Execution Time'].toFixed(1), seqScans: nodes };
  };
  await explain('dashboard trend 30d (all plants)', `SELECT d::date AS day, count(m.id) FROM generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date - 29, (now() AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day') d
      LEFT JOIN qms.imir m ON (m.created_at AT TIME ZONE 'Asia/Kolkata')::date = d::date AND true GROUP BY d`);
  await explain('dashboard trend 30d NEW (all plants)', `SELECT (m.created_at AT TIME ZONE 'Asia/Kolkata')::date, count(*) FROM qms.imir m
      WHERE m.created_at >= (((now() AT TIME ZONE 'Asia/Kolkata')::date - 29)::timestamp AT TIME ZONE 'Asia/Kolkata') GROUP BY 1`);
  await explain('imir list page NEW (all plants)', `SELECT m.id, count(*) OVER () FROM qms.imir m ORDER BY m.created_at DESC NULLS LAST, m.id LIMIT 25`);
  await explain('dashboard ageing (all plants)', `SELECT m.status, count(*) FROM (SELECT m.status, extract(epoch FROM now() - coalesce((SELECT max(at) FROM qms.imir_action a WHERE a.imir_id = m.id), m.created_at)) AS age
      FROM qms.imir m WHERE m.status NOT LIKE 'CLOSED%' AND m.status <> 'AUTO_CLOSED') m GROUP BY m.status`);
  await explain('dashboard vendor 365d (all plants)', `SELECT v.vendor_code, count(*) FILTER (WHERE m.result = 'NOK') FROM qms.imir m JOIN mst.vendor v ON v.id = m.vendor_id
      WHERE m.created_at >= now() - interval '365 days' GROUP BY v.id`);
  await explain('tasks/me inspect lots', `SELECT m.id, (SELECT a.action FROM qms.imir_action a WHERE a.imir_id = m.id ORDER BY a.at DESC, a.id DESC LIMIT 1)
      FROM qms.imir m WHERE m.status IN ('OPEN', 'IN_INSPECTION') ORDER BY m.created_at LIMIT 1000`);
  save();

  // ── Sign-in: 500 users, distinct office IPs; then 40 from ONE IP (one NAT address) ──
  const sessions = users.map((u, i) => session(u, ipOf(i + 1)));
  t0 = performance.now();
  const loginMs = [];
  let loginFail = 0;
  for (let i = 0; i < sessions.length; i += 25) {
    await Promise.all(sessions.slice(i, i + 25).map(async (s) => { const r = await s.call('POST', '/auth/login', { employeeCode: s.u.code, password }); loginMs.push(r.ms); if (r.status !== 200) loginFail++; }));
  }
  results.login = { users: sessions.length, totalMs: ms(t0), fail: loginFail, ...pct(loginMs) };
  log('logins', results.login);
  const nat = [];
  for (let i = 0; i < 40; i++) {
    const s = session(users[i], '10.200.0.1');
    nat.push((await s.call('POST', '/auth/login', { employeeCode: users[i].code, password })).status);
  }
  results.natLogin = { attempts: 40, ok: nat.filter((x) => x === 200).length, tooMany: nat.filter((x) => x === 429).length };
  // Those 40 sign-ins ended the first sessions of users 0-39 (one session per user): sign them in again.
  for (const s of sessions.slice(0, 40)) await s.call('POST', '/auth/login', { employeeCode: s.u.code, password });
  log('nat', results.natLogin);
  save();

  // ── Mixed workload, open loop: what the web app sends for N users on screen ──
  const idsBy = async (where) => {
    const { rows } = await q(`SELECT id, plant_id FROM (SELECT id, plant_id, row_number() OVER (PARTITION BY plant_id ORDER BY random()) AS k FROM qms.imir WHERE ${where}) x WHERE k <= 60`);
    const m = new Map();
    for (const r of rows) { if (!m.has(r.plant_id)) m.set(r.plant_id, []); m.get(r.plant_id).push(r.id); }
    m.set(null, rows.map((r) => r.id));
    return m;
  };
  const openIds = await idsBy("status IN ('OPEN','IN_INSPECTION')");
  const histIds = await idsBy("imir_no LIKE '%-H%'");
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  // Weights follow the polling in the web app (Home: tasks 60 s, bell 60 s, 4 dashboard calls + recent
  // + lots tab every 120 s; list pages: list + counts + tasks every 60 s) plus page views.
  const MIX = [
    ['tasks/me', 20, () => ['GET', '/tasks/me']],
    ['notifications', 15, () => ['GET', '/notifications']],
    ['dashboard', 18, () => ['GET', pick(['/dashboard/summary', '/dashboard/summary?trendDays=30', '/dashboard/summary?glanceDays=30', '/dashboard/summary?vendorDays=90', '/dashboard/summary?vendorDays=365'])]],
    ['tasks/recent', 5, () => ['GET', '/tasks/recent']],
    ['imir list', 12, () => ['GET', pick(['/imirs?page=1&pageSize=25&sort=createdAt&order=desc', '/imirs?page=1&pageSize=25&statusGroup=TO_INSPECT', '/imirs?page=1&pageSize=25&q=LTITEM01'])]],
    ['imir counts', 8, () => ['GET', '/imirs/counts']],
    ['imir detail', 10, (s) => ['GET', `/imirs/${pick((Math.random() < 0.6 ? openIds : histIds).get(s.u.plantId ?? null))}`]],
    ['deviation list', 4, () => ['GET', '/deviations?page=1&pageSize=25']],
    ['dn list', 3, () => ['GET', '/dns?page=1&pageSize=25']],
    ['network status', 2, () => ['GET', '/network/status']],
    ['report', 1, () => ['GET', '/reports/imir-register?page=1&pageSize=50']],
    ['mark read', 2, () => ['POST', '/notifications/read-all']],
  ];
  const totalW = MIX.reduce((a, m) => a + m[1], 0);
  const choose = () => { let r = Math.random() * totalW; for (const m of MIX) { if ((r -= m[1]) < 0) return m; } return MIX[0]; };

  const serverStats = () => {
    try {
      const ids = servers.map((x) => x.proc.pid).join(',');
      const out = execFileSync('powershell', ['-NoProfile', '-Command', `$p = Get-Process -Id ${ids}; "$(($p | Measure-Object WorkingSet64 -Sum).Sum) $(($p | ForEach-Object { $_.TotalProcessorTime.TotalMilliseconds } | Measure-Object -Sum).Sum)"`], { encoding: 'utf8' }).trim().split(' ');
      return { rss: Number(out[0]), cpuMs: Number(out[1]) };
    } catch { return null; }
  };

  // 8 requests per user per minute on average (from the polling model above).
  const PER_USER_PER_MIN = 8;
  async function phase(name, usersOnline, seconds) {
    const rate = (usersOnline * PER_USER_PER_MIN) / 60;
    const lat = {}; const bytes = {}; const codes = {}; let inflight = 0; let maxInflight = 0; let sent = 0; let done = 0; let netErr = 0;
    const samples = [];
    const s0 = serverStats(); const w0 = performance.now();
    const sampler = setInterval(async () => {
      const st = serverStats();
      const db = (await q("SELECT count(*) FILTER (WHERE state = 'active')::int AS active, count(*)::int AS total FROM pg_stat_activity WHERE datname = current_database()")).rows[0];
      samples.push({ t: ms(w0), rss: st?.rss, cpuMs: st?.cpuMs, inflight, dbActive: db.active, dbConns: db.total });
    }, 10000);
    const fire = async () => {
      const [label, , make] = choose();
      const s = sessions[Math.floor(Math.random() * sessions.length)];
      const [method, url] = make(s);
      inflight++; maxInflight = Math.max(maxInflight, inflight); sent++;
      try {
        const r = await s.call(method, url, undefined, servers[Math.floor(Math.random() * servers.length)].base);
        if (r.status < 300) { (lat[label] ??= []).push(r.ms); (bytes[label] ??= []).push(r.bytes); }
        codes[r.status] = (codes[r.status] ?? 0) + 1;
        if (r.status >= 500) (results.serverErrors ??= []).length < 20 && results.serverErrors.push({ url, status: r.status, body: r.json?.message });
        if (r.status >= 400) (codes[`${r.status} ${label}`] = (codes[`${r.status} ${label}`] ?? 0) + 1);
      } catch { netErr++; } finally { inflight--; done++; }
    };
    const pending = new Set();
    const end = performance.now() + seconds * 1000;
    let next = performance.now();
    while (performance.now() < end) {
      next += -Math.log(1 - Math.random()) * (1000 / rate); // Poisson arrivals
      const wait = next - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const p = fire(); pending.add(p); p.finally(() => pending.delete(p));
    }
    await Promise.all(pending);
    clearInterval(sampler);
    const s1 = serverStats(); const wall = performance.now() - w0;
    const all = Object.values(lat).flat();
    const r = {
      usersOnline, targetRps: +rate.toFixed(1), achievedRps: +(done / (wall / 1000)).toFixed(1), seconds, requests: done, netErr, maxInflight, codes,
      processes: servers.length, overall: pct(all), byEndpoint: Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, { ...pct(v), avgKb: +(bytes[k].reduce((a, b) => a + b, 0) / bytes[k].length / 1024).toFixed(1) }])),
      serverCpuPct: s0 && s1 ? +((100 * (s1.cpuMs - s0.cpuMs)) / wall).toFixed(0) : null, // % of ONE core
      rssStartMb: s0 ? Math.round(s0.rss / 2 ** 20) : null, rssEndMb: s1 ? Math.round(s1.rss / 2 ** 20) : null,
      maxDbActive: Math.max(...samples.map((x) => x.dbActive)), samples,
    };
    (results.phases ??= {})[name] = r;
    log(name, { users: usersOnline, rps: r.achievedRps, p50: r.overall.p50, p95: r.overall.p95, p99: r.overall.p99, cpu: r.serverCpuPct, rss: r.rssEndMb, codes });
    save();
  }

  const SECS = Number(process.env.LT_SECS ?? 90);
  await phase('warmup', 100, 20);
  await phase('250 users', 250, SECS);
  await phase('500 users', 500, SECS);
  await phase('1000 users (2x)', 1000, SECS);
  await phase('1500 users (3x)', 1500, SECS);
  if (process.env.LT_SOAK) await phase('soak 500 users', 500, Number(process.env.LT_SOAK));
  if (process.env.LT_TWO) {
    await startServer();
    await phase('2 processes: 500 users', 500, SECS);
    await phase('2 processes: 1000 users', 1000, SECS);
    await phase('2 processes: 1500 users', 1500, SECS);
  }
  results.serverStdoutMb = +(stdoutBytes / 2 ** 20).toFixed(1);
  results.serverStderr = serverErr.slice(0, 2000);
  save();
  log('done');
} catch (err) {
  results.fatal = String(err.stack ?? err);
  save();
  console.error(err);
} finally {
  await cleanup();
}

function pct(a) {
  if (!a.length) return { n: 0 };
  const s = [...a].sort((x, y) => x - y);
  const at = (p) => Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
  return { n: s.length, p50: at(50), p95: at(95), p99: at(99), max: Math.round(s.at(-1)) };
}
