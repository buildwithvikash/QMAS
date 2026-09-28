import { getPool } from '../../db/pool.js';
import { camelRows, likeContains, offsetOf, pageMeta } from '../../shared/sql.js';

/**
 * Audit trail search. Always bounded by a date range so the query stays on a few monthly
 * partitions even when the log holds years of history.
 */

export const EXPORT_LIMIT = 20_000;

function changesWhere(f) {
  const args = [f.from, f.to];
  const where = ['a.changed_at >= $1', 'a.changed_at < $2'];
  const arg = (v) => { args.push(v); return `$${args.length}`; };
  if (f.table) where.push(`a.table_name = ${arg(f.table)}`);
  if (f.rowPk) where.push(`a.row_pk = ${arg(f.rowPk)}`);
  if (f.actorId) where.push(`a.actor_id = ${arg(f.actorId)}`);
  if (f.operation) where.push(`a.operation = ${arg(f.operation)}`);
  // Search inside the record: its key, and any old or new value (IMIR no., a reading, a decision…).
  if (f.q) {
    const p = arg(likeContains(f.q));
    where.push(`(a.row_pk ILIKE ${p} OR a.table_name ILIKE ${p} OR a.old_data::text ILIKE ${p} OR a.new_data::text ILIKE ${p} OR u.full_name ILIKE ${p} OR u.employee_code ILIKE ${p})`);
  }
  return { args, arg, where };
}

export async function listChanges(f, { all = false } = {}) {
  const { args, arg, where } = changesWhere(f);
  const { rows } = await getPool().query(
    `SELECT a.id, a.changed_at, a.table_name, a.operation, a.row_pk, a.actor_id,
            u.employee_code AS actor_employee_code, u.full_name AS actor_name,
            a.request_id, a.old_data, a.new_data, count(*) OVER () AS total
       FROM audit.audit_log a LEFT JOIN core.app_user u ON u.id = a.actor_id
      WHERE ${where.join(' AND ')}
      ORDER BY a.changed_at DESC, a.id DESC
      ${all ? `LIMIT ${EXPORT_LIMIT}` : `LIMIT ${arg(f.pageSize)} OFFSET ${arg(offsetOf(f))}`}`,
    args,
  );
  return { data: camelRows(rows).map(({ total, ...r }) => r), meta: pageMeta(f, rows[0]?.total ?? 0) };
}

export async function listAuthEvents(f, { all = false } = {}) {
  const args = [f.from, f.to];
  const where = ['e.at >= $1', 'e.at < $2'];
  const arg = (v) => { args.push(v); return `$${args.length}`; };
  if (f.actorId) where.push(`e.user_id = ${arg(f.actorId)}`);
  if (f.event) where.push(`e.event = ${arg(f.event)}`);
  if (f.q) {
    const p = arg(likeContains(f.q));
    where.push(`(e.employee_code ILIKE ${p} OR u.full_name ILIKE ${p} OR host(e.ip) ILIKE ${p} OR e.user_agent ILIKE ${p} OR e.detail::text ILIKE ${p})`);
  }

  const { rows } = await getPool().query(
    `SELECT e.id, e.at, e.event, e.user_id, e.employee_code, u.full_name, host(e.ip) AS ip, e.user_agent, e.detail,
            count(*) OVER () AS total
       FROM audit.auth_event e LEFT JOIN core.app_user u ON u.id = e.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.at DESC, e.id DESC
      ${all ? `LIMIT ${EXPORT_LIMIT}` : `LIMIT ${arg(f.pageSize)} OFFSET ${arg(offsetOf(f))}`}`,
    args,
  );
  return { data: camelRows(rows).map(({ total, ...r }) => r), meta: pageMeta(f, rows[0]?.total ?? 0) };
}

/**
 * Figures for the period: data changes, sign-in events, people involved, and the same totals for
 * the period of equal length just before (for the trend).
 */
export async function summary({ from, to }) {
  const span = to - from;
  const prevFrom = new Date(from.getTime() - span);
  const { rows } = await getPool().query(
    `SELECT (SELECT count(*)::int FROM audit.audit_log WHERE changed_at >= $1 AND changed_at < $2) AS data_changes,
            (SELECT count(*)::int FROM audit.auth_event WHERE at >= $1 AND at < $2) AS sign_in_events,
            (SELECT count(*)::int FROM (SELECT actor_id AS u FROM audit.audit_log WHERE changed_at >= $1 AND changed_at < $2 AND actor_id IS NOT NULL
                                         UNION SELECT user_id FROM audit.auth_event WHERE at >= $1 AND at < $2 AND user_id IS NOT NULL) x) AS unique_users,
            (SELECT count(*)::int FROM audit.auth_event WHERE at >= $1 AND at < $2 AND event IN ('LOGIN_FAILED', 'LOCKED', 'REFRESH_REUSE')) AS security_alerts,
            (SELECT count(*)::int FROM audit.audit_log WHERE changed_at >= $3 AND changed_at < $1)
              + (SELECT count(*)::int FROM audit.auth_event WHERE at >= $3 AND at < $1) AS previous_total`,
    [from, to, prevFrom],
  );
  const r = camelRows(rows)[0];
  const total = r.dataChanges + r.signInEvents;
  return { ...r, total, trendPct: r.previousTotal ? Math.round(((total - r.previousTotal) / r.previousTotal) * 100) : null };
}

/** People who changed data or signed in during the period (for the User filter). */
export async function actors({ from, to }) {
  const { rows } = await getPool().query(
    `SELECT u.id, u.full_name, u.employee_code
       FROM core.app_user u
      WHERE u.id IN (SELECT actor_id FROM audit.audit_log WHERE changed_at >= $1 AND changed_at < $2
                     UNION SELECT user_id FROM audit.auth_event WHERE at >= $1 AND at < $2)
      ORDER BY u.full_name`,
    [from, to],
  );
  return camelRows(rows);
}

export async function listTables() {
  const { rows } = await getPool().query(
    `SELECT DISTINCT event_object_schema || '.' || event_object_table AS table_name
       FROM information_schema.triggers WHERE trigger_name = 'audit_log' ORDER BY 1`,
  );
  return rows.map((r) => r.table_name);
}

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const OPS = { I: 'Created', U: 'Updated', D: 'Deleted' };

/** The filtered list as CSV (UTF-8 with BOM for Excel), newest first, up to EXPORT_LIMIT rows. */
export async function exportCsv(kind, f) {
  const lines = [];
  if (kind === 'changes') {
    const { data } = await listChanges(f, { all: true });
    lines.push(['When', 'Action', 'Table', 'Record', 'Changed by', 'Employee code', 'Changed fields', 'Before', 'After', 'Request'].join(','));
    for (const r of data) {
      const keys = r.operation === 'U' ? Object.keys(r.newData ?? {}).filter((k) => JSON.stringify(r.newData[k]) !== JSON.stringify(r.oldData?.[k])) : [];
      lines.push([r.changedAt, OPS[r.operation], r.tableName, r.rowPk, r.actorName ?? 'System', r.actorEmployeeCode, keys.join(' '), r.oldData, r.newData, r.requestId].map(csvCell).join(','));
    }
  } else {
    const { data } = await listAuthEvents(f, { all: true });
    lines.push(['When', 'Event', 'User', 'Employee code', 'IP address', 'Device', 'Detail'].join(','));
    for (const r of data) lines.push([r.at, r.event, r.fullName, r.employeeCode, r.ip, r.userAgent, r.detail].map(csvCell).join(','));
  }
  return `﻿${lines.join('\r\n')}`;
}
