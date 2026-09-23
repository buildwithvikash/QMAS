import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../shared/AppError.js';
import { issueNumber } from '../numbering/numbering.service.js';
import { logAction } from '../workflow/history.js';
import { actingRole, IMIR_REVIEW_ACTIONS, imirReviewBlock } from '../workflow/rules.js';
import * as repo from './imir.repo.js';

/**
 * Review of a submitted IMIR (slides 7–8).
 *  Incharge:  approve (passed lots only) → closed accepted; revert → back to the inspector;
 *             escalate with a non-conformance remark → IQC Head.
 *  IQC Head:  approve → closed accepted; hold → deviation opened for SCM or VD.
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
      payload = { department: body.department, suggestedActions: body.suggestedActions, deviationNo: dev.deviationNo };
    }
    await logAction(db, { imirId: id, deviationId, action: body.action.toUpperCase(), fromStatus: imir.status, toStatus: rule.to, actorId: user.id, actingRole: role, remark: body.remark ?? null, payload });
  });
}

const LABEL = { approve: 'approved', revert: 'sent back', escalate: 'escalated', head_approve: 'approved', hold: 'put on hold' };

/**
 * The IQC Head holds the lot: a deviation is numbered and handed to the chosen department's
 * initiator. Specification and IQC observation are pre-filled from the failed checkpoints.
 */
async function openDeviation(db, user, imir, { department, suggestedActions, remark }) {
  const { docNo } = await issueNumber(db, { docType: 'DEVIATION', plantId: imir.plantId, userId: user.id });
  const { specification, observation } = await failedCheckpointSummary(db, imir);
  const { rows } = await db.query(
    `INSERT INTO qms.deviation (deviation_no, imir_id, plant_id, department, suggested_actions, hold_remark, stage, specification, iqc_observation, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'INITIATOR', $7, $8, $9, $9) RETURNING id`,
    [docNo, imir.id, imir.plantId, department, suggestedActions, remark, specification, observation, user.id],
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
      if (c.section === 'RELIABILITY') return `${c.checkpoint}: ${states.get(c.uid).textObservation ?? 'NOK'}`;
      const bad = cells.filter((o) => o.checkpointUid === c.uid && o.decision === 'NOK');
      const readings = bad.map((o) => (c.section === 'DIMENSIONAL' ? `S${o.sampleNo} ${o.value}${c.uom ? ` ${c.uom}` : ''}` : `S${o.sampleNo} NOK`));
      return `${c.checkpoint}: ${readings.join(', ')}`;
    })
    .join('\n');
  return { specification, observation };
}
