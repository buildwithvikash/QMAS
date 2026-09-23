import { loadAccess } from '../modules/auth/access.service.js';
import { ACCESS_COOKIE, verifyAccessToken } from '../modules/auth/tokens.js';
import { AppError } from '../shared/AppError.js';

function readToken(req) {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7); // tablet app
  return req.cookies?.[ACCESS_COOKIE]; // web app
}

/**
 * Verifies the access token and attaches req.user (identity, role assignments, permissions).
 * A deactivated user or a bumped token_version (password reset, forced sign-out) is rejected
 * even while the token itself has not expired.
 */
export async function authenticate(req, _res, next) {
  const payload = readToken(req) && verifyAccessToken(readToken(req));
  if (!payload) return next(AppError.unauthorized());
  const access = await loadAccess(payload.sub);
  if (!access || !access.isActive || access.tokenVersion !== payload.tv) {
    return next(AppError.unauthorized('Your session has ended. Please sign in again.'));
  }
  req.user = access;
  next();
}

/** Blocks everything except the password change until a temporary password has been replaced. */
export function requirePasswordCurrent(req, _res, next) {
  if (req.user?.mustChangePassword) {
    return next(AppError.forbidden('Change your temporary password to continue.', { code: 'PASSWORD_CHANGE_REQUIRED' }));
  }
  next();
}

/** Allows the request when the user holds every listed permission. */
export const requirePermission = (...keys) => (req, _res, next) => {
  if (!keys.every((k) => req.user?.permissions.has(k))) return next(AppError.forbidden());
  next();
};
