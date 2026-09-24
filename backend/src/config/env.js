import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_SSL: bool.default(false),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).max(120).default(15),
  REFRESH_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  // Tablets work offline without a time limit; their session only has to last until they sync again.
  REFRESH_TOKEN_TTL_TABLET_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 30),
  SAP_SYNC_INTERVAL_MIN: z.coerce.number().int().min(1).max(24 * 60).default(15),
  COOKIE_SECURE: bool.default(true),
  CORS_ORIGINS: z.string().default(''),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(15),
  SERVE_WEB_DIST: z.string().optional(),
});

let cached;

/** Validated configuration. Fails fast at startup with every problem listed; secrets are never logged. */
export function loadEnv(source = process.env) {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
    throw new Error('Invalid configuration:\n  - COOKIE_SECURE must be true in production');
  }
  return {
    ...env,
    corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    isProduction: env.NODE_ENV === 'production',
  };
}

export function getEnv() {
  cached ??= loadEnv();
  return cached;
}

/** Test hook: replace the cached configuration. */
export function setEnv(env) {
  cached = env;
}
