import { Router } from 'express';
import { PERMISSIONS } from '@qmas/shared';
import { requirePermission } from '../../middlewares/auth.js';
import { ok } from '../../shared/http.js';
import { myTasks } from './tasks.service.js';

const router = Router();
router.get('/me', requirePermission(PERMISSIONS.DASHBOARD_VIEW), async (req, res) => ok(res, await myTasks(req.user)));
export default router;
