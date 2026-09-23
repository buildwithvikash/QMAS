import { ROLES } from '@qmas/shared';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../shared/AppError.js';
import { camelRows } from '../../shared/sql.js';
import { invalidateAccess } from '../auth/access.service.js';

/** Roles with their permissions and how many users hold each (Roles & Permissions screen). */
export async function listRoles() {
  const { rows } = await getPool().query(
    `SELECT r.code, r.name, r.department, r.view_scope, r.action_scope, r.requires_plant,
            COALESCE((SELECT array_agg(permission_key ORDER BY permission_key) FROM core.role_permission WHERE role_code = r.code), '{}') AS permissions,
            (SELECT count(DISTINCT user_id)::int FROM core.user_role WHERE role_code = r.code) AS user_count
       FROM core.role r ORDER BY r.sort_order`,
  );
  return camelRows(rows);
}

export async function listPermissions() {
  const { rows } = await getPool().query('SELECT key, module, description FROM core.permission ORDER BY sort_order');
  return rows;
}

/** Replaces a role's permission set. System Admin always keeps every permission. */
export async function setRolePermissions(ctx, code, permissions) {
  if (code === ROLES.SYSTEM_ADMIN) throw AppError.unprocessable('System Admin always has every permission and cannot be changed.');
  const keys = [...new Set(permissions)];

  const result = await withTransaction(ctx, async (db) => {
    const { rows: role } = await db.query('SELECT code FROM core.role WHERE code = $1 FOR UPDATE', [code]);
    if (role.length === 0) throw AppError.notFound('Role');
    const { rows: known } = await db.query('SELECT key FROM core.permission WHERE key = ANY($1)', [keys]);
    const knownKeys = new Set(known.map((r) => r.key));
    const unknown = keys.filter((k) => !knownKeys.has(k));
    if (unknown.length) throw AppError.unprocessable(`Unknown permission: ${unknown.join(', ')}.`);

    await db.query('DELETE FROM core.role_permission WHERE role_code = $1 AND NOT (permission_key = ANY($2))', [code, keys]);
    await db.query(
      `INSERT INTO core.role_permission (role_code, permission_key, granted_by)
       SELECT $1, unnest($2::text[]), $3 ON CONFLICT DO NOTHING`,
      [code, keys, ctx.userId],
    );
    const { rows } = await db.query('SELECT COALESCE(array_agg(permission_key ORDER BY permission_key), \'{}\') AS p FROM core.role_permission WHERE role_code = $1', [code]);
    return { code, permissions: rows[0].p };
  });
  invalidateAccess(); // affects every user holding this role
  return result;
}
