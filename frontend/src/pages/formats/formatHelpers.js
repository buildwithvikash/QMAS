import { FIELD_LABELS } from '@qmas/shared';

/** Display helpers shared by the format pages. */
export const STATUS = {
  DRAFT: ['Draft', 'neutral'],
  REJECTED: ['Returned', 'warning'],
  PENDING_APPROVAL: ['Pending approval', 'info'],
  CONFLICT: ['Merge conflict', 'danger'],
  APPROVED: ['Approved', 'success'],
  SUPERSEDED: ['Superseded', 'neutral'],
  DISCARDED: ['Discarded', 'neutral'],
};
export const SOURCE = { NEW: 'Created new', CURRENT: 'From current version', SAN: 'From SAN/SIR', CLONE: 'Copied', PRE_FED: 'Imported' };

export const fmtNum = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
export const fmtValue = (field, v) => {
  if (field === '_presence') return v ? 'Keep checkpoint' : 'Remove checkpoint';
  if (v === null || v === undefined || v === '') return '(empty)';
  if (['nominal', 'lsl', 'usl'].includes(field)) return fmtNum(v);
  if (field === 'frequencyMonths') return `every ${v} month${Number(v) === 1 ? '' : 's'}`;
  return String(v);
};
export const fieldLabel = (f) => FIELD_LABELS[f] ?? f;

const COLUMNS = {
  DIMENSIONAL: ['checkpoint', 'specification', 'nominal', 'lsl', 'usl', 'uom', 'instrument'],
  VISUAL: ['checkpoint', 'specification', 'instrument'],
  RELIABILITY: ['checkpoint', 'specification', 'uom', 'instrument', 'frequencyMonths'],
};
export const sectionColumns = (section) => COLUMNS[section];
