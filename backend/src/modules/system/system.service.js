import { PERMISSIONS } from '@qmas/shared';
import { readdir, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../shared/AppError.js';
import { camelRow, camelRows, likeContains, offsetOf, pageMeta } from '../../shared/sql.js';
import { summary as sapSummary } from '../integration/syncMonitor.service.js';
import { notifyUsers } from '../notifications/notify.js';
import { APP_VERSION } from './errorLog.js';
import { BEAT_STALE_SEC } from './heartbeat.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const uploadRoot = () => path.resolve(process.env.UPLOAD_DIR || path.resolve(HERE, '../../../uploads'));
const logRoot = () => path.resolve(process.env.LOG_DIR || path.resolve(HERE, '../../../logs'));

/** Total size and file count under a folder (stops after 50 000 files; missing folder = 0). */
async function folderSize(dir, limit = 50_000) {
  let bytes = 0;
  let files = 0;
  const walk = async (d) => {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files >= limit) return;
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        try {
          bytes += (await stat(full)).size;
          files += 1;
        } catch {
          /* removed meanwhile */
        }
      }
    }
  };
  await walk(dir);
  return { bytes, files, capped: files >= limit };
}

async function diskFree(dir) {
  try {
    const s = await statfs(dir);
    return { freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) };
  } catch {
    return null;
  }
}

/**
 * Everything System Health shows: API and worker processes, database, mail queue, SAP sync,
 * errors, storage and sessions, with an overall state and the problems behind it.
 */
export async function health() {
  const pool = getPool();
  const problems = [];
  const t0 = process.hrtime.bigint();
  await pool.query('SELECT 1');
  const dbLatencyMs = Number(process.hrtime.bigint() - t0) / 1e6;

  const [{ rows: db }, { rows: beats }, { rows: mail }, { rows: errs }, { rows: sessions }] = await Promise.all([
    pool.query(`SELECT pg_database_size(current_database()) AS size_bytes, split_part(version(), ',', 1) AS version,
                       (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS connections,
                       current_setting('max_connections')::int AS max_connections`),
    pool.query(`SELECT component, kind, host, pid, version, started_at, last_beat, info,
                       (info ? 'stoppedAt') AS stopped, extract(epoch FROM now() - last_beat)::int AS age_sec
                  FROM core.service_heartbeat ORDER BY kind, last_beat DESC`),
    pool.query(`SELECT count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
                       count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
                       count(*) FILTER (WHERE status = 'SENT' AND sent_at > now() - interval '24 hours')::int AS sent24h,
                       count(*) FILTER (WHERE status = 'FAILED' AND created_at > now() - interval '24 hours')::int AS failed24h,
                       extract(epoch FROM now() - min(created_at) FILTER (WHERE status = 'PENDING'))::int AS oldest_pending_sec,
                       (SELECT last_error FROM core.mail_outbox WHERE last_error IS NOT NULL ORDER BY id DESC LIMIT 1) AS last_error
                  FROM core.mail_outbox`),
    pool.query(`SELECT (SELECT count(*)::int FROM core.error_log WHERE resolved_at IS NULL) AS open,
                       count(*) FILTER (WHERE e.at > now() - interval '1 hour')::int AS last_hour,
                       count(*)::int AS last24h,
                       count(*) FILTER (WHERE l.source = 'SERVER')::int AS server24h,
                       count(*) FILTER (WHERE l.source = 'WORKER')::int AS worker24h,
                       count(*) FILTER (WHERE l.source = 'CLIENT')::int AS client24h
                  FROM core.error_event e JOIN core.error_log l ON l.id = e.error_id
                 WHERE e.at > now() - interval '24 hours'`),
    pool.query(`SELECT count(*)::int AS active, count(DISTINCT user_id)::int AS users
                  FROM core.user_session WHERE ended_at IS NULL AND last_seen_at > now() - interval '30 minutes'`),
  ]);

  const processes = camelRows(beats).map((b) => ({ ...b, alive: !b.stopped && b.ageSec <= BEAT_STALE_SEC }));
  const workers = processes.filter((p) => p.kind === 'WORKER');
  const workerAlive = workers.some((w) => w.alive);
  if (!workerAlive) problems.push({ level: 'error', area: 'worker', text: workers.length ? 'The background worker has stopped: no SAP pulls, reminders or mail.' : 'The background worker is not running: no SAP pulls, reminders or mail.' });

  const m = camelRow(mail[0]);
  if (m.failed > 0) problems.push({ level: 'warning', area: 'mail', text: `${m.failed} mail${m.failed === 1 ? '' : 's'} could not be sent.` });
  if (workerAlive && m.oldestPendingSec > 30 * 60) problems.push({ level: 'warning', area: 'mail', text: 'Mail has been waiting to be sent for more than 30 minutes.' });

  let sap = null;
  try {
    sap = await sapSummary();
    if (sap.state === 'FAILING') problems.push({ level: 'error', area: 'sap', text: 'The last SAP pull failed.' });
    else if (sap.state === 'DELAYED') problems.push({ level: 'warning', area: 'sap', text: 'SAP pulls are late.' });
  } catch {
    sap = null;
  }

  const e = camelRow(errs[0]);
  if (e.lastHour >= 10) problems.push({ level: 'error', area: 'errors', text: `${e.lastHour} errors in the last hour.` });
  else if (e.open > 0) problems.push({ level: 'warning', area: 'errors', text: `${e.open} open error${e.open === 1 ? '' : 's'} in the error log.` });

  const d = camelRow(db[0]);
  if (dbLatencyMs > 500) problems.push({ level: 'warning', area: 'database', text: `The database answers slowly (${Math.round(dbLatencyMs)} ms).` });
  if (d.connections > d.maxConnections * 0.8) problems.push({ level: 'warning', area: 'database', text: 'The database is close to its connection limit.' });

  const [uploads, logs, disk] = await Promise.all([folderSize(uploadRoot()), folderSize(logRoot()), diskFree(uploadRoot()).then((x) => x ?? diskFree(process.cwd()))]);
  if (disk && disk.totalBytes && disk.freeBytes / disk.totalBytes < 0.1) problems.push({ level: 'warning', area: 'storage', text: 'Less than 10% disk space is free.' });

  const mem = process.memoryUsage();
  return {
    status: problems.some((p) => p.level === 'error') ? 'DOWN' : problems.length ? 'WARNING' : 'OK',
    checkedAt: new Date().toISOString(),
    problems,
    api: { version: APP_VERSION, node: process.version, env: process.env.NODE_ENV ?? 'development', uptimeSec: Math.round(process.uptime()), pid: process.pid, rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576) },
    processes,
    database: { ok: true, latencyMs: Math.round(dbLatencyMs * 10) / 10, sizeBytes: Number(d.sizeBytes), version: d.version, connections: d.connections, maxConnections: d.maxConnections },
    mail: { ...m, transport: process.env.MAIL_TRANSPORT || 'log' },
    sap: sap && { mode: sap.mode, state: sap.state, intervalMin: sap.intervalMin, lastAt: sap.last?.startedAt ?? null, lastStatus: sap.last?.status ?? null, last24h: sap.last24h },
    errors: e,
    storage: { uploads, logs, disk, uploadDir: uploadRoot(), logDir: logRoot() },
    sessions: camelRow(sessions[0]),
  };
}

const SORT = { lastSeen: 'l.last_seen', firstSeen: 'l.first_seen', occurrences: 'l.occurrences' };

export async function listErrors(q) {
  const where = [];
  const args = [];
  const add = (sql, v) => {
    args.push(v);
    where.push(sql.replaceAll('$?', `$${args.length}`));
  };
  if (q.status === 'open') where.push('l.resolved_at IS NULL');
  if (q.status === 'resolved') where.push('l.resolved_at IS NOT NULL');
  if (q.source) add('l.source = $?', q.source);
  if (q.q) add('(l.message ILIKE $? OR l.path ILIKE $? OR l.request_id ILIKE $?)', likeContains(q.q));
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pool = getPool();
  const { rows: n } = await pool.query(`SELECT count(*)::int AS n FROM core.error_log l ${filter}`, args);
  const { rows } = await pool.query(
    `SELECT l.id, l.source, l.message, l.method, l.path, l.status_code, l.request_id, l.occurrences, l.first_seen, l.last_seen,
            l.resolved_at, l.resolution, l.app_version, u.full_name AS user_name, u.employee_code AS user_code,
            (SELECT count(*)::int FROM core.error_event ev WHERE ev.error_id = l.id AND ev.at > now() - interval '24 hours') AS last24h,
            (SELECT count(DISTINCT ev.user_id)::int FROM core.error_event ev WHERE ev.error_id = l.id) AS users
       FROM core.error_log l LEFT JOIN core.app_user u ON u.id = l.user_id
       ${filter}
      ORDER BY ${SORT[q.sort] ?? SORT.lastSeen} ${q.order === 'asc' ? 'ASC' : 'DESC'}, l.id DESC
      LIMIT ${q.pageSize} OFFSET ${offsetOf(q)}`,
    args,
  );
  return { rows: camelRows(rows), meta: pageMeta(q, n[0].n) };
}

export async function errorDetail(id, pool = getPool()) {
  const { rows } = await pool.query(
    `SELECT l.*, u.full_name AS user_name, u.employee_code AS user_code, r.full_name AS resolved_by_name
       FROM core.error_log l LEFT JOIN core.app_user u ON u.id = l.user_id LEFT JOIN core.app_user r ON r.id = l.resolved_by
      WHERE l.id = $1`,
    [id],
  );
  if (!rows[0]) throw AppError.notFound('Error');
  const { rows: events } = await pool.query(
    `SELECT e.id, e.request_id, e.at, u.full_name AS user_name, u.employee_code AS user_code
       FROM core.error_event e LEFT JOIN core.app_user u ON u.id = e.user_id
      WHERE e.error_id = $1 ORDER BY e.at DESC LIMIT 50`,
    [id],
  );
  const { rows: daily } = await pool.query(
    `SELECT to_char(date_trunc('day', at), 'YYYY-MM-DD') AS day, count(*)::int AS n
       FROM core.error_event WHERE error_id = $1 AND at > now() - interval '14 days' GROUP BY 1 ORDER BY 1`,
    [id],
  );
  const e = camelRow(rows[0]);
  delete e.fingerprint;
  return { ...e, events: camelRows(events), daily: camelRows(daily) };
}

export async function setResolved(ctx, id, resolved, note) {
  return withTransaction(ctx, async (db) => {
    const { rowCount } = await db.query(
      resolved
        ? 'UPDATE core.error_log SET resolved_at = now(), resolved_by = $2, resolution = $3 WHERE id = $1'
        : 'UPDATE core.error_log SET resolved_at = NULL, resolved_by = NULL, resolution = NULL WHERE id = $1',
      resolved ? [id, ctx.userId, note ?? null] : [id],
    );
    if (!rowCount) throw AppError.notFound('Error');
    return errorDetail(id, db);
  });
}

/** Resolves every open error at once (e.g. after deploying a fix for many). */
export async function resolveAll(ctx, note) {
  const { rowCount } = await getPool().query('UPDATE core.error_log SET resolved_at = now(), resolved_by = $1, resolution = $2 WHERE resolved_at IS NULL', [ctx.userId, note ?? null]);
  return { resolved: rowCount };
}

/** Puts failed mails back in the queue for the worker to try again. */
export async function retryFailedMail() {
  const { rowCount } = await getPool().query("UPDATE core.mail_outbox SET status = 'PENDING', attempts = 0, next_attempt_at = now() WHERE status = 'FAILED'");
  return { requeued: rowCount };
}

// ---------------------------------------------------------------------------------------- alerts

/** Active users holding system.monitor through an active role (System Admin included). */
async function monitors(db) {
  const { rows } = await db.query(
    `SELECT DISTINCT u.id, u.email, u.full_name
       FROM core.user_role ur
       JOIN core.role ro ON ro.code = ur.role_code AND ro.is_active
       JOIN core.role_permission rp ON rp.role_code = ur.role_code AND rp.permission_key = $1
       JOIN core.app_user u ON u.id = ur.user_id
      WHERE u.is_active AND ur.valid_from <= current_date AND (ur.valid_to IS NULL OR ur.valid_to >= current_date)`,
    [PERMISSIONS.SYSTEM_MONITOR],
  );
  return rows;
}

/** Claims the right to send this kind of alert (at most once an hour, across processes). */
async function claim(db, kind) {
  const { rowCount } = await db.query(
    `INSERT INTO core.monitor_alert (kind, last_sent_at) VALUES ($1, now())
     ON CONFLICT (kind) DO UPDATE SET last_sent_at = now() WHERE core.monitor_alert.last_sent_at < now() - interval '1 hour'`,
    [kind],
  );
  return rowCount > 0;
}

/**
 * Checks for trouble and tells the monitoring users (bell, and mail once the worker runs):
 * the worker stopped, mail keeps failing, or errors spike. Run by the API every 5 minutes.
 * Note: while the worker is down, mail is not sent; the bell notice still appears.
 */
export async function checkAlerts({ log } = {}) {
  const pool = getPool();
  const found = [];
  const { rows: w } = await pool.query(
    `SELECT count(*) FILTER (WHERE NOT (info ? 'stoppedAt') AND last_beat > now() - make_interval(secs => $1))::int AS alive,
            count(*)::int AS known
       FROM core.service_heartbeat WHERE kind = 'WORKER'`,
    [BEAT_STALE_SEC],
  );
  // Only when a worker ran in the last day (a developer running just the API is not an outage).
  if (w[0].known > 0 && w[0].alive === 0) found.push({ kind: 'WORKER_DOWN', title: 'QMAS background worker has stopped', body: 'SAP pulls, reminders and mail are paused until it is started again.' });

  const { rows: mail } = await pool.query("SELECT count(*)::int AS n FROM core.mail_outbox WHERE status = 'FAILED' AND created_at > now() - interval '1 hour'");
  if (mail[0].n >= 3) found.push({ kind: 'MAIL_FAILING', title: `${mail[0].n} mails failed in the last hour`, body: 'Check the mail settings (SMTP) and retry the failed mails from System Health.' });

  const { rows: spike } = await pool.query("SELECT count(*)::int AS n FROM core.error_event WHERE at > now() - interval '15 minutes'");
  if (spike[0].n >= 10) found.push({ kind: 'ERROR_SPIKE', title: `${spike[0].n} errors in the last 15 minutes`, body: 'Open the error log to see what is failing.', link: '/admin/error-log' });

  let sent = 0;
  for (const a of found) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await claim(pool, a.kind))) continue;
    // eslint-disable-next-line no-await-in-loop
    const users = await monitors(pool);
    // eslint-disable-next-line no-await-in-loop
    await notifyUsers(pool, users, { kind: `MONITOR_${a.kind}`, title: a.title, body: a.body, link: a.link ?? '/admin/system-health', mail: { tone: 'escalation' } });
    log?.warn({ alert: a.kind }, a.title);
    sent += 1;
  }
  return { found: found.map((a) => a.kind), sent };
}

/** Housekeeping: occurrences older than 30 days are dropped (the grouped error rows stay). */
export async function pruneErrorEvents() {
  const { rowCount } = await getPool().query("DELETE FROM core.error_event WHERE at < now() - interval '30 days'");
  return rowCount;
}
