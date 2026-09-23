import { SECTIONS } from '@qmas/shared';
import { camelRow, camelRows, likeContains, offsetOf, orderBy } from '../../shared/sql.js';

const num = (v) => (v === null || v === undefined ? null : Number(v));

export const IMIR_SELECT = `SELECT m.id, m.imir_no, m.status, m.awaiting_reason, m.plant_id, p.sap_code AS plant_sap_code, p.name AS plant_name,
       m.item_id, i.item_code, i.description AS item_description, i.drawing_no, i.drawing_rev, c.name AS item_category,
       m.vendor_id, v.vendor_code, v.name AS vendor_name, m.grn_no, m.grn_date, m.invoice_no, m.inward_qty, m.uom,
       l.sap_lot_no, m.format_version_id, fv.version_no AS format_version_no, fv.format_no, fv.common_format_no, fv.ref_standard,
       m.sampling_plan_id, m.lot_size, m.sample_size, m.accept_no, m.reject_no, m.sampling_basis,
       m.model, m.inspector_remark, m.result, m.defective_samples, m.opened_at, m.inspection_started_at,
       m.inspected_by, iu.full_name AS inspected_by_name, m.submitted_at, m.submitted_by, su.full_name AS submitted_by_name, m.closed_at,
       m.created_at, m.updated_at, m.row_version,
       co.device_id AS checkout_device_id, d.device_code AS checkout_device_code, d.name AS checkout_device_name,
       co.user_id AS checkout_user_id, cu.full_name AS checkout_user_name, co.checked_out_at
  FROM qms.imir m
  JOIN core.plant p ON p.id = m.plant_id
  JOIN mst.item i ON i.id = m.item_id
  LEFT JOIN mst.item_category c ON c.id = i.category_id
  JOIN mst.vendor v ON v.id = m.vendor_id
  JOIN intg.sap_inspection_lot l ON l.id = m.sap_lot_id
  LEFT JOIN qms.format_version fv ON fv.id = m.format_version_id
  LEFT JOIN core.app_user iu ON iu.id = m.inspected_by
  LEFT JOIN core.app_user su ON su.id = m.submitted_by
  LEFT JOIN qms.imir_checkout co ON co.imir_id = m.id
  LEFT JOIN core.device d ON d.id = co.device_id
  LEFT JOIN core.app_user cu ON cu.id = co.user_id`;

const fix = (r) => r && { ...r, inwardQty: num(r.inwardQty) };

export async function get(db, id, { forUpdate = false } = {}) {
  if (forUpdate) await db.query('SELECT 1 FROM qms.imir WHERE id = $1 FOR UPDATE', [id]);
  const { rows } = await db.query(`${IMIR_SELECT} WHERE m.id = $1`, [id]);
  return fix(camelRow(rows[0]));
}

const GROUPS = {
  TO_INSPECT: "m.status IN ('OPEN', 'IN_INSPECTION')",
  AWAITING_FORMAT: "m.status = 'AWAITING_FORMAT'",
  IN_REVIEW: "m.status IN ('SUBMITTED', 'WITH_IQC_HEAD', 'DEPT_REVIEW', 'IQC_HEAD_FINAL', 'SENIOR_ESCALATION', 'UNDER_DEVIATION', 'QTY_VERIFICATION')",
  CLOSED: "m.status IN ('CLOSED_ACCEPTED', 'CLOSED_REJECTED', 'CLOSED_UNDER_DEVIATION', 'AUTO_CLOSED')",
};
const SORTABLE = { createdAt: 'm.created_at', imirNo: 'm.imir_no', grnDate: 'm.grn_date', itemCode: 'i.item_code', status: 'm.status' };

/** List restricted to the plants in `scope` ({ all } or { plantIds }). */
export async function list(db, f, scope) {
  const args = [];
  const arg = (v) => { args.push(v); return `$${args.length}`; };
  const where = [];
  if (!scope.all) where.push(`m.plant_id = ANY(${arg(scope.plantIds)})`);
  if (f.plantId) where.push(`m.plant_id = ${arg(f.plantId)}`);
  if (f.status) where.push(`m.status = ${arg(f.status)}`);
  if (f.statusGroup) where.push(GROUPS[f.statusGroup]);
  if (f.from) where.push(`m.grn_date >= ${arg(f.from)}`);
  if (f.to) where.push(`m.grn_date <= ${arg(f.to)}`);
  if (f.q) {
    const p = arg(likeContains(f.q));
    where.push(`(m.imir_no ILIKE ${p} OR m.grn_no ILIKE ${p} OR i.item_code ILIKE ${p} OR i.description ILIKE ${p} OR v.name ILIKE ${p} OR v.vendor_code ILIKE ${p} OR l.sap_lot_no ILIKE ${p})`);
  }
  const { rows } = await db.query(
    `${IMIR_SELECT.replace('SELECT m.id,', 'SELECT count(*) OVER () AS total, m.id,')}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ${orderBy(SORTABLE, f.sort, f.order, 'createdAt')}
      LIMIT ${arg(f.pageSize)} OFFSET ${arg(offsetOf(f))}`,
    args,
  );
  return { rows: camelRows(rows).map(({ total, ...r }) => fix(r)), total: rows[0]?.total ?? 0 };
}

export async function formatCheckpoints(db, versionId) {
  const { rows } = await db.query(
    `SELECT checkpoint_uid AS uid, section, seq, checkpoint, specification, nominal, lsl, usl, uom, instrument, frequency_months
       FROM qms.format_checkpoint WHERE version_id = $1 ORDER BY array_position($2::text[], section), seq`,
    [versionId, SECTIONS],
  );
  return camelRows(rows).map((c) => ({ ...c, nominal: num(c.nominal), lsl: num(c.lsl), usl: num(c.usl) }));
}

export async function checkpointStates(db, imirId) {
  const { rows } = await db.query(
    `SELECT checkpoint_uid, section, is_required, last_tested_at, text_observation, manual_result, result, inspector_remark, incharge_remark
       FROM qms.imir_checkpoint WHERE imir_id = $1`,
    [imirId],
  );
  return camelRows(rows);
}

export async function observations(db, imirId) {
  const { rows } = await db.query(
    `SELECT checkpoint_uid, sample_no, value_num AS value, value_ok AS ok, decision, recorded_at, client_time
       FROM qms.imir_observation WHERE imir_id = $1 ORDER BY checkpoint_uid, sample_no`,
    [imirId],
  );
  return camelRows(rows).map((o) => ({ ...o, value: num(o.value) }));
}

export async function attachments(db, imirId) {
  const { rows } = await db.query(
    `SELECT id, ref, file_name, mime_type, size_bytes, captured_at, uploaded_at, uploaded_by
       FROM qms.attachment WHERE entity_type = 'IMIR_OBSERVATION' AND entity_id = $1 AND deleted_at IS NULL ORDER BY uploaded_at`,
    [imirId],
  );
  return camelRows(rows);
}

export async function deviationSummary(db, imirId) {
  const { rows } = await db.query('SELECT id, deviation_no, department, stage, outcome FROM qms.deviation WHERE imir_id = $1', [imirId]);
  return camelRow(rows[0]) ?? null;
}
