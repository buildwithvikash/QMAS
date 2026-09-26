import { camelRow, camelRows, likeContains, offsetOf, orderBy } from '../../shared/sql.js';

// A session counts as active while it has not ended and its refresh token is still usable.
export const ACTIVE_SESSION = `s.ended_at IS NULL AND EXISTS (SELECT 1 FROM core.refresh_token t WHERE t.family_id = s.id AND t.revoked_at IS NULL AND t.expires_at > now())`;
const ONLINE = "s.last_seen_at > now() - interval '5 minutes'";

const USER_COLUMNS = `u.id, u.employee_code, u.full_name, u.email, u.phone, u.is_active, u.must_change_password,
  u.locked_until, u.is_locked, u.locked_reason, u.locked_at, lb.full_name AS locked_by_name,
  u.last_login_at, u.password_changed_at, u.created_at, u.updated_at, u.row_version,
  ss.active_sessions, ss.online, ss.last_seen_at, ss.last_ip, ss.last_host, ss.ips, ss.hosts`;
// Per user: open sessions, online now, and where the latest one came from.
const USER_JOINS = `LEFT JOIN core.app_user lb ON lb.id = u.locked_by
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE ${ACTIVE_SESSION})::int AS active_sessions,
           coalesce(bool_or(${ACTIVE_SESSION} AND ${ONLINE}), false) AS online,
           max(s.last_seen_at) AS last_seen_at,
           (array_agg(host(s.ip) ORDER BY s.last_seen_at DESC))[1] AS last_ip,
           (array_agg(s.host_name ORDER BY s.last_seen_at DESC))[1] AS last_host,
           coalesce(array_agg(DISTINCT host(s.ip)) FILTER (WHERE ${ACTIVE_SESSION} AND s.ip IS NOT NULL), '{}') AS ips,
           coalesce(array_agg(DISTINCT s.host_name) FILTER (WHERE ${ACTIVE_SESSION} AND s.host_name IS NOT NULL), '{}') AS hosts
      FROM core.user_session s WHERE s.user_id = u.id) ss ON true`;
const STATUS = {
  online: 'ss.online',
  locked: '(u.is_locked OR u.locked_until > now())',
  inactive: 'NOT u.is_active',
  mustChange: 'u.must_change_password AND u.is_active',
  multiple: 'ss.active_sessions > 1',
  active: 'u.is_active AND NOT u.is_locked',
};

const SORTABLE = {
  employeeCode: 'u.employee_code',
  fullName: 'u.full_name',
  lastLoginAt: 'u.last_login_at',
  lastSeenAt: 'ss.last_seen_at',
  createdAt: 'u.created_at',
};

export async function list(db, f) {
  const where = [];
  const args = [];
  const arg = (v) => { args.push(v); return `$${args.length}`; };
  if (f.q) {
    const p = arg(likeContains(f.q));
    // Name, code, e-mail, role, or the IP / computer name of a session.
    where.push(`(u.employee_code::text ILIKE ${p} OR u.full_name ILIKE ${p} OR u.email::text ILIKE ${p}
      OR EXISTS (SELECT 1 FROM core.user_role r JOIN core.role ro ON ro.code = r.role_code WHERE r.user_id = u.id AND ro.name ILIKE ${p})
      OR EXISTS (SELECT 1 FROM core.user_session s WHERE s.user_id = u.id AND (host(s.ip) ILIKE ${p} OR s.host_name ILIKE ${p})))`);
  }
  if (f.isActive !== undefined) where.push(`u.is_active = ${arg(f.isActive)}`);
  if (f.status && STATUS[f.status]) where.push(STATUS[f.status]);
  if (f.roleCode) where.push(`EXISTS (SELECT 1 FROM core.user_role r WHERE r.user_id = u.id AND r.role_code = ${arg(f.roleCode)})`);
  if (f.plantId) where.push(`EXISTS (SELECT 1 FROM core.user_role r WHERE r.user_id = u.id AND r.plant_id = ${arg(f.plantId)})`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await db.query(
    `SELECT ${USER_COLUMNS},
            count(*) OVER () AS total,
            COALESCE((SELECT json_agg(json_build_object('roleCode', r.role_code, 'roleName', ro.name, 'plantId', r.plant_id, 'plantSapCode', p.sap_code, 'plantName', p.name)
                                ORDER BY ro.sort_order, p.sap_code)
                        FROM core.user_role r JOIN core.role ro ON ro.code = r.role_code LEFT JOIN core.plant p ON p.id = r.plant_id
                       WHERE r.user_id = u.id), '[]') AS roles
       FROM core.app_user u
       ${USER_JOINS}
       ${whereSql}
       ${orderBy(SORTABLE, f.sort, f.order, 'employeeCode')}
      LIMIT ${arg(f.pageSize)} OFFSET ${arg(offsetOf(f))}`,
    args,
  );
  return { rows: camelRows(rows).map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function findById(db, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(`SELECT ${USER_COLUMNS} FROM core.app_user u ${USER_JOINS} WHERE u.id = $1 ${forUpdate ? 'FOR UPDATE OF u' : ''}`, [id]);
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

/** Clears both locks: the administrator's and the automatic one after failed attempts. */
export async function unlock(db, id) {
  await db.query('UPDATE core.app_user SET failed_login_count = 0, locked_until = NULL, is_locked = false, locked_reason = NULL, locked_at = NULL, locked_by = NULL WHERE id = $1', [id]);
}

/** Administrator's lock; every issued token stops working (token_version). */
export async function lock(db, id, reason, by) {
  await db.query('UPDATE core.app_user SET is_locked = true, locked_reason = $2, locked_at = now(), locked_by = $3, token_version = token_version + 1 WHERE id = $1', [id, reason, by]);
}

export async function bumpTokenVersion(db, { id = null, exceptId = null }) {
  if (id) await db.query('UPDATE core.app_user SET token_version = token_version + 1 WHERE id = $1', [id]);
  else await db.query('UPDATE core.app_user SET token_version = token_version + 1 WHERE id <> $1', [exceptId]);
}

const SESSION_COLS = `s.id, s.user_id, u.employee_code, u.full_name, s.client, host(s.ip) AS ip, s.host_name, s.user_agent,
  s.started_at, s.last_seen_at, s.ended_at, s.end_reason, eb.full_name AS ended_by_name,
  (${ACTIVE_SESSION}) AS active, (${ACTIVE_SESSION} AND ${ONLINE}) AS online`;

/** Every active session, most recently used first (Active sessions tab). */
export async function activeSessions(db) {
  const { rows } = await db.query(
    `SELECT ${SESSION_COLS},
            (SELECT string_agg(DISTINCT ro.name, ', ') FROM core.user_role r JOIN core.role ro ON ro.code = r.role_code WHERE r.user_id = u.id) AS roles
       FROM core.user_session s JOIN core.app_user u ON u.id = s.user_id LEFT JOIN core.app_user eb ON eb.id = s.ended_by
      WHERE ${ACTIVE_SESSION}
      ORDER BY s.last_seen_at DESC LIMIT 1000`,
  );
  return camelRows(rows);
}

/** One user's recent sessions, open and ended. */
export async function sessionsOf(db, userId, limit = 25) {
  const { rows } = await db.query(
    `SELECT ${SESSION_COLS} FROM core.user_session s JOIN core.app_user u ON u.id = s.user_id LEFT JOIN core.app_user eb ON eb.id = s.ended_by
      WHERE s.user_id = $1 ORDER BY s.started_at DESC LIMIT $2`,
    [userId, limit],
  );
  return camelRows(rows);
}

export async function findSession(db, id) {
  const { rows } = await db.query(`SELECT ${SESSION_COLS} FROM core.user_session s JOIN core.app_user u ON u.id = s.user_id LEFT JOIN core.app_user eb ON eb.id = s.ended_by WHERE s.id = $1`, [id]);
  return camelRow(rows[0]);
}

/** Figures for the top of User Management. */
export async function summary(db) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE u.is_active)::int AS active,
            count(*) FILTER (WHERE NOT u.is_active)::int AS inactive,
            count(*) FILTER (WHERE u.is_locked OR u.locked_until > now())::int AS locked,
            count(*) FILTER (WHERE u.must_change_password AND u.is_active)::int AS must_change,
            (SELECT count(DISTINCT s.user_id)::int FROM core.user_session s WHERE ${ACTIVE_SESSION} AND ${ONLINE}) AS online,
            (SELECT count(*)::int FROM core.user_session s WHERE ${ACTIVE_SESSION}) AS sessions,
            (SELECT count(*)::int FROM (SELECT s.user_id FROM core.user_session s WHERE ${ACTIVE_SESSION} GROUP BY s.user_id HAVING count(*) > 1) m) AS multiple
       FROM core.app_user u`,
  );
  return camelRow(rows[0]);
}

export async function countActiveAdmins(db, excludingUserId) {
  const { rows } = await db.query(
    `SELECT count(DISTINCT u.id)::int AS n
       FROM core.app_user u JOIN core.user_role r ON r.user_id = u.id
      WHERE r.role_code = 'SYSTEM_ADMIN' AND u.is_active AND NOT u.is_locked AND u.id <> $1
        AND (r.valid_to IS NULL OR r.valid_to >= current_date)`,
    [excludingUserId],
  );
  return rows[0].n;
}
