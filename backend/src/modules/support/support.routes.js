import { PERMISSIONS, supportCommentSchema, supportListQuery, supportTicketCreateSchema, supportUpdateSchema, uuidParam } from '@qmas/shared';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { txContext } from '../../db/tx.js';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { AppError } from '../../shared/AppError.js';
import { body, created, ok, params, query } from '../../shared/http.js';
import * as support from './support.service.js';

/** Help & Support. Any signed-in user; the service limits what each one sees and may change. */
const router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: support.MAX_FILE_BYTES, files: 1 } }).single('file');
const receiveFile = (req, res, next) =>
  upload(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'The file is larger than 10 MB.'));
    if (err) return next(err);
    if (!req.file) return next(AppError.unprocessable('Choose a screenshot or PDF.'));
    next();
  });

router.get('/team', requirePermission(PERMISSIONS.SUPPORT_MANAGE), async (_req, res) => {
  ok(res, (await support.supportTeam()).map((u) => ({ id: u.id, fullName: u.full_name, employeeCode: u.employee_code })));
});

router.get('/tickets/counts', validate({ query: z.object({ scope: z.enum(['mine', 'all', 'assigned']).default('mine') }) }), async (req, res) => {
  ok(res, await support.counts(req.user, query(req).scope));
});

router.get('/tickets', validate({ query: supportListQuery }), async (req, res) => {
  const { rows, meta } = await support.list(req.user, query(req));
  ok(res, rows, meta);
});

router.post('/tickets', validate({ body: supportTicketCreateSchema }), async (req, res) => {
  created(res, await support.create(txContext(req), req.user, body(req)));
});

router.get('/tickets/:id', validate({ params: uuidParam }), async (req, res) => {
  ok(res, await support.detail(req.user, params(req).id));
});

router.post('/tickets/:id/comments', validate({ params: uuidParam, body: supportCommentSchema }), async (req, res) => {
  ok(res, await support.comment(txContext(req), req.user, params(req).id, body(req)));
});

router.patch('/tickets/:id', validate({ params: uuidParam, body: supportUpdateSchema }), async (req, res) => {
  ok(res, await support.update(txContext(req), req.user, params(req).id, body(req)));
});

router.post('/tickets/:id/attachments', validate({ params: uuidParam }), receiveFile, async (req, res) => {
  created(res, await support.addAttachment(txContext(req), req.user, params(req).id, req.file));
});

router.get('/tickets/:id/attachments/:fileId', validate({ params: z.object({ id: z.uuid(), fileId: z.uuid() }) }), async (req, res) => {
  const f = await support.openAttachment(req.user, params(req).id, params(req).fileId);
  res.setHeader('Content-Type', f.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.fileName)}"`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  f.stream.on('error', () => res.destroy());
  f.stream.pipe(res);
});

export default router;
