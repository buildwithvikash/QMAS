import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { createPdf, safe } from './pdf.js';

/**
 * The review-workbook forms (IMIR "Format 2", Defect Notification, Deviation Form) as one grid
 * model, written out both as an Excel file and as a PDF so the two always look alike: merged
 * cells, fills, bold labels, thin borders, the Western logo and photos, A4 fit-to-width.
 *
 *   const f = new FormSheet({ name, widths: [chars…], landscape });
 *   const r = f.row(26);                        // a row of 26 pt
 *   f.cell(r, 0, 'JIR No.', LABEL);            // one cell
 *   f.merge(r, 1, r, 3, value, VALUE);         // cells c1..c2 on rows r1..r2
 *   f.image(buffer, 'png', r1, c1, r2, c2);
 *   await f.toXlsx(); await f.toPdf();
 *
 * A value may be rich text: [{ text, bold }]. Rows and columns are 0-based.
 */

export const COLORS = {
  label: 'FFD9E1F2', // light blue label cells (theme accent 1, 80 % lighter)
  green: 'FF92D050', // bright green label cells (DN, Deviation Form)
  reading: 'FFE2EFDA', // light green observation cells (theme accent 6, 80 % lighter)
  input: 'FFFFFFCC', // pale yellow quantity cells
  nok: 'FFFFC7CE', // Not OK reading
  nokText: 'FF9C0006',
  pick: 'FFC6EFCE', // the chosen option (severity, action, DN type)
  white: 'FFFFFFFF',
};

const FONT = 'Arial Narrow';
export const LABEL = { bold: true, fill: COLORS.label, align: 'left' };
export const VALUE = { align: 'left' };
export const HEAD = { bold: true, align: 'center' };
export const CENTER = { align: 'center' };

let logo = null;
/** The Western logo from the review workbooks. */
export function logoPng() {
  logo ??= readFileSync(new URL('../../assets/wrl-logo-small.png', import.meta.url));
  return logo;
}

const plain = (v) => (Array.isArray(v) ? v.map((p) => p.text).join('') : v === null || v === undefined ? '' : String(v));

/** Rough height (pt) text needs in a width of `chars` at `size` pt, for rows with long text. */
export function heightFor(text, chars, size = 11, min = 20) {
  const perLine = Math.max(8, Math.floor(chars * 1.15 * (11 / size)));
  const lines = plain(text).split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return Math.max(min, Math.ceil(lines * size * 1.3 + 8));
}

export class FormSheet {
  constructor({ name, widths, landscape = false, fontSize = 11 }) {
    this.name = name;
    this.widths = widths;
    this.landscape = landscape;
    this.fontSize = fontSize;
    this.heights = [];
    this.cells = [];
    this.images = [];
    this.keepRows = new Set();
  }

  /** Keeps row r on the same page as the row after it (section titles, table headers). */
  keep(r) {
    this.keepRows.add(r);
  }

  /** Adds a row of `height` pt and returns its index. */
  row(height = 22) {
    this.heights.push(height);
    return this.heights.length - 1;
  }

  /** Makes a row at least `height` pt tall (for text that wraps). */
  grow(r, height) {
    this.heights[r] = Math.max(this.heights[r], height);
  }

  merge(r1, c1, r2, c2, value, style = {}) {
    this.cells.push({ r1, c1, r2, c2, value: value ?? '', style });
  }

  cell(r, c, value, style = {}) {
    this.merge(r, c, r, c, value, style);
  }

  /**
   * Column spans for `groups` label / value pairs across the full width: each group takes about
   * an equal share of the width, its label about `labelShare` of that. Returns [[labelSpan, valueSpan], …].
   */
  spansByWidth(groups, labelShare = 0.45) {
    const total = this.widths.reduce((a, b) => a + b, 0);
    const out = [];
    let c = 0;
    for (let g = 0; g < groups; g += 1) {
      const end = g === groups - 1 ? this.widths.length : null;
      const target = (total * (g + 1)) / groups;
      let acc = this.widths.slice(0, c).reduce((a, b) => a + b, 0);
      const start = c;
      let labelEnd = c;
      while (c < this.widths.length && (end ? c < end : acc + this.widths[c] / 2 < target)) {
        acc += this.widths[c];
        c += 1;
        if (acc - this.widths.slice(0, start).reduce((a, b) => a + b, 0) <= (total / groups) * labelShare) labelEnd = c;
      }
      const n = c - start;
      let ls = Math.min(Math.max(1, labelEnd - start), n - 1);
      // A label needs about 12 characters of width.
      while (ls < n - 1 && this.widths.slice(start, start + ls).reduce((a, b) => a + b, 0) < 12) ls += 1;
      out.push([ls, n - ls]);
    }
    return out;
  }

  /** Label and value pairs across a row: pairs = [[label, value, labelSpan, valueSpan], …]. */
  pairs(r, pairs, { labelStyle = LABEL, valueStyle = VALUE } = {}) {
    let c = 0;
    for (const [label, value, ls = 1, vs = 1] of pairs) {
      this.merge(r, c, r, c + ls - 1, label, labelStyle);
      c += ls;
      this.merge(r, c, r, c + vs - 1, value, valueStyle);
      c += vs;
    }
  }

  image(buffer, ext, r1, c1, r2, c2) {
    if (buffer && ['png', 'jpeg'].includes(ext)) this.images.push({ buffer, ext, r1, c1, r2, c2 });
  }

  get lastCol() {
    return this.widths.length - 1;
  }

  // ── Excel ────────────────────────────────────────────────────────────────────

  async toXlsx() {
    // Rows grow to fit their text (an estimate: Excel measures only when the file is opened).
    for (const c of this.cells) {
      if (c.r1 !== c.r2 || !plain(c.value)) continue;
      let chars = 0;
      for (let k = c.c1; k <= c.c2; k += 1) chars += this.widths[k];
      this.grow(c.r1, heightFor(c.value, Math.max(4, chars - 1) * (c.style.bold ? 0.9 : 1), c.style.size ?? this.fontSize, 0));
    }
    const wb = new ExcelJS.Workbook();
    wb.creator = 'QMAS';
    const ws = wb.addWorksheet(this.name, {
      pageSetup: { paperSize: 9, orientation: this.landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
      views: [{ showGridLines: false }],
    });
    ws.columns = this.widths.map((w) => ({ width: w }));
    this.heights.forEach((h, r) => { ws.getRow(r + 1).height = h; });
    const thin = { style: 'thin', color: { argb: 'FF000000' } };
    for (const { r1, c1, r2, c2, value, style } of this.cells) {
      const font = { name: FONT, size: style.size ?? this.fontSize, bold: !!style.bold, color: style.color ? { argb: style.color } : undefined };
      const cellStyle = {
        font,
        alignment: { horizontal: style.align ?? 'left', vertical: style.valign ?? 'middle', wrapText: true },
        border: style.border === false ? {} : { top: thin, left: thin, bottom: thin, right: thin },
        fill: style.fill ? { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } } : undefined,
      };
      // Every cell of a merged range carries the border and fill, or Excel draws gaps.
      for (let r = r1; r <= r2; r += 1) {
        for (let c = c1; c <= c2; c += 1) {
          const x = ws.getCell(r + 1, c + 1);
          x.border = cellStyle.border;
          if (cellStyle.fill) x.fill = cellStyle.fill;
          x.font = font;
          x.alignment = cellStyle.alignment;
        }
      }
      const top = ws.getCell(r1 + 1, c1 + 1);
      top.value = Array.isArray(value)
        ? { richText: value.map((p) => ({ text: p.text, font: { ...font, bold: p.bold ?? font.bold } })) }
        : value === '' ? null : value;
      if (typeof value === 'number' && style.numFmt) top.numFmt = style.numFmt;
      if (r1 !== r2 || c1 !== c2) ws.mergeCells(r1 + 1, c1 + 1, r2 + 1, c2 + 1);
    }
    for (const img of this.images) {
      const id = wb.addImage({ buffer: img.buffer, extension: img.ext });
      const box = this.boxPx(img);
      const size = fitInside(img.buffer, img.ext, box.w - 8, box.h - 8);
      ws.addImage(id, { tl: { col: img.c1 + 0.05, row: img.r1 + 0.05 }, ext: size, editAs: 'oneCell' });
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Size of a cell range in pixels (Excel: ~7 px per character of width, 4/3 px per point of height). */
  boxPx({ r1, c1, r2, c2 }) {
    let w = 0;
    for (let c = c1; c <= c2; c += 1) w += this.widths[c] * 7 + 5;
    let h = 0;
    for (let r = r1; r <= r2; r += 1) h += (this.heights[r] * 4) / 3;
    return { w, h };
  }

  // ── PDF ──────────────────────────────────────────────────────────────────────

  async toPdf(title) {
    const { doc, done } = createPdf({ title: title ?? this.name, layout: this.landscape ? 'landscape' : 'portrait' });
    const x0 = doc.page.margins.left;
    const top = doc.page.margins.top;
    const bottom = doc.page.height - doc.page.margins.bottom - 20;
    const colPt = this.widths.map((w) => (w * 7 + 5) * 0.75);
    const scale = Math.min(1, (doc.page.width - doc.page.margins.left - doc.page.margins.right) / colPt.reduce((a, b) => a + b, 0));
    const colX = [x0];
    for (const w of colPt) colX.push(colX.at(-1) + w * scale);
    const PAD = 3;

    // Rows grow to fit their text (single-row cells, measured as drawn).
    for (const c of this.cells) {
      if (c.r1 !== c.r2 || !plain(c.value)) continue;
      const width = colX[c.c2 + 1] - colX[c.c1] - PAD * 2;
      const need = measureRich(doc, partsOf(c), width, (c.style.size ?? this.fontSize) * scale, c.style) + PAD * 2 + 2;
      this.grow(c.r1, need / scale);
    }

    // Lay rows out on pages; a merged block is not split across a page break.
    const endOf = this.heights.map((_, r) => this.cells.filter((c) => c.r1 === r).reduce((m, c) => Math.max(m, c.r2), r));
    const pos = []; // row -> { page, y }
    let page = 0;
    let y = top;
    for (let r = 0; r < this.heights.length; r += 1) {
      let blockEnd = r;
      for (let k = r; k <= blockEnd; k += 1) {
        blockEnd = Math.max(blockEnd, endOf[k]);
        if (this.keepRows.has(k) && k + 1 < this.heights.length) blockEnd = Math.max(blockEnd, k + 1);
      }
      const blockH = this.heights.slice(r, blockEnd + 1).reduce((a, b) => a + b, 0) * scale;
      const covered = r > 0 && this.cells.some((c) => c.r1 < r && c.r2 >= r);
      if (!covered && y + blockH > bottom && y > top) {
        page += 1;
        y = top;
      }
      pos[r] = { page, y };
      y += this.heights[r] * scale;
    }
    for (let p = 1; p <= page; p += 1) doc.addPage();

    const rect = ({ r1, c1, r2, c2 }) => ({
      page: pos[r1].page,
      x: colX[c1],
      y: pos[r1].y,
      w: colX[c2 + 1] - colX[c1],
      h: this.heights.slice(r1, r2 + 1).reduce((a, b) => a + b, 0) * scale,
    });
    const range = doc.bufferedPageRange();
    for (const c of this.cells) {
      const b = rect(c);
      doc.switchToPage(range.start + b.page);
      const s = c.style;
      if (s.fill) doc.rect(b.x, b.y, b.w, b.h).fill(`#${s.fill.slice(2)}`);
      if (s.border !== false) doc.rect(b.x, b.y, b.w, b.h).lineWidth(0.5).stroke('#000000');
      if (!plain(c.value)) continue;
      doc.fillColor(s.color ? `#${s.color.slice(2)}` : '#000000');
      drawRich(doc, partsOf(c), { x: b.x + PAD, y: b.y + PAD, w: b.w - PAD * 2, h: b.h - PAD * 2 }, (s.size ?? this.fontSize) * scale, s);
    }
    for (const img of this.images) {
      const b = rect(img);
      doc.switchToPage(range.start + b.page);
      try {
        doc.image(img.buffer, b.x + 3, b.y + 3, { fit: [b.w - 6, b.h - 6], align: 'center', valign: 'center' });
      } catch { /* an image PDFKit cannot read is left out */ }
    }
    doc.switchToPage(range.start + page);
    return done();
  }
}

const partsOf = (c) => (Array.isArray(c.value) ? c.value : [{ text: plain(c.value) }]).map((p) => ({ text: safe(p.text), bold: p.bold ?? !!c.style.bold }));
const fontOf = (bold) => (bold ? 'Helvetica-Bold' : 'Helvetica');

/** Splits rich parts into lines at line breaks: [[{ text, bold }, …], …]. */
function linesOf(parts) {
  const lines = [[]];
  for (const p of parts) {
    p.text.split('\n').forEach((t, i) => {
      if (i > 0) lines.push([]);
      if (t) lines.at(-1).push({ text: t, bold: p.bold });
    });
  }
  return lines;
}

/**
 * Lays rich text out line by line: a line of several parts (bold label + value) that fits is
 * drawn part by part, aligned as asked; anything longer wraps within the cell.
 */
function layoutRich(doc, parts, width, size) {
  const lineH = size * 1.25;
  return linesOf(parts).map((segs) => {
    if (!segs.length) return { segs, h: lineH, fits: true, w: 0 };
    const w = segs.reduce((a, s) => a + doc.font(fontOf(s.bold)).fontSize(size).widthOfString(s.text), 0);
    if (w <= width) return { segs, h: lineH, fits: true, w };
    const text = segs.map((s) => s.text).join('');
    const h = doc.font(fontOf(segs[0].bold && segs.length === 1)).fontSize(size).heightOfString(text, { width, lineGap: size * 0.25 });
    return { segs, h, fits: false, w: width, text };
  });
}

function measureRich(doc, parts, width, size) {
  return layoutRich(doc, parts, width, size).reduce((a, l) => a + l.h, 0);
}

function drawRich(doc, parts, box, size, style) {
  const lines = layoutRich(doc, parts, box.w, size);
  const total = lines.reduce((a, l) => a + l.h, 0);
  let y = style.valign === 'top' ? box.y : box.y + Math.max(0, (box.h - total) / 2);
  for (const l of lines) {
    if (y > box.y + box.h) break;
    if (l.fits) {
      let x = style.align === 'center' ? box.x + (box.w - l.w) / 2 : style.align === 'right' ? box.x + box.w - l.w : box.x;
      for (const s of l.segs) {
        doc.font(fontOf(s.bold)).fontSize(size).text(s.text, x, y, { lineBreak: false });
        x += doc.widthOfString(s.text);
      }
    } else {
      doc.font(fontOf(l.segs.length === 1 && l.segs[0].bold)).fontSize(size)
        .text(l.text, box.x, y, { width: box.w, height: box.y + box.h - y, align: style.align ?? 'left', lineGap: size * 0.25, ellipsis: true });
    }
    y += l.h;
  }
}

/** Width and height (px) that fit an image inside w × h, keeping its proportions. */
function fitInside(buffer, ext, w, h) {
  const size = imageSize(buffer, ext);
  if (!size) return { width: w, height: h };
  const k = Math.min(w / size.w, h / size.h);
  return { width: Math.round(size.w * k), height: Math.round(size.h * k) };
}

/** Pixel size of a PNG or JPEG from its header. */
function imageSize(buf, ext) {
  try {
    if (ext === 'png') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  } catch { /* unreadable header */ }
  return null;
}
