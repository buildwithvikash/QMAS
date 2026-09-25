import { Router } from 'express';
import { PERMISSIONS } from '@qmas/shared';
import { requirePermission } from '../../middlewares/auth.js';
import { ok } from '../../shared/http.js';
import { myRecent, myTasks } from './tasks.service.js';

const router = Router();
router.get('/me', requirePermission(PERMISSIONS.DASHBOARD_VIEW), async (req, res) => ok(res, await myTasks(req.user)));
router.get('/recent', requirePermission(PERMISSIONS.DASHBOARD_VIEW), async (req, res) => ok(res, await myRecent(req.user)));
export default router;
