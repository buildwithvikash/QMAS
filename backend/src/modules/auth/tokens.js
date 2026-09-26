import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getEnv } from '../../config/env.js';

export const ACCESS_COOKIE = 'qmas_at';
export const REFRESH_COOKIE = 'qmas_rt';
const ISSUER = 'qmas';
const AUDIENCE = 'qmas-app';

/** `sid` is the session (sign-in) the token belongs to, so ending the session stops the token. */
export function signAccessToken(user, sid = null) {
  const env = getEnv();
  return jwt.sign({ tv: user.tokenVersion, ...(sid ? { sid } : {}) }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: user.id,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: env.ACCESS_TOKEN_TTL_MIN * 60,
  });
}

/** Returns { sub, tv, sid } or null when the token is missing, expired or forged. */
export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, getEnv().JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
    return { sub: payload.sub, tv: payload.tv, sid: payload.sid ?? null };
  } catch {
    return null;
  }
}

export const newRefreshToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token) => createHash('sha256').update(token).digest();

const baseCookie = () => ({ httpOnly: true, secure: getEnv().COOKIE_SECURE, sameSite: 'strict' });

export function setAuthCookies(res, accessToken, refreshToken) {
  const env = getEnv();
  res.cookie(ACCESS_COOKIE, accessToken, { ...baseCookie(), path: '/', maxAge: env.ACCESS_TOKEN_TTL_MIN * 60_000 });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...baseCookie(), path: '/api/v1/auth', maxAge: env.REFRESH_TOKEN_TTL_HOURS * 3_600_000 });
}

export function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { ...baseCookie(), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...baseCookie(), path: '/api/v1/auth' });
}
