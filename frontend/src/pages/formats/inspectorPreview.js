import { evaluateSheet } from '../../offline/sheetModel.js';

/** A checkpoint list (format version or builder draft) as an inspection sheet with sample data. */
export function previewSheet(source, sampleSize, cells = []) {
  const sheet = {
    sampleSize,
    lotSize: sampleSize,
    acceptNo: 0,
    rejectNo: 1,
    cells: cells.filter((c) => c.sampleNo <= sampleSize),
    attachments: [],
    checkpoints: source.map((c) => ({
      ...c,
      // Reliability: shown as due on this lot, so the observation and OK / NOK can be tried.
      isRequired: c.section === 'RELIABILITY' ? true : c.isRequired,
      frequencyMonths: c.frequencyMonths,
      lastTestedAt: null,
      textObservation: null,
      manualResult: null,
      inspectorRemark: null,
      inchargeRemark: null,
    })),
  };
  return { ...sheet, evaluation: evaluateSheet(sheet) };
}
