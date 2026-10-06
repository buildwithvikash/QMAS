/**
 * Checks on a reading while it is typed, from the specification alone: how much of the tolerance
 * it uses, and whether it is close to a limit. Shared by the inspection sheet (also offline).
 */

/** A reading using this share of its tolerance (or more) is close to the limit. */
export const NEAR_LIMIT_SHARE = 0.8;

/** Centre of a characteristic: nominal, else the middle of two limits, else the given fallback. */
function centreOf({ lsl, usl, nominal }, fallback = null) {
  if (nominal !== null && nominal !== undefined) return Number(nominal);
  if (lsl !== null && lsl !== undefined && usl !== null && usl !== undefined) return (Number(lsl) + Number(usl)) / 2;
  return fallback;
}

/**
 * Share of the tolerance a value uses on its side of the centre: 0 at the centre, 1 at the limit,
 * above 1 outside it. Null when that side has no limit.
 */
export function toleranceUse(value, spec, fallbackCentre = null) {
  const c = centreOf(spec, fallbackCentre);
  if (c === null || value === null || value === undefined) return null;
  const v = Number(value);
  const limit = v >= c ? spec.usl : spec.lsl;
  if (limit === null || limit === undefined) return null;
  const half = Math.abs(Number(limit) - c);
  return half > 0 ? Math.abs(v - c) / half : null;
}

/** 'NEAR_LIMIT' when a reading is in spec but uses most of the tolerance, else null. */
export function readingFlag(value, spec) {
  if (value === null || value === undefined || value === '') return null;
  const use = toleranceUse(value, spec);
  if (use !== null && use > 1) return null; // out of spec: already Not OK
  return use !== null && use >= NEAR_LIMIT_SHARE ? 'NEAR_LIMIT' : null;
}
