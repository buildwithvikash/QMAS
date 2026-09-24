import { Router } from 'express';
import { PERMISSIONS, REPORTS, reportQuery } from '@qmas/shared';
import { z } from 'zod';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { ok, params, query } from '../../shared/http.js';
import { dashboardSummary, runReport, toXlsx } from './reports.service.js';

const router = Router();
const canReport = requirePermission(PERMISSIONS.REPORTS_VIEW);

router.get('/reports', canReport, (_req, res) => ok(res, REPORTS));
router.get('/reports/:key', canReport, validate({ params: z.object({ key: z.string().max(40) }), query: reportQuery }), async (req, res) => {
  const f = query(req);
  const report = await runReport(req.user, params(req).key, f);
  if (f.format !== 'xlsx') return ok(res, report);
  const file = `${report.key}${report.from ? `_${report.from}_to_${report.to}` : ''}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(await toXlsx(report));
});
router.get('/dashboard/summary', requirePermission(PERMISSIONS.DASHBOARD_VIEW), async (req, res) => ok(res, await dashboardSummary(req.user)));

export default router;
