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

const env = getEnv();
const pool = initPool({ connectionString: env.DATABASE_URL, max: 4, ssl: env.DB_SSL });
const log = logger.child({ component: 'worker' });

async function sapTick() {
  try {
    const r = await runSapSync({ log });
    if (r.skipped) log.info(r.reason);
    else log.info({ runId: r.runId, fetched: r.fetched, created: r.createdLots, opened: r.openedImirs, errors: r.errors.length }, 'SAP pull finished');
  } catch (err) {
    log.error({ err }, 'SAP pull failed');
  }
}

async function timerTick() {
  try {
    const t = await runEscalationTimeouts();
    const c = await runAutoClose();
    const r = await runCapaReminders();
    if (t.changed || c.closed || r.reminded) log.info({ timedOutRounds: t.changed, autoClosed: c.closed, capaReminders: r.reminded }, 'timers applied');
  } catch (err) {
    log.error({ err }, 'deviation timers failed');
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
    log.error({ err }, 'mail outbox failed');
  } finally {
    mailing = false;
  }
}

async function partitionTick() {
  try {
    await pool.query(`SELECT audit.ensure_month_partition((date_trunc('month', now()) + make_interval(months => i))::date) FROM generate_series(0, 3) AS i`);
  } catch (err) {
    log.error({ err }, 'audit partition maintenance failed');
  }
}

const timers = [
  setInterval(sapTick, env.SAP_SYNC_INTERVAL_MIN * 60_000),
  setInterval(partitionTick, 24 * 3_600_000),
  setInterval(timerTick, 5 * 60_000),
  setInterval(mailTick, 30_000),
];
log.info({ sapEveryMin: env.SAP_SYNC_INTERVAL_MIN }, 'worker started');
await partitionTick();
await sapTick();
await timerTick();

const stop = async (signal) => {
  log.info({ signal }, 'worker stopping');
  timers.forEach(clearInterval);
  await closePool();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
