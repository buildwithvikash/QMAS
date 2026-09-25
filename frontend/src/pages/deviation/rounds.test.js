import { describe, expect, it } from 'vitest';
import { roundBadges, roundsOf } from './rounds.js';

let id = 0;
const step = (action, extra = {}) => ({ id: ++id, action, at: new Date(Date.UTC(2026, 8, 24, 10, id)).toISOString(), ...extra });

describe('send-back rounds', () => {
  it('numbers inspection rounds: submit, sent back, submit again, approved', () => {
    const h = [step('SUBMIT'), step('REVERT', { remark: 'Re-measure S1' }), step('SUBMIT'), step('APPROVE')];
    const r = roundsOf(h, 'inspection');
    expect(r.map((x) => [x.no, x.outcome])).toEqual([[1, 'back'], [2, 'ahead']]);
    expect(r[0].end.remark).toBe('Re-measure S1');
  });

  it('keeps the current round open until someone decides', () => {
    const r = roundsOf([step('SUBMIT'), step('REVERT'), step('SUBMIT')], 'inspection');
    expect(r.at(-1)).toMatchObject({ no: 2, outcome: 'open', end: null });
  });

  it('ignores the deviation\'s own steps in the inspection loop', () => {
    const h = [step('SUBMIT'), step('ESCALATE'), step('HOLD', { deviationId: 'd' }), step('ESCALATE', { deviationId: 'd' })];
    const r = roundsOf(h, 'inspection');
    expect(r).toHaveLength(1);
    expect(r[0].events.map((e) => e.action)).toEqual(['ESCALATE']);
  });

  it('counts a senior change of type as sending the Deviation Form back', () => {
    const h = [
      step('SUBMIT_FORM', { deviationId: 'd' }), step('SEND_BACK', { deviationId: 'd' }),
      step('SUBMIT_FORM', { deviationId: 'd' }), step('DEPT_APPROVE', { deviationId: 'd' }), step('DEPT_APPROVE', { deviationId: 'd' }),
      step('ESCALATE', { deviationId: 'd' }), step('SENIOR_RESULT', { deviationId: 'd', payload: { decision: 'CHANGE_TYPE' } }),
      step('SUBMIT_FORM', { deviationId: 'd' }),
    ];
    const form = roundsOf(h, 'form');
    expect(form.map((x) => x.outcome)).toEqual(['back', 'back', 'open']);
    expect(form[1].events.map((e) => e.action)).toEqual(['DEPT_APPROVE', 'DEPT_APPROVE', 'SENIOR_RESULT']);
    expect(roundsOf(h, 'escalation')).toHaveLength(1);
  });

  it('numbers quantity and CAPA rounds', () => {
    expect(roundsOf([step('ENTER_QTY'), step('RETURN_QTY'), step('ENTER_QTY'), step('VERIFY_QTY')], 'qty').map((x) => x.outcome)).toEqual(['back', 'ahead']);
    expect(roundsOf([step('DN_SUBMIT_CAPA'), step('DN_RESUBMIT'), step('DN_SUBMIT_CAPA')], 'capa').map((x) => x.outcome)).toEqual(['back', 'open']);
  });

  it('badges only loops that had a send-back, marking the send-back step', () => {
    const h = [step('SUBMIT'), step('REVERT'), step('SUBMIT'), step('ESCALATE'), step('HOLD', { deviationId: 'd' }), step('SUBMIT_FORM', { deviationId: 'd' })];
    const b = roundBadges(h);
    expect(b.get(h[0].id)).toEqual({ loop: 'inspection', no: 1, role: 'start' });
    expect(b.get(h[1].id)).toEqual({ loop: 'inspection', no: 1, role: 'back' });
    expect(b.get(h[2].id)).toEqual({ loop: 'inspection', no: 2, role: 'start' });
    expect(b.has(h[5].id)).toBe(false); // a single form round needs no number
  });
});
