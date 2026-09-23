import { BUSINESS_TIME_ZONE, RESET_SCOPES } from '../constants/enums.js';

/**
 * Configurable document numbering (Decision 9).
 *
 * A pattern is literal text plus tokens:
 *   {PLANT_SAP}   SAP plant code, e.g. 1115
 *   {PLANT_SHORT} 2-digit plant code, e.g. 03
 *   {SRC}         DN source (IL / LN / RL / FD) — DN only
 *   {YYYY} {YY} {MM} {DD}  date parts in IST
 *   {SEQ:n}       running number, zero-padded to n digits (required, exactly once)
 *
 * Example: IMIR{PLANT_SAP}{YY}{MM}{DD}{SEQ:3} → IMIR1115260701001
 */

const TOKEN_RE = /\{([A-Z_]+)(?::(\d+))?\}/g;
const KNOWN_TOKENS = new Set(['PLANT_SAP', 'PLANT_SHORT', 'SRC', 'YYYY', 'YY', 'MM', 'DD', 'SEQ']);
const LITERAL_RE = /^[A-Z0-9\-/_.]*$/;
export const MAX_DOC_NO_LENGTH = 40;

export function parsePattern(pattern) {
  const tokens = [];
  const literals = [];
  let last = 0;
  for (const m of pattern.matchAll(TOKEN_RE)) {
    literals.push(pattern.slice(last, m.index));
    tokens.push({ name: m[1], width: m[2] === undefined ? null : Number(m[2]) });
    last = m.index + m[0].length;
  }
  literals.push(pattern.slice(last));
  return { tokens, literals };
}

/**
 * Returns a list of human-readable problems; empty when the pattern is usable.
 * The date tokens must be at least as fine as the reset scope, otherwise numbers would repeat
 * (e.g. a daily reset without {DD} gives the same number every day).
 */
export function validatePattern(pattern, resetScope, docType) {
  const errors = [];
  if (typeof pattern !== 'string' || pattern.length === 0) return ['Pattern is required.'];
  if (!RESET_SCOPES.includes(resetScope)) errors.push(`Reset scope must be one of ${RESET_SCOPES.join(', ')}.`);

  const { tokens, literals } = parsePattern(pattern);
  for (const t of tokens) {
    if (!KNOWN_TOKENS.has(t.name)) errors.push(`Unknown token {${t.name}}.`);
  }
  for (const lit of literals) {
    if (/[{}]/.test(lit)) errors.push('Braces must only be used around tokens, e.g. {YY}.');
    else if (!LITERAL_RE.test(lit)) errors.push(`Fixed text "${lit}" may only contain capital letters, digits and - / _ .`);
  }

  const seq = tokens.filter((t) => t.name === 'SEQ');
  if (seq.length !== 1) errors.push('The pattern must contain {SEQ:n} exactly once.');
  else if (!seq[0].width || seq[0].width < 1 || seq[0].width > 9) errors.push('{SEQ:n} needs a width from 1 to 9, e.g. {SEQ:3}.');
  for (const t of tokens) {
    if (t.name !== 'SEQ' && t.width !== null) errors.push(`{${t.name}} does not take a width.`);
  }

  const has = (n) => tokens.some((t) => t.name === n);
  const hasYear = has('YY') || has('YYYY');
  if (resetScope === 'DAY' && !(hasYear && has('MM') && has('DD'))) errors.push('A daily reset needs {YY} or {YYYY}, {MM} and {DD} in the pattern.');
  if (resetScope === 'MONTH' && !(hasYear && has('MM'))) errors.push('A monthly reset needs {YY} or {YYYY} and {MM} in the pattern.');
  if (resetScope === 'YEAR' && !hasYear) errors.push('A yearly reset needs {YY} or {YYYY} in the pattern.');
  if (has('SRC') && docType && docType !== 'DN') errors.push('{SRC} is only available for DN numbers.');
  if (!has('PLANT_SAP') && !has('PLANT_SHORT')) errors.push('The pattern must contain {PLANT_SAP} or {PLANT_SHORT}, because counters run per plant.');

  return [...new Set(errors)];
}

const partsCache = new Map();
function formatterFor(timeZone) {
  if (!partsCache.has(timeZone)) {
    partsCache.set(timeZone, new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }));
  }
  return partsCache.get(timeZone);
}

/** Calendar date parts of `date` in the business time zone. */
export function datePartsIn(date, timeZone = BUSINESS_TIME_ZONE) {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(date).map((p) => [p.type, p.value]));
  return { yyyy: parts.year, yy: parts.year.slice(-2), mm: parts.month, dd: parts.day };
}

/** Counter period for a reset scope, e.g. D20260923, M202609, Y2026, ALL. */
export function periodKey(date, resetScope, timeZone = BUSINESS_TIME_ZONE) {
  const { yyyy, mm, dd } = datePartsIn(date, timeZone);
  switch (resetScope) {
    case 'DAY': return `D${yyyy}${mm}${dd}`;
    case 'MONTH': return `M${yyyy}${mm}`;
    case 'YEAR': return `Y${yyyy}`;
    case 'NEVER': return 'ALL';
    default: throw new Error(`Unknown reset scope ${resetScope}`);
  }
}

/**
 * Renders a document number. `ctx` = { plantSapCode, plantShortCode, src, date, seq }.
 * A running number wider than its padding is not truncated (1000 with {SEQ:3} → "1000").
 */
export function formatDocNo(pattern, ctx, timeZone = BUSINESS_TIME_ZONE) {
  const d = datePartsIn(ctx.date ?? new Date(), timeZone);
  return pattern.replace(TOKEN_RE, (_, name, width) => {
    switch (name) {
      case 'PLANT_SAP': return String(ctx.plantSapCode ?? '');
      case 'PLANT_SHORT': return String(ctx.plantShortCode ?? '');
      case 'SRC': return String(ctx.src ?? '');
      case 'YYYY': return d.yyyy;
      case 'YY': return d.yy;
      case 'MM': return d.mm;
      case 'DD': return d.dd;
      case 'SEQ': return String(ctx.seq).padStart(Number(width), '0');
      default: throw new Error(`Unknown token {${name}}`);
    }
  });
}
