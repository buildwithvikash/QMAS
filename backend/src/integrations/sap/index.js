import { randomUUID } from 'node:crypto';
import { getPool } from '../../db/pool.js';

/**
 * SAP QA32 adapter (Decision I-1: mock until SAP provides the API specification).
 * Contract: fetchLots({ cursor }) → { lots: [lot], cursor } where
 *   lot = { sapLotNo, plantSapCode, grnNo, grnDate, invoiceNo, vendorCode, vendorName,
 *           itemCode, itemDescription, itemCategory, uom, inwardQty, position }
 *   position = the cursor value that points just after this lot (used to retry failed lots).
 * The real client only has to implement the same call; nothing else changes.
 */
const mockSap = {
  name: 'mock',
  async fetchLots({ cursor }) {
    const { rows } = await getPool().query(
      'SELECT seq, sap_lot_no, payload FROM intg.sap_mock_lot WHERE seq > $1 ORDER BY seq LIMIT 500',
      [Number(cursor ?? 0)],
    );
    return {
      lots: rows.map((r) => ({ ...r.payload, sapLotNo: r.sap_lot_no, position: String(r.seq) })),
      cursor: rows.length ? String(rows.at(-1).seq) : (cursor ?? '0'),
    };
  },
};

const CLIENTS = { mock: mockSap };

export const sapMode = () => process.env.SAP_MODE ?? 'mock';

export function sapClient() {
  const c = CLIENTS[sapMode()];
  if (!c) throw new Error(`SAP_MODE "${sapMode()}" is not available yet; only "mock" is implemented`);
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
