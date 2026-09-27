import { z } from 'zod';
import { ALL_INPUT_TYPES, DEFAULT_INPUT_TYPE, INPUT_TYPE_LABELS, INPUT_TYPES, SECTION_LABELS, SECTIONS } from '../logic/formats.js';
import { listQuery, optionalTrimmed, rowVersion, trimmed } from './common.js';

/** Measurement or limit: up to 3 decimals (blueprint slide 6), within numeric(12,3). */
const limit = z
  .number({ error: 'Enter a number.' })
  .refine((v) => Number.isFinite(v) && Math.abs(v) < 1e9, 'Number is out of range.')
  .refine((v) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6, 'Use at most 3 decimal places.')
  .nullable()
  .optional();

/** An option of a multiple-choice or yes / no field: its text and whether choosing it passes. */
const optionSchema = z.object({ label: trimmed('Option', 60), pass: z.boolean() });

export const checkpointSchema = z
  .object({
    uid: z.uuid().optional(),
    section: z.enum(SECTIONS),
    // Format builder: own section headings, field types, choices, required flag and help text.
    groupLabel: optionalTrimmed('Section name', 60),
    inputType: z.enum(ALL_INPUT_TYPES).nullable().optional(),
    checkpoint: trimmed('Check point', 200),
    specification: optionalTrimmed('Specification', 500),
    nominal: limit,
    lsl: limit,
    usl: limit,
    uom: optionalTrimmed('Unit', 20),
    instrument: optionalTrimmed('Instrument / method', 100),
    frequencyMonths: z.number().int('Whole months only.').min(1, 'At least 1 month.').max(60, 'At most 60 months.').nullable().optional(),
    options: z.array(optionSchema).max(12, 'At most 12 options.').nullable().optional(),
    isRequired: z.boolean().nullable().optional(),
    helpText: optionalTrimmed('Help text', 300),
  })
  .transform((c) => ({ ...c, inputType: c.inputType ?? DEFAULT_INPUT_TYPE[c.section], isRequired: c.isRequired !== false }))
  .superRefine((c, ctx) => {
    const has = (v) => v !== null && v !== undefined;
    const issue = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (!INPUT_TYPES[c.section].includes(c.inputType)) {
      issue('inputType', `${INPUT_TYPE_LABELS[c.inputType] ?? c.inputType} cannot be used in a ${SECTION_LABELS[c.section].toLowerCase()} section.`);
      return;
    }
    const limitsAllowed = c.section === 'DIMENSIONAL' || c.inputType === 'NUMBER';
    if (limitsAllowed) {
      if (c.section === 'DIMENSIONAL' && !has(c.lsl) && !has(c.usl)) issue('lsl', 'Give LSL, USL or both.');
      if (has(c.lsl) && has(c.usl) && c.lsl > c.usl) issue('usl', 'USL must not be below LSL.');
      if (has(c.nominal) && ((has(c.lsl) && c.nominal < c.lsl) || (has(c.usl) && c.nominal > c.usl))) issue('nominal', 'Nominal must lie between LSL and USL.');
    } else {
      for (const f of ['nominal', 'lsl', 'usl']) if (has(c[f])) issue(f, 'Limits apply to measurements and number fields only.');
    }
    // Visual checks and lot tests say what is checked; lot details are self-explanatory (e.g. "Batch no.").
    if ((c.section === 'VISUAL' || c.section === 'RELIABILITY') && !c.specification) issue('specification', 'Describe what is checked.');
    if (c.section !== 'RELIABILITY' && has(c.frequencyMonths)) issue('frequencyMonths', 'Frequency applies to reliability tests only.');

    const choice = c.inputType === 'CHOICE' || c.inputType === 'YES_NO';
    if (choice) {
      const opts = c.options ?? [];
      if (opts.length < 2) issue('options', 'Give at least two options.');
      const labels = opts.map((o) => o.label.toLowerCase());
      if (new Set(labels).size !== labels.length) issue('options', 'Each option must be different.');
      if (opts.length && !opts.some((o) => o.pass)) issue('options', 'Mark at least one option as passing, or every lot fails.');
      if (c.section === 'VISUAL' && opts.length && !opts.some((o) => !o.pass)) issue('options', 'Mark at least one option as failing: a visual check must be able to fail.');
      if (c.inputType === 'YES_NO' && (opts.length !== 2 || labels[0] !== 'yes' || labels[1] !== 'no')) issue('options', 'A yes / no field has the options Yes and No.');
    } else if (c.options?.length) {
      issue('options', 'Options apply to multiple-choice and yes / no fields only.');
    }
  });

const header = {
  formatNo: optionalTrimmed('Format no.', 40),
  commonFormatNo: optionalTrimmed('Common format no.', 40),
  refStandard: optionalTrimmed('Reference standard', 60),
  remarks: optionalTrimmed('Remarks', 1000),
};

/** Saving a draft replaces its whole content. */
export const formatDraftSchema = z
  .object({ ...header, checkpoints: z.array(checkpointSchema).max(300, 'At most 300 checkpoints.'), rowVersion })
  .superRefine((v, ctx) => {
    const uids = v.checkpoints.map((c) => c.uid).filter(Boolean);
    if (new Set(uids).size !== uids.length) ctx.addIssue({ code: 'custom', path: ['checkpoints'], message: 'A checkpoint appears twice.' });
  });

export const FORMAT_DRAFT_SOURCES = Object.freeze(['CURRENT', 'BLANK', 'SAN', 'CLONE', 'CUSTOM']);

export const createDraftSchema = z
  .object({
    from: z.enum(FORMAT_DRAFT_SOURCES),
    vendorCode: z.string().trim().toUpperCase().min(1).max(20).optional(),
    cloneFromVersionId: z.uuid().optional(),
  })
  .refine((v) => v.from !== 'SAN' || v.vendorCode, { message: 'Give the vendor code to fetch from SAN/SIR.', path: ['vendorCode'] })
  .refine((v) => v.from !== 'CLONE' || v.cloneFromVersionId, { message: 'Choose the format to copy.', path: ['cloneFromVersionId'] });

export const formatActionSchema = z
  .object({
    action: z.enum(['submit', 'approve', 'reject', 'discard']),
    remark: optionalTrimmed('Remark', 1000),
    // REPLACE: approve a draft started before any format existed as a replacement of the approved one.
    mode: z.enum(['REPLACE']).optional(),
    rowVersion,
  })
  .refine((v) => v.action !== 'reject' || v.remark, { message: 'Say why the format is rejected.', path: ['remark'] });

export const resolveConflictsSchema = z.object({
  resolutions: z
    .array(z.object({ conflictId: z.number().int().positive(), choice: z.enum(['THEIRS', 'MINE', 'CUSTOM']), value: z.unknown().optional(), remark: optionalTrimmed('Remark', 300) }))
    .min(1),
  rowVersion,
});

export const FORMAT_LIST_STATUSES = Object.freeze(['NONE', 'APPROVED', 'PENDING_APPROVAL', 'CONFLICT', 'DRAFT']);
export const formatListQuery = listQuery.extend({ status: z.enum(FORMAT_LIST_STATUSES).optional() });

export const compareQuery = z.object({ a: z.uuid(), b: z.uuid() });
export const sanLookupQuery = z.object({ vendorCode: z.string().trim().toUpperCase().min(1).max(20), itemCode: z.string().trim().toUpperCase().min(1).max(40) });
