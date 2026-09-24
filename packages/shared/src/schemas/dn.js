import { z } from 'zod';
import { booleanQuery, listQuery, optionalTrimmed, rowVersion, trimmed } from './common.js';
import { filterParam } from './listFilter.js';

/** Sprint E: Defect Notification (Incoming variant), CAPA, reports and notifications. */

export const DN_STATUSES = Object.freeze(['OPEN', 'CAPA_SUBMITTED', 'CLOSED']);
/** Vendor shares CAPA within 3 days of the DN date (DN format note). */
export const CAPA_DUE_DAYS = 3;
/** Reminder on the due day, then every 2 days until the CAPA is submitted. */
export const CAPA_REMINDER_EVERY_DAYS = 2;
export const DN_MAX_IMAGES = 4;

const qty = (label) => z.number({ error: `${label} must be a number.` }).min(0, `${label} cannot be negative.`).nullable().optional();

export const dnLineSchema = z.object({
  parameter: trimmed('Parameter', 200),
  specification: optionalTrimmed('Specification', 500),
  observation: optionalTrimmed('Defect observed', 1000),
});

export const dnCreateSchema = z.object({ imirId: z.uuid() });

/** Edits while the DN is open. Quantities: defective ≤ checked ≤ received. */
export const dnUpdateSchema = z
  .object({
    rowVersion,
    model: optionalTrimmed('Model', 60),
    receivedQty: qty('Received qty'),
    checkedQty: qty('Checked qty'),
    defectiveQty: qty('Defective qty'),
    capaApplicable: z.boolean().optional(),
    defect: optionalTrimmed('Defect', 2000),
    correction: optionalTrimmed('Correction', 2000),
    lines: z.array(dnLineSchema).max(50).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.defectiveQty != null && v.checkedQty != null && v.defectiveQty > v.checkedQty) {
      ctx.addIssue({ code: 'custom', path: ['defectiveQty'], message: 'Defective qty cannot exceed checked qty.' });
    }
    if (v.checkedQty != null && v.receivedQty != null && v.checkedQty > v.receivedQty) {
      ctx.addIssue({ code: 'custom', path: ['checkedQty'], message: 'Checked qty cannot exceed received qty.' });
    }
  });

export const capaSchema = z.object({
  rootCause: trimmed('Root cause', 2000),
  correctiveAction: trimmed('Corrective action', 2000),
  targetDate: z.iso.date({ error: 'Enter the target date.' }),
  closingDate: z.iso.date().nullable().optional(),
  responsibility: trimmed('Responsibility', 200),
});

export const dnActionSchema = z.discriminatedUnion('action', [
  // IQC Incharge uploads the vendor's CAPA (or, when CAPA does not apply, sends the DN for closure).
  z.object({ action: z.literal('submit_capa'), rowVersion, remark: optionalTrimmed('Remark', 1000), capa: capaSchema.optional() }),
  // Plant IQC Head
  z.object({ action: z.literal('approve_capa'), rowVersion, remark: optionalTrimmed('Remark', 1000) }),
  z.object({ action: z.literal('resubmit'), rowVersion, remark: trimmed('Reason for resubmission', 1000) }),
]);

export const dnListQuery = listQuery.extend({
  status: z.enum(DN_STATUSES).optional(),
  plantId: z.coerce.number().int().positive().optional(),
  overdue: booleanQuery.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  filter: filterParam.optional(),
});

// ── Reports ──────────────────────────────────────────────────────────────────
export const REPORTS = Object.freeze([
  { key: 'imir-register', name: 'IMIR register', description: 'Every lot received in the period with its result, status, deviation and DN.' },
  { key: 'pending-ageing', name: 'Pending ageing', description: 'Lots not yet closed, by stage and days waiting.' },
  { key: 'vendor-quality', name: 'Vendor quality', description: 'Lots, rejection % and rejected-quantity PPM per vendor.' },
  { key: 'deviation-register', name: 'Deviation register', description: 'Deviations raised in the period with department, action, senior and final decisions.' },
  { key: 'dn-register', name: 'DN / CAPA ageing', description: 'Defect notifications with CAPA status, due date and days open.' },
  { key: 'format-coverage', name: 'Format coverage', description: 'Items received in the period: approved inspection format or not, drafts in progress, lots waiting.' },
  { key: 'tat', name: 'Turnaround by stage', description: 'Hours each lot spent in each stage (lots received in the period), and what is still waiting.' },
]);

export const reportQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  plantId: z.coerce.number().int().positive().optional(),
  format: z.enum(['json', 'xlsx']).default('json'),
});

// ── Notifications ────────────────────────────────────────────────────────────
export const notificationListQuery = z.object({
  unread: booleanQuery.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
