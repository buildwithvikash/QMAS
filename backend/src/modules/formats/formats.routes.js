import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { compareQuery, createDraftSchema, formatActionSchema, formatDraftSchema, formatListQuery, PERMISSIONS, resolveConflictsSchema, sanLookupQuery, uuidParam } from '@qmas/shared';
import { txContext } from '../../db/tx.js';
import { lookupSan } from '../../integrations/san/index.js';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { AppError } from '../../shared/AppError.js';
import { body, created, ok, params, query } from '../../shared/http.js';
import * as imports from './formats.import.js';
import * as formats from './formats.service.js';

const P = PERMISSIONS;
const router = Router();
const canView = requirePermission(P.FORMATS_VIEW);
const canCreate = requirePermission(P.FORMATS_CREATE);
const canApprove = requirePermission(P.FORMATS_APPROVE);
const itemParam = z.object({ itemId: z.coerce.number().int().positive() });

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    file.mimetype === XLSX || file.originalname.toLowerCase().endsWith('.xlsx')
      ? cb(null, true)
      : cb(AppError.unprocessable('Upload an Excel .xlsx file.')),
}).single('file');
const receiveFile = (req, res, next) =>
  upload(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'The file is larger than 15 MB. Split it and import it in parts.'));
    if (err) return next(err);
    if (!req.file) return next(AppError.unprocessable('Choose an .xlsx file to upload.'));
    next();
  });

// ── Library, queue, item page ─────────────────────────────────────────────────
router.get('/', canView, validate({ query: formatListQuery }), async (req, res) => {
  const { data, meta } = await formats.library(query(req));
  ok(res, data, meta);
});
router.get('/queue', canView, async (_req, res) => ok(res, await formats.approvalQueue()));
router.get('/compare', canView, validate({ query: compareQuery }), async (req, res) => ok(res, await formats.compare(query(req).a, query(req).b)));
router.get('/items/:itemId', canView, validate({ params: itemParam }), async (req, res) => ok(res, await formats.itemFormat(params(req).itemId)));

// ── SAN/SIR preview ───────────────────────────────────────────────────────────
router.get('/san-lookup', canCreate, validate({ query: sanLookupQuery }), async (req, res) => {
  ok(res, await lookupSan(query(req), { userId: req.user.id }));
});

// ── Import (pre-fed formats) ──────────────────────────────────────────────────
router.get('/import/template', canApprove, async (_req, res) => {
  res.setHeader('Content-Type', XLSX);
  res.setHeader('Content-Disposition', 'attachment; filename="QMAS-format-import-template.xlsx"');
  res.send(Buffer.from(await imports.template()));
});
router.post('/import/check', canApprove, receiveFile, async (req, res) => ok(res, await imports.analyse(req.file.buffer)));
router.post('/import', canApprove, receiveFile, async (req, res) => {
  ok(res, await imports.commit({ ...txContext(req), log: req.log }, req.user, req.file.buffer, req.file.originalname));
});

// ── Drafts and versions ───────────────────────────────────────────────────────
router.post('/items/:itemId/drafts', canCreate, validate({ params: itemParam, body: createDraftSchema }), async (req, res) => {
  created(res, await formats.createDraft(txContext(req), req.user, params(req).itemId, body(req)));
});
router.get('/versions/:id', canView, validate({ params: uuidParam }), async (req, res) => ok(res, await formats.getVersion(params(req).id, req.user)));
router.put('/versions/:id', canCreate, validate({ params: uuidParam, body: formatDraftSchema }), async (req, res) => {
  ok(res, await formats.saveDraft(txContext(req), req.user, params(req).id, body(req)));
});
router.get('/versions/:id/merge-preview', canApprove, validate({ params: uuidParam }), async (req, res) => ok(res, await formats.mergePreview(params(req).id)));
router.post('/versions/:id/actions', canView, validate({ params: uuidParam, body: formatActionSchema }), async (req, res) => {
  ok(res, await formats.act(txContext(req), req.user, params(req).id, body(req)));
});
router.put('/versions/:id/conflicts', canView, validate({ params: uuidParam, body: resolveConflictsSchema }), async (req, res) => {
  ok(res, await formats.resolveConflicts(txContext(req), req.user, params(req).id, body(req)));
});

export default router;
