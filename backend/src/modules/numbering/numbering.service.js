import { formatDocNo, periodKey } from '@qmas/shared';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../shared/AppError.js';
import { camelRow, camelRows } from '../../shared/sql.js';

const MAX_ATTEMPTS = 5;

/** The series in force for a document type and plant at a moment: plant-specific beats default, latest effective wins. */
async function activeSeries(db, docType, plantId, at) {
  const { rows } = await db.query(
    `SELECT id, pattern, reset_scope FROM core.number_series
      WHERE doc_type = $1 AND is_active AND effective_from <= $3 AND (plant_id = $2 OR plant_id IS NULL)
      ORDER BY (plant_id IS NULL), effective_from DESC, id DESC
      LIMIT 1`,
    [docType, plantId, at],
  );
  return rows[0];
}

async function plantCodes(db, plantId) {
  const { rows } = await db.query('SELECT sap_code, short_code, is_active FROM core.plant WHERE id = $1', [plantId]);
  if (!rows[0]) throw AppError.unprocessable('Unknown plant.');
  return rows[0];
}

const noSeries = (docType) =>
  AppError.conflict(`No active number series for ${docType} at this plant. Set one up in Master Config → Number Series.`, { code: 'NO_NUMBER_SERIES' });

/**
 * Issues the next document number inside the caller's transaction.
 * The counter row stays locked until the transaction ends, so numbers are sequential per plant and
 * period, and a rolled-back document gives its number back. issued_doc_no guarantees a number is
 * never issued twice, even if the pattern or reset scope changed mid-period.
 */
export async function issueNumber(db, { docType, plantId, src, at = new Date(), userId = null }) {
  const series = await activeSeries(db, docType, plantId, at);
  if (!series) throw noSeries(docType);
  const plant = await plantCodes(db, plantId);
  const period = periodKey(at, series.reset_scope);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { rows } = await db.query(
      `INSERT INTO core.doc_counter (doc_type, plant_id, period_key, last_no) VALUES ($1, $2, $3, 1)
       ON CONFLICT (doc_type, plant_id, period_key) DO UPDATE SET last_no = core.doc_counter.last_no + 1, updated_at = now()
       RETURNING last_no`,
      [docType, plantId, period],
    );
    const seq = rows[0].last_no;
    const docNo = formatDocNo(series.pattern, { plantSapCode: plant.sap_code, plantShortCode: plant.short_code, src, date: at, seq });
    const { rowCount } = await db.query(
      `INSERT INTO core.issued_doc_no (doc_type, doc_no, plant_id, series_id, issued_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [docType, docNo, plantId, series.id, userId],
    );
    if (rowCount === 1) return { docNo, seq, seriesId: series.id };
  }
  throw new Error(`Could not issue a unique ${docType} number after ${MAX_ATTEMPTS} attempts`);
}

/**
 * The number the next document would get, without issuing it. With `pattern` and `resetScope`
 * it previews an unsaved draft series.
 */
export async function preview({ docType, plantId, src, pattern, resetScope, date }) {
  const pool = getPool();
  const at = date ? new Date(date) : new Date();
  let series = pattern ? { pattern, reset_scope: resetScope } : await activeSeries(pool, docType, plantId, at);
  if (!series) throw noSeries(docType);
  const plant = await plantCodes(pool, plantId);
  const period = periodKey(at, series.reset_scope);
  const { rows } = await pool.query(
    'SELECT last_no FROM core.doc_counter WHERE doc_type = $1 AND plant_id = $2 AND period_key = $3',
    [docType, plantId, period],
  );
  const seq = (rows[0]?.last_no ?? 0) + 1;
  return {
    docNo: formatDocNo(series.pattern, { plantSapCode: plant.sap_code, plantShortCode: plant.short_code, src: src ?? 'IL', date: at, seq }),
    seq,
    periodKey: period,
    seriesId: series.id ?? null,
  };
}

const SERIES_SELECT = `SELECT s.id, s.doc_type, s.plant_id, p.sap_code AS plant_sap_code, p.name AS plant_name, s.pattern, s.reset_scope,
       s.effective_from, s.is_active, s.remarks, s.created_at, s.updated_at, s.row_version,
       (SELECT count(*)::int FROM core.issued_doc_no i WHERE i.series_id = s.id) AS issued_count
  FROM core.number_series s LEFT JOIN core.plant p ON p.id = s.plant_id`;

export async function list() {
  const { rows } = await getPool().query(`${SERIES_SELECT} ORDER BY s.doc_type, s.plant_id NULLS FIRST, s.effective_from DESC, s.id DESC`);
  return camelRows(rows);
}

async function get(db, id) {
  const { rows } = await db.query(`${SERIES_SELECT} WHERE s.id = $1`, [id]);
  if (!rows[0]) throw AppError.notFound('Number series');
  return camelRow(rows[0]);
}

/**
 * Series are append-only: to change a pattern, add a new series (optionally effective later) and
 * deactivate the old one. Issued numbers never change.
 */
export async function create(ctx, input) {
  return withTransaction(ctx, async (db) => {
    if (input.plantId) await plantCodes(db, input.plantId);
    const { rows } = await db.query(
      `INSERT INTO core.number_series (doc_type, plant_id, pattern, reset_scope, effective_from, remarks, created_by, updated_by)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), $6, $7, $7) RETURNING id`,
      [input.docType, input.plantId ?? null, input.pattern, input.resetScope, input.effectiveFrom ?? null, input.remarks ?? null, ctx.userId],
    );
    return get(db, rows[0].id);
  });
}

export async function setActive(ctx, id, { isActive, rowVersion }) {
  return withTransaction(ctx, async (db) => {
    await get(db, id);
    const { rowCount } = await db.query('UPDATE core.number_series SET is_active = $3 WHERE id = $1 AND row_version = $2', [id, rowVersion, isActive]);
    if (rowCount !== 1) throw AppError.staleVersion('This number series');
    return get(db, id);
  });
}
