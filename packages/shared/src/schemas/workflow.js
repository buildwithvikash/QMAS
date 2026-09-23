import { z } from 'zod';
import { ESCALATION_RANKS } from '../constants/roles.js';
import { SENIOR_DECISIONS } from '../logic/escalation.js';
import { listQuery, optionalTrimmed, rowVersion, trimmed } from './common.js';

/** Sprint D: review of a submitted IMIR, the deviation track and senior escalation. */

export const DEPARTMENTS = Object.freeze(['SCM', 'VD']);
export const DEVIATION_ACTION_CODES = Object.freeze(['UAI', 'SEGREGATION', 'REWORK']);
export const DEVIATION_STAGES = Object.freeze(['INITIATOR', 'SUB_HEAD', 'HEAD', 'FINAL', 'SENIOR', 'UNDER_DEVIATION', 'QTY_VERIFICATION', 'CLOSED']);
export const APPROVAL_LEVELS = Object.freeze(['SUB_HEAD', 'HEAD']);
/** Days the department has to enter OK / Not-OK quantities before the deviation closes itself. */
export const QTY_DUE_DAYS = 14;

const remark = (label = 'Remark') => trimmed(label, 1000);
const checkpointRemarks = z
  .array(z.object({ checkpointUid: z.uuid(), remark: optionalTrimmed('Checkpoint remark', 500) }))
  .max(500)
  .default([]);

/** POST /imirs/:id/actions. `submit` is the inspector's; the rest are Incharge and IQC Head decisions. */
export const imirActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('submit'), rowVersion, deviceId: z.uuid().optional() }),
  // IQC Incharge (slide 7)
  z.object({ action: z.literal('approve'), rowVersion, remark: optionalTrimmed('Remark', 1000), checkpointRemarks }),
  z.object({ action: z.literal('revert'), rowVersion, remark: remark('Reason for sending back'), checkpointRemarks }),
  z.object({ action: z.literal('escalate'), rowVersion, remark: remark('Non-conformance remark'), checkpointRemarks }),
  // Plant IQC Head (slide 8)
  z.object({ action: z.literal('head_approve'), rowVersion, remark: remark() }),
  z.object({
    action: z.literal('hold'),
    rowVersion,
    remark: remark('Hold remark'),
    department: z.enum(DEPARTMENTS, { error: 'Choose SCM or VD.' }),
    suggestedActions: z.array(z.enum(DEVIATION_ACTION_CODES)).min(1, 'Suggest at least one action.').max(3).transform((a) => [...new Set(a)]),
  }),
]);

const seniorRole = z.enum(ESCALATION_RANKS.map((r) => r.roleCode));

export const deviationFormSchema = z.object({
  severity: z.enum(['MINOR', 'MAJOR', 'CRITICAL'], { error: 'Choose Minor, Major or Critical.' }),
  action: z.enum(DEVIATION_ACTION_CODES, { error: 'Choose the deviation action.' }),
  deviationQty: z.number({ error: 'Enter the deviation quantity.' }).positive('Deviation quantity must be more than zero.'),
  specification: optionalTrimmed('Specification', 2000),
  iqcObservation: optionalTrimmed('IQC observation', 2000),
  correction: trimmed('Correction', 2000),
  correctiveAction: trimmed('Corrective action', 2000),
});

const qty = (label) => z.number({ error: `Enter the ${label}.` }).min(0, `${label} cannot be negative.`);

/** POST /deviations/:id/actions */
export const deviationActionSchema = z.discriminatedUnion('action', [
  // SCM / VD initiator
  z.object({ action: z.literal('submit_form'), rowVersion, remark: optionalTrimmed('Remark', 1000), form: deviationFormSchema }),
  z.object({ action: z.literal('recommend_reject'), rowVersion, remark: remark('Reason') }),
  // SCM / VD Sub-Head, Head
  z.object({ action: z.literal('dept_approve'), rowVersion, remark: optionalTrimmed('Remark', 1000) }),
  z.object({ action: z.literal('send_back'), rowVersion, remark: remark('Reason for sending back') }),
  z.object({ action: z.literal('dept_reject'), rowVersion, remark: remark('Reason for rejecting') }),
  // Plant IQC Head final decision
  z.object({ action: z.literal('final_approve'), rowVersion, remark: remark() }),
  z.object({ action: z.literal('final_reject'), rowVersion, remark: remark() }),
  z.object({
    action: z.literal('escalate'),
    rowVersion,
    remark: remark('Escalation remark'),
    authorities: z.array(seniorRole).min(1, 'Choose at least one authority.').max(5).transform((a) => [...new Set(a)]),
  }),
  // Senior authorities
  z.object({ action: z.literal('senior_decide'), decision: z.enum(SENIOR_DECISIONS), remark: remark(), roleCode: seniorRole.optional() }),
  z.object({ action: z.literal('override'), decision: z.enum(['APPROVE', 'REJECT']), remark: remark('Reason for the override') }),
  // Quantities after an approved Segregation / Rework
  z.object({ action: z.literal('enter_qty'), rowVersion, okQty: qty('OK quantity'), notOkQty: qty('Not-OK quantity'), remark: optionalTrimmed('Remark', 1000) }),
  z.object({ action: z.literal('verify_qty'), rowVersion, remark: optionalTrimmed('Remark', 1000) }),
  z.object({ action: z.literal('return_qty'), rowVersion, remark: remark('Reason for returning') }),
]);

export const deviationListQuery = listQuery.extend({
  stage: z.enum(DEVIATION_STAGES).optional(),
  open: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  department: z.enum(DEPARTMENTS).optional(),
  plantId: z.coerce.number().int().positive().optional(),
});

export const deptApprovalChainSchema = z.object({
  levels: z
    .array(z.enum(APPROVAL_LEVELS))
    .min(1, 'Keep at least one approval level.')
    .refine((l) => new Set(l).size === l.length, 'A level can appear only once.')
    .refine((l) => l.length < 2 || l[0] === 'SUB_HEAD', 'Sub-Head approves before Head.'),
  rowVersion,
});
