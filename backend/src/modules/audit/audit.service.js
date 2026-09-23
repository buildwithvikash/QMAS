import { getPool } from '../../db/pool.js';
import { camelRows, offsetOf, pageMeta } from '../../shared/sql.js';

/**
 * Audit trail search. Always bounded by a date range so the query stays on a few monthly
 * partitions even when the log holds years of history.
 */
export async function listChanges(f) {
  const args = [f.from, f.to];
  const where = ['a.changed_at >= $1', 'a.changed_at < $2'];
  const arg = (v) => { args.push(v); return `$${args.length}`; };
  if (f.table) where.push(`a.table_name = ${arg(f.table)}`);
  if (f.rowPk) where.push(`a.row_pk = ${arg(f.rowPk)}`);
  if (f.actorId) where.push(`a.actor_id = ${arg(f.actorId)}`);
  if (f.operation) where.push(`a.operation = ${arg(f.operation)}`);

  const { rows } = await getPool().query(
    `SELECT a.id, a.changed_at, a.table_name, a.operation, a.row_pk, a.actor_id,
            u.employee_code AS actor_employee_code, u.full_name AS actor_name,
            a.request_id, a.old_data, a.new_data, count(*) OVER () AS total
       FROM audit.audit_log a LEFT JOIN core.app_user u ON u.id = a.actor_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.changed_at DESC, a.id DESC
      LIMIT ${arg(f.pageSize)} OFFSET ${arg(offsetOf(f))}`,
    args,
  );
  return { data: camelRows(rows).map(({ total, ...r }) => r), meta: pageMeta(f, rows[0]?.total ?? 0) };
}

export async function listAuthEvents(f) {
  const args = [f.from, f.to];
  const where = ['e.at >= $1', 'e.at < $2'];
  const arg = (v) => { args.push(v); return `$${args.length}`; };
  if (f.actorId) where.push(`e.user_id = ${arg(f.actorId)}`);
  if (f.event) where.push(`e.event = ${arg(f.event)}`);

  const { rows } = await getPool().query(
    `SELECT e.id, e.at, e.event, e.user_id, e.employee_code, u.full_name, host(e.ip) AS ip, e.user_agent, e.detail,
            count(*) OVER () AS total
       FROM audit.auth_event e LEFT JOIN core.app_user u ON u.id = e.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.at DESC, e.id DESC
      LIMIT ${arg(f.pageSize)} OFFSET ${arg(offsetOf(f))}`,
    args,
  );
  return { data: camelRows(rows).map(({ total, ...r }) => r), meta: pageMeta(f, rows[0]?.total ?? 0) };
}

export async function listTables() {
  const { rows } = await getPool().query(
    `SELECT DISTINCT event_object_schema || '.' || event_object_table AS table_name
       FROM information_schema.triggers WHERE trigger_name = 'audit_log' ORDER BY 1`,
  );
  return rows.map((r) => r.table_name);
}
