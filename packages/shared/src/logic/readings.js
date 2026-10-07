/**
 * Rules for measurements (no AI): how much of the tolerance a reading uses, whether it is close to
 * a limit (inspection sheet, also offline), and drift of a characteristic across lots (the
 * Measurement drift report). Every result explains itself in plain words.
 */

/** A reading using this share of its tolerance (or more) is close to the limit. */
export const NEAR_LIMIT_SHARE = 0.8;

export const DRIFT_RULES = Object.freeze({
  nearLimitShare: NEAR_LIMIT_SHARE, // a reading using 80 % of its tolerance is close to the limit
  trendLots: 5, // this many lot averages moving the same way is a trend
  shiftSigma: 2, // a lot average this many standard deviations from history is a shift
  minHistory: 5, // fewer earlier lots than this: too little history to judge a shift
});

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
function sd(xs) {
  if (xs.length < 2) return 0;
  const m = avg(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}
const round = (x, d = 3) => (x === null || x === undefined || Number.isNaN(x) ? null : Number(x.toFixed(d)));

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

/**
 * Drift of one numeric characteristic across lots. history = earlier lot averages, oldest first
 * ([{ at, mean }]); current = the latest lot's readings. Returns { status, direction, message,
 * stats } where status is NO_DATA, OK, NEAR_LIMIT (a reading close to a limit), SHIFT (this lot's
 * average far from the usual) or TREND (lot averages moving steadily toward a limit).
 */
export function driftCheck({ history = [], current = [], spec = {}, unit = '' }) {
  const u = unit ? ` ${unit}` : '';
  const past = history.map((h) => Number(h.mean)).filter((x) => Number.isFinite(x));
  const now = current.map(Number).filter((x) => Number.isFinite(x));
  const histMean = past.length ? avg(past) : null;
  const histSd = sd(past);
  const stats = { histMean: round(histMean), histSd: round(histSd), lots: past.length, lotMean: now.length ? round(avg(now)) : null };
  if (!past.length && !now.length) return { status: 'NO_DATA', direction: null, message: 'No readings yet.', stats };

  const series = now.length ? [...past, avg(now)] : past;
  const latest = series.at(-1);
  const centre = centreOf(spec, histMean);
  const direction = centre === null ? null : latest >= centre ? 'UP' : 'DOWN';

  // Close to a limit: the most extreme in-spec reading of this lot (or the latest lot average).
  const uses = (now.length ? now : [latest]).map((v) => ({ v, use: toleranceUse(v, spec, histMean) })).filter((x) => x.use !== null && x.use <= 1);
  const worst = uses.sort((a, b) => b.use - a.use)[0];
  if (worst && worst.use >= DRIFT_RULES.nearLimitShare) {
    return {
      status: 'NEAR_LIMIT', direction: Number(worst.v) >= centre ? 'UP' : 'DOWN', stats,
      message: `${round(worst.v)}${u} uses ${Math.round(worst.use * 100)} % of the tolerance, close to the ${Number(worst.v) >= centre ? 'upper' : 'lower'} limit.`,
    };
  }

  // Shift: this lot's average is far from the usual lot averages.
  if (now.length && past.length >= DRIFT_RULES.minHistory) {
    const half = centre !== null ? Math.max(...[spec.usl, spec.lsl].filter((x) => x !== null && x !== undefined).map((l) => Math.abs(Number(l) - centre)), 0) : 0;
    const floor = Math.max(histSd, half * 0.05, 1e-9);
    const gap = avg(now) - histMean;
    if (Math.abs(gap) > DRIFT_RULES.shiftSigma * floor) {
      return {
        status: 'SHIFT', direction: gap > 0 ? 'UP' : 'DOWN', stats,
        message: `This lot averages ${round(avg(now))}${u}, ${gap > 0 ? 'above' : 'below'} the usual ${round(histMean)}${u} (${past.length} earlier lots).`,
      };
    }
  }

  // Trend: the last few lot averages keep moving the same way, toward a limit.
  const tail = series.slice(-DRIFT_RULES.trendLots);
  if (tail.length === DRIFT_RULES.trendLots) {
    const steps = tail.slice(1).map((x, i) => x - tail[i]);
    const up = steps.every((x) => x > 0);
    const down = steps.every((x) => x < 0);
    const limit = up ? spec.usl : down ? spec.lsl : null;
    if ((up || down) && limit !== null && limit !== undefined) {
      const use = toleranceUse(tail.at(-1), spec, histMean);
      if (use !== null && use >= 0.5) {
        return {
          status: 'TREND', direction: up ? 'UP' : 'DOWN', stats,
          message: `Lot averages have ${up ? 'risen' : 'fallen'} ${DRIFT_RULES.trendLots - 1} times in a row (${round(tail[0])} → ${round(tail.at(-1))}${u}), moving toward the ${up ? 'upper' : 'lower'} limit.`,
        };
      }
    }
  }
  return { status: 'OK', direction, message: past.length ? `In line with the usual ${round(histMean)}${u}.` : 'First lot on record.', stats };
}
