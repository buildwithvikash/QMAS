import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS, roleCreateSchema, rolePermissionsSchema, roleUpdateSchema } from '@qmas/shared';
import { txContext } from '../../db/tx.js';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { body, created, ok, params } from '../../shared/http.js';
import * as roles from './roles.service.js';

const roleParam = z.object({ code: z.string().regex(/^[A-Z_]+$/, 'Invalid role.') });
const router = Router();

router.get('/roles', requirePermission(PERMISSIONS.USERS_VIEW), async (_req, res) => ok(res, await roles.listRoles()));

router.get('/permissions', requirePermission(PERMISSIONS.USERS_VIEW), async (_req, res) => ok(res, await roles.listPermissions()));

router.put('/roles/:code/permissions', requirePermission(PERMISSIONS.ROLES_MANAGE), validate({ params: roleParam, body: rolePermissionsSchema }), async (req, res) => {
  ok(res, await roles.setRolePermissions(txContext(req), params(req).code, body(req).permissions));
});

const manage = requirePermission(PERMISSIONS.ROLES_MANAGE);

router.post('/roles', manage, validate({ body: roleCreateSchema }), async (req, res) => {
  created(res, await roles.createRole(txContext(req), body(req)));
});

router.patch('/roles/:code', manage, validate({ params: roleParam, body: roleUpdateSchema }), async (req, res) => {
  ok(res, await roles.updateRole(txContext(req), params(req).code, body(req)));
});

router.delete('/roles/:code', manage, validate({ params: roleParam }), async (req, res) => {
  ok(res, await roles.deleteRole(txContext(req), params(req).code));
});

export default router;
