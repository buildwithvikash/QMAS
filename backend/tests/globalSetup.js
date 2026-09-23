// Starts a throwaway PostgreSQL 17 (embedded-postgres, no Docker needed), applies the real
// migrations and reference data once, and hands the URL to the test files.
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedReferenceData } from '../src/db/seed.js';

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

export default async function setup({ provide }) {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../.pgtest-${process.pid}`);
  const port = await freePort();
  const password = randomBytes(12).toString('hex');
  const pg = new EmbeddedPostgres({
    databaseDir: dir, user: 'qmas', password, port, persistent: false, onLog: () => {},
    initdbFlags: ['--encoding=UTF8', '--locale=C'], // same as RDS, whatever the OS code page
  });
  await pg.initialise();
  await pg.start();
  const url = `postgres://qmas:${password}@localhost:${port}/qmas_test`;
  try {
    await pg.createDatabase('qmas_test');
    const pool = createPool({ connectionString: url, max: 2 });
    try {
      await runMigrations(pool);
      await seedReferenceData(pool);
    } finally {
      await pool.end();
    }
  } catch (err) {
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }

  provide('databaseUrl', url);

  return async () => {
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
