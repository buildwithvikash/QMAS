import { describe, expect, it } from 'vitest';
import { determineSample, lotDisposition, PROCEDURE_SAMPLING_ROWS, validateSamplingRows } from './sampling.js';

describe('procedure table', () => {
  it('is valid and covers every lot size (8 samples at most)', () => {
    expect(validateSamplingRows(PROCEDURE_SAMPLING_ROWS)).toEqual({ errors: [], warnings: [] });
  });
});

describe('determineSample', () => {
  it.each([
    [2, 2], [8, 2], [9, 3], [15, 3], [16, 5], [25, 5], [26, 8], [50, 8], [51, 8], [10000, 8], [900000, 8],
  ])('lot %i → sample %i', (lot, sample) => {
    expect(determineSample(PROCEDURE_SAMPLING_ROWS, lot)).toMatchObject({ sampleSize: sample, basis: 'TABLE', acceptNo: 0, rejectNo: 1 });
  });

  it('inspects the whole lot when it is smaller than the first row', () => {
    expect(determineSample(PROCEDURE_SAMPLING_ROWS, 1)).toMatchObject({ sampleSize: 1, basis: 'FULL_LOT' });
  });

  it('rounds a fractional quantity up', () => {
    expect(determineSample(PROCEDURE_SAMPLING_ROWS, 8.2)).toMatchObject({ lotSize: 9, sampleSize: 3 });
  });

  it('returns null above a capped table and for invalid quantities', () => {
    expect(determineSample([{ lotMin: 2, lotMax: 100, sampleSize: 5 }], 101)).toBeNull();
    expect(determineSample(PROCEDURE_SAMPLING_ROWS, 0)).toBeNull();
    expect(determineSample(PROCEDURE_SAMPLING_ROWS, 'abc')).toBeNull();
  });

  it('never samples more units than the lot has', () => {
    expect(determineSample([{ lotMin: 1, lotMax: 10, sampleSize: 8 }], 3)).toMatchObject({ sampleSize: 3 });
  });

  it('uses row acceptance numbers when present', () => {
    expect(determineSample([{ lotMin: 1, lotMax: null, sampleSize: 20, acceptNo: 1, rejectNo: 2 }], 500)).toMatchObject({ acceptNo: 1, rejectNo: 2 });
  });
});

describe('validateSamplingRows', () => {
  it('reports overlaps, gaps and bad numbers', () => {
    const { errors, warnings } = validateSamplingRows([
      { lotMin: 1, lotMax: 10, sampleSize: 2 },
      { lotMin: 10, lotMax: 20, sampleSize: 0 },
      { lotMin: 30, lotMax: null, sampleSize: 5, acceptNo: 2, rejectNo: 2 },
    ]);
    expect(errors).toContain('Row 1 (1–10) overlaps the next row starting at 10.');
    expect(errors).toContain('Row 2 (10–20): sample size must be a whole number of at least 1.');
    expect(errors).toContain('Row 3 (30–∞): rejection number must be greater than acceptance number.');
    expect(warnings).toContain('Lots from 21 to 29 are not covered.');
  });

  it('allows an open upper limit only on the last row', () => {
    const { errors } = validateSamplingRows([
      { lotMin: 1, lotMax: null, sampleSize: 2 },
      { lotMin: 5, lotMax: 9, sampleSize: 3 },
    ]);
    expect(errors).toContain('Row 1 (1–∞): only the last row may have no upper limit.');
  });
});

describe('lotDisposition', () => {
  it('applies acceptance and rejection numbers', () => {
    expect(lotDisposition(0)).toBe('ACCEPT');
    expect(lotDisposition(1)).toBe('REJECT');
    expect(lotDisposition(1, { acceptNo: 1, rejectNo: 3 })).toBe('ACCEPT');
    expect(lotDisposition(2, { acceptNo: 1, rejectNo: 3 })).toBe('UNDECIDED');
    expect(lotDisposition(3, { acceptNo: 1, rejectNo: 3 })).toBe('REJECT');
  });
});
