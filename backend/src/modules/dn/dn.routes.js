import { Router } from 'express';
import multer from 'multer';
import { dnActionSchema, dnCreateSchema, dnListQuery, dnUpdateSchema, PERMISSIONS, uuidParam } from '@qmas/shared';
import { z } from 'zod';
import { getPool } from '../../db/pool.js';
import { txContext } from '../../db/tx.js';
import { requirePermission } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import { AppError } from '../../shared/AppError.js';
import { body, created, ok, params, query } from '../../shared/http.js';
import { MAX_ATTACHMENT_BYTES } from '../imir/attachments.service.js';
import './dn.mail.js';
import { renderDnPdf, renderDnXlsx } from './dn.pdf.js';
import * as dn from './dn.service.js';

const router = Router();
const canView = requirePermission(PERMISSIONS.DN_VIEW);
const canManage = requirePermission(PERMISSIONS.DN_MANAGE);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } }).single('file');
const receiveFile = (req, res, next) =>
  upload(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'The file is larger than 10 MB.'));
    if (err) return next(err);
    if (!req.file) return next(AppError.unprocessable('Choose a photo or PDF.'));
    next();
  });

router.get('/counts', canView, validate({ query: dnListQuery }), async (req, res) => ok(res, await dn.counts(req.user, query(req))));
router.get('/', canView, validate({ query: dnListQuery }), async (req, res) => {
  const { data, meta } = await dn.list(req.user, query(req));
  ok(res, data, meta);
});
router.post('/', canManage, validate({ body: dnCreateSchema }), async (req, res) => created(res, await dn.create(txContext(req), req.user, body(req))));
router.get('/:id', canView, validate({ params: uuidParam }), async (req, res) => ok(res, await dn.detail(params(req).id, req.user)));
router.get('/:id/source', canView, validate({ params: uuidParam }), async (req, res) => ok(res, await dn.source(params(req).id, req.user)));
router.put('/:id', canManage, validate({ params: uuidParam, body: dnUpdateSchema }), async (req, res) => ok(res, await dn.update(txContext(req), req.user, params(req).id, body(req))));
router.post('/:id/actions', canView, validate({ params: uuidParam, body: dnActionSchema }), async (req, res) => ok(res, await dn.act(txContext(req), req.user, params(req).id, body(req))));
router.post('/:id/attachments', canManage, validate({ params: uuidParam }), receiveFile, validate({ body: z.object({ kind: z.enum(['IMAGE', 'CAPA']) }) }), async (req, res) => {
  created(res, await dn.addAttachment(txContext(req), req.user, params(req).id, body(req), req.file));
});
router.post('/:id/mail-self', canView, validate({ params: uuidParam }), async (req, res) => ok(res, await dn.mailToSelf(txContext(req), req.user, params(req).id)));
router.get('/:id/pdf', canView, validate({ params: uuidParam }), async (req, res) => {
  const detail = await dn.detail(params(req).id, req.user);
  sendFile(res, await renderDnPdf(detail, getPool()), detail.dnNo, 'pdf');
});
router.get('/:id/xlsx', canView, validate({ params: uuidParam }), async (req, res) => {
  const detail = await dn.detail(params(req).id, req.user);
  sendFile(res, await renderDnXlsx(detail, getPool()), detail.dnNo, 'xlsx');
});

/** Sends a generated file: PDF shown in the browser, Excel downloaded. */
function sendFile(res, buffer, name, kind) {
  res.setHeader('Content-Type', kind === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `${kind === 'pdf' ? 'inline' : 'attachment'}; filename="${name}.${kind}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(buffer);
}


export default router;
