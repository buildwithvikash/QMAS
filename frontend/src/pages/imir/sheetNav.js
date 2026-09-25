/**
 * Keyboard flow between sample cells (Enter or arrows): cells carry data-nav (section), data-row
 * and data-col; moving past the last visible sample wraps to the next row.
 */
export function moveFocus(from, dRow, dCol, lastCol) {
  const nav = from.dataset.nav;
  let row = Number(from.dataset.row);
  let col = Number(from.dataset.col) + dCol;
  if (col > lastCol) { col = 1; row += 1; }
  if (col < 1) { col = lastCol; row -= 1; }
  row += dRow;
  const next = document.querySelector(`[data-nav="${nav}"][data-row="${row}"][data-col="${col}"]`);
  if (next) {
    next.focus();
    next.select?.();
    return true;
  }
  return false;
}

/** Focuses the first empty required entry (used by the "Next empty" button). */
export function focusFirstMissing(missing) {
  const m = missing?.[0];
  if (!m) return;
  const el = document.querySelector(m.sampleNo ? `[data-cp="${m.checkpointUid}"][data-sample="${m.sampleNo}"]` : `[data-cp="${m.checkpointUid}"][data-entry]`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.focus({ preventScroll: true });
}

/**
 * How much of the report is filled: per tab (required entries done / total, and whether any
 * check is NOK) and overall, counting the model. Drives the progress bar and the tab labels.
 */
export function sheetProgress(sheet) {
  const n = sheet.sampleSize ?? 0;
  const byCell = new Map(sheet.cells.map((c) => [`${c.checkpointUid}:${c.sampleNo}`, c]));
  const results = sheet.evaluation?.checkpointResults ?? {};
  const count = (list, has) => list.reduce((a, cp) => {
    let k = 0;
    for (let s = 1; s <= n; s += 1) if (has(byCell.get(`${cp.uid}:${s}`))) k += 1;
    return a + k;
  }, 0);
  const cps = sheet.checkpoints ?? [];
  const dims = cps.filter((c) => c.section === 'DIMENSIONAL');
  const vis = cps.filter((c) => c.section === 'VISUAL');
  const rel = cps.filter((c) => c.section === 'RELIABILITY' && c.isRequired);
  const dim = { done: count(dims, (c) => c?.value != null), total: dims.length * n, nok: dims.some((c) => results[c.uid] === 'NOK') };
  const visrel = {
    done: count(vis, (c) => c?.ok != null) + rel.filter((c) => c.textObservation && c.manualResult).length,
    total: vis.length * n + rel.length,
    nok: [...vis, ...cps.filter((c) => c.section === 'RELIABILITY')].some((c) => results[c.uid] === 'NOK'),
  };
  const total = dim.total + visrel.total + 1;
  const done = dim.done + visrel.done + (sheet.model ? 1 : 0);
  return { dim, visrel, pct: total ? Math.round((done / total) * 100) : 0 };
}
