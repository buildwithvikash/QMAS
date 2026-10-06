import { Router } from 'express';
import { idParam, PERMISSIONS, REVERSAL_ENTITIES, reversalApproveSchema, reversalListQuery, reversalRejectSchema, reversalRequestSchema } from '@qmas/shared';
import { z } from 'zod';
import { txContext } from '../../db/tx.js';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { body, ok, params, query } from '../../shared/http.js';
import * as reversal from './reversal.service.js';

/**
 * Reversal requests. Anyone signed in may ask to reverse their own decision (the service checks
 * that nobody else acted since); reviewing needs workflow.reverse.
 */
const router = Router();
const canReverse = requirePermission(PERMISSIONS.WORKFLOW_REVERSE);

router.get('/record/:entityType/:entityId', validate({ params: z.object({ entityType: z.enum(REVERSAL_ENTITIES), entityId: z.uuid() }) }), async (req, res) => {
  ok(res, await reversal.forRecord(req.user, params(req).entityType, params(req).entityId));
});
router.get('/mine', async (req, res) => ok(res, await reversal.mine(req.user)));
router.post('/', validate({ body: reversalRequestSchema }), async (req, res) => {
  const b = body(req);
  await reversal.request(txContext(req), req.user, b);
  ok(res, await reversal.forRecord(req.user, b.entityType, b.entityId));
});
router.post('/:id/withdraw', validate({ params: idParam }), async (req, res) => {
  await reversal.withdraw(txContext(req), req.user, params(req).id);
  ok(res, { withdrawn: true });
});

router.get('/', canReverse, validate({ query: reversalListQuery }), async (req, res) => {
  const { data, meta } = await reversal.list(query(req));
  ok(res, data, meta);
});
router.get('/:id', canReverse, validate({ params: idParam }), async (req, res) => ok(res, await reversal.get(params(req).id)));
router.post('/:id/approve', canReverse, validate({ params: idParam, body: reversalApproveSchema }), async (req, res) => {
  ok(res, await reversal.approve(txContext(req), req.user, params(req).id, body(req)));
});
router.post('/:id/reject', canReverse, validate({ params: idParam, body: reversalRejectSchema }), async (req, res) => {
  ok(res, await reversal.reject(txContext(req), req.user, params(req).id, body(req)));
});

export default router;
