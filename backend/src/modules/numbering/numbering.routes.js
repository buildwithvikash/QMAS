import { Router } from 'express';
import { idParam, numberSeriesCreateSchema, numberSeriesPreviewSchema, numberSeriesStatusSchema, PERMISSIONS } from '@qmas/shared';
import { txContext } from '../../db/tx.js';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { body, created, ok, params } from '../../shared/http.js';
import * as numbering from './numbering.service.js';

const router = Router();
const canView = requirePermission(PERMISSIONS.MASTERS_VIEW);
const canManage = requirePermission(PERMISSIONS.NUMBERING_MANAGE);

router.get('/', canView, async (_req, res) => ok(res, await numbering.list()));

router.post('/preview', canView, validate({ body: numberSeriesPreviewSchema }), async (req, res) => {
  ok(res, await numbering.preview(body(req)));
});

router.post('/', canManage, validate({ body: numberSeriesCreateSchema }), async (req, res) => {
  created(res, await numbering.create(txContext(req), body(req)));
});

router.patch('/:id', canManage, validate({ params: idParam, body: numberSeriesStatusSchema }), async (req, res) => {
  ok(res, await numbering.setActive(txContext(req), params(req).id, body(req)));
});

export default router;
