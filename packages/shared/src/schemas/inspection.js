import { z } from 'zod';
import { MAX_SAMPLES } from '../logic/inspection.js';
import { listQuery, optionalTrimmed, rowVersion, trimmed } from './common.js';
import { filterParam } from './listFilter.js';

const reading = z
  .number({ error: 'Enter a number.' })
  .refine((v) => Number.isFinite(v) && Math.abs(v) < 1e9, 'Number is out of range.')
  .refine((v) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6, 'Use at most 3 decimal places.');

/** One sample cell. Send value (dimensional) or ok (visual); null clears the cell. */
export const observationCellSchema = z.object({
  checkpointUid: z.uuid(),
  sampleNo: z.number().int().min(1).max(MAX_SAMPLES),
  value: reading.nullable().optional(),
  ok: z.boolean().nullable().optional(),
});

/** Per-checkpoint inspector entries: remark for any section; text + manual result for reliability. */
export const checkpointEntrySchema = z.object({
  checkpointUid: z.uuid(),
  inspectorRemark: optionalTrimmed('Remark', 500),
  textObservation: optionalTrimmed('Observation', 2000),
  manualResult: z.enum(['OK', 'NOK']).nullable().optional(),
});

/**
 * Autosave of inspection progress. Only the cells and entries sent are changed, so a tablet can
 * save each cell as it is typed. Model is captured by the inspector (Decision B-19).
 */
export const inspectionSaveSchema = z.object({
  model: optionalTrimmed('Model', 60),
  inspectorRemark: optionalTrimmed('Final remarks', 1000),
  cells: z.array(observationCellSchema).max(3000).default([]),
  entries: z.array(checkpointEntrySchema).max(500).default([]),
  deviceId: z.uuid().optional(),
});

export const IMIR_STATUSES = Object.freeze([
  'AWAITING_FORMAT', 'OPEN', 'IN_INSPECTION', 'SUBMITTED', 'WITH_IQC_HEAD', 'DEPT_REVIEW', 'IQC_HEAD_FINAL', 'SENIOR_ESCALATION',
  'UNDER_DEVIATION', 'QTY_VERIFICATION', 'CLOSED_ACCEPTED', 'CLOSED_REJECTED', 'CLOSED_UNDER_DEVIATION', 'AUTO_CLOSED',
]);

export const imirListQuery = listQuery.extend({
  status: z.enum(IMIR_STATUSES).optional(),
  statusGroup: z.enum(['TO_INSPECT', 'IN_REVIEW', 'CLOSED', 'AWAITING_FORMAT']).optional(),
  plantId: z.coerce.number().int().positive().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  filter: filterParam.optional(),
});

// ── Devices and offline sync ─────────────────────────────────────────────────
const deviceShape = {
  deviceCode: trimmed('Device code', 30).transform((v) => v.toUpperCase()).pipe(z.string().regex(/^[A-Z0-9-]+$/, 'Use letters, digits and dashes.')),
  name: trimmed('Name', 80),
  plantId: z.number().int().positive(),
};
export const deviceCreateSchema = z.object(deviceShape);
export const deviceUpdateSchema = z.object({ name: trimmed('Name', 80).optional(), isActive: z.boolean().optional(), rowVersion });

export const checkoutSchema = z.object({ deviceId: z.uuid(), imirIds: z.array(z.uuid()).min(1).max(50) });
export const releaseSchema = z.object({ deviceId: z.uuid().optional(), imirIds: z.array(z.uuid()).min(1).max(50) });

/** Operations queued on a tablet while offline; opId makes a replay harmless. */
export const syncPushSchema = z.object({
  deviceId: z.uuid(),
  ops: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ opId: z.uuid(), type: z.literal('SAVE'), imirId: z.uuid(), clientTime: z.iso.datetime({ offset: true }), recordedBy: z.uuid().optional(), payload: inspectionSaveSchema.omit({ deviceId: true }) }),
        z.object({ opId: z.uuid(), type: z.literal('SUBMIT'), imirId: z.uuid(), clientTime: z.iso.datetime({ offset: true }), recordedBy: z.uuid().optional(), payload: z.object({ rowVersion: z.number().int().min(1).optional() }).default({}) }),
      ]),
    )
    .min(1)
    .max(200),
});

export const sapMockLotSchema = z.object({
  plantSapCode: z.string().regex(/^\d{4}$/, 'SAP plant code is 4 digits.'),
  itemCode: trimmed('Item code', 40).transform((v) => v.toUpperCase()),
  itemDescription: trimmed('Item description', 250),
  itemCategory: optionalTrimmed('Item category', 100),
  uom: trimmed('UOM', 20).transform((v) => v.toUpperCase()),
  vendorCode: trimmed('Vendor code', 20).transform((v) => v.toUpperCase()),
  vendorName: trimmed('Vendor name', 160),
  grnNo: trimmed('GRN no.', 30),
  grnDate: z.iso.date(),
  invoiceNo: trimmed('Invoice no.', 40),
  inwardQty: z.number().positive('Inward quantity must be more than zero.'),
});
