/**
 * Quality insights from inspection history, without AI: measurement drift, supplier risk and the
 * recommended inspection level, the chance a lot fails, and where an inspector should look first.
 * Shared so the server and the inspection sheet (also offline on a tablet) apply the same rules.
 * Every result carries its reasons in plain words, so a person can check the figure.
 */

export const DRIFT_RULES = Object.freeze({
  nearLimitShare: 0.8, // a reading using 80 % of its tolerance is close to the limit
  trendLots: 5, // this many lot averages moving the same way is a trend
  shiftSigma: 2, // a lot average this many standard deviations from history is a shift
  unusualSigma: 3, // a single reading this far from the usual values is unusual
  minHistory: 5, // fewer earlier lots than this: too little history to judge
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

/**
 * One reading while it is being entered: 'NEAR_LIMIT' when it is in spec but uses most of the
 * tolerance, 'UNUSUAL' when it is far from this item's usual values, else null.
 * stats = { mean, sd, n } of earlier individual readings.
 */
export function readingFlag(value, spec, stats) {
  if (value === null || value === undefined || value === '') return null;
  const use = toleranceUse(value, spec, stats?.mean ?? null);
  if (use !== null && use > 1) return null; // out of spec: already Not OK
  if (use !== null && use >= DRIFT_RULES.nearLimitShare) return 'NEAR_LIMIT';
  if (stats && stats.n >= DRIFT_RULES.minHistory * 2 && stats.sd > 0 && Math.abs(Number(value) - stats.mean) > DRIFT_RULES.unusualSigma * stats.sd) return 'UNUSUAL';
  return null;
}

/**
 * Drift of one numeric characteristic across lots. history = earlier lot averages, oldest first
 * ([{ at, mean }]); current = this lot's readings so far. Returns { status, direction, message,
 * stats } where status is NO_DATA, OK, NEAR_LIMIT, SHIFT or TREND.
 */
export function driftCheck({ history = [], current = [], spec = {}, unit = '' }) {
  const u = unit ? ` ${unit}` : '';
  const past = history.map((h) => Number(h.mean)).filter((x) => Number.isFinite(x));
  const now = current.map(Number).filter((x) => Number.isFinite(x));
  const histMean = past.length ? avg(past) : null;
  const histSd = sd(past);
  const stats = { histMean: round(histMean), histSd: round(histSd), lots: past.length };
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
    const up = steps.every((s) => s > 0);
    const down = steps.every((s) => s < 0);
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

/**
 * Supplier risk from recent history (recent lots weigh more: pass weighted counts).
 * h = { lots, nok, majorDeviations, dns, repeatDefects, okStreak }.
 * Returns { score 0-100, level LOW | MEDIUM | HIGH | NEW, recommendation REDUCED | NORMAL | TIGHTENED, nokRate, reasons[] }.
 */
export function supplierRisk(h, { baseRate = 0.05 } = {}) {
  const lots = Number(h.lots ?? 0);
  const nok = Number(h.nok ?? 0);
  const rate = (nok + baseRate * 5) / (lots + 5); // pulled toward the base rate while history is short
  const score = Math.min(100, Math.round(rate * 150 + (h.majorDeviations ?? 0) * 8 + (h.dns ?? 0) * 5 + (h.repeatDefects ?? 0) * 6));
  const reasons = [];
  if (lots > 0) reasons.push(`${Math.round(nok)} of ${Math.round(lots)} recent lots not OK`);
  if (h.majorDeviations) reasons.push(`${h.majorDeviations} major or critical deviation${h.majorDeviations === 1 ? '' : 's'}`);
  if (h.dns) reasons.push(`${h.dns} defect notification${h.dns === 1 ? '' : 's'}`);
  if (h.repeatDefects) reasons.push(`${h.repeatDefects} defect${h.repeatDefects === 1 ? '' : 's'} repeated across lots`);
  if (h.okStreak >= 5) reasons.push(`last ${h.okStreak} lots all OK`);

  if (lots < 3) return { score, level: 'NEW', recommendation: 'NORMAL', nokRate: lots ? round(nok / lots, 3) : null, reasons: [...reasons, 'too little history to judge'] };
  const level = score >= 35 ? 'HIGH' : score >= 15 ? 'MEDIUM' : 'LOW';
  const recommendation = level === 'HIGH' ? 'TIGHTENED' : level === 'LOW' && (h.okStreak ?? 0) >= 5 ? 'REDUCED' : 'NORMAL';
  return { score, level, recommendation, nokRate: round(nok / lots, 3), reasons };
}

export const INSPECTION_LEVELS = Object.freeze({
  REDUCED: 'Reduced inspection: the vendor has a clean record; the Incharge may use a smaller sample.',
  NORMAL: 'Normal inspection as per the sampling table.',
  TIGHTENED: 'Tightened inspection: check the full sample carefully and consider the next sample size up.',
});

/**
 * Chance that a lot is Not OK, from weighted history of the same vendor and item, the vendor, and
 * the item; each level falls back to the wider one while its own history is short.
 * Returns { probability 0-1, level LOW | MEDIUM | HIGH, basis }.
 */
export function defectProbability({ vendorItem = {}, vendor = {}, item = {} }, { baseRate = 0.05, weight = 4 } = {}) {
  const p = (x, prior) => (Number(x.nok ?? 0) + prior * weight) / (Number(x.lots ?? 0) + weight);
  const pItem = p(item, baseRate);
  const pVendor = p(vendor, baseRate);
  const pBoth = p(vendorItem, (pItem + pVendor) / 2);
  const probability = round(pBoth, 3);
  const level = probability >= 0.3 ? 'HIGH' : probability >= 0.12 ? 'MEDIUM' : 'LOW';
  return { probability, level, basis: { vendorItem: round(p(vendorItem, (pItem + pVendor) / 2), 3), vendor: round(pVendor, 3), item: round(pItem, 3) } };
}

/**
 * Where to look first: each checkpoint scored from how often it failed recently, whether it failed
 * in the last lot, its drift and whether it is critical. cps = [{ uid, name, recentLots,
 * recentFails, failedLastLot, drift, critical }]. Returns the top `limit` with reasons.
 */
export function inspectionFocus(cps, limit = 3) {
  return cps
    .map((c) => {
      const reasons = [];
      let score = 0;
      if (c.recentFails > 0) {
        score += 3 * (c.recentFails / Math.max(c.recentLots, 1));
        reasons.push(`failed in ${c.recentFails} of the last ${c.recentLots} lots`);
      }
      if (c.failedLastLot) {
        score += 1;
        reasons.push('failed in the previous lot');
      }
      if (c.drift && ['NEAR_LIMIT', 'SHIFT', 'TREND'].includes(c.drift.status)) {
        score += 1;
        reasons.push(c.drift.status === 'TREND' ? 'drifting toward a limit' : c.drift.status === 'SHIFT' ? 'values have shifted' : 'readings close to a limit');
      }
      if (c.critical && score > 0) score += 0.5;
      return { uid: c.uid, name: c.name, score: round(score, 2), reasons };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
