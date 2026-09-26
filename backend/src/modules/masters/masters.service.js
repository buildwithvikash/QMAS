import { getPool } from '../../db/pool.js';
import { AppError } from '../../shared/AppError.js';
import { camelRows } from '../../shared/sql.js';

/** A plant still used by role assignments cannot be deactivated. */
export async function checkPlantDeactivation(db, data, id) {
  if (id === undefined || data.isActive !== false) return;
  const { rows } = await db.query('SELECT count(*)::int AS n FROM core.user_role WHERE plant_id = $1', [id]);
  if (rows[0].n > 0) {
    throw AppError.unprocessable(`${rows[0].n} role assignment(s) still use this plant. Move them to another plant before deactivating it.`);
  }
}

/** An item may only point at active categories and units. */
export async function checkItemRefs(db, data) {
  const errors = [];
  if (data.categoryId) {
    const { rows } = await db.query('SELECT 1 FROM mst.item_category WHERE id = $1 AND is_active', [data.categoryId]);
    if (!rows.length) errors.push({ path: 'categoryId', message: 'Choose an active item category.' });
  }
  if (data.uomId) {
    const { rows } = await db.query('SELECT 1 FROM mst.uom WHERE id = $1 AND is_active', [data.uomId]);
    if (!rows.length) errors.push({ path: 'uomId', message: 'Choose an active unit of measure.' });
  }
  if (errors.length) throw AppError.unprocessable('Some fields need attention.', errors);
}

/** Every small list the web app needs for dropdowns, in one call. */
export async function getLookups() {
  const pool = getPool();
  const q = async (sql) => camelRows((await pool.query(sql)).rows);
  const [plants, uoms, itemCategories, instruments, deviationActions, deviationSeverities, escalationAuthorities, roles, vendors] = await Promise.all([
    q('SELECT id, sap_code, short_code, name, is_active FROM core.plant ORDER BY sap_code'),
    q('SELECT id, code, name FROM mst.uom WHERE is_active ORDER BY code'),
    q('SELECT id, code, name FROM mst.item_category WHERE is_active ORDER BY name'),
    q('SELECT id, code, name FROM mst.instrument WHERE is_active ORDER BY name'),
    q('SELECT code, name FROM mst.deviation_action ORDER BY sort_order'),
    q('SELECT code, name FROM mst.deviation_severity ORDER BY sort_order'),
    q('SELECT e.role_code, r.name, e.rank FROM mst.escalation_authority e JOIN core.role r ON r.code = e.role_code ORDER BY e.rank'),
    q('SELECT code, name, department, requires_plant, is_active FROM core.role ORDER BY sort_order, name'),
    // Vendors that have lots (the Vendor filter of the lists), by name.
    q('SELECT v.id, v.vendor_code, v.name FROM mst.vendor v WHERE EXISTS (SELECT 1 FROM qms.imir m WHERE m.vendor_id = v.id) ORDER BY v.name'),
  ]);
  return { plants, uoms, itemCategories, instruments, deviationActions, deviationSeverities, escalationAuthorities, roles, vendors };
}
