import { createApp } from './app.js';
import { getEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { closePool, initPool } from './db/pool.js';
import { recordError } from './modules/system/errorLog.js';
import { startHeartbeat } from './modules/system/heartbeat.js';
import { checkAlerts } from './modules/system/system.service.js';

// A crash anywhere in the process is logged (file + error log) before it ends. An unhandled promise
// rejection is logged and the API keeps serving; an uncaught exception leaves the process in an
// unknown state, so it exits and the process manager (ECS, or the developer) starts it again.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection');
  recordError({ source: 'SERVER', err: reason instanceof Error ? reason : new Error(String(reason)), path: 'process: unhandled rejection' });
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception: API stopping');
  recordError({ source: 'SERVER', err, path: 'process: uncaught exception' }).finally(() => process.exit(1));
  setTimeout(() => process.exit(1), 3_000).unref();
});

async function main() {
  const env = getEnv();
  const pool = initPool({ connectionString: env.DATABASE_URL, max: env.DB_POOL_MAX, ssl: env.DB_SSL });
  await pool.query('SELECT 1');

  const server = createApp().listen(env.PORT, () => logger.info({ port: env.PORT, env: env.NODE_ENV }, 'QMAS API listening'));
  const stopBeat = startHeartbeat('API', logger);
  // Monitoring alerts (worker stopped, mail failing, error spike) to users with system.monitor.
  const alerts = setInterval(() => checkAlerts({ log: logger }).catch((err) => logger.warn({ err: err.message }, 'alert check failed')), 5 * 60_000);
  alerts.unref();

  // Graceful shutdown for ECS task replacement: stop accepting, finish in-flight requests, close the pool.
  const shutdown = (signal) => {
    logger.info({ signal }, 'shutting down');
    clearInterval(alerts);
    server.close(async () => {
      await stopBeat();
      await closePool();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 25_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
