import { SECTIONS } from '@qmas/shared';
import { camelRow, camelRows, likeContains, offsetOf, orderBy } from '../../shared/sql.js';

const VERSION_COLUMNS = `v.id, v.format_id, v.version_no, v.status, v.source, v.source_ref, v.base_version_id,
  bv.version_no AS base_version_no, v.format_no, v.common_format_no, v.ref_standard, v.remarks, v.merge_note,
  v.created_at, v.created_by, cu.full_name AS created_by_name, v.submitted_at, v.submitted_by,
  v.decided_at, v.decided_by, du.full_name AS decided_by_name, v.decision_remark, v.updated_at, v.row_version,
  f.item_id, f.current_version_id, i.item_code, i.description AS item_description`;
const VERSION_FROM = `qms.format_version v
  JOIN qms.format f ON f.id = v.format_id
  JOIN mst.item i ON i.id = f.item_id
  LEFT JOIN qms.format_version bv ON bv.id = v.base_version_id
  LEFT JOIN core.app_user cu ON cu.id = v.created_by
  LEFT JOIN core.app_user du ON du.id = v.decided_by`;

const num = (v) => (v === null || v === undefined ? null : Number(v));

export async function getVersion(db, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(`SELECT ${VERSION_COLUMNS} FROM ${VERSION_FROM} WHERE v.id = $1 ${forUpdate ? 'FOR UPDATE OF v' : ''}`, [id]);
  return camelRow(rows[0]);
}

export async function getCheckpoints(db, versionId) {
  const { rows } = await db.query(
    `SELECT checkpoint_uid AS uid, section, seq, checkpoint, specification, nominal, lsl, usl, uom, instrument, frequency_months
       FROM qms.format_checkpoint WHERE version_id = $1
      ORDER BY array_position($2::text[], section), seq`,
    [versionId, SECTIONS],
  );
  return camelRows(rows).map((c) => ({ ...c, nominal: num(c.nominal), lsl: num(c.lsl), usl: num(c.usl) }));
}

/** The content model used by diff/merge: { header, checkpoints }. */
export async function loadModel(db, versionOrId) {
  const v = typeof versionOrId === 'string' ? await getVersion(db, versionOrId) : versionOrId;
  return {
    header: { formatNo: v.formatNo, commonFormatNo: v.commonFormatNo, refStandard: v.refStandard },
    checkpoints: await getCheckpoints(db, v.id),
  };
}

export async function replaceCheckpoints(db, versionId, checkpoints) {
  await db.query('DELETE FROM qms.format_checkpoint WHERE version_id = $1', [versionId]);
  if (!checkpoints.length) return;
  await db.query(
    `INSERT INTO qms.format_checkpoint (version_id, checkpoint_uid, section, seq, checkpoint, specification, nominal, lsl, usl, uom, instrument, frequency_months)
     SELECT $1, x.uid, x.section, x.seq, x.checkpoint, x.specification, x.nominal, x.lsl, x.usl, x.uom, x.instrument, x."frequencyMonths"
       FROM jsonb_to_recordset($2::jsonb) AS x(uid uuid, section text, seq smallint, checkpoint text, specification text,
            nominal numeric, lsl numeric, usl numeric, uom text, instrument text, "frequencyMonths" smallint)`,
    [versionId, JSON.stringify(checkpoints)],
  );
}

export async function ensureFormat(db, itemId, userId) {
  await db.query('INSERT INTO qms.format (item_id, created_by) VALUES ($1, $2) ON CONFLICT (item_id) DO NOTHING', [itemId, userId]);
  const { rows } = await db.query('SELECT id, current_version_id FROM qms.format WHERE item_id = $1 FOR UPDATE', [itemId]);
  return camelRow(rows[0]);
}

export async function lockFormat(db, formatId) {
  const { rows } = await db.query('SELECT id, item_id, current_version_id FROM qms.format WHERE id = $1 FOR UPDATE', [formatId]);
  return camelRow(rows[0]);
}

export async function insertVersion(db, v) {
  const { rows } = await db.query(
    `INSERT INTO qms.format_version (format_id, status, source, source_ref, base_version_id, format_no, common_format_no, ref_standard, remarks, version_no, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) RETURNING id`,
    [v.formatId, v.status, v.source, v.sourceRef ?? null, v.baseVersionId ?? null, v.header.formatNo ?? null, v.header.commonFormatNo ?? null,
      v.header.refStandard ?? null, v.remarks ?? null, v.versionNo ?? null, v.userId],
  );
  return rows[0].id;
}

/** Optimistic update of a version row; returns false on a stale rowVersion. */
export async function updateVersion(db, id, rowVersion, fields) {
  const map = {
    status: 'status', baseVersionId: 'base_version_id', formatNo: 'format_no', commonFormatNo: 'common_format_no', refStandard: 'ref_standard',
    remarks: 'remarks', mergeNote: 'merge_note', versionNo: 'version_no', submittedAt: 'submitted_at', submittedBy: 'submitted_by',
    decidedAt: 'decided_at', decidedBy: 'decided_by', decisionRemark: 'decision_remark',
  };
  const sets = [];
  const args = [id];
  for (const [k, col] of Object.entries(map)) {
    if (fields[k] !== undefined) {
      args.push(fields[k]);
      sets.push(`${col} = $${args.length}`);
    }
  }
  let where = 'id = $1';
  if (rowVersion !== null && rowVersion !== undefined) {
    args.push(rowVersion);
    where += ` AND row_version = $${args.length}`;
  }
  const { rowCount } = await db.query(`UPDATE qms.format_version SET ${sets.join(', ')} WHERE ${where}`, args);
  return rowCount === 1;
}

export async function nextVersionNo(db, formatId) {
  const { rows } = await db.query('SELECT COALESCE(max(version_no), 0) + 1 AS n FROM qms.format_version WHERE format_id = $1', [formatId]);
  return rows[0].n;
}

export async function setCurrent(db, formatId, versionId) {
  await db.query('UPDATE qms.format SET current_version_id = $2 WHERE id = $1', [formatId, versionId]);
}

export async function versionsOf(db, formatId) {
  const { rows } = await db.query(
    `SELECT v.id, v.version_no, v.status, v.source, v.base_version_id, bv.version_no AS base_version_no, v.created_at,
            cu.full_name AS created_by_name, v.created_by, v.submitted_at, v.decided_at, du.full_name AS decided_by_name,
            v.decision_remark, v.merge_note, v.row_version,
            (SELECT count(*)::int FROM qms.format_checkpoint c WHERE c.version_id = v.id) AS checkpoint_count
       FROM qms.format_version v
       LEFT JOIN qms.format_version bv ON bv.id = v.base_version_id
       LEFT JOIN core.app_user cu ON cu.id = v.created_by
       LEFT JOIN core.app_user du ON du.id = v.decided_by
      WHERE v.format_id = $1
      ORDER BY v.version_no DESC NULLS FIRST, v.created_at DESC`,
    [formatId],
  );
  return camelRows(rows);
}

const LIBRARY_SORT = { itemCode: 'i.item_code', description: 'i.description', versionNo: 'cv.version_no', updatedAt: 'last_activity' };

/** Every item with its format state: approved version and open drafts (format coverage view). */
export async function library(db, f) {
  const args = [];
  const arg = (v) => { args.push(v); return `$${args.length}`; };
  const where = ['i.is_active'];
  if (f.q) {
    const p = arg(likeContains(f.q));
    where.push(`(i.item_code ILIKE ${p} OR i.description ILIKE ${p})`);
  }
  const statusFilter = {
    NONE: 'cv.id IS NULL',
    APPROVED: 'cv.id IS NOT NULL',
    PENDING_APPROVAL: 'counts.pending > 0',
    CONFLICT: 'counts.conflict > 0',
    DRAFT: 'counts.draft > 0',
  }[f.status];
  if (statusFilter) where.push(statusFilter);

  const { rows } = await db.query(
    `SELECT i.id AS item_id, i.item_code, i.description, i.drawing_no, i.drawing_rev,
            fm.id AS format_id, cv.id AS current_version_id, cv.version_no, cv.decided_at AS approved_at,
            COALESCE(counts.draft, 0) AS draft_count, COALESCE(counts.pending, 0) AS pending_count, COALESCE(counts.conflict, 0) AS conflict_count,
            GREATEST(cv.decided_at, counts.last_change) AS last_activity,
            count(*) OVER () AS total
       FROM mst.item i
       LEFT JOIN qms.format fm ON fm.item_id = i.id
       LEFT JOIN qms.format_version cv ON cv.id = fm.current_version_id
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE status IN ('DRAFT', 'REJECTED'))::int AS draft,
                count(*) FILTER (WHERE status = 'PENDING_APPROVAL')::int AS pending,
                count(*) FILTER (WHERE status = 'CONFLICT')::int AS conflict,
                max(updated_at) AS last_change
           FROM qms.format_version WHERE format_id = fm.id AND status IN ('DRAFT', 'REJECTED', 'PENDING_APPROVAL', 'CONFLICT')
       ) counts ON true
      WHERE ${where.join(' AND ')}
      ${orderBy(LIBRARY_SORT, f.sort, f.order, 'itemCode')}
      LIMIT ${arg(f.pageSize)} OFFSET ${arg(offsetOf(f))}`,
    args,
  );
  return { rows: camelRows(rows).map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function queue(db) {
  const { rows } = await db.query(
    `SELECT v.id, v.status, v.source, v.submitted_at, v.created_at, cu.full_name AS created_by_name, su.full_name AS submitted_by_name,
            i.id AS item_id, i.item_code, i.description AS item_description,
            bv.version_no AS base_version_no, cv.version_no AS current_version_no,
            (v.base_version_id IS DISTINCT FROM f.current_version_id) AS behind_current,
            (SELECT count(*)::int FROM qms.format_checkpoint c WHERE c.version_id = v.id) AS checkpoint_count
       FROM qms.format_version v
       JOIN qms.format f ON f.id = v.format_id
       JOIN mst.item i ON i.id = f.item_id
       LEFT JOIN qms.format_version bv ON bv.id = v.base_version_id
       LEFT JOIN qms.format_version cv ON cv.id = f.current_version_id
       LEFT JOIN core.app_user cu ON cu.id = v.created_by
       LEFT JOIN core.app_user su ON su.id = v.submitted_by
      WHERE v.status IN ('PENDING_APPROVAL', 'CONFLICT')
      ORDER BY v.submitted_at, v.id`,
  );
  return camelRows(rows);
}

export async function openDraftsOf(db, formatId, excludeId = null) {
  const { rows } = await db.query(
    `SELECT v.id, v.status, v.created_at, v.created_by, u.full_name AS created_by_name
       FROM qms.format_version v LEFT JOIN core.app_user u ON u.id = v.created_by
      WHERE v.format_id = $1 AND v.status IN ('DRAFT', 'REJECTED', 'PENDING_APPROVAL', 'CONFLICT') AND v.id IS DISTINCT FROM $2
      ORDER BY v.created_at`,
    [formatId, excludeId],
  );
  return camelRows(rows);
}

export async function openConflicts(db, versionId) {
  const { rows } = await db.query(
    `SELECT id, against_version_id, checkpoint_uid, field, label, base_value, theirs_value, mine_value
       FROM qms.format_merge_conflict WHERE version_id = $1 AND resolved_at IS NULL ORDER BY id`,
    [versionId],
  );
  return camelRows(rows);
}

export async function replaceOpenConflicts(db, versionId, againstVersionId, conflicts) {
  await db.query('DELETE FROM qms.format_merge_conflict WHERE version_id = $1 AND resolved_at IS NULL', [versionId]);
  for (const c of conflicts) {
    await db.query(
      `INSERT INTO qms.format_merge_conflict (version_id, against_version_id, checkpoint_uid, field, label, base_value, theirs_value, mine_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [versionId, againstVersionId, c.uid, c.field, c.checkpoint, JSON.stringify(c.base), JSON.stringify(c.theirs), JSON.stringify(c.mine)],
    );
  }
}

export async function markResolved(db, conflictId, resolution, value, userId) {
  await db.query(
    'UPDATE qms.format_merge_conflict SET resolution = $2, resolved_value = $3, resolved_by = $4, resolved_at = now() WHERE id = $1',
    [conflictId, resolution, JSON.stringify(value), userId],
  );
}
