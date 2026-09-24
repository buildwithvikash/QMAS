import PDFDocument from 'pdfkit';

/**
 * Small layout helpers over PDFKit for the official IMIR / DN prints (A4, built-in Helvetica).
 * Text is reduced to the WinAnsi characters Helvetica can draw.
 */

const MAP = { '≤': '<=', '≥': '>=', '–': '-', '—': '-', '−': '-', '→': '->', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '×': 'x' };
export const safe = (v) => String(v ?? '').replace(/[^\n\x20-\xff]/g, (c) => MAP[c] ?? '?');

export const COMPANY = 'WESTERN REFRIGERATION PVT. LTD';
const IST = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
const IST_TIME = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
export const d = (v) => (v ? IST.format(new Date(v)) : '-');
export const dt = (v) => (v ? IST_TIME.format(new Date(v)) : '-');
export const q = (v, uom) => (v === null || v === undefined ? '-' : `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 })}${uom ? ` ${uom}` : ''}`);

/** Creates a document and returns { doc, done } where done() resolves to the PDF Buffer. */
export function createPdf({ title, layout = 'portrait' }) {
  const doc = new PDFDocument({ size: 'A4', layout, margin: 36, info: { Title: safe(title), Author: 'QMAS' }, bufferPages: true });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const finished = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const done = () => {
    footer(doc);
    doc.end();
    return finished;
  };
  return { doc, done };
}

export const contentWidth = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const left = (doc) => doc.page.margins.left;

export function ensureSpace(doc, h) {
  if (doc.y + h > doc.page.height - doc.page.margins.bottom - 20) doc.addPage();
}

/** Company line, document title and number box. */
export function header(doc, { title, subtitle, docNo, docDate }) {
  const x = left(doc);
  const w = contentWidth(doc);
  doc.rect(x, 36, w, 54).lineWidth(1).stroke('#1e293b');
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text(COMPANY, x + 10, 44, { width: w * 0.62 });
  doc.font('Helvetica-Bold').fontSize(11).text(safe(title), x + 10, 60, { width: w * 0.62 });
  if (subtitle) doc.font('Helvetica').fontSize(8).fillColor('#475569').text(safe(subtitle), x + 10, 75, { width: w * 0.62 });
  const bx = x + w * 0.64;
  doc.moveTo(bx, 36).lineTo(bx, 90).stroke('#1e293b');
  doc.font('Helvetica').fontSize(8).fillColor('#475569').text('No.', bx + 8, 44);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(safe(docNo ?? '-'), bx + 8, 54, { width: w * 0.34 });
  doc.font('Helvetica').fontSize(8).fillColor('#475569').text(`Date: ${safe(docDate)}`, bx + 8, 72);
  doc.x = x;
  doc.y = 100;
}

/** Label/value grid with `cols` cells per row. */
export function grid(doc, pairs, cols = 3) {
  const x = left(doc);
  const cw = contentWidth(doc) / cols;
  for (let i = 0; i < pairs.length; i += cols) {
    const row = pairs.slice(i, i + cols);
    const h = Math.max(...row.map(([, v]) => doc.font('Helvetica').fontSize(9).heightOfString(safe(v ?? '-'), { width: cw - 12 }))) + 16;
    ensureSpace(doc, h);
    const y = doc.y;
    row.forEach(([label, value], j) => {
      doc.rect(x + j * cw, y, cw, h).lineWidth(0.5).stroke('#94a3b8');
      doc.font('Helvetica').fontSize(6.5).fillColor('#64748b').text(safe(label).toUpperCase(), x + j * cw + 5, y + 3, { width: cw - 10 });
      doc.font('Helvetica').fontSize(9).fillColor('#0f172a').text(safe(value ?? '-'), x + j * cw + 5, y + 11, { width: cw - 12 });
    });
    doc.y = y + h;
  }
  doc.x = x;
  doc.moveDown(0.5);
}

export function section(doc, text) {
  ensureSpace(doc, 40);
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#1e3a8a').text(safe(text), left(doc), doc.y);
  doc.moveDown(0.2);
}

/** Labelled paragraph in a box. */
export function block(doc, label, text) {
  const x = left(doc);
  const w = contentWidth(doc);
  const h = doc.font('Helvetica').fontSize(9).heightOfString(safe(text || '-'), { width: w - 12 }) + 18;
  ensureSpace(doc, h);
  const y = doc.y;
  doc.rect(x, y, w, h).lineWidth(0.5).stroke('#94a3b8');
  doc.font('Helvetica').fontSize(6.5).fillColor('#64748b').text(safe(label).toUpperCase(), x + 5, y + 3);
  doc.font('Helvetica').fontSize(9).fillColor('#0f172a').text(safe(text || '-'), x + 5, y + 12, { width: w - 12 });
  doc.x = x;
  doc.y = y + h + 4;
}

/**
 * Table with wrapping cells and the header repeated after a page break.
 * columns: [{ header, width (fraction of the page), align?, key | value(row) }]
 */
export function table(doc, columns, rows, { fontSize = 8, fill } = {}) {
  const x = left(doc);
  const w = contentWidth(doc);
  const widths = columns.map((c) => c.width * w);
  const cell = (c, r) => safe(c.value ? c.value(r) : r[c.key]);
  const drawHeader = () => {
    const h = Math.max(...columns.map((c, i) => doc.font('Helvetica-Bold').fontSize(fontSize - 0.5).heightOfString(safe(c.header), { width: widths[i] - 6 }))) + 8;
    ensureSpace(doc, h + 14);
    const y = doc.y;
    let cx = x;
    columns.forEach((c, i) => {
      doc.rect(cx, y, widths[i], h).fillAndStroke('#e2e8f0', '#94a3b8');
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(fontSize - 0.5).text(safe(c.header), cx + 3, y + 4, { width: widths[i] - 6, align: c.align ?? 'left' });
      cx += widths[i];
    });
    doc.y = y + h;
  };
  drawHeader();
  for (const r of rows) {
    const h = Math.max(...columns.map((c, i) => doc.font('Helvetica').fontSize(fontSize).heightOfString(cell(c, r) || ' ', { width: widths[i] - 6 }))) + 8;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    let cx = x;
    columns.forEach((c, i) => {
      const bg = fill?.(r, c);
      if (bg) doc.rect(cx, y, widths[i], h).fillAndStroke(bg, '#94a3b8');
      else doc.rect(cx, y, widths[i], h).lineWidth(0.5).stroke('#94a3b8');
      doc.fillColor('#0f172a').font('Helvetica').fontSize(fontSize).text(cell(c, r), cx + 3, y + 4, { width: widths[i] - 6, align: c.align ?? 'left' });
      cx += widths[i];
    });
    doc.y = y + h;
  }
  doc.x = x;
  doc.moveDown(0.5);
}

/** Page numbers and generation stamp on every page. */
function footer(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // writing inside the bottom margin must not add a page
    const y = doc.page.height - 26;
    doc.font('Helvetica').fontSize(7).fillColor('#94a3b8');
    doc.text(`Generated by QMAS on ${dt(new Date())}. Uncontrolled when printed.`, left(doc), y, { width: contentWidth(doc) * 0.8, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, left(doc), y, { width: contentWidth(doc), align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}
