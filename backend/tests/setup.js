import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, inject } from 'vitest';
import { loadEnv, setEnv } from '../src/config/env.js';
import { closePool, initPool } from '../src/db/pool.js';

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: inject('databaseUrl'),
  JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
  COOKIE_SECURE: 'false',
  LOG_LEVEL: 'silent',
  LOGIN_MAX_ATTEMPTS: '5',
  LOGIN_LOCK_MINUTES: '15',
});
setEnv(env);
// Uploaded test files go to a throwaway folder, not backend/uploads.
const uploadDir = mkdtempSync(path.join(tmpdir(), 'qmas-uploads-'));
process.env.UPLOAD_DIR = uploadDir;
initPool({ connectionString: env.DATABASE_URL, max: 20 });

afterAll(async () => {
  await closePool();
  rmSync(uploadDir, { recursive: true, force: true });
});
