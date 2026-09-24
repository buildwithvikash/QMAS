import { evaluateInspection } from '@qmas/shared';

/**
 * Inspection sheet model shared by online and offline inspection: the same patch the server
 * receives is applied locally, and the result is evaluated with the server's rules.
 */
/** Live evaluation with the same rules the server uses. */
export function evaluateSheet(b) {
  return evaluateInspection({
    checkpoints: b.checkpoints,
    required: Object.fromEntries(b.checkpoints.map((c) => [c.uid, c.isRequired])),
    cells: b.cells,
    entries: Object.fromEntries(b.checkpoints.map((c) => [c.uid, { manualResult: c.manualResult, textObservation: c.textObservation }])),
    sampling: { sampleSize: b.sampleSize, acceptNo: b.acceptNo, rejectNo: b.rejectNo },
  });
}

/** Applies a save patch (cells, reliability entries, model, remarks) to a sheet and re-evaluates it. */
export function applyPatch(b, patch) {
  const next = { ...b, cells: [...b.cells], checkpoints: b.checkpoints.map((c) => ({ ...c })) };
  if (patch.model !== undefined) next.model = patch.model;
  if (patch.inspectorRemark !== undefined) next.inspectorRemark = patch.inspectorRemark;
  for (const cell of patch.cells ?? []) {
    const i = next.cells.findIndex((c) => c.checkpointUid === cell.checkpointUid && c.sampleNo === cell.sampleNo);
    const empty = (cell.value === null || cell.value === undefined) && (cell.ok === null || cell.ok === undefined);
    if (i >= 0) next.cells.splice(i, 1);
    if (!empty) next.cells.push({ checkpointUid: cell.checkpointUid, sampleNo: cell.sampleNo, value: cell.value ?? null, ok: cell.ok ?? null });
  }
  for (const e of patch.entries ?? []) {
    const cp = next.checkpoints.find((c) => c.uid === e.checkpointUid);
    if (cp) Object.assign(cp, Object.fromEntries(Object.entries(e).filter(([k, v]) => k !== 'checkpointUid' && v !== undefined)));
  }
  next.evaluation = evaluateSheet(next);
  return next;
}

