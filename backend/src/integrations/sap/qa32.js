/**
 * The SAP QA32 inspection-lot record, as the SAP API sends it ("SAP Data v1"), and its mapping to
 * the QMAS lot. Every SAP source (the demo queue, the real API) goes through `fromSapRecord`, so a
 * change in the SAP field names is made here only.
 *
 *   SAP field              QMAS                                   Notes
 *   Inspection Lot         sapLotNo                               unique; a lot is pulled once
 *   Item Code              itemCode   → item master               numbers are kept as text
 *   Item Description       itemDescription
 *   Plant                  plantSapCode → plant master (sap_code) must exist in Master Config → Plants
 *   Lot Qty                inwardQty                              decides the sample size
 *   Base Unit of Measure   uom        → UOM master
 *   Start of Inspection    grnDate (and inspectionStart)          SAP sends no separate GRN date
 *   Vendor Code            vendorCode → vendor master
 *   GRN                    grnNo
 *   Vendor Description     vendorName
 *   Material Group         itemCategory → item category master
 *   Invoice No             invoiceNo                              optional: not in "SAP Data v1"; used when SAP sends it
 */

export const SAP_FIELDS = Object.freeze({
  sapLotNo: 'Inspection Lot',
  itemCode: 'Item Code',
  itemDescription: 'Item Description',
  plantSapCode: 'Plant',
  inwardQty: 'Lot Qty',
  uom: 'Base Unit of Measure',
  inspectionStart: 'Start of Inspection',
  vendorCode: 'Vendor Code',
  grnNo: 'GRN',
  vendorName: 'Vendor Description',
  itemCategory: 'Material Group',
});

/**
 * Optional fields, with the header spellings accepted (the exact SAP name is to be confirmed with
 * the SAP team; any of these works). A record without one is still read.
 */
export const SAP_OPTIONAL_FIELDS = Object.freeze({
  invoiceNo: ['Invoice No', 'Invoice No.', 'Invoice Number', 'Invoice', 'Vendor Invoice No'],
});

const REQUIRED = ['sapLotNo', 'itemCode', 'plantSapCode', 'inwardQty', 'inspectionStart', 'vendorCode', 'grnNo'];

/** Is this a record in the SAP API shape (rather than an already-mapped QMAS lot)? */
export const isSapRecord = (rec) => !!rec && typeof rec === 'object' && SAP_FIELDS.sapLotNo in rec;

const text = (v) => {
  if (v === null || v === undefined) return null;
  const s = (typeof v === 'number' ? String(v) : String(v)).trim();
  return s === '' ? null : s;
};

/** Quantity from a number or text ("1,25,000", "1,000.500", or "12,5" with a decimal comma). */
function quantity(v) {
  if (typeof v === 'number') return v;
  const s = text(v);
  if (!s) return null;
  // One comma not followed by exactly three digits is a decimal comma; other commas group digits.
  const decimalComma = !s.includes('.') && (s.match(/,/g) ?? []).length === 1 && !/,\d{3}$/.test(s);
  const n = Number(decimalComma ? s.replace(',', '.') : s.replaceAll(',', ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * A date as YYYY-MM-DD from what SAP may send: a Date, ISO text, 2026-09-08, 08.09.2026,
 * 20260908, OData /Date(1757289600000)/ or an Excel serial number.
 */
export function sapDate(v) {
  if (v === null || v === undefined || v === '') return null;
  const iso = (d) => (Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10));
  if (v instanceof Date) return iso(v);
  if (typeof v === 'number') return v > 20000 && v < 80000 ? iso(new Date(Math.round((v - 25569) * 86_400_000))) : null;
  const s = String(v).trim();
  let m = s.match(/^\/Date\((-?\d+)\)\/$/);
  if (m) return iso(new Date(Number(m[1])));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/**
 * Maps one SAP record to the QMAS lot the sync expects. Returns { lot } or { error } (a missing
 * or unreadable field), so one bad record is reported without stopping the others.
 */
export function fromSapRecord(rec) {
  const get = (key) => rec[SAP_FIELDS[key]];
  const optional = (key) => SAP_OPTIONAL_FIELDS[key].map((name) => rec[name]).find((v) => v !== null && v !== undefined && v !== '');
  const lot = {
    sapLotNo: text(get('sapLotNo')),
    plantSapCode: text(get('plantSapCode')),
    grnNo: text(get('grnNo')),
    inspectionStart: sapDate(get('inspectionStart')),
    invoiceNo: text(optional('invoiceNo')),
    vendorCode: text(get('vendorCode'))?.toUpperCase() ?? null,
    vendorName: text(get('vendorName')),
    itemCode: text(get('itemCode'))?.toUpperCase() ?? null,
    itemDescription: text(get('itemDescription')),
    itemCategory: text(get('itemCategory')),
    uom: text(get('uom'))?.toUpperCase() ?? null,
    inwardQty: quantity(get('inwardQty')),
  };
  lot.grnDate = lot.inspectionStart;
  const missing = REQUIRED.filter((k) => lot[k] === null || lot[k] === undefined);
  if (missing.length) return { lot, error: `SAP record ${lot.sapLotNo ?? '(no lot number)'}: ${missing.map((k) => SAP_FIELDS[k]).join(', ')} missing or unreadable.` };
  if (!(lot.inwardQty > 0)) return { lot, error: `SAP record ${lot.sapLotNo}: Lot Qty must be more than zero.` };
  return { lot };
}
