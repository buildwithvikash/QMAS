import { Router } from 'express';
import { PERMISSIONS, sapMockLotSchema } from '@qmas/shared';
import { addMockLot, sapMode } from '../../integrations/sap/index.js';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { AppError } from '../../shared/AppError.js';
import { body, created, ok } from '../../shared/http.js';
import { listRuns, runSapSync } from './sapSync.service.js';

const router = Router();
router.use(requirePermission(PERMISSIONS.INTEGRATION_MONITOR));

router.get('/sap/status', async (_req, res) => ok(res, { mode: sapMode(), runs: await listRuns() }));

router.post('/sap/sync', async (req, res) => {
  const result = await runSapSync({ userId: req.user.id, log: req.log });
  if (result.skipped) throw AppError.conflict(result.reason, { code: 'SYNC_RUNNING' });
  ok(res, result);
});

/** Development/UAT only: simulate a QA32 lot while the real SAP API is not connected. */
router.post('/sap/mock-lots', validate({ body: sapMockLotSchema }), async (req, res) => {
  if (sapMode() !== 'mock') throw AppError.conflict('Simulated lots are only available while SAP runs in mock mode.');
  created(res, { sapLotNo: await addMockLot(body(req), req.user.id) });
});

export default router;
