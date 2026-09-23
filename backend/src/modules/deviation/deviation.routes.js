import { Router } from 'express';
import { deptApprovalChainSchema, deviationActionSchema, deviationListQuery, PERMISSIONS, uuidParam } from '@qmas/shared';
import { z } from 'zod';
import { txContext } from '../../db/tx.js';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { body, ok, params, query } from '../../shared/http.js';
import * as deviation from './deviation.service.js';

const router = Router();
const canView = requirePermission(PERMISSIONS.DEVIATION_VIEW);

router.get('/', canView, validate({ query: deviationListQuery }), async (req, res) => {
  const { data, meta } = await deviation.list(req.user, query(req));
  ok(res, data, meta);
});
router.get('/:id', canView, validate({ params: uuidParam }), async (req, res) => ok(res, await deviation.detail(params(req).id, req.user)));
// Each action is authorized by role, department and plant in the service.
router.post('/:id/actions', canView, validate({ params: uuidParam, body: deviationActionSchema }), async (req, res) => {
  ok(res, await deviation.act(txContext(req), req.user, params(req).id, body(req)));
});

export default router;

/** Master Config → Department approval chain (SCM / VD). */
export const chainRouter = Router();
chainRouter.get('/', requirePermission(PERMISSIONS.MASTERS_VIEW), async (_req, res) => ok(res, await deviation.listChains()));
chainRouter.put('/:department', requirePermission(PERMISSIONS.MASTERS_MANAGE), validate({ params: z.object({ department: z.enum(['SCM', 'VD']) }), body: deptApprovalChainSchema }), async (req, res) => {
  ok(res, await deviation.updateChain(txContext(req), params(req).department, body(req)));
});
