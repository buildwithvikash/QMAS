import { describe, expect, it } from 'vitest';
import { checkpointSchema } from '../schemas/formats.js';
import { diffVersions, isEmptyDiff, mergeVersions, parseSpec, renumber, submitProblems } from './formats.js';

const cp = (uid, over = {}) => ({ uid, section: 'DIMENSIONAL', seq: 1, checkpoint: 'Dimensions', specification: '57 ± 0.3', nominal: 57, lsl: 56.7, usl: 57.3, uom: 'mm', instrument: 'DVC', frequencyMonths: null, ...over });
const version = (checkpoints, header = { formatNo: 'F-1', commonFormatNo: null, refStandard: 'IS 2500' }) => ({ header, checkpoints });

describe('parseSpec', () => {
  it.each([
    ['57 ± 0.3', { nominal: 57, lsl: 56.7, usl: 57.3 }],
    ['22.2±0.2', { nominal: 22.2, lsl: 22, usl: 22.4 }],
    ['90 +/- 0.5', { nominal: 90, lsl: 89.5, usl: 90.5 }],
    ['337 +1 / -2', { nominal: 337, lsl: 335, usl: 338 }],
    ['337 -2 +1', { nominal: 337, lsl: 335, usl: 338 }],
    ['56.7 - 57.3', { nominal: null, lsl: 56.7, usl: 57.3 }],
    ['56.7 to 57.3', { nominal: null, lsl: 56.7, usl: 57.3 }],
    ['<2', { nominal: null, lsl: null, usl: 2 }],
    ['max 2', { nominal: null, lsl: null, usl: 2 }],
    ['>0.05', { nominal: null, lsl: 0.05, usl: null }],
    ['≥ 0.05', { nominal: null, lsl: 0.05, usl: null }],
  ])('%s', (text, expected) => {
    expect(parseSpec(text)).toEqual(expected);
  });

  it('returns null for text it cannot read', () => {
    expect(parseSpec('=R5')).toBeNull();
    expect(parseSpec('Free from dust, rust, oil')).toBeNull();
    expect(parseSpec('90')).toBeNull();
    expect(parseSpec(null)).toBeNull();
  });
});

describe('diffVersions', () => {
  it('reports header, added, removed, changed and moved separately', () => {
    const a = version([cp('a'), cp('b', { seq: 2 })]);
    const b = version([cp('b', { seq: 1, usl: '57.400' }), cp('c', { seq: 2 })], { formatNo: 'F-2', commonFormatNo: null, refStandard: 'IS 2500' });
    const d = diffVersions(a, b);
    expect(d.header).toEqual([{ field: 'formatNo', from: 'F-1', to: 'F-2' }]);
    expect(d.added.map((c) => c.uid)).toEqual(['c']);
    expect(d.removed.map((c) => c.uid)).toEqual(['a']);
    expect(d.changed).toEqual([{ uid: 'b', checkpoint: 'Dimensions', fields: [{ field: 'usl', from: 57.3, to: '57.400' }] }]);
    expect(d.moved).toEqual(['b']);
  });

  it('treats "57.300" and 57.3, and "" and null, as equal', () => {
    const d = diffVersions(version([cp('a', { lsl: '56.700', uom: '' })]), version([cp('a', { lsl: 56.7, uom: null })]));
    expect(d.changed).toEqual([]);
  });

  it('isEmptyDiff ignores pure reordering', () => {
    expect(isEmptyDiff(diffVersions(version([cp('a', { seq: 1 }), cp('b', { seq: 2 })]), version([cp('a', { seq: 2 }), cp('b', { seq: 1 })])))).toBe(true);
  });
});

describe('mergeVersions (Git-style)', () => {
  const base = version([cp('d2', { seq: 1, usl: 22.4 }), cp('d5', { seq: 2, usl: 90.5 }), cp('v1', { section: 'VISUAL', seq: 1, specification: 'Free from rust', nominal: null, lsl: null, usl: null })]);

  it('takes each side\'s own changes when they touch different fields or checkpoints', () => {
    const theirs = version([cp('d2', { seq: 1, usl: 22.5 }), base.checkpoints[1], base.checkpoints[2]]);
    const mine = version([base.checkpoints[0], cp('d5', { seq: 2, usl: 90.5, instrument: 'Bevel protractor' }), base.checkpoints[2]]);
    const { merged, conflicts } = mergeVersions(base, theirs, mine);
    expect(conflicts).toEqual([]);
    expect(merged.checkpoints.find((c) => c.uid === 'd2').usl).toBe(22.5);
    expect(merged.checkpoints.find((c) => c.uid === 'd5').instrument).toBe('Bevel protractor');
  });

  it('flags the same field changed differently on both sides (the blueprint "Dim 5" case)', () => {
    const theirs = version([base.checkpoints[0], cp('d5', { seq: 2, usl: 90.6 }), base.checkpoints[2]]);
    const mine = version([base.checkpoints[0], cp('d5', { seq: 2, usl: 90.4 }), base.checkpoints[2]]);
    const { conflicts } = mergeVersions(base, theirs, mine);
    expect(conflicts).toEqual([{ uid: 'd5', field: 'usl', base: 90.5, theirs: 90.6, mine: 90.4, checkpoint: 'Dimensions' }]);
  });

  it('does not conflict when both sides made the same change', () => {
    const change = cp('d5', { seq: 2, usl: 90.6 });
    const { conflicts, merged } = mergeVersions(base, version([base.checkpoints[0], change, base.checkpoints[2]]), version([base.checkpoints[0], change, base.checkpoints[2]]));
    expect(conflicts).toEqual([]);
    expect(merged.checkpoints.find((c) => c.uid === 'd5').usl).toBe(90.6);
  });

  it('keeps additions from both sides and renumbers per section', () => {
    const theirs = version([...base.checkpoints, cp('t-new', { seq: 3, checkpoint: 'Angle' })]);
    const mine = version([...base.checkpoints, cp('m-new', { section: 'VISUAL', seq: 2, checkpoint: 'Weld', specification: 'Ground', nominal: null, lsl: null, usl: null })]);
    const { merged, conflicts } = mergeVersions(base, theirs, mine);
    expect(conflicts).toEqual([]);
    expect(merged.checkpoints.map((c) => [c.uid, c.section, c.seq])).toEqual([
      ['d2', 'DIMENSIONAL', 1], ['d5', 'DIMENSIONAL', 2], ['v1', 'VISUAL', 1], ['m-new', 'VISUAL', 2], ['t-new', 'DIMENSIONAL', 3],
    ]);
  });

  it('drops a checkpoint deleted on one side if the other side left it alone', () => {
    const mine = version([base.checkpoints[0], base.checkpoints[2]]);
    const { merged, conflicts } = mergeVersions(base, base, mine);
    expect(conflicts).toEqual([]);
    expect(merged.checkpoints.map((c) => c.uid)).toEqual(['d2', 'v1']);
  });

  it('flags delete-versus-edit, and resolves it either way', () => {
    const theirs = version([base.checkpoints[0], cp('d5', { seq: 2, usl: 91 }), base.checkpoints[2]]);
    const mine = version([base.checkpoints[0], base.checkpoints[2]]);
    const first = mergeVersions(base, theirs, mine);
    expect(first.conflicts).toEqual([{ uid: 'd5', field: '_presence', base: true, theirs: true, mine: false, checkpoint: 'Dimensions' }]);
    expect(mergeVersions(base, theirs, mine, { 'd5|_presence': false }).merged.checkpoints.map((c) => c.uid)).toEqual(['d2', 'v1']);
    const kept = mergeVersions(base, theirs, mine, { 'd5|_presence': true });
    expect(kept.conflicts).toEqual([]);
    expect(kept.merged.checkpoints.find((c) => c.uid === 'd5').usl).toBe(91);
  });

  it('applies resolutions for field and header conflicts', () => {
    const theirs = version([base.checkpoints[0], cp('d5', { seq: 2, usl: 90.6 }), base.checkpoints[2]], { formatNo: 'F-2', commonFormatNo: null, refStandard: 'IS 2500' });
    const mine = version([base.checkpoints[0], cp('d5', { seq: 2, usl: 90.4 }), base.checkpoints[2]], { formatNo: 'F-9', commonFormatNo: null, refStandard: 'IS 2500' });
    const { merged, conflicts } = mergeVersions(base, theirs, mine, { 'd5|usl': 90.45, '|formatNo': 'F-9' });
    expect(conflicts).toEqual([]);
    expect(merged.header.formatNo).toBe('F-9');
    expect(merged.checkpoints.find((c) => c.uid === 'd5').usl).toBe(90.45);
  });

  it('fast-forwards cleanly when nothing changed on the approved side', () => {
    const mine = version([cp('d2', { seq: 1, usl: 22.3 })]);
    const { merged, conflicts } = mergeVersions(base, base, mine);
    expect(conflicts).toEqual([]);
    expect(merged.checkpoints).toHaveLength(1);
  });
});

describe('renumber and submit checks', () => {
  it('renumbers within each section', () => {
    expect(renumber([cp('a'), cp('b', { section: 'VISUAL' }), cp('c')]).map((c) => c.seq)).toEqual([1, 1, 2]);
  });

  it('allows repeated names with different requirements but not exact duplicates', () => {
    expect(submitProblems(version([cp('a'), cp('b', { usl: 57.4 })]))).toEqual([]);
    expect(submitProblems(version([cp('a'), cp('b')]))).toEqual(['Dimensional: "Dimensions" appears twice with the same requirement.']);
    expect(submitProblems(version([]))).toEqual(['Add at least one checkpoint before submitting.']);
  });
});

describe('checkpointSchema', () => {
  const issues = (c) => {
    const r = checkpointSchema.safeParse(c);
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  };
  it('requires limits on dimensional checkpoints and keeps them in order', () => {
    expect(issues({ section: 'DIMENSIONAL', checkpoint: 'Dia', lsl: null, usl: null })).toEqual(['lsl: Give LSL, USL or both.']);
    expect(issues({ section: 'DIMENSIONAL', checkpoint: 'Dia', lsl: 5, usl: 4 })).toEqual(['usl: USL must not be below LSL.']);
    expect(issues({ section: 'DIMENSIONAL', checkpoint: 'Dia', nominal: 9, lsl: 4, usl: 5 })).toEqual(['nominal: Nominal must lie between LSL and USL.']);
    expect(issues({ section: 'DIMENSIONAL', checkpoint: 'Dia', lsl: 1.2345 })).toEqual(['lsl: Use at most 3 decimal places.']);
    expect(issues({ section: 'DIMENSIONAL', checkpoint: 'Film', lsl: 0.05 })).toEqual([]);
  });
  it('requires a description for visual and reliability checks and keeps frequency to reliability', () => {
    expect(issues({ section: 'VISUAL', checkpoint: 'Aesthetic' })).toEqual(['specification: Describe what is checked.']);
    expect(issues({ section: 'VISUAL', checkpoint: 'Aesthetic', specification: 'No burr', frequencyMonths: 6 })).toEqual(['frequencyMonths: Frequency applies to reliability tests only.']);
    expect(issues({ section: 'RELIABILITY', checkpoint: 'Static load', specification: '200 kg', frequencyMonths: 6 })).toEqual([]);
  });
});
