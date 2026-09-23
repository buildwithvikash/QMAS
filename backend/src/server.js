import { createApp } from './app.js';
import { getEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { closePool, initPool } from './db/pool.js';

async function main() {
  const env = getEnv();
  const pool = initPool({ connectionString: env.DATABASE_URL, max: env.DB_POOL_MAX, ssl: env.DB_SSL });
  await pool.query('SELECT 1');

  const server = createApp().listen(env.PORT, () => logger.info({ port: env.PORT, env: env.NODE_ENV }, 'QMAS API listening'));

  // Graceful shutdown for ECS task replacement: stop accepting, finish in-flight requests, close the pool.
  const shutdown = (signal) => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
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
