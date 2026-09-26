import { getPool } from '../../db/pool.js';
import { AppError } from '../../shared/AppError.js';

const TTL_MS = 30_000;
const cache = new Map();

/**
 * Loads a user's identity, effective role assignments and permissions.
 * Cached for 30 s per API instance; user/role changes call `invalidateAccess` so this instance
 * sees them at once and other instances within 30 s.
 */
export async function loadAccess(userId) {
  const hit = cache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.value;

  const pool = getPool();
  const { rows: users } = await pool.query(
    `SELECT id, employee_code, full_name, email, is_active, is_locked, must_change_password, token_version
       FROM core.app_user WHERE id = $1`,
    [userId],
  );
  if (users.length === 0) return null;
  const u = users[0];

  const { rows } = await pool.query(
    `SELECT ur.role_code, ur.plant_id, r.name AS role_name, r.view_scope, r.action_scope,
            p.sap_code, p.name AS plant_name,
            COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions
       FROM core.user_role ur
       JOIN core.role r ON r.code = ur.role_code AND r.is_active
       LEFT JOIN core.plant p ON p.id = ur.plant_id
       LEFT JOIN core.role_permission rp ON rp.role_code = ur.role_code
      WHERE ur.user_id = $1
        AND ur.valid_from <= current_date
        AND (ur.valid_to IS NULL OR ur.valid_to >= current_date)
      GROUP BY ur.id, r.code, p.id
      ORDER BY r.sort_order, p.sap_code`,
    [userId],
  );

  const assignments = rows.map((r) => ({
    roleCode: r.role_code,
    roleName: r.role_name,
    plantId: r.plant_id,
    plantSapCode: r.sap_code,
    plantName: r.plant_name,
    viewScope: r.view_scope,
    actionScope: r.action_scope,
    permissions: r.permissions,
  }));

  const value = {
    id: u.id,
    employeeCode: u.employee_code,
    fullName: u.full_name,
    email: u.email,
    isActive: u.is_active,
    isLocked: u.is_locked,
    mustChangePassword: u.must_change_password,
    tokenVersion: u.token_version,
    assignments,
    permissions: new Set(assignments.flatMap((a) => a.permissions)),
  };
  cache.set(userId, { value, expires: Date.now() + TTL_MS });
  return value;
}

export function invalidateAccess(userId) {
  if (userId) cache.delete(userId);
  else cache.clear();
}

/**
 * Which plants a user may see (kind 'view') or act on (kind 'action') for a permission.
 * Returns { all: true } or { all: false, plantIds: [...] }. Throws 403 if no role grants it.
 * Repositories turn this into a WHERE clause, so plant visibility is enforced in SQL, not the UI.
 */
export function plantScope(user, permission, kind = 'view') {
  const relevant = user.assignments.filter((a) => a.permissions.includes(permission));
  if (relevant.length === 0) throw AppError.forbidden();
  const plantIds = new Set();
  for (const a of relevant) {
    const wide = kind === 'view' ? a.viewScope === 'ALL_PLANTS' : a.actionScope === 'ALL';
    if (wide || a.plantId === null) return { all: true };
    plantIds.add(a.plantId);
  }
  return { all: false, plantIds: [...plantIds] };
}

/** Public shape of the signed-in user for the web app. */
export function toSessionUser(access) {
  return {
    id: access.id,
    employeeCode: access.employeeCode,
    fullName: access.fullName,
    email: access.email,
    mustChangePassword: access.mustChangePassword,
    roles: access.assignments.map(({ roleCode, roleName, plantId, plantSapCode, plantName }) => ({ roleCode, roleName, plantId, plantSapCode, plantName })),
    permissions: [...access.permissions].sort(),
  };
}
