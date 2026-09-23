import { determineSample, validateSamplingRows } from '@qmas/shared';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../shared/AppError.js';
import { camelRow, camelRows } from '../../shared/sql.js';

const PLAN_COLUMNS = 'id, code, name, description, is_default, is_active, created_at, updated_at, row_version';

async function rowsOf(db, planId) {
  const { rows } = await db.query(
    'SELECT lot_min, lot_max, sample_size, accept_no, reject_no FROM mst.sampling_plan_row WHERE plan_id = $1 ORDER BY lot_min',
    [planId],
  );
  return camelRows(rows);
}

async function withRows(db, plan) {
  if (!plan) return plan;
  const rows = await rowsOf(db, plan.id);
  return { ...plan, rows, warnings: validateSamplingRows(rows).warnings };
}

export async function list() {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT ${PLAN_COLUMNS} FROM mst.sampling_plan ORDER BY is_default DESC, code`);
  return Promise.all(camelRows(rows).map((p) => withRows(pool, p)));
}

export async function get(id, db = getPool()) {
  const { rows } = await db.query(`SELECT ${PLAN_COLUMNS} FROM mst.sampling_plan WHERE id = $1`, [id]);
  const plan = camelRow(rows[0]);
  if (!plan) throw AppError.notFound('Sampling plan');
  return withRows(db, plan);
}

async function replaceRows(db, planId, rows) {
  await db.query('DELETE FROM mst.sampling_plan_row WHERE plan_id = $1', [planId]);
  for (const r of [...rows].sort((a, b) => a.lotMin - b.lotMin)) {
    await db.query(
      'INSERT INTO mst.sampling_plan_row (plan_id, lot_min, lot_max, sample_size, accept_no, reject_no) VALUES ($1, $2, $3, $4, $5, $6)',
      [planId, r.lotMin, r.lotMax, r.sampleSize, r.acceptNo, r.rejectNo],
    );
  }
}

/** Only one plan can be the default; making one default clears the flag elsewhere. */
async function applyDefault(db, planId, isDefault) {
  if (isDefault) await db.query('UPDATE mst.sampling_plan SET is_default = false WHERE is_default AND id <> $1', [planId]);
}

export async function create(ctx, input) {
  return withTransaction(ctx, async (db) => {
    const { rows } = await db.query(
      `INSERT INTO mst.sampling_plan (code, name, description, is_active, created_by, updated_by)
       VALUES ($1, $2, $3, COALESCE($4, true), $5, $5) RETURNING id`,
      [input.code, input.name, input.description ?? null, input.isActive, ctx.userId],
    );
    const id = rows[0].id;
    await replaceRows(db, id, input.rows);
    if (input.isDefault) {
      await applyDefault(db, id, true);
      await db.query('UPDATE mst.sampling_plan SET is_default = true WHERE id = $1', [id]);
    }
    return get(id, db);
  });
}

/**
 * Updates plan fields and, when given, replaces the whole table of rows.
 * IMIRs keep the sample size they were opened with, so edits only affect new IMIRs.
 */
export async function update(ctx, id, { rowVersion, rows, ...fields }) {
  return withTransaction(ctx, async (db) => {
    const current = await get(id, db);
    if (fields.isDefault === false && current.isDefault) {
      throw AppError.unprocessable('Make another plan the default instead of clearing this one.');
    }
    if (fields.isActive === false && (fields.isDefault ?? current.isDefault)) {
      throw AppError.unprocessable('The default plan cannot be deactivated.');
    }
    if (fields.isDefault && (fields.isActive ?? current.isActive) === false) {
      throw AppError.unprocessable('Activate the plan before making it the default.');
    }
    if (fields.isDefault) await applyDefault(db, id, true);

    const { rowCount } = await db.query(
      `UPDATE mst.sampling_plan
          SET code = COALESCE($3, code), name = COALESCE($4, name),
              description = CASE WHEN $5::boolean THEN $6 ELSE description END,
              is_default = COALESCE($7, is_default), is_active = COALESCE($8, is_active)
        WHERE id = $1 AND row_version = $2`,
      [id, rowVersion, fields.code, fields.name, fields.description !== undefined, fields.description ?? null, fields.isDefault, fields.isActive],
    );
    if (rowCount !== 1) throw AppError.staleVersion('This sampling plan');
    if (rows) await replaceRows(db, id, rows);
    return get(id, db);
  });
}

/** Sample for an inward quantity using the given plan, or the default plan when id is 'default'. */
export async function lookup(planIdOrDefault, inwardQty) {
  const pool = getPool();
  let plan;
  if (planIdOrDefault === 'default') {
    const { rows } = await pool.query(`SELECT ${PLAN_COLUMNS} FROM mst.sampling_plan WHERE is_default`);
    if (!rows[0]) throw AppError.unprocessable('No default sampling plan is set. Set one in Master Config → Sampling table.');
    plan = await withRows(pool, camelRow(rows[0]));
  } else {
    plan = await get(planIdOrDefault);
  }
  const sample = determineSample(plan.rows, inwardQty);
  if (!sample) {
    throw new AppError(422, `The sampling table "${plan.name}" has no row for a lot of ${inwardQty}. Add a row in Master Config → Sampling table.`, { code: 'LOT_NOT_COVERED' });
  }
  return { planId: plan.id, planCode: plan.code, ...sample };
}
