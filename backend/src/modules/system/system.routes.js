import { PERMISSIONS } from '@qmas/shared';
import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { txContext } from '../../db/tx.js';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { created, ok, params, query } from '../../shared/http.js';
import { recordError } from './errorLog.js';
import * as system from './system.service.js';

const router = Router();
const canMonitor = requirePermission(PERMISSIONS.SYSTEM_MONITOR);
const idParam = z.object({ id: z.coerce.number().int().positive() });

/**
 * A crash in the user's browser (React error screen, uncaught error or rejected promise).
 * Any signed-in user; limited per user so a page stuck in a loop cannot flood the log.
 */
const clientLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many error reports.', code: 'RATE_LIMITED' },
});
const clientErrorSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  stack: z.string().max(8000).optional(),
  componentStack: z.string().max(8000).optional(),
  page: z.string().max(500).optional(),
  kind: z.enum(['render', 'error', 'rejection']).default('error'),
  appVersion: z.string().max(40).optional(),
});
router.post('/client-errors', clientLimiter, validate({ body: clientErrorSchema }), async (req, res) => {
  const b = req.valid.body;
  const id = await recordError({
    source: 'CLIENT',
    message: `${b.kind === 'render' ? 'Page crashed' : b.kind === 'rejection' ? 'Unhandled promise' : 'Browser error'}: ${b.message}`,
    detail: [b.stack, b.componentStack && `Component stack:${b.componentStack}`].filter(Boolean).join('\n\n') || null,
    path: b.page,
    requestId: req.id,
    userId: req.user?.id,
    userAgent: req.get('user-agent'),
    appVersion: b.appVersion,
  });
  created(res, { reference: String(req.id).slice(0, 8), logged: id !== null });
});

router.get('/health', canMonitor, async (_req, res) => ok(res, await system.health()));

router.get('/errors', canMonitor, validate({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(25),
    q: z.string().trim().max(100).optional(),
    status: z.enum(['open', 'resolved', 'all']).default('open'),
    source: z.enum(['SERVER', 'WORKER', 'CLIENT']).optional(),
    sort: z.enum(['lastSeen', 'firstSeen', 'occurrences']).default('lastSeen'),
    order: z.enum(['asc', 'desc']).default('desc'),
  }),
}), async (req, res) => {
  const { rows, meta } = await system.listErrors(query(req));
  ok(res, rows, meta);
});

router.get('/errors/:id', canMonitor, validate({ params: idParam }), async (req, res) => ok(res, await system.errorDetail(params(req).id)));

const noteBody = z.object({ note: z.string().trim().max(1000).optional().transform((v) => v || null) });
router.post('/errors/:id/resolve', canMonitor, validate({ params: idParam, body: noteBody }), async (req, res) => {
  ok(res, await system.setResolved(txContext(req), params(req).id, true, req.valid.body.note));
});
router.post('/errors/:id/reopen', canMonitor, validate({ params: idParam }), async (req, res) => {
  ok(res, await system.setResolved(txContext(req), params(req).id, false));
});
router.post('/errors/resolve-all', canMonitor, validate({ body: noteBody }), async (req, res) => {
  ok(res, await system.resolveAll(txContext(req), req.valid.body.note));
});

router.post('/mail/retry-failed', canMonitor, async (_req, res) => ok(res, await system.retryFailedMail()));

export default router;
