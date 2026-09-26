import { Router } from 'express';
import { deptApprovalChainSchema, deviationActionSchema, deviationListQuery, PERMISSIONS, uuidParam } from '@qmas/shared';
import { z } from 'zod';
import { txContext } from '../../db/tx.js';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { body, ok, params, query } from '../../shared/http.js';
import { buildDeviationForm } from './deviation.form.js';
import * as deviation from './deviation.service.js';

const router = Router();
const canView = requirePermission(PERMISSIONS.DEVIATION_VIEW);

router.get('/counts', canView, validate({ query: deviationListQuery }), async (req, res) => ok(res, await deviation.counts(req.user, query(req))));
router.get('/', canView, validate({ query: deviationListQuery }), async (req, res) => {
  const { data, meta } = await deviation.list(req.user, query(req));
  ok(res, data, meta);
});
router.get('/:id', canView, validate({ params: uuidParam }), async (req, res) => ok(res, await deviation.detail(params(req).id, req.user)));
// The Deviation Form (review workbook layout) as PDF or Excel.
router.get('/:id/:kind', canView, validate({ params: uuidParam.extend({ kind: z.enum(['pdf', 'xlsx']) }) }), async (req, res) => {
  const d = await deviation.detail(params(req).id, req.user);
  const form = await buildDeviationForm(d);
  const kind = params(req).kind;
  res.setHeader('Content-Type', kind === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `${kind === 'pdf' ? 'inline' : 'attachment'}; filename="${d.deviationNo}.${kind}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(kind === 'pdf' ? await form.toPdf(`Deviation ${d.deviationNo}`) : await form.toXlsx());
});
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
