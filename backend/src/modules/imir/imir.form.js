import { getPool } from '../../db/pool.js';
import { CENTER, COLORS, FormSheet, HEAD, heightFor, LABEL, logoPng, VALUE } from '../../shared/formSheet.js';

/**
 * The IMIR as the review workbook's "Format 2" (IMIR - Incoming Material Inspection Report):
 * title block with the logo and format numbers, the lot details, then dimensional, visual and
 * reliability tables with readings X1…Xn, OK / NOK and remarks, and the sign-off block.
 * `m` is the IMIR detail. The same sheet is written as Excel and as PDF.
 */

const IST = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
const day = (v) => (v ? IST.format(new Date(v)) : '');
const num = (v) => (v === null || v === undefined ? '' : Number(v));
const DECISION = {
  CLOSED_ACCEPTED: 'ACCEPTED', CLOSED_REJECTED: 'REJECTED', CLOSED_UNDER_DEVIATION: 'ACCEPTED UNDER DEVIATION', AUTO_CLOSED: 'AUTO-CLOSED',
  SUBMITTED: 'With IQC Incharge for review', WITH_IQC_HEAD: 'With IQC Head', DEPT_REVIEW: 'On hold: deviation with SCM / VD',
  IQC_HEAD_FINAL: 'Deviation: IQC Head final decision', SENIOR_ESCALATION: 'Deviation: senior escalation', UNDER_DEVIATION: 'Accepted under deviation: quantities awaited',
  QTY_VERIFICATION: 'Accepted under deviation: quantities being verified', OPEN: 'Not inspected yet', IN_INSPECTION: 'Inspection in progress',
};
const APPROVALS = ['APPROVE', 'HEAD_APPROVE', 'FINAL_APPROVE', 'FINAL_REJECT', 'VERIFY_QTY'];

export async function buildImirForm(m, db = getPool()) {
  const plan = m.samplingPlanId ? (await db.query('SELECT name FROM mst.sampling_plan WHERE id = $1', [m.samplingPlanId])).rows[0]?.name : null;
  const n = Math.max(m.sampleSize ?? 1, ...m.cells.map((c) => c.sampleNo));
  const samples = Array.from({ length: n }, (_, i) => i + 1);

  // Columns: SR, check point, specification, LSL, USL, UOM, instrument, X1…Xn, OK/NOK, remarks (inspector, incharge).
  const X = 7;
  const OK = X + n;
  const RI = OK + 1;
  const RC = OK + 2;
  const f = new FormSheet({ name: 'IMIR', widths: [7, 22, 26, 9, 9, 10, 16, ...samples.map(() => 9), 9, 18, 18], landscape: true });
  const last = f.lastCol;

  // Title block (3 rows): logo | title | Format No. / Ref. Std. / Sampling Level.
  const t = [f.row(36), f.row(36), f.row(36)];
  f.merge(t[0], 0, t[2], 1, '', {});
  f.image(logoPng(), 'png', t[0], 0, t[2], 1);
  f.merge(t[0], 2, t[2], last - 4, 'IMIR - INCOMING MATERIAL INSPECTION REPORT', { bold: true, size: 20, align: 'center' });
  [['Format No.', m.formatNo ?? m.commonFormatNo ?? ''], ['Ref. Std. :', m.refStandard ?? ''], ['Sampling Level:', plan ?? `Sample ${m.sampleSize}`]].forEach(([k, v], i) => {
    f.merge(t[i], last - 3, t[i], last - 2, k, { bold: true, align: 'center' });
    f.merge(t[i], last - 1, t[i], last, v, { bold: true, align: 'center' });
  });

  // Lot details: four label / value pairs per row, as in the format.
  const spans = f.spansByWidth(4, 0.45);
  const detailRows = [
    [['JIR No.', m.imirNo], ['Inspection Date', day(m.submittedAt ?? m.inspectionStartedAt)], ['Item Code', m.itemCode], ['Drawing No.', m.drawingNo ?? '']],
    [['GRN No.', m.grnNo], ['Vendor Code', m.vendorCode], ['Item Description', m.itemDescription], ['Dwg Revision No.', m.drawingRev ?? '']],
    [['GRN Date', day(m.grnDate)], ['Vendor Name', m.vendorName], ['Item Category', m.itemCategory ?? ''], ['Model', m.model ?? '']],
    [['Plant', m.plantName], ['Invoice No.', m.invoiceNo ?? ''], ['UOM', m.uom ?? ''], ['Lot Received', day(m.createdAt)]],
  ];
  for (const pairs of detailRows) {
    const r = f.row(24);
    f.pairs(r, pairs.map(([k, v], i) => [k, v, spans[i][0], spans[i][1]]));
  }
  const qa = f.row(24);
  const qb = f.row(24);
  f.merge(qa, 0, qa, 1, 'Inward Qty', { ...LABEL, fill: COLORS.input });
  f.merge(qa, 2, qa, 2, num(m.inwardQty), { ...VALUE, fill: COLORS.input, align: 'center' });
  f.merge(qb, 0, qb, 1, 'Sample Qty', { ...LABEL, fill: COLORS.input });
  f.merge(qb, 2, qb, 2, num(m.sampleSize), { ...VALUE, fill: COLORS.input, align: 'center' });
  f.merge(qa, 3, qb, 6, [{ text: 'Accept / Reject: ', bold: true }, { text: `${m.acceptNo ?? 0} / ${m.rejectNo ?? '-'} Not OK sample(s)` }], { align: 'center' });
  const result = m.result === 'NOK' ? 'NOT OK' : m.result ?? 'NOT SUBMITTED';
  f.merge(qa, 7, qb, last, [{ text: 'Inspection result: ', bold: true }, { text: result, bold: true }],
    { align: 'center', size: 14, fill: m.result === 'NOK' ? COLORS.nok : m.result === 'OK' ? COLORS.pick : undefined, color: m.result === 'NOK' ? COLORS.nokText : undefined });

  const cellOf = (cp, s) => m.cells.find((c) => c.checkpointUid === cp.uid && c.sampleNo === s);
  const remarkRow = (r, cp) => {
    f.cell(r, RI, cp.inspectorRemark ?? '', VALUE);
    f.cell(r, RC, cp.inchargeRemark ?? '', VALUE);
    f.grow(r, Math.max(heightFor(cp.inspectorRemark, 18), heightFor(cp.inchargeRemark, 18), heightFor(cp.checkpoint, 22), heightFor(cp.specification, 26)));
  };
  const okCell = (r, res) => f.cell(r, OK, res ?? '', { ...CENTER, bold: true, fill: res === 'NOK' ? COLORS.nok : undefined, color: res === 'NOK' ? COLORS.nokText : undefined });
  const section = (text) => {
    const r = f.row(24);
    f.merge(r, 0, r, last, text, { bold: true });
    f.keep(r);
  };

  // Dimensional: two header rows (Tolerances LSL / USL, Observations X1…Xn, Remark Inspector / Incharge).
  const dims = m.checkpoints.filter((c) => c.section === 'DIMENSIONAL');
  if (dims.length) {
    section('Dimensional Test :');
    const h1 = f.row(24);
    const h2 = f.row(22);
    f.keep(h1);
    f.keep(h2);
    [[0, 'SR No.'], [1, 'Check Points'], [2, 'Specification'], [5, 'Spec UOM'], [6, 'Instrument / Method'], [OK, 'OK / NOK']].forEach(([c, v]) => f.merge(h1, c, h2, c, v, HEAD));
    f.merge(h1, 3, h1, 4, 'Tolerances', HEAD);
    f.cell(h2, 3, 'LSL', HEAD);
    f.cell(h2, 4, 'USL', HEAD);
    f.merge(h1, X, h1, X + n - 1, 'Observations', HEAD);
    samples.forEach((s) => f.cell(h2, X + s - 1, `X${s}`, HEAD));
    f.merge(h1, RI, h1, RC, 'Remark', HEAD);
    f.cell(h2, RI, 'Inspector', HEAD);
    f.cell(h2, RC, 'Incharge', HEAD);
    dims.forEach((cp, i) => {
      const r = f.row(24);
      f.cell(r, 0, i + 1, CENTER);
      f.cell(r, 1, cp.checkpoint, VALUE);
      f.cell(r, 2, cp.specification ?? '', CENTER);
      f.cell(r, 3, num(cp.lsl), CENTER);
      f.cell(r, 4, num(cp.usl), CENTER);
      f.cell(r, 5, cp.uom ?? '', CENTER);
      f.cell(r, 6, cp.instrument ?? '', CENTER);
      samples.forEach((s) => {
        const o = cellOf(cp, s);
        const nok = o?.decision === 'NOK';
        f.cell(r, X + s - 1, o ? num(o.value) : '', { ...CENTER, fill: nok ? COLORS.nok : COLORS.reading, color: nok ? COLORS.nokText : undefined, bold: nok });
      });
      okCell(r, cp.result);
      remarkRow(r, cp);
    });
  }

  // Visual: specification spans the tolerance columns; X1…Xn hold OK / NOK.
  const vis = m.checkpoints.filter((c) => c.section === 'VISUAL');
  if (vis.length) {
    section('Visual Test :');
    const h = f.row(24);
    f.keep(h);
    [[0, 'SR No.'], [1, 'Check Points'], [5, 'Spec UOM'], [6, 'Instrument / Method'], [OK, 'OK / NOK'], [RI, 'Inspector'], [RC, 'Incharge']].forEach(([c, v]) => f.cell(h, c, v, HEAD));
    f.merge(h, 2, h, 4, 'Specification', HEAD);
    samples.forEach((s) => f.cell(h, X + s - 1, `X${s}`, HEAD));
    vis.forEach((cp, i) => {
      const r = f.row(24);
      f.cell(r, 0, i + 1, CENTER);
      f.cell(r, 1, cp.checkpoint, VALUE);
      f.merge(r, 2, r, 4, cp.specification ?? '', VALUE);
      f.cell(r, 5, '', CENTER);
      f.cell(r, 6, cp.instrument ?? 'Visual', CENTER);
      samples.forEach((s) => {
        const o = cellOf(cp, s);
        const v = o?.ok === true ? 'OK' : o?.ok === false ? 'NOK' : '';
        f.cell(r, X + s - 1, v, { ...CENTER, fill: v === 'NOK' ? COLORS.nok : COLORS.reading, color: v === 'NOK' ? COLORS.nokText : undefined, bold: v === 'NOK' });
      });
      okCell(r, cp.result);
      remarkRow(r, cp);
    });
  }

  // Reliability: frequency, and the observation across the reading columns.
  const rel = m.checkpoints.filter((c) => c.section === 'RELIABILITY');
  if (rel.length) {
    section('Reliability Test :');
    const h = f.row(24);
    f.keep(h);
    [[0, 'SR No.'], [1, 'Check Points'], [5, 'Frequency'], [6, 'Instrument / Method'], [OK, 'OK / NOK'], [RI, 'Inspector'], [RC, 'Incharge']].forEach(([c, v]) => f.cell(h, c, v, HEAD));
    f.merge(h, 2, h, 4, 'Specification', HEAD);
    f.merge(h, X, h, X + n - 1, 'Observation', HEAD);
    rel.forEach((cp, i) => {
      const r = f.row(30);
      const obs = cp.isRequired ? cp.textObservation ?? '' : `Not due on this lot${cp.lastTestedAt ? ` (last tested ${day(cp.lastTestedAt)})` : ''}`;
      f.cell(r, 0, i + 1, CENTER);
      f.cell(r, 1, cp.checkpoint, VALUE);
      f.merge(r, 2, r, 4, cp.specification ?? '', VALUE);
      f.cell(r, 5, cp.frequencyMonths ? `Once in ${cp.frequencyMonths} month${cp.frequencyMonths === 1 ? '' : 's'}` : 'Every lot', CENTER);
      f.cell(r, 6, cp.instrument ?? '', CENTER);
      f.merge(r, X, r, X + n - 1, obs, { ...VALUE, fill: COLORS.reading });
      okCell(r, cp.result);
      remarkRow(r, cp);
      f.grow(r, heightFor(obs, n * 9));
    });
  }

  // Sign-off: final remarks, checked by, approved by, final decision.
  const approval = [...(m.history ?? [])].reverse().find((h) => APPROVALS.includes(h.action));
  const remarks = [m.inspectorRemark, ...(m.history ?? []).filter((h) => h.remark && ['APPROVE', 'REVERT', 'ESCALATE', 'HEAD_APPROVE', 'HOLD'].includes(h.action)).map((h) => `${h.actingRoleName ?? ''}: ${h.remark}`)].filter(Boolean).join('\n');
  const fr = f.row(heightFor(remarks, 150, 11, 50));
  f.merge(fr, 0, fr, 1, 'Final Remarks', { bold: true });
  f.merge(fr, 2, fr, last, remarks, { ...VALUE, valign: 'top' });
  const signed = [
    ['Checked By', 'Inspector', m.submittedByName ? `${m.submittedByName}${m.submittedAt ? `, ${day(m.submittedAt)}` : ''}` : ''],
    ['Approved By', approval?.actingRoleName ?? 'Approver', approval ? `${approval.actorName ?? 'System'}, ${day(approval.at)}` : ''],
  ];
  for (const [k, who, v] of signed) {
    const r = f.row(34);
    f.merge(r, 0, r, 1, k, { bold: true });
    f.cell(r, 2, who, { bold: true });
    f.merge(r, 3, r, last, v, VALUE);
  }
  const d = f.row(34);
  f.merge(d, 0, d, 1, 'Final Decision', { bold: true, align: 'center' });
  const closed = m.status.startsWith('CLOSED') || m.status === 'AUTO_CLOSED';
  f.merge(d, 2, d, last, DECISION[m.status] ?? m.status, {
    bold: true, align: 'center', size: 13,
    fill: closed ? (m.status === 'CLOSED_REJECTED' ? COLORS.nok : COLORS.pick) : undefined,
  });
  return f;
}
