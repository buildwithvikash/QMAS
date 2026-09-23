/**
 * Inspection format content model and Git-style version handling (Decision 2).
 *
 * A version = { header: { formatNo, commonFormatNo, refStandard }, checkpoints: [...] }.
 * Every checkpoint carries a stable `uid` that survives across versions, so versions are compared
 * per checkpoint and per field — never by row position.
 */

export const SECTIONS = Object.freeze(['DIMENSIONAL', 'VISUAL', 'RELIABILITY']);
export const SECTION_LABELS = Object.freeze({ DIMENSIONAL: 'Dimensional', VISUAL: 'Visual', RELIABILITY: 'Reliability' });

export const HEADER_FIELDS = Object.freeze(['formatNo', 'commonFormatNo', 'refStandard']);
export const CHECKPOINT_FIELDS = Object.freeze(['section', 'checkpoint', 'specification', 'nominal', 'lsl', 'usl', 'uom', 'instrument', 'frequencyMonths']);
const NUMERIC_FIELDS = new Set(['nominal', 'lsl', 'usl', 'frequencyMonths']);

export const FIELD_LABELS = Object.freeze({
  formatNo: 'Format no.', commonFormatNo: 'Common format no.', refStandard: 'Reference standard',
  section: 'Section', checkpoint: 'Check point', specification: 'Specification', nominal: 'Nominal',
  lsl: 'LSL', usl: 'USL', uom: 'Unit', instrument: 'Instrument / method', frequencyMonths: 'Frequency (months)',
  _presence: 'Checkpoint',
});

/** Canonical value for comparison: numbers as numbers, blank strings as null. */
export function normalizeValue(field, value) {
  if (value === undefined || value === null) return null;
  if (NUMERIC_FIELDS.has(field)) {
    if (value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  const s = String(value).trim();
  return s === '' ? null : s;
}

const same = (field, a, b) => normalizeValue(field, a) === normalizeValue(field, b);
const byUid = (checkpoints) => new Map(checkpoints.map((c) => [c.uid, c]));

/**
 * What changed from version `a` to version `b`.
 * Returns { header: [{ field, from, to }], added: [cp], removed: [cp], changed: [{ uid, checkpoint, fields: [{ field, from, to }] }] }.
 * `seq` (row order) is reported separately as `moved` because it is not a content change.
 */
export function diffVersions(a, b) {
  const header = HEADER_FIELDS.filter((f) => !same(f, a.header?.[f], b.header?.[f])).map((field) => ({ field, from: a.header?.[field] ?? null, to: b.header?.[field] ?? null }));
  const am = byUid(a.checkpoints);
  const bm = byUid(b.checkpoints);
  const added = b.checkpoints.filter((c) => !am.has(c.uid));
  const removed = a.checkpoints.filter((c) => !bm.has(c.uid));
  const changed = [];
  const moved = [];
  for (const cb of b.checkpoints) {
    const ca = am.get(cb.uid);
    if (!ca) continue;
    const fields = CHECKPOINT_FIELDS.filter((f) => !same(f, ca[f], cb[f])).map((field) => ({ field, from: ca[field] ?? null, to: cb[field] ?? null }));
    if (fields.length) changed.push({ uid: cb.uid, checkpoint: cb.checkpoint, fields });
    if (ca.seq !== cb.seq) moved.push(cb.uid);
  }
  return { header, added, removed, changed, moved };
}

export const isEmptyDiff = (d) => !d.header.length && !d.added.length && !d.removed.length && !d.changed.length;

/** Field-level three-way pick. Returns { value } or { conflict: true }. */
function pick(field, base, theirs, mine) {
  if (same(field, mine, theirs)) return { value: mine ?? null };
  if (same(field, mine, base)) return { value: theirs ?? null };
  if (same(field, theirs, base)) return { value: mine ?? null };
  return { conflict: true };
}

/**
 * Three-way merge of a draft (`mine`) that was started from `base` onto the currently approved
 * version (`theirs`), as Git does:
 *  - a field changed on one side only takes that side's value;
 *  - the same field changed differently on both sides is a conflict;
 *  - a checkpoint deleted on one side and edited on the other is a conflict (field `_presence`);
 *  - checkpoints added on either side are kept;
 *  - row order never conflicts: the draft's order wins, then approved-only rows follow.
 *
 * `resolutions` (optional) maps "uid|field" (uid '' for header) → chosen value; for `_presence`
 * the value true keeps the checkpoint, false drops it.
 *
 * Returns { merged: { header, checkpoints }, conflicts: [{ uid, field, base, theirs, mine, checkpoint }] }.
 */
export function mergeVersions(base, theirs, mine, resolutions = {}) {
  const conflicts = [];
  const resolved = (uid, field) => Object.prototype.hasOwnProperty.call(resolutions, `${uid}|${field}`);

  const header = {};
  for (const f of HEADER_FIELDS) {
    const r = pick(f, base.header?.[f], theirs.header?.[f], mine.header?.[f]);
    if (!r.conflict) header[f] = r.value;
    else if (resolved('', f)) header[f] = resolutions[`|${f}`];
    else {
      header[f] = theirs.header?.[f] ?? null;
      conflicts.push({ uid: null, field: f, base: base.header?.[f] ?? null, theirs: theirs.header?.[f] ?? null, mine: mine.header?.[f] ?? null, checkpoint: null });
    }
  }

  const bm = byUid(base.checkpoints);
  const tm = byUid(theirs.checkpoints);
  const mm = byUid(mine.checkpoints);
  const out = new Map();

  const mergeCheckpoint = (uid, b, t, m) => {
    const result = { uid };
    for (const f of CHECKPOINT_FIELDS) {
      const r = pick(f, b[f], t[f], m[f]);
      if (!r.conflict) result[f] = r.value;
      else if (resolved(uid, f)) result[f] = resolutions[`${uid}|${f}`];
      else {
        result[f] = t[f] ?? null;
        conflicts.push({ uid, field: f, base: b[f] ?? null, theirs: t[f] ?? null, mine: m[f] ?? null, checkpoint: m.checkpoint ?? t.checkpoint });
      }
    }
    return result;
  };
  const unchanged = (a, b) => CHECKPOINT_FIELDS.every((f) => same(f, a[f], b[f]));

  const uids = new Set([...bm.keys(), ...tm.keys(), ...mm.keys()]);
  for (const uid of uids) {
    const b = bm.get(uid);
    const t = tm.get(uid);
    const m = mm.get(uid);
    if (!b) {
      // Added on one side (uids are unique, so never on both).
      out.set(uid, { ...(m ?? t) });
    } else if (t && m) {
      out.set(uid, mergeCheckpoint(uid, b, t, m));
    } else if (t && !m) {
      // Deleted in the draft.
      if (unchanged(b, t)) continue;
      if (resolved(uid, '_presence')) {
        if (resolutions[`${uid}|_presence`]) out.set(uid, { ...t });
        continue;
      }
      conflicts.push({ uid, field: '_presence', base: true, theirs: true, mine: false, checkpoint: t.checkpoint });
      out.set(uid, { ...t });
    } else if (!t && m) {
      // Deleted in the approved version.
      if (unchanged(b, m)) continue;
      if (resolved(uid, '_presence')) {
        if (resolutions[`${uid}|_presence`]) out.set(uid, { ...m });
        continue;
      }
      conflicts.push({ uid, field: '_presence', base: true, theirs: false, mine: true, checkpoint: m.checkpoint });
    }
    // Deleted on both sides: gone.
  }

  // Order: the draft's rows in the draft's order, then rows only the approved version has.
  const order = [...mine.checkpoints].sort(bySeq).map((c) => c.uid).concat([...theirs.checkpoints].sort(bySeq).map((c) => c.uid));
  const seen = new Set();
  const checkpoints = [];
  for (const uid of order) {
    if (seen.has(uid) || !out.has(uid)) continue;
    seen.add(uid);
    checkpoints.push(out.get(uid));
  }
  return { merged: { header, checkpoints: renumber(checkpoints) }, conflicts };
}

const bySeq = (a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || (a.seq ?? 0) - (b.seq ?? 0);

/** 1..n within each section, keeping the given order. */
export function renumber(checkpoints) {
  const next = {};
  return checkpoints.map((c) => {
    next[c.section] = (next[c.section] ?? 0) + 1;
    return { ...c, seq: next[c.section] };
  });
}

const round3 = (n) => Math.round(n * 1000) / 1000;
const NUM = '[-+]?\\d+(?:\\.\\d+)?';

/**
 * Reads tolerance limits from a legacy specification text (used when importing old formats and as
 * a helper in the editor). Returns { nominal, lsl, usl } or null when no limits can be read.
 *   "57 ± 0.3" "57 +/- 0.3"     → 56.7 … 57.3
 *   "337 +1 / -2" "337 -2 +1"   → 335 … 338
 *   "56.7 - 57.3" "56.7 to 57.3" → 56.7 … 57.3
 *   "<2" "≤ 2" "max 2"          → upper limit 2 (limits are inclusive)
 *   ">0.05" "≥0.05" "min 0.05"  → lower limit 0.05
 */
export function parseSpec(text) {
  if (text === null || text === undefined) return null;
  const s = String(text).replace(/\s+/g, ' ').replace(/[−–]/g, '-').trim().toLowerCase();
  let m;
  if ((m = new RegExp(`^(${NUM}) ?(?:±|\\+/-|\\+-) ?(${NUM})$`).exec(s))) {
    const nom = Number(m[1]);
    const tol = Math.abs(Number(m[2]));
    return { nominal: nom, lsl: round3(nom - tol), usl: round3(nom + tol) };
  }
  if ((m = new RegExp(`^(${NUM}) ?\\+ ?(\\d+(?:\\.\\d+)?) ?/? ?- ?(\\d+(?:\\.\\d+)?)$`).exec(s))) {
    const nom = Number(m[1]);
    return { nominal: nom, lsl: round3(nom - Number(m[3])), usl: round3(nom + Number(m[2])) };
  }
  if ((m = new RegExp(`^(${NUM}) ?- ?(\\d+(?:\\.\\d+)?) ?/? ?\\+ ?(\\d+(?:\\.\\d+)?)$`).exec(s))) {
    const nom = Number(m[1]);
    return { nominal: nom, lsl: round3(nom - Number(m[2])), usl: round3(nom + Number(m[3])) };
  }
  if ((m = new RegExp(`^(${NUM}) ?(?:to|~|-) ?(${NUM})$`).exec(s))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a <= b) return { nominal: null, lsl: a, usl: b };
  }
  if ((m = new RegExp(`^(?:<=?|≤|max\\.?|maximum) ?(${NUM})$`).exec(s))) return { nominal: null, lsl: null, usl: Number(m[1]) };
  if ((m = new RegExp(`^(?:>=?|≥|min\\.?|minimum) ?(${NUM})$`).exec(s))) return { nominal: null, lsl: Number(m[1]), usl: null };
  return null;
}

/** Problems that block submitting a version for approval (beyond per-field validation). */
export function submitProblems(version) {
  const problems = [];
  if (!version.checkpoints.length) problems.push('Add at least one checkpoint before submitting.');
  // The same check point name may repeat ("Dimensions" ×9) as long as the requirement differs.
  const seen = new Set();
  for (const c of version.checkpoints) {
    const key = [c.section, ...['checkpoint', 'specification', 'nominal', 'lsl', 'usl'].map((f) => String(normalizeValue(f, c[f])).toLowerCase())].join('|');
    if (seen.has(key)) problems.push(`${SECTION_LABELS[c.section]}: "${c.checkpoint}" appears twice with the same requirement.`);
    seen.add(key);
  }
  return [...new Set(problems)];
}
