import { describe, expect, it } from 'vitest';
import { driftCheck, readingFlag, toleranceUse } from './readings.js';

const SPEC = { lsl: 9.9, usl: 10.1, nominal: 10 };

describe('tolerance use and reading flags', () => {
  it('measures how much of the tolerance a reading uses', () => {
    expect(toleranceUse(10, SPEC)).toBe(0);
    expect(toleranceUse(10.05, SPEC)).toBeCloseTo(0.5);
    expect(toleranceUse(9.92, SPEC)).toBeCloseTo(0.8);
    expect(toleranceUse(10.2, SPEC)).toBeCloseTo(2);
    expect(toleranceUse(5, { usl: 10 })).toBeNull(); // no centre, no lower limit
  });
  it('flags a reading close to a limit, not one out of spec', () => {
    expect(readingFlag(10.09, SPEC)).toBe('NEAR_LIMIT');
    expect(readingFlag(10.05, SPEC)).toBeNull();
    expect(readingFlag(10.2, SPEC)).toBeNull();
  });
});

const lots = (...means) => means.map((mean, i) => ({ at: `2026-0${(i % 9) + 1}-01`, mean }));

describe('drift across lots', () => {
  it('reports no data, then in line with history', () => {
    expect(driftCheck({ spec: SPEC }).status).toBe('NO_DATA');
    expect(driftCheck({ history: lots(10, 10.01, 9.99, 10, 10.01), current: [10, 10.01], spec: SPEC }).status).toBe('OK');
  });
  it('warns when a reading is close to a limit', () => {
    const d = driftCheck({ history: lots(10, 10.01), current: [10.09], spec: SPEC, unit: 'mm' });
    expect(d).toMatchObject({ status: 'NEAR_LIMIT', direction: 'UP' });
    expect(d.message).toContain('90 %');
  });
  it('detects a shift of this lot against history', () => {
    const d = driftCheck({ history: lots(10, 10.002, 9.998, 10.001, 9.999, 10), current: [10.04, 10.05], spec: SPEC });
    expect(d).toMatchObject({ status: 'SHIFT', direction: 'UP' });
    expect(d.stats).toMatchObject({ lots: 6, lotMean: 10.045 });
  });
  it('detects a steady trend toward a limit', () => {
    const d = driftCheck({ history: lots(10.0, 10.02, 10.035, 10.05), current: [10.062], spec: SPEC });
    expect(d).toMatchObject({ status: 'TREND', direction: 'UP' });
  });
});
