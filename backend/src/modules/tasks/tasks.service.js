import { PERMISSIONS } from '@qmas/shared';
import { getPool } from '../../db/pool.js';
import { camelRows } from '../../shared/sql.js';
import * as devRepo from '../deviation/deviation.repo.js';
import { STAGE_LABEL } from '../deviation/deviation.service.js';
import { dnActions } from '../dn/dn.service.js';
import { IMIR_REVIEW_ACTIONS, actingRole, deviationActions, imirReviewActions } from '../workflow/rules.js';

const P = PERMISSIONS;
const REVIEW_STATUSES = [...new Set(Object.values(IMIR_REVIEW_ACTIONS).map((r) => r.from))];
const OPEN_STAGES = ['INITIATOR', 'SUB_HEAD', 'HEAD', 'FINAL', 'SENIOR', 'UNDER_DEVIATION', 'QTY_VERIFICATION'];
const IMIR_TASK = { SUBMITTED: 'Review inspection', WITH_IQC_HEAD: 'Decide on escalated lot' };
const holds = (user, permission) => user.assignments.some((a) => a.permissions.includes(permission));

/**
 * My Tasks: everything the user can act on now, built from the same rules that authorize the
 * actions, so the inbox never shows a task the user cannot complete. Each task has a `kind`
 * (inspect, review, deviation, capa, format) for grouping on the dashboard, a `link`, the time it
 * has waited (`since`) and, where the workflow sets one, a deadline (`dueAt`).
 */
export async function myTasks(user) {
  const db = getPool();
  const tasks = [];

  // Lots to inspect (Inspector), including lots sent back and lots checked out to a tablet.
  if (holds(user, P.IMIR_INSPECT)) {
    const { rows } = await db.query(
      `SELECT m.id, m.imir_no, m.status, m.plant_id, p.sap_code AS plant_sap_code, p.name AS plant_name, i.item_code, i.description AS item_description,
              v.name AS vendor_name, m.inward_qty, m.uom, m.created_at, m.updated_at, d.device_code AS tablet,
              (SELECT a.action FROM qms.imir_action a WHERE a.imir_id = m.id ORDER BY a.at DESC, a.id DESC LIMIT 1) AS last_action,
              (SELECT a.remark FROM qms.imir_action a WHERE a.imir_id = m.id ORDER BY a.at DESC, a.id DESC LIMIT 1) AS last_remark
         FROM qms.imir m JOIN core.plant p ON p.id = m.plant_id JOIN mst.item i ON i.id = m.item_id JOIN mst.vendor v ON v.id = m.vendor_id
         LEFT JOIN qms.imir_checkout c ON c.imir_id = m.id LEFT JOIN core.device d ON d.id = c.device_id
        WHERE m.status IN ('OPEN', 'IN_INSPECTION') ORDER BY m.created_at LIMIT 1000`,
    );
    for (const m of camelRows(rows)) {
      if (!actingRole(user, { permission: P.IMIR_INSPECT, plantId: m.plantId })) continue;
      const sentBack = m.lastAction === 'REVERT';
      tasks.push({
        kind: 'inspect', entity: 'IMIR', id: m.id, docNo: m.imirNo, link: `/imirs/${m.id}`,
        task: sentBack ? 'Correct and resubmit' : m.status === 'IN_INSPECTION' ? 'Continue inspection' : 'Inspect lot',
        status: m.status, sentBack, note: sentBack ? m.lastRemark : null, tablet: m.tablet,
        qty: m.inwardQty, uom: m.uom, plantSapCode: m.plantSapCode, plantName: m.plantName, itemCode: m.itemCode, itemDescription: m.itemDescription, vendorName: m.vendorName,
        since: sentBack ? m.updatedAt : m.createdAt,
      });
    }
  }

  // Inspections to review (Incharge) and escalated lots to decide (IQC Head).
  const { rows: reviews } = await db.query(
    `SELECT m.id, m.imir_no, m.status, m.result, m.plant_id, p.sap_code AS plant_sap_code, p.name AS plant_name, i.item_code, i.description AS item_description,
            v.name AS vendor_name, m.submitted_at, m.updated_at
       FROM qms.imir m JOIN core.plant p ON p.id = m.plant_id JOIN mst.item i ON i.id = m.item_id JOIN mst.vendor v ON v.id = m.vendor_id
      WHERE m.status = ANY($1) ORDER BY m.updated_at LIMIT 1000`,
    [REVIEW_STATUSES],
  );
  for (const m of camelRows(reviews)) {
    const actions = imirReviewActions(user, m);
    if (!actions.length) continue;
    tasks.push({
      kind: 'review', entity: 'IMIR', id: m.id, docNo: m.imirNo, link: `/imirs/${m.id}`, task: IMIR_TASK[m.status], status: m.status, result: m.result, actions,
      plantSapCode: m.plantSapCode, plantName: m.plantName, itemCode: m.itemCode, itemDescription: m.itemDescription, vendorName: m.vendorName, since: m.updatedAt,
    });
  }

  // Deviations at the user's step (form, approvals, final decision, senior round, quantities).
  const devs = await devRepo.listOpen(db, OPEN_STAGES);
  const rounds = devs.some((d) => d.stage === 'SENIOR') ? await devRepo.rounds(db, devs.filter((d) => d.stage === 'SENIOR').map((d) => d.id)) : [];
  for (const d of devs) {
    const round = rounds.filter((r) => r.deviationId === d.id).at(-1) ?? null;
    const actions = deviationActions(user, d, round);
    if (!actions.some((a) => a !== 'override')) continue; // overriding is a right, not a task
    tasks.push({
      kind: 'deviation', entity: 'DEVIATION', id: d.id, docNo: d.deviationNo, imirNo: d.imirNo, link: `/deviations/${d.id}`, task: STAGE_LABEL[d.stage],
      stage: d.stage, department: d.department, actions, plantSapCode: d.plantSapCode, plantName: d.plantName, itemCode: d.itemCode, itemDescription: d.itemDescription,
      vendorName: d.vendorName, since: d.updatedAt, dueAt: d.stage === 'UNDER_DEVIATION' ? d.qtyDueAt : (round?.steps ?? []).filter((x) => x.status === 'PENDING' && x.dueAt).map((x) => x.dueAt).sort()[0] ?? null,
    });
  }

  // Defect notifications: the vendor's CAPA to enter (Incharge) or to review (IQC Head).
  if (holds(user, P.DN_MANAGE) || holds(user, P.DN_APPROVE_CAPA)) {
    const { rows } = await db.query(
      `SELECT n.id, n.dn_no, n.status, n.plant_id, n.capa_applicable, n.capa_due_at, n.created_at, n.updated_at, p.sap_code AS plant_sap_code, p.name AS plant_name,
              i.item_code, i.description AS item_description, v.name AS vendor_name
         FROM qms.defect_notification n JOIN core.plant p ON p.id = n.plant_id JOIN mst.item i ON i.id = n.item_id JOIN mst.vendor v ON v.id = n.vendor_id
        WHERE n.status IN ('OPEN', 'CAPA_SUBMITTED') ORDER BY n.created_at LIMIT 1000`,
    );
    for (const n of camelRows(rows)) {
      const actions = dnActions(user, n);
      const submit = actions.includes('submit_capa');
      if (!submit && !actions.includes('approve_capa')) continue;
      tasks.push({
        kind: 'capa', entity: 'DN', id: n.id, docNo: n.dnNo, link: `/dns/${n.id}`,
        task: submit ? (n.capaApplicable ? "Enter vendor's CAPA" : 'Send DN for closure') : 'Review CAPA', status: n.status, actions,
        plantSapCode: n.plantSapCode, plantName: n.plantName, itemCode: n.itemCode, itemDescription: n.itemDescription, vendorName: n.vendorName,
        since: submit ? n.createdAt : n.updatedAt, dueAt: submit && n.capaApplicable ? n.capaDueAt : null,
      });
    }
  }

  // Formats: drafts waiting for approval (approvers), and items whose lots wait for a first format.
  if (holds(user, P.FORMATS_APPROVE)) {
    const { rows } = await db.query(
      `SELECT v.id, v.status, v.submitted_at, i.item_code, i.description AS item_description, su.full_name AS submitted_by_name
         FROM qms.format_version v JOIN qms.format f ON f.id = v.format_id JOIN mst.item i ON i.id = f.item_id
         LEFT JOIN core.app_user su ON su.id = v.submitted_by
        WHERE v.status IN ('PENDING_APPROVAL', 'CONFLICT') ORDER BY v.submitted_at`,
    );
    for (const v of camelRows(rows)) {
      tasks.push({
        kind: 'format', entity: 'FORMAT', id: v.id, docNo: v.itemCode, link: v.status === 'CONFLICT' ? `/formats/versions/${v.id}/conflicts` : `/formats/versions/${v.id}`,
        task: v.status === 'CONFLICT' ? 'Resolve format conflict' : 'Approve format', status: v.status,
        itemCode: v.itemCode, itemDescription: v.itemDescription, vendorName: null, note: v.submittedByName ? `Submitted by ${v.submittedByName}` : null,
        since: v.submittedAt,
      });
    }
  }
  if (holds(user, P.FORMATS_CREATE)) {
    const { rows } = await db.query(
      `SELECT i.id AS item_id, i.item_code, i.description AS item_description, min(m.created_at) AS since, count(*)::int AS lots,
              array_agg(DISTINCT m.plant_id) AS plant_ids
         FROM qms.imir m JOIN mst.item i ON i.id = m.item_id
        WHERE m.status = 'AWAITING_FORMAT'
        GROUP BY i.id ORDER BY min(m.created_at)`,
    );
    for (const r of camelRows(rows)) {
      if (!r.plantIds.some((plantId) => actingRole(user, { permission: P.FORMATS_CREATE, plantId }))) continue;
      tasks.push({
        kind: 'format', entity: 'ITEM', id: r.itemId, docNo: r.itemCode, link: `/formats/items/${r.itemId}`, task: 'Create inspection format',
        itemCode: r.itemCode, itemDescription: r.itemDescription, vendorName: null, note: `${r.lots} lot${r.lots === 1 ? '' : 's'} waiting for it`, since: r.since,
      });
    }
  }

  return tasks.sort((a, b) => new Date(a.since) - new Date(b.since));
}

/** The user's own last workflow steps, newest first, for "Recently done" on the dashboard. */
export async function myRecent(user, limit = 8) {
  const { rows } = await getPool().query(
    `SELECT a.id, a.action, a.at, a.remark, a.imir_id, a.deviation_id, a.dn_id, m.imir_no, d.deviation_no, n.dn_no, i.item_code
       FROM qms.imir_action a JOIN qms.imir m ON m.id = a.imir_id JOIN mst.item i ON i.id = m.item_id
       LEFT JOIN qms.deviation d ON d.id = a.deviation_id LEFT JOIN qms.defect_notification n ON n.id = a.dn_id
      WHERE a.actor_id = $1 ORDER BY a.at DESC, a.id DESC LIMIT $2`,
    [user.id, limit],
  );
  return camelRows(rows).map((r) => ({
    id: r.id, action: r.action, at: r.at, itemCode: r.itemCode,
    docNo: r.dnNo ?? r.deviationNo ?? r.imirNo,
    link: r.dnId ? `/dns/${r.dnId}` : r.deviationId ? `/deviations/${r.deviationId}` : `/imirs/${r.imirId}`,
  }));
}
