import { readObject } from '../../integrations/storage/index.js';
import { block, contentWidth, createPdf, d, ensureSpace, grid, header, q, section, table } from '../../shared/pdf.js';
import * as repo from './dn.repo.js';

const STATUS = { OPEN: 'Open - CAPA awaited', CAPA_SUBMITTED: 'CAPA submitted - with IQC Head', CLOSED: 'Closed' };

/** Official DN print (review workbook "DN format", Incoming variant). `dn` is the service detail. */
export async function renderDnPdf(dn, db) {
  const { doc, done } = createPdf({ title: `DN ${dn.dnNo}` });
  header(doc, { title: 'DEFECT NOTIFICATION', subtitle: 'Incoming material (IL)', docNo: dn.dnNo, docDate: d(dn.dnDate) });
  grid(doc, [
    ['Plant', `${dn.plantSapCode} - ${dn.plantName}`],
    ['Vendor', `${dn.vendorName} (${dn.vendorCode})`],
    ['Status', STATUS[dn.status]],
    ['Item code', dn.itemCode],
    ['Item description', dn.itemDescription],
    ['Drawing no. / rev', dn.drawingNo ? `${dn.drawingNo}${dn.drawingRev ? ` / ${dn.drawingRev}` : ''}` : '-'],
    ['GRN no. / date', `${dn.grnNo ?? '-'} / ${d(dn.grnDate)}`],
    ['Invoice no.', dn.invoiceNo],
    ['Model', dn.model],
    ['IMIR / CCF no.', dn.imirNo],
    ['Inspection date', d(dn.inspectedAt)],
    ['Final decision on JIR', dn.imirResult === 'NOK' ? 'Not OK' : dn.imirResult === 'OK' ? 'OK' : '-'],
    ['Received qty', q(dn.receivedQty, dn.uom)],
    ['Checked qty', q(dn.checkedQty, dn.uom)],
    ['Defective qty', q(dn.defectiveQty, dn.uom)],
  ]);
  section(doc, 'Defect details');
  table(doc, [
    { header: '#', width: 0.05, value: (r) => r.lineNo, align: 'center' },
    { header: 'Parameter', width: 0.25, key: 'parameter' },
    { header: 'Specification', width: 0.3, key: 'specification' },
    { header: 'Defect observed', width: 0.4, key: 'observation' },
  ], dn.lines.length ? dn.lines : [{ lineNo: '', parameter: '-', specification: '', observation: '' }]);
  block(doc, 'Defect', dn.defect);
  block(doc, 'Correction', dn.correction);

  // Up to 4 images, two per row. PDFKit draws JPEG and PNG; other files are listed by name.
  if (dn.images.length) {
    section(doc, 'Images');
    const drawable = dn.images.filter((i) => i.mimeType === 'image/jpeg' || i.mimeType === 'image/png');
    const keys = new Map((await repo.attachments(db, dn.id)).map((f) => [f.id, f.storageKey]));
    const w = (contentWidth(doc) - 12) / 2;
    for (let i = 0; i < drawable.length; i += 2) {
      ensureSpace(doc, 180);
      const y = doc.y;
      for (const [j, img] of drawable.slice(i, i + 2).entries()) {
        const x = doc.page.margins.left + j * (w + 12);
        try {
          doc.image(await readObject(keys.get(img.id)), x, y, { fit: [w, 170], align: 'center', valign: 'center' });
        } catch {
          doc.font('Helvetica').fontSize(8).fillColor('#475569').text(`[${img.fileName} could not be drawn]`, x, y);
        }
      }
      doc.x = doc.page.margins.left;
      doc.y = y + 178;
    }
    const other = dn.images.filter((i) => !drawable.includes(i));
    if (other.length) doc.font('Helvetica').fontSize(8).fillColor('#475569').text(`Also attached: ${other.map((o) => o.fileName).join(', ')}`);
  }

  section(doc, 'CAPA (vendor)');
  const capa = dn.capas.at(-1);
  if (!dn.capaApplicable) block(doc, 'CAPA', 'Not applicable for this DN.');
  else if (!capa) block(doc, 'CAPA', `Awaited from the vendor. Due ${d(dn.capaDueAt)}.`);
  else {
    block(doc, 'Root cause', capa.rootCause);
    block(doc, 'Corrective action', capa.correctiveAction);
    grid(doc, [
      ['Target date', d(capa.targetDate)],
      ['Closing date', d(capa.closingDate)],
      ['Responsibility', capa.responsibility],
      ['Submitted', `${capa.submittedByName} - ${d(capa.submittedAt)}`],
      ['IQC Head review', capa.reviewDecision ? `${capa.reviewDecision === 'APPROVED' ? 'Approved' : 'Resubmission asked'} - ${capa.reviewedByName}` : 'Pending'],
      ['CAPA cycle', `${capa.cycleNo} of ${dn.capas.length}`],
    ]);
  }
  grid(doc, [
    ['Raised by (IQC Incharge)', `${dn.createdByName ?? '-'} - ${d(dn.createdAt)}`],
    ['Closed by (IQC Head)', dn.closedAt ? `${dn.closedByName} - ${d(dn.closedAt)}` : '-'],
  ], 2);
  return done();
}
