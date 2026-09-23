import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { checkpointSchema, parseSpec, renumber, SECTIONS, submitProblems } from '@qmas/shared';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../shared/AppError.js';
import * as repo from './formats.repo.js';

/**
 * Bulk import of existing ("pre-fed") formats from Excel, one row per checkpoint — the layout of the
 * "For Data" sheet in the review workbook, plus optional columns. Every item with no format yet
 * gets an approved version 1 (source PRE_FED); items that already have a format are skipped.
 */
export const COLUMNS = [
  { key: 'itemCode', header: 'Item Code', required: true, aliases: ['item code', 'item', 'item no', 'item no.'] },
  { key: 'itemDescription', header: 'Item Description', aliases: ['item description', 'description'] },
  { key: 'section', header: 'Section', required: true, aliases: ['section', 'panels', 'panel', 'test type', 'type'] },
  { key: 'checkpoint', header: 'Check Point', required: true, aliases: ['check point', 'check points', 'checkpoint', 'checkpoints'] },
  { key: 'specification', header: 'Specification', aliases: ['specification', 'spec'] },
  { key: 'nominal', header: 'Nominal', aliases: ['nominal'] },
  { key: 'lsl', header: 'LSL', aliases: ['lsl', 'lower limit'] },
  { key: 'usl', header: 'USL', aliases: ['usl', 'upper limit'] },
  { key: 'uom', header: 'UOM', aliases: ['uom', 'spec uom', 'unit'] },
  { key: 'instrument', header: 'Instrument / Method', aliases: ['instrument / method', 'instrument/method', 'instrument', 'method'] },
  { key: 'frequency', header: 'Frequency', aliases: ['frequency', 'frequency (months)'] },
  { key: 'formatNo', header: 'Format No', aliases: ['format no', 'format no.', 'format number'] },
  { key: 'commonFormatNo', header: 'Common Format No', aliases: ['common format no', 'common format no.', 'common format number'] },
];
const MAX_ROWS = 100_000;

const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/** "Once in Six Months" → 6, "Yearly" → 12, 6 → 6, "" → null. Returns undefined when not understood. */
export function parseFrequency(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : undefined;
  const s = String(value).trim().toLowerCase();
  if (!s || /^(every|each) (lot|consignment|inward)$/.test(s)) return null;
  if (/^\d+$/.test(s)) return Number(s);
  if (/half[\s-]?year(ly)?|bi-?annual/.test(s)) return 6;
  if (/quarter(ly)?/.test(s)) return 3;
  if (/^(monthly|every month|once a month)$/.test(s)) return 1;
  if (/^(yearly|annual(ly)?|every year|once a year)$/.test(s)) return 12;
  const m = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(month|year)s?/.exec(s);
  if (m) {
    const n = WORD_NUMBERS[m[1]] ?? Number(m[1]);
    return m[2] === 'year' ? n * 12 : n;
  }
  return undefined;
}

function cellValue(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if ('result' in v) return v.result ?? null; // formula
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text; // hyperlink
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return v;
}

const text = (v) => (v === null || v === undefined ? null : String(v).replace(/\s+/g, ' ').trim() || null);
const numberOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : NaN;
};

function sectionOf(v) {
  const s = String(v ?? '').trim().toUpperCase();
  if (SECTIONS.includes(s)) return s;
  if (s.startsWith('DIM')) return 'DIMENSIONAL';
  if (s.startsWith('VIS')) return 'VISUAL';
  if (s.startsWith('REL')) return 'RELIABILITY';
  return null;
}

/** Reads the first sheet that has an "Item Code" header row into row objects. */
async function readRows(buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw AppError.unprocessable('The file could not be read. Upload an .xlsx workbook (Excel 2007 or later).');
  }
  for (const ws of wb.worksheets) {
    for (let r = 1; r <= Math.min(ws.rowCount, 20); r += 1) {
      const headers = {};
      ws.getRow(r).eachCell((cell, col) => {
        const h = String(cellValue(cell) ?? '').trim().toLowerCase();
        const column = COLUMNS.find((c) => c.aliases.includes(h));
        if (column && !(column.key in headers)) headers[column.key] = col;
      });
      if (!('itemCode' in headers)) continue;
      const missing = COLUMNS.filter((c) => c.required && !(c.key in headers)).map((c) => c.header);
      if (missing.length) throw AppError.unprocessable(`Sheet "${ws.name}" is missing the column(s): ${missing.join(', ')}.`);
      const rows = [];
      for (let i = r + 1; i <= ws.rowCount; i += 1) {
        const row = ws.getRow(i);
        const values = Object.fromEntries(Object.entries(headers).map(([key, col]) => [key, cellValue(row.getCell(col))]));
        if (Object.values(values).every((v) => v === null || String(v).trim() === '')) continue;
        rows.push({ rowNo: i, ...values });
        if (rows.length > MAX_ROWS) throw AppError.unprocessable(`At most ${MAX_ROWS} rows per file. Split the file and import it in parts.`);
      }
      return { sheet: ws.name, rows };
    }
  }
  throw AppError.unprocessable('No sheet has an "Item Code" header in its first 20 rows. Use the import template.');
}

/** Row → checkpoint, with messages. */
function toCheckpoint(row) {
  const messages = [];
  const section = sectionOf(row.section);
  if (!section) return { messages: [{ level: 'error', message: `Section "${row.section ?? ''}" must be Dimensional, Visual or Reliability.` }] };

  const cp = {
    section,
    checkpoint: text(row.checkpoint),
    specification: text(row.specification),
    nominal: numberOrNull(row.nominal),
    lsl: numberOrNull(row.lsl),
    usl: numberOrNull(row.usl),
    uom: text(row.uom),
    instrument: text(row.instrument),
    frequencyMonths: null,
  };
  for (const f of ['nominal', 'lsl', 'usl']) {
    if (Number.isNaN(cp[f])) {
      messages.push({ level: 'error', message: `${f.toUpperCase()} "${row[f]}" is not a number.` });
      cp[f] = null;
    }
  }

  if (section === 'DIMENSIONAL' && cp.lsl === null && cp.usl === null) {
    const parsed = parseSpec(cp.specification);
    if (parsed) {
      Object.assign(cp, { nominal: cp.nominal ?? parsed.nominal, lsl: parsed.lsl, usl: parsed.usl });
      messages.push({ level: 'info', message: `Limits read from "${cp.specification}": ${parsed.lsl ?? '—'} … ${parsed.usl ?? '—'}.` });
    }
  }
  if (section !== 'DIMENSIONAL') {
    for (const f of ['nominal', 'lsl', 'usl']) cp[f] = null;
  }
  if (section === 'RELIABILITY') {
    const months = parseFrequency(row.frequency);
    if (months === undefined) messages.push({ level: 'error', message: `Frequency "${row.frequency}" is not understood. Use months (6) or text like "Once in six months"; leave empty for every lot.` });
    else cp.frequencyMonths = months;
  }

  const r = checkpointSchema.safeParse(cp);
  if (!r.success) messages.push(...r.error.issues.map((i) => ({ level: 'error', message: `${i.path.join('.') || 'row'}: ${i.message}` })));
  return { checkpoint: r.success ? r.data : null, messages };
}

/** Validates the whole file. Nothing is written. */
export async function analyse(buffer) {
  const { sheet, rows } = await readRows(buffer);
  const groups = new Map();
  for (const row of rows) {
    const code = text(row.itemCode)?.toUpperCase() ?? null;
    const key = code ?? `(row ${row.rowNo})`;
    if (!groups.has(key)) groups.set(key, { itemCode: code, rows: [] });
    groups.get(key).rows.push(row);
  }

  const codes = [...groups.values()].map((g) => g.itemCode).filter(Boolean);
  const { rows: existing } = await getPool().query(
    `SELECT i.item_code, i.id, i.is_active, cv.version_no
       FROM mst.item i LEFT JOIN qms.format f ON f.item_id = i.id LEFT JOIN qms.format_version cv ON cv.id = f.current_version_id
      WHERE i.item_code = ANY($1)`,
    [codes],
  );
  const known = new Map(existing.map((e) => [e.item_code, e]));

  const items = [];
  for (const g of groups.values()) {
    const messages = [];
    const checkpoints = [];
    const header = { formatNo: null, commonFormatNo: null, refStandard: 'IS 2500' };
    let description = null;
    for (const row of g.rows) {
      header.formatNo ??= text(row.formatNo);
      header.commonFormatNo ??= text(row.commonFormatNo);
      description ??= text(row.itemDescription);
      const { checkpoint, messages: m } = toCheckpoint(row);
      messages.push(...m.map((x) => ({ row: row.rowNo, ...x })));
      if (checkpoint) checkpoints.push({ ...checkpoint, uid: randomUUID() });
    }
    const item = g.itemCode ? known.get(g.itemCode) : null;
    let status = 'READY';
    if (!g.itemCode) {
      messages.unshift({ row: g.rows[0].rowNo, level: 'error', message: 'Item code is empty.' });
    } else if (item?.version_no) {
      status = 'SKIP';
      messages.unshift({ level: 'info', message: `Already has approved format v${item.version_no}; not imported. Change it through a draft instead.` });
    } else if (!item && !description) {
      messages.unshift({ level: 'error', message: 'Item not in the item master. Add an Item Description column value so it can be created, or add the item first.' });
    } else if (item && !item.is_active) {
      messages.unshift({ level: 'error', message: 'Item is inactive in the item master.' });
    } else if (!item) {
      messages.unshift({ level: 'info', message: 'New item: it will be added to the item master.' });
    }
    if (status !== 'SKIP') {
      for (const p of submitProblems({ header, checkpoints })) messages.push({ level: 'error', message: p });
      if (messages.some((m) => m.level === 'error')) status = 'ERROR';
    }
    items.push({ itemCode: g.itemCode, description, itemExists: !!item, status, header, checkpoints: renumber(checkpoints), messages, firstRow: g.rows[0].rowNo, lastRow: g.rows.at(-1).rowNo });
  }

  const count = (s) => items.filter((i) => i.status === s).length;
  return {
    sheet,
    summary: { rows: rows.length, items: items.length, ready: count('READY'), skipped: count('SKIP'), errors: count('ERROR'), checkpoints: items.filter((i) => i.status === 'READY').reduce((n, i) => n + i.checkpoints.length, 0) },
    items,
  };
}

/**
 * Imports every READY item, each in its own transaction so one bad item cannot undo the rest.
 * Returns the analysis with per-item results.
 */
export async function commit(ctx, user, buffer, fileName) {
  const analysis = await analyse(buffer);
  for (const item of analysis.items.filter((i) => i.status === 'READY')) {
    try {
      await withTransaction(ctx, async (db) => {
        let { rows } = await db.query('SELECT id FROM mst.item WHERE item_code = $1', [item.itemCode]);
        if (!rows[0]) {
          ({ rows } = await db.query(
            'INSERT INTO mst.item (item_code, description, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING id',
            [item.itemCode, item.description, user.id],
          ));
        }
        const format = await repo.ensureFormat(db, rows[0].id, user.id);
        if (format.currentVersionId) throw AppError.conflict('A format was approved for this item while the import was running.');
        const id = await repo.insertVersion(db, {
          formatId: format.id, status: 'APPROVED', source: 'PRE_FED', versionNo: 1, header: item.header, userId: user.id,
          sourceRef: { file: fileName, sheet: analysis.sheet, rows: [item.firstRow, item.lastRow] },
        });
        await repo.replaceCheckpoints(db, id, item.checkpoints);
        await repo.updateVersion(db, id, null, { decidedAt: new Date(), decidedBy: user.id, decisionRemark: `Imported from ${fileName}` });
        await repo.setCurrent(db, format.id, id);
      });
      item.status = 'IMPORTED';
    } catch (err) {
      item.status = 'ERROR';
      item.messages.push({ level: 'error', message: err.isOperational ? err.message : 'Could not be saved; see the server log.' });
      if (!err.isOperational) ctx.log?.error({ err, itemCode: item.itemCode }, 'format import failed');
    }
  }
  const imported = analysis.items.filter((i) => i.status === 'IMPORTED').length;
  analysis.summary = { ...analysis.summary, imported, errors: analysis.items.filter((i) => i.status === 'ERROR').length };
  return analysis;
}

/** The import template: header row, the review-workbook example and an instructions sheet. */
export async function template() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'QMAS';
  const ws = wb.addWorksheet('Formats', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: Math.max(12, c.header.length + 4) }));
  ws.getColumn('specification').width = 48;
  ws.getColumn('checkpoint').width = 24;
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
  const example = [
    ['123456', 'Compressor mounting bracket', 'Dimensional', 'Dimensions', '57 ± 0.3', null, null, null, 'mm', 'DVC', null, 'F-123456', 'CF-001'],
    ['123456', null, 'Dimensional', 'Dimensions', '22.2', 22.2, 22, 22.4, 'mm', 'DVC'],
    ['123456', null, 'Dimensional', 'Angle', '90', 90, 89.5, 90.5, '°', 'Bevel Protractor'],
    ['123456', null, 'Visual', 'Aesthetic', 'Free from dust, rust, oil, crack, sharp edges & burr', null, null, null, null, 'Visual'],
    ['123456', null, 'Reliability', 'Static Load Test', '200 kg load applied in vertical position', null, null, null, 'kg', 'Static Load Jig', 'Once in six months'],
  ];
  example.forEach((r) => ws.addRow(r));

  const help = wb.addWorksheet('Instructions');
  help.columns = [{ header: 'Column', width: 22 }, { header: 'Required', width: 10 }, { header: 'What to enter', width: 90 }];
  help.getRow(1).font = { bold: true };
  const notes = {
    itemCode: 'Item code. One row per checkpoint; rows with the same item code form one format.',
    itemDescription: 'Needed only when the item is not yet in the item master (it is then created).',
    section: 'Dimensional, Visual or Reliability.',
    checkpoint: 'Name of the check, e.g. Dimensions, Angle, Aesthetic. The same name may repeat.',
    specification: 'Requirement text. For dimensional rows without LSL/USL, limits are read from text like "57 ± 0.3", "337 +1/-2", "<2", ">0.05".',
    nominal: 'Dimensional only. Up to 3 decimals.',
    lsl: 'Dimensional only. Lower limit, inclusive. Up to 3 decimals.',
    usl: 'Dimensional only. Upper limit, inclusive. Up to 3 decimals.',
    uom: 'Unit, e.g. mm, °, kg.',
    instrument: 'Instrument or method, e.g. DVC, Bevel Protractor, Visual.',
    frequency: 'Reliability only. Months (6) or text ("Once in six months", "Yearly"). Empty = every lot.',
    formatNo: 'Optional; taken from the first row of the item.',
    commonFormatNo: 'Optional; common across all plants.',
  };
  COLUMNS.forEach((c) => help.addRow([c.header, c.required ? 'Yes' : '', notes[c.key]]));
  help.addRow([]);
  help.addRow(['Items that already have an approved format are skipped. Run "Check file" first; nothing is saved until you import.']);
  return wb.xlsx.writeBuffer();
}
