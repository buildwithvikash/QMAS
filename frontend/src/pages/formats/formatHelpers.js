import { DISPLAY_SECTIONS, FIELD_LABELS, INPUT_TYPE_LABELS, SECTION_LABELS } from '@qmas/shared';

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
export const SOURCE = { NEW: 'Created new', CURRENT: 'From current version', SAN: 'From SAN/SIR', CLONE: 'Copied', PRE_FED: 'Imported', CUSTOM: 'Custom (builder)' };

export const fmtNum = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));
export const fmtOptions = (options) => (Array.isArray(options) && options.length ? options.map((o) => `${o.label}${o.pass === false ? ' ✗' : ' ✓'}`).join(' / ') : '');
export const fmtValue = (field, v) => {
  if (field === '_presence') return v ? 'Keep checkpoint' : 'Remove checkpoint';
  if (field === 'isRequired') return v === false ? 'Optional' : 'Required';
  if (v === null || v === undefined || v === '') return '(empty)';
  if (['nominal', 'lsl', 'usl'].includes(field)) return fmtNum(v);
  if (field === 'frequencyMonths') return `every ${v} month${Number(v) === 1 ? '' : 's'}`;
  if (field === 'inputType') return INPUT_TYPE_LABELS[v] ?? v;
  if (field === 'section') return SECTION_LABELS[v] ?? v;
  if (field === 'options') return fmtOptions(v);
  return String(v);
};
export const fieldLabel = (f) => FIELD_LABELS[f] ?? f;

const COLUMNS = {
  RECORD: ['checkpoint', 'inputType', 'rule', 'isRequired', 'helpText'],
  DIMENSIONAL: ['checkpoint', 'specification', 'nominal', 'lsl', 'usl', 'uom', 'instrument'],
  VISUAL: ['checkpoint', 'specification', 'inputType', 'instrument'],
  RELIABILITY: ['checkpoint', 'specification', 'uom', 'instrument', 'frequencyMonths'],
};
export const sectionColumns = (section) => COLUMNS[section];

/** What a lot detail or choice check accepts, in words ("1.9 – 2.1 kg", "Pass: Yes"). */
export function ruleText(c) {
  if (c.inputType === 'NUMBER') {
    const lim = c.lsl !== null && c.lsl !== undefined && c.lsl !== '' ? (c.usl !== null && c.usl !== undefined && c.usl !== '' ? `${fmtNum(c.lsl)} – ${fmtNum(c.usl)}` : `min ${fmtNum(c.lsl)}`) : c.usl !== null && c.usl !== undefined && c.usl !== '' ? `max ${fmtNum(c.usl)}` : 'any number';
    return `${lim}${c.uom ? ` ${c.uom}` : ''}`;
  }
  if (c.inputType === 'CHOICE' || c.inputType === 'YES_NO') {
    const opts = c.options ?? [];
    return opts.some((o) => o.pass === false) ? `Pass: ${opts.filter((o) => o.pass !== false).map((o) => o.label).join(' / ')}` : `Any of ${opts.map((o) => o.label).join(' / ')}`;
  }
  if (c.inputType === 'DATE') return 'A date';
  return c.specification || 'Free text';
}

/**
 * The checkpoints of a version grouped the way the inspection sheet shows them: sections in display
 * order, each split by its custom heading. [{ key, section, label, items }]
 */
export function groupCheckpoints(checkpoints) {
  const out = [];
  for (const section of DISPLAY_SECTIONS) {
    for (const c of checkpoints.filter((x) => x.section === section)) {
      const label = c.groupLabel || SECTION_LABELS[section];
      const key = `${section}|${label}`;
      const g = out.find((x) => x.key === key);
      if (g) g.items.push(c);
      else out.push({ key, section, label, custom: !!c.groupLabel, items: [c] });
    }
  }
  return out;
}
