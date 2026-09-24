import ExcelJS from 'exceljs';
import { BUSINESS_TIME_ZONE, PERMISSIONS, REPORTS } from '@qmas/shared';
import { getPool } from '../../db/pool.js';
import { AppError } from '../../shared/AppError.js';
import { camelRows } from '../../shared/sql.js';
import { plantScope } from '../auth/access.service.js';

/**
 * Reports (M13). Each report is one SQL statement over the live tables, restricted to the viewer's
 * plants, returned as JSON for the screen or as an Excel file with the same columns.
 * Column types drive formatting on both: text, number, percent, date, datetime, bool.
 */

const MAX_ROWS = 20_000;
const LOCAL = (col) => `(${col} AT TIME ZONE '${BUSINESS_TIME_ZONE}')::date`;

const DEFS = {
  'imir-register': {
    dated: 'GRN date',
    columns: [
      ['imirNo', 'IMIR'], ['sapLotNo', 'SAP lot'], ['plant', 'Plant'], ['grnNo', 'GRN'], ['grnDate', 'GRN date', 'date'], ['itemCode', 'Item'],
      ['itemDescription', 'Description'], ['vendorCode', 'Vendor code'], ['vendorName', 'Vendor'], ['inwardQty', 'Inward qty', 'number'], ['uom', 'UOM'],
      ['sampleSize', 'Sample', 'number'], ['model', 'Model'], ['result', 'Result'], ['status', 'Status'], ['inspectedBy', 'Inspected by'],
      ['submittedAt', 'Submitted', 'datetime'], ['closedAt', 'Closed', 'datetime'], ['deviationNo', 'Deviation'], ['dnNo', 'DN'],
    ],
    sql: (w) => `SELECT m.imir_no, l.sap_lot_no, p.sap_code AS plant, m.grn_no, m.grn_date, i.item_code, i.description AS item_description, v.vendor_code,
                        v.name AS vendor_name, m.inward_qty, m.uom, m.sample_size, m.model, m.result, m.status, su.full_name AS inspected_by, m.submitted_at,
                        m.closed_at, d.deviation_no, n.dn_no
                   FROM qms.imir m JOIN core.plant p ON p.id = m.plant_id JOIN mst.item i ON i.id = m.item_id JOIN mst.vendor v ON v.id = m.vendor_id
                   JOIN intg.sap_inspection_lot l ON l.id = m.sap_lot_id LEFT JOIN core.app_user su ON su.id = m.submitted_by
                   LEFT JOIN qms.deviation d ON d.imir_id = m.id LEFT JOIN qms.defect_notification n ON n.imir_id = m.id
                  WHERE m.grn_date BETWEEN $1 AND $2 ${w('m.plant_id')} ORDER BY m.grn_date, m.imir_no NULLS LAST`,
  },
  'pending-ageing': {
    dated: null, // open lots as of now
    columns: [
      ['imirNo', 'IMIR'], ['plant', 'Plant'], ['itemCode', 'Item'], ['vendorName', 'Vendor'], ['status', 'Stage'], ['receivedAt', 'Received', 'datetime'],
      ['lastStepAt', 'Last step', 'datetime'], ['daysOpen', 'Days open', 'number'], ['daysInStage', 'Days in stage', 'number'], ['bucket', 'Ageing'],
    ],
    sql: (w) => `SELECT m.imir_no, p.sap_code AS plant, i.item_code, v.name AS vendor_name, m.status, m.created_at AS received_at, a.last_at AS last_step_at,
                        floor(extract(epoch FROM now() - m.created_at) / 86400)::int AS days_open,
                        floor(extract(epoch FROM now() - coalesce(a.last_at, m.created_at)) / 86400)::int AS days_in_stage
                   FROM qms.imir m JOIN core.plant p ON p.id = m.plant_id JOIN mst.item i ON i.id = m.item_id JOIN mst.vendor v ON v.id = m.vendor_id
                   LEFT JOIN LATERAL (SELECT max(at) AS last_at FROM qms.imir_action x WHERE x.imir_id = m.id) a ON true
                  WHERE m.status NOT IN ('CLOSED_ACCEPTED', 'CLOSED_REJECTED', 'CLOSED_UNDER_DEVIATION', 'AUTO_CLOSED') AND $1::date IS NOT NULL AND $2::date IS NOT NULL
                        ${w('m.plant_id')}
                  ORDER BY days_in_stage DESC, m.created_at`,
    map: (r) => ({ ...r, bucket: r.daysInStage <= 1 ? '0-1 days' : r.daysInStage <= 3 ? '2-3 days' : r.daysInStage <= 7 ? '4-7 days' : 'Over 7 days' }),
  },
  'vendor-quality': {
    dated: 'GRN date',
    columns: [
      ['vendorCode', 'Vendor code'], ['vendorName', 'Vendor'], ['lots', 'Lots', 'number'], ['inspected', 'Inspected', 'number'], ['okLots', 'OK', 'number'],
      ['nokLots', 'Not OK', 'number'], ['nokPct', 'Not OK %', 'percent'], ['accepted', 'Accepted', 'number'], ['underDeviation', 'Under deviation', 'number'],
      ['rejected', 'Rejected', 'number'], ['inwardQty', 'Inward qty', 'number'], ['rejectedPpm', 'Rejected PPM', 'number'], ['dns', 'DNs', 'number'],
    ],
    // Rejected PPM = (qty of rejected lots + Not-OK qty of lots accepted under deviation) / inward qty × 10^6
    sql: (w) => `SELECT v.vendor_code, v.name AS vendor_name, count(*)::int AS lots,
                        count(*) FILTER (WHERE m.result IS NOT NULL)::int AS inspected, count(*) FILTER (WHERE m.result = 'OK')::int AS ok_lots,
                        count(*) FILTER (WHERE m.result = 'NOK')::int AS nok_lots,
                        round(100.0 * count(*) FILTER (WHERE m.result = 'NOK') / nullif(count(*) FILTER (WHERE m.result IS NOT NULL), 0), 1) AS nok_pct,
                        count(*) FILTER (WHERE m.status = 'CLOSED_ACCEPTED')::int AS accepted,
                        count(*) FILTER (WHERE m.status = 'CLOSED_UNDER_DEVIATION')::int AS under_deviation,
                        count(*) FILTER (WHERE m.status = 'CLOSED_REJECTED')::int AS rejected,
                        sum(m.inward_qty) AS inward_qty,
                        round(1e6 * (coalesce(sum(m.inward_qty) FILTER (WHERE m.status = 'CLOSED_REJECTED'), 0) + coalesce(sum(d.not_ok_qty), 0)) / nullif(sum(m.inward_qty), 0)) AS rejected_ppm,
                        count(n.id)::int AS dns
                   FROM qms.imir m JOIN mst.vendor v ON v.id = m.vendor_id
                   LEFT JOIN qms.deviation d ON d.imir_id = m.id AND d.outcome = 'ACCEPTED_UNDER_DEVIATION'
                   LEFT JOIN qms.defect_notification n ON n.imir_id = m.id
                  WHERE m.grn_date BETWEEN $1 AND $2 ${w('m.plant_id')}
                  GROUP BY v.id ORDER BY nok_pct DESC NULLS LAST, lots DESC`,
  },
  'deviation-register': {
    dated: 'Raised on',
    columns: [
      ['deviationNo', 'Deviation'], ['imirNo', 'IMIR'], ['plant', 'Plant'], ['itemCode', 'Item'], ['vendorName', 'Vendor'], ['department', 'Dept'],
      ['severity', 'Severity'], ['action', 'Action'], ['deviationQty', 'Deviation qty', 'number'], ['stage', 'Stage'], ['deptOutcome', 'Department'],
      ['escalationRounds', 'Escalations', 'number'], ['seniorEffective', 'Senior decision'], ['finalDecision', 'IQC Head decision'], ['outcome', 'Outcome'],
      ['okQty', 'OK qty', 'number'], ['notOkQty', 'Not-OK qty', 'number'], ['createdAt', 'Raised', 'datetime'], ['closedAt', 'Closed', 'datetime'],
    ],
    sql: (w) => `SELECT d.deviation_no, m.imir_no, p.sap_code AS plant, i.item_code, v.name AS vendor_name, d.department, d.severity, d.action, d.deviation_qty,
                        d.stage, d.dept_outcome, (SELECT count(*)::int FROM qms.escalation_round r WHERE r.deviation_id = d.id) AS escalation_rounds,
                        d.senior_effective, d.final_decision, d.outcome, d.ok_qty, d.not_ok_qty, d.created_at, d.closed_at
                   FROM qms.deviation d JOIN qms.imir m ON m.id = d.imir_id JOIN core.plant p ON p.id = d.plant_id
                   JOIN mst.item i ON i.id = m.item_id JOIN mst.vendor v ON v.id = m.vendor_id
                  WHERE ${LOCAL('d.created_at')} BETWEEN $1 AND $2 ${w('d.plant_id')} ORDER BY d.created_at`,
  },
  'dn-register': {
    dated: 'DN date',
    columns: [
      ['dnNo', 'DN'], ['imirNo', 'IMIR'], ['plant', 'Plant'], ['itemCode', 'Item'], ['vendorCode', 'Vendor code'], ['vendorName', 'Vendor'], ['status', 'Status'],
      ['dnDate', 'DN date', 'datetime'], ['defectiveQty', 'Defective qty', 'number'], ['capaApplicable', 'CAPA applicable', 'bool'], ['capaDueAt', 'CAPA due', 'datetime'],
      ['capaOverdue', 'CAPA overdue', 'bool'], ['capaCycles', 'CAPA cycles', 'number'], ['daysOpen', 'Days open', 'number'], ['closedAt', 'Closed', 'datetime'],
    ],
    sql: (w) => `SELECT n.dn_no, m.imir_no, p.sap_code AS plant, i.item_code, v.vendor_code, v.name AS vendor_name, n.status, n.dn_date, n.defective_qty,
                        n.capa_applicable, n.capa_due_at, (n.status = 'OPEN' AND n.capa_applicable AND n.capa_due_at < now()) AS capa_overdue,
                        (SELECT count(*)::int FROM qms.dn_capa c WHERE c.dn_id = n.id) AS capa_cycles,
                        floor(extract(epoch FROM coalesce(n.closed_at, now()) - n.dn_date) / 86400)::int AS days_open, n.closed_at
                   FROM qms.defect_notification n LEFT JOIN qms.imir m ON m.id = n.imir_id JOIN core.plant p ON p.id = n.plant_id
                   JOIN mst.item i ON i.id = n.item_id JOIN mst.vendor v ON v.id = n.vendor_id
                  WHERE ${LOCAL('n.dn_date')} BETWEEN $1 AND $2 ${w('n.plant_id')} ORDER BY n.dn_date`,
  },
};

const NUMERIC = new Set(['number', 'percent']);
const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE }).format(new Date());
const daysBefore = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() - n * 86_400_000).toISOString().slice(0, 10);

export async function runReport(user, key, { from, to, plantId }) {
  const def = DEFS[key];
  const meta = REPORTS.find((r) => r.key === key);
  if (!def || !meta) throw AppError.notFound('Report');
  const scope = plantScope(user, PERMISSIONS.REPORTS_VIEW, 'view');
  if (plantId && !scope.all && !scope.plantIds.includes(plantId)) throw AppError.forbidden('You cannot see reports for that plant.');
  const range = { to: to ?? todayIst() };
  range.from = from ?? daysBefore(range.to, 30);
  if (range.from > range.to) throw AppError.unprocessable('"From" must be on or before "to".', [{ path: 'from', message: 'After "to".' }]);

  const args = [range.from, range.to];
  const where = (col) => {
    const parts = [];
    if (!scope.all) { args.push(scope.plantIds); parts.push(`AND ${col} = ANY($${args.length})`); }
    if (plantId) { args.push(plantId); parts.push(`AND ${col} = $${args.length}`); }
    return parts.join(' ');
  };
  const sql = `${def.sql(where)} LIMIT ${MAX_ROWS + 1}`;
  const { rows } = await getPool().query(sql, args);
  const columns = def.columns.map(([k, header, type = 'text']) => ({ key: k, header, type }));
  const data = camelRows(rows.slice(0, MAX_ROWS)).map((r) => {
    const out = def.map ? def.map(r) : r;
    for (const c of columns) if (NUMERIC.has(c.type) && out[c.key] !== null && out[c.key] !== undefined) out[c.key] = Number(out[c.key]);
    return out;
  });
  return { key, name: meta.name, description: meta.description, dated: def.dated, from: def.dated ? range.from : null, to: def.dated ? range.to : null, columns, rows: data, truncated: rows.length > MAX_ROWS };
}

/** Same report as an .xlsx workbook: header row, filters, frozen header, typed cells. */
export async function toXlsx(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QMAS';
  wb.created = new Date();
  const ws = wb.addWorksheet(report.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = report.columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: Math.min(40, Math.max(10, c.header.length + 4, c.type === 'datetime' ? 18 : 0)),
    style: c.type === 'date' ? { numFmt: 'dd-mmm-yyyy' } : c.type === 'datetime' ? { numFmt: 'dd-mmm-yyyy hh:mm' } : c.type === 'percent' ? { numFmt: '0.0' } : {},
  }));
  const shift = (v) => new Date(new Date(v).getTime() + 330 * 60_000); // Excel has no zones: write IST wall time
  for (const r of report.rows) {
    ws.addRow(Object.fromEntries(report.columns.map((c) => {
      const v = r[c.key];
      if (v === null || v === undefined) return [c.key, null];
      if (c.type === 'datetime') return [c.key, shift(v)];
      if (c.type === 'date') return [c.key, new Date(`${String(v).slice(0, 10)}T00:00:00Z`)];
      if (c.type === 'bool') return [c.key, v ? 'Yes' : 'No'];
      return [c.key, v];
    })));
  }
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: report.columns.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

/** KPI tiles for Home, restricted to the plants the user may see. */
export async function dashboardSummary(user) {
  const scope = plantScope(user, PERMISSIONS.DASHBOARD_VIEW, 'view');
  const args = scope.all ? [] : [scope.plantIds];
  const plant = (col) => (scope.all ? 'true' : `${col} = ANY($1)`);
  const pool = getPool();
  const { rows: s } = await pool.query(`SELECT status, count(*)::int AS n FROM qms.imir m WHERE ${plant('m.plant_id')} AND status NOT LIKE 'CLOSED%' AND status <> 'AUTO_CLOSED' GROUP BY status`, args);
  const { rows: l } = await pool.query(
    `SELECT count(*)::int AS received, count(*) FILTER (WHERE result = 'OK')::int AS ok, count(*) FILTER (WHERE result = 'NOK')::int AS nok,
            count(*) FILTER (WHERE status = 'CLOSED_ACCEPTED')::int AS accepted, count(*) FILTER (WHERE status = 'CLOSED_REJECTED')::int AS rejected,
            count(*) FILTER (WHERE status = 'CLOSED_UNDER_DEVIATION')::int AS under_deviation
       FROM qms.imir m WHERE ${plant('m.plant_id')} AND m.created_at >= now() - interval '30 days'`,
    args,
  );
  const { rows: dv } = await pool.query(`SELECT stage, count(*)::int AS n FROM qms.deviation d WHERE ${plant('d.plant_id')} AND stage <> 'CLOSED' GROUP BY stage`, args);
  const { rows: dn } = await pool.query(
    `SELECT count(*) FILTER (WHERE status = 'OPEN')::int AS open, count(*) FILTER (WHERE status = 'CAPA_SUBMITTED')::int AS capa_submitted,
            count(*) FILTER (WHERE status = 'OPEN' AND capa_applicable AND capa_due_at < now())::int AS capa_overdue
       FROM qms.defect_notification n WHERE ${plant('n.plant_id')}`,
    args,
  );
  const imirByStatus = Object.fromEntries(s.map((r) => [r.status, r.n]));
  const devByStage = Object.fromEntries(dv.map((r) => [r.stage, r.n]));
  return {
    imirByStatus,
    lots30Days: camelRows(l)[0],
    deviationsByStage: devByStage,
    openDeviations: dv.reduce((a, r) => a + r.n, 0),
    dn: camelRows(dn)[0],
  };
}
