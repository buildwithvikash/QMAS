import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { changePasswordSchema, forgotPasswordSchema, loginSchema, resetWithTokenSchema } from '@qmas/shared';
import { z } from 'zod';
import { getEnv } from '../../config/env.js';
import { authenticate } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { body, noContent, ok } from '../../shared/http.js';
import { toSessionUser } from './access.service.js';
import { clientIp } from './clientInfo.js';
import { markActive } from './sessions.js';
import * as auth from './auth.service.js';
import * as reset from './passwordReset.service.js';
import { assertAllowed } from '../network/network.service.js';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from './tokens.js';

const meta = (req) => ({ ip: clientIp(req), userAgent: req.get('user-agent'), requestId: req.id, client: req.get('x-client') === 'tablet' ? 'tablet' : 'web' });

// Brakes on password guessing (per-account lockout is handled in the service). Counted per address
// AND employee code: a whole office often reaches the server from one address (NAT, proxy), and a
// per-address count alone would lock everyone out after 30 sign-ins. A looser per-address limit
// still stops one machine from trying many accounts.
const tooMany = (message) => ({ success: false, code: 'TOO_MANY_REQUESTS', message });
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}|${String(req.body?.employeeCode ?? '').trim().toUpperCase().slice(0, 40)}`,
  message: tooMany('Too many sign-in attempts for this account from this device. Wait 15 minutes and try again.'),
});
const addressLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 2000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: tooMany('Too many sign-in attempts from this network address. Wait 15 minutes and try again.'),
});

function sendSession(res, session) {
  setAuthCookies(res, session.accessToken, session.refreshToken);
  // The tablet app cannot rely on cookies, so the tokens are also returned in the body for it
  // (requested with X-Client: tablet); the web app only ever uses the httpOnly cookies.
  const tokens = res.req.get('x-client') === 'tablet' ? { accessToken: session.accessToken, refreshToken: session.refreshToken } : {};
  return ok(res, { user: { ...toSessionUser(session.access), sessionId: session.sessionId ?? null }, ...tokens });
}

const router = Router();

router.post('/login', addressLimiter, loginLimiter, validate({ body: loginSchema }), async (req, res) => {
  sendSession(res, await auth.login(body(req), meta(req)));
});

router.post('/refresh', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
  try {
    const session = await auth.refresh(token, meta(req));
    await assertAllowed(session.access.id, clientIp(req));
    sendSession(res, session);
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

// ── Forgot password (public) ─────────────────────────────────────────────────
const resetLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, code: 'TOO_MANY_REQUESTS', message: 'Too many requests from this device. Wait 15 minutes and try again.' },
});

router.post('/forgot-password', resetLimiter, validate({ body: forgotPasswordSchema }), async (req, res) => {
  ok(res, await reset.requestReset(body(req), meta(req)));
});

const tokenQuery = z.object({ token: z.string().trim().regex(/^[A-Za-z0-9_-]{20,100}$/, 'This reset link is not valid.') });
router.get('/reset-password', resetLimiter, validate({ query: tokenQuery }), async (req, res) => {
  ok(res, await reset.checkLink(req.valid.query.token));
});

router.post('/reset-password', resetLimiter, validate({ body: resetWithTokenSchema }), async (req, res) => {
  ok(res, await reset.resetWithLink(body(req), meta(req)));
});

/** The browser reports real user activity here (at most about once a minute), for the idle sign-out. */
router.post('/activity', authenticate, async (req, res) => {
  await markActive(req.sessionId);
  noContent(res);
});

/** Session rules for the web app: idle sign-out minutes (0 = off) and one sign-in at a time. */
router.get('/session-policy', (_req, res) => ok(res, { idleMinutes: getEnv().IDLE_TIMEOUT_MIN, singleSession: getEnv().SINGLE_SESSION }));

router.get('/me', authenticate, (req, res) => ok(res, { user: { ...toSessionUser(req.user), sessionId: req.sessionId ?? null } }));

router.post('/change-password', authenticate, validate({ body: changePasswordSchema }), async (req, res) => {
  sendSession(res, await auth.changePassword(req.user, body(req), meta(req)));
});

export default router;
