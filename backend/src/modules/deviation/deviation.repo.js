import { LIST_FIELDS } from '@qmas/shared';
import { buildDynamicFilter, listFieldMap } from '../../shared/dynamicFilter.js';
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

const FILTER_FIELDS = listFieldMap(LIST_FIELDS.deviations, {
  deviationNo: 'd.deviation_no', imirNo: 'm.imir_no', itemCode: 'i.item_code', itemDescription: 'i.description', vendorName: 'v.name', vendorCode: 'v.vendor_code',
  plant: 'p.name', department: 'd.department', stage: 'd.stage', severity: 'd.severity', action: 'd.action', seniorEffective: 'd.senior_effective',
  outcome: 'd.outcome', deviationQty: 'd.deviation_qty', createdAt: { sql: 'd.created_at', tz: true }, closedAt: { sql: 'd.closed_at', tz: true },
});

const SORTABLE = { createdAt: 'd.created_at', updatedAt: 'd.updated_at', deviationNo: 'd.deviation_no', stage: 'd.stage', itemCode: 'i.item_code' };

/** WHERE conditions of the list; `withStatus: false` leaves the stage tab out (for the counts). */
const STAGE_GROUPS = { DEPARTMENT: ['INITIATOR', 'SUB_HEAD', 'HEAD'], QUANTITIES: ['UNDER_DEVIATION', 'QTY_VERIFICATION'] };

function listWhere(f, scope, arg, { withStatus = true } = {}) {
  const where = [];
  if (!scope.all) where.push(`d.plant_id = ANY(${arg(scope.plantIds)})`);
  if (f.plantId) where.push(`d.plant_id = ${arg(f.plantId)}`);
  if (f.vendorId) where.push(`m.vendor_id = ${arg(f.vendorId)}`);
  if (withStatus && f.stage) where.push(`d.stage = ${arg(f.stage)}`);
  if (withStatus && f.stageGroup) where.push(`d.stage = ANY(${arg(STAGE_GROUPS[f.stageGroup])})`);
  if (withStatus && f.open === true) where.push("d.stage <> 'CLOSED'");
  if (withStatus && f.open === false) where.push("d.stage = 'CLOSED'");
  if (f.department) where.push(`d.department = ${arg(f.department)}`);
  if (f.from) where.push(`(d.created_at AT TIME ZONE 'Asia/Kolkata')::date >= ${arg(f.from)}::date`);
  if (f.to) where.push(`(d.created_at AT TIME ZONE 'Asia/Kolkata')::date <= ${arg(f.to)}::date`);
  const dyn = buildDynamicFilter(f.filter, FILTER_FIELDS, arg);
  if (dyn) where.push(dyn);
  if (f.q) {
    const p = arg(likeContains(f.q));
    where.push(`(d.deviation_no ILIKE ${p} OR m.imir_no ILIKE ${p} OR i.item_code ILIKE ${p} OR i.description ILIKE ${p} OR v.name ILIKE ${p})`);
  }
  return where;
}

/** The stat cards above the list: deviations by stage for the current filters (all but the tab). */
export async function counts(db, f, scope) {
  const args = [];
  const arg = (v) => { args.push(v); return `$${args.length}`; };
  const where = listWhere(f, scope, arg, { withStatus: false });
  const { rows } = await db.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE x.stage IN ('INITIATOR', 'SUB_HEAD', 'HEAD'))::int AS with_department,
            count(*) FILTER (WHERE x.stage = 'FINAL')::int AS final_decision,
            count(*) FILTER (WHERE x.stage = 'SENIOR')::int AS escalated,
            count(*) FILTER (WHERE x.stage IN ('UNDER_DEVIATION', 'QTY_VERIFICATION'))::int AS quantities,
            count(*) FILTER (WHERE x.stage = 'CLOSED')::int AS closed
       FROM (${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}) x`,
    args,
  );
  return camelRow(rows[0]);
}

export async function list(db, f, scope) {
  const args = [];
  const arg = (v) => { args.push(v); return `$${args.length}`; };
  const where = listWhere(f, scope, arg);
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
