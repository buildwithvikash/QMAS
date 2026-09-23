import { describe, expect, it } from 'vitest';
import { formatDocNo, periodKey, validatePattern } from './numbering.js';

// 23 Sep 2026 20:00 UTC is already 24 Sep in IST.
const lateEveningUtc = new Date('2026-09-23T20:00:00Z');
const julyFirst = new Date('2026-07-01T05:00:00Z');

describe('formatDocNo', () => {
  it('renders blueprint option 1 (SAP plant code)', () => {
    expect(formatDocNo('IMIR{PLANT_SAP}{YY}{MM}{DD}{SEQ:3}', { plantSapCode: '1115', date: julyFirst, seq: 1 })).toBe('IMIR1115260701001');
  });

  it('renders blueprint option 2 (short plant code)', () => {
    expect(formatDocNo('IMIR{PLANT_SHORT}{YY}{MM}{DD}{SEQ:3}', { plantShortCode: '03', date: julyFirst, seq: 1 })).toBe('IMIR03260701001');
  });

  it('renders the DN pattern with source', () => {
    expect(formatDocNo('DN{PLANT_SAP}{SRC}{YY}{MM}{SEQ:3}', { plantSapCode: '1111', src: 'IL', date: julyFirst, seq: 12 })).toBe('DN1111IL2607012');
  });

  it('uses the IST calendar date, not UTC', () => {
    expect(formatDocNo('X{PLANT_SHORT}{YYYY}{MM}{DD}{SEQ:1}', { plantShortCode: '01', date: lateEveningUtc, seq: 5 })).toBe('X01202609245');
  });

  it('does not truncate a running number wider than its padding', () => {
    expect(formatDocNo('A{PLANT_SHORT}{SEQ:3}', { plantShortCode: '01', seq: 1000 })).toBe('A011000');
  });
});

describe('periodKey', () => {
  it('builds keys per reset scope in IST', () => {
    expect(periodKey(lateEveningUtc, 'DAY')).toBe('D20260924');
    expect(periodKey(lateEveningUtc, 'MONTH')).toBe('M202609');
    expect(periodKey(lateEveningUtc, 'YEAR')).toBe('Y2026');
    expect(periodKey(lateEveningUtc, 'NEVER')).toBe('ALL');
  });
});

describe('validatePattern', () => {
  it('accepts both blueprint options', () => {
    expect(validatePattern('IMIR{PLANT_SAP}{YY}{MM}{DD}{SEQ:3}', 'DAY', 'IMIR')).toEqual([]);
    expect(validatePattern('DN{PLANT_SHORT}{SRC}{YY}{MM}{SEQ:3}', 'MONTH', 'DN')).toEqual([]);
  });

  it('rejects a daily reset without a day token', () => {
    expect(validatePattern('IMIR{PLANT_SAP}{YY}{MM}{SEQ:3}', 'DAY', 'IMIR')).toContain('A daily reset needs {YY} or {YYYY}, {MM} and {DD} in the pattern.');
  });

  it('requires exactly one sequence token with a width', () => {
    expect(validatePattern('IMIR{PLANT_SAP}', 'NEVER', 'IMIR')).toContain('The pattern must contain {SEQ:n} exactly once.');
    expect(validatePattern('IMIR{PLANT_SAP}{SEQ}', 'NEVER', 'IMIR')).toContain('{SEQ:n} needs a width from 1 to 9, e.g. {SEQ:3}.');
  });

  it('rejects unknown tokens, bad literals, missing plant and SRC outside DN', () => {
    const errors = validatePattern('im-{PLANT}{SRC}{SEQ:3}', 'NEVER', 'IMIR');
    expect(errors).toContain('Unknown token {PLANT}.');
    expect(errors).toContain('Fixed text "im-" may only contain capital letters, digits and - / _ .');
    expect(errors).toContain('{SRC} is only available for DN numbers.');
    expect(errors).toContain('The pattern must contain {PLANT_SAP} or {PLANT_SHORT}, because counters run per plant.');
  });
});
