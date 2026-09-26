import { getPool } from '../../db/pool.js';
import { COLORS, FormSheet, heightFor, LABEL, logoPng, VALUE } from '../../shared/formSheet.js';

/**
 * The deviation as the review workbook's "Deviation Form Format": title with the logo and form
 * number, lot details, initiator and quantity, type of deviation and action (the chosen ones
 * marked), specification, IQC observation, correction, corrective action, OK / Not OK quantities
 * and the approvals. `d` is the deviation detail. Written as Excel and PDF.
 */

const IST = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
const day = (v) => (v ? IST.format(new Date(v)) : '');
// Compact date for the narrow Date column of the approvals table (e.g. 24-09-2026).
const shortDay = (v) => (v ? new Date(v).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }).replaceAll('/', '-') : '');
const num = (v, uom) => (v === null || v === undefined ? '' : `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 })}${uom ? ` ${uom}` : ''}`);
const GREEN = { bold: true, fill: COLORS.green, align: 'left' };
const APPROVAL_STEPS = {
  SUBMIT_FORM: 'Form submitted', DEPT_APPROVE: 'Approved', SEND_BACK: 'Sent back', DEPT_REJECT: 'Rejected', RECOMMEND_REJECT: 'Rejection recommended',
  FINAL_APPROVE: 'Final decision: approved', FINAL_REJECT: 'Final decision: rejected', SENIOR_RESULT: 'Senior escalation decided', OVERRIDE: 'Decision overridden',
  VERIFY_QTY: 'Quantities verified',
};
const OUTCOME = { ACCEPTED_UNDER_DEVIATION: 'ACCEPTED UNDER DEVIATION', REJECTED: 'REJECTED', AUTO_CLOSED: 'AUTO-CLOSED' };

export async function buildDeviationForm(d, db = getPool()) {
  const { rows } = await db.query(
    `SELECT m.submitted_at, m.invoice_no, c.name AS item_category
       FROM qms.imir m JOIN mst.item i ON i.id = m.item_id LEFT JOIN mst.item_category c ON c.id = i.category_id WHERE m.id = $1`,
    [d.imirId],
  );
  const lot = rows[0] ?? {};
  // Columns B…I of the format.
  const f = new FormSheet({ name: 'Deviation Form', widths: [22, 22, 14, 12, 14, 12, 14, 16] });
  const L = f.lastCol; // 7

  const t = f.row(61);
  f.cell(t, 0, '', {});
  f.image(logoPng(), 'png', t, 0, t, 0);
  f.merge(t, 1, t, L, [{ text: 'DEVIATION FORM', bold: true }, { text: `          DEVIATION FORM NO: ${d.deviationNo}`, bold: true }], { size: 18, align: 'center' });

  // Details: label B / value C, label D:E / value F, label G:H / value I.
  const details = [
    [['JIR No.', d.imirNo], ['Inspection Date', day(lot.submitted_at)], ['Deviation Form Date', day(d.formSubmittedAt ?? d.createdAt)]],
    [['GRN No.', d.grnNo], ['Vendor Code', d.vendorCode], ['Item Code', d.itemCode]],
    [['GRN Date', day(d.grnDate)], ['Vendor Name', d.vendorName], ['Item Description', d.itemDescription]],
    [['Plant', d.plantName], ['Invoice No.', lot.invoice_no ?? ''], ['Item Category', lot.item_category ?? '']],
    [['Inward Qty', num(d.inwardQty, d.uom)], ['Model', d.model ?? ''], ['UOM', d.uom ?? '']],
  ];
  for (const pairs of details) {
    const r = f.row(24);
    f.merge(r, 0, r, 0, pairs[0][0], LABEL);
    f.cell(r, 1, pairs[0][1], VALUE);
    f.merge(r, 2, r, 3, pairs[1][0], GREEN);
    f.cell(r, 4, pairs[1][1], VALUE);
    f.merge(r, 5, r, 6, pairs[2][0], GREEN);
    f.cell(r, 7, pairs[2][1], VALUE);
    f.grow(r, Math.max(heightFor(pairs[1][1], 14, 11, 24), heightFor(pairs[2][1], 16, 11, 24)));
  }
  const i1 = f.row(20);
  const i2 = f.row(20);
  f.merge(i1, 0, i2, 0, 'Deviation Initiator', { bold: true });
  f.merge(i1, 1, i2, 1, d.initiatorName ?? '', VALUE);
  f.merge(i1, 2, i2, 2, 'Deviation Initiator Dept', { bold: true });
  f.merge(i1, 3, i2, 4, d.department, VALUE);
  f.merge(i1, 5, i2, 5, 'Deviation Qty', { bold: true });
  f.merge(i1, 6, i2, 7, num(d.deviationQty, d.uom), { ...VALUE, bold: true });

  // Type of deviation and action: every option listed, the chosen one marked.
  const ty = f.row(26);
  f.cell(ty, 0, 'Type of Deviation', { bold: true });
  f.merge(ty, 1, ty, L, ['MAJOR', 'MINOR', 'CRITICAL'].map((s, i) => ({ text: `${i ? '   /   ' : ''}${s === d.severity ? `[X] ${s}` : s}`, bold: s === d.severity })), { align: 'center' });
  const ac = f.row(26);
  f.cell(ac, 0, 'ACTION', { bold: true });
  [['UAI', 'USE AS IS', 1, 2], ['SEGREGATION', 'SEGREGATION', 3, 4], ['REWORK', 'REWORK', 5, 6]].forEach(([code, label, c1, c2]) => {
    const on = d.action === code;
    f.merge(ac, c1, ac, c2, on ? `[X] ${label}` : label, { align: 'center', bold: on, fill: on ? COLORS.pick : undefined });
  });
  f.cell(ac, 7, '', {});

  const block = (label, text, minRows) => {
    const r = f.row(Math.max(minRows * 31, heightFor(`${label}\n${text ?? ''}`, 110, 11, 60)));
    f.merge(r, 0, r, L, [{ text: `${label}\n`, bold: true }, { text: text ?? '' }], { valign: 'top' });
  };
  block('SPECIFICATION', d.specification, 3);
  block('OBSERVATION BY IQC INCHARGE & HEAD', d.iqcObservation, 3);
  block('CORRECTION', d.correction, 3);
  block('CORRECTIVE ACTION', d.correctiveAction, 4);

  const qty = f.row(40);
  f.cell(qty, 0, 'OK QTY', { bold: true });
  f.merge(qty, 1, qty, 3, num(d.okQty, d.uom), { align: 'center', fill: COLORS.pick, bold: true });
  f.cell(qty, 4, 'NOT OK QTY', { bold: true });
  f.merge(qty, 5, qty, L, num(d.notOkQty, d.uom), { align: 'center', fill: d.notOkQty ? COLORS.nok : undefined, bold: true });

  // Approvals as a table: one row per step (stage, who, role, date, remarks), then the outcome.
  // Columns: stage C, name D:E, role F, date G, remarks H:I; "APPROVAL" spans the rows in B.
  const steps = (d.history ?? []).filter((h) => h.deviationId === d.id && APPROVAL_STEPS[h.action]);
  const head = f.row(22);
  f.keep(head);
  [['Stage', 1, 1], ['Approved by', 2, 3], ['Role', 4, 4], ['Date', 5, 5], ['Remarks', 6, L]].forEach(([label, c1, c2]) => {
    f.merge(head, c1, head, c2, label, { ...LABEL, align: 'center' });
  });
  const stepRows = steps.map((h) => {
    const r = f.row(Math.max(22, heightFor(APPROVAL_STEPS[h.action], 20, 11, 22), heightFor(h.remark ?? '', 28, 11, 22), heightFor(h.actingRoleName ?? '', 12, 11, 22)));
    f.cell(r, 1, APPROVAL_STEPS[h.action], VALUE);
    f.merge(r, 2, r, 3, h.actorName ?? 'System', VALUE);
    f.cell(r, 4, h.actingRoleName ?? '', VALUE);
    f.cell(r, 5, shortDay(h.at), { align: 'center' });
    f.merge(r, 6, r, L, h.remark ?? '', VALUE);
    return r;
  });
  if (!steps.length) {
    const r = f.row(24);
    f.merge(r, 1, r, L, 'Not approved yet.', { align: 'center' });
    stepRows.push(r);
  }
  if (d.outcome) {
    const r = f.row(24);
    f.cell(r, 1, 'Outcome', { bold: true });
    f.merge(r, 2, r, L, OUTCOME[d.outcome] ?? d.outcome, { bold: true, align: 'left', fill: d.outcome === 'REJECTED' ? COLORS.nok : COLORS.pick });
    stepRows.push(r);
  }
  f.merge(head, 0, stepRows.at(-1), 0, 'APPROVAL', { bold: true });
  return f;
}
