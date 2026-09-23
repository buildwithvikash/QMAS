import { PERMISSIONS } from '@qmas/shared';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../shared/AppError.js';
import { camelRow, camelRows } from '../../shared/sql.js';
import { plantScope } from '../auth/access.service.js';
import * as imir from '../imir/imir.service.js';

// ── Devices ───────────────────────────────────────────────────────────────────

const DEVICE_SELECT = `SELECT d.id, d.device_code, d.name, d.plant_id, p.sap_code AS plant_sap_code, p.name AS plant_name, d.is_active,
       act.last_seen_at, u.full_name AS last_user_name, d.created_at, d.row_version,
       (SELECT count(*)::int FROM qms.imir_checkout c WHERE c.device_id = d.id) AS checked_out
  FROM core.device d JOIN core.plant p ON p.id = d.plant_id
  LEFT JOIN core.device_activity act ON act.device_id = d.id LEFT JOIN core.app_user u ON u.id = act.last_user_id`;

export async function listDevices() {
  const { rows } = await getPool().query(`${DEVICE_SELECT} ORDER BY p.sap_code, d.device_code`);
  return camelRows(rows);
}

export async function createDevice(ctx, body) {
  return withTransaction(ctx, async (db) => {
    const { rows } = await db.query(
      'INSERT INTO core.device (device_code, name, plant_id, created_by, updated_by) VALUES ($1, $2, $3, $4, $4) RETURNING id',
      [body.deviceCode, body.name, body.plantId, ctx.userId],
    );
    return camelRow((await db.query(`${DEVICE_SELECT} WHERE d.id = $1`, [rows[0].id])).rows[0]);
  });
}

export async function updateDevice(ctx, id, { rowVersion, name, isActive }) {
  return withTransaction(ctx, async (db) => {
    const { rowCount } = await db.query(
      'UPDATE core.device SET name = COALESCE($3, name), is_active = COALESCE($4, is_active) WHERE id = $1 AND row_version = $2',
      [id, rowVersion, name ?? null, isActive ?? null],
    );
    if (!rowCount) throw AppError.staleVersion('This device');
    // A deactivated (lost/stolen) tablet keeps no locks.
    if (isActive === false) await db.query('DELETE FROM qms.imir_checkout WHERE device_id = $1', [id]);
    return camelRow((await db.query(`${DEVICE_SELECT} WHERE d.id = $1`, [id])).rows[0]);
  });
}

/** The tablet identifies itself once with its device code (printed on the tablet by the admin). */
export async function deviceByCode(user, code) {
  const { rows } = await getPool().query(`${DEVICE_SELECT} WHERE d.device_code = $1`, [code.toUpperCase()]);
  const d = camelRow(rows[0]);
  if (!d || !d.isActive) throw AppError.notFound('Active tablet with this code');
  const scope = plantScope(user, PERMISSIONS.IMIR_INSPECT, 'action');
  if (!scope.all && !scope.plantIds.includes(d.plantId)) throw AppError.forbidden('This tablet belongs to a plant you do not inspect for.');
  return d;
}

async function activeDevice(db, user, deviceId) {
  const { rows } = await db.query('SELECT id, plant_id, is_active, device_code FROM core.device WHERE id = $1', [deviceId]);
  if (!rows[0]?.is_active) throw AppError.forbidden('This tablet is not registered or has been deactivated. Ask the administrator.', { code: 'DEVICE_INACTIVE' });
  await db.query(
    `INSERT INTO core.device_activity (device_id, last_seen_at, last_user_id) VALUES ($1, now(), $2)
     ON CONFLICT (device_id) DO UPDATE SET last_seen_at = now(), last_user_id = EXCLUDED.last_user_id`,
    [deviceId, user.id],
  );
  return rows[0];
}

// ── Checkout ──────────────────────────────────────────────────────────────────

/**
 * Takes lots onto a tablet for offline inspection. A lot already on another tablet is refused
 * (two tablets must never record the same lot); re-checking out on the same tablet is fine.
 * Returns full inspection bundles for the lots taken.
 */
export async function checkout(ctx, user, { deviceId, imirIds }) {
  const taken = [];
  const refused = [];
  await withTransaction(ctx, async (db) => {
    const device = await activeDevice(db, user, deviceId);
    for (const id of imirIds) {
      try {
        const m = await imir.detail(id, user, db);
        if (!m.allowedActions.includes('inspect')) throw AppError.conflict(m.status === 'AWAITING_FORMAT' ? 'Not open yet (no approved format).' : 'Not open for inspection.');
        if (m.plantId !== device.plant_id) throw AppError.conflict(`Lot belongs to plant ${m.plantSapCode}; this tablet is registered for another plant.`);
        if (m.checkoutDeviceId && m.checkoutDeviceId !== deviceId) throw AppError.conflict(`Already on tablet ${m.checkoutDeviceCode} (${m.checkoutUserName}).`);
        await db.query(
          `INSERT INTO qms.imir_checkout (imir_id, device_id, user_id) VALUES ($1, $2, $3)
           ON CONFLICT (imir_id) DO UPDATE SET user_id = EXCLUDED.user_id, checked_out_at = now() WHERE qms.imir_checkout.device_id = EXCLUDED.device_id`,
          [id, deviceId, user.id],
        );
        taken.push(id);
      } catch (err) {
        if (!err.isOperational) throw err;
        refused.push({ imirId: id, reason: err.message });
      }
    }
  });
  const bundles = [];
  for (const id of taken) bundles.push(await imir.detail(id, user));
  return { checkedOut: bundles, refused };
}

/** Gives lots back. The tablet releases its own; the Incharge (devices.manage) can release any. */
export async function release(ctx, user, { deviceId, imirIds }) {
  const force = user.permissions.has(PERMISSIONS.DEVICES_MANAGE);
  if (!deviceId && !force) throw AppError.forbidden('Only the Incharge can release lots held by a tablet.');
  return withTransaction(ctx, async (db) => {
    const { rows } = await db.query(
      `DELETE FROM qms.imir_checkout WHERE imir_id = ANY($1) AND ($2::uuid IS NULL OR device_id = $2 OR $3) RETURNING imir_id`,
      [imirIds, deviceId ?? null, force],
    );
    return { released: rows.map((r) => r.imir_id) };
  });
}

export async function checkoutsOfDevice(user, deviceId) {
  await withTransaction({ userId: user.id }, (db) => activeDevice(db, user, deviceId));
  const { rows } = await getPool().query('SELECT imir_id FROM qms.imir_checkout WHERE device_id = $1', [deviceId]);
  return rows.map((r) => r.imir_id);
}

// ── Push ──────────────────────────────────────────────────────────────────────

/**
 * Applies operations recorded offline, in order. Each operation has a UUID: if it was already
 * applied, the stored outcome is returned again (a retry after a dropped connection is harmless).
 * A refused operation (lot released, reverted or submitted elsewhere) is reported, not lost: the
 * tablet keeps the entries and shows them under "Needs attention".
 */
export async function push(ctx, user, { deviceId, ops }) {
  await withTransaction(ctx, (db) => activeDevice(db, user, deviceId));
  const results = [];
  const touched = new Set();
  for (const op of ops) {
    const { rows: seen } = await getPool().query('SELECT outcome, detail FROM sync.client_op WHERE op_id = $1', [op.opId]);
    if (seen[0]) {
      results.push({ opId: op.opId, outcome: seen[0].outcome, duplicate: true, ...(seen[0].detail ?? {}) });
      continue;
    }
    let outcome = 'ACCEPTED';
    let detail = null;
    try {
      if (op.type === 'SAVE') await imir.saveProgress(ctx, user, op.imirId, { ...op.payload, deviceId }, { clientTime: op.clientTime });
      else await imir.submit(ctx, user, op.imirId, { rowVersion: op.payload?.rowVersion ?? null, deviceId });
      touched.add(op.imirId);
    } catch (err) {
      if (!err.isOperational) throw err;
      outcome = err.statusCode === 409 ? 'CONFLICT' : 'REJECTED';
      detail = { message: err.message, code: err.code, errors: err.errors };
    }
    await getPool().query(
      `INSERT INTO sync.client_op (op_id, device_id, user_id, imir_id, op_type, client_time, outcome, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (op_id) DO NOTHING`,
      [op.opId, deviceId, user.id, op.imirId, op.type, op.clientTime, outcome, detail],
    );
    results.push({ opId: op.opId, outcome, ...(detail ?? {}) });
  }
  const imirs = [];
  for (const id of touched) {
    const d = await imir.detail(id, user);
    imirs.push({ id, status: d.status, rowVersion: d.rowVersion, result: d.result, checkedOut: d.checkoutDeviceId === deviceId });
  }
  return { results, imirs };
}
