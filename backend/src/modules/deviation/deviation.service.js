import { applyTimeouts, OPS_TIMEOUT_HOURS, PERMISSIONS, QTY_DUE_DAYS, rankOf, resolveEscalation, ROLES } from '@qmas/shared';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../shared/AppError.js';
import { pageMeta } from '../../shared/sql.js';
import { plantScope } from '../auth/access.service.js';
import { history, logAction } from '../workflow/history.js';
import { deviationActions, deviationBlock, deviationRole, seniorRoles, STAGE_ACTIONS } from '../workflow/rules.js';
import * as repo from './deviation.repo.js';

/**
 * Deviation track after the IQC Head holds a lot (slides 9–12):
 *   INITIATOR → SUB_HEAD [→ HEAD] → FINAL (IQC Head) [→ SENIOR → FINAL] → CLOSED
 *                                              └ approve Segregation / Rework → UNDER_DEVIATION → QTY_VERIFICATION → CLOSED
 * The IMIR status follows the stage, so the incoming list shows where each lot is.
 */

const IMIR_STATUS_OF_STAGE = {
  INITIATOR: 'DEPT_REVIEW',
  SUB_HEAD: 'DEPT_REVIEW',
  HEAD: 'DEPT_REVIEW',
  FINAL: 'IQC_HEAD_FINAL',
  SENIOR: 'SENIOR_ESCALATION',
  UNDER_DEVIATION: 'UNDER_DEVIATION',
  QTY_VERIFICATION: 'QTY_VERIFICATION',
};
const IMIR_STATUS_OF_OUTCOME = { ACCEPTED_UNDER_DEVIATION: 'CLOSED_UNDER_DEVIATION', REJECTED: 'CLOSED_REJECTED', AUTO_CLOSED: 'AUTO_CLOSED' };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ── Reading ───────────────────────────────────────────────────────────────────

/** Counts for the stat cards above the list, with the list's filters (not its status tab). */
export async function counts(user, filters) {
  return repo.counts(getPool(), filters, plantScope(user, PERMISSIONS.DEVIATION_VIEW, 'view'));
}

export async function list(user, filters) {
  const scope = plantScope(user, PERMISSIONS.DEVIATION_VIEW, 'view');
  const { rows, total } = await repo.list(getPool(), filters, scope);
  return { data: rows, meta: pageMeta(filters, total) };
}

function assertCanView(user, dev) {
  const scope = plantScope(user, PERMISSIONS.DEVIATION_VIEW, 'view');
  if (!scope.all && !scope.plantIds.includes(dev.plantId)) throw AppError.notFound('Deviation');
}

export async function detail(id, user, db = getPool()) {
  const dev = await repo.get(db, id);
  if (!dev) throw AppError.notFound('Deviation');
  assertCanView(user, dev);
  const rounds = (await repo.rounds(db, id)).map(withResolution);
  const current = rounds.at(-1) ?? null;
  return {
    ...dev,
    revisions: await repo.formRevisions(db, id),
    rounds,
    history: await history(db, dev.imirId),
    allowedActions: deviationActions(user, dev, current),
    seniorRoles: seniorRoles(user, dev, current), // roles this user may decide in, highest first
  };
}

/** Adds the live resolution (effective decision, pending PDC, …) to an escalation round. */
function withResolution(round) {
  return { ...round, resolution: resolveEscalation({ steps: round.steps, decisions: round.decisions }) };
}

// ── Actions ───────────────────────────────────────────────────────────────────

export async function act(ctx, user, id, body) {
  await withTransaction(ctx, async (db) => {
    const dev = await repo.get(db, id, { forUpdate: true });
    if (!dev) throw AppError.notFound('Deviation');
    assertCanView(user, dev);
    const round = (await repo.rounds(db, id)).at(-1) ?? null;
    if (!STAGE_ACTIONS[dev.stage].includes(body.action)) {
      throw AppError.conflict(`Deviation ${dev.deviationNo} is at stage ${STAGE_LABEL[dev.stage]}; this action is not possible now.`, { code: 'WRONG_STAGE' });
    }
    const role = deviationRole(user, dev, body.action, round);
    if (!role) throw AppError.forbidden(`You cannot act on this deviation at stage ${STAGE_LABEL[dev.stage]}.`);
    const blocked = deviationBlock(dev, body.action);
    if (blocked) throw AppError.conflict(blocked, { code: 'NOT_ALLOWED_NOW' });
    if (body.rowVersion !== undefined && body.rowVersion !== dev.rowVersion) throw AppError.staleVersion('This deviation');
    await HANDLERS[body.action](db, { user, role, dev, body, round });
  });
  return detail(id, user);
}

export const STAGE_LABEL = {
  INITIATOR: 'Department initiator',
  SUB_HEAD: 'Department Sub-Head',
  HEAD: 'Department Head',
  FINAL: 'IQC Head final decision',
  SENIOR: 'Senior escalation',
  UNDER_DEVIATION: 'Under deviation',
  QTY_VERIFICATION: 'Quantity verification',
  CLOSED: 'Closed',
};

/**
 * Moves the deviation to `stage` (updating `set` columns — internal names only), keeps the IMIR
 * status in step and records the history entry.
 */
async function move(db, dev, { stage, set = {}, action, actorId = null, role = null, remark = null, payload = null }) {
  const cols = { stage, ...set };
  if (stage === 'CLOSED') cols.closed_at = new Date();
  const keys = Object.keys(cols);
  await db.query(`UPDATE qms.deviation SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [dev.id, ...keys.map((k) => cols[k])]);

  const imirStatus = stage === 'CLOSED' ? IMIR_STATUS_OF_OUTCOME[cols.outcome] : IMIR_STATUS_OF_STAGE[stage];
  await db.query('UPDATE qms.imir SET status = $2, closed_at = CASE WHEN $3::boolean THEN now() END WHERE id = $1', [dev.imirId, imirStatus, stage === 'CLOSED']);
  await logAction(db, { imirId: dev.imirId, deviationId: dev.id, action, fromStatus: dev.imirStatus, toStatus: imirStatus, actorId, actingRole: role, remark, payload });
  dev.imirStatus = imirStatus;
  dev.stage = stage;
}

const HANDLERS = {
  // ── Department ──
  async submit_form(db, { user, role, dev, body }) {
    const f = body.form;
    if (f.deviationQty > dev.inwardQty) throw AppError.unprocessable('Deviation quantity cannot exceed the inward quantity.', [{ path: 'form.deviationQty', message: `At most ${dev.inwardQty}.` }]);
    const levels = await repo.approvalChain(db, dev.department);
    const { rows } = await db.query('SELECT coalesce(max(revision_no), 0) + 1 AS n FROM qms.deviation_form_revision WHERE deviation_id = $1', [dev.id]);
    await db.query('INSERT INTO qms.deviation_form_revision (deviation_id, revision_no, data, submitted_by) VALUES ($1, $2, $3, $4)', [dev.id, rows[0].n, JSON.stringify(f), user.id]);
    await move(db, dev, {
      stage: levels[0],
      set: {
        initiator_id: user.id, severity: f.severity, action: f.action, deviation_qty: f.deviationQty, specification: f.specification ?? null,
        iqc_observation: f.iqcObservation ?? null, correction: f.correction, corrective_action: f.correctiveAction, form_submitted_at: new Date(),
        approval_levels: levels, current_level: 0, dept_outcome: null, senior_effective: null,
      },
      action: 'SUBMIT_FORM', actorId: user.id, role, remark: body.remark ?? null, payload: { revision: rows[0].n, action: f.action, severity: f.severity, deviationQty: f.deviationQty },
    });
  },

  async recommend_reject(db, { user, role, dev, body }) {
    await move(db, dev, { stage: 'FINAL', set: { initiator_id: user.id, dept_outcome: 'REJECT_RECOMMENDED', senior_effective: null }, action: 'RECOMMEND_REJECT', actorId: user.id, role, remark: body.remark });
  },

  async dept_approve(db, { user, role, dev, body }) {
    const next = dev.currentLevel + 1;
    const nextLevel = dev.approvalLevels[next];
    if (nextLevel) await move(db, dev, { stage: nextLevel, set: { current_level: next }, action: 'DEPT_APPROVE', actorId: user.id, role, remark: body.remark ?? null });
    else await move(db, dev, { stage: 'FINAL', set: { dept_outcome: 'APPROVED', current_level: null }, action: 'DEPT_APPROVE', actorId: user.id, role, remark: body.remark ?? null });
  },

  async send_back(db, { user, role, dev, body }) {
    await move(db, dev, { stage: 'INITIATOR', set: { current_level: null }, action: 'SEND_BACK', actorId: user.id, role, remark: body.remark });
  },

  async dept_reject(db, { user, role, dev, body }) {
    await move(db, dev, { stage: 'FINAL', set: { dept_outcome: 'REJECTED', current_level: null }, action: 'DEPT_REJECT', actorId: user.id, role, remark: body.remark });
  },

  // ── IQC Head final decision ──
  async final_approve(db, { user, role, dev, body }) {
    const now = new Date();
    const decided = { final_decision: 'APPROVED', final_decision_at: now };
    if (dev.action === 'UAI') {
      await move(db, dev, { stage: 'CLOSED', set: { ...decided, outcome: 'ACCEPTED_UNDER_DEVIATION' }, action: 'FINAL_APPROVE', actorId: user.id, role, remark: body.remark, payload: { action: dev.action } });
    } else {
      const due = new Date(now.getTime() + QTY_DUE_DAYS * DAY);
      await move(db, dev, { stage: 'UNDER_DEVIATION', set: { ...decided, qty_due_at: due }, action: 'FINAL_APPROVE', actorId: user.id, role, remark: body.remark, payload: { action: dev.action, qtyDueAt: due } });
    }
  },

  async final_reject(db, { user, role, dev, body }) {
    await move(db, dev, { stage: 'CLOSED', set: { final_decision: 'REJECTED', final_decision_at: new Date(), outcome: 'REJECTED' }, action: 'FINAL_REJECT', actorId: user.id, role, remark: body.remark });
  },

  async escalate(db, { user, role, dev, body, round }) {
    const roundNo = (round?.roundNo ?? 0) + 1;
    const now = new Date();
    const { rows } = await db.query(
      "INSERT INTO qms.escalation_round (deviation_id, round_no, status, remark, opened_by) VALUES ($1, $2, 'OPEN', $3, $4) RETURNING id",
      [dev.id, roundNo, body.remark, user.id],
    );
    for (const r of body.authorities) {
      const due = r === ROLES.CENTRAL_OPS_HEAD ? new Date(now.getTime() + OPS_TIMEOUT_HOURS * HOUR) : null;
      await db.query("INSERT INTO qms.escalation_step (round_id, role_code, rank, status, due_at) VALUES ($1, $2, $3, 'PENDING', $4)", [rows[0].id, r, rankOf(r), due]);
    }
    await move(db, dev, { stage: 'SENIOR', action: 'ESCALATE', actorId: user.id, role, remark: body.remark, payload: { round: roundNo, authorities: body.authorities } });
  },

  // ── Senior authorities ──
  async senior_decide(db, { user, dev, body, round }) {
    const mine = seniorRoles(user, dev, round);
    if (body.roleCode && !mine.includes(body.roleCode)) throw AppError.forbidden('You cannot decide in that role on this escalation.');
    const role = body.roleCode ?? mine[0];
    await db.query('INSERT INTO qms.escalation_decision (round_id, role_code, decision, remark, decided_by) VALUES ($1, $2, $3, $4, $5)', [round.id, role, body.decision, body.remark, user.id]);
    await db.query("UPDATE qms.escalation_step SET status = 'DECIDED' WHERE round_id = $1 AND role_code = $2", [round.id, role]);
    // The decision counts for the authority's step; an admin deciding for it is recorded as such.
    const asAdmin = !user.assignments.some((a) => a.roleCode === role);
    await logAction(db, {
      imirId: dev.imirId, deviationId: dev.id, action: 'SENIOR_DECISION', actorId: user.id, actingRole: asAdmin ? ROLES.SYSTEM_ADMIN : role, remark: body.remark,
      payload: { round: round.roundNo, decision: body.decision, forRole: role },
    });
    await settleRound(db, dev, round.id, { actorId: user.id });
  },

  async override(db, { user, role, dev, body, round }) {
    await db.query("INSERT INTO qms.escalation_decision (round_id, role_code, decision, kind, remark, decided_by) VALUES ($1, $2, $3, 'OVERRIDE', $4, $5)", [round.id, role, body.decision, body.remark, user.id]);
    if (dev.stage === 'SENIOR') {
      await logAction(db, { imirId: dev.imirId, deviationId: dev.id, action: 'OVERRIDE', actorId: user.id, actingRole: role, remark: body.remark, payload: { round: round.roundNo, decision: body.decision } });
      await settleRound(db, dev, round.id, { actorId: user.id });
    } else {
      // After the round: the override replaces the senior outcome the IQC Head must follow.
      await db.query('UPDATE qms.escalation_round SET effective_decision = $2, decided_by_role = $3 WHERE id = $1', [round.id, body.decision, role]);
      await move(db, dev, { stage: 'FINAL', set: { senior_effective: body.decision }, action: 'OVERRIDE', actorId: user.id, role, remark: body.remark, payload: { round: round.roundNo, decision: body.decision } });
    }
  },

  // ── Quantities ──
  async enter_qty(db, { user, role, dev, body }) {
    const total = body.okQty + body.notOkQty;
    if (total <= 0) throw AppError.unprocessable('Enter the OK and Not-OK quantities.');
    if (total > dev.inwardQty) throw AppError.unprocessable(`OK and Not-OK together (${total}) cannot exceed the inward quantity (${dev.inwardQty}).`);
    await move(db, dev, {
      stage: 'QTY_VERIFICATION',
      set: { ok_qty: body.okQty, not_ok_qty: body.notOkQty, qty_entered_at: new Date(), qty_entered_by: user.id },
      action: 'ENTER_QTY', actorId: user.id, role, remark: body.remark ?? null, payload: { okQty: body.okQty, notOkQty: body.notOkQty },
    });
  },

  async verify_qty(db, { user, role, dev, body }) {
    await move(db, dev, { stage: 'CLOSED', set: { outcome: 'ACCEPTED_UNDER_DEVIATION', qty_verified_at: new Date(), qty_verified_by: user.id }, action: 'VERIFY_QTY', actorId: user.id, role, remark: body.remark ?? null, payload: { okQty: dev.okQty, notOkQty: dev.notOkQty } });
  },

  async return_qty(db, { user, role, dev, body }) {
    await move(db, dev, { stage: 'UNDER_DEVIATION', action: 'RETURN_QTY', actorId: user.id, role, remark: body.remark });
  },
};

/**
 * Re-resolves an open round after a decision, override or timeout. When complete: pending lower
 * authorities become not required and the result goes back to the IQC Head (approve / reject) or,
 * on a change of type, back to the department initiator.
 */
async function settleRound(db, dev, roundId, { actorId = null } = {}) {
  const round = (await repo.rounds(db, dev.id)).find((r) => r.id === Number(roundId));
  const res = resolveEscalation({ steps: round.steps, decisions: round.decisions });
  if (!res.complete) return res;

  if (res.notRequired.length) {
    await db.query("UPDATE qms.escalation_step SET status = 'NOT_REQUIRED' WHERE round_id = $1 AND role_code = ANY($2) AND status = 'PENDING'", [roundId, res.notRequired]);
  }
  await db.query("UPDATE qms.escalation_round SET status = 'COMPLETE', effective_decision = $2, decided_by_role = $3, completed_at = now() WHERE id = $1", [roundId, res.effective, res.decidedBy]);
  const payload = { round: round.roundNo, decision: res.effective, decidedBy: res.decidedBy, overridden: res.overridden };
  if (res.effective === 'CHANGE_TYPE') {
    await move(db, dev, { stage: 'INITIATOR', set: { senior_effective: 'CHANGE_TYPE', dept_outcome: null, current_level: null }, action: 'SENIOR_RESULT', actorId, payload });
  } else {
    await move(db, dev, { stage: 'FINAL', set: { senior_effective: res.effective }, action: 'SENIOR_RESULT', actorId, payload });
  }
  return res;
}

// ── Timers (run by the worker) ────────────────────────────────────────────────

/**
 * Rule 3: a Central Operations Head step with no decision after 24 calendar hours times out and
 * CQA Head is added to the round if missing. Returns how many rounds changed.
 */
export async function runEscalationTimeouts({ now = new Date() } = {}) {
  const { rows } = await getPool().query(
    `SELECT DISTINCT r.id, r.deviation_id FROM qms.escalation_step s JOIN qms.escalation_round r ON r.id = s.round_id
      WHERE r.status = 'OPEN' AND s.status = 'PENDING' AND s.due_at <= $1`,
    [now],
  );
  let changed = 0;
  for (const { id: roundId, deviation_id: deviationId } of rows) {
    await withTransaction({}, async (db) => {
      const dev = await repo.get(db, deviationId, { forUpdate: true });
      const round = (await repo.rounds(db, deviationId)).find((r) => r.id === Number(roundId));
      if (dev.stage !== 'SENIOR' || round?.status !== 'OPEN') return;
      const t = applyTimeouts({ steps: round.steps, decisions: round.decisions, now });
      if (!t.timedOut.length) return;
      await db.query("UPDATE qms.escalation_step SET status = 'TIMED_OUT' WHERE round_id = $1 AND role_code = ANY($2)", [roundId, t.timedOut]);
      for (const r of t.add) {
        await db.query("INSERT INTO qms.escalation_step (round_id, role_code, rank, status, reason) VALUES ($1, $2, $3, 'PENDING', 'AUTO_CQA')", [roundId, r, rankOf(r)]);
      }
      await logAction(db, { imirId: dev.imirId, deviationId, action: 'OPS_TIMEOUT', payload: { round: round.roundNo, timedOut: t.timedOut, added: t.add } });
      await settleRound(db, dev, roundId);
      changed += 1;
    });
  }
  return { changed };
}

/** Segregation / Rework with no quantities entered within 14 days closes itself (AUTO_CLOSED). */
export async function runAutoClose({ now = new Date() } = {}) {
  const { rows } = await getPool().query("SELECT id FROM qms.deviation WHERE stage = 'UNDER_DEVIATION' AND qty_due_at <= $1", [now]);
  let closed = 0;
  for (const { id } of rows) {
    await withTransaction({}, async (db) => {
      const dev = await repo.get(db, id, { forUpdate: true });
      if (dev.stage !== 'UNDER_DEVIATION' || new Date(dev.qtyDueAt) > now) return;
      await move(db, dev, { stage: 'CLOSED', set: { outcome: 'AUTO_CLOSED' }, action: 'AUTO_CLOSE', payload: { qtyDueAt: dev.qtyDueAt } });
      closed += 1;
    });
  }
  return { closed };
}

// ── Department approval chain setting ─────────────────────────────────────────

export async function listChains() {
  const { rows } = await getPool().query('SELECT department, levels, updated_at, row_version FROM mst.dept_approval_chain ORDER BY department');
  return rows.map((r) => ({ department: r.department, levels: r.levels, updatedAt: r.updated_at, rowVersion: r.row_version }));
}

/** Changes apply to deviation forms submitted from now on; forms in approval keep their chain. */
export async function updateChain(ctx, department, { levels, rowVersion }) {
  await withTransaction(ctx, async (db) => {
    const { rowCount } = await db.query('UPDATE mst.dept_approval_chain SET levels = $2 WHERE department = $1 AND row_version = $3', [department, levels, rowVersion]);
    if (!rowCount) {
      const { rows } = await db.query('SELECT 1 FROM mst.dept_approval_chain WHERE department = $1', [department]);
      throw rows[0] ? AppError.staleVersion('This approval chain') : AppError.notFound('Approval chain');
    }
  });
  return (await listChains()).find((c) => c.department === department);
}
