import { describe, expect, it } from 'vitest';
import { readingFlag, toleranceUse } from './readings.js';

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
