// Applies pending migrations and reference data. Run before starting a new release
// (in AWS: a one-off ECS task with the same image).
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedReferenceData } from '../src/db/seed.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const pool = createPool({ connectionString: url, max: 2, ssl: process.env.DB_SSL === 'true' });
try {
  const applied = await runMigrations(pool, { log: (m) => console.log(m) });
  await seedReferenceData(pool);
  console.log(applied.length ? `Applied ${applied.length} migration(s); reference data up to date.` : 'Database already up to date.');
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
