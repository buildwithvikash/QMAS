import { describe, expect, it } from 'vitest';
import { applyTimeouts, resolveEscalation } from './escalation.js';

const step = (roleCode, status = 'PENDING', extra = {}) => ({ roleCode, status, ...extra });
const dec = (roleCode, decision, minute, kind = 'NORMAL') => ({ roleCode, decision, kind, decidedAt: new Date(Date.UTC(2026, 8, 23, 10, minute)).toISOString() });

describe('resolveEscalation', () => {
  it('waits until the highest-ranked selected authority decides; lower decisions are provisional', () => {
    const steps = [step('PLANT_HEAD'), step('CQA_HEAD')];
    const r1 = resolveEscalation({ steps, decisions: [dec('PLANT_HEAD', 'APPROVE', 0)] });
    expect(r1).toMatchObject({ effective: 'APPROVE', complete: false, decidedBy: 'PLANT_HEAD' });
    const r2 = resolveEscalation({ steps, decisions: [dec('PLANT_HEAD', 'APPROVE', 0), dec('CQA_HEAD', 'REJECT', 5)] });
    expect(r2).toMatchObject({ effective: 'REJECT', complete: true, decidedBy: 'CQA_HEAD', notRequired: [] });
  });

  it('completes as soon as the highest authority decides, marking lower pending ones not required (Rule 1)', () => {
    const steps = [step('PLANT_HEAD'), step('PLANT_QA_HEAD'), step('CQA_HEAD')];
    const r = resolveEscalation({ steps, decisions: [dec('CQA_HEAD', 'APPROVE', 1)] });
    expect(r).toMatchObject({ effective: 'APPROVE', complete: true, notRequired: ['PLANT_QA_HEAD', 'PLANT_HEAD'] });
  });

  it('a higher authority overrules a lower one even when the lower decided later', () => {
    const steps = [step('PLANT_HEAD'), step('PLANT_QA_HEAD')];
    const r = resolveEscalation({ steps, decisions: [dec('PLANT_QA_HEAD', 'REJECT', 1), dec('PLANT_HEAD', 'APPROVE', 9)] });
    expect(r).toMatchObject({ effective: 'REJECT', decidedBy: 'PLANT_QA_HEAD', complete: true });
  });

  it('uses each authority\'s latest decision', () => {
    const r = resolveEscalation({ steps: [step('PLANT_HEAD')], decisions: [dec('PLANT_HEAD', 'REJECT', 1), dec('PLANT_HEAD', 'CHANGE_TYPE', 2)] });
    expect(r.effective).toBe('CHANGE_TYPE');
  });

  it('with CQA and PDC both selected, CQA decides but waits for PDC to record (Rule 2)', () => {
    const steps = [step('PDC_HEAD'), step('CQA_HEAD')];
    const waiting = resolveEscalation({ steps, decisions: [dec('CQA_HEAD', 'REJECT', 1)] });
    expect(waiting).toMatchObject({ effective: 'REJECT', complete: false, pendingPdc: true });
    const done = resolveEscalation({ steps, decisions: [dec('CQA_HEAD', 'REJECT', 1), dec('PDC_HEAD', 'APPROVE', 3)] });
    expect(done).toMatchObject({ effective: 'REJECT', complete: true, pendingPdc: false });
  });

  it('ignores a timed-out Operations Head and lets CQA decide (Rule 3)', () => {
    const steps = [step('CENTRAL_OPS_HEAD', 'TIMED_OUT'), step('CQA_HEAD'), step('PLANT_HEAD')];
    const r = resolveEscalation({ steps, decisions: [dec('CQA_HEAD', 'APPROVE', 1)] });
    expect(r).toMatchObject({ effective: 'APPROVE', complete: true, decidedBy: 'CQA_HEAD' });
  });

  it('an override is final, whoever else decided (Rule 4)', () => {
    const steps = [step('PLANT_HEAD'), step('CENTRAL_OPS_HEAD')];
    const r = resolveEscalation({ steps, decisions: [dec('CENTRAL_OPS_HEAD', 'APPROVE', 1), dec('CQA_HEAD', 'REJECT', 2, 'OVERRIDE')] });
    expect(r).toMatchObject({ effective: 'REJECT', complete: true, overridden: true, decidedBy: 'CQA_HEAD' });
  });

  it('has no effective decision before anyone decides', () => {
    expect(resolveEscalation({ steps: [step('PLANT_HEAD')], decisions: [] })).toMatchObject({ effective: null, complete: false });
  });
});

describe('applyTimeouts', () => {
  const now = new Date('2026-09-24T11:00:00Z');
  it('times out the Operations Head after 24 hours and adds CQA if missing', () => {
    const steps = [step('CENTRAL_OPS_HEAD', 'PENDING', { dueAt: '2026-09-24T10:00:00Z' }), step('PLANT_HEAD')];
    expect(applyTimeouts({ steps, decisions: [], now })).toEqual({ timedOut: ['CENTRAL_OPS_HEAD'], add: ['CQA_HEAD'] });
  });
  it('does not add CQA twice, and leaves a decided or not-yet-due Operations Head alone', () => {
    const steps = [step('CENTRAL_OPS_HEAD', 'PENDING', { dueAt: '2026-09-24T10:00:00Z' }), step('CQA_HEAD')];
    expect(applyTimeouts({ steps, decisions: [], now })).toEqual({ timedOut: ['CENTRAL_OPS_HEAD'], add: [] });
    expect(applyTimeouts({ steps, decisions: [dec('CENTRAL_OPS_HEAD', 'APPROVE', 0)], now })).toEqual({ timedOut: [], add: [] });
    expect(applyTimeouts({ steps: [step('CENTRAL_OPS_HEAD', 'PENDING', { dueAt: '2026-09-24T12:00:00Z' })], decisions: [], now })).toEqual({ timedOut: [], add: [] });
  });
});
