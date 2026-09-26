import { randomUUID } from 'node:crypto';
import { getEnv } from '../../config/env.js';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../shared/AppError.js';
import { invalidateAccess, loadAccess } from './access.service.js';
import { burnPasswordCheck, hashPassword, passwordProblems, verifyPassword } from './password.js';
import { attachHostName, createSession, endedMessage, endSessions, forgetSessionChecks, sessionRefreshed } from './sessions.js';
import { hashToken, newRefreshToken, signAccessToken } from './tokens.js';

const INVALID_LOGIN = 'Employee code or password is incorrect.';
const REFRESH_RACE_SECONDS = 30;

export async function recordAuthEvent(db, event, { userId = null, employeeCode = null, ip = null, userAgent = null, detail = null }) {
  await db.query(
    'INSERT INTO audit.auth_event (event, user_id, employee_code, ip, user_agent, detail) VALUES ($1, $2, $3, $4, $5, $6)',
    [event, userId, employeeCode, ip, userAgent?.slice(0, 300) ?? null, detail],
  );
}

async function createRefreshToken(db, userId, { familyId = randomUUID(), ip, userAgent, client }) {
  const refreshToken = newRefreshToken();
  const env = getEnv();
  const ttlHours = client === 'tablet' ? env.REFRESH_TOKEN_TTL_TABLET_HOURS : env.REFRESH_TOKEN_TTL_HOURS;
  const { rows } = await db.query(
    `INSERT INTO core.refresh_token (user_id, family_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4), $5, $6) RETURNING id`,
    [userId, familyId, hashToken(refreshToken), ttlHours, ip, userAgent?.slice(0, 300) ?? null],
  );
  return { userId, refreshToken, refreshTokenId: rows[0].id, familyId };
}

/** A new sign-in: its refresh token family and the session row that shows it to administrators. */
async function startSession(db, userId, meta) {
  const rt = await createRefreshToken(db, userId, meta);
  await createSession(db, { id: rt.familyId, userId, ip: meta.ip, userAgent: meta.userAgent, client: meta.client });
  return rt;
}

/**
 * Signs the access token after the transaction has committed, so it carries the new token_version
 * and the session id.
 */
async function finishSession({ userId, refreshToken, familyId }, meta, { isNew = false } = {}) {
  invalidateAccess(userId);
  forgetSessionChecks();
  if (isNew && meta?.ip) attachHostName(familyId, meta.ip);
  const access = await loadAccess(userId);
  return { access, accessToken: signAccessToken(access, familyId), refreshToken, sessionId: familyId };
}

export async function login({ employeeCode, password }, meta) {
  const env = getEnv();
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT id, employee_code, password_hash, is_active, is_locked, locked_until, failed_login_count FROM core.app_user WHERE employee_code = $1',
    [employeeCode],
  );
  const user = rows[0];
  const eventMeta = { ...meta, employeeCode, userId: user?.id ?? null };

  if (!user) {
    await burnPasswordCheck(password);
    await recordAuthEvent(pool, 'LOGIN_FAILED', { ...eventMeta, detail: { reason: 'UNKNOWN_USER' } });
    throw AppError.unauthorized(INVALID_LOGIN, { code: 'INVALID_CREDENTIALS' });
  }

  if (user.locked_until && user.locked_until > new Date()) {
    await recordAuthEvent(pool, 'LOGIN_FAILED', { ...eventMeta, detail: { reason: 'LOCKED' } });
    throw AppError.unauthorized(
      `Too many failed attempts. The account is locked until ${formatIst(user.locked_until)}, or ask the administrator to unlock it.`,
      { code: 'ACCOUNT_LOCKED' },
    );
  }

  if (!(await verifyPassword(user.password_hash, password))) {
    const failures = user.failed_login_count + 1;
    const lock = failures >= env.LOGIN_MAX_ATTEMPTS;
    await pool.query(
      `UPDATE core.app_user
          SET failed_login_count = CASE WHEN $2 THEN 0 ELSE $3 END,
              locked_until = CASE WHEN $2 THEN now() + make_interval(mins => $4) ELSE locked_until END
        WHERE id = $1`,
      [user.id, lock, failures, env.LOGIN_LOCK_MINUTES],
    );
    await recordAuthEvent(pool, lock ? 'LOCKED' : 'LOGIN_FAILED', { ...eventMeta, detail: { reason: 'BAD_PASSWORD', failures } });
    const left = env.LOGIN_MAX_ATTEMPTS - failures;
    throw AppError.unauthorized(
      lock ? `Too many failed attempts. The account is locked for ${env.LOGIN_LOCK_MINUTES} minutes.` : `${INVALID_LOGIN} ${left} attempt${left === 1 ? '' : 's'} left before the account is locked.`,
      { code: lock ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS' },
    );
  }

  if (!user.is_active) {
    await recordAuthEvent(pool, 'LOGIN_FAILED', { ...eventMeta, detail: { reason: 'INACTIVE' } });
    throw AppError.unauthorized('This account is deactivated. Contact the administrator.', { code: 'ACCOUNT_INACTIVE' });
  }
  // Checked after the password, like deactivation, so the message does not reveal accounts to guessers.
  if (user.is_locked) {
    await recordAuthEvent(pool, 'LOGIN_FAILED', { ...eventMeta, detail: { reason: 'ADMIN_LOCKED' } });
    throw AppError.unauthorized('This account has been locked by an administrator. Contact the administrator to unlock it.', { code: 'ACCOUNT_LOCKED_BY_ADMIN' });
  }

  const rt = await withTransaction({ userId: user.id, requestId: meta.requestId }, async (db) => {
    await db.query('UPDATE core.app_user SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
    // One sign-in at a time: earlier sessions of this user end now.
    const replaced = env.SINGLE_SESSION ? await endSessions(db, { userId: user.id, reason: 'REPLACED', endedBy: user.id }) : 0;
    await recordAuthEvent(db, 'LOGIN_OK', { ...eventMeta, detail: replaced ? { replacedSessions: replaced } : null });
    return startSession(db, user.id, meta);
  });
  return finishSession(rt, meta, { isNew: true });
}

/** Rotates a refresh token. Reusing an already-rotated token revokes the whole sign-in family. */
export async function refresh(refreshToken, meta) {
  if (!refreshToken) throw AppError.unauthorized();
  const result = await withTransaction({ requestId: meta.requestId }, async (db) => {
    const { rows } = await db.query(
      `SELECT t.id, t.user_id, t.family_id, t.expires_at, t.revoked_at, t.revoked_reason, u.is_active, u.is_locked
         FROM core.refresh_token t JOIN core.app_user u ON u.id = t.user_id
        WHERE t.token_hash = $1 FOR UPDATE OF t`,
      [hashToken(refreshToken)],
    );
    const t = rows[0];
    if (!t) return { error: AppError.unauthorized() };

    if (t.revoked_at) {
      // Logged out, password changed, family already revoked: simply over.
      if (t.revoked_reason !== 'ROTATED') return { error: AppError.unauthorized(endedMessage(t.revoked_reason), { code: 'SESSION_ENDED' }) };
      const secondsAgo = (Date.now() - t.revoked_at.getTime()) / 1000;
      if (secondsAgo < REFRESH_RACE_SECONDS) {
        // Two tabs refreshed at the same moment; the other one already holds the new token.
        return { error: AppError.unauthorized('Session refreshed in another tab.', { code: 'REFRESH_RACE' }) };
      }
      await db.query(
        "UPDATE core.refresh_token SET revoked_at = now(), revoked_reason = 'REUSE_DETECTED' WHERE family_id = $1 AND revoked_at IS NULL",
        [t.family_id],
      );
      await db.query("UPDATE core.user_session SET ended_at = now(), end_reason = 'REUSE_DETECTED' WHERE id = $1 AND ended_at IS NULL", [t.family_id]);
      await recordAuthEvent(db, 'REFRESH_REUSE', { ...meta, userId: t.user_id, detail: { familyId: t.family_id } });
      return { error: AppError.unauthorized('Your session has ended. Please sign in again.') };
    }
    if (t.expires_at <= new Date() || !t.is_active || t.is_locked) {
      if (t.expires_at <= new Date()) await db.query("UPDATE core.user_session SET ended_at = now(), end_reason = 'EXPIRED' WHERE id = $1 AND ended_at IS NULL", [t.family_id]);
      return { error: AppError.unauthorized(t.is_locked ? endedMessage('LOCKED') : 'Your session has ended. Please sign in again.', { code: 'SESSION_ENDED' }) };
    }
    const ended = await sessionRefreshed(db, { id: t.family_id, userId: t.user_id, ip: meta.ip, userAgent: meta.userAgent, client: meta.client });
    if (ended) return { error: AppError.unauthorized(endedMessage(ended), { code: 'SESSION_ENDED' }) };

    const rt = await createRefreshToken(db, t.user_id, { ...meta, familyId: t.family_id });
    await db.query(
      "UPDATE core.refresh_token SET revoked_at = now(), revoked_reason = 'ROTATED', replaced_by = $2 WHERE id = $1",
      [t.id, rt.refreshTokenId],
    );
    return { rt };
  });
  // The transaction commits the reuse revocation before the error is reported.
  if (result.error) throw result.error;
  return finishSession(result.rt, meta);
}

export async function logout(refreshToken, meta) {
  if (!refreshToken) return;
  const pool = getPool();
  const { rows } = await pool.query('SELECT user_id, family_id FROM core.refresh_token WHERE token_hash = $1', [hashToken(refreshToken)]);
  if (!rows[0]) return;
  const ended = await endSessions(pool, { id: rows[0].family_id, reason: 'LOGOUT', endedBy: rows[0].user_id });
  // Sign-ins from before sessions existed have no session row: revoke the family directly.
  await pool.query("UPDATE core.refresh_token SET revoked_at = now(), revoked_reason = 'LOGOUT' WHERE family_id = $1 AND revoked_at IS NULL", [rows[0].family_id]);
  if (ended || rows[0]) await recordAuthEvent(pool, 'LOGOUT', { ...meta, userId: rows[0].user_id });
}

/** Changes the password, ends every other session and returns a fresh session for this device. */
export async function changePassword(user, { currentPassword, newPassword }, meta) {
  const problem = passwordProblems(newPassword, { employeeCode: user.employeeCode });
  if (problem) throw AppError.unprocessable(problem, [{ path: 'newPassword', message: problem }]);

  const { rows } = await getPool().query('SELECT password_hash FROM core.app_user WHERE id = $1', [user.id]);
  if (!(await verifyPassword(rows[0].password_hash, currentPassword))) {
    throw AppError.unprocessable('The current password is incorrect.', [{ path: 'currentPassword', message: 'The current password is incorrect.' }]);
  }
  const newHash = await hashPassword(newPassword);
  const rt = await withTransaction({ userId: user.id, requestId: meta.requestId }, async (db) => {
    await db.query(
      `UPDATE core.app_user SET password_hash = $2, must_change_password = false, password_changed_at = now(),
              token_version = token_version + 1
        WHERE id = $1`,
      [user.id, newHash],
    );
    await endSessions(db, { userId: user.id, reason: 'PASSWORD_CHANGED', endedBy: user.id });
    await recordAuthEvent(db, 'PASSWORD_CHANGED', { ...meta, userId: user.id, employeeCode: user.employeeCode });
    return startSession(db, user.id, meta);
  });
  return finishSession(rt, meta, { isNew: true });
}

const istFormat = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
const formatIst = (d) => istFormat.format(d);
