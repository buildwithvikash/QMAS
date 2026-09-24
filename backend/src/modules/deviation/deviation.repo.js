import { camelRow, camelRows, likeContains, offsetOf, orderBy } from '../../shared/sql.js';

const num = (v) => (v === null || v === undefined ? null : Number(v));

const SELECT = `SELECT d.id, d.deviation_no, d.imir_id, d.plant_id, p.sap_code AS plant_sap_code, p.name AS plant_name, d.department,
       d.suggested_actions, d.hold_remark, d.stage, d.dept_outcome, d.approval_levels, d.current_level,
       d.initiator_id, iu.full_name AS initiator_name, d.severity, d.action, d.deviation_qty, d.specification, d.iqc_observation,
       d.correction, d.corrective_action, d.form_submitted_at, d.senior_effective, d.final_decision, d.final_decision_at,
       d.qty_due_at, d.ok_qty, d.not_ok_qty, d.qty_entered_at, d.qty_entered_by, d.qty_verified_at, d.qty_verified_by,
       d.outcome, d.closed_at, d.created_at, d.updated_at, d.row_version,
       m.imir_no, m.status AS imir_status, m.result AS imir_result, m.model, m.inward_qty, m.uom, m.grn_no, m.grn_date,
       i.item_code, i.description AS item_description, v.vendor_code, v.name AS vendor_name
  FROM qms.deviation d
  JOIN qms.imir m ON m.id = d.imir_id
  JOIN core.plant p ON p.id = d.plant_id
  JOIN mst.item i ON i.id = m.item_id
  JOIN mst.vendor v ON v.id = m.vendor_id
  LEFT JOIN core.app_user iu ON iu.id = d.initiator_id`;

const fix = (r) => r && { ...r, deviationQty: num(r.deviationQty), okQty: num(r.okQty), notOkQty: num(r.notOkQty), inwardQty: num(r.inwardQty) };

export async function get(db, id, { forUpdate = false } = {}) {
  if (forUpdate) await db.query('SELECT 1 FROM qms.deviation WHERE id = $1 FOR UPDATE', [id]);
  const { rows } = await db.query(`${SELECT} WHERE d.id = $1`, [id]);
  return fix(camelRow(rows[0]));
}

/** Open deviations (for the task inbox), newest first. */
export async function listOpen(db, stages) {
  const { rows } = await db.query(`${SELECT} WHERE d.stage = ANY($1) ORDER BY d.updated_at DESC LIMIT 1000`, [stages]);
  return camelRows(rows).map(fix);
}

const SORTABLE = { createdAt: 'd.created_at', updatedAt: 'd.updated_at', deviationNo: 'd.deviation_no', stage: 'd.stage', itemCode: 'i.item_code' };

export async function list(db, f, scope) {
  const args = [];
  const arg = (v) => { args.push(v); return `$${args.length}`; };
  const where = [];
  if (!scope.all) where.push(`d.plant_id = ANY(${arg(scope.plantIds)})`);
  if (f.plantId) where.push(`d.plant_id = ${arg(f.plantId)}`);
  if (f.stage) where.push(`d.stage = ${arg(f.stage)}`);
  if (f.open === true) where.push("d.stage <> 'CLOSED'");
  if (f.open === false) where.push("d.stage = 'CLOSED'");
  if (f.department) where.push(`d.department = ${arg(f.department)}`);
  if (f.q) {
    const p = arg(likeContains(f.q));
    where.push(`(d.deviation_no ILIKE ${p} OR m.imir_no ILIKE ${p} OR i.item_code ILIKE ${p} OR i.description ILIKE ${p} OR v.name ILIKE ${p})`);
  }
  const { rows } = await db.query(
    `${SELECT.replace('SELECT d.id,', 'SELECT count(*) OVER () AS total, d.id,')}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ${orderBy(SORTABLE, f.sort, f.sort ? f.order : 'desc', 'createdAt')}
      LIMIT ${arg(f.pageSize)} OFFSET ${arg(offsetOf(f))}`,
    args,
  );
  return { rows: camelRows(rows).map(({ total, ...r }) => fix(r)), total: rows[0]?.total ?? 0 };
}

export async function formRevisions(db, deviationId) {
  const { rows } = await db.query(
    `SELECT r.revision_no, r.data, r.submitted_at, u.full_name AS submitted_by_name
       FROM qms.deviation_form_revision r LEFT JOIN core.app_user u ON u.id = r.submitted_by
      WHERE r.deviation_id = $1 ORDER BY r.revision_no`,
    [deviationId],
  );
  return camelRows(rows);
}

/** Escalation rounds with their steps and decisions, oldest first. */
export async function rounds(db, deviationIds) {
  const ids = Array.isArray(deviationIds) ? deviationIds : [deviationIds];
  const { rows: rs } = await db.query(
    `SELECT r.id, r.deviation_id, r.round_no, r.status, r.remark, r.effective_decision, r.decided_by_role, r.opened_at, r.completed_at,
            u.full_name AS opened_by_name
       FROM qms.escalation_round r LEFT JOIN core.app_user u ON u.id = r.opened_by
      WHERE r.deviation_id = ANY($1) ORDER BY r.deviation_id, r.round_no`,
    [ids],
  );
  if (!rs.length) return [];
  const roundIds = rs.map((r) => r.id);
  const { rows: steps } = await db.query(
    `SELECT s.round_id, s.role_code, ro.name AS role_name, s.rank, s.status, s.reason, s.due_at
       FROM qms.escalation_step s JOIN core.role ro ON ro.code = s.role_code
      WHERE s.round_id = ANY($1) ORDER BY s.rank DESC`,
    [roundIds],
  );
  const { rows: decisions } = await db.query(
    `SELECT e.id, e.round_id, e.role_code, e.decision, e.kind, e.remark, e.decided_by, u.full_name AS decided_by_name, e.decided_at
       FROM qms.escalation_decision e JOIN core.app_user u ON u.id = e.decided_by
      WHERE e.round_id = ANY($1) ORDER BY e.decided_at, e.id`,
    [roundIds],
  );
  const s = camelRows(steps);
  const d = camelRows(decisions);
  return camelRows(rs).map((r) => ({
    ...r,
    id: Number(r.id),
    steps: s.filter((x) => Number(x.roundId) === Number(r.id)).map(({ roundId, ...x }) => x),
    decisions: d.filter((x) => Number(x.roundId) === Number(r.id)).map(({ roundId, ...x }) => ({ ...x, id: Number(x.id) })),
  }));
}

export async function approvalChain(db, department) {
  const { rows } = await db.query('SELECT levels FROM mst.dept_approval_chain WHERE department = $1', [department]);
  return rows[0]?.levels ?? ['SUB_HEAD'];
}
