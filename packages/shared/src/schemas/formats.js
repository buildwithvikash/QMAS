import { z } from 'zod';
import { SECTIONS } from '../logic/formats.js';
import { listQuery, optionalTrimmed, rowVersion, trimmed } from './common.js';

/** Measurement or limit: up to 3 decimals (blueprint slide 6), within numeric(12,3). */
const limit = z
  .number({ error: 'Enter a number.' })
  .refine((v) => Number.isFinite(v) && Math.abs(v) < 1e9, 'Number is out of range.')
  .refine((v) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6, 'Use at most 3 decimal places.')
  .nullable()
  .optional();

export const checkpointSchema = z
  .object({
    uid: z.uuid().optional(),
    section: z.enum(SECTIONS),
    checkpoint: trimmed('Check point', 200),
    specification: optionalTrimmed('Specification', 500),
    nominal: limit,
    lsl: limit,
    usl: limit,
    uom: optionalTrimmed('Unit', 20),
    instrument: optionalTrimmed('Instrument / method', 100),
    frequencyMonths: z.number().int('Whole months only.').min(1, 'At least 1 month.').max(60, 'At most 60 months.').nullable().optional(),
  })
  .superRefine((c, ctx) => {
    const has = (v) => v !== null && v !== undefined;
    if (c.section === 'DIMENSIONAL') {
      if (!has(c.lsl) && !has(c.usl)) ctx.addIssue({ code: 'custom', path: ['lsl'], message: 'Give LSL, USL or both.' });
      if (has(c.lsl) && has(c.usl) && c.lsl > c.usl) ctx.addIssue({ code: 'custom', path: ['usl'], message: 'USL must not be below LSL.' });
      if (has(c.nominal) && ((has(c.lsl) && c.nominal < c.lsl) || (has(c.usl) && c.nominal > c.usl))) {
        ctx.addIssue({ code: 'custom', path: ['nominal'], message: 'Nominal must lie between LSL and USL.' });
      }
    } else {
      if (!c.specification) ctx.addIssue({ code: 'custom', path: ['specification'], message: 'Describe what is checked.' });
      for (const f of ['nominal', 'lsl', 'usl']) {
        if (has(c[f])) ctx.addIssue({ code: 'custom', path: [f], message: 'Limits apply to dimensional checkpoints only.' });
      }
    }
    if (c.section !== 'RELIABILITY' && has(c.frequencyMonths)) {
      ctx.addIssue({ code: 'custom', path: ['frequencyMonths'], message: 'Frequency applies to reliability tests only.' });
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

export const FORMAT_DRAFT_SOURCES = Object.freeze(['CURRENT', 'BLANK', 'SAN', 'CLONE']);

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
    .array(z.object({ conflictId: z.number().int().positive(), choice: z.enum(['THEIRS', 'MINE', 'CUSTOM']), value: z.unknown().optional() }))
    .min(1),
  rowVersion,
});

export const FORMAT_LIST_STATUSES = Object.freeze(['NONE', 'APPROVED', 'PENDING_APPROVAL', 'CONFLICT', 'DRAFT']);
export const formatListQuery = listQuery.extend({ status: z.enum(FORMAT_LIST_STATUSES).optional() });

export const compareQuery = z.object({ a: z.uuid(), b: z.uuid() });
export const sanLookupQuery = z.object({ vendorCode: z.string().trim().toUpperCase().min(1).max(20), itemCode: z.string().trim().toUpperCase().min(1).max(40) });
