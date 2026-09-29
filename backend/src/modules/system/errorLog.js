import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { getPool } from '../../db/pool.js';

const require = createRequire(import.meta.url);
export const APP_VERSION = (() => {
  try {
    return require('../../../package.json').version;
  } catch {
    return 'unknown';
  }
})();

// Ids, numbers and long hex in messages and paths vary per occurrence; group on the shape.
const shape = (s) => String(s ?? '')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
  .replace(/\b[0-9a-f]{16,}\b/gi, ':hex')
  .replace(/\d+/g, '#');

// The first line of the stack that points into our code, to tell apart errors with the same text.
const firstFrame = (stack) => String(stack ?? '').split('\n').slice(1).find((l) => !/node_modules|node:internal/.test(l))?.trim() ?? '';

const clip = (s, n) => (s === null || s === undefined ? null : String(s).slice(0, n));

/**
 * Records one error occurrence: server (500 / crash), worker (job failure / crash) or client
 * (a crash in a user's browser). Same source + message shape + place = one row with a count;
 * a resolved error that happens again is reopened. Never throws: monitoring must not add failures.
 * Returns the error log id, or null when it could not be stored.
 */
export async function recordError({ source, err, message, detail, method, path, statusCode, requestId, userId, userAgent, appVersion }) {
  try {
    const msg = clip(message ?? err?.message ?? String(err ?? 'Unknown error'), 1000);
    const stack = clip(detail ?? err?.stack ?? null, 8000);
    const where = source === 'CLIENT' ? `${shape(path)}|${shape(firstFrame(stack))}` : `${method ?? ''} ${shape(path)}|${shape(firstFrame(stack))}`;
    const fingerprint = createHash('sha1').update(`${source}|${shape(msg)}|${where}`).digest('hex');
    const pool = getPool();
    const { rows } = await pool.query(
      `INSERT INTO core.error_log (fingerprint, source, message, detail, method, path, status_code, request_id, user_id, user_agent, app_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (fingerprint) DO UPDATE SET
         occurrences = core.error_log.occurrences + 1, last_seen = now(),
         message = EXCLUDED.message, detail = EXCLUDED.detail, status_code = EXCLUDED.status_code,
         request_id = EXCLUDED.request_id, user_id = EXCLUDED.user_id, user_agent = EXCLUDED.user_agent, app_version = EXCLUDED.app_version,
         resolved_at = NULL, resolved_by = NULL,
         resolution = CASE WHEN core.error_log.resolved_at IS NULL THEN core.error_log.resolution ELSE NULL END
       RETURNING id`,
      [fingerprint, source, msg, stack, clip(method, 10), clip(path, 500), statusCode ?? null, clip(requestId, 100), userId ?? null, clip(userAgent, 300), clip(appVersion ?? APP_VERSION, 40)],
    );
    const id = rows[0].id;
    await pool.query('INSERT INTO core.error_event (error_id, request_id, user_id) VALUES ($1, $2, $3)', [id, clip(requestId, 100), userId ?? null]);
    return id;
  } catch {
    return null;
  }
}
