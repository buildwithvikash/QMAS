import { getPool } from '../../db/pool.js';
import { readObject } from '../../integrations/storage/index.js';
import { COLORS, FormSheet, HEAD, heightFor, logoPng, VALUE } from '../../shared/formSheet.js';
import * as repo from './dn.repo.js';

/**
 * The DN as the review workbook's "Defect Notification Format" (Incoming sheet): title with the
 * logo, lot details on green labels, DN type, quantities, the defect table, up to four photos,
 * the CAPA note, defect and correction, then the vendor's root cause and corrective action with
 * target / closing dates and responsibility. `dn` is the DN detail. Written as Excel and PDF.
 */

const IST = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
const day = (v) => (v ? IST.format(new Date(v)) : '');
const num = (v, uom) => (v === null || v === undefined ? '' : `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 })}${uom ? ` ${uom}` : ''}`);
const GREEN = { bold: true, fill: COLORS.green, align: 'left' };
const TYPES = [['IL', 'INCOMING'], ['LN', 'LINE'], ['RL', 'LAB'], ['FD', 'FIELD']];
const JIR = { CLOSED_ACCEPTED: 'Accepted', CLOSED_REJECTED: 'Rejected', CLOSED_UNDER_DEVIATION: 'Accepted under deviation', AUTO_CLOSED: 'Auto-closed' };

export async function buildDnForm(dn, db = getPool()) {
  const { rows: cat } = await db.query('SELECT c.name FROM mst.item i LEFT JOIN mst.item_category c ON c.id = i.category_id WHERE i.id = $1', [dn.itemId]);
  // Columns B…J of the format: B wide for labels, J a little wider.
  const f = new FormSheet({ name: 'Defect Notification', widths: [18, 12, 18, 13, 12, 16, 13, 12, 17] });
  const L = f.lastCol; // 8

  const t = f.row(72);
  f.merge(t, 0, t, 1, '', {});
  f.image(logoPng(), 'png', t, 0, t, 1);
  f.merge(t, 2, t, L, [{ text: 'DEFECT NOTIFICATION\n', bold: true }, { text: `DN No. ${dn.dnNo}`, bold: false }], { bold: true, size: 20, align: 'center' });

  // Details: three pairs per row (label B:C / value D, label E:F / value G, label H:I / value J).
  const details = [
    [['DN No.', dn.dnNo], ['DN Date', day(dn.dnDate)], ['Item Code', dn.itemCode]],
    [['IMIR / CCF No.', dn.imirNo ?? ''], ['Inspection Date', day(dn.inspectedAt)], ['Item Description', dn.itemDescription]],
    [['GRN No.', dn.grnNo ?? ''], ['Vendor Code', dn.vendorCode], ['Item Category', cat[0]?.name ?? '']],
    [['GRN Date', day(dn.grnDate)], ['Vendor Name', dn.vendorName], ['UOM', dn.uom ?? '']],
    [['Plant', dn.plantName], ['Invoice No.', dn.invoiceNo ?? ''], ['Model', dn.model ?? '']],
  ];
  for (const pairs of details) {
    const r = f.row(24);
    f.pairs(r, pairs.map(([k, v]) => [k, v, 2, 1]), { labelStyle: GREEN });
    f.grow(r, Math.max(...pairs.map(([, v]) => heightFor(v, 12, 11, 24))));
  }
  const d = f.row(24);
  const jir = JIR[dn.imirStatus] ?? (dn.imirResult === 'NOK' ? 'Not OK' : dn.imirResult ?? '');
  f.pairs(d, [['Inward Qty', num(dn.inwardQty, dn.uom), 2, 1], ['Final Decision on JIR', jir, 2, 1], ['CAPA Applicable', dn.capaApplicable ? 'YES' : 'NO', 2, 1]], { labelStyle: { bold: true } });

  // DN type: all four listed, the one that applies marked.
  const ty = f.row(32);
  f.merge(ty, 0, ty, 2, 'DN Type', { bold: true });
  f.merge(ty, 3, ty, L, TYPES.map(([code, label], i) => ({ text: `${i ? '   |   ' : ''}${code === dn.source ? `[X] ${label}` : label}`, bold: code === dn.source })), { align: 'center' });

  // Quantities: received (as per sampling plan), checked, defective.
  const q1 = f.row(21);
  const q2 = f.row(21);
  const q3 = f.row(24);
  f.merge(q1, 0, q2, 2, 'Received Qty', { bold: true, align: 'center' });
  f.merge(q1, 3, q1, L, '[ As per Sampling Plan ]', { align: 'center' });
  f.merge(q2, 3, q2, 5, 'Checked Qty', { bold: true, align: 'center' });
  f.merge(q2, 6, q2, L, 'Defective Qty', { bold: true, align: 'center' });
  f.merge(q3, 0, q3, 2, num(dn.receivedQty, dn.uom), { align: 'center', fill: COLORS.input });
  f.merge(q3, 3, q3, 5, num(dn.checkedQty, dn.uom), { align: 'center', fill: COLORS.input });
  f.merge(q3, 6, q3, L, num(dn.defectiveQty, dn.uom), { align: 'center', bold: true, fill: COLORS.nok, color: COLORS.nokText });

  // Defect table: Sr. No., Parameter, Specification, Defect Observed.
  const h = f.row(24);
  f.cell(h, 0, 'Sr. No.', HEAD);
  f.cell(h, 1, 'Parameter', HEAD);
  f.cell(h, 2, 'Specification', HEAD);
  f.merge(h, 3, h, L, 'Defect Observed', HEAD);
  const lines = dn.lines.length ? dn.lines : [{ lineNo: '', parameter: '', specification: '', observation: '' }];
  for (const l of lines) {
    const r = f.row(heightFor(`${l.parameter}\n${l.observation}`, 20, 11, 24));
    f.cell(r, 0, l.lineNo, { align: 'center' });
    f.cell(r, 1, l.parameter, VALUE);
    f.cell(r, 2, l.specification ?? '', VALUE);
    f.merge(r, 3, r, L, l.observation ?? '', VALUE);
    f.grow(r, Math.max(heightFor(l.specification, 15), heightFor(l.observation, 80)));
  }

  // Photos: Image 1…4, two per row.
  const keys = new Map((await repo.attachments(db, dn.id)).map((a) => [a.id, a]));
  const photos = [];
  for (const img of dn.images.slice(0, 4)) {
    const a = keys.get(img.id);
    const ext = a?.mimeType === 'image/png' ? 'png' : a?.mimeType === 'image/jpeg' ? 'jpeg' : null;
    if (!a || !ext) continue;
    try {
      photos.push({ buffer: await readObject(a.storageKey), ext, name: img.fileName });
    } catch { /* a missing file is left out */ }
  }
  // Only the slots that hold a photo (two per row).
  for (let i = 0; i < photos.length; i += 2) {
    const cap = f.row(18);
    const top = f.row(40);
    for (let k = 1; k < 4; k += 1) f.row(40);
    const bottom = f.heights.length - 1;
    [[0, 3], [4, L]].forEach(([c1, c2], j) => {
      const p = photos[i + j];
      f.merge(cap, c1, cap, c2, p ? `Image ${i + j + 1} · ${p.name}` : '', { bold: true, align: 'center', size: 10 });
      f.merge(top, c1, bottom, c2, '', {});
      if (p) f.image(p.buffer, p.ext, top, c1, bottom, c2);
    });
  }

  const note = f.row(26);
  f.merge(note, 0, note, L, dn.capaApplicable
    ? `Note: CAPA is applicable. The vendor has to share the CAPA within 3 days${dn.capaDueAt ? `, by ${day(dn.capaDueAt)}` : ''}.`
    : 'Note: CAPA is not applicable for this DN.', { bold: true });

  const block = (label, text, minRows = 5) => {
    const r = f.row(Math.max(minRows * 20, heightFor(`${label}\n${text ?? ''}`, 130, 11, 60)));
    f.merge(r, 0, r, L, [{ text: `${label}\n`, bold: true }, { text: text ?? '' }], { valign: 'top' });
  };
  const dates = (target, closing, responsibility) => {
    const r = f.row(24);
    f.merge(r, 0, r, 2, [{ text: 'TARGET DATE: ', bold: true }, { text: target }], {});
    f.merge(r, 3, r, 5, [{ text: 'CLOSING DATE: ', bold: true }, { text: closing }], {});
    f.merge(r, 6, r, L, [{ text: 'RESPONSIBILITY: ', bold: true }, { text: responsibility }], {});
  };
  block('DEFECT:', dn.defect);
  block('CORRECTION', dn.correction, 4);
  dates('', '', '');

  // The vendor's CAPA: the approved one, else the latest submitted.
  const capa = dn.capas.find((c) => c.reviewDecision === 'APPROVED') ?? dn.capas.at(-1) ?? null;
  block('ROOT CAUSE', capa?.rootCause);
  block('CORRECTIVE ACTION', capa?.correctiveAction);
  dates(day(capa?.targetDate), day(capa?.closingDate), capa?.responsibility ?? '');
  if (capa) {
    const r = f.row(24);
    const review = capa.reviewDecision
      ? `${capa.reviewDecision === 'APPROVED' ? 'Approved' : 'Resubmission asked'} by ${capa.reviewedByName ?? 'IQC Head'} on ${day(capa.reviewedAt)}${capa.reviewRemark ? `: ${capa.reviewRemark}` : ''}`
      : 'Awaiting IQC Head review';
    f.merge(r, 0, r, 2, `CAPA cycle ${capa.cycleNo} review`, { bold: true });
    f.merge(r, 3, r, L, review, VALUE);
    f.grow(r, heightFor(review, 90));
  }
  return f;
}
