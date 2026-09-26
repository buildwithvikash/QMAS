import { randomBytes } from 'node:crypto';
import { getEnv } from '../../config/env.js';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../shared/AppError.js';
import { renderMail } from '../notifications/mailTemplate.js';
import { invalidateAccess } from './access.service.js';
import { recordAuthEvent } from './auth.service.js';
import { hashPassword, passwordProblems } from './password.js';
import { endSessions, forgetSessionChecks } from './sessions.js';
import { hashToken } from './tokens.js';

/**
 * Password reset by e-mail: "Forgot password" on the sign-in page, or an administrator's "E-mail a
 * reset link". A link works once, for LINK_MINUTES; only its hash is stored. Asking for a link
 * never reveals whether an account exists or has an e-mail address.
 */

export const LINK_MINUTES = 30;
const MAX_LINKS_PER_HOUR = 3;
export const FORGOT_REPLY = 'If the account exists and has an e-mail address, a link to set a new password has been sent to it. The link works for 30 minutes.';

const IST = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

/** Queues the reset mail (sent by the worker, like every other QMAS mail). */
async function queueResetMail(db, user, link, expiresAt, { byAdmin, ip }) {
  const { html, text } = renderMail({
    tone: 'action', pill: 'Password reset', greeting: user.full_name,
    title: 'Set a new QMAS password',
    todo: `Open the link below and choose a new password. The link works once, until ${IST.format(expiresAt)}.`,
    facts: [['Employee code', user.employee_code, true], ['Requested', byAdmin ? `by the administrator (${byAdmin})` : `from the sign-in page${ip ? ` (${ip})` : ''}`]],
    url: link, button: 'Set a new password',
    reason: 'If you did not ask for this, ignore this mail: your password stays as it is. Tell the administrator if it keeps happening.',
  });
  await db.query(
    'INSERT INTO core.mail_outbox (to_address, to_user_id, subject, body_text, body_html) VALUES ($1, $2, $3, $4, $5)',
    [user.email, user.id, '[QMAS] Set a new password', text, html],
  );
}

/**
 * Creates a reset link for a user and mails it. Returns false (and sends nothing) when the account
 * cannot receive one; callers facing the public say the same thing either way.
 */
async function issueLink(user, { byAdmin = null, adminId = null, ip = null, meta = {} }) {
  if (!user || !user.is_active || user.is_locked || !user.email) return false;
  const db = getPool();
  const { rows: recent } = await db.query("SELECT count(*)::int AS n FROM core.password_reset WHERE user_id = $1 AND created_at > now() - interval '1 hour'", [user.id]);
  if (!adminId && recent[0].n >= MAX_LINKS_PER_HOUR) return false;

  const token = randomBytes(32).toString('base64url');
  const base = getEnv().APP_BASE_URL.replace(/\/$/, '');
  const link = `${base}/reset-password?token=${token}`;
  await withTransaction({ userId: adminId, requestId: meta.requestId }, async (tx) => {
    // A new link replaces any earlier one still waiting.
    await tx.query('UPDATE core.password_reset SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
    const { rows } = await tx.query(
      `INSERT INTO core.password_reset (user_id, token_hash, requested_by, requested_ip, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5)) RETURNING expires_at`,
      [user.id, hashToken(token), adminId, ip, LINK_MINUTES],
    );
    await queueResetMail(tx, user, link, rows[0].expires_at, { byAdmin, ip });
    await recordAuthEvent(tx, adminId ? 'RESET_LINK_SENT' : 'RESET_LINK_REQUESTED', { ...meta, ip, userId: user.id, employeeCode: user.employee_code, detail: adminId ? { by: adminId } : null });
  });
  return true;
}

const USER_COLS = 'id, employee_code, full_name, email, is_active, is_locked';

/** "Forgot password": by employee code or e-mail. Always answers the same. */
export async function requestReset({ login }, meta) {
  const { rows } = await getPool().query(`SELECT ${USER_COLS} FROM core.app_user WHERE employee_code = $1 OR email = $1 LIMIT 2`, [login.trim()]);
  if (rows.length === 1) await issueLink(rows[0], { ip: meta.ip, meta });
  return { message: FORGOT_REPLY };
}

/** Administrator: e-mail a reset link to a user. Says clearly why when it cannot. */
export async function sendResetLink(ctx, userId, meta) {
  const { rows } = await getPool().query(`SELECT ${USER_COLS} FROM core.app_user WHERE id = $1`, [userId]);
  const u = rows[0];
  if (!u) throw AppError.notFound('User');
  if (!u.email) throw AppError.unprocessable('This user has no e-mail address. Add one, or set a temporary password instead.');
  if (!u.is_active) throw AppError.unprocessable('This account is deactivated. Activate it first.');
  if (u.is_locked) throw AppError.unprocessable('This account is locked. Unlock it first.');
  const { rows: me } = await getPool().query('SELECT full_name FROM core.app_user WHERE id = $1', [ctx.userId]);
  await issueLink(u, { byAdmin: me[0]?.full_name ?? 'administrator', adminId: ctx.userId, ip: meta.ip, meta });
  return { email: u.email, minutes: LINK_MINUTES };
}

async function findLink(db, token, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT r.id, r.user_id, r.expires_at, r.used_at, u.employee_code, u.full_name, u.is_active, u.is_locked
       FROM core.password_reset r JOIN core.app_user u ON u.id = r.user_id
      WHERE r.token_hash = $1 ${forUpdate ? 'FOR UPDATE OF r' : ''}`,
    [hashToken(token)],
  );
  const r = rows[0];
  if (!r) return { error: 'This reset link is not valid. Ask for a new link.' };
  if (r.used_at) return { error: 'This reset link has already been used or replaced by a newer one. Ask for a new link.' };
  if (r.expires_at <= new Date()) return { error: 'This reset link has expired. Ask for a new link.' };
  if (!r.is_active || r.is_locked) return { error: 'This account cannot be reset. Contact the administrator.' };
  return { link: r };
}

/** For the reset page: is the link still good, and whose is it. */
export async function checkLink(token) {
  const { link, error } = await findLink(getPool(), token);
  if (error) return { valid: false, message: error };
  return { valid: true, employeeCode: link.employee_code, fullName: link.full_name, expiresAt: link.expires_at };
}

/** Sets the new password from a link: signs out every device, clears a failed-attempts lock. */
export async function resetWithLink({ token, newPassword }, meta) {
  const pre = await checkLink(token);
  if (!pre.valid) throw AppError.unprocessable(pre.message, [{ path: 'token', message: pre.message }]);
  const problem = passwordProblems(newPassword, { employeeCode: pre.employeeCode });
  if (problem) throw AppError.unprocessable(problem, [{ path: 'newPassword', message: problem }]);
  const hash = await hashPassword(newPassword);

  const userId = await withTransaction({ requestId: meta.requestId }, async (db) => {
    const { link, error } = await findLink(db, token, { forUpdate: true });
    if (error) throw AppError.unprocessable(error, [{ path: 'token', message: error }]);
    await db.query('UPDATE core.password_reset SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [link.user_id]);
    await db.query(
      `UPDATE core.app_user SET password_hash = $2, must_change_password = false, password_changed_at = now(),
              token_version = token_version + 1, failed_login_count = 0, locked_until = NULL
        WHERE id = $1`,
      [link.user_id, hash],
    );
    await endSessions(db, { userId: link.user_id, reason: 'PASSWORD_RESET' });
    await recordAuthEvent(db, 'PASSWORD_RESET_BY_LINK', { ...meta, userId: link.user_id, employeeCode: link.employee_code });
    return link.user_id;
  });
  invalidateAccess(userId);
  forgetSessionChecks();
  return { employeeCode: pre.employeeCode };
}
