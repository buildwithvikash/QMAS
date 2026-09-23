// Local development database without Docker or a PostgreSQL install: runs PostgreSQL 17 from
// node_modules (embedded-postgres), applies migrations and reference data, and prints the
// DATABASE_URL to put in backend/.env. Data lives in backend/.pgdata (git-ignored).
//   npm run db:dev          start (Ctrl+C to stop)
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedReferenceData } from '../src/db/seed.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.pgdata');
const credFile = path.join(root, '.pgdata.credentials');
const port = Number(process.env.DEV_DB_PORT ?? 54329);

// A random password per machine, kept next to the data directory (both git-ignored).
const fresh = !existsSync(dataDir);
const password = fresh || !existsSync(credFile) ? randomBytes(18).toString('base64url') : readFileSync(credFile, 'utf8').trim();

const pg = new EmbeddedPostgres({
  databaseDir: dataDir, user: 'qmas', password, port, persistent: true, onLog: () => {},
  initdbFlags: ['--encoding=UTF8', '--locale=C'], // same as RDS, whatever the OS code page
});
if (fresh) {
  await pg.initialise();
  writeFileSync(credFile, password, { mode: 0o600 });
}
await pg.start();
if (fresh) await pg.createDatabase('qmas');

const url = `postgres://qmas:${password}@localhost:${port}/qmas`;
const pool = createPool({ connectionString: url, max: 2 });
const applied = await runMigrations(pool, { log: (m) => console.log(m) });
await seedReferenceData(pool);
await pool.end();

console.log(`\nPostgreSQL 17 running on port ${port}${applied.length ? ` (${applied.length} migration(s) applied)` : ''}.`);
console.log(`Put this in backend/.env:\n  DATABASE_URL=${url}\n`);
console.log('Press Ctrl+C to stop.');

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
