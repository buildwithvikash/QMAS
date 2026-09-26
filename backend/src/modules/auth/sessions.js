import { getEnv } from '../../config/env.js';
import { getPool } from '../../db/pool.js';
import { resolveHostName } from './clientInfo.js';

/**
 * Sessions: one row per sign-in (core.user_session, id = refresh-token family). Access tokens carry
 * the session id, so ending a session (force logout, lock, password reset) stops that device on its
 * very next request, not when its token runs out. The open/ended check is cached for a few seconds
 * per API instance and cleared at once when this instance ends a session.
 */

const CHECK_TTL_MS = 10_000;
const TOUCH_EVERY_MS = 60_000;
const ACTIVE_EVERY_MS = 60_000;
export const ONLINE_MINUTES = 5; // seen in the last 5 minutes = online

const checked = new Map(); // sid -> { at, ended: null | reason }
const touched = new Map(); // sid -> ms
const activeMarked = new Map(); // sid -> ms

const MESSAGES = {
  FORCED: 'An administrator signed you out. Please sign in again.',
  FORCED_ALL: 'An administrator signed everyone out. Please sign in again.',
  LOCKED: 'Your account has been locked by an administrator.',
  DEACTIVATED: 'Your account has been deactivated.',
  PASSWORD_RESET: 'Your password was reset. Sign in with the new password.',
  PASSWORD_CHANGED: 'Your password was changed on another device. Please sign in again.',
  IDLE: 'You were signed out after a period without activity. Please sign in again.',
  REPLACED: 'You signed in on another device, so you were signed out here (one sign-in at a time). If that was not you, change your password.',
};
export const endedMessage = (reason) => MESSAGES[reason] ?? 'Your session has ended. Please sign in again.';

export async function createSession(db, { id, userId, ip, userAgent, client }) {
  await db.query(
    'INSERT INTO core.user_session (id, user_id, client, ip, user_agent) VALUES ($1, $2, $3, $4, $5)',
    [id, userId, client === 'tablet' ? 'tablet' : 'web', ip ?? null, userAgent?.slice(0, 300) ?? null],
  );
}

/** Fills in the computer name after the response has gone (the lookup can take a second or two). */
export function attachHostName(id, ip) {
  resolveHostName(ip)
    .then((host) => host && getPool().query('UPDATE core.user_session SET host_name = $2 WHERE id = $1', [id, host]))
    .catch(() => {});
}

/**
 * On token refresh: the session is in use, possibly from a new address. A sign-in made before
 * sessions existed gets its session row now. Returns the reason if the session had ended.
 */
export async function sessionRefreshed(db, { id, userId, ip, userAgent, client }) {
  await db.query(
    `INSERT INTO core.user_session (id, user_id, client, ip, user_agent) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET last_seen_at = now(), ip = coalesce(EXCLUDED.ip, core.user_session.ip),
            client = CASE WHEN EXCLUDED.client = 'tablet' THEN 'tablet' ELSE core.user_session.client END
      WHERE core.user_session.ended_at IS NULL`,
    [id, userId, client === 'tablet' ? 'tablet' : 'web', ip ?? null, userAgent?.slice(0, 300) ?? null],
  );
  await endIfIdle(db, id);
  const { rows } = await db.query('SELECT end_reason, ended_at FROM core.user_session WHERE id = $1', [id]);
  return rows[0]?.ended_at ? rows[0].end_reason ?? 'ENDED' : null;
}

/**
 * Ends a web session with no user activity for IDLE_TIMEOUT_MIN minutes (tablets are exempt: they
 * inspect offline for long spells). Background refreshes do not count as activity.
 */
async function endIfIdle(db, id) {
  const minutes = getEnv().IDLE_TIMEOUT_MIN;
  if (!minutes) return false;
  const { rows } = await db.query(
    `UPDATE core.user_session SET ended_at = now(), end_reason = 'IDLE'
      WHERE id = $1 AND ended_at IS NULL AND client = 'web' AND last_active_at < now() - make_interval(mins => $2)
      RETURNING id`,
    [id, minutes],
  );
  if (rows[0]) await db.query("UPDATE core.refresh_token SET revoked_at = now(), revoked_reason = 'IDLE' WHERE family_id = $1 AND revoked_at IS NULL", [id]);
  return !!rows[0];
}

/** The user did something (typed, clicked, scrolled): the session is not idle. At most once a minute. */
export async function markActive(id) {
  if (!id) return;
  const now = Date.now();
  if (now - (activeMarked.get(id) ?? 0) < ACTIVE_EVERY_MS) return;
  if (activeMarked.size > 5000) activeMarked.clear();
  activeMarked.set(id, now);
  await getPool().query('UPDATE core.user_session SET last_active_at = now(), last_seen_at = now() WHERE id = $1 AND ended_at IS NULL', [id]);
}

/** Forget cached session checks (call after a transaction that ended sessions has committed). */
export const forgetSessionChecks = () => checked.clear();

/** For every API request: is this session still open? Returns null if open, else the reason it ended. */
export async function sessionEnded(id) {
  if (!id) return null; // tokens issued before sessions existed
  const now = Date.now();
  let hit = checked.get(id);
  if (!hit || now - hit.at > CHECK_TTL_MS) {
    await endIfIdle(getPool(), id);
    const { rows } = await getPool().query('SELECT ended_at, end_reason FROM core.user_session WHERE id = $1', [id]);
    hit = { at: now, ended: rows[0] ? (rows[0].ended_at ? rows[0].end_reason ?? 'ENDED' : null) : 'UNKNOWN' };
    if (checked.size > 5000) checked.clear();
    checked.set(id, hit);
  }
  if (!hit.ended && now - (touched.get(id) ?? 0) > TOUCH_EVERY_MS) {
    if (touched.size > 5000) touched.clear();
    touched.set(id, now);
    getPool().query('UPDATE core.user_session SET last_seen_at = now() WHERE id = $1 AND ended_at IS NULL', [id]).catch(() => {});
  }
  return hit.ended;
}

/**
 * Ends open sessions (one, a user's, or everyone's except a user's) and revokes their refresh
 * tokens so they cannot come back. Returns how many sessions ended.
 */
export async function endSessions(db, { id = null, userId = null, exceptUserId = null, reason, endedBy = null }) {
  const where = ['ended_at IS NULL'];
  const args = [reason, endedBy];
  const arg = (v) => { args.push(v); return `$${args.length}`; };
  if (id) where.push(`id = ${arg(id)}`);
  if (userId) where.push(`user_id = ${arg(userId)}`);
  if (exceptUserId) where.push(`user_id <> ${arg(exceptUserId)}`);
  const { rows } = await db.query(
    `UPDATE core.user_session SET ended_at = now(), end_reason = $1, ended_by = $2 WHERE ${where.join(' AND ')} RETURNING id`,
    args,
  );
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await db.query("UPDATE core.refresh_token SET revoked_at = now(), revoked_reason = $2 WHERE family_id = ANY($1) AND revoked_at IS NULL", [ids, reason]);
  }
  // Refresh tokens of sign-ins made before sessions existed.
  if (userId && !id) {
    await db.query('UPDATE core.refresh_token SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL', [userId, reason]);
  }
  checked.clear();
  return ids.length;
}
