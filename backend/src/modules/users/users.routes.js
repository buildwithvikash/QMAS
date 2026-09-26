import { Router } from 'express';
import { lockUserSchema, PERMISSIONS, resetPasswordSchema, userCreateSchema, userListQuery, userRolesSchema, userUpdateSchema, uuidParam } from '@qmas/shared';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { txContext } from '../../db/tx.js';
import { body, created, ok, params, query } from '../../shared/http.js';
import { clientIp } from '../auth/clientInfo.js';
import * as users from './users.service.js';

const meta = (req) => ({ ip: clientIp(req), userAgent: req.get('user-agent'), requestId: req.id });
const router = Router();
const canView = requirePermission(PERMISSIONS.USERS_VIEW);
const canManage = requirePermission(PERMISSIONS.USERS_MANAGE);

router.get('/', canView, validate({ query: userListQuery }), async (req, res) => {
  const { data, meta: pageMeta } = await users.list(query(req));
  ok(res, data, pageMeta);
});

// Declared before /:id so these words are not read as user ids.
router.get('/summary', canView, async (_req, res) => ok(res, await users.summary()));
router.get('/sessions', canView, async (_req, res) => ok(res, await users.activeSessions()));
router.post('/sessions/end-all', canManage, async (req, res) => ok(res, await users.endAllSessions(txContext(req), meta(req))));
router.post('/sessions/:id/end', canManage, validate({ params: uuidParam }), async (req, res) => {
  ok(res, await users.endSession(txContext(req), params(req).id, req.sessionId, meta(req)));
});

router.get('/:id', canView, validate({ params: uuidParam }), async (req, res) => {
  ok(res, await users.get(params(req).id));
});

router.post('/', canManage, validate({ body: userCreateSchema }), async (req, res) => {
  created(res, await users.create(txContext(req), body(req)));
});

router.patch('/:id', canManage, validate({ params: uuidParam, body: userUpdateSchema }), async (req, res) => {
  ok(res, await users.update(txContext(req), params(req).id, body(req)));
});

router.put('/:id/roles', canManage, validate({ params: uuidParam, body: userRolesSchema }), async (req, res) => {
  ok(res, await users.setRoles(txContext(req), params(req).id, body(req)));
});

router.post('/:id/reset-password', canManage, validate({ params: uuidParam, body: resetPasswordSchema }), async (req, res) => {
  ok(res, await users.resetPassword(txContext(req), params(req).id, body(req), meta(req)));
});

router.post('/:id/unlock', canManage, validate({ params: uuidParam }), async (req, res) => {
  ok(res, await users.unlock(txContext(req), params(req).id, meta(req)));
});

router.post('/:id/lock', canManage, validate({ params: uuidParam, body: lockUserSchema }), async (req, res) => {
  ok(res, await users.lock(txContext(req), params(req).id, body(req), meta(req)));
});

router.post('/:id/force-logout', canManage, validate({ params: uuidParam }), async (req, res) => {
  ok(res, await users.forceLogout(txContext(req), params(req).id, meta(req)));
});

router.post('/:id/send-reset-link', canManage, validate({ params: uuidParam }), async (req, res) => {
  ok(res, await users.sendResetLink(txContext(req), params(req).id, meta(req)));
});

router.get('/:id/sessions', canView, validate({ params: uuidParam }), async (req, res) => {
  ok(res, await users.sessionsOf(params(req).id));
});

export default router;
