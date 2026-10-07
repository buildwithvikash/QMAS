import pg from 'pg';
import { BUSINESS_TIME_ZONE } from '@qmas/shared';

// bigint (int8) columns are ids and counts well inside Number range; return them as numbers.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
// numeric stays a string so measurements and quantities never lose precision.
// date (a calendar day, no time) stays 'YYYY-MM-DD': as a JS Date it would be midnight in the
// server's time zone, and turning that into ISO/UTC moves it to the previous day on an IST server.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

let pool;

export function createPool({ connectionString, max = 10, ssl = false }) {
  return new pg.Pool({
    connectionString,
    max,
    ssl: ssl ? { rejectUnauthorized: true } : undefined,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    application_name: 'qmas-api',
    // Business dates (current_date, month partitions, "today") follow IST.
    options: `-c TimeZone=${BUSINESS_TIME_ZONE}`,
  });
}

export function initPool(config) {
  pool = createPool(config);
  return pool;
}

export function getPool() {
  if (!pool) throw new Error('Database pool not initialised');
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
