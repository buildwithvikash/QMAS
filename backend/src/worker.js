// Background worker: same code base and image as the API, started with `node src/worker.js`.
// Runs the SAP pull on a schedule and keeps audit-log partitions created ahead of time.
// Safe to run on several instances: the SAP pull takes a database lock, so only one runs at a time.
import { getEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { closePool, initPool } from './db/pool.js';
import { runSapSync } from './modules/integration/sapSync.service.js';

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
];
log.info({ sapEveryMin: env.SAP_SYNC_INTERVAL_MIN }, 'worker started');
await partitionTick();
await sapTick();

const stop = async (signal) => {
  log.info({ signal }, 'worker stopping');
  timers.forEach(clearInterval);
  await closePool();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
