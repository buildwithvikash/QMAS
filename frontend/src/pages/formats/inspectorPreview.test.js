import { describe, expect, it } from 'vitest';
import { applyPatch } from '../../offline/sheetModel.js';
import { previewSheet } from './inspectorPreview.js';

const checkpoints = [
  { uid: 'd1', section: 'DIMENSIONAL', inputType: 'MEASURE', checkpoint: 'Length', specification: '57 ± 0.3', lsl: 56.7, usl: 57.3, uom: 'mm', isRequired: true },
  { uid: 'v1', section: 'VISUAL', inputType: 'OK_NOK', checkpoint: 'Aesthetic', specification: 'Free from burr', isRequired: true },
  { uid: 'r1', section: 'RELIABILITY', inputType: 'LOT_TEST', checkpoint: 'Bursting strength', frequencyMonths: 6, isRequired: false },
];

describe('inspector preview of a format', () => {
  it('builds an empty sheet with the chosen sample size; reliability shows as due', () => {
    const sheet = previewSheet(checkpoints, 3);
    expect(sheet.sampleSize).toBe(3);
    expect(sheet.cells).toEqual([]);
    expect(sheet.checkpoints.find((c) => c.uid === 'r1').isRequired).toBe(true);
    expect(sheet.evaluation.result).toBeNull();
    expect(sheet.evaluation.missing.length).toBeGreaterThan(0);
  });

  it('judges readings like a real lot: out of limits is NOK, all in spec is OK', () => {
    let sheet = previewSheet(checkpoints, 2);
    sheet = applyPatch(sheet, { cells: [{ checkpointUid: 'd1', sampleNo: 1, value: 58 }] });
    expect(sheet.evaluation.checkpointResults.d1).toBe('NOK');

    sheet = previewSheet(checkpoints, 2);
    sheet = applyPatch(sheet, {
      cells: [
        { checkpointUid: 'd1', sampleNo: 1, value: 57 }, { checkpointUid: 'd1', sampleNo: 2, value: 57.1 },
        { checkpointUid: 'v1', sampleNo: 1, ok: true }, { checkpointUid: 'v1', sampleNo: 2, ok: true },
      ],
      entries: [{ checkpointUid: 'r1', textObservation: '15 kg/cm²', manualResult: 'OK' }],
    });
    expect(sheet.evaluation.result).toBe('OK');
    expect(sheet.evaluation.missing).toEqual([]);
  });

  it('keeps entries when the sample size changes and drops samples beyond it', () => {
    const cells = [{ checkpointUid: 'd1', sampleNo: 1, value: 57 }, { checkpointUid: 'd1', sampleNo: 3, value: 57 }];
    expect(previewSheet(checkpoints, 2, cells).cells).toEqual([cells[0]]);
  });
});
