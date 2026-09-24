import { createHash, randomUUID } from 'node:crypto';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { getObjectStream, putObject, sniffType } from '../../integrations/storage/index.js';
import { AppError } from '../../shared/AppError.js';
import { camelRow } from '../../shared/sql.js';
import * as dnService from '../dn/dn.service.js';
import * as imirService from './imir.service.js';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_PER_CELL = 5;

/**
 * Photo or PDF for one visual sample cell (review workbook: "Image / PDF upload option").
 * Only while the IMIR is being inspected, by someone who may inspect it.
 */
export async function addObservationAttachment(ctx, user, imirId, { checkpointUid, sampleNo, capturedAt, deviceId }, file) {
  const type = sniffType(file.buffer);
  if (!type) throw AppError.unprocessable('Upload a JPEG, PNG or WebP photo, or a PDF.');
  const imir = await imirService.detail(imirId, user);
  if (!imir.allowedActions.includes('inspect')) throw AppError.conflict('Attachments can only be added while the lot is being inspected.', { code: 'IMIR_NOT_EDITABLE' });
  if (imir.checkoutDeviceId && imir.checkoutDeviceId !== deviceId) throw AppError.conflict(`This lot is checked out to tablet ${imir.checkoutDeviceCode}.`, { code: 'CHECKED_OUT' });
  const cp = imir.checkpoints.find((c) => c.uid === checkpointUid);
  if (!cp || cp.section !== 'VISUAL') throw AppError.unprocessable('Photos and PDFs can be attached to visual checks only.');
  const ref = `${checkpointUid}:${sampleNo}`;
  if (imir.attachments.filter((a) => a.ref === ref).length >= MAX_PER_CELL) throw AppError.unprocessable(`At most ${MAX_PER_CELL} files per sample.`);

  const id = randomUUID();
  const key = `imir/${imirId}/${id}${type.ext}`;
  await putObject(key, file.buffer);
  return withTransaction(ctx, async (db) => {
    const { rows } = await db.query(
      `INSERT INTO qms.attachment (id, entity_type, entity_id, ref, file_name, mime_type, size_bytes, sha256, storage_key, captured_at, uploaded_by)
       VALUES ($1, 'IMIR_OBSERVATION', $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, ref, file_name, mime_type, size_bytes, captured_at, uploaded_at`,
      [id, imirId, ref, file.originalname.slice(0, 200), type.mime, file.size, createHash('sha256').update(file.buffer).digest('hex'), key, capturedAt ?? null, user.id],
    );
    return camelRow(rows[0]);
  });
}

/** Opens a file for download after checking the user may see the IMIR or DN it belongs to. */
export async function openAttachment(user, id) {
  const { rows } = await getPool().query('SELECT id, entity_type, entity_id, file_name, mime_type, storage_key FROM qms.attachment WHERE id = $1 AND deleted_at IS NULL', [id]);
  const a = camelRow(rows[0]);
  if (!a) throw AppError.notFound('File');
  if (a.entityType === 'IMIR_OBSERVATION') await imirService.detail(a.entityId, user); // throws 404 if not visible
  else if (a.entityType === 'DN' || a.entityType === 'CAPA') await dnService.detail(a.entityId, user);
  else throw AppError.notFound('File');
  return { ...a, stream: getObjectStream(a.storageKey) };
}

/** Soft-deletes a file while its record is still editable (IMIR in inspection, DN open). */
export async function removeAttachment(ctx, user, id) {
  const { rows } = await getPool().query('SELECT entity_type, entity_id, ref FROM qms.attachment WHERE id = $1 AND deleted_at IS NULL', [id]);
  const a = camelRow(rows[0]);
  if (!a) throw AppError.notFound('File');
  if (a.entityType === 'IMIR_OBSERVATION') {
    const imir = await imirService.detail(a.entityId, user);
    if (!imir.allowedActions.includes('inspect')) throw AppError.conflict('Files can only be removed while the lot is being inspected.');
  } else if (a.entityType === 'DN' || a.entityType === 'CAPA') {
    await dnService.assertCanRemoveFile(user, a);
  } else {
    throw AppError.notFound('File');
  }
  await withTransaction(ctx, (db) => db.query('UPDATE qms.attachment SET deleted_at = now(), deleted_by = $2 WHERE id = $1', [id, user.id]));
}
