import { describe, expect, it } from 'vitest';
import { checkpointSchema } from '../schemas/formats.js';
import { diffVersions, submitProblems, yesNoOptions } from './formats.js';
import { cellDecision, evaluateInspection, recordDecision } from './inspection.js';

/** Format builder: custom sections, field types, and how they count towards the lot result. */

const SHADE = { uid: 'c1', section: 'VISUAL', inputType: 'CHOICE', options: [{ label: 'Matches', pass: true }, { label: 'Slight', pass: true }, { label: 'Mismatch', pass: false }] };
const TC = { uid: 'r1', section: 'RECORD', inputType: 'YES_NO', options: yesNoOptions('YES'), isRequired: true };
const WEIGHT = { uid: 'r2', section: 'RECORD', inputType: 'NUMBER', lsl: 1.9, usl: 2.1, isRequired: true };
const BATCH = { uid: 'r3', section: 'RECORD', inputType: 'TEXT', isRequired: true };
const NOTE = { uid: 'r4', section: 'RECORD', inputType: 'TEXT', isRequired: false };
const sampling = { sampleSize: 2, acceptNo: 0, rejectNo: 1 };

describe('field decisions', () => {
  it('decides a visual choice by the option picked', () => {
    expect(cellDecision(SHADE, { value: 0 })).toBe('OK');
    expect(cellDecision(SHADE, { value: 2 })).toBe('NOK');
    expect(cellDecision(SHADE, { value: 7 })).toBeNull();
    expect(cellDecision(SHADE, { value: null })).toBeNull();
  });

  it('decides lot details only when they have a pass rule', () => {
    expect(recordDecision(TC, 'Yes')).toBe('OK');
    expect(recordDecision(TC, 'no')).toBe('NOK');
    expect(recordDecision(WEIGHT, '2.05')).toBe('OK');
    expect(recordDecision(WEIGHT, '2.2')).toBe('NOK');
    expect(recordDecision({ ...WEIGHT, lsl: null, usl: null }, '9')).toBeNull();
    expect(recordDecision(BATCH, 'B-17')).toBeNull();
    expect(recordDecision({ ...TC, options: yesNoOptions('ANY') }, 'No')).toBeNull();
  });
});

describe('evaluateInspection with builder fields', () => {
  const checkpoints = [SHADE, TC, WEIGHT, BATCH, NOTE];
  const cells = [{ checkpointUid: 'c1', sampleNo: 1, value: 0 }, { checkpointUid: 'c1', sampleNo: 2, value: 1 }];
  const entries = { r1: { textObservation: 'Yes' }, r2: { textObservation: '2' }, r3: { textObservation: 'B-17' } };

  it('is OK when every required answer is given and passes; optional fields may stay empty', () => {
    const r = evaluateInspection({ checkpoints, cells, entries, sampling });
    expect(r.missing).toEqual([]);
    expect(r.result).toBe('OK');
    expect(r.checkpointResults).toMatchObject({ c1: 'OK', r1: 'OK', r2: 'OK', r3: null, r4: null });
  });

  it('lists empty required lot details and choice samples as missing', () => {
    const r = evaluateInspection({ checkpoints, cells: cells.slice(0, 1), entries: { r1: { textObservation: 'Yes' } }, sampling });
    expect(r.missing).toEqual(expect.arrayContaining([
      { checkpointUid: 'c1', sampleNo: 2, field: 'value' },
      { checkpointUid: 'r2', field: 'textObservation' },
      { checkpointUid: 'r3', field: 'textObservation' },
    ]));
    expect(r.missing.some((m) => m.checkpointUid === 'r4')).toBe(false);
    expect(r.result).toBeNull();
  });

  it('fails the lot on a failing choice sample or a failing lot detail', () => {
    expect(evaluateInspection({ checkpoints, cells: [cells[0], { checkpointUid: 'c1', sampleNo: 2, value: 2 }], entries, sampling }).result).toBe('NOK');
    expect(evaluateInspection({ checkpoints, cells, entries: { ...entries, r1: { textObservation: 'No' } }, sampling }).result).toBe('NOK');
    // Decided already, even with other answers still missing.
    expect(evaluateInspection({ checkpoints, cells, entries: { r2: { textObservation: '5' } }, sampling }).result).toBe('NOK');
  });
});

describe('builder validation', () => {
  const ok = (c) => checkpointSchema.safeParse(c);
  const messages = (c) => (ok(c).success ? [] : ok(c).error.issues.map((i) => i.message));

  it('fills the default field type for the section, and required defaults to yes', () => {
    const r = ok({ section: 'VISUAL', checkpoint: 'Aesthetic', specification: 'No burr' });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ inputType: 'OK_NOK', isRequired: true });
  });

  it('accepts custom sections and every lot-detail type', () => {
    expect(ok({ section: 'RECORD', groupLabel: 'Supplier documents', inputType: 'TEXT', checkpoint: 'Batch no.' }).success).toBe(true);
    expect(ok({ section: 'RECORD', inputType: 'DATE', checkpoint: 'Date of manufacture', isRequired: false }).success).toBe(true);
    expect(ok({ section: 'RECORD', inputType: 'NUMBER', checkpoint: 'Weight', uom: 'kg', lsl: 1.9, usl: 2.1 }).success).toBe(true);
    expect(ok({ section: 'RECORD', inputType: 'YES_NO', checkpoint: 'Test certificate received', options: yesNoOptions('YES') }).success).toBe(true);
    expect(ok({ ...SHADE, uid: undefined, checkpoint: 'Colour shade', specification: 'Against master sample' }).success).toBe(true);
  });

  it('rejects field types that do not fit the section and bad choices', () => {
    expect(messages({ section: 'DIMENSIONAL', inputType: 'CHOICE', checkpoint: 'Dia', lsl: 1 })[0]).toMatch(/cannot be used/);
    expect(messages({ section: 'RECORD', inputType: 'CHOICE', checkpoint: 'Pack', options: [{ label: 'A', pass: true }] })).toContain('Give at least two options.');
    expect(messages({ section: 'RECORD', inputType: 'CHOICE', checkpoint: 'Pack', options: [{ label: 'A', pass: false }, { label: 'B', pass: false }] })[0]).toMatch(/at least one option as passing/);
    expect(messages({ section: 'VISUAL', inputType: 'CHOICE', checkpoint: 'Shade', specification: 'x', options: [{ label: 'A', pass: true }, { label: 'B', pass: true }] })[0]).toMatch(/able to fail/);
    expect(messages({ section: 'RECORD', inputType: 'TEXT', checkpoint: 'Batch', lsl: 1 })[0]).toMatch(/Limits apply/);
    expect(messages({ section: 'RECORD', inputType: 'TEXT', checkpoint: 'Batch', options: yesNoOptions() })[0]).toMatch(/Options apply/);
  });

  it('needs at least one inspected check, not only lot details', () => {
    expect(submitProblems({ checkpoints: [{ ...BATCH, checkpoint: 'Batch no.' }] })[0]).toMatch(/at least one inspection check/);
  });

  it('shows builder field changes in a diff', () => {
    const a = { header: {}, checkpoints: [{ uid: 'x', section: 'RECORD', inputType: 'YES_NO', checkpoint: 'TC', options: yesNoOptions('YES'), isRequired: true, groupLabel: null }] };
    const b = { header: {}, checkpoints: [{ ...a.checkpoints[0], options: yesNoOptions('ANY'), isRequired: false, groupLabel: 'Documents' }] };
    const d = diffVersions(a, b);
    expect(d.changed[0].fields.map((f) => f.field).sort()).toEqual(['groupLabel', 'isRequired', 'options']);
    expect(diffVersions(a, a).changed).toEqual([]);
  });
});
