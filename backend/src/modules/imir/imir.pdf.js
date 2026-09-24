import { createPdf, d, dt, grid, header, q, section, table } from '../../shared/pdf.js';

const STATUS = { CLOSED_ACCEPTED: 'Accepted', CLOSED_REJECTED: 'Rejected', CLOSED_UNDER_DEVIATION: 'Accepted under deviation', AUTO_CLOSED: 'Auto-closed' };
const NOK_FILL = (r, c) => (c.nok?.(r) ? '#fee2e2' : null);

/** Official IMIR print in the JIR layout (review workbook "Format 2"). `m` is the IMIR detail. */
export async function renderImirPdf(m) {
  const { doc, done } = createPdf({ title: `IMIR ${m.imirNo}`, layout: 'landscape' });
  header(doc, {
    title: 'IMIR - INCOMING MATERIAL INSPECTION REPORT',
    subtitle: `Product Inspection Test Standard cum Joint Inspection Report${m.commonFormatNo ? ` - Common format ${m.commonFormatNo}` : ''}`,
    docNo: m.imirNo,
    docDate: d(m.submittedAt ?? m.openedAt),
  });
  grid(doc, [
    ['Plant', `${m.plantSapCode} - ${m.plantName}`], ['Vendor', `${m.vendorName} (${m.vendorCode})`], ['GRN no. / date', `${m.grnNo} / ${d(m.grnDate)}`], ['Invoice', m.invoiceNo],
    ['Item code', m.itemCode], ['Description', m.itemDescription], ['Drawing no. / rev', m.drawingNo ? `${m.drawingNo}${m.drawingRev ? ` / ${m.drawingRev}` : ''}` : '-'], ['Model', m.model],
    ['Inward qty', q(m.inwardQty, m.uom)], ['Sample qty', `${m.sampleSize} (reject at ${m.rejectNo} NOK)`], ['Format', `v${m.formatVersionNo}${m.formatNo ? ` - ${m.formatNo}` : ''}`], ['Ref. standard', m.refStandard],
    ['SAP lot', m.sapLotNo], ['Inspected by', m.submittedByName ?? '-'], ['Result', m.result === 'NOK' ? 'NOT OK' : (m.result ?? 'Not submitted')], ['Status', STATUS[m.status] ?? m.status.replaceAll('_', ' ').toLowerCase()],
  ], 4);

  const n = m.sampleSize;
  const cellOf = (cp, s) => m.cells.find((c) => c.checkpointUid === cp.uid && c.sampleNo === s);
  const sampleW = Math.min(0.06, 0.36 / n);
  const rest = 1 - sampleW * n;

  for (const [sec, title] of [['DIMENSIONAL', 'Dimensional'], ['VISUAL', 'Visual']]) {
    const rows = m.checkpoints.filter((c) => c.section === sec);
    if (!rows.length) continue;
    const dim = sec === 'DIMENSIONAL';
    section(doc, title);
    table(doc, [
      { header: 'Checkpoint', width: rest * 0.2, key: 'checkpoint' },
      { header: 'Specification', width: rest * 0.2, key: 'specification' },
      ...(dim ? [{ header: 'LSL / USL', width: rest * 0.1, value: (c) => `${c.lsl ?? '-'} / ${c.usl ?? '-'}${c.uom ? ` ${c.uom}` : ''}` }] : []),
      { header: 'Instrument', width: rest * (dim ? 0.1 : 0.12), key: 'instrument' },
      ...Array.from({ length: n }, (_, i) => i + 1).map((s) => ({
        header: `S${s}`,
        width: sampleW,
        align: 'center',
        value: (c) => {
          const o = cellOf(c, s);
          if (!o) return '';
          return dim ? o.value : o.ok ? 'OK' : 'NOK';
        },
        nok: (c) => cellOf(c, s)?.decision === 'NOK',
      })),
      { header: 'Result', width: rest * 0.08, align: 'center', key: 'result', nok: (c) => c.result === 'NOK' },
      { header: 'Remarks (Inspector / Incharge)', width: rest * (dim ? 0.32 : 0.4), value: (c) => [c.inspectorRemark, c.inchargeRemark && `Incharge: ${c.inchargeRemark}`].filter(Boolean).join('\n') },
    ], rows, { fontSize: 7.5, fill: NOK_FILL });
  }
  const rel = m.checkpoints.filter((c) => c.section === 'RELIABILITY');
  if (rel.length) {
    section(doc, 'Reliability');
    table(doc, [
      { header: 'Test', width: 0.2, key: 'checkpoint' },
      { header: 'Specification', width: 0.22, key: 'specification' },
      { header: 'Frequency', width: 0.08, value: (c) => (c.frequencyMonths ? `${c.frequencyMonths} months` : '-') },
      { header: 'Observation', width: 0.3, value: (c) => (c.isRequired ? c.textObservation : `Not due (last tested ${d(c.lastTestedAt)})`) },
      { header: 'Result', width: 0.08, align: 'center', value: (c) => c.result ?? '-', nok: (c) => c.result === 'NOK' },
      { header: 'Remarks', width: 0.12, key: 'inspectorRemark' },
    ], rel, { fontSize: 7.5, fill: NOK_FILL });
  }
  if (m.inspectorRemark) grid(doc, [['Final remarks', m.inspectorRemark]], 1);

  if (m.history?.length) {
    section(doc, 'Review trail');
    table(doc, [
      { header: 'When', width: 0.14, value: (h) => dt(h.at) },
      { header: 'Step', width: 0.2, value: (h) => h.action.replaceAll('_', ' ').toLowerCase() },
      { header: 'By', width: 0.26, value: (h) => (h.actorName ? `${h.actorName}${h.actingRoleName ? ` (${h.actingRoleName})` : ''}` : 'System') },
      { header: 'Remark', width: 0.4, value: (h) => h.remark ?? '' },
    ], m.history, { fontSize: 7.5 });
  }
  return done();
}
