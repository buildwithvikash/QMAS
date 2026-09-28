import { getEnv } from '../../config/env.js';
import { getPool } from '../../db/pool.js';
import { sapMode } from '../../integrations/sap/index.js';
import { AppError } from '../../shared/AppError.js';
import { camelRows, likeContains, offsetOf, pageMeta } from '../../shared/sql.js';

/**
 * SAP Sync monitor: the pulls (filtered, paged, exported), the figures of the last pull against the
 * one before, whether the worker keeps its schedule, and what one pull brought in.
 */

const RUN_COLUMNS = `r.id, r.started_at, r.finished_at, r.status, r.source, r.fetched, r.created_lots, r.opened_imirs, r.errors,
  r.triggered_by, u.full_name AS triggered_by_name, extract(epoch FROM coalesce(r.finished_at, now()) - r.started_at)::numeric(10, 1) AS duration_sec`;

function runsWhere(f) {
  const args = [f.from, f.to];
  const where = ['r.started_at >= $1', 'r.started_at < $2'];
  const arg = (v) => { args.push(v); return `$${args.length}`; };
  if (f.status) where.push(`r.status = ${arg(f.status)}`);
  if (f.by === 'scheduler') where.push('r.triggered_by IS NULL');
  else if (f.by) where.push(`r.triggered_by = ${arg(f.by)}`);
  // Search the problems (plant, lot no., message) and the lots a pull brought in (lot, plant, GRN, IMIR).
  if (f.q) {
    const p = arg(likeContains(f.q));
    where.push(`(r.errors::text ILIKE ${p} OR EXISTS (SELECT 1 FROM intg.sap_inspection_lot l LEFT JOIN qms.imir m ON m.sap_lot_id = l.id
                   WHERE l.sync_run_id = r.id AND (l.sap_lot_no ILIKE ${p} OR l.plant_sap_code ILIKE ${p} OR l.grn_no ILIKE ${p} OR l.item_code ILIKE ${p} OR m.imir_no ILIKE ${p})))`);
  }
  return { args, arg, where };
}

export async function listRuns(f, { all = false } = {}) {
  const { args, arg, where } = runsWhere(f);
  const { rows } = await getPool().query(
    `SELECT ${RUN_COLUMNS}, count(*) OVER () AS total
       FROM intg.sap_sync_run r LEFT JOIN core.app_user u ON u.id = r.triggered_by
      WHERE ${where.join(' AND ')}
      ORDER BY r.started_at DESC, r.id DESC
      ${all ? 'LIMIT 20000' : `LIMIT ${arg(f.pageSize)} OFFSET ${arg(offsetOf(f))}`}`,
    args,
  );
  return { data: camelRows(rows).map(({ total, durationSec, ...r }) => ({ ...r, durationSec: Number(durationSec) })), meta: pageMeta(f, rows[0]?.total ?? 0) };
}

const pctChange = (now, before) => (before ? Math.round(((now - before) / before) * 100) : now ? null : 0);

/**
 * The last finished pull with the change against the one before it, and the connection state:
 * CONNECTED when the last pull succeeded within two intervals, DELAYED when the schedule was
 * missed, FAILING when the last pull failed.
 */
export async function summary() {
  const { rows } = await getPool().query(
    `SELECT ${RUN_COLUMNS} FROM intg.sap_sync_run r LEFT JOIN core.app_user u ON u.id = r.triggered_by
      WHERE r.status <> 'RUNNING' ORDER BY r.started_at DESC, r.id DESC LIMIT 2`,
  );
  const { rows: running } = await getPool().query("SELECT count(*)::int AS n FROM intg.sap_sync_run WHERE status = 'RUNNING' AND started_at > now() - interval '1 hour'");
  const { rows: day } = await getPool().query(
    `SELECT count(*)::int AS pulls, coalesce(sum(fetched), 0)::int AS fetched, coalesce(sum(created_lots), 0)::int AS created, coalesce(sum(opened_imirs), 0)::int AS opened,
            count(*) FILTER (WHERE status <> 'OK')::int AS with_problems
       FROM intg.sap_sync_run WHERE started_at >= now() - interval '24 hours'`,
  );
  const [last, prev] = camelRows(rows);
  const interval = getEnv().SAP_SYNC_INTERVAL_MIN;
  let state = 'NEVER';
  if (last) {
    const age = (Date.now() - new Date(last.startedAt)) / 60_000;
    state = last.status === 'FAILED' ? 'FAILING' : age > interval * 2 + 1 ? 'DELAYED' : 'CONNECTED';
  }
  return {
    mode: sapMode(),
    intervalMin: interval,
    state,
    running: running[0].n > 0,
    last: last ? { ...last, durationSec: Number(last.durationSec) } : null,
    trend: last && prev ? { fetched: pctChange(last.fetched, prev.fetched), createdLots: pctChange(last.createdLots, prev.createdLots), openedImirs: pctChange(last.openedImirs, prev.openedImirs) } : null,
    last24h: camelRows(day)[0],
  };
}

/** One pull: its figures, problems, and the lots it brought in with their IMIR. */
export async function runDetail(id) {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT ${RUN_COLUMNS} FROM intg.sap_sync_run r LEFT JOIN core.app_user u ON u.id = r.triggered_by WHERE r.id = $1`, [id]);
  if (!rows[0]) throw AppError.notFound('SAP pull');
  const { rows: lots } = await pool.query(
    `SELECT l.sap_lot_no, l.plant_sap_code, p.name AS plant_name, l.grn_no, l.grn_date, l.item_code, l.item_description, l.vendor_code, l.vendor_name, l.inward_qty, l.uom,
            m.id AS imir_id, m.imir_no, m.status AS imir_status
       FROM intg.sap_inspection_lot l LEFT JOIN core.plant p ON p.sap_code = l.plant_sap_code LEFT JOIN qms.imir m ON m.sap_lot_id = l.id
      WHERE l.sync_run_id = $1 ORDER BY l.id`,
    [id],
  );
  const run = camelRows(rows)[0];
  return { ...run, durationSec: Number(run.durationSec), lots: camelRows(lots) };
}

/** People who started pulls by hand (for the "Started by" filter); the scheduler is listed by the page. */
export async function starters() {
  const { rows } = await getPool().query(
    `SELECT DISTINCT u.id, u.full_name, u.employee_code FROM intg.sap_sync_run r JOIN core.app_user u ON u.id = r.triggered_by ORDER BY u.full_name`,
  );
  return camelRows(rows);
}

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export async function exportCsv(f) {
  const { data } = await listRuns(f, { all: true });
  const lines = [['Started', 'Finished', 'Status', 'Adapter', 'Lots read', 'New lots', 'IMIRs opened', 'Started by', 'Duration (s)', 'Problems'].join(',')];
  for (const r of data) {
    lines.push([r.startedAt, r.finishedAt, r.status, r.source, r.fetched, r.createdLots, r.openedImirs, r.triggeredByName ?? 'Scheduler', r.durationSec,
      (r.errors ?? []).map((e) => `${e.sapLotNo ? `Lot ${e.sapLotNo}: ` : ''}${e.message}`).join(' | ')].map(csvCell).join(','));
  }
  return `﻿${lines.join('\r\n')}`;
}
