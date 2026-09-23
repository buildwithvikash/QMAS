import { describe, expect, it } from 'vitest';
import { cellDecision, dimensionalDecision, evaluateInspection, reliabilityDue } from './inspection.js';

const DIM = { uid: 'd1', section: 'DIMENSIONAL', lsl: 56.7, usl: 57.3 };
const VIS = { uid: 'v1', section: 'VISUAL' };
const REL = { uid: 'r1', section: 'RELIABILITY', frequencyMonths: 6 };
const sampling = { sampleSize: 2, acceptNo: 0, rejectNo: 1 };
const dims = (values) => values.map((value, i) => ({ checkpointUid: 'd1', sampleNo: i + 1, value }));
const viss = (oks) => oks.map((ok, i) => ({ checkpointUid: 'v1', sampleNo: i + 1, ok }));

describe('cell decisions', () => {
  it('treats limits as inclusive and handles one-sided limits', () => {
    expect(dimensionalDecision(56.7, DIM)).toBe('OK');
    expect(dimensionalDecision(57.3, DIM)).toBe('OK');
    expect(dimensionalDecision(57.301, DIM)).toBe('NOK');
    expect(dimensionalDecision(56.699, DIM)).toBe('NOK');
    expect(dimensionalDecision(3, { lsl: null, usl: 2 })).toBe('NOK');
    expect(dimensionalDecision(0.05, { lsl: 0.05, usl: null })).toBe('OK');
    expect(dimensionalDecision('', DIM)).toBeNull();
  });

  it('reads visual OK/NOK', () => {
    expect(cellDecision(VIS, { ok: true })).toBe('OK');
    expect(cellDecision(VIS, { ok: false })).toBe('NOK');
    expect(cellDecision(VIS, { ok: null })).toBeNull();
  });
});

describe('evaluateInspection', () => {
  it('is OK when every required cell is filled and in spec', () => {
    const r = evaluateInspection({ checkpoints: [DIM, VIS], cells: [...dims([57, 57.1]), ...viss([true, true])], sampling });
    expect(r).toMatchObject({ result: 'OK', missing: [], defectiveSamples: [], checkpointResults: { d1: 'OK', v1: 'OK' } });
  });

  it('lists missing required cells (first n samples only) and leaves the result open', () => {
    const r = evaluateInspection({ checkpoints: [DIM, VIS], cells: [...dims([57]), ...viss([true])], sampling });
    expect(r.result).toBeNull();
    expect(r.missing).toEqual([
      { checkpointUid: 'd1', sampleNo: 2, field: 'value' },
      { checkpointUid: 'v1', sampleNo: 2, field: 'ok' },
    ]);
  });

  it('rejects the lot on a single NOK, even in an optional extra sample', () => {
    const r = evaluateInspection({ checkpoints: [DIM], cells: [...dims([57, 57]), { checkpointUid: 'd1', sampleNo: 5, value: 58 }], sampling });
    expect(r).toMatchObject({ result: 'NOK', defectiveSamples: [5], checkpointResults: { d1: 'NOK' } });
  });

  it('knows the lot is NOK before all cells are filled', () => {
    const r = evaluateInspection({ checkpoints: [DIM, VIS], cells: dims([60]), sampling });
    expect(r.result).toBe('NOK');
    expect(r.missing.length).toBeGreaterThan(0);
  });

  it('applies acceptance numbers when the sampling table has them', () => {
    const lenient = { sampleSize: 3, acceptNo: 1, rejectNo: 2 };
    expect(evaluateInspection({ checkpoints: [DIM], cells: dims([57, 58, 57]), sampling: lenient }).result).toBe('OK');
    expect(evaluateInspection({ checkpoints: [DIM], cells: dims([58, 58, 57]), sampling: lenient }).result).toBe('NOK');
  });

  it('counts a sample once even when several checkpoints fail on it', () => {
    const r = evaluateInspection({ checkpoints: [DIM, VIS], cells: [...dims([58, 57]), ...viss([false, true])], sampling });
    expect(r.defectiveSamples).toEqual([1]);
  });

  it('requires reliability only when due, uses the manual result, and still counts a test done when not due', () => {
    const cells = dims([57, 57]);
    const notDue = evaluateInspection({ checkpoints: [DIM, REL], required: { r1: false }, cells, sampling });
    expect(notDue).toMatchObject({ result: 'OK', missing: [] });

    const due = evaluateInspection({ checkpoints: [DIM, REL], required: { r1: true }, cells, sampling });
    expect(due.missing).toEqual([{ checkpointUid: 'r1', field: 'textObservation' }, { checkpointUid: 'r1', field: 'manualResult' }]);

    const failed = evaluateInspection({ checkpoints: [DIM, REL], required: { r1: false }, cells, entries: { r1: { textObservation: 'Bent at 180 kg', manualResult: 'NOK' } }, sampling });
    expect(failed).toMatchObject({ result: 'NOK', checkpointResults: { r1: 'NOK' } });
  });
});

describe('reliabilityDue', () => {
  const now = new Date('2026-09-23T10:00:00Z');
  it('is due when never tested, last NOK, every lot, or older than the frequency', () => {
    expect(reliabilityDue({ frequencyMonths: 6, lastTestedAt: null }, now)).toBe(true);
    expect(reliabilityDue({ frequencyMonths: 6, lastTestedAt: '2026-08-01', lastResult: 'NOK' }, now)).toBe(true);
    expect(reliabilityDue({ frequencyMonths: null, lastTestedAt: '2026-09-22', lastResult: 'OK' }, now)).toBe(true);
    expect(reliabilityDue({ frequencyMonths: 6, lastTestedAt: '2026-03-01T00:00:00Z', lastResult: 'OK' }, now)).toBe(true);
    expect(reliabilityDue({ frequencyMonths: 6, lastTestedAt: '2026-06-01T00:00:00Z', lastResult: 'OK' }, now)).toBe(false);
  });
});
