import { randomUUID } from 'node:crypto';
import { getPool } from '../../db/pool.js';
import { fromSapRecord, isSapRecord } from './qa32.js';

/**
 * SAP QA32 adapter. Contract: fetchLots({ cursor }) → { lots: [lot], cursor } where
 *   lot = { sapLotNo, plantSapCode, grnNo, grnDate, inspectionStart, invoiceNo, vendorCode, vendorName,
 *           itemCode, itemDescription, itemCategory, uom, inwardQty, position, raw?, error? }
 *   position = the cursor value that points just after this lot (used to retry failed lots);
 *   raw      = the record as SAP sent it (kept with the lot); error = why it could not be mapped.
 * SAP records ("SAP Data v1" fields) are mapped in qa32.js. SAP_MODE picks the source:
 *   mock — a queue in the database (demo data loaded with `npm run sap:demo`, or lots simulated
 *          on the SAP Sync page);
 *   api  — the SAP API at SAP_API_URL (JSON list of records in the same fields).
 */

// Lots taken from the demo queue per pull (small, so a demo shows lots arriving a few at a time).
const batchSize = () => Number(process.env.SAP_BATCH_SIZE || 5);

/** A queued or fetched record as a QMAS lot: SAP-shaped records are mapped, simulated lots pass. */
function toLot(payload, extra) {
  if (!isSapRecord(payload)) return { ...payload, ...extra };
  const { lot, error } = fromSapRecord(payload);
  return { ...lot, raw: payload, ...(error && { error }), ...extra };
}

const mockSap = {
  name: 'mock',
  async fetchLots({ cursor }) {
    const { rows } = await getPool().query(
      'SELECT seq, sap_lot_no, payload FROM intg.sap_mock_lot WHERE seq > $1 ORDER BY seq LIMIT $2',
      [Number(cursor ?? 0), batchSize()],
    );
    return {
      lots: rows.map((r) => {
        const lot = toLot(r.payload, { position: String(r.seq) });
        lot.sapLotNo ??= r.sap_lot_no;
        return lot;
      }),
      cursor: rows.length ? String(rows.at(-1).seq) : (cursor ?? '0'),
    };
  },
};

/**
 * The SAP API: GET SAP_API_URL?<SAP_API_FROM_PARAM>=<last Start of Inspection date>, answering a
 * JSON list of records (a plain array, OData { d: { results } } / { value }, or { data }).
 * Lots already pulled are recognised by their Inspection Lot number and skipped, so asking again
 * from the last date is safe. Basic authentication with SAP_API_USER / SAP_API_PASSWORD if set.
 */
const apiSap = {
  name: 'api',
  async fetchLots({ cursor }) {
    const base = process.env.SAP_API_URL;
    if (!base) throw new Error('SAP_MODE=api needs SAP_API_URL in backend/.env');
    const url = new URL(base);
    // Ask again a few days back: a lot can reach SAP after later ones with an earlier Start of
    // Inspection date (e.g. a back-dated goods receipt). Lots already pulled are skipped by lot number.
    if (cursor) url.searchParams.set(process.env.SAP_API_FROM_PARAM || 'from', overlapFrom(cursor));
    const headers = { Accept: 'application/json' };
    if (process.env.SAP_API_USER) headers.Authorization = `Basic ${Buffer.from(`${process.env.SAP_API_USER}:${process.env.SAP_API_PASSWORD ?? ''}`).toString('base64')}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`SAP API answered ${res.status} ${res.statusText}`);
    const body = await res.json();
    const records = Array.isArray(body) ? body : body?.d?.results ?? body?.value ?? body?.data ?? [];
    const lots = records.map((r) => toLot(r)).sort((a, b) => String(a.inspectionStart).localeCompare(String(b.inspectionStart)) || String(a.sapLotNo).localeCompare(String(b.sapLotNo)));
    for (const l of lots) l.position = l.inspectionStart ?? cursor;
    const dates = lots.map((l) => l.inspectionStart).filter(Boolean).sort();
    return { lots, cursor: dates.at(-1) ?? cursor ?? null };
  },
};

const CLIENTS = { mock: mockSap, api: apiSap };

/** The date SAP_API_OVERLAP_DAYS (default 3) before the cursor date; other cursors pass unchanged. */
export function overlapFrom(cursor, days = Number(process.env.SAP_API_OVERLAP_DAYS ?? 3)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cursor) || !(days > 0)) return cursor;
  return new Date(Date.parse(`${cursor}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

export const sapMode = () => process.env.SAP_MODE ?? 'mock';

export function sapClient() {
  const c = CLIENTS[sapMode()];
  if (!c) throw new Error(`SAP_MODE "${sapMode()}" is not known; use "mock" or "api"`);
  return c;
}

/** Mock only: queue a lot as if SAP had posted it in QA32. Returns the SAP lot number. */
export async function addMockLot(lot, userId) {
  if (sapMode() !== 'mock') throw new Error('Simulated lots are only available with SAP_MODE=mock');
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('INSERT INTO intg.sap_mock_lot (sap_lot_no, payload, created_by) VALUES ($1, $2, $3) RETURNING seq', [randomUUID(), lot, userId]);
    // SAP inspection lot numbers are 12 digits starting with 89 (goods receipt origin).
    const sapLotNo = `89${String(rows[0].seq).padStart(10, '0')}`;
    await client.query('UPDATE intg.sap_mock_lot SET sap_lot_no = $2 WHERE seq = $1', [rows[0].seq, sapLotNo]);
    await client.query('COMMIT');
    return sapLotNo;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
