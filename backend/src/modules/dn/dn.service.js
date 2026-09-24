import { createHash, randomUUID } from 'node:crypto';
import { CAPA_DUE_DAYS, CAPA_REMINDER_EVERY_DAYS, DN_MAX_IMAGES, PERMISSIONS } from '@qmas/shared';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { putObject, sniffType } from '../../integrations/storage/index.js';
import { AppError } from '../../shared/AppError.js';
import { camelRow, pageMeta } from '../../shared/sql.js';
import { plantScope } from '../auth/access.service.js';
import { notifyUsers } from '../notifications/notify.js';
import * as imirRepo from '../imir/imir.repo.js';
import { issueNumber } from '../numbering/numbering.service.js';
import { history, logAction } from '../workflow/history.js';
import { actingRole } from '../workflow/rules.js';
import * as repo from './dn.repo.js';

/**
 * Defect Notification, Incoming variant (slide 13):
 *   IQC Incharge raises it from an escalated lot → OPEN (number and date stamped once)
 *   Incharge uploads the vendor's CAPA → CAPA_SUBMITTED
 *   IQC Head approves → CLOSED (stakeholders told), or asks for resubmission → OPEN (new CAPA cycle)
 * The vendor has 3 days for the CAPA; the worker reminds on the due day and every 2 days after.
 */

const P = PERMISSIONS;
const DAY = 24 * 3_600_000;
const MAX_CAPA_FILES = 10;

// ── Reading ───────────────────────────────────────────────────────────────────

export async function list(user, filters) {
  const scope = plantScope(user, P.DN_VIEW, 'view');
  const { rows, total } = await repo.list(getPool(), filters, scope);
  return { data: rows, meta: pageMeta(filters, total) };
}

function assertCanView(user, dn) {
  const scope = plantScope(user, P.DN_VIEW, 'view');
  if (!scope.all && !scope.plantIds.includes(dn.plantId)) throw AppError.notFound('Defect notification');
}

export function dnActions(user, dn) {
  const out = [];
  if (dn.status === 'OPEN' && actingRole(user, { permission: P.DN_MANAGE, plantId: dn.plantId })) out.push('edit', 'submit_capa');
  if (dn.status === 'CAPA_SUBMITTED' && actingRole(user, { permission: P.DN_APPROVE_CAPA, plantId: dn.plantId })) out.push('approve_capa', 'resubmit');
  return out;
}

export async function detail(id, user, db = getPool()) {
  const dn = await repo.get(db, id);
  if (!dn) throw AppError.notFound('Defect notification');
  if (user) assertCanView(user, dn);
  const capas = await repo.capas(db, id);
  const files = (await repo.attachments(db, id)).map(({ storageKey, ...f }) => f);
  const steps = dn.imirId ? (await history(db, dn.imirId)).filter((h) => h.dnId === id) : [];
  return {
    ...dn,
    lines: await repo.lines(db, id),
    capas,
    images: files.filter((f) => f.entityType === 'DN'),
    capaFiles: files.filter((f) => f.entityType === 'CAPA').map((f) => ({ ...f, cycleNo: Number(f.ref) })),
    nextCycleNo: capas.length + 1,
    history: steps,
    allowedActions: user ? dnActions(user, dn) : [],
  };
}

// ── Raising ───────────────────────────────────────────────────────────────────

/** A DN can be raised once the lot has been escalated to the IQC Head (slide 7), one per lot. */
export async function canRaiseFrom(db, imir) {
  const { rows } = await db.query("SELECT 1 FROM qms.imir_action WHERE imir_id = $1 AND action = 'ESCALATE' AND deviation_id IS NULL LIMIT 1", [imir.id]);
  return rows.length > 0;
}

export async function create(ctx, user, { imirId }) {
  const id = await withTransaction(ctx, async (db) => {
    const imir = await imirRepo.get(db, imirId, { forUpdate: true });
    if (!imir) throw AppError.notFound('IMIR');
    const role = actingRole(user, { permission: P.DN_MANAGE, plantId: imir.plantId });
    if (!role) throw AppError.forbidden('You cannot raise defect notifications for this plant.');
    const existing = await repo.summaryForImir(db, imirId);
    if (existing) throw AppError.conflict(`DN ${existing.dnNo} already exists for this lot.`, { code: 'DN_EXISTS', errors: [{ path: 'dnId', message: existing.id }] });
    if (!(await canRaiseFrom(db, imir))) throw AppError.conflict('A DN can be raised once the lot has been escalated to the IQC Head.', { code: 'NOT_ESCALATED' });

    const now = new Date();
    const { docNo } = await issueNumber(db, { docType: 'DN', plantId: imir.plantId, src: 'IL', at: now, userId: user.id });
    const prefill = await prefillFromImir(db, imir);
    const { rows } = await db.query(
      `INSERT INTO qms.defect_notification (dn_no, imir_id, plant_id, item_id, vendor_id, dn_date, model, received_qty, checked_qty, defective_qty,
              defect, capa_due_at, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) RETURNING id`,
      [docNo, imir.id, imir.plantId, imir.itemId, imir.vendorId, now, imir.model, imir.inwardQty, imir.sampleSize, imir.defectiveSamples?.length ?? 0,
        prefill.defect, new Date(now.getTime() + CAPA_DUE_DAYS * DAY), user.id],
    );
    await repo.replaceLines(db, rows[0].id, prefill.lines);
    await logAction(db, { imirId: imir.id, dnId: rows[0].id, action: 'DN_RAISE', actorId: user.id, actingRole: role, payload: { dnNo: docNo } });
    return rows[0].id;
  });
  return detail(id, user);
}

/** Defect table from the failed checkpoints; defect text from the escalation remark. */
async function prefillFromImir(db, imir) {
  const checkpoints = await imirRepo.formatCheckpoints(db, imir.formatVersionId);
  const states = new Map((await imirRepo.checkpointStates(db, imir.id)).map((s) => [s.checkpointUid, s]));
  const cells = await imirRepo.observations(db, imir.id);
  const lines = checkpoints
    .filter((c) => states.get(c.uid)?.result === 'NOK')
    .map((c) => {
      const s = states.get(c.uid);
      const bad = cells.filter((o) => o.checkpointUid === c.uid && o.decision === 'NOK');
      const observation = c.section === 'RELIABILITY'
        ? s.textObservation
        : bad.map((o) => (c.section === 'DIMENSIONAL' ? `S${o.sampleNo}: ${o.value}${c.uom ? ` ${c.uom}` : ''}` : `S${o.sampleNo}: NOK`)).join(', ');
      return { parameter: c.checkpoint, specification: c.specification, observation: [observation, s.inchargeRemark].filter(Boolean).join(' — ') || null };
    });
  const { rows } = await db.query("SELECT remark FROM qms.imir_action WHERE imir_id = $1 AND action = 'ESCALATE' AND deviation_id IS NULL ORDER BY at DESC LIMIT 1", [imir.id]);
  return { lines, defect: rows[0]?.remark ?? imir.inspectorRemark ?? null };
}

// ── Editing ───────────────────────────────────────────────────────────────────

const COLUMNS = { model: 'model', receivedQty: 'received_qty', checkedQty: 'checked_qty', defectiveQty: 'defective_qty', capaApplicable: 'capa_applicable', defect: 'defect', correction: 'correction' };

async function lockOpen(db, user, id) {
  const dn = await repo.get(db, id, { forUpdate: true });
  if (!dn) throw AppError.notFound('Defect notification');
  assertCanView(user, dn);
  const role = actingRole(user, { permission: P.DN_MANAGE, plantId: dn.plantId });
  if (!role) throw AppError.forbidden('You cannot change defect notifications of this plant.');
  if (dn.status !== 'OPEN') throw AppError.conflict(`DN ${dn.dnNo} is ${dn.status === 'CLOSED' ? 'closed' : 'with the IQC Head'}; it cannot be changed now.`, { code: 'DN_NOT_EDITABLE' });
  return { dn, role };
}

export async function update(ctx, user, id, body) {
  await withTransaction(ctx, async (db) => {
    const { dn } = await lockOpen(db, user, id);
    if (dn.rowVersion !== body.rowVersion) throw AppError.staleVersion('This DN');
    const merged = { receivedQty: dn.receivedQty, checkedQty: dn.checkedQty, defectiveQty: dn.defectiveQty, ...pick(body, ['receivedQty', 'checkedQty', 'defectiveQty']) };
    if (merged.defectiveQty != null && merged.checkedQty != null && merged.defectiveQty > merged.checkedQty) throw AppError.unprocessable('Defective qty cannot exceed checked qty.', [{ path: 'defectiveQty', message: 'Defective qty cannot exceed checked qty.' }]);
    if (merged.checkedQty != null && merged.receivedQty != null && merged.checkedQty > merged.receivedQty) throw AppError.unprocessable('Checked qty cannot exceed received qty.', [{ path: 'checkedQty', message: 'Checked qty cannot exceed received qty.' }]);

    const sets = [];
    const args = [id];
    for (const [k, col] of Object.entries(COLUMNS)) {
      if (body[k] === undefined) continue;
      args.push(body[k]);
      sets.push(`${col} = $${args.length}`);
      if (k === 'capaApplicable') sets.push(`capa_due_at = CASE WHEN $${args.length}::boolean THEN dn_date + make_interval(days => ${CAPA_DUE_DAYS}) END`);
    }
    // Always touched (row_version bumps) so line-only edits are versioned too.
    await db.query(`UPDATE qms.defect_notification SET ${[...sets, 'updated_at = now()'].join(', ')} WHERE id = $1`, args);
    if (body.lines) await repo.replaceLines(db, id, body.lines);
  });
  return detail(id, user);
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/** DN images (≤ 4 photos) or CAPA documents (photos or PDF, for the next CAPA cycle). */
export async function addAttachment(ctx, user, id, { kind }, file) {
  const type = sniffType(file.buffer);
  if (!type) throw AppError.unprocessable('Upload a JPEG, PNG or WebP photo, or a PDF.');
  if (kind === 'IMAGE' && type.mime === 'application/pdf') throw AppError.unprocessable('DN images must be photos (JPEG, PNG or WebP).');
  const fileId = randomUUID();
  const key = `dn/${id}/${fileId}${type.ext}`;
  // Checks first, file write second, row last: a failed check stores nothing.
  const pre = await detail(id, user);
  if (!pre.allowedActions.includes('edit')) throw AppError.conflict('Files can only be added while the DN is open.', { code: 'DN_NOT_EDITABLE' });
  if (kind === 'IMAGE' && pre.images.length >= DN_MAX_IMAGES) throw AppError.unprocessable(`A DN takes at most ${DN_MAX_IMAGES} images. Remove one first.`);
  if (kind === 'CAPA' && pre.capaFiles.filter((f) => f.cycleNo === pre.nextCycleNo).length >= MAX_CAPA_FILES) throw AppError.unprocessable(`At most ${MAX_CAPA_FILES} CAPA files per submission.`);
  await putObject(key, file.buffer);
  return withTransaction(ctx, async (db) => {
    const { dn } = await lockOpen(db, user, id);
    const { rows } = await db.query(
      `INSERT INTO qms.attachment (id, entity_type, entity_id, ref, file_name, mime_type, size_bytes, sha256, storage_key, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, entity_type, ref, file_name, mime_type, size_bytes, uploaded_at`,
      [fileId, kind === 'IMAGE' ? 'DN' : 'CAPA', dn.id, kind === 'IMAGE' ? 'IMAGE' : String(pre.nextCycleNo), file.originalname.slice(0, 200), type.mime, file.size,
        createHash('sha256').update(file.buffer).digest('hex'), key, user.id],
    );
    return camelRow(rows[0]);
  });
}

/** Whether a DN/CAPA file may still be removed: DN open, and CAPA files only of the unsent cycle. */
export async function assertCanRemoveFile(user, attachment) {
  const dn = await detail(attachment.entityId, user);
  if (!dn.allowedActions.includes('edit')) throw AppError.conflict('Files can only be removed while the DN is open.');
  if (attachment.entityType === 'CAPA' && Number(attachment.ref) !== dn.nextCycleNo) throw AppError.conflict('This CAPA file was part of a submitted CAPA and is kept as evidence.');
}

// ── CAPA cycle ────────────────────────────────────────────────────────────────

export async function act(ctx, user, id, body) {
  await withTransaction(ctx, async (db) => {
    const dn = await repo.get(db, id, { forUpdate: true });
    if (!dn) throw AppError.notFound('Defect notification');
    assertCanView(user, dn);
    const from = body.action === 'submit_capa' ? 'OPEN' : 'CAPA_SUBMITTED';
    if (dn.status !== from) throw AppError.conflict(`DN ${dn.dnNo} is ${dn.status.replace('_', ' ').toLowerCase()}; this action is not possible now.`, { code: 'WRONG_STATUS' });
    const role = actingRole(user, { permission: body.action === 'submit_capa' ? P.DN_MANAGE : P.DN_APPROVE_CAPA, plantId: dn.plantId });
    if (!role) throw AppError.forbidden(body.action === 'submit_capa' ? 'You cannot submit CAPA for this plant.' : 'You cannot review CAPA for this plant.');
    if (dn.rowVersion !== body.rowVersion) throw AppError.staleVersion('This DN');
    const log = (action, toStatus, payload = null) => logAction(db, { imirId: dn.imirId, dnId: id, action, fromStatus: dn.status, toStatus, actorId: user.id, actingRole: role, remark: body.remark ?? null, payload });

    if (body.action === 'submit_capa') {
      const lines = await repo.lines(db, id);
      if (!dn.defect && !lines.length) throw AppError.unprocessable('Describe the defect (defect text or defect table) before sending the DN.');
      let cycle = null;
      if (dn.capaApplicable) {
        if (!body.capa) throw AppError.unprocessable('Enter the vendor\'s CAPA: root cause, corrective action, target date and responsibility.', [{ path: 'capa', message: 'Required.' }]);
        const { rows } = await db.query('SELECT coalesce(max(cycle_no), 0) + 1 AS n FROM qms.dn_capa WHERE dn_id = $1', [id]);
        cycle = rows[0].n;
        const c = body.capa;
        await db.query(
          `INSERT INTO qms.dn_capa (dn_id, cycle_no, root_cause, corrective_action, target_date, closing_date, responsibility, remark, submitted_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, cycle, c.rootCause, c.correctiveAction, c.targetDate, c.closingDate ?? null, c.responsibility, body.remark ?? null, user.id],
        );
      }
      await db.query("UPDATE qms.defect_notification SET status = 'CAPA_SUBMITTED' WHERE id = $1", [id]);
      await log('DN_SUBMIT_CAPA', 'CAPA_SUBMITTED', { cycle, capaApplicable: dn.capaApplicable });
    } else if (body.action === 'approve_capa') {
      await reviewLatest(db, id, 'APPROVED', user, body.remark);
      await db.query("UPDATE qms.defect_notification SET status = 'CLOSED', closed_at = now(), closed_by = $2 WHERE id = $1", [id, user.id]);
      await log('DN_CLOSE', 'CLOSED');
    } else {
      await reviewLatest(db, id, 'RESUBMIT', user, body.remark);
      await db.query("UPDATE qms.defect_notification SET status = 'OPEN' WHERE id = $1", [id]);
      await log('DN_RESUBMIT', 'OPEN');
    }
  });
  return detail(id, user);
}

async function reviewLatest(db, dnId, decision, user, remark) {
  await db.query(
    `UPDATE qms.dn_capa SET review_decision = $2, review_remark = $3, reviewed_by = $4, reviewed_at = now()
      WHERE dn_id = $1 AND cycle_no = (SELECT max(cycle_no) FROM qms.dn_capa WHERE dn_id = $1) AND review_decision IS NULL`,
    [dnId, decision, remark ?? null, user.id],
  );
}

// ── Mail to myself ────────────────────────────────────────────────────────────

/** Queues the DN as a PDF to the signed-in user's own address ("Send mail to myself"). */
export async function mailToSelf(ctx, user, id) {
  const dn = await detail(id, user);
  const { rows } = await getPool().query('SELECT email FROM core.app_user WHERE id = $1', [user.id]);
  if (!rows[0]?.email) throw AppError.unprocessable('Your account has no e-mail address. Ask the administrator to add one.');
  await withTransaction(ctx, (db) =>
    notifyUsers(db, [{ id: user.id, email: rows[0].email }], {
      kind: 'MAIL_SELF', title: `DN ${dn.dnNo} (PDF attached)`, body: `${dn.itemCode} · ${dn.itemDescription}\nVendor: ${dn.vendorName}`, link: `/dns/${id}`, attachment: { type: 'DN_PDF', id },
    }),
  );
  return { email: rows[0].email };
}

// ── Reminders (worker) ────────────────────────────────────────────────────────

/** CAPA overdue: remind on the due day, then every 2 days while the DN stays open. */
export async function runCapaReminders({ now = new Date() } = {}) {
  const { rows } = await getPool().query(
    `SELECT id FROM qms.defect_notification
      WHERE status = 'OPEN' AND capa_applicable AND capa_due_at <= $1
        AND (last_reminder_at IS NULL OR last_reminder_at <= $1::timestamptz - make_interval(days => ${CAPA_REMINDER_EVERY_DAYS}))`,
    [now],
  );
  let reminded = 0;
  for (const { id } of rows) {
    await withTransaction({}, async (db) => {
      const dn = await repo.get(db, id, { forUpdate: true });
      if (dn.status !== 'OPEN') return;
      await db.query('UPDATE qms.defect_notification SET last_reminder_at = $2 WHERE id = $1', [id, now]);
      await logAction(db, { imirId: dn.imirId, dnId: id, action: 'CAPA_REMINDER', payload: { capaDueAt: dn.capaDueAt } });
      reminded += 1;
    });
  }
  return { reminded };
}
