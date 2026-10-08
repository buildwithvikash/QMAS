import { cellDecision, determineSample, evaluateInspection, PERMISSIONS, reliabilityDue } from '@qmas/shared';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { getEnv } from '../../config/env.js';
import { AppError } from '../../shared/AppError.js';
import { pageMeta } from '../../shared/sql.js';
import { plantScope } from '../auth/access.service.js';
import { issueNumber } from '../numbering/numbering.service.js';
import { history, imirSnapshot, logAction } from '../workflow/history.js';
import { actingRole, imirReviewActions } from '../workflow/rules.js';
import { summaryForImir } from '../dn/dn.repo.js';
import * as repo from './imir.repo.js';

const EDITABLE = ['OPEN', 'IN_INSPECTION'];

// ── Opening ───────────────────────────────────────────────────────────────────

/**
 * Opens an IMIR that is waiting: pins the approved format version, sizes the sample from the
 * default sampling table, issues the IMIR number and works out which reliability tests are due.
 * If something is missing (no approved format, no sampling row, no number series) the IMIR keeps
 * waiting with the reason shown in the list. Runs inside the caller's transaction.
 */
export async function tryOpen(db, imirId, { userId = null, at = new Date() } = {}) {
  const { rows } = await db.query(
    `SELECT m.id, m.status, m.plant_id, m.item_id, m.vendor_id, m.inward_qty, i.item_code, f.current_version_id
       FROM qms.imir m JOIN mst.item i ON i.id = m.item_id LEFT JOIN qms.format f ON f.item_id = m.item_id
      WHERE m.id = $1 FOR UPDATE OF m`,
    [imirId],
  );
  const m = rows[0];
  if (!m || m.status !== 'AWAITING_FORMAT') return false;
  const wait = async (reason) => {
    await db.query('UPDATE qms.imir SET awaiting_reason = $2 WHERE id = $1 AND awaiting_reason IS DISTINCT FROM $2', [imirId, reason]);
    return false;
  };

  if (!m.current_version_id) return wait(`No approved inspection format for item ${m.item_code}.`);

  const { rows: plan } = await db.query('SELECT id, name FROM mst.sampling_plan WHERE is_default');
  if (!plan[0]) return wait('No default sampling plan is set.');
  const { rows: planRows } = await db.query('SELECT lot_min, lot_max, sample_size, accept_no, reject_no FROM mst.sampling_plan_row WHERE plan_id = $1', [plan[0].id]);
  const sample = determineSample(planRows.map((r) => ({ lotMin: r.lot_min, lotMax: r.lot_max, sampleSize: r.sample_size, acceptNo: r.accept_no, rejectNo: r.reject_no })), m.inward_qty);
  if (!sample) return wait(`The sampling table "${plan[0].name}" has no row for a lot of ${Number(m.inward_qty)}.`);

  // Numbering may fail (no active series); a savepoint keeps the rest of the transaction usable.
  await db.query('SAVEPOINT open_imir');
  let docNo;
  try {
    ({ docNo } = await issueNumber(db, { docType: 'IMIR', plantId: m.plant_id, at, userId }));
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT open_imir');
    if (err.isOperational) return wait(err.message);
    throw err;
  }

  const checkpoints = await repo.formatCheckpoints(db, m.current_version_id);
  const { rows: tests } = await db.query(
    `SELECT DISTINCT ON (checkpoint_uid) checkpoint_uid, tested_at, result
       FROM qms.reliability_test_log WHERE item_id = $1 AND vendor_id = $2
      ORDER BY checkpoint_uid, tested_at DESC`,
    [m.item_id, m.vendor_id],
  );
  const lastTest = new Map(tests.map((t) => [t.checkpoint_uid, t]));
  for (const cp of checkpoints) {
    const t = lastTest.get(cp.uid);
    // Reliability: only when due. Lot details: as the format says. Sample checks: always.
    const required = cp.section === 'RELIABILITY'
      ? reliabilityDue({ frequencyMonths: cp.frequencyMonths, lastTestedAt: t?.tested_at, lastResult: t?.result }, at)
      : cp.section === 'RECORD' ? cp.formatRequired !== false : true;
    await db.query(
      'INSERT INTO qms.imir_checkpoint (imir_id, checkpoint_uid, section, is_required, last_tested_at) VALUES ($1, $2, $3, $4, $5)',
      [imirId, cp.uid, cp.section, required, t?.tested_at ?? null],
    );
  }

  await db.query(
    `UPDATE qms.imir SET status = 'OPEN', imir_no = $2, format_version_id = $3, sampling_plan_id = $4, lot_size = $5,
            sample_size = $6, accept_no = $7, reject_no = $8, sampling_basis = $9, opened_at = $10, awaiting_reason = NULL
      WHERE id = $1`,
    [imirId, docNo, m.current_version_id, plan[0].id, sample.lotSize, sample.sampleSize, sample.acceptNo, sample.rejectNo, sample.basis, at],
  );
  return true;
}

/** Called when a format is approved: every IMIR waiting for that item opens. Returns how many opened. */
export async function openAwaitingForItem(db, itemId, opts) {
  const { rows } = await db.query("SELECT id FROM qms.imir WHERE item_id = $1 AND status = 'AWAITING_FORMAT' ORDER BY created_at", [itemId]);
  let opened = 0;
  for (const r of rows) if (await tryOpen(db, r.id, opts)) opened += 1;
  return opened;
}

// ── Reading ───────────────────────────────────────────────────────────────────

/** Counts for the stat cards above the list, with the list's filters (not its status tab). */
export async function counts(user, filters) {
  return repo.counts(getPool(), filters, plantScope(user, PERMISSIONS.IMIR_VIEW, 'view'));
}

export async function list(user, filters) {
  const scope = plantScope(user, PERMISSIONS.IMIR_VIEW, 'view');
  const { rows, total } = await repo.list(getPool(), filters, scope);
  return { data: rows, meta: pageMeta(filters, total) };
}

function assertCanView(user, imir) {
  const scope = plantScope(user, PERMISSIONS.IMIR_VIEW, 'view');
  if (!scope.all && !scope.plantIds.includes(imir.plantId)) throw AppError.notFound('IMIR');
}

function canInspect(user, imir) {
  if (!user.permissions.has(PERMISSIONS.IMIR_INSPECT)) return false;
  const scope = plantScope(user, PERMISSIONS.IMIR_INSPECT, 'action');
  return scope.all || scope.plantIds.includes(imir.plantId);
}

/** Everything the inspection screen needs, plus the live evaluation and allowed actions. */
export async function detail(id, user, db = getPool()) {
  const imir = await repo.get(db, id);
  if (!imir) throw AppError.notFound('IMIR');
  if (user) assertCanView(user, imir);
  if (imir.status === 'AWAITING_FORMAT') return { ...imir, checkpoints: [], cells: [], attachments: [], history: [], deviation: null, dn: null, allowedActions: [] };

  const [checkpoints, states, cells, attachments, steps, deviation] = [
    await repo.formatCheckpoints(db, imir.formatVersionId),
    await repo.checkpointStates(db, id),
    await repo.observations(db, id),
    await repo.attachments(db, id),
    await history(db, id),
    await repo.deviationSummary(db, id),
  ];
  const dn = await summaryForImir(db, id);
  const stateByUid = new Map(states.map((s) => [s.checkpointUid, s]));
  const merged = checkpoints.map((c) => ({ ...c, ...(stateByUid.get(c.uid) ?? {}), checkpointUid: undefined }));
  const evaluation = evaluate(imir, merged, cells);

  const allowedActions = [];
  const claim = claimOf(imir, user);
  if (user && EDITABLE.includes(imir.status) && canInspect(user, imir)) {
    if (claim?.active && !claim.mine && !imir.checkoutDeviceId) allowedActions.push('take_over'); // someone else is on it
    else {
      allowedActions.push('inspect');
      if (!evaluation.missing.length) allowedActions.push('submit');
    }
  }
  if (user) allowedActions.push(...imirReviewActions(user, imir));
  // DN: once the lot was escalated to the IQC Head or rejected by the Incharge, one per lot (slide 7).
  if (user && !dn && steps.some((h) => (h.action === 'ESCALATE' || (h.action === 'REJECT' && imir.status === 'CLOSED_REJECTED')) && !h.deviationId) && actingRole(user, { permission: PERMISSIONS.DN_MANAGE, plantId: imir.plantId })) {
    allowedActions.push('raise_dn');
  }
  return { ...imir, checkpoints: merged, cells, attachments, evaluation, history: steps, deviation, dn, allowedActions, claim };
}

function evaluate(imir, checkpoints, cells) {
  return evaluateInspection({
    checkpoints,
    required: Object.fromEntries(checkpoints.map((c) => [c.uid, c.isRequired])),
    cells: cells.map((c) => ({ checkpointUid: c.checkpointUid, sampleNo: c.sampleNo, value: c.value, ok: c.ok })),
    entries: Object.fromEntries(checkpoints.map((c) => [c.uid, { manualResult: c.manualResult, textObservation: c.textObservation }])),
    sampling: { sampleSize: imir.sampleSize, acceptNo: imir.acceptNo, rejectNo: imir.rejectNo },
  });
}

// ── Who is inspecting (one inspector at a time) ───────────────────────────────

const IST_TIME = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * The inspector holding the lot: { userId, name, at (last save), active, mine }, or null. The hold
 * lapses after INSPECTION_CLAIM_MINUTES without a save; a lapsed hold no longer stops anyone.
 */
export function claimOf(imir, user) {
  if (!imir.claimedBy || imir.status !== 'IN_INSPECTION') return null;
  const active = Date.now() - new Date(imir.claimedAt).getTime() < getEnv().INSPECTION_CLAIM_MINUTES * 60_000;
  return { userId: imir.claimedBy, name: imir.claimedByName, at: imir.claimedAt, active, mine: !!user && imir.claimedBy === user.id };
}

/** Moves the lot to `user`: the report's inspector becomes them, and the step is in the history. */
async function takeClaim(db, user, imir, { lapsed }) {
  const before = claimOf(imir, user);
  await db.query('UPDATE qms.imir SET claimed_by = $2, claimed_at = now(), inspected_by = $2 WHERE id = $1', [imir.id, user.id]);
  if (before && !before.mine) {
    await logAction(db, {
      imirId: imir.id, action: 'TAKE_OVER', fromStatus: imir.status, toStatus: imir.status, actorId: user.id, actingRole: inspectingRole(user, imir),
      remark: lapsed ? `Continued after ${before.name} saved nothing for ${getEnv().INSPECTION_CLAIM_MINUTES} minutes` : null,
      payload: { fromUserId: before.userId, fromName: before.name, lapsed },
    });
  }
}

/** Another inspector is working on the lot right now: refuse with who and since when. */
function assertNotClaimedByOther(imir, user) {
  const c = claimOf(imir, user);
  if (c?.active && !c.mine) {
    throw AppError.conflict(`${c.name} is inspecting this lot (last saved ${IST_TIME.format(new Date(c.at))}). Take the lot over to continue.`, { code: 'CLAIMED' });
  }
}

/** Takes the lot over from the inspector holding it (the Take over button). */
export async function takeOver(ctx, user, id) {
  await withTransaction(ctx, async (db) => {
    const imir = await lockForInspection(db, user, id, null, { allowClaimed: true });
    const c = claimOf(imir, user);
    if (!c || c.mine) return; // nothing to take over: the lot is free or already the user's
    await takeClaim(db, user, imir, { lapsed: !c.active });
  });
  return detail(id, user);
}

function inspectingRole(user, imir) {
  const a = user.assignments.find((x) => x.permissions.includes(PERMISSIONS.IMIR_INSPECT) && (x.actionScope === 'ALL' || x.plantId === null || x.plantId === imir.plantId));
  return a?.roleCode ?? null;
}

// ── Inspection ────────────────────────────────────────────────────────────────

async function lockForInspection(db, user, id, deviceId, { allowClaimed = false } = {}) {
  const imir = await repo.get(db, id, { forUpdate: true });
  if (!imir) throw AppError.notFound('IMIR');
  assertCanView(user, imir);
  if (!canInspect(user, imir)) throw AppError.forbidden('You cannot inspect lots of this plant.');
  if (!EDITABLE.includes(imir.status)) {
    throw AppError.conflict(
      imir.status === 'AWAITING_FORMAT' ? 'This IMIR is not open yet: its item has no approved format.' : 'This IMIR has been submitted; observations can no longer change.',
      { code: 'IMIR_NOT_EDITABLE' },
    );
  }
  if (imir.checkoutDeviceId && imir.checkoutDeviceId !== deviceId) {
    throw AppError.conflict(`This lot is checked out to tablet ${imir.checkoutDeviceCode} (${imir.checkoutUserName}). Record it there, or ask the Incharge to release it.`, { code: 'CHECKED_OUT' });
  }
  // A tablet checkout already gives the lot to one inspector; otherwise the active hold decides.
  if (!allowClaimed && !(imir.checkoutDeviceId && imir.checkoutDeviceId === deviceId)) assertNotClaimedByOther(imir, user);
  return imir;
}

/** Why a lot-details answer is not acceptable for its field type, or null. Empty answers are allowed while saving. */
function recordAnswerProblem(cp, answer) {
  if (answer === undefined || answer === null || answer === '') return null;
  const a = String(answer).trim();
  if (cp.inputType === 'NUMBER' && !/^[-+]?\d+(\.\d{1,3})?$/.test(a)) return `${cp.checkpoint}: enter a number (up to 3 decimals).`;
  if (cp.inputType === 'DATE' && (!/^\d{4}-\d{2}-\d{2}$/.test(a) || Number.isNaN(Date.parse(a)))) return `${cp.checkpoint}: enter a date.`;
  if ((cp.inputType === 'CHOICE' || cp.inputType === 'YES_NO') && !(cp.options ?? []).some((o) => o.label.toLowerCase() === a.toLowerCase())) {
    return `${cp.checkpoint}: choose one of ${(cp.options ?? []).map((o) => o.label).join(', ')}.`;
  }
  return null;
}

/**
 * Saves inspection progress: only the cells and entries sent change (autosave cell by cell, or a
 * batch from an offline tablet). Decisions are recomputed here; the client's own are never trusted.
 */
export async function saveProgress(ctx, user, id, body, { clientTime = null } = {}) {
  await withTransaction(ctx, async (db) => {
    const imir = await lockForInspection(db, user, id, body.deviceId);
    const checkpoints = await repo.formatCheckpoints(db, imir.formatVersionId);
    const byUid = new Map(checkpoints.map((c) => [c.uid, c]));
    const errors = [];

    for (const [i, cell] of body.cells.entries()) {
      const cp = byUid.get(cell.checkpointUid);
      if (!cp) { errors.push({ path: `cells.${i}.checkpointUid`, message: 'Not a checkpoint of this format.' }); continue; }
      if (cp.section === 'RELIABILITY' || cp.section === 'RECORD') { errors.push({ path: `cells.${i}`, message: `${cp.checkpoint} is recorded once per lot, not per sample.` }); continue; }
      const choice = cp.section === 'VISUAL' && cp.inputType === 'CHOICE';
      if ((cp.section === 'DIMENSIONAL' || choice) && cell.ok !== undefined && cell.ok !== null) errors.push({ path: `cells.${i}.ok`, message: `${cp.checkpoint} takes ${choice ? 'one of its options' : 'a measured value'}.` });
      if (cp.section === 'VISUAL' && !choice && cell.value !== undefined && cell.value !== null) errors.push({ path: `cells.${i}.value`, message: 'Visual checks take OK or NOK.' });
      if (choice && cell.value !== undefined && cell.value !== null && !(Number.isInteger(cell.value) && cp.options?.[cell.value])) {
        errors.push({ path: `cells.${i}.value`, message: `Choose one of the options of ${cp.checkpoint}.` });
      }
    }
    for (const [i, e] of body.entries.entries()) {
      const cp = byUid.get(e.checkpointUid);
      if (!cp) errors.push({ path: `entries.${i}.checkpointUid`, message: 'Not a checkpoint of this format.' });
      else if (cp.section === 'RECORD') {
        if (e.manualResult) errors.push({ path: `entries.${i}.manualResult`, message: `${cp.checkpoint} is decided from its answer.` });
        const problem = recordAnswerProblem(cp, e.textObservation);
        if (problem) errors.push({ path: `entries.${i}.textObservation`, message: problem });
      } else if (cp.section !== 'RELIABILITY' && (e.textObservation || e.manualResult)) {
        errors.push({ path: `entries.${i}`, message: 'Only reliability tests and lot details take an observation.' });
      }
    }
    if (errors.length) throw AppError.unprocessable(errors[0].message, errors);

    for (const cell of body.cells) {
      const cp = byUid.get(cell.checkpointUid);
      const choice = cp.section === 'VISUAL' && cp.inputType === 'CHOICE';
      const value = cp.section === 'DIMENSIONAL' || choice ? (cell.value ?? null) : null;
      const ok = cp.section === 'VISUAL' && !choice ? (cell.ok ?? null) : null;
      if (value === null && ok === null) {
        await db.query('DELETE FROM qms.imir_observation WHERE imir_id = $1 AND checkpoint_uid = $2 AND sample_no = $3', [id, cell.checkpointUid, cell.sampleNo]);
        continue;
      }
      await db.query(
        `INSERT INTO qms.imir_observation (imir_id, checkpoint_uid, sample_no, value_num, value_ok, decision, recorded_by, device_id, client_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (imir_id, checkpoint_uid, sample_no) DO UPDATE SET value_num = EXCLUDED.value_num, value_ok = EXCLUDED.value_ok,
           decision = EXCLUDED.decision, recorded_at = now(), recorded_by = EXCLUDED.recorded_by, device_id = EXCLUDED.device_id, client_time = EXCLUDED.client_time`,
        [id, cell.checkpointUid, cell.sampleNo, value, ok, cellDecision(cp, { value, ok }), user.id, body.deviceId ?? null, clientTime],
      );
    }
    for (const e of body.entries) {
      const sets = [];
      const args = [id, e.checkpointUid, user.id];
      for (const [k, col] of [['inspectorRemark', 'inspector_remark'], ['textObservation', 'text_observation'], ['manualResult', 'manual_result']]) {
        if (e[k] !== undefined) {
          args.push(e[k]);
          sets.push(`${col} = $${args.length}`);
        }
      }
      if (sets.length) await db.query(`UPDATE qms.imir_checkpoint SET ${sets.join(', ')}, updated_at = now(), updated_by = $3 WHERE imir_id = $1 AND checkpoint_uid = $2`, args);
    }

    // The saving inspector holds the lot (taking over a lapsed hold is recorded).
    const held = claimOf(imir, user);
    if (held && !held.mine) await takeClaim(db, user, imir, { lapsed: true });
    await db.query(
      `UPDATE qms.imir SET status = 'IN_INSPECTION', claimed_by = $2, claimed_at = now(),
              model = CASE WHEN $3::boolean THEN $4 ELSE model END,
              inspector_remark = CASE WHEN $5::boolean THEN $6 ELSE inspector_remark END,
              inspection_started_at = COALESCE(inspection_started_at, now()), inspected_by = COALESCE(inspected_by, $2)
        WHERE id = $1`,
      [id, user.id, body.model !== undefined, body.model ?? null, body.inspectorRemark !== undefined, body.inspectorRemark ?? null],
    );
  });
  return detail(id, user);
}

/**
 * Submits the inspection: every required cell must be filled (the model is optional). The server
 * computes the result, records reliability tests for the due-date check, locks the observations
 * and releases any tablet checkout.
 */
export async function submit(ctx, user, id, { rowVersion, deviceId }) {
  await withTransaction(ctx, async (db) => {
    const imir = await lockForInspection(db, user, id, deviceId);
    if (rowVersion !== null && rowVersion !== undefined && imir.rowVersion !== rowVersion) throw AppError.staleVersion('This IMIR');
    const full = await detail(id, null, db);
    const { missing, result, defectiveSamples, checkpointResults } = full.evaluation;
    if (missing.length) {
      throw AppError.unprocessable(`${missing.length} required observation${missing.length > 1 ? 's are' : ' is'} still empty.`, missing.map((m) => ({ path: `${m.checkpointUid}${m.sampleNo ? `:${m.sampleNo}` : ''}`, message: m.field })));
    }
    const snapshot = await imirSnapshot(db, id);
    for (const cp of full.checkpoints) {
      await db.query('UPDATE qms.imir_checkpoint SET result = $3 WHERE imir_id = $1 AND checkpoint_uid = $2', [id, cp.uid, checkpointResults[cp.uid]]);
      if (cp.section === 'RELIABILITY' && cp.manualResult) {
        await db.query(
          `INSERT INTO qms.reliability_test_log (item_id, vendor_id, checkpoint_uid, imir_id, tested_at, result) VALUES ($1, $2, $3, $4, now(), $5)
           ON CONFLICT (item_id, vendor_id, checkpoint_uid, imir_id) DO UPDATE SET tested_at = now(), result = EXCLUDED.result`,
          [imir.itemId, imir.vendorId, cp.uid, id, cp.manualResult],
        );
      }
    }
    await db.query(
      `UPDATE qms.imir SET status = 'SUBMITTED', result = $2, defective_samples = $3, submitted_at = now(), submitted_by = $4, claimed_by = NULL, claimed_at = NULL WHERE id = $1`,
      [id, result, defectiveSamples, user.id],
    );
    await db.query('DELETE FROM qms.imir_checkout WHERE imir_id = $1', [id]);
    await logAction(db, { imirId: id, action: 'SUBMIT', fromStatus: imir.status, toStatus: 'SUBMITTED', actorId: user.id, actingRole: inspectingRole(user, imir), payload: { result, defectiveSamples }, snapshot });
  });
  return detail(id, user);
}
