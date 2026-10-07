import { PERMISSIONS } from '@qmas/shared';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../shared/AppError.js';
import { camelRow, camelRows, offsetOf, pageMeta } from '../../shared/sql.js';
import { plantScope } from '../auth/access.service.js';
import * as devRepo from '../deviation/deviation.repo.js';
import * as dnRepo from '../dn/dn.repo.js';
import * as imirRepo from '../imir/imir.repo.js';
import { logAction } from './history.js';

/**
 * Reversal of a workflow step (IMIR review, deviation, DN / CAPA).
 *   1. A user asks to reverse their own decision, with a reason (Help & Support → Reversal, or the
 *      record page). Only their own steps, and only while nobody else has acted on the record since.
 *   2. An admin (workflow.reverse) reverses: the record is set back to its state just before the
 *      chosen step (every step keeps that state, see history.js) — or rejects the request.
 * Every request, with who asked, who decided, when, the status before and after and the reasons,
 * stays in qms.reversal_request (decided rows cannot be changed) and in the lot's history.
 */

const P = PERMISSIONS;
const VIEW = { IMIR: P.IMIR_VIEW, DEVIATION: P.DEVIATION_VIEW, DN: P.DN_VIEW };
const IMIR_STEPS = ['SUBMIT', 'APPROVE', 'REJECT', 'REVERT', 'ESCALATE', 'HEAD_APPROVE', 'HOLD'];

export const STATUS_LABEL = {
  // IMIR
  OPEN: 'Open', IN_INSPECTION: 'Inspection', SUBMITTED: 'Incharge review', WITH_IQC_HEAD: 'IQC Head decision', DEPT_REVIEW: 'SCM / VD approval',
  IQC_HEAD_FINAL: 'IQC Head final decision', SENIOR_ESCALATION: 'Senior escalation', CLOSED_ACCEPTED: 'Closed: accepted', CLOSED_REJECTED: 'Closed: rejected',
  CLOSED_UNDER_DEVIATION: 'Closed: accepted under deviation', AUTO_CLOSED: 'Closed: auto-closed',
  // Deviation
  UNASSIGNED: 'Waiting for SCM / VD to accept', INITIATOR: 'Department initiator', SUB_HEAD: 'Department approval', HEAD: 'Department approval',
  FINAL: 'IQC Head final decision', SENIOR: 'Senior escalation', UNDER_DEVIATION: 'Awaiting quantities', QTY_VERIFICATION: 'Quantity verification', CLOSED: 'Closed',
  // DN
  CAPA_SUBMITTED: 'CAPA review',
};
const DN_LABEL = { OPEN: 'Open (CAPA to enter)', CAPA_SUBMITTED: 'CAPA review', CLOSED: 'Closed' };
export const statusLabel = (type, code) => (type === 'DN' ? DN_LABEL[code] : STATUS_LABEL[code]) ?? code;

const devStatus = (dev) => (dev.department || dev.stage !== 'INITIATOR' ? dev.stage : 'UNASSIGNED');

// ── The record ────────────────────────────────────────────────────────────────

/** The IMIR, deviation or DN in the common shape used here; null if it does not exist. */
async function loadRecord(db, type, id, { forUpdate = false } = {}) {
  if (type === 'IMIR') {
    const m = await imirRepo.get(db, id, { forUpdate });
    return m && { type, id, imirId: m.id, plantId: m.plantId, recordNo: m.imirNo ?? 'IMIR', status: m.status, raw: m };
  }
  if (type === 'DEVIATION') {
    const d = await devRepo.get(db, id, { forUpdate });
    return d && { type, id, imirId: d.imirId, plantId: d.plantId, recordNo: d.deviationNo, status: devStatus(d), raw: d };
  }
  const n = await dnRepo.get(db, id, { forUpdate });
  return n && n.imirId && { type, id, imirId: n.imirId, plantId: n.plantId, recordNo: n.dnNo, status: n.status, raw: n };
}

function assertCanView(user, rec) {
  const scope = plantScope(user, VIEW[rec.type], 'view');
  if (!scope.all && !scope.plantIds.includes(rec.plantId)) throw AppError.notFound('Record');
}

/**
 * The record's own steps that are still in effect, oldest first: steps undone by a reversal
 * are left out (a reversal to before step S removes S and everything after it).
 */
async function effectiveSteps(db, rec) {
  const { rows } = await db.query(
    `SELECT a.id, a.action, a.at, a.actor_id, u.full_name AS actor_name, a.acting_role, r.name AS acting_role_name, a.from_status, a.to_status,
            a.remark, a.payload, a.snapshot, a.deviation_id, a.dn_id
       FROM qms.imir_action a LEFT JOIN core.app_user u ON u.id = a.actor_id LEFT JOIN core.role r ON r.code = a.acting_role
      WHERE a.imir_id = $1 ORDER BY a.id`,
    [rec.imirId],
  );
  const belongs = {
    IMIR: (a) => !a.dn_id && IMIR_STEPS.includes(a.action) && (!a.deviation_id || a.action === 'HOLD'),
    DEVIATION: (a) => a.deviation_id === rec.id && a.action !== 'HOLD' && !a.action.startsWith('REVERS'),
    DN: (a) => a.dn_id === rec.id && !a.action.startsWith('REVERS'),
  }[rec.type];
  let out = [];
  for (const a of rows) {
    if (a.action === 'REVERSED' && a.payload?.entityType === rec.type && a.payload?.entityId === rec.id) {
      out = out.filter((s) => Number(s.id) < Number(a.payload.undoneStep));
    } else if (belongs(a)) out.push({ ...a, id: Number(a.id) });
  }
  return out;
}

/** The state the record had before the step, as a status code. */
function beforeStatus(type, step) {
  const s = step.snapshot;
  if (type === 'IMIR') return s.imir.status;
  if (type === 'DN') return s.dn.status;
  return s.deviation.department || s.deviation.stage !== 'INITIATOR' ? s.deviation.stage : 'UNASSIGNED';
}

/** Steps the record can be set back to (newest first). */
function stepOptions(rec, steps) {
  return steps
    .filter((s) => s.snapshot && (rec.type !== 'DEVIATION' || s.snapshot.deviation.stage !== 'SENIOR'))
    .map((s) => {
      const before = beforeStatus(rec.type, s);
      return { id: s.id, action: s.action, at: s.at, actorName: s.actor_name, actingRoleName: s.acting_role_name, remark: s.remark, beforeStatus: before, beforeLabel: statusLabel(rec.type, before) };
    })
    .reverse();
}

/**
 * The steps `userId` may ask to reverse: only their own decisions, and only while nobody else has
 * acted on the record since (reversing to before a step also undoes every later step).
 */
function ownOptions(rec, steps, userId) {
  const mine = new Set();
  for (let k = steps.length - 1; k >= 0; k -= 1) {
    const s = steps[k];
    if (!s.actor_id) continue; // reminders and timers
    if (s.actor_id !== userId) break;
    mine.add(s.id);
  }
  return stepOptions(rec, steps).filter((o) => mine.has(o.id));
}

const REQUEST_SELECT = `SELECT q.id, q.entity_type, q.entity_id, q.imir_id, q.plant_id, p.name AS plant_name, q.record_no, q.status_at_request, q.requested_step,
       rs.action AS requested_step_action, q.reason, q.requested_by, ru.full_name AS requested_by_name, q.requested_role, rr.name AS requested_role_name,
       q.requested_at, q.state, q.reviewed_by, vu.full_name AS reviewed_by_name, q.reviewed_at, q.review_remark, q.undone_step, us.action AS undone_step_action,
       q.previous_status, q.reverted_status, m.imir_no, i.item_code, i.description AS item_description
  FROM qms.reversal_request q
  JOIN core.plant p ON p.id = q.plant_id
  JOIN qms.imir m ON m.id = q.imir_id
  JOIN mst.item i ON i.id = m.item_id
  JOIN core.app_user ru ON ru.id = q.requested_by
  LEFT JOIN core.role rr ON rr.code = q.requested_role
  LEFT JOIN core.app_user vu ON vu.id = q.reviewed_by
  LEFT JOIN qms.imir_action rs ON rs.id = q.requested_step
  LEFT JOIN qms.imir_action us ON us.id = q.undone_step`;

const shape = (r) => r && {
  ...r,
  id: Number(r.id),
  requestedStep: r.requestedStep && Number(r.requestedStep),
  undoneStep: r.undoneStep && Number(r.undoneStep),
  statusAtRequestLabel: statusLabel(r.entityType, r.statusAtRequest),
  previousStatusLabel: r.previousStatus && statusLabel(r.entityType, r.previousStatus),
  revertedStatusLabel: r.revertedStatus && statusLabel(r.entityType, r.revertedStatus),
};

// ── For the record pages ──────────────────────────────────────────────────────

/** Reversal panel of an IMIR / deviation / DN page: whether the user may ask, the pending request and past ones. */
export async function forRecord(user, type, id) {
  const db = getPool();
  const rec = await loadRecord(db, type, id);
  if (!rec) throw AppError.notFound('Record');
  assertCanView(user, rec);
  const own = ownOptions(rec, await effectiveSteps(db, rec), user.id);
  const canReview = user.assignments.some((a) => a.permissions.includes(P.WORKFLOW_REVERSE));
  const { rows } = await db.query(`${REQUEST_SELECT} WHERE q.entity_type = $1 AND q.entity_id = $2 ORDER BY q.requested_at DESC`, [type, id]);
  const requests = camelRows(rows).map(shape);
  return {
    status: rec.status,
    statusLabel: statusLabel(type, rec.status),
    canRequest: own.length > 0,
    canReview,
    pending: requests.find((r) => r.state === 'PENDING') ?? null,
    requests,
    steps: own,
  };
}

export async function request(ctx, user, { entityType, entityId, stepId, reason }) {
  return withTransaction(ctx, async (db) => {
    const rec = await loadRecord(db, entityType, entityId, { forUpdate: true });
    if (!rec) throw AppError.notFound('Record');
    assertCanView(user, rec);
    const options = ownOptions(rec, await effectiveSteps(db, rec), user.id);
    if (!options.length) {
      throw AppError.forbidden('You can only ask to reverse your own decision, and only while nobody else has acted on the record since.', { code: 'NOT_OWN_DECISION' });
    }
    if (stepId && !options.some((o) => o.id === stepId)) throw AppError.unprocessable('You can only reverse your own decision.', [{ path: 'stepId', message: 'Choose one of the listed steps.' }]);
    stepId ??= options[0].id; // the latest one
    const role = user.assignments.find((a) => a.permissions.includes(VIEW[entityType]))?.roleCode ?? null;
    let row;
    try {
      ({ rows: [row] } = await db.query(
        `INSERT INTO qms.reversal_request (entity_type, entity_id, imir_id, plant_id, record_no, status_at_request, requested_step, reason, requested_by, requested_role)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [entityType, entityId, rec.imirId, rec.plantId, rec.recordNo, rec.status, stepId ?? null, reason, user.id, role],
      ));
    } catch (err) {
      if (err.code === '23505') throw AppError.conflict('A reversal request for this record is already waiting for an admin.', { code: 'REVERSAL_PENDING' });
      throw err;
    }
    await logAction(db, {
      imirId: rec.imirId, deviationId: entityType === 'DEVIATION' ? entityId : null, dnId: entityType === 'DN' ? entityId : null,
      action: 'REVERSAL_REQUEST', actorId: user.id, actingRole: role, remark: reason,
      payload: { requestId: Number(row.id), entityType, entityId, recordNo: rec.recordNo, status: rec.status, statusLabel: statusLabel(entityType, rec.status), stepId: stepId ?? null },
    });
    return Number(row.id);
  });
}

/**
 * Help & Support → Reversal: the user's own requests (newest first) and their recent decisions on
 * records where they may still ask for a reversal (nobody else has acted since).
 */
export async function mine(user) {
  const db = getPool();
  const { rows } = await db.query(`${REQUEST_SELECT} WHERE q.requested_by = $1 ORDER BY q.requested_at DESC LIMIT 100`, [user.id]);
  const requests = camelRows(rows).map(shape);
  const pendingFor = new Set(requests.filter((r) => r.state === 'PENDING').map((r) => `${r.entityType}:${r.entityId}`));
  // The records of the user's last steps (with a saved state), one entry per record.
  const { rows: recent } = await db.query(
    `SELECT DISTINCT ON (kind, entity_id) kind, entity_id, at FROM (
       SELECT CASE WHEN a.dn_id IS NOT NULL THEN 'DN' WHEN a.deviation_id IS NOT NULL AND a.action <> 'HOLD' THEN 'DEVIATION' ELSE 'IMIR' END AS kind,
              COALESCE(a.dn_id, CASE WHEN a.action <> 'HOLD' THEN a.deviation_id END, a.imir_id) AS entity_id, a.at
         FROM qms.imir_action a
        WHERE a.actor_id = $1 AND a.snapshot IS NOT NULL AND a.at > now() - interval '90 days'
        ORDER BY a.at DESC LIMIT 60) x
      ORDER BY kind, entity_id, at DESC`,
    [user.id],
  );
  const candidates = [];
  for (const r of recent.sort((a, b) => new Date(b.at) - new Date(a.at))) {
    const rec = await loadRecord(db, r.kind, r.entity_id);
    if (!rec) continue;
    const steps = ownOptions(rec, await effectiveSteps(db, rec), user.id);
    if (!steps.length) continue;
    candidates.push({
      entityType: rec.type, entityId: rec.id, recordNo: rec.recordNo, status: rec.status, statusLabel: statusLabel(rec.type, rec.status),
      itemCode: rec.raw.itemCode, itemDescription: rec.raw.itemDescription, plantName: rec.raw.plantName, pending: pendingFor.has(`${rec.type}:${rec.id}`), steps,
    });
  }
  return { requests, candidates };
}

/** The requester takes the request back while it is pending. */
export async function withdraw(ctx, user, id) {
  await withTransaction(ctx, async (db) => {
    const q = await lockRequest(db, id);
    if (q.requestedBy !== user.id) throw AppError.forbidden('Only the person who asked can withdraw the request.');
    await db.query("UPDATE qms.reversal_request SET state = 'WITHDRAWN', reviewed_by = $2, reviewed_at = now(), review_remark = 'Withdrawn by the requester' WHERE id = $1", [id, user.id]);
  });
}

async function lockRequest(db, id) {
  const { rows } = await db.query('SELECT id, entity_type, entity_id, imir_id, state, requested_by, reason, status_at_request, record_no FROM qms.reversal_request WHERE id = $1 FOR UPDATE', [id]);
  const q = camelRow(rows[0]);
  if (!q) throw AppError.notFound('Reversal request');
  if (q.state !== 'PENDING') throw AppError.conflict('This request has already been decided.', { code: 'NOT_PENDING' });
  return q;
}

// ── For the admin ─────────────────────────────────────────────────────────────

export async function list(filters) {
  const args = [];
  const arg = (v) => { args.push(v); return `$${args.length}`; };
  const where = [];
  if (filters.state) where.push(`q.state = ${arg(filters.state)}`);
  if (filters.entityType) where.push(`q.entity_type = ${arg(filters.entityType)}`);
  if (filters.q) where.push(`(q.record_no ILIKE ${arg(`%${filters.q}%`)} OR m.imir_no ILIKE $${args.length} OR ru.full_name ILIKE $${args.length})`);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await getPool().query(
    `${REQUEST_SELECT.replace('SELECT q.id,', 'SELECT count(*) OVER () AS total, q.id,')} ${w}
      ORDER BY (q.state = 'PENDING') DESC, q.requested_at DESC LIMIT ${arg(filters.pageSize)} OFFSET ${arg(offsetOf(filters))}`,
    args,
  );
  const { rows: c } = await getPool().query("SELECT count(*)::int AS pending FROM qms.reversal_request WHERE state = 'PENDING'");
  return { data: camelRows(rows).map(({ total, ...r }) => shape(r)), meta: { ...pageMeta(filters, rows[0]?.total ?? 0), pending: c[0].pending } };
}

/** One request with the record's current status and the steps it can be set back to. */
export async function get(id) {
  const db = getPool();
  const { rows } = await db.query(`${REQUEST_SELECT} WHERE q.id = $1`, [id]);
  const q = shape(camelRow(rows[0]));
  if (!q) throw AppError.notFound('Reversal request');
  const rec = await loadRecord(db, q.entityType, q.entityId);
  // Only the requester's own decisions can be reversed on their request.
  const steps = rec ? ownOptions(rec, await effectiveSteps(db, rec), q.requestedBy) : [];
  return { ...q, currentStatus: rec?.status ?? null, currentStatusLabel: rec ? statusLabel(q.entityType, rec.status) : 'Removed', steps };
}

export async function reject(ctx, user, id, { remark }) {
  await withTransaction(ctx, async (db) => {
    const q = await lockRequest(db, id);
    await db.query("UPDATE qms.reversal_request SET state = 'REJECTED', reviewed_by = $2, reviewed_at = now(), review_remark = $3 WHERE id = $1", [id, user.id, remark]);
    await logAction(db, {
      imirId: q.imirId, deviationId: q.entityType === 'DEVIATION' ? q.entityId : null, dnId: q.entityType === 'DN' ? q.entityId : null,
      action: 'REVERSAL_REJECTED', actorId: user.id, actingRole: reviewerRole(user), remark,
      payload: { requestId: Number(id), entityType: q.entityType, entityId: q.entityId, recordNo: q.recordNo, requestedBy: q.requestedBy },
    });
  });
  return get(id);
}

const reviewerRole = (user) => user.assignments.find((a) => a.permissions.includes(P.WORKFLOW_REVERSE))?.roleCode ?? null;

const DEV_COLS = ['department', 'stage', 'dept_outcome', 'approval_levels', 'current_level', 'initiator_id', 'severity', 'action', 'deviation_qty', 'specification',
  'iqc_observation', 'correction', 'corrective_action', 'form_submitted_at', 'senior_effective', 'final_decision', 'final_decision_at', 'qty_due_at', 'ok_qty',
  'not_ok_qty', 'qty_entered_at', 'qty_entered_by', 'qty_verified_at', 'qty_verified_by', 'outcome', 'closed_at', 'accepted_at'];

/** The admin reverses: the record goes back to its state just before `stepId`. */
export async function approve(ctx, user, id, { stepId, remark }) {
  await withTransaction(ctx, async (db) => {
    const q = await lockRequest(db, id);
    const rec = await loadRecord(db, q.entityType, q.entityId, { forUpdate: true });
    if (!rec) throw AppError.conflict('The record no longer exists. Reject this request.');
    if (rec.status !== q.statusAtRequest) {
      throw AppError.conflict(`The record has moved on since the request (it is now at "${statusLabel(rec.type, rec.status)}"). Reject this request; a new one can be raised.`, { code: 'RECORD_MOVED' });
    }
    const steps = await effectiveSteps(db, rec);
    const step = steps.find((s) => s.id === stepId);
    if (!step?.snapshot || !ownOptions(rec, steps, q.requestedBy).some((o) => o.id === stepId)) {
      throw AppError.unprocessable("Only the requester's own decision can be reversed.", [{ path: 'stepId', message: 'Choose one of the listed steps.' }]);
    }
    const kept = steps.filter((s) => s.id < stepId);

    const deviationId = rec.type === 'DEVIATION' ? rec.id : null;
    if (rec.type === 'IMIR') await restoreImir(db, rec, step, kept);
    else if (rec.type === 'DEVIATION') await restoreDeviation(db, rec, step);
    else await restoreDn(db, rec, step);

    const after = await loadRecord(db, rec.type, rec.id);
    await db.query(
      `UPDATE qms.reversal_request SET state = 'REVERSED', reviewed_by = $2, reviewed_at = now(), review_remark = $3, undone_step = $4, previous_status = $5, reverted_status = $6
        WHERE id = $1`,
      [id, user.id, remark ?? null, stepId, rec.status, after.status],
    );
    const imirBefore = rec.type === 'DN' ? rec.status : rec.raw.imirStatus ?? rec.raw.status;
    const { rows: m } = await db.query('SELECT status FROM qms.imir WHERE id = $1', [rec.imirId]);
    await logAction(db, {
      imirId: rec.imirId, deviationId, dnId: rec.type === 'DN' ? rec.id : null,
      action: 'REVERSED', fromStatus: imirBefore, toStatus: rec.type === 'DN' ? after.status : m[0].status, actorId: user.id, actingRole: reviewerRole(user),
      remark: remark ?? q.reason,
      payload: {
        requestId: Number(id), entityType: rec.type, entityId: rec.id, recordNo: rec.recordNo, requestedBy: q.requestedBy, reason: q.reason,
        undoneStep: stepId, undoneAction: step.action, from: rec.status, to: after.status, fromLabel: statusLabel(rec.type, rec.status), toLabel: statusLabel(rec.type, after.status),
      },
    });
  });
  return get(id);
}

async function restoreImir(db, rec, step, kept) {
  const dev = await imirRepo.deviationSummary(db, rec.id);
  const holdUndone = dev && !kept.some((s) => s.action === 'HOLD');
  if (holdUndone) {
    // The deviation is withdrawn only while nobody has worked on it.
    const { rows } = await db.query(
      `SELECT d.department, (SELECT count(*)::int FROM qms.deviation_form_revision r WHERE r.deviation_id = d.id) AS forms,
              (SELECT count(*)::int FROM qms.escalation_round e WHERE e.deviation_id = d.id) AS rounds
         FROM qms.deviation d WHERE d.id = $1`,
      [dev.id],
    );
    if (rows[0].department || rows[0].forms || rows[0].rounds) {
      throw AppError.conflict(`Deviation ${dev.deviationNo} has already been taken up. Reverse the deviation to before it was accepted first.`, { code: 'DEVIATION_IN_USE' });
    }
    await db.query('DELETE FROM qms.deviation WHERE id = $1', [dev.id]);
  }
  const dnExists = (await db.query('SELECT 1 FROM qms.defect_notification WHERE imir_id = $1', [rec.id])).rows.length > 0;
  if (dnExists && !kept.some((s) => s.action === 'ESCALATE' || s.action === 'REJECT')) {
    throw AppError.conflict('A DN has been raised for this lot, so the lot cannot go back before it was escalated or rejected.', { code: 'DN_EXISTS' });
  }
  await db.query(
    `UPDATE qms.imir m SET (status, result, defective_samples, submitted_at, submitted_by, closed_at) =
       (SELECT s.status, s.result, s.defective_samples, s.submitted_at, s.submitted_by, s.closed_at FROM jsonb_populate_record(NULL::qms.imir, $2::jsonb) s)
      WHERE m.id = $1`,
    [rec.id, JSON.stringify(step.snapshot.imir)],
  );
}

async function restoreDeviation(db, rec, step) {
  const { deviation, imir } = step.snapshot;
  await db.query(
    `UPDATE qms.deviation d SET (${DEV_COLS.join(', ')}) =
       (SELECT ${DEV_COLS.map((c) => `s.${c}`).join(', ')} FROM jsonb_populate_record(NULL::qms.deviation, $2::jsonb) s)
      WHERE d.id = $1`,
    [rec.id, JSON.stringify(deviation)],
  );
  // An open senior round ends: its pending authorities are no longer asked.
  const { rows } = await db.query("UPDATE qms.escalation_round SET status = 'COMPLETE', completed_at = now() WHERE deviation_id = $1 AND status = 'OPEN' RETURNING id", [rec.id]);
  for (const r of rows) await db.query("UPDATE qms.escalation_step SET status = 'NOT_REQUIRED' WHERE round_id = $1 AND status = 'PENDING'", [r.id]);
  await db.query('UPDATE qms.imir SET status = $2, closed_at = $3 WHERE id = $1', [rec.imirId, imir.status, imir.closed_at]);
}

async function restoreDn(db, rec, step) {
  const { dn, cycles, latestCapa } = step.snapshot;
  await db.query('DELETE FROM qms.dn_capa WHERE dn_id = $1 AND cycle_no > $2', [rec.id, cycles]);
  if (latestCapa) {
    await db.query('UPDATE qms.dn_capa SET review_decision = $3, review_remark = $4, reviewed_by = $5, reviewed_at = $6 WHERE dn_id = $1 AND cycle_no = $2',
      [rec.id, latestCapa.cycle_no, latestCapa.review_decision, latestCapa.review_remark, latestCapa.reviewed_by, latestCapa.reviewed_at]);
  }
  await db.query('UPDATE qms.defect_notification SET status = $2, closed_at = $3, closed_by = $4 WHERE id = $1', [rec.id, dn.status, dn.closed_at, dn.closed_by]);
}
