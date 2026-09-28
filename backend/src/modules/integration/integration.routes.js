import { Router } from 'express';
import { PERMISSIONS, sapMockLotSchema } from '@qmas/shared';
import { addMockLot, sapMode } from '../../integrations/sap/index.js';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { AppError } from '../../shared/AppError.js';
import { body, created, ok, params, query } from '../../shared/http.js';
import { z } from 'zod';
import { listRuns, runSapSync } from './sapSync.service.js';
import * as monitor from './syncMonitor.service.js';

const DAY = 86_400_000;
const runsQuery = z
  .object({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    status: z.enum(['OK', 'PARTIAL', 'FAILED', 'RUNNING']).optional(),
    by: z.union([z.literal('scheduler'), z.uuid()]).optional(),
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(10),
    format: z.enum(['csv']).optional(),
  })
  .transform((v) => {
    const to = v.to ? new Date(v.to) : new Date();
    return { ...v, from: v.from ? new Date(v.from) : new Date(to.getTime() - 7 * DAY), to };
  })
  .refine((v) => v.from < v.to, { message: '"From" must be before "to".', path: ['from'] })
  .refine((v) => v.to - v.from <= 92 * DAY, { message: 'Choose a range of at most 92 days.', path: ['from'] });

const router = Router();
router.use(requirePermission(PERMISSIONS.INTEGRATION_MONITOR));

router.get('/sap/status', async (_req, res) => ok(res, { mode: sapMode(), runs: await listRuns() }));

router.get('/sap/summary', async (_req, res) => ok(res, await monitor.summary()));
router.get('/sap/starters', async (_req, res) => ok(res, await monitor.starters()));
router.get('/sap/runs', validate({ query: runsQuery }), async (req, res) => {
  const f = query(req);
  if (f.format === 'csv') {
    const day = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sap-pulls_${day(f.from)}_to_${day(new Date(f.to.getTime() - 1))}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.end(await monitor.exportCsv(f));
  }
  const { data, meta } = await monitor.listRuns(f);
  ok(res, data, meta);
});
router.get('/sap/runs/:id', validate({ params: z.object({ id: z.coerce.number().int().positive() }) }), async (req, res) => ok(res, await monitor.runDetail(params(req).id)));

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
