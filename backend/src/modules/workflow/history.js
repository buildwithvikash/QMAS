import { camelRows } from '../../shared/sql.js';
import { notifyForAction } from '../notifications/notify.js';

/**
 * Appends one step to the lot's workflow history (who, as which role, what, why; actorId null =
 * system) and queues the notifications for it in the same transaction. `snapshot` is the record's
 * state just before the step (see the *Snapshot helpers), so an admin can reverse to it later.
 */
export async function logAction(db, entry) {
  const { imirId, deviationId = null, dnId = null, action, fromStatus = null, toStatus = null, actorId = null, actingRole = null, remark = null, payload = null, snapshot = null } = entry;
  await db.query(
    `INSERT INTO qms.imir_action (imir_id, deviation_id, dn_id, action, from_status, to_status, actor_id, acting_role, remark, payload, snapshot, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULLIF(current_setting('app.request_id', true), ''))`,
    [imirId, deviationId, dnId, action, fromStatus, toStatus, actorId, actingRole, remark, payload ? JSON.stringify(payload) : null, snapshot ? JSON.stringify(snapshot) : null],
  );
  await notifyForAction(db, { ...entry, deviationId, dnId, actorId, remark, payload });
}

// ── State before a step (for reversal) ────────────────────────────────────────

/** The IMIR's workflow columns. */
export async function imirSnapshot(db, imirId) {
  const { rows } = await db.query('SELECT status, result, defective_samples, submitted_at, submitted_by, closed_at FROM qms.imir WHERE id = $1', [imirId]);
  return { imir: rows[0] };
}

/** The whole deviation row, and the IMIR status that follows it. */
export async function deviationSnapshot(db, deviationId) {
  const { rows } = await db.query(
    'SELECT to_jsonb(d) AS deviation, m.status AS imir_status, m.closed_at AS imir_closed_at FROM qms.deviation d JOIN qms.imir m ON m.id = d.imir_id WHERE d.id = $1',
    [deviationId],
  );
  return { deviation: rows[0].deviation, imir: { status: rows[0].imir_status, closed_at: rows[0].imir_closed_at } };
}

/** The DN's status columns, how many CAPA cycles it had and the review of the latest one. */
export async function dnSnapshot(db, dnId) {
  const { rows } = await db.query('SELECT status, closed_at, closed_by FROM qms.defect_notification WHERE id = $1', [dnId]);
  const { rows: c } = await db.query(
    'SELECT cycle_no, review_decision, review_remark, reviewed_by, reviewed_at FROM qms.dn_capa WHERE dn_id = $1 ORDER BY cycle_no DESC LIMIT 1',
    [dnId],
  );
  return { dn: rows[0], cycles: c[0]?.cycle_no ?? 0, latestCapa: c[0] ?? null };
}

export async function history(db, imirId) {
  const { rows } = await db.query(
    `SELECT a.id, a.action, a.from_status, a.to_status, a.actor_id, u.full_name AS actor_name, a.acting_role, r.name AS acting_role_name,
            a.remark, a.payload, a.at, a.deviation_id, a.dn_id, a.request_id
       FROM qms.imir_action a
       LEFT JOIN core.app_user u ON u.id = a.actor_id
       LEFT JOIN core.role r ON r.code = a.acting_role
      WHERE a.imir_id = $1 ORDER BY a.at, a.id`,
    [imirId],
  );
  return camelRows(rows).map((r) => ({ ...r, id: Number(r.id) }));
}
