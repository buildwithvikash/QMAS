import { lotDisposition } from './sampling.js';

/**
 * Inspection rules (blueprint slides 5–6), shared by the API (authoritative), the web app and the
 * offline tablet so every screen shows the same OK/NOK the server will record.
 *
 * An IMIR has `sampleSize` n (≤ MAX_SAMPLES). Dimensional and visual checkpoints have sample
 * columns 1..MAX_SAMPLES: columns 1..n are required ("green"), the rest optional ("grey").
 * Reliability checkpoints have one text observation and a manual OK/NOK, required only when the
 * test is due for this item and vendor (Decision B-10).
 */
export const MAX_SAMPLES = 8;

const has = (v) => v !== null && v !== undefined && v !== '';

/** Dimensional reading against inclusive limits. */
export function dimensionalDecision(value, { lsl, usl }) {
  if (!has(value)) return null;
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  if (has(lsl) && v < Number(lsl)) return 'NOK';
  if (has(usl) && v > Number(usl)) return 'NOK';
  return 'OK';
}

/** OK/NOK of one sample cell: { value } for dimensional, { ok } for visual. */
export function cellDecision(checkpoint, cell) {
  if (!cell) return null;
  if (checkpoint.section === 'DIMENSIONAL') return dimensionalDecision(cell.value, checkpoint);
  if (checkpoint.section === 'VISUAL') return cell.ok === true ? 'OK' : cell.ok === false ? 'NOK' : null;
  return null;
}

const cellKey = (uid, sampleNo) => `${uid}:${sampleNo}`;

/**
 * Evaluates a whole inspection.
 *   checkpoints   format checkpoints [{ uid, section, lsl, usl, ... }]
 *   required      Map/obj uid → boolean, whether a reliability test is due (others: always required)
 *   cells         [{ checkpointUid, sampleNo, value?, ok? }]
 *   entries       obj uid → { manualResult, textObservation } for reliability
 *   sampling      { sampleSize, acceptNo, rejectNo }
 * Returns {
 *   checkpointResults: { uid: 'OK' | 'NOK' | null },
 *   missing: [{ checkpointUid, sampleNo?, field }],   what still blocks submission
 *   defectiveSamples: [sampleNo],                     samples with any NOK reading
 *   result: 'OK' | 'NOK' | null                       null while incomplete
 * }
 */
export function evaluateInspection({ checkpoints, required = {}, cells = [], entries = {}, sampling }) {
  const isRequired = (uid) => (required instanceof Map ? required.get(uid) : required[uid]) !== false;
  const byCell = new Map(cells.map((c) => [cellKey(c.checkpointUid, c.sampleNo), c]));
  const n = sampling.sampleSize;
  const checkpointResults = {};
  const missing = [];
  const defective = new Set();
  let reliabilityNok = false;

  for (const cp of checkpoints) {
    if (cp.section === 'RELIABILITY') {
      const e = entries[cp.uid] ?? {};
      const performed = has(e.manualResult) || has(e.textObservation);
      if (isRequired(cp.uid) || performed) {
        if (!has(e.textObservation)) missing.push({ checkpointUid: cp.uid, field: 'textObservation' });
        if (!has(e.manualResult)) missing.push({ checkpointUid: cp.uid, field: 'manualResult' });
      }
      checkpointResults[cp.uid] = has(e.manualResult) ? e.manualResult : null;
      if (e.manualResult === 'NOK') reliabilityNok = true;
      continue;
    }
    let anyNok = false;
    let complete = true;
    for (let s = 1; s <= MAX_SAMPLES; s += 1) {
      const d = cellDecision(cp, byCell.get(cellKey(cp.uid, s)));
      if (d === 'NOK') {
        anyNok = true;
        defective.add(s);
      }
      if (s <= n && d === null) {
        complete = false;
        missing.push({ checkpointUid: cp.uid, sampleNo: s, field: cp.section === 'DIMENSIONAL' ? 'value' : 'ok' });
      }
    }
    checkpointResults[cp.uid] = anyNok ? 'NOK' : complete ? 'OK' : null;
  }

  const defectiveSamples = [...defective].sort((a, b) => a - b);
  let result = null;
  if (missing.length === 0) {
    // With the default Ac 0 / Re 1 a single NOK rejects the lot (confirmed 23 Sep 2026).
    // Double sampling is not used, so "between Ac and Re" is treated as not accepted.
    const disposition = lotDisposition(defectiveSamples.length, sampling);
    result = reliabilityNok || disposition !== 'ACCEPT' ? 'NOK' : 'OK';
  } else if (reliabilityNok || lotDisposition(defectiveSamples.length, sampling) === 'REJECT') {
    // Already decided even though cells remain: more readings cannot make it OK.
    result = 'NOK';
  }
  return { checkpointResults, missing, defectiveSamples, result };
}

/**
 * Whether a reliability test is due (Decision B-10, default B-21: per item + vendor):
 * never tested, last test NOK, no frequency (every lot), or last OK test older than the frequency.
 */
export function reliabilityDue({ frequencyMonths, lastTestedAt, lastResult }, now = new Date()) {
  if (!frequencyMonths) return true;
  if (!lastTestedAt || lastResult !== 'OK') return true;
  const due = new Date(lastTestedAt);
  due.setMonth(due.getMonth() + Number(frequencyMonths));
  return due <= now;
}
