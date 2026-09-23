import { Router } from 'express';
import { z } from 'zod';
import { idParam, PERMISSIONS, samplingLookupQuery, samplingPlanCreateSchema, samplingPlanUpdateSchema } from '@qmas/shared';
import { txContext } from '../../db/tx.js';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { body, created, ok, params, query } from '../../shared/http.js';
import * as sampling from './sampling.service.js';

const router = Router();
const canView = requirePermission(PERMISSIONS.MASTERS_VIEW);
const canManage = requirePermission(PERMISSIONS.SAMPLING_MANAGE);
const planRef = z.object({ id: z.union([z.literal('default'), z.coerce.number().int().positive()]) });

router.get('/', canView, async (_req, res) => ok(res, await sampling.list()));

router.get('/:id/lookup', canView, validate({ params: planRef, query: samplingLookupQuery }), async (req, res) => {
  ok(res, await sampling.lookup(params(req).id, query(req).inwardQty));
});

router.get('/:id', canView, validate({ params: idParam }), async (req, res) => ok(res, await sampling.get(params(req).id)));

router.post('/', canManage, validate({ body: samplingPlanCreateSchema }), async (req, res) => {
  created(res, await sampling.create(txContext(req), body(req)));
});

router.put('/:id', canManage, validate({ params: idParam, body: samplingPlanUpdateSchema }), async (req, res) => {
  ok(res, await sampling.update(txContext(req), params(req).id, body(req)));
});

export default router;
