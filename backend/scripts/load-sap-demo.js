// Demo data for the SAP pull: puts the records of an SAP export ("SAP Data v1" fields) into the
// demo SAP queue, exactly as the SAP API will send them. SAP Sync → Pull now (or the worker)
// then pulls them like real lots: masters are kept in step and one IMIR is created per lot.
//   npm run sap:demo -- "C:\path\SAP Data v1.xlsx"                 all records
//   npm run sap:demo -- file.xlsx --from 2026-09-25 --to 2026-10-01 by Start of Inspection
//   npm run sap:demo -- file.xlsx --limit 200                      the first 200 (oldest first)
//   npm run sap:demo -- file.xlsx --plant 1125                     one plant only
//   npm run sap:demo -- file.xlsx --spread-plants                  each lot to a random active plant
//   npm run sap:demo -- --reset                                    remove the demo data again: the queue,
//                                                                  and pulled demo lots nobody has worked on
//   npm run sap:demo -- --fill-invoices                            give demo lots already queued or pulled a
//                                                                  demo invoice number where they have none
// "SAP Data v1" has no invoice number: each demo record gets a demo one (from its GRN) unless the
// file has an "Invoice No" column.
// Needs SAP_MODE=mock (the default). Records already queued or pulled are skipped.
import ExcelJS from 'exceljs';
import pg from 'pg';
import { fromSapRecord, SAP_FIELDS, SAP_OPTIONAL_FIELDS } from '../src/integrations/sap/qa32.js';

/** A demo vendor invoice number for a record without one, the same on every run (from the GRN). */
const demoInvoice = (grnNo, inspectionStart) => `INV/${String(inspectionStart ?? '').slice(0, 4) || 'DEMO'}/${String(grnNo).slice(-6)}`;
const hasInvoice = (rec) => SAP_OPTIONAL_FIELDS.invoiceNo.some((name) => rec[name] !== null && rec[name] !== undefined && rec[name] !== '');

// Arguments: the file, and --name value options.
const args = process.argv.slice(2);
const options = {};
let file;
const FLAGS = new Set(['reset', 'spread-plants', 'fill-invoices']);
for (let i = 0; i < args.length; i += 1) {
  if (FLAGS.has(args[i].slice(2))) options[args[i].slice(2)] = true;
  else if (args[i].startsWith('--')) options[args[i].slice(2)] = args[(i += 1)];
  else file ??= args[i];
}
const opt = (name) => options[name];
if (opt('reset')) {
  await reset();
  if (!file) process.exit(0);
}
if (opt('fill-invoices')) {
  await fillInvoices();
  if (!file) process.exit(0);
}
if (!file) {
  console.error('Give the Excel file: npm run sap:demo -- "C:\path\SAP Data v1.xlsx" [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit N] [--plant 1125]');
  process.exit(1);
}
if ((process.env.SAP_MODE ?? 'mock') !== 'mock') {
  console.error('SAP_MODE is not "mock": demo data goes to the mock queue only.');
  process.exit(1);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const ws = wb.worksheets[0];
const header = ws.getRow(1).values.slice(1).map((v) => String(v ?? '').trim());
const missing = Object.values(SAP_FIELDS).filter((f) => !header.includes(f));
if (missing.length) {
  console.error(`The first sheet is missing these SAP columns: ${missing.join(', ')}`);
  process.exit(1);
}

const records = [];
const problems = [];
ws.eachRow((row, i) => {
  if (i === 1) return;
  const rec = {};
  header.forEach((h, c) => {
    let v = row.getCell(c + 1).value;
    if (v && typeof v === 'object' && 'result' in v) v = v.result; // formula cells
    if (v instanceof Date) v = v.toISOString().slice(0, 10);
    if (h) rec[h] = v;
  });
  if (Object.values(rec).every((v) => v === null || v === undefined || v === '')) return;
  if (!hasInvoice(rec) && rec[SAP_FIELDS.grnNo]) rec['Invoice No'] = demoInvoice(rec[SAP_FIELDS.grnNo], rec[SAP_FIELDS.inspectionStart]);
  const { lot, error } = fromSapRecord(rec);
  if (error) problems.push(`row ${i}: ${error}`);
  else records.push({ rec, lot });
});

let chosen = records
  .filter(({ lot }) => (!opt('from') || lot.inspectionStart >= opt('from')) && (!opt('to') || lot.inspectionStart <= opt('to')))
  .filter(({ lot }) => !opt('plant') || lot.plantSapCode === opt('plant'))
  .sort((a, b) => a.lot.inspectionStart.localeCompare(b.lot.inspectionStart) || a.lot.sapLotNo.localeCompare(b.lot.sapLotNo));
if (opt('limit')) chosen = chosen.slice(0, Number(opt('limit')));

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const { rows: plants } = await pool.query('SELECT sap_code, is_active FROM core.plant ORDER BY sap_code');
if (opt('spread-plants')) {
  // A random active plant per lot (the same one on every run: chosen from the lot number).
  const active = plants.filter((p) => p.is_active).map((p) => p.sap_code);
  for (const r of chosen) {
    const n = [...r.lot.sapLotNo].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const code = active[n % active.length];
    r.rec = { ...r.rec, Plant: code };
    r.lot.plantSapCode = code;
  }
}
const known = new Set(plants.map((p) => p.sap_code));
const unknownPlants = [...new Set(chosen.map(({ lot }) => lot.plantSapCode).filter((p) => !known.has(p)))];

let queued = 0;
for (const { rec, lot } of chosen) {
  const { rowCount } = await pool.query(
    `INSERT INTO intg.sap_mock_lot (sap_lot_no, payload)
     SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM intg.sap_inspection_lot WHERE sap_lot_no = $1)
     ON CONFLICT (sap_lot_no) DO NOTHING`,
    [lot.sapLotNo, rec],
  );
  queued += rowCount;
}
const { rows: waiting } = await pool.query(
  `SELECT count(*)::int AS n FROM intg.sap_mock_lot q
    WHERE q.seq > coalesce((SELECT cursor_value::bigint FROM intg.sap_sync_run WHERE source = 'mock' AND status IN ('OK', 'PARTIAL') ORDER BY id DESC LIMIT 1), 0)`,
);
await pool.end();

console.log(`Read ${records.length + problems.length} records; ${chosen.length} chosen; ${queued} added to the SAP demo queue (${chosen.length - queued} were already there or pulled).`);
console.log(`Waiting to be pulled: ${waiting[0].n}. Pull them with SAP Sync → Pull now (${process.env.SAP_BATCH_SIZE || 5} per pull) or let the worker do it.`);
if (unknownPlants.length) console.log(`Note: plant(s) ${unknownPlants.join(', ')} are not in Master Config → Plants; their lots will fail until the plant is added.`);
if (problems.length) console.log(`Skipped ${problems.length} unreadable record(s):\n  ${problems.slice(0, 10).join('\n  ')}${problems.length > 10 ? '\n  …' : ''}`);

/**
 * Gives demo lots that have no invoice number a demo one: records still in the queue, pulled SAP
 * lots and their IMIRs. Only empty invoice numbers are filled; nothing else changes.
 */
async function fillInvoices() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const db = await pool.connect();
  const inv = `'INV/' || coalesce(left(p->>'Start of Inspection', 4), 'DEMO') || '/' || right(p->>'GRN', 6)`;
  try {
    await db.query('BEGIN');
    const { rowCount: queued } = await db.query(
      `UPDATE intg.sap_mock_lot q SET payload = p || jsonb_build_object('Invoice No', ${inv})
         FROM (SELECT seq, payload AS p FROM intg.sap_mock_lot) x
        WHERE q.seq = x.seq AND p ? 'Inspection Lot' AND coalesce(p->>'Invoice No', '') = ''`,
    );
    const { rows: lots } = await db.query(
      `UPDATE intg.sap_inspection_lot l SET payload = p || jsonb_build_object('Invoice No', ${inv}), invoice_no = ${inv}
         FROM (SELECT id, payload AS p FROM intg.sap_inspection_lot) x
        WHERE l.id = x.id AND p ? 'Inspection Lot' AND l.invoice_no IS NULL
        RETURNING l.id, l.invoice_no`,
    );
    const { rowCount: imirs } = await db.query(
      `UPDATE qms.imir m SET invoice_no = l.invoice_no FROM intg.sap_inspection_lot l
        WHERE l.id = m.sap_lot_id AND m.invoice_no IS NULL AND l.id = ANY($1)`,
      [lots.map((r) => r.id)],
    );
    await db.query('COMMIT');
    console.log(`Invoice numbers filled: ${queued} queued record(s), ${lots.length} pulled lot(s), ${imirs} IMIR(s).`);
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    db.release();
    await pool.end();
  }
}

/**
 * Removes demo data: queued SAP records not yet pulled, and pulled demo lots (records in the SAP
 * shape) whose IMIR nobody has worked on (no workflow step, reading, photo, deviation or DN).
 * Lots someone has started stay. Vendors, items and material groups created by the pull stay.
 */
async function reset() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows: lots } = await db.query(
      `SELECT l.id AS lot_id, m.id AS imir_id FROM intg.sap_inspection_lot l LEFT JOIN qms.imir m ON m.sap_lot_id = l.id
        WHERE l.payload ? 'Inspection Lot'
          AND (m.id IS NULL OR (m.status IN ('AWAITING_FORMAT', 'OPEN')
          AND NOT EXISTS (SELECT 1 FROM qms.imir_action a WHERE a.imir_id = m.id)
          AND NOT EXISTS (SELECT 1 FROM qms.imir_observation o WHERE o.imir_id = m.id)
          AND NOT EXISTS (SELECT 1 FROM qms.imir_checkout c WHERE c.imir_id = m.id)
          AND NOT EXISTS (SELECT 1 FROM qms.deviation d WHERE d.imir_id = m.id)
          AND NOT EXISTS (SELECT 1 FROM qms.defect_notification n WHERE n.imir_id = m.id)
          AND NOT EXISTS (SELECT 1 FROM qms.attachment f WHERE f.entity_id = m.id)))`,
    );
    const imirs = lots.map((r) => r.imir_id).filter(Boolean);
    const sapLots = lots.map((r) => r.lot_id);
    await db.query('DELETE FROM qms.imir_checkpoint WHERE imir_id = ANY($1)', [imirs]);
    await db.query('DELETE FROM qms.reliability_test_log WHERE imir_id = ANY($1)', [imirs]);
    await db.query('DELETE FROM qms.imir WHERE id = ANY($1)', [imirs]);
    await db.query('DELETE FROM intg.sap_inspection_lot WHERE id = ANY($1)', [sapLots]);
    const { rows: kept } = await db.query("SELECT count(*)::int AS n FROM intg.sap_inspection_lot WHERE payload ? 'Inspection Lot'");
    const { rowCount: queued } = await db.query("DELETE FROM intg.sap_mock_lot WHERE payload ? 'Inspection Lot'");
    await db.query('COMMIT');
    console.log(`Reset: removed ${sapLots.length} pulled demo lot(s) (${imirs.length} IMIRs) and ${queued} queued record(s).${kept[0].n ? ` ${kept[0].n} demo lot(s) someone has worked on were kept.` : ''}`);
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    db.release();
    await pool.end();
  }
}
