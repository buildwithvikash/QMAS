import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { sapClient } from '../../integrations/sap/index.js';
import { AppError } from '../../shared/AppError.js';
import { camelRows } from '../../shared/sql.js';
import { tryOpen } from '../imir/imir.service.js';

const SYNC_LOCK = 7_261_900_401; // one SAP pull at a time across API instances and the worker

const slug = (s, max = 20) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, max) || 'MISC';

/** Returns the id of an existing row, or inserts one (race-safe: a concurrent insert is re-read). */
async function findOrCreate(db, findSql, findArgs, insertSql, insertArgs, rereadSql, rereadArgs) {
  const found = await db.query(findSql, findArgs);
  if (found.rows[0]) return found.rows[0].id;
  const inserted = await db.query(insertSql, insertArgs);
  return inserted.rows[0]?.id ?? (await db.query(rereadSql, rereadArgs)).rows[0].id;
}

/** Upserts vendor, category, UOM and item from SAP data; SAP is the source of truth for these fields. */
async function upsertMasters(db, lot) {
  const { rows: plant } = await db.query('SELECT id, is_active FROM core.plant WHERE sap_code = $1', [lot.plantSapCode]);
  if (!plant[0]) throw AppError.unprocessable(`Plant ${lot.plantSapCode} is not in the plant master.`);

  const vendor = await db.query(
    `INSERT INTO mst.vendor (vendor_code, name, source) VALUES ($1, $2, 'SAP')
     ON CONFLICT (vendor_code) DO UPDATE SET name = EXCLUDED.name WHERE mst.vendor.name IS DISTINCT FROM EXCLUDED.name
     RETURNING id`,
    [lot.vendorCode.toUpperCase(), lot.vendorName ?? lot.vendorCode],
  );
  const vendorId = vendor.rows[0]?.id ?? (await db.query('SELECT id FROM mst.vendor WHERE vendor_code = $1', [lot.vendorCode.toUpperCase()])).rows[0].id;

  let categoryId = null;
  if (lot.itemCategory) {
    categoryId = await findOrCreate(db, 'SELECT id FROM mst.item_category WHERE lower(name) = lower($1)', [lot.itemCategory],
      'INSERT INTO mst.item_category (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING RETURNING id', [slug(lot.itemCategory), lot.itemCategory],
      'SELECT id FROM mst.item_category WHERE code = $1', [slug(lot.itemCategory)]);
  }
  let uomId = null;
  if (lot.uom) {
    const code = lot.uom.toUpperCase().slice(0, 20);
    uomId = await findOrCreate(db, 'SELECT id FROM mst.uom WHERE code = $1', [code],
      'INSERT INTO mst.uom (code, name) VALUES ($1, $1) ON CONFLICT (code) DO NOTHING RETURNING id', [code],
      'SELECT id FROM mst.uom WHERE code = $1', [code]);
  }
  const item = await db.query(
    `INSERT INTO mst.item (item_code, description, category_id, uom_id, source) VALUES ($1, $2, $3, $4, 'SAP')
     ON CONFLICT (item_code) DO UPDATE SET description = EXCLUDED.description,
       category_id = COALESCE(EXCLUDED.category_id, mst.item.category_id), uom_id = COALESCE(EXCLUDED.uom_id, mst.item.uom_id)
     WHERE (mst.item.description, mst.item.category_id, mst.item.uom_id) IS DISTINCT FROM
           (EXCLUDED.description, COALESCE(EXCLUDED.category_id, mst.item.category_id), COALESCE(EXCLUDED.uom_id, mst.item.uom_id))
     RETURNING id`,
    [lot.itemCode.toUpperCase(), lot.itemDescription ?? lot.itemCode, categoryId, uomId],
  );
  const itemId = item.rows[0]?.id ?? (await db.query('SELECT id FROM mst.item WHERE item_code = $1', [lot.itemCode.toUpperCase()])).rows[0].id;
  return { plantId: plant[0].id, vendorId, itemId };
}

/**
 * Pulls new QA32 inspection lots, records them, keeps masters in step and creates one IMIR per lot.
 * Each lot is its own transaction, so one bad lot is reported without blocking the others.
 * Returns the run summary; if another pull is already running, returns { skipped: true }.
 */
export async function runSapSync({ userId = null, log } = {}) {
  const pool = getPool();
  const lockClient = await pool.connect();
  try {
    const { rows: got } = await lockClient.query('SELECT pg_try_advisory_lock($1) AS ok', [SYNC_LOCK]);
    if (!got[0].ok) return { skipped: true, reason: 'Another SAP pull is running.' };

    const client = sapClient();
    const { rows: last } = await pool.query("SELECT cursor_value FROM intg.sap_sync_run WHERE status IN ('OK', 'PARTIAL') AND source = $1 ORDER BY id DESC LIMIT 1", [client.name]);
    const { rows: run } = await pool.query("INSERT INTO intg.sap_sync_run (status, source, triggered_by) VALUES ('RUNNING', $1, $2) RETURNING id", [client.name, userId]);
    const runId = run[0].id;
    const summary = { runId, fetched: 0, createdLots: 0, openedImirs: 0, errors: [] };

    let cursor = last[0]?.cursor_value ?? null;
    try {
      const batch = await client.fetchLots({ cursor });
      summary.fetched = batch.lots.length;
      // A failed lot is retried next time (e.g. after its plant is added): the cursor stays before it.
      let retryFrom = null;
      let failed = false;
      let previousPosition = cursor;
      for (const lot of batch.lots) {
        const before = previousPosition;
        previousPosition = lot.position ?? previousPosition;
        try {
          const outcome = await withTransaction({ userId }, async (db) => {
            const { rows: existing } = await db.query('SELECT id FROM intg.sap_inspection_lot WHERE sap_lot_no = $1', [lot.sapLotNo]);
            if (existing[0]) {
              await db.query('UPDATE intg.sap_inspection_lot SET last_seen_at = now() WHERE id = $1', [existing[0].id]);
              return 'SEEN';
            }
            const { plantId, vendorId, itemId } = await upsertMasters(db, lot);
            const { rows: l } = await db.query(
              `INSERT INTO intg.sap_inspection_lot (sap_lot_no, plant_sap_code, grn_no, grn_date, invoice_no, vendor_code, vendor_name, item_code,
                 item_description, item_category, uom, inward_qty, payload, sync_run_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
              [lot.sapLotNo, lot.plantSapCode, lot.grnNo, lot.grnDate, lot.invoiceNo ?? null, lot.vendorCode, lot.vendorName ?? null, lot.itemCode,
                lot.itemDescription ?? null, lot.itemCategory ?? null, lot.uom ?? null, lot.inwardQty, lot, runId],
            );
            const { rows: m } = await db.query(
              `INSERT INTO qms.imir (sap_lot_id, plant_id, item_id, vendor_id, grn_no, grn_date, invoice_no, inward_qty, uom, status, created_by, updated_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'AWAITING_FORMAT', $10, $10) RETURNING id`,
              [l[0].id, plantId, itemId, vendorId, lot.grnNo, lot.grnDate, lot.invoiceNo ?? null, lot.inwardQty, lot.uom ?? null, userId],
            );
            return (await tryOpen(db, m[0].id, { userId })) ? 'OPENED' : 'CREATED';
          });
          if (outcome !== 'SEEN') summary.createdLots += 1;
          if (outcome === 'OPENED') summary.openedImirs += 1;
        } catch (err) {
          if (!failed) {
            failed = true;
            retryFrom = before;
          }
          summary.errors.push({ sapLotNo: lot.sapLotNo, message: err.isOperational ? err.message : 'Unexpected error; see the server log.' });
          if (!err.isOperational) log?.error({ err, sapLotNo: lot.sapLotNo }, 'SAP lot failed');
        }
      }
      cursor = failed ? retryFrom : batch.cursor;
      const status = summary.errors.length ? 'PARTIAL' : 'OK';
      await pool.query(
        `UPDATE intg.sap_sync_run SET status = $2, finished_at = now(), cursor_value = $3, fetched = $4, created_lots = $5, opened_imirs = $6, errors = $7 WHERE id = $1`,
        [runId, status, cursor, summary.fetched, summary.createdLots, summary.openedImirs, JSON.stringify(summary.errors)],
      );
      return { ...summary, status };
    } catch (err) {
      await pool.query("UPDATE intg.sap_sync_run SET status = 'FAILED', finished_at = now(), errors = $2 WHERE id = $1", [runId, JSON.stringify([{ message: err.message }])]);
      throw err;
    }
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [SYNC_LOCK]).catch(() => {});
    lockClient.release();
  }
}

export async function listRuns(limit = 30) {
  const { rows } = await getPool().query(
    `SELECT r.id, r.started_at, r.finished_at, r.status, r.source, r.fetched, r.created_lots, r.opened_imirs, r.errors, u.full_name AS triggered_by_name
       FROM intg.sap_sync_run r LEFT JOIN core.app_user u ON u.id = r.triggered_by ORDER BY r.id DESC LIMIT $1`,
    [limit],
  );
  return camelRows(rows);
}
