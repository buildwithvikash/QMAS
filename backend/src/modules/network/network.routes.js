import { Router } from 'express';
import { externalAccessGrantSchema, externalAccessListQuery, externalAccessRevokeSchema, idParam, networkSettingsSchema, PERMISSIONS } from '@qmas/shared';
import { txContext } from '../../db/tx.js';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { body, created, ok, params, query } from '../../shared/http.js';
import { clientIp } from '../auth/clientInfo.js';
import * as network from './network.service.js';

/** Network access: the caller's own status for everyone; settings and grants need network.manage. */
const router = Router();
const canManage = requirePermission(PERMISSIONS.NETWORK_MANAGE);

router.get('/status', async (req, res) => ok(res, await network.status(req.user, clientIp(req))));

router.get('/settings', canManage, async (req, res) => ok(res, await network.getSettings(clientIp(req))));
router.put('/settings', canManage, validate({ body: networkSettingsSchema }), async (req, res) => {
  ok(res, await network.saveSettings(txContext(req), req.user, clientIp(req), body(req)));
});

router.get('/grants', canManage, validate({ query: externalAccessListQuery }), async (req, res) => {
  const { data, meta } = await network.listGrants(query(req));
  ok(res, data, meta);
});
router.post('/grants', canManage, validate({ body: externalAccessGrantSchema }), async (req, res) => {
  created(res, await network.grant(txContext(req), req.user, body(req)));
});
router.post('/grants/:id/revoke', canManage, validate({ params: idParam, body: externalAccessRevokeSchema }), async (req, res) => {
  ok(res, await network.revoke(txContext(req), req.user, params(req).id, body(req)));
});

export default router;
