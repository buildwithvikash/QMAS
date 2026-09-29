// Background worker: same code base and image as the API, started with `node src/worker.js`.
// Runs the SAP pull on a schedule, the deviation timers (Operations Head 24-hour timeout, 14-day
// auto-close), CAPA reminders, the mail outbox, and keeps audit-log partitions created ahead of time.
// Safe to run on several instances: the SAP pull takes a database lock, so only one runs at a time.
import { getEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { closePool, initPool } from './db/pool.js';
import { runAutoClose, runEscalationTimeouts } from './modules/deviation/deviation.service.js';
import { runCapaReminders } from './modules/dn/dn.service.js';
import './modules/dn/dn.mail.js'; // DN PDF for "mail to myself"
import { runSapSync } from './modules/integration/sapSync.service.js';
import { sendPendingMail } from './modules/notifications/mailer.js';
import { recordError } from './modules/system/errorLog.js';
import { startHeartbeat } from './modules/system/heartbeat.js';
import { pruneErrorEvents } from './modules/system/system.service.js';

const env = getEnv();
const pool = initPool({ connectionString: env.DATABASE_URL, max: 4, ssl: env.DB_SSL });
const log = logger.child({ component: 'worker' });
// A failed job is logged and kept in the error log (Administration → Error Log); the worker carries on.
const failed = (job, err) => {
  log.error({ err }, `${job} failed`);
  recordError({ source: 'WORKER', err, path: `worker: ${job}` });
};

process.on('unhandledRejection', (reason) => failed('unhandled promise', reason instanceof Error ? reason : new Error(String(reason))));
process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'uncaught exception: worker stopping');
  recordError({ source: 'WORKER', err, path: 'worker: uncaught exception' }).finally(() => process.exit(1));
  setTimeout(() => process.exit(1), 3_000).unref();
});

async function sapTick() {
  try {
    const r = await runSapSync({ log });
    if (r.skipped) log.info(r.reason);
    else log.info({ runId: r.runId, fetched: r.fetched, created: r.createdLots, opened: r.openedImirs, errors: r.errors.length }, 'SAP pull finished');
  } catch (err) {
    failed('SAP pull', err);
  }
}

async function timerTick() {
  try {
    const t = await runEscalationTimeouts();
    const c = await runAutoClose();
    const r = await runCapaReminders();
    if (t.changed || c.closed || r.reminded) log.info({ timedOutRounds: t.changed, autoClosed: c.closed, capaReminders: r.reminded }, 'timers applied');
  } catch (err) {
    failed('deviation timers', err);
  }
}

let mailing = false;
async function mailTick() {
  if (mailing) return;
  mailing = true;
  try {
    const m = await sendPendingMail({ log });
    if (m.sent || m.failed) log.info(m, 'mail outbox processed');
  } catch (err) {
    failed('mail outbox', err);
  } finally {
    mailing = false;
  }
}

async function partitionTick() {
  try {
    await pool.query(`SELECT audit.ensure_month_partition((date_trunc('month', now()) + make_interval(months => i))::date) FROM generate_series(0, 3) AS i`);
  } catch (err) {
    failed('audit partition maintenance', err);
  }
  try {
    const pruned = await pruneErrorEvents();
    if (pruned) log.info({ pruned }, 'old error occurrences removed');
  } catch (err) {
    failed('error log housekeeping', err);
  }
}

const timers = [
  setInterval(sapTick, env.SAP_SYNC_INTERVAL_MIN * 60_000),
  setInterval(partitionTick, 24 * 3_600_000),
  setInterval(timerTick, 5 * 60_000),
  setInterval(mailTick, 30_000),
];
const stopBeat = startHeartbeat('WORKER', log);
log.info({ sapEveryMin: env.SAP_SYNC_INTERVAL_MIN }, 'worker started');
await partitionTick();
await sapTick();
await timerTick();

const stop = async (signal) => {
  log.info({ signal }, 'worker stopping');
  timers.forEach(clearInterval);
  await stopBeat();
  await closePool();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
