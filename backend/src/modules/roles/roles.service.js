import { ROLES } from '@qmas/shared';
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/tx.js';
import { AppError } from '../../shared/AppError.js';
import { camelRows } from '../../shared/sql.js';
import { invalidateAccess } from '../auth/access.service.js';

/** Roles with their permissions and how many users hold each (Roles & Permissions screen). */
export async function listRoles() {
  const { rows } = await getPool().query(
    `SELECT r.code, r.name, r.description, r.department, r.view_scope, r.action_scope, r.requires_plant,
            r.is_system, r.is_active, r.created_at, r.updated_at, uu.full_name AS updated_by_name,
            COALESCE((SELECT array_agg(permission_key ORDER BY permission_key) FROM core.role_permission WHERE role_code = r.code), '{}') AS permissions,
            (SELECT count(DISTINCT user_id)::int FROM core.user_role WHERE role_code = r.code) AS user_count
       FROM core.role r
       LEFT JOIN core.app_user uu ON uu.id = r.updated_by
      ORDER BY r.sort_order, r.name`,
  );
  return camelRows(rows);
}

export async function listPermissions() {
  const { rows } = await getPool().query('SELECT key, module, description FROM core.permission ORDER BY sort_order');
  return rows;
}

async function knownPermissions(db, keys) {
  const { rows } = await db.query('SELECT key FROM core.permission WHERE key = ANY($1)', [keys]);
  const known = new Set(rows.map((r) => r.key));
  const unknown = keys.filter((k) => !known.has(k));
  if (unknown.length) throw AppError.unprocessable(`Unknown permission: ${unknown.join(', ')}.`);
}

/** Replaces a role's permission set. System Admin always keeps every permission. */
export async function setRolePermissions(ctx, code, permissions) {
  if (code === ROLES.SYSTEM_ADMIN) throw AppError.unprocessable('System Admin always has every permission and cannot be changed.');
  const keys = [...new Set(permissions)];

  const result = await withTransaction(ctx, async (db) => {
    const { rows: role } = await db.query('SELECT code FROM core.role WHERE code = $1 FOR UPDATE', [code]);
    if (role.length === 0) throw AppError.notFound('Role');
    await knownPermissions(db, keys);

    await db.query('DELETE FROM core.role_permission WHERE role_code = $1 AND NOT (permission_key = ANY($2))', [code, keys]);
    await db.query(
      `INSERT INTO core.role_permission (role_code, permission_key, granted_by)
       SELECT $1, unnest($2::text[]), $3 ON CONFLICT DO NOTHING`,
      [code, keys, ctx.userId],
    );
    await db.query('UPDATE core.role SET updated_at = now(), updated_by = $2 WHERE code = $1', [code, ctx.userId]);
    const { rows } = await db.query('SELECT COALESCE(array_agg(permission_key ORDER BY permission_key), \'{}\') AS p FROM core.role_permission WHERE role_code = $1', [code]);
    return { code, permissions: rows[0].p };
  });
  invalidateAccess(); // affects every user holding this role
  return result;
}

const DETAIL_COLUMNS = {
  name: 'name', description: 'description', department: 'department', viewScope: 'view_scope',
  actionScope: 'action_scope', requiresPlant: 'requires_plant', isActive: 'is_active',
};

/** A role code from its name: letters and underscores only (e.g. "Store Keeper" → STORE_KEEPER). */
export function codeFor(name) {
  const base = name.toUpperCase().replace(/[^A-Z]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 34);
  return base || 'CUSTOM_ROLE';
}

/** Codes may not contain digits, so a taken code gets a letter suffix: _B, _C, … _Z, _AA, … */
async function uniqueCode(db, name) {
  const base = codeFor(name);
  const { rows } = await db.query("SELECT code FROM core.role WHERE code = $1 OR code LIKE $1 || '\\_%'", [base]);
  const taken = new Set(rows.map((r) => r.code));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    let n = i;
    let suffix = '';
    while (n > 0) {
      suffix = String.fromCharCode(65 + ((n - 1) % 26)) + suffix;
      n = Math.floor((n - 1) / 26);
    }
    if (!taken.has(`${base}_${suffix}`)) return `${base}_${suffix}`;
  }
}

async function nameFree(db, name, exceptCode = null) {
  const { rows } = await db.query('SELECT 1 FROM core.role WHERE lower(name) = lower($1) AND code IS DISTINCT FROM $2', [name, exceptCode]);
  if (rows.length) throw AppError.conflict(`A role named "${name}" already exists.`);
}

/**
 * Adds a custom role. With `copyFrom` it starts with that role's permissions (Duplicate role),
 * otherwise with `permissions` (or none). Custom roles grant permissions only: the workflow steps
 * (review, approval chains, escalation) stay with the built-in roles.
 */
export async function createRole(ctx, input) {
  const code = await withTransaction(ctx, async (db) => {
    await nameFree(db, input.name);
    let keys = [...new Set(input.permissions ?? [])];
    if (input.copyFrom) {
      if (input.copyFrom === ROLES.SYSTEM_ADMIN) throw AppError.unprocessable('System Admin cannot be copied: give the user the System Admin role instead.');
      const { rows } = await db.query('SELECT 1 FROM core.role WHERE code = $1', [input.copyFrom]);
      if (!rows.length) throw AppError.notFound('Role to copy');
      const { rows: perms } = await db.query('SELECT permission_key FROM core.role_permission WHERE role_code = $1', [input.copyFrom]);
      keys = perms.map((r) => r.permission_key);
    }
    await knownPermissions(db, keys);
    const newCode = await uniqueCode(db, input.name);
    await db.query(
      `INSERT INTO core.role (code, name, description, department, view_scope, action_scope, requires_plant, sort_order, is_system, is_active, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1000, false, true, $8, $8)`,
      [newCode, input.name, input.description ?? null, input.department, input.viewScope, input.actionScope, input.requiresPlant, ctx.userId],
    );
    if (keys.length) {
      await db.query('INSERT INTO core.role_permission (role_code, permission_key, granted_by) SELECT $1, unnest($2::text[]), $3', [newCode, keys, ctx.userId]);
    }
    return newCode;
  });
  return (await listRoles()).find((r) => r.code === code);
}

/** Edits a role. Built-in roles: description only. Custom roles: every detail, and active / inactive. */
export async function updateRole(ctx, code, changes) {
  const fields = Object.keys(changes).filter((k) => changes[k] !== undefined && DETAIL_COLUMNS[k]);
  await withTransaction(ctx, async (db) => {
    const { rows } = await db.query('SELECT is_system FROM core.role WHERE code = $1 FOR UPDATE', [code]);
    if (!rows.length) throw AppError.notFound('Role');
    if (rows[0].is_system && fields.some((k) => k !== 'description')) {
      throw AppError.unprocessable('Built-in roles drive the workflow: only their description and permissions can change.');
    }
    if (changes.name) await nameFree(db, changes.name, code);
    if (!fields.length) return;
    const args = [code, ctx.userId];
    const sets = fields.map((k) => {
      args.push(changes[k]);
      return `${DETAIL_COLUMNS[k]} = $${args.length}`;
    });
    await db.query(`UPDATE core.role SET ${sets.join(', ')}, updated_at = now(), updated_by = $2 WHERE code = $1`, args);
  });
  if (fields.some((k) => k !== 'description')) invalidateAccess(); // active, scopes and names reach every holder
  return (await listRoles()).find((r) => r.code === code);
}

/** Deletes a custom role that no user holds. */
export async function deleteRole(ctx, code) {
  await withTransaction(ctx, async (db) => {
    const { rows } = await db.query('SELECT is_system FROM core.role WHERE code = $1 FOR UPDATE', [code]);
    if (!rows.length) throw AppError.notFound('Role');
    if (rows[0].is_system) throw AppError.unprocessable('Built-in roles cannot be deleted.');
    const { rows: held } = await db.query('SELECT count(DISTINCT user_id)::int AS n FROM core.user_role WHERE role_code = $1', [code]);
    const n = held[0].n;
    if (n > 0) throw AppError.conflict(`${n} user${n === 1 ? ' holds' : 's hold'} this role. Remove it from them first, or make the role inactive.`);
    await db.query('DELETE FROM core.role WHERE code = $1', [code]);
  });
  return { code };
}
