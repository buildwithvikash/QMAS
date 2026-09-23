import { z } from 'zod';
import { DOC_TYPES, DN_SOURCES, RESET_SCOPES } from '../constants/enums.js';
import { validatePattern } from '../logic/numbering.js';
import { validateSamplingRows } from '../logic/sampling.js';
import { code, optionalTrimmed, rowVersion, trimmed } from './common.js';

// No .default() in these shapes: zod applies defaults even inside .partial(), which would make a
// PATCH silently overwrite omitted fields. Column defaults live in the database instead.
const withVersion = (shape) => z.object(shape).partial().extend({ rowVersion });

// ── Plants ────────────────────────────────────────────────────────────────────
const plantShape = {
  sapCode: trimmed('SAP plant code', 4).pipe(z.string().regex(/^\d{4}$/, 'SAP plant code must be 4 digits.')),
  shortCode: trimmed('Short code', 2).pipe(z.string().regex(/^\d{2}$/, 'Short code must be 2 digits.')),
  name: trimmed('Plant name', 80),
  isActive: z.boolean().optional(),
};
export const plantCreateSchema = z.object(plantShape);
export const plantUpdateSchema = withVersion(plantShape);

// ── Simple code/name lookups (UOM, instrument, item category) ────────────────
const lookupShape = { code: code('Code', 20), name: trimmed('Name', 100), isActive: z.boolean().optional() };
export const lookupCreateSchema = z.object(lookupShape);
export const lookupUpdateSchema = withVersion(lookupShape);

// ── Vendors ───────────────────────────────────────────────────────────────────
const vendorShape = {
  vendorCode: code('Vendor code', 20),
  name: trimmed('Vendor name', 160),
  isActive: z.boolean().optional(),
};
export const vendorCreateSchema = z.object(vendorShape);
export const vendorUpdateSchema = withVersion(vendorShape);

// ── Items ─────────────────────────────────────────────────────────────────────
const itemShape = {
  itemCode: code('Item code', 40),
  description: trimmed('Item description', 250),
  categoryId: z.number().int().positive().nullable().optional(),
  uomId: z.number().int().positive().nullable().optional(),
  drawingNo: optionalTrimmed('Drawing number', 60),
  drawingRev: optionalTrimmed('Drawing revision', 20),
  isActive: z.boolean().optional(),
};
export const itemCreateSchema = z.object(itemShape);
export const itemUpdateSchema = withVersion(itemShape);

// ── Sampling table ────────────────────────────────────────────────────────────
const intOrNull = z.number().int().nullable().default(null);
export const samplingRowSchema = z.object({
  lotMin: z.number().int(),
  lotMax: intOrNull,
  sampleSize: z.number().int(),
  acceptNo: intOrNull,
  rejectNo: intOrNull,
});

const samplingPlanShape = {
  code: code('Plan code', 20),
  name: trimmed('Plan name', 100),
  description: optionalTrimmed('Description', 500),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
};

const checkRows = (value, ctx) => {
  if (!value.rows) return;
  for (const message of validateSamplingRows(value.rows).errors) ctx.addIssue({ code: 'custom', message, path: ['rows'] });
};

export const samplingPlanCreateSchema = z.object({ ...samplingPlanShape, rows: z.array(samplingRowSchema).min(1).max(50) }).superRefine(checkRows);
export const samplingPlanUpdateSchema = withVersion({ ...samplingPlanShape, rows: z.array(samplingRowSchema).min(1).max(50) }).superRefine(checkRows);
export const samplingLookupQuery = z.object({ inwardQty: z.coerce.number().positive('Inward quantity must be greater than zero.') });

// ── Number series ─────────────────────────────────────────────────────────────
export const numberSeriesCreateSchema = z
  .object({
    docType: z.enum(DOC_TYPES),
    plantId: z.number().int().positive().nullable().optional(),
    pattern: trimmed('Pattern', 80).transform((v) => v.toUpperCase()),
    resetScope: z.enum(RESET_SCOPES),
    effectiveFrom: z.iso.datetime({ offset: true, error: 'Use an ISO date-time.' }).optional(),
    remarks: optionalTrimmed('Remarks', 300),
  })
  .superRefine((v, ctx) => {
    for (const message of validatePattern(v.pattern, v.resetScope, v.docType)) ctx.addIssue({ code: 'custom', message, path: ['pattern'] });
  });

export const numberSeriesPreviewSchema = z
  .object({
    docType: z.enum(DOC_TYPES),
    plantId: z.number().int().positive(),
    src: z.enum(Object.keys(DN_SOURCES)).optional(),
    pattern: trimmed('Pattern', 80).transform((v) => v.toUpperCase()).optional(),
    resetScope: z.enum(RESET_SCOPES).optional(),
    date: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((v) => (v.pattern === undefined) === (v.resetScope === undefined), {
    message: 'Give both pattern and reset scope to preview a draft, or neither to preview the active series.',
    path: ['pattern'],
  });

export const numberSeriesStatusSchema = z.object({ isActive: z.boolean(), rowVersion });
