// Moves QMAS onto a PostgreSQL installed on this machine (instead of the embedded dev database).
//   npm run db:setup-local
// Asks for the password of the "postgres" superuser (typed hidden, never stored or printed), then:
//   1. creates the login role qmas_app with a random password and the database qmas it owns,
//      with the extensions QMAS needs (created as superuser);
//   2. copies everything from the current database (the one in backend/.env, e.g. the embedded dev
//      one on port 54329) with pg_dump / pg_restore, or starts empty (migrations + reference data);
//   3. backs up backend/.env and points DATABASE_URL at the new database.
// The app then connects as qmas_app, not as postgres. Safe to run again: existing role and database
// are reused (the role gets a new password, written to .env), and nothing is copied over existing data
// unless you confirm.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
const APP_ROLE = 'qmas_app';
const DB = 'qmas';
const EXTENSIONS = ['pgcrypto', 'citext', 'pg_trgm', 'btree_gist'];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const ask = (q, def = '') => new Promise((res) => rl.question(`${q}${def ? ` [${def}]` : ''}: `, (a) => res(a.trim() || def)));
/** Reads a line without echoing it (shows * per character). */
function askHidden(q) {
  return new Promise((res) => {
    const out = rl.output;
    const write = out.write.bind(out);
    let muted = false;
    out.write = (s) => (muted && s !== '\n' && s !== '\r\n' ? write('*') : write(s));
    rl.question(`${q}: `, (a) => { out.write = write; write('\n'); res(a); });
    muted = true;
  });
}
const yes = async (q, def = 'y') => (await ask(`${q} (y/n)`, def)).toLowerCase().startsWith('y');
const say = (m = '') => console.log(m);
const fail = (m) => { console.error(`\n✖ ${m}`); process.exit(1); };

/** pg_dump / pg_restore of the installed PostgreSQL (PATH, or C:\Program Files\PostgreSQL\<newest>\bin). */
function pgTool(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const onPath = spawnSync(exe, ['--version'], { encoding: 'utf8' });
  if (onPath.status === 0) return { cmd: exe, version: onPath.stdout };
  const base = 'C:\\Program Files\\PostgreSQL';
  if (existsSync(base)) {
    for (const v of readdirSync(base).sort((a, b) => Number(b) - Number(a))) {
      const p = path.join(base, v, 'bin', exe);
      if (existsSync(p)) return { cmd: p, version: spawnSync(p, ['--version'], { encoding: 'utf8' }).stdout };
    }
  }
  return null;
}
const major = (s) => Number(/(\d+)(?:\.\d+)?/.exec(s ?? '')?.[1] ?? 0);

function readEnv() {
  return existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
}
function currentUrl(text) {
  const m = /^DATABASE_URL=(.*)$/m.exec(text);
  return m?.[1]?.trim() || null;
}

say('QMAS: set up the database on a PostgreSQL installed on this machine.\n');
const host = await ask('Host', 'localhost');
const port = Number(await ask('Port', '5432'));
const superuser = await ask('Superuser', 'postgres');
const superPassword = await askHidden(`Password of "${superuser}" (the one you chose in the installer)`);
if (!superPassword) fail('No password given.');

const admin = (database) => new pg.Client({ host, port, user: superuser, password: superPassword, database });
let c = admin('postgres');
try {
  await c.connect();
} catch (err) {
  fail(err.code === '28P01' ? 'Wrong password for the superuser.' : err.code === 'ECONNREFUSED' ? `Nothing listens on ${host}:${port}. Is the PostgreSQL service running?` : err.message);
}
const { rows: ver } = await c.query('SHOW server_version');
say(`Connected to PostgreSQL ${ver[0].server_version} on ${host}:${port}.`);

// 1. Role and database. The app password is random and goes straight into .env.
const appPassword = randomBytes(24).toString('base64url');
const { rows: role } = await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [APP_ROLE]);
await c.query(`${role.length ? 'ALTER' : 'CREATE'} ROLE ${APP_ROLE} LOGIN PASSWORD '${appPassword.replaceAll("'", "''")}'`);
say(`${role.length ? 'Updated' : 'Created'} login role ${APP_ROLE} (random password, written to backend/.env).`);
const { rows: db } = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB]);
if (!db.length) {
  await c.query(`CREATE DATABASE ${DB} OWNER ${APP_ROLE} ENCODING 'UTF8' TEMPLATE template0`);
  say(`Created database ${DB}, owned by ${APP_ROLE}.`);
} else {
  await c.query(`ALTER DATABASE ${DB} OWNER TO ${APP_ROLE}`);
  say(`Database ${DB} already exists; owner set to ${APP_ROLE}.`);
}
await c.end();

c = admin(DB);
await c.connect();
for (const ext of EXTENSIONS) await c.query(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
await c.query(`GRANT ALL ON SCHEMA public TO ${APP_ROLE}`);
const { rows: existingTables } = await c.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema IN ('core', 'mst', 'qms', 'intg', 'audit')");
await c.end();
say(`Extensions ready: ${EXTENSIONS.join(', ')}.`);

const targetUrl = `postgres://${APP_ROLE}:${appPassword}@${host === 'localhost' ? 'localhost' : host}:${port}/${DB}`;

// 2. Data: copy the current database, or start empty.
const envText = readEnv();
const sourceUrl = currentUrl(envText);
const sameTarget = sourceUrl && new URL(sourceUrl).port === String(port) && new URL(sourceUrl).pathname === `/${DB}`;
let copied = false;
if (sourceUrl && !sameTarget && (await yes(`Copy all data from the current database (${new URL(sourceUrl).host}${new URL(sourceUrl).pathname})? It must be running`))) {
  if (existingTables[0].n > 0 && !(await yes(`Database ${DB} already has ${existingTables[0].n} QMAS tables. Replace them with the copy?`, 'n'))) {
    say('Keeping the existing data in the new database; nothing copied.');
  } else {
    const dump = pgTool('pg_dump');
    const restore = pgTool('pg_restore');
    if (!dump || !restore) fail('pg_dump / pg_restore not found. Add the PostgreSQL bin folder to PATH, or run again and choose not to copy.');
    const src = new pg.Client({ connectionString: sourceUrl });
    await src.connect().catch((err) => fail(`Cannot reach the current database: ${err.message}. Start it (npm run db:dev) and run this again.`));
    const { rows: sv } = await src.query('SHOW server_version');
    await src.end();
    if (major(dump.version) < major(sv[0].server_version)) fail(`pg_dump ${major(dump.version)} is older than the current database (${sv[0].server_version}). Install PostgreSQL ${major(sv[0].server_version)} or newer.`);

    if (existingTables[0].n > 0) {
      const wipe = admin(DB);
      await wipe.connect();
      for (const s of ['sync', 'audit', 'intg', 'qms', 'mst', 'core']) await wipe.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
      await wipe.query('DROP TABLE IF EXISTS public.schema_migrations CASCADE');
      await wipe.end();
    }
    const file = path.join(tmpdir(), `qmas-${Date.now()}.dump`);
    say('Copying… (pg_dump)');
    const d = spawnSync(dump.cmd, ['--format=custom', '--no-owner', '--no-privileges', `--file=${file}`, sourceUrl], { stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8' });
    if (d.status !== 0) fail(`pg_dump failed:\n${d.stderr}`);
    say('Restoring… (pg_restore)');
    // As superuser, but every object is created by (and owned by) qmas_app.
    const r = spawnSync(restore.cmd, ['--no-owner', '--no-privileges', `--role=${APP_ROLE}`, `--host=${host}`, `--port=${port}`, `--username=${superuser}`, `--dbname=${DB}`, file],
      { env: { ...process.env, PGPASSWORD: superPassword }, stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8' });
    rmSync(file, { force: true });
    // Extension comments cannot be set by qmas_app; those warnings are harmless. Anything else is shown.
    const errors = (r.stderr ?? '').split('\n').filter((l) => /error/i.test(l) && !/extension|errors ignored/i.test(l));
    if (r.status !== 0 && errors.length) fail(`pg_restore reported errors:\n${errors.slice(0, 15).join('\n')}`);
    copied = true;
    say('All data copied.');
  }
}

// 3. Point backend/.env at the new database.
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
if (existsSync(envFile)) copyFileSync(envFile, `${envFile}.bak-${stamp}`);
const line = `# Local PostgreSQL (${host}:${port}) since ${stamp.slice(0, 10)}; the previous settings are in .env.bak-${stamp}\nDATABASE_URL=${targetUrl}`;
const next = /^DATABASE_URL=.*$/m.test(envText) ? envText.replace(/^DATABASE_URL=.*$/m, line) : `${envText.trimEnd()}\n${line}\n`;
writeFileSync(envFile, next);
say(`backend/.env now points at ${APP_ROLE}@${host}:${port}/${DB} (backup: .env.bak-${stamp}).`);
rl.close();

// Schema and reference data (a no-op after a full copy, which already has them).
say('\nApplying migrations and reference data…');
const m = spawnSync(process.execPath, ['--env-file=.env', 'scripts/migrate.js'], { cwd: root, stdio: 'inherit' });
if (m.status !== 0) fail('Migrations failed; see above.');

say(`\n✔ Done. QMAS now uses PostgreSQL on ${host}:${port}${copied ? ' with all your data copied' : ' (empty: only reference data)'}.`);
say('  Restart the API and the worker. "npm run db:dev" (the embedded database) is no longer needed.');
if (!copied) say('  Create demo users again with: npm run demo-users');
process.exit(0);
