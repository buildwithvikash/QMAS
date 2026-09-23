/**
 * Sampling table rules. The table itself (lot range → sample size, optional acceptance and
 * rejection numbers) is master data maintained by QA; nothing here assumes a particular AQL.
 *
 * Row shape: { lotMin, lotMax (null = no upper limit), sampleSize, acceptNo, rejectNo }
 * Lot sizes are whole units; a fractional inward quantity is rounded up.
 */

/** Default when a row has no acceptance number: a single NOK rejects the lot. */
export const DEFAULT_ACCEPT_NO = 0;
export const DEFAULT_REJECT_NO = 1;

const isWhole = (n) => Number.isInteger(n) && n >= 0;

/** Returns { errors, warnings }. Errors block saving; warnings are shown to the user. */
export function validateSamplingRows(rows) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(rows) || rows.length === 0) return { errors: ['Add at least one row.'], warnings };

  const sorted = [...rows].sort((a, b) => a.lotMin - b.lotMin);
  sorted.forEach((r, i) => {
    const label = `Row ${i + 1} (${r.lotMin}–${r.lotMax ?? '∞'})`;
    if (!isWhole(r.lotMin) || r.lotMin < 1) errors.push(`${label}: lot from must be a whole number of at least 1.`);
    if (r.lotMax !== null && r.lotMax !== undefined) {
      if (!isWhole(r.lotMax)) errors.push(`${label}: lot to must be a whole number.`);
      else if (r.lotMax < r.lotMin) errors.push(`${label}: lot to must not be smaller than lot from.`);
    } else if (i !== sorted.length - 1) {
      errors.push(`${label}: only the last row may have no upper limit.`);
    }
    if (!Number.isInteger(r.sampleSize) || r.sampleSize < 1) errors.push(`${label}: sample size must be a whole number of at least 1.`);
    const hasAc = r.acceptNo !== null && r.acceptNo !== undefined;
    const hasRe = r.rejectNo !== null && r.rejectNo !== undefined;
    if (hasAc !== hasRe) errors.push(`${label}: give both acceptance and rejection numbers, or neither.`);
    if (hasAc && hasRe) {
      if (!isWhole(r.acceptNo) || !isWhole(r.rejectNo)) errors.push(`${label}: acceptance and rejection numbers must be whole numbers.`);
      else if (r.rejectNo <= r.acceptNo) errors.push(`${label}: rejection number must be greater than acceptance number.`);
      else if (r.rejectNo > r.sampleSize) errors.push(`${label}: rejection number cannot exceed the sample size.`);
    }

    const next = sorted[i + 1];
    if (next && r.lotMax !== null && r.lotMax !== undefined) {
      if (next.lotMin <= r.lotMax) errors.push(`${label} overlaps the next row starting at ${next.lotMin}.`);
      else if (next.lotMin > r.lotMax + 1) warnings.push(`Lots from ${r.lotMax + 1} to ${next.lotMin - 1} are not covered.`);
    }
  });
  const last = sorted[sorted.length - 1];
  if (last.lotMax !== null && last.lotMax !== undefined) {
    warnings.push(`Lots above ${last.lotMax} are not covered; IMIRs for them cannot be opened until a row is added.`);
  }
  return { errors, warnings };
}

/**
 * Sample for an inward quantity.
 * Returns { lotSize, sampleSize, acceptNo, rejectNo, basis } or null when the table does not cover the lot.
 *   basis TABLE    – taken from a table row (capped at the lot size)
 *   basis FULL_LOT – lot smaller than the first row: every unit is inspected
 */
export function determineSample(rows, inwardQty) {
  const lotSize = Math.ceil(Number(inwardQty));
  if (!Number.isFinite(lotSize) || lotSize < 1) return null;
  const sorted = [...rows].sort((a, b) => a.lotMin - b.lotMin);
  if (sorted.length === 0) return null;

  if (lotSize < sorted[0].lotMin) {
    return { lotSize, sampleSize: lotSize, acceptNo: DEFAULT_ACCEPT_NO, rejectNo: DEFAULT_REJECT_NO, basis: 'FULL_LOT' };
  }
  const row = sorted.find((r) => lotSize >= r.lotMin && (r.lotMax === null || r.lotMax === undefined || lotSize <= r.lotMax));
  if (!row) return null;
  return {
    lotSize,
    sampleSize: Math.min(row.sampleSize, lotSize),
    acceptNo: row.acceptNo ?? DEFAULT_ACCEPT_NO,
    rejectNo: row.rejectNo ?? DEFAULT_REJECT_NO,
    basis: 'TABLE',
  };
}

/** Lot disposition from the number of NOK samples: ACCEPT, REJECT or UNDECIDED (between Ac and Re). */
export function lotDisposition(nokCount, { acceptNo = DEFAULT_ACCEPT_NO, rejectNo = DEFAULT_REJECT_NO } = {}) {
  if (nokCount <= acceptNo) return 'ACCEPT';
  if (nokCount >= rejectNo) return 'REJECT';
  return 'UNDECIDED';
}

/**
 * The table from the Sampling Inspection Procedure, capped at 8 samples: every lot above 25 units
 * takes 8 (confirmed 23 Sep 2026). Seed data only; QA maintains the live table in the app.
 */
export const PROCEDURE_SAMPLING_ROWS = Object.freeze([
  { lotMin: 2, lotMax: 8, sampleSize: 2 },
  { lotMin: 9, lotMax: 15, sampleSize: 3 },
  { lotMin: 16, lotMax: 25, sampleSize: 5 },
  { lotMin: 26, lotMax: null, sampleSize: 8 },
]);

