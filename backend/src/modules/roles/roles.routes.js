import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS, rolePermissionsSchema } from '@qmas/shared';
import { txContext } from '../../db/tx.js';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { body, ok, params } from '../../shared/http.js';
import * as roles from './roles.service.js';

const roleParam = z.object({ code: z.string().regex(/^[A-Z_]+$/, 'Invalid role.') });
const router = Router();

router.get('/roles', requirePermission(PERMISSIONS.USERS_VIEW), async (_req, res) => ok(res, await roles.listRoles()));

router.get('/permissions', requirePermission(PERMISSIONS.USERS_VIEW), async (_req, res) => ok(res, await roles.listPermissions()));

router.put('/roles/:code/permissions', requirePermission(PERMISSIONS.ROLES_MANAGE), validate({ params: roleParam, body: rolePermissionsSchema }), async (req, res) => {
  ok(res, await roles.setRolePermissions(txContext(req), params(req).code, body(req).permissions));
});

export default router;
