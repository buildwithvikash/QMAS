import { describe, expect, it } from 'vitest';
import { getPool } from '../src/db/pool.js';
import { fromSapRecord, sapDate } from '../src/integrations/sap/qa32.js';
import { getAdmin } from './lots.js';
import { uid } from './helpers.js';

/** A record as the SAP API sends it ("SAP Data v1"). */
const record = (over = {}) => ({
  'Inspection Lot': uid('1000'),
  'Item Code': 1110044,
  'Item Description': 'PNTD SHELF HOLD RACK SRCL331_L1117 WHITE',
  Plant: '1125',
  'Lot Qty': 5000,
  'Base Unit of Measure': 'NOS',
  'Start of Inspection': '2026-09-08',
  'Vendor Code': '105452',
  GRN: '5000471899',
  'Vendor Description': 'TRINETRA INDUSTRIES',
  'Material Group': 'PCCOMP',
  ...over,
});

describe('SAP QA32 record mapping', () => {
  it('maps the SAP fields to the QMAS lot', () => {
    const { lot, error } = fromSapRecord(record({ 'Inspection Lot': '10000468939' }));
    expect(error).toBeUndefined();
    expect(lot).toMatchObject({
      sapLotNo: '10000468939', itemCode: '1110044', itemDescription: 'PNTD SHELF HOLD RACK SRCL331_L1117 WHITE', plantSapCode: '1125',
      inwardQty: 5000, uom: 'NOS', inspectionStart: '2026-09-08', grnDate: '2026-09-08', vendorCode: '105452', grnNo: '5000471899',
      vendorName: 'TRINETRA INDUSTRIES', itemCategory: 'PCCOMP', invoiceNo: null,
    });
  });

  it('reads the invoice number when SAP sends one (any usual header spelling), and leaves it empty otherwise', () => {
    expect(fromSapRecord(record({ 'Invoice No': ' TI/2026-27/0451 ' })).lot.invoiceNo).toBe('TI/2026-27/0451');
    expect(fromSapRecord(record({ 'Invoice Number': 4512 })).lot.invoiceNo).toBe('4512');
    expect(fromSapRecord(record({ 'Invoice No.': '' })).lot.invoiceNo).toBeNull();
    expect(fromSapRecord(record()).error).toBeUndefined(); // still optional
  });

  it('reads the date and quantity formats SAP may use', () => {
    expect(sapDate('08.09.2026')).toBe('2026-09-08');
    expect(sapDate('20260908')).toBe('2026-09-08');
    expect(sapDate('/Date(1788825600000)/')).toBe('2026-09-08');
    expect(sapDate(new Date('2026-09-08T00:00:00Z'))).toBe('2026-09-08');
    expect(sapDate(46273)).toBe('2026-09-08'); // Excel serial
    expect(sapDate('soon')).toBeNull();
    expect(fromSapRecord(record({ 'Lot Qty': '1,25,000' })).lot.inwardQty).toBe(125000);
    expect(fromSapRecord(record({ 'Lot Qty': '12,5' })).lot.inwardQty).toBe(12.5);
  });

  it('reports a record it cannot use', () => {
    expect(fromSapRecord(record({ GRN: '', 'Start of Inspection': 'x' })).error).toMatch(/Start of Inspection, GRN missing or unreadable/);
    expect(fromSapRecord(record({ 'Lot Qty': 0 })).error).toMatch(/Lot Qty must be more than zero/);
  });
});

describe('pulling SAP records', () => {
  it('creates the lot, masters and IMIR from an SAP record, and reports a bad one', async () => {
    const good = record({ 'Item Code': Number(`9${Date.now() % 1e6}`), 'Vendor Code': uid('V'), 'Material Group': 'IMPELLER', 'Lot Qty': 2000 });
    const bad = record({ 'Lot Qty': 0 });
    await getPool().query('INSERT INTO intg.sap_mock_lot (sap_lot_no, payload) VALUES ($1, $2), ($3, $4)', [good['Inspection Lot'], good, bad['Inspection Lot'], bad]);
    const sync = (await (await getAdmin()).post('/api/v1/integration/sap/sync')).body.data;
    expect(sync.errors.some((e) => e.sapLotNo === bad['Inspection Lot'] && /Lot Qty/.test(e.message))).toBe(true);

    const { rows } = await getPool().query(
      `SELECT l.inspection_start::text AS inspection_start, l.grn_no, l.payload, m.grn_date, m.inward_qty, m.uom, m.status, i.item_code, i.description, c.name AS category, v.name AS vendor
         FROM intg.sap_inspection_lot l JOIN qms.imir m ON m.sap_lot_id = l.id JOIN mst.item i ON i.id = m.item_id
         LEFT JOIN mst.item_category c ON c.id = i.category_id JOIN mst.vendor v ON v.id = m.vendor_id
        WHERE l.sap_lot_no = $1`,
      [good['Inspection Lot']],
    );
    expect(rows[0]).toMatchObject({ grn_no: '5000471899', uom: 'NOS', status: 'AWAITING_FORMAT', item_code: String(good['Item Code']), category: 'IMPELLER', vendor: 'TRINETRA INDUSTRIES' });
    expect(rows[0].inspection_start).toBe('2026-09-08');
    expect(Number(rows[0].inward_qty)).toBe(2000);
    expect(rows[0].payload['Material Group']).toBe('IMPELLER'); // the record as SAP sent it is kept
  });
});
