import { LIST_FIELDS } from '@qmas/shared';
import { buildDynamicFilter, listFieldMap } from '../../shared/dynamicFilter.js';
import { camelRow, camelRows, likeContains, offsetOf, orderBy } from '../../shared/sql.js';

const num = (v) => (v === null || v === undefined ? null : Number(v));

const SELECT = `SELECT n.id, n.dn_no, n.variant, n.source, n.imir_id, n.plant_id, p.sap_code AS plant_sap_code, p.name AS plant_name,
       n.item_id, i.item_code, i.description AS item_description, i.drawing_no, i.drawing_rev, n.vendor_id, v.vendor_code, v.name AS vendor_name,
       n.status, n.dn_date, n.model, n.received_qty, n.checked_qty, n.defective_qty, n.capa_applicable, n.defect, n.correction,
       n.capa_due_at, n.last_reminder_at, n.closed_at, cu.full_name AS closed_by_name, n.created_at, n.created_by, bu.full_name AS created_by_name,
       n.updated_at, n.row_version,
       m.imir_no, m.status AS imir_status, m.result AS imir_result, m.grn_no, m.grn_date, m.invoice_no, m.inward_qty, m.uom,
       m.submitted_at AS inspected_at, m.sample_size,
       (n.status = 'OPEN' AND n.capa_applicable AND n.capa_due_at < now()) AS capa_overdue
  FROM qms.defect_notification n
  JOIN core.plant p ON p.id = n.plant_id
  JOIN mst.item i ON i.id = n.item_id
  JOIN mst.vendor v ON v.id = n.vendor_id
  LEFT JOIN qms.imir m ON m.id = n.imir_id
  LEFT JOIN core.app_user bu ON bu.id = n.created_by
  LEFT JOIN core.app_user cu ON cu.id = n.closed_by`;

const fix = (r) => r && { ...r, receivedQty: num(r.receivedQty), checkedQty: num(r.checkedQty), defectiveQty: num(r.defectiveQty), inwardQty: num(r.inwardQty) };

export async function get(db, id, { forUpdate = false } = {}) {
  if (forUpdate) await db.query('SELECT 1 FROM qms.defect_notification WHERE id = $1 FOR UPDATE', [id]);
  const { rows } = await db.query(`${SELECT} WHERE n.id = $1`, [id]);
  return fix(camelRow(rows[0]));
}

export async function summaryForImir(db, imirId) {
  const { rows } = await db.query('SELECT id, dn_no, status FROM qms.defect_notification WHERE imir_id = $1', [imirId]);
  return camelRow(rows[0]) ?? null;
}

const FILTER_FIELDS = listFieldMap(LIST_FIELDS.dns, {
  dnNo: 'n.dn_no', imirNo: 'm.imir_no', itemCode: 'i.item_code', itemDescription: 'i.description', vendorName: 'v.name', vendorCode: 'v.vendor_code',
  plant: 'p.name', status: 'n.status', capaApplicable: 'n.capa_applicable', defectiveQty: 'n.defective_qty',
  dnDate: { sql: 'n.dn_date', tz: true }, capaDueAt: { sql: 'n.capa_due_at', tz: true }, closedAt: { sql: 'n.closed_at', tz: true },
});

const SORTABLE = { dnDate: 'n.dn_date', dnNo: 'n.dn_no', status: 'n.status', itemCode: 'i.item_code', capaDueAt: 'n.capa_due_at' };

/** WHERE conditions of the list; `withStatus: false` leaves the status tab out (for the counts). */
function listWhere(f, scope, arg, { withStatus = true } = {}) {
  const where = [];
  if (!scope.all) where.push(`n.plant_id = ANY(${arg(scope.plantIds)})`);
  if (f.plantId) where.push(`n.plant_id = ${arg(f.plantId)}`);
  if (f.vendorId) where.push(`n.vendor_id = ${arg(f.vendorId)}`);
  if (withStatus && f.status) where.push(`n.status = ${arg(f.status)}`);
  if (withStatus && f.overdue === true) where.push("n.status = 'OPEN' AND n.capa_applicable AND n.capa_due_at < now()");
  if (f.from) where.push(`n.dn_date >= ${arg(f.from)}::date`);
  if (f.to) where.push(`n.dn_date < ${arg(f.to)}::date + 1`);
  const dyn = buildDynamicFilter(f.filter, FILTER_FIELDS, arg);
  if (dyn) where.push(dyn);
  if (f.q) {
    const p = arg(likeContains(f.q));
    where.push(`(n.dn_no ILIKE ${p} OR m.imir_no ILIKE ${p} OR i.item_code ILIKE ${p} OR i.description ILIKE ${p} OR v.name ILIKE ${p} OR v.vendor_code ILIKE ${p})`);
  }
  return where;
}

/** The stat cards above the list: DNs by status for the current filters (all but the tab). */
export async function counts(db, f, scope) {
  const args = [];
  const arg = (v) => { args.push(v); return `$${args.length}`; };
  const where = listWhere(f, scope, arg, { withStatus: false });
  const { rows } = await db.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE x.status = 'OPEN')::int AS capa_awaited,
            count(*) FILTER (WHERE x.capa_overdue)::int AS overdue,
            count(*) FILTER (WHERE x.status = 'CAPA_SUBMITTED')::int AS with_head,
            count(*) FILTER (WHERE x.status = 'CLOSED')::int AS closed
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
    `${SELECT.replace('SELECT n.id,', 'SELECT count(*) OVER () AS total, n.id,')}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ${orderBy(SORTABLE, f.sort, f.sort ? f.order : 'desc', 'dnDate')}
      LIMIT ${arg(f.pageSize)} OFFSET ${arg(offsetOf(f))}`,
    args,
  );
  return { rows: camelRows(rows).map(({ total, ...r }) => fix(r)), total: rows[0]?.total ?? 0 };
}

export async function lines(db, dnId) {
  const { rows } = await db.query('SELECT line_no, parameter, specification, observation FROM qms.dn_defect_line WHERE dn_id = $1 ORDER BY line_no', [dnId]);
  return camelRows(rows);
}

export async function replaceLines(db, dnId, list) {
  await db.query('DELETE FROM qms.dn_defect_line WHERE dn_id = $1', [dnId]);
  for (const [i, l] of list.entries()) {
    await db.query('INSERT INTO qms.dn_defect_line (dn_id, line_no, parameter, specification, observation) VALUES ($1, $2, $3, $4, $5)', [dnId, i + 1, l.parameter, l.specification ?? null, l.observation ?? null]);
  }
}

export async function capas(db, dnId) {
  const { rows } = await db.query(
    `SELECT c.id, c.cycle_no, c.root_cause, c.corrective_action, c.target_date::text, c.closing_date::text, c.responsibility, c.remark,
            c.submitted_at, su.full_name AS submitted_by_name, c.review_decision, c.review_remark, c.reviewed_at, ru.full_name AS reviewed_by_name
       FROM qms.dn_capa c JOIN core.app_user su ON su.id = c.submitted_by LEFT JOIN core.app_user ru ON ru.id = c.reviewed_by
      WHERE c.dn_id = $1 ORDER BY c.cycle_no`,
    [dnId],
  );
  return camelRows(rows);
}

export async function attachments(db, dnId) {
  const { rows } = await db.query(
    `SELECT id, entity_type, ref, file_name, mime_type, size_bytes, uploaded_at, storage_key
       FROM qms.attachment WHERE entity_type IN ('DN', 'CAPA') AND entity_id = $1 AND deleted_at IS NULL ORDER BY uploaded_at`,
    [dnId],
  );
  return camelRows(rows);
}
