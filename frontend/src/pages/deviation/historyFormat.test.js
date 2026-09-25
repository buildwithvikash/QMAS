import { describe, expect, it } from 'vitest';
import { classifyChange, routineSummary } from './historyFormat.js';

const reading = (old, nw, decision = 'OK', oldDecision = null) => ({
  entity: 'READING', op: old === null ? 'I' : 'U',
  fields: [{ key: 'value_num', old, new: nw }, { key: 'decision', old: oldDecision, new: decision }],
});

describe('classifyChange', () => {
  it('treats a first OK reading as routine data entry', () => {
    expect(classifyChange(reading(null, 10.02))).toMatchObject({ important: false, kind: 'reading' });
  });
  it('keeps corrections and NOK findings', () => {
    expect(classifyChange(reading(10.02, 10.4, 'NOK', 'OK')).important).toBe(true);
    expect(classifyChange(reading(10.02, 10.03)).important).toBe(true);
    expect(classifyChange(reading(null, 12, 'NOK')).important).toBe(true);
  });
  it('drops fields the workflow sets itself but keeps decisions and remarks', () => {
    const c = { entity: 'IMIR', op: 'U', fields: [
      { key: 'status', old: 'SUBMITTED', new: 'APPROVED' }, { key: 'reviewed_at', old: null, new: '2026-09-25T10:00:00Z' },
      { key: 'incharge_remark', old: null, new: 'Checked twice' },
    ] };
    expect(classifyChange(c).fields.map((f) => f.key)).toEqual(['incharge_remark']);
    expect(classifyChange({ ...c, fields: c.fields.slice(0, 2) })).toMatchObject({ important: false, kind: 'update' });
    const dev = { entity: 'DEVIATION', op: 'U', fields: [{ key: 'ok_qty', old: null, new: 90 }] };
    expect(classifyChange(dev).important).toBe(true);
  });
  it('shows removed photos, sums added ones', () => {
    expect(classifyChange({ entity: 'FILE', op: 'D', fields: [] }).important).toBe(true);
    const changes = [{ entity: 'FILE', op: 'I', fields: [] }, reading(null, 1), reading(null, 2), { entity: 'IMIR', op: 'U', fields: [{ key: 'status', old: 'A', new: 'B' }] }];
    expect(routineSummary(changes)).toBe('2 readings entered · 1 photo added · 1 routine update');
    expect(routineSummary(changes, { withUpdates: false })).toBe('2 readings entered · 1 photo added');
  });
});
