import { Router } from 'express';
import { PERMISSIONS, resetPasswordSchema, userCreateSchema, userListQuery, userRolesSchema, userUpdateSchema, uuidParam } from '@qmas/shared';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { txContext } from '../../db/tx.js';
import { body, created, ok, params, query } from '../../shared/http.js';
import * as users from './users.service.js';

const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id });
const router = Router();
const canView = requirePermission(PERMISSIONS.USERS_VIEW);
const canManage = requirePermission(PERMISSIONS.USERS_MANAGE);

router.get('/', canView, validate({ query: userListQuery }), async (req, res) => {
  const { data, meta: pageMeta } = await users.list(query(req));
  ok(res, data, pageMeta);
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

export default router;
