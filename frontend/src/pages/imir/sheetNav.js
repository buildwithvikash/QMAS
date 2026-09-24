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
