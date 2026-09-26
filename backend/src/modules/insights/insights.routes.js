import { Router } from 'express';
import { PERMISSIONS, uuidParam } from '@qmas/shared';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { ok } from '../../shared/http.js';
import { lotInsights, overview } from './insights.service.js';

const router = Router();

/** A lot's history, drift, alerts, focus and supplier risk (anyone who can see the lot). */
router.get('/imirs/:id', requirePermission(PERMISSIONS.IMIR_VIEW), validate({ params: uuidParam }), async (req, res) => ok(res, await lotInsights(req.params.id, req.user)));

/** Plant-wide: supplier risk ranking, open lots most likely to fail, drifting characteristics. */
router.get('/overview', requirePermission(PERMISSIONS.AI_ASSIST), async (req, res) => ok(res, await overview(req.user)));

export default router;
