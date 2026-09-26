import { describe, expect, it } from 'vitest';
import { defectProbability, driftCheck, inspectionFocus, readingFlag, supplierRisk, toleranceUse } from './insights.js';

const SPEC = { lsl: 9.9, usl: 10.1, nominal: 10 };
const lots = (...means) => means.map((mean, i) => ({ at: `2026-09-${String(i + 1).padStart(2, '0')}`, mean }));

describe('tolerance use and reading flags', () => {
  it('measures how much of the tolerance a value uses on its side', () => {
    expect(toleranceUse(10, SPEC)).toBe(0);
    expect(toleranceUse(10.05, SPEC)).toBeCloseTo(0.5);
    expect(toleranceUse(9.92, SPEC)).toBeCloseTo(0.8);
    expect(toleranceUse(10.2, SPEC)).toBeCloseTo(2);
    expect(toleranceUse(5, { usl: 10 })).toBeNull(); // no centre, no lower limit
  });
  it('flags readings near a limit or far from the usual values, not out-of-spec ones', () => {
    expect(readingFlag(10.09, SPEC)).toBe('NEAR_LIMIT');
    expect(readingFlag(10.2, SPEC)).toBeNull();
    expect(readingFlag(10.04, SPEC, { mean: 10, sd: 0.005, n: 30 })).toBe('UNUSUAL');
    expect(readingFlag(10.01, SPEC, { mean: 10, sd: 0.005, n: 30 })).toBeNull();
  });
});

describe('drift', () => {
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
  });
  it('detects a steady trend toward a limit', () => {
    const d = driftCheck({ history: lots(10.0, 10.02, 10.035, 10.05), current: [10.062], spec: SPEC });
    expect(d).toMatchObject({ status: 'TREND', direction: 'UP' });
  });
});

describe('supplier risk and defect probability', () => {
  it('rates a clean vendor low with reduced inspection, a poor one high with tightened', () => {
    expect(supplierRisk({ lots: 20, nok: 0, okStreak: 12 })).toMatchObject({ level: 'LOW', recommendation: 'REDUCED' });
    const bad = supplierRisk({ lots: 10, nok: 4, majorDeviations: 1, dns: 2, repeatDefects: 1, okStreak: 0 });
    expect(bad).toMatchObject({ level: 'HIGH', recommendation: 'TIGHTENED' });
    expect(bad.reasons[0]).toBe('4 of 10 recent lots not OK');
    expect(supplierRisk({ lots: 1, nok: 1 })).toMatchObject({ level: 'NEW', recommendation: 'NORMAL' });
  });
  it('estimates a lot failing, falling back to wider history while its own is short', () => {
    const none = defectProbability({});
    expect(none.probability).toBeCloseTo(0.05);
    const risky = defectProbability({ vendorItem: { lots: 6, nok: 3 }, vendor: { lots: 20, nok: 5 }, item: { lots: 30, nok: 3 } });
    expect(risky.level).toBe('HIGH');
    expect(defectProbability({ vendorItem: { lots: 30, nok: 0 }, vendor: { lots: 40, nok: 0 }, item: { lots: 50, nok: 1 } }).level).toBe('LOW');
  });
  it('ranks where to look first', () => {
    const focus = inspectionFocus([
      { uid: 'a', name: 'Dia', recentLots: 10, recentFails: 3, failedLastLot: true, drift: { status: 'OK' } },
      { uid: 'b', name: 'Length', recentLots: 10, recentFails: 0, drift: { status: 'TREND' } },
      { uid: 'c', name: 'Finish', recentLots: 10, recentFails: 0, drift: { status: 'OK' } },
    ]);
    expect(focus.map((f) => f.uid)).toEqual(['a', 'b']);
    expect(focus[0].reasons).toEqual(['failed in 3 of the last 10 lots', 'failed in the previous lot']);
  });
});
