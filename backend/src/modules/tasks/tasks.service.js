import { getPool } from '../../db/pool.js';
import { camelRows } from '../../shared/sql.js';
import * as devRepo from '../deviation/deviation.repo.js';
import { STAGE_LABEL } from '../deviation/deviation.service.js';
import { IMIR_REVIEW_ACTIONS, deviationActions, imirReviewActions } from '../workflow/rules.js';

const REVIEW_STATUSES = [...new Set(Object.values(IMIR_REVIEW_ACTIONS).map((r) => r.from))];
const OPEN_STAGES = ['INITIATOR', 'SUB_HEAD', 'HEAD', 'FINAL', 'SENIOR', 'UNDER_DEVIATION', 'QTY_VERIFICATION'];
const IMIR_TASK = { SUBMITTED: 'Review inspection', WITH_IQC_HEAD: 'Decide on escalated lot' };

/**
 * My Tasks: every IMIR and deviation on which the user can act now. Built from the same rules
 * that authorize the actions, so the inbox never shows a task the user cannot complete.
 */
export async function myTasks(user) {
  const db = getPool();
  const { rows } = await db.query(
    `SELECT m.id, m.imir_no, m.status, m.result, m.plant_id, p.sap_code AS plant_sap_code, i.item_code, i.description AS item_description,
            v.name AS vendor_name, m.submitted_at, m.updated_at
       FROM qms.imir m JOIN core.plant p ON p.id = m.plant_id JOIN mst.item i ON i.id = m.item_id JOIN mst.vendor v ON v.id = m.vendor_id
      WHERE m.status = ANY($1) ORDER BY m.updated_at LIMIT 1000`,
    [REVIEW_STATUSES],
  );
  const imirTasks = camelRows(rows)
    .map((m) => ({ m, actions: imirReviewActions(user, m) }))
    .filter((x) => x.actions.length)
    .map(({ m, actions }) => ({
      entity: 'IMIR', id: m.id, docNo: m.imirNo, task: IMIR_TASK[m.status], status: m.status, result: m.result, actions,
      plantSapCode: m.plantSapCode, itemCode: m.itemCode, itemDescription: m.itemDescription, vendorName: m.vendorName, since: m.updatedAt,
    }));

  const devs = await devRepo.listOpen(db, OPEN_STAGES);
  const rounds = devs.some((d) => d.stage === 'SENIOR') ? await devRepo.rounds(db, devs.filter((d) => d.stage === 'SENIOR').map((d) => d.id)) : [];
  const devTasks = devs
    .map((d) => ({ d, actions: deviationActions(user, d, rounds.filter((r) => r.deviationId === d.id).at(-1) ?? null) }))
    .filter((x) => x.actions.some((a) => a !== 'override')) // overriding is a right, not a task
    .map(({ d, actions }) => ({
      entity: 'DEVIATION', id: d.id, docNo: d.deviationNo, imirNo: d.imirNo, task: STAGE_LABEL[d.stage], stage: d.stage, department: d.department, actions,
      plantSapCode: d.plantSapCode, itemCode: d.itemCode, itemDescription: d.itemDescription, vendorName: d.vendorName, since: d.updatedAt, dueAt: d.qtyDueAt,
    }));

  return [...imirTasks, ...devTasks].sort((a, b) => new Date(a.since) - new Date(b.since));
}
