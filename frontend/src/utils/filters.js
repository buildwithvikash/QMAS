import { FILTER_OPERATORS } from '@qmas/shared';
import { formatDate } from './format.js';

/** Helpers for dynamic filters ({ mode, rules }): readable labels, and matching rows in the browser (reports). */

export const opOf = (field, op) => FILTER_OPERATORS[field.type].find((o) => o.op === op);

export function defaultRule(field) {
  const op = FILTER_OPERATORS[field.type][0];
  return { field: field.key, op: op.op, value: field.type === 'enum' ? [] : field.type === 'bool' ? true : op.range ? ['', ''] : '' };
}

/** A rule is complete when it has what its operator needs. */
export function ruleComplete(rule, field) {
  const o = field && opOf(field, rule.op);
  if (!o) return false;
  const v = rule.value;
  if (o.noValue) return true;
  if (o.multi) return Array.isArray(v) && v.length > 0;
  if (o.range) return Array.isArray(v) && v.every((x) => x !== '' && x !== null && x !== undefined);
  if (field.type === 'bool') return typeof v === 'boolean';
  return v !== '' && v !== null && v !== undefined;
}

const show = (field, v) => {
  if (field.type === 'date') return formatDate(v);
  if (field.type === 'bool') return v ? 'yes' : 'no';
  if (field.type === 'enum') return field.options?.find((o) => o.value === v)?.label ?? v;
  return String(v);
};

/** "Vendor name contains acme", "Result is any of Not OK", "Received in the last 7 days". */
export function ruleLabel(rule, field) {
  const o = opOf(field, rule.op);
  const v = rule.value;
  if (o.noValue) return `${field.label} ${o.label}`;
  if (o.days) return `${field.label} in the last ${v} days`;
  if (o.range) return `${field.label} between ${show(field, v[0])} and ${show(field, v[1])}`;
  if (o.multi) return `${field.label} ${o.op === 'in' ? 'is' : 'is not'} ${v.map((x) => show(field, x)).join(' or ')}`;
  return `${field.label} ${o.label} ${show(field, v)}`;
}

// ── Matching rows in the browser (reports, which load all rows) ───────────────

const dayOf = (v) => (v ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(String(v).length === 10 ? `${v}T00:00:00+05:30` : v)) : null);
const todayMinus = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() - n * 86_400_000));

function matchRule(row, rule, field) {
  const o = opOf(field, rule.op);
  const raw = row[field.key];
  const v = rule.value;
  switch (field.type) {
    case 'text': {
      const s = raw === null || raw === undefined ? '' : String(raw).toLowerCase();
      const t = String(v ?? '').trim().toLowerCase();
      if (o.op === 'is_empty') return s === '';
      if (o.op === 'not_empty') return s !== '';
      if (o.op === 'contains') return s.includes(t);
      if (o.op === 'not_contains') return !s.includes(t);
      if (o.op === 'starts_with') return s.startsWith(t);
      return s === t;
    }
    case 'number': {
      if (raw === null || raw === undefined) return false;
      const n = Number(raw);
      if (o.range) return n >= Number(v[0]) && n <= Number(v[1]);
      return { eq: n === Number(v), ne: n !== Number(v), gt: n > Number(v), gte: n >= Number(v), lt: n < Number(v), lte: n <= Number(v) }[o.op];
    }
    case 'date': {
      const d = dayOf(raw);
      if (!d) return false;
      if (o.days) return d >= todayMinus(Number(v));
      if (o.range) return d >= v[0] && d <= v[1];
      return { on: d === v, before: d < v, after: d > v }[o.op];
    }
    case 'enum':
      return o.op === 'in' ? v.includes(raw) : !v.includes(raw);
    case 'bool':
      return !!raw === v;
    default:
      return true;
  }
}

export function matchesFilter(row, spec, fields) {
  const rules = (spec?.rules ?? []).filter((r) => ruleComplete(r, fields.find((f) => f.key === r.field)));
  if (!rules.length) return true;
  const results = rules.map((r) => matchRule(row, r, fields.find((f) => f.key === r.field)));
  return spec.mode === 'any' ? results.some(Boolean) : results.every(Boolean);
}

/** One removable chip per dynamic-filter condition. */
export function ruleChips(list, fields) {
  const spec = list.filters.filter;
  if (!spec?.rules?.length) return [];
  return spec.rules.map((r, i) => {
    const f = fields.find((x) => x.key === r.field);
    if (!f) return null;
    const rest = spec.rules.filter((_, j) => j !== i);
    return {
      key: `rule-${i}`,
      label: spec.mode === 'any' && i > 0 ? 'or' : 'Where',
      value: ruleLabel(r, f),
      onRemove: () => list.setFilter('filter', rest.length ? { ...spec, rules: rest } : undefined),
    };
  });
}
