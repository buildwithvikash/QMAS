import { camelRow, camelRows, likeContains, offsetOf, orderBy } from '../../shared/sql.js';

const USER_COLUMNS = `u.id, u.employee_code, u.full_name, u.email, u.phone, u.is_active, u.must_change_password,
  u.locked_until, u.last_login_at, u.password_changed_at, u.created_at, u.updated_at, u.row_version`;

const SORTABLE = {
  employeeCode: 'u.employee_code',
  fullName: 'u.full_name',
  lastLoginAt: 'u.last_login_at',
  createdAt: 'u.created_at',
};

export async function list(db, f) {
  const where = [];
  const args = [];
  const arg = (v) => { args.push(v); return `$${args.length}`; };
  if (f.q) {
    const p = arg(likeContains(f.q));
    where.push(`(u.employee_code::text ILIKE ${p} OR u.full_name ILIKE ${p} OR u.email::text ILIKE ${p})`);
  }
  if (f.isActive !== undefined) where.push(`u.is_active = ${arg(f.isActive)}`);
  if (f.roleCode) where.push(`EXISTS (SELECT 1 FROM core.user_role r WHERE r.user_id = u.id AND r.role_code = ${arg(f.roleCode)})`);
  if (f.plantId) where.push(`EXISTS (SELECT 1 FROM core.user_role r WHERE r.user_id = u.id AND r.plant_id = ${arg(f.plantId)})`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await db.query(
    `SELECT ${USER_COLUMNS},
            count(*) OVER () AS total,
            COALESCE((SELECT json_agg(json_build_object('roleCode', r.role_code, 'roleName', ro.name, 'plantId', r.plant_id, 'plantSapCode', p.sap_code)
                                ORDER BY ro.sort_order, p.sap_code)
                        FROM core.user_role r JOIN core.role ro ON ro.code = r.role_code LEFT JOIN core.plant p ON p.id = r.plant_id
                       WHERE r.user_id = u.id), '[]') AS roles
       FROM core.app_user u
       ${whereSql}
       ${orderBy(SORTABLE, f.sort, f.order, 'employeeCode')}
      LIMIT ${arg(f.pageSize)} OFFSET ${arg(offsetOf(f))}`,
    args,
  );
  return { rows: camelRows(rows).map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function findById(db, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(`SELECT ${USER_COLUMNS} FROM core.app_user u WHERE u.id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [id]);
  return camelRow(rows[0]);
}

export async function rolesOf(db, userId) {
  const { rows } = await db.query(
    `SELECT r.id, r.role_code, ro.name AS role_name, r.plant_id, p.sap_code AS plant_sap_code, p.name AS plant_name,
            r.valid_from, r.valid_to
       FROM core.user_role r
       JOIN core.role ro ON ro.code = r.role_code
       LEFT JOIN core.plant p ON p.id = r.plant_id
      WHERE r.user_id = $1
      ORDER BY ro.sort_order, p.sap_code`,
    [userId],
  );
  return camelRows(rows);
}

export async function insert(db, u) {
  const { rows } = await db.query(
    `INSERT INTO core.app_user (employee_code, full_name, email, phone, password_hash, must_change_password, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, true, $6, $6) RETURNING id`,
    [u.employeeCode, u.fullName, u.email ?? null, u.phone ?? null, u.passwordHash, u.actorId],
  );
  return rows[0].id;
}

/** Optimistic update: returns false when the row version did not match. */
export async function update(db, id, rowVersion, fields) {
  const map = { fullName: 'full_name', email: 'email', phone: 'phone', isActive: 'is_active' };
  const sets = [];
  const args = [id, rowVersion];
  for (const [k, col] of Object.entries(map)) {
    if (fields[k] !== undefined) {
      args.push(fields[k]);
      sets.push(`${col} = $${args.length}`);
    }
  }
  if (fields.isActive === false) sets.push('token_version = token_version + 1');
  if (sets.length === 0) sets.push('updated_at = now()');
  const { rowCount } = await db.query(`UPDATE core.app_user SET ${sets.join(', ')} WHERE id = $1 AND row_version = $2`, args);
  return rowCount === 1;
}

export async function bumpVersion(db, id, rowVersion) {
  const { rowCount } = await db.query('UPDATE core.app_user SET updated_at = now() WHERE id = $1 AND row_version = $2', [id, rowVersion]);
  return rowCount === 1;
}

export async function replaceRoles(db, userId, roles, actorId) {
  await db.query('DELETE FROM core.user_role WHERE user_id = $1', [userId]);
  for (const r of roles) {
    await db.query(
      `INSERT INTO core.user_role (user_id, role_code, plant_id, valid_to, created_by) VALUES ($1, $2, $3, $4, $5)`,
      [userId, r.roleCode, r.plantId, r.validTo ?? null, actorId],
    );
  }
}

export async function setPassword(db, id, passwordHash) {
  await db.query(
    `UPDATE core.app_user SET password_hash = $2, must_change_password = true, password_changed_at = now(),
            token_version = token_version + 1, failed_login_count = 0, locked_until = NULL
      WHERE id = $1`,
    [id, passwordHash],
  );
}

export async function unlock(db, id) {
  await db.query('UPDATE core.app_user SET failed_login_count = 0, locked_until = NULL WHERE id = $1', [id]);
}

export async function revokeSessions(db, userId, reason) {
  await db.query('UPDATE core.refresh_token SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL', [userId, reason]);
}

export async function countActiveAdmins(db, excludingUserId) {
  const { rows } = await db.query(
    `SELECT count(DISTINCT u.id)::int AS n
       FROM core.app_user u JOIN core.user_role r ON r.user_id = u.id
      WHERE r.role_code = 'SYSTEM_ADMIN' AND u.is_active AND u.id <> $1
        AND (r.valid_to IS NULL OR r.valid_to >= current_date)`,
    [excludingUserId],
  );
  return rows[0].n;
}
