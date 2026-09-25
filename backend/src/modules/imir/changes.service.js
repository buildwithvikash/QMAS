import { getPool } from '../../db/pool.js';
import * as imirService from './imir.service.js';

/**
 * Field-level change history of one lot, from the audit trail: the IMIR, its readings and
 * checkpoint entries, photos, its deviation, DN and CAPA cycles. Each entry says what was changed
 * (a readable label such as "Dia, sample 3"), who changed it, and every field's old and new value,
 * so the History panel can highlight them. `requestId` ties entries to the workflow step made in
 * the same request.
 */

// Keys that identify or book-keep a row rather than describe it.
const NOISE = new Set([
  'id', 'imir_id', 'checkpoint_uid', 'sample_no', 'created_at', 'created_by', 'plant_id', 'item_id', 'vendor_id', 'sap_lot_id',
  'format_version_id', 'sampling_plan_id', 'dn_id', 'deviation_id', 'submitted_by', 'inspected_by', 'closed_by', 'initiator_id',
  'qty_entered_by', 'qty_verified_by', 'reviewed_by', 'entity_type', 'entity_id', 'ref', 'storage_key', 'sha256', 'uploaded_by',
  'uploaded_at', 'deleted_by', 'mime_type', 'size_bytes', 'section', 'last_tested_at', 'approval_levels', 'current_level',
  'inspection_started_at', 'opened_at', 'awaiting_reason',
]);

const TABLES = {
  'qms.imir': 'IMIR',
  'qms.imir_observation': 'READING',
  'qms.imir_checkpoint': 'CHECKPOINT',
  'qms.attachment': 'FILE',
  'qms.deviation': 'DEVIATION',
  'qms.defect_notification': 'DN',
  'qms.dn_capa': 'CAPA',
};

export async function changes(id, user) {
  const imir = await imirService.detail(id, user); // checks the user may see the lot
  const db = getPool();
  const { rows: refs } = await db.query(
    `SELECT (SELECT id FROM qms.deviation WHERE imir_id = $1) AS deviation_id,
            (SELECT id FROM qms.defect_notification WHERE imir_id = $1) AS dn_id`,
    [id],
  );
  const { deviation_id: devId, dn_id: dnId } = refs[0];
  const { rows: capaRows } = dnId ? await db.query('SELECT id, cycle_no FROM qms.dn_capa WHERE dn_id = $1', [dnId]) : { rows: [] };
  const { rows: files } = await db.query(
    'SELECT id, file_name, entity_type FROM qms.attachment WHERE entity_id = ANY($1)',
    [[id, dnId].filter(Boolean)],
  );

  const { rows } = await db.query(
    `SELECT a.id, a.changed_at, a.table_name, a.operation, a.row_pk, a.request_id, a.old_data, a.new_data, a.actor_id, u.full_name AS actor_name
       FROM audit.audit_log a LEFT JOIN core.app_user u ON u.id = a.actor_id
      WHERE (a.table_name = 'qms.imir' AND a.row_pk = $1)
         OR (a.table_name IN ('qms.imir_observation', 'qms.imir_checkpoint') AND a.row_pk LIKE $1 || ':%')
         OR (a.table_name = 'qms.deviation' AND a.row_pk = $2)
         OR (a.table_name = 'qms.defect_notification' AND a.row_pk = $3)
         OR (a.table_name = 'qms.dn_capa' AND a.row_pk = ANY($4))
         OR (a.table_name = 'qms.attachment' AND a.row_pk = ANY($5))
      ORDER BY a.changed_at, a.id
      LIMIT 3000`,
    [id, devId ?? '', dnId ?? '', capaRows.map((c) => c.id), files.map((f) => f.id)],
  );

  const cps = new Map(imir.checkpoints.map((c) => [c.uid, c]));
  const fileById = new Map(files.map((f) => [f.id, f]));
  const cycleById = new Map(capaRows.map((c) => [c.id, c.cycle_no]));

  return rows.map((r) => {
    const entity = TABLES[r.table_name];
    const [, cpUid, sample] = r.row_pk.split(':');
    const cp = cps.get(cpUid);
    let label = { IMIR: imir.imirNo ?? 'IMIR', DEVIATION: 'Deviation', DN: 'Defect notification' }[entity];
    if (entity === 'READING') label = `${cp?.checkpoint ?? 'Checkpoint'}, sample ${sample}`;
    if (entity === 'CHECKPOINT') label = cp?.checkpoint ?? 'Checkpoint';
    if (entity === 'CAPA') label = `CAPA cycle ${cycleById.get(r.row_pk) ?? ''}`.trim();
    if (entity === 'FILE') {
      const f = fileById.get(r.row_pk);
      label = `${f?.entity_type === 'CAPA' ? 'CAPA file' : 'Photo'} ${f?.file_name ?? ''}`.trim();
    }

    const oldD = r.old_data ?? {};
    const newD = r.new_data ?? {};
    const created = r.operation === 'I';
    // A new document is one line ("created"); a new reading or entry shows its values.
    const showFields = !(created && ['IMIR', 'DEVIATION', 'DN'].includes(entity));
    const keys = [...new Set([...Object.keys(oldD), ...Object.keys(newD)])].filter((k) => !NOISE.has(k));
    const fields = showFields
      ? keys
        .map((k) => ({ key: k, old: created ? null : (oldD[k] ?? null), new: r.operation === 'D' ? null : (newD[k] ?? null) }))
        .filter((f) => JSON.stringify(f.old) !== JSON.stringify(f.new))
      : [];
    const deleted = entity === 'FILE' && newD.deleted_at;
    // Which document the change belongs to, so the DN page can show only its own.
    const fileOwner = entity === 'FILE' ? (fileById.get(r.row_pk)?.entity_type === 'IMIR_OBSERVATION' ? 'IMIR' : 'DN') : null;
    const owner = fileOwner ?? ({ DEVIATION: 'DEVIATION', DN: 'DN', CAPA: 'DN' }[entity] ?? 'IMIR');
    return {
      id: Number(r.id),
      at: r.changed_at,
      actorId: r.actor_id,
      actorName: r.actor_name,
      requestId: r.request_id,
      entity,
      owner,
      op: deleted ? 'D' : r.operation,
      label,
      unit: entity === 'READING' ? cp?.uom ?? null : null,
      fields: entity === 'FILE' ? [] : fields,
    };
  }).filter((e) => e.op !== 'U' || e.fields.length > 0 || e.entity === 'FILE');
}

