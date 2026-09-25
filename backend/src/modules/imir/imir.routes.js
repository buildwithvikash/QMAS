import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { imirActionSchema, imirListQuery, inspectionSaveSchema, MAX_SAMPLES, PERMISSIONS, uuidParam } from '@qmas/shared';
import { txContext } from '../../db/tx.js';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { AppError } from '../../shared/AppError.js';
import { body, created, noContent, ok, params, query } from '../../shared/http.js';
import * as files from './attachments.service.js';
import * as imir from './imir.service.js';
import { changes } from './changes.service.js';
import { renderImirPdf } from './imir.pdf.js';
import { review } from './review.service.js';

const router = Router();
const canView = requirePermission(PERMISSIONS.IMIR_VIEW);
const canInspect = requirePermission(PERMISSIONS.IMIR_INSPECT);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: files.MAX_ATTACHMENT_BYTES, files: 1 } }).single('file');
const receiveFile = (req, res, next) =>
  upload(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'The file is larger than 10 MB. Take the photo at a lower resolution.'));
    if (err) return next(err);
    if (!req.file) return next(AppError.unprocessable('Choose a photo or PDF.'));
    next();
  });
const attachmentFields = z.object({
  checkpointUid: z.uuid(),
  sampleNo: z.coerce.number().int().min(1).max(MAX_SAMPLES),
  capturedAt: z.iso.datetime({ offset: true }).optional(),
  deviceId: z.uuid().optional(),
});

router.get('/', canView, validate({ query: imirListQuery }), async (req, res) => {
  const { data, meta } = await imir.list(req.user, query(req));
  ok(res, data, meta);
});
router.get('/:id', canView, validate({ params: uuidParam }), async (req, res) => ok(res, await imir.detail(params(req).id, req.user)));

router.get('/:id/changes', canView, validate({ params: uuidParam }), async (req, res) => ok(res, await changes(params(req).id, req.user)));
router.get('/:id/pdf', canView, validate({ params: uuidParam }), async (req, res) => {
  const m = await imir.detail(params(req).id, req.user);
  if (m.status === 'AWAITING_FORMAT') throw AppError.conflict('This IMIR is not open yet, so there is nothing to print.');
  const pdf = await renderImirPdf(m);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${m.imirNo}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(pdf);
});

router.put('/:id/inspection', canInspect, validate({ params: uuidParam, body: inspectionSaveSchema }), async (req, res) => {
  ok(res, await imir.saveProgress(txContext(req), req.user, params(req).id, body(req)));
});
// submit is the inspector's; approve / revert / escalate / head_approve / hold are checked per action and plant.
router.post('/:id/actions', canView, validate({ params: uuidParam, body: imirActionSchema }), async (req, res) => {
  const b = body(req);
  if (b.action === 'submit') {
    if (!req.user.permissions.has(PERMISSIONS.IMIR_INSPECT)) throw AppError.forbidden();
    return ok(res, await imir.submit(txContext(req), req.user, params(req).id, b));
  }
  await review(txContext(req), req.user, params(req).id, b);
  ok(res, await imir.detail(params(req).id, req.user));
});

router.post('/:id/attachments', canInspect, validate({ params: uuidParam }), receiveFile, validate({ body: attachmentFields }), async (req, res) => {
  created(res, await files.addObservationAttachment(txContext(req), req.user, params(req).id, body(req), req.file));
});

export default router;

/** File download/removal lives at /files/:id so links do not depend on the owning record type. */
export const filesRouter = Router();
filesRouter.get('/:id', validate({ params: uuidParam }), async (req, res) => {
  const f = await files.openAttachment(req.user, params(req).id);
  res.setHeader('Content-Type', f.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.fileName)}"`);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  f.stream.on('error', () => res.destroy());
  f.stream.pipe(res);
});
// Who may remove a file depends on what it belongs to; checked in the service.
filesRouter.delete('/:id', validate({ params: uuidParam }), async (req, res) => {
  await files.removeAttachment(txContext(req), req.user, params(req).id);
  noContent(res);
});
