import { Router } from 'express';
import { z } from 'zod';
import { checkoutSchema, deviceCreateSchema, deviceUpdateSchema, PERMISSIONS, releaseSchema, syncPushSchema, uuidParam } from '@qmas/shared';
import { txContext } from '../../db/tx.js';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { body, created, ok, params } from '../../shared/http.js';
import * as sync from './sync.service.js';

const canManage = requirePermission(PERMISSIONS.DEVICES_MANAGE);
const canInspect = requirePermission(PERMISSIONS.IMIR_INSPECT);

export const devicesRouter = Router();
devicesRouter.get('/', canManage, async (_req, res) => ok(res, await sync.listDevices()));
devicesRouter.post('/', canManage, validate({ body: deviceCreateSchema }), async (req, res) => created(res, await sync.createDevice(txContext(req), body(req))));
devicesRouter.patch('/:id', canManage, validate({ params: uuidParam, body: deviceUpdateSchema }), async (req, res) => {
  ok(res, await sync.updateDevice(txContext(req), params(req).id, body(req)));
});
devicesRouter.get('/by-code/:code', canInspect, validate({ params: z.object({ code: z.string().regex(/^[A-Za-z0-9-]{1,30}$/) }) }), async (req, res) => {
  ok(res, await sync.deviceByCode(req.user, params(req).code));
});

export const syncRouter = Router();
syncRouter.post('/checkout', canInspect, validate({ body: checkoutSchema }), async (req, res) => ok(res, await sync.checkout(txContext(req), req.user, body(req))));
syncRouter.post('/release', validate({ body: releaseSchema }), async (req, res) => ok(res, await sync.release(txContext(req), req.user, body(req))));
syncRouter.post('/push', canInspect, validate({ body: syncPushSchema }), async (req, res) => ok(res, await sync.push({ ...txContext(req) }, req.user, body(req))));
syncRouter.get('/devices/:id/checkouts', canInspect, validate({ params: uuidParam }), async (req, res) => ok(res, await sync.checkoutsOfDevice(req.user, params(req).id)));
