import { perLot, sampleText } from '@qmas/shared';
import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../shared/AppError.js';
import { issueNumber } from '../numbering/numbering.service.js';
import { imirSnapshot, logAction } from '../workflow/history.js';
import { actingRole, IMIR_REVIEW_ACTIONS, imirReviewBlock } from '../workflow/rules.js';
import * as repo from './imir.repo.js';

/**
 * Review of a submitted IMIR (slides 7–8).
 *  Incharge:  approve → closed accepted (a failed lot needs a final approval remark);
 *             revert → back to the inspector;
 *             escalate with a non-conformance remark → IQC Head.
 *  IQC Head:  approve (with a final approval remark) → closed accepted;
 *             hold → deviation opened for SCM and VD together (the first to accept owns it).
 * Runs `detail` afterwards through the caller, so the response has the new allowed actions.
 */
export async function review(ctx, user, id, body) {
  await withTransaction(ctx, async (db) => {
    const imir = await repo.get(db, id, { forUpdate: true });
    if (!imir) throw AppError.notFound('IMIR');
    const rule = IMIR_REVIEW_ACTIONS[body.action];
    if (imir.status !== rule.from) {
      throw AppError.conflict(`This IMIR is ${imir.status.replaceAll('_', ' ').toLowerCase()}; it cannot be ${LABEL[body.action]} now.`, { code: 'WRONG_STATUS' });
    }
    const role = actingRole(user, { permission: rule.permission, plantId: imir.plantId });
    if (!role) throw AppError.forbidden('You cannot review lots of this plant at this step.');
    const blocked = imirReviewBlock(imir, body.action);
    if (blocked) throw AppError.conflict(blocked);
    if (imir.rowVersion !== body.rowVersion) throw AppError.staleVersion('This IMIR');
    if (body.action === 'approve' && imir.result !== 'OK' && !body.remark) {
      throw AppError.unprocessable('Enter the final approval remark: why this failed lot is accepted.', [{ path: 'remark', message: 'Required for a lot that failed inspection.' }]);
    }
    const snapshot = await imirSnapshot(db, id);

    for (const c of body.checkpointRemarks ?? []) {
      const { rowCount } = await db.query('UPDATE qms.imir_checkpoint SET incharge_remark = $3, updated_at = now() WHERE imir_id = $1 AND checkpoint_uid = $2', [id, c.checkpointUid, c.remark]);
      if (!rowCount) throw AppError.unprocessable('A checkpoint remark refers to a checkpoint that is not on this IMIR.');
    }

    let deviationId = null;
    let payload = null;
    if (body.action === 'revert') {
      await db.query("UPDATE qms.imir SET status = 'IN_INSPECTION', result = NULL, defective_samples = NULL, submitted_at = NULL, submitted_by = NULL WHERE id = $1", [id]);
    } else {
      await db.query(`UPDATE qms.imir SET status = $2, closed_at = CASE WHEN $2 LIKE 'CLOSED%' THEN now() END WHERE id = $1`, [id, rule.to]);
    }
    if (body.action === 'hold') {
      const dev = await openDeviation(db, user, imir, body);
      deviationId = dev.id;
      payload = { departments: ['SCM', 'VD'], suggestedActions: body.suggestedActions, deviationNo: dev.deviationNo };
    }
    if (body.action === 'approve') payload = { result: imir.result };
    await logAction(db, { imirId: id, deviationId, action: body.action.toUpperCase(), fromStatus: imir.status, toStatus: rule.to, actorId: user.id, actingRole: role, remark: body.remark ?? null, payload, snapshot });
  });
}

const LABEL = { approve: 'approved', reject: 'rejected', revert: 'sent back', escalate: 'escalated', head_approve: 'approved', hold: 'put on hold' };

/**
 * The IQC Head holds the lot: a deviation is numbered and offered to the SCM and VD initiators;
 * the department that accepts it first owns it. Specification and IQC observation are pre-filled
 * from the failed checkpoints.
 */
async function openDeviation(db, user, imir, { suggestedActions, remark }) {
  const { docNo } = await issueNumber(db, { docType: 'DEVIATION', plantId: imir.plantId, userId: user.id });
  const { specification, observation } = await failedCheckpointSummary(db, imir);
  const { rows: esc } = await db.query(
    "SELECT remark, actor_id, at FROM qms.imir_action WHERE imir_id = $1 AND action = 'ESCALATE' AND deviation_id IS NULL ORDER BY id DESC LIMIT 1",
    [imir.id],
  );
  const { rows } = await db.query(
    `INSERT INTO qms.deviation (deviation_no, imir_id, plant_id, department, suggested_actions, hold_remark, stage, specification, iqc_observation,
            incharge_remark, incharge_remark_by, incharge_remark_at, created_by, updated_by)
     VALUES ($1, $2, $3, NULL, $4, $5, 'INITIATOR', $6, $7, $8, $9, $10, $11, $11) RETURNING id`,
    [docNo, imir.id, imir.plantId, suggestedActions, remark, specification, observation, esc[0]?.remark ?? null, esc[0]?.actor_id ?? null, esc[0]?.at ?? null, user.id],
  );
  return { id: rows[0].id, deviationNo: docNo };
}

async function failedCheckpointSummary(db, imir) {
  const checkpoints = await repo.formatCheckpoints(db, imir.formatVersionId);
  const states = new Map((await repo.checkpointStates(db, imir.id)).map((s) => [s.checkpointUid, s]));
  const cells = await repo.observations(db, imir.id);
  const failed = checkpoints.filter((c) => states.get(c.uid)?.result === 'NOK');
  if (!failed.length) return { specification: null, observation: imir.inspectorRemark ?? null };

  const specification = failed.map((c) => `${c.checkpoint}: ${c.specification}`).join('\n');
  const observation = failed
    .map((c) => {
      if (perLot(c)) return `${c.checkpoint}: ${states.get(c.uid).textObservation ?? 'NOK'}`;
      const bad = cells.filter((o) => o.checkpointUid === c.uid && o.decision === 'NOK');
      const readings = bad.map((o) => `S${o.sampleNo} ${c.section === 'VISUAL' && c.inputType !== 'CHOICE' ? 'NOK' : sampleText(c, o)}`);
      return `${c.checkpoint}: ${readings.join(', ')}`;
    })
    .join('\n');
  return { specification, observation };
}
