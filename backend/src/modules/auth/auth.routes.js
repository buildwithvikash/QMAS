import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { changePasswordSchema, loginSchema } from '@qmas/shared';
import { authenticate } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { body, noContent, ok } from '../../shared/http.js';
import { toSessionUser } from './access.service.js';
import * as auth from './auth.service.js';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from './tokens.js';

const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id });

// Per-IP brake on password guessing; per-account lockout is handled in the service.
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, code: 'TOO_MANY_REQUESTS', message: 'Too many sign-in attempts from this device. Wait 15 minutes and try again.' },
});

function sendSession(res, session) {
  setAuthCookies(res, session.accessToken, session.refreshToken);
  // The tablet app cannot rely on cookies, so the tokens are also returned in the body for it
  // (requested with X-Client: tablet); the web app only ever uses the httpOnly cookies.
  const tokens = res.req.get('x-client') === 'tablet' ? { accessToken: session.accessToken, refreshToken: session.refreshToken } : {};
  return ok(res, { user: toSessionUser(session.access), ...tokens });
}

const router = Router();

router.post('/login', loginLimiter, validate({ body: loginSchema }), async (req, res) => {
  sendSession(res, await auth.login(body(req), meta(req)));
});

router.post('/refresh', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
  try {
    sendSession(res, await auth.refresh(token, meta(req)));
  } catch (err) {
    if (err.code !== 'REFRESH_RACE') clearAuthCookies(res);
    throw err;
  }
});

router.post('/logout', async (req, res) => {
  await auth.logout(req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken, meta(req));
  clearAuthCookies(res);
  noContent(res);
});

router.get('/me', authenticate, (req, res) => ok(res, { user: toSessionUser(req.user) }));

router.post('/change-password', authenticate, validate({ body: changePasswordSchema }), async (req, res) => {
  sendSession(res, await auth.changePassword(req.user, body(req), meta(req)));
});

export default router;
