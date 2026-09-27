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

/** OK / NOK of the option chosen (by position) in a multiple-choice check. */
export function choiceDecision(options, index) {
  if (!has(index)) return null;
  const o = options?.[Number(index)];
  if (!o) return null;
  return o.pass === false ? 'NOK' : 'OK';
}

/**
 * OK/NOK of one sample cell: { value } for dimensional, { ok } for a visual OK / Not OK check,
 * { value: option position } for a visual multiple-choice check.
 */
export function cellDecision(checkpoint, cell) {
  if (!cell) return null;
  if (checkpoint.section === 'DIMENSIONAL') return dimensionalDecision(cell.value, checkpoint);
  if (checkpoint.section === 'VISUAL' && checkpoint.inputType === 'CHOICE') return choiceDecision(checkpoint.options, cell.value);
  if (checkpoint.section === 'VISUAL') return cell.ok === true ? 'OK' : cell.ok === false ? 'NOK' : null;
  return null;
}

/** A sample reading as text: "57.12 mm", "OK" / "NOK", or the option chosen in a multiple-choice check. */
export function sampleText(checkpoint, cell) {
  if (!cell) return '';
  if (checkpoint.section === 'DIMENSIONAL') return has(cell.value) ? `${cell.value}${checkpoint.uom ? ` ${checkpoint.uom}` : ''}` : '';
  if (checkpoint.inputType === 'CHOICE') return has(cell.value) ? (checkpoint.options?.[Number(cell.value)]?.label ?? '') : '';
  return cell.ok === true ? 'OK' : cell.ok === false ? 'NOK' : '';
}

/** Whether a checkpoint is recorded once per lot (reliability test or lot detail) rather than per sample. */
export const perLot = (checkpoint) => checkpoint.section === 'RELIABILITY' || checkpoint.section === 'RECORD';

/**
 * OK / NOK of a lot-details field from the recorded answer (text): a number against its limits,
 * a choice or yes / no by the option chosen. null when the field only records information.
 */
export function recordDecision(checkpoint, answer) {
  if (!has(answer)) return null;
  if (checkpoint.inputType === 'NUMBER') return has(checkpoint.lsl) || has(checkpoint.usl) ? dimensionalDecision(answer, checkpoint) : null;
  if (checkpoint.inputType === 'CHOICE' || checkpoint.inputType === 'YES_NO') {
    const opts = checkpoint.options ?? [];
    if (!opts.some((o) => o.pass === false)) return null;
    const o = opts.find((x) => x.label.toLowerCase() === String(answer).trim().toLowerCase());
    return o ? (o.pass === false ? 'NOK' : 'OK') : null;
  }
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
  const requiredFlag = (uid) => (required instanceof Map ? required.get(uid) : required[uid]);
  const isRequired = (uid) => requiredFlag(uid) !== false;
  // Lot details: the lot's own flag when given, else the field's "required" setting in the format.
  const recordRequired = (cp) => (requiredFlag(cp.uid) === undefined ? cp.isRequired !== false : requiredFlag(cp.uid) !== false);
  const byCell = new Map(cells.map((c) => [cellKey(c.checkpointUid, c.sampleNo), c]));
  const n = sampling.sampleSize;
  const checkpointResults = {};
  const missing = [];
  const defective = new Set();
  let reliabilityNok = false;

  for (const cp of checkpoints) {
    if (cp.section === 'RECORD') {
      // Lot details: one answer per lot, kept as the text observation.
      const answer = entries[cp.uid]?.textObservation;
      if (recordRequired(cp) && !has(answer)) missing.push({ checkpointUid: cp.uid, field: 'textObservation' });
      const d = recordDecision(cp, answer);
      checkpointResults[cp.uid] = d;
      if (d === 'NOK') reliabilityNok = true;
      continue;
    }
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
        missing.push({ checkpointUid: cp.uid, sampleNo: s, field: cp.section === 'DIMENSIONAL' || cp.inputType === 'CHOICE' ? 'value' : 'ok' });
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
