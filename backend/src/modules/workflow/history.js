import { camelRows } from '../../shared/sql.js';
import { notifyForAction } from '../notifications/notify.js';

/**
 * Appends one step to the lot's workflow history (who, as which role, what, why; actorId null =
 * system) and queues the notifications for it in the same transaction.
 */
export async function logAction(db, entry) {
  const { imirId, deviationId = null, dnId = null, action, fromStatus = null, toStatus = null, actorId = null, actingRole = null, remark = null, payload = null } = entry;
  await db.query(
    `INSERT INTO qms.imir_action (imir_id, deviation_id, dn_id, action, from_status, to_status, actor_id, acting_role, remark, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [imirId, deviationId, dnId, action, fromStatus, toStatus, actorId, actingRole, remark, payload ? JSON.stringify(payload) : null],
  );
  await notifyForAction(db, { ...entry, deviationId, dnId, actorId, remark, payload });
}

export async function history(db, imirId) {
  const { rows } = await db.query(
    `SELECT a.id, a.action, a.from_status, a.to_status, a.actor_id, u.full_name AS actor_name, a.acting_role, r.name AS acting_role_name,
            a.remark, a.payload, a.at, a.deviation_id, a.dn_id
       FROM qms.imir_action a
       LEFT JOIN core.app_user u ON u.id = a.actor_id
       LEFT JOIN core.role r ON r.code = a.acting_role
      WHERE a.imir_id = $1 ORDER BY a.at, a.id`,
    [imirId],
  );
  return camelRows(rows);
}
