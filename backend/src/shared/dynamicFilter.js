import { BUSINESS_TIME_ZONE, FILTER_OPERATORS } from '@qmas/shared';
import { AppError } from './AppError.js';
import { likeContains } from './sql.js';

const escapeLike = (v) => v.replace(/[\\%_]/g, (m) => `\\${m}`);
const TODAY = `(now() AT TIME ZONE '${BUSINESS_TIME_ZONE}')::date`;

/**
 * Turns a dynamic filter ({ mode, rules }) into one SQL condition for a list query.
 * `fields` maps each allowed field key to { sql, type, tz? } (tz: timestamptz compared by IST date).
 * `arg(value)` adds a bind parameter and returns its placeholder. Returns null when there is
 * nothing to filter. Unknown fields, operators or bad values are a 422 with the rule's position.
 */
export function buildDynamicFilter(spec, fields, arg) {
  if (!spec?.rules?.length) return null;
  const parts = spec.rules.map((rule, i) => {
    const f = fields[rule.field];
    const bad = (message) => AppError.unprocessable(message, [{ path: `filter.rules.${i}`, message }]);
    if (!f) throw bad(`"${rule.field}" cannot be filtered on.`);
    const op = FILTER_OPERATORS[f.type].find((o) => o.op === rule.op);
    if (!op) throw bad(`"${rule.op}" does not apply to ${f.type} fields.`);
    const v = rule.value;
    const col = f.type === 'date' && f.tz ? `(${f.sql} AT TIME ZONE '${BUSINESS_TIME_ZONE}')::date` : f.sql;

    switch (f.type) {
      case 'text': {
        if (op.op === 'is_empty') return `(${col} IS NULL OR ${col} = '')`;
        if (op.op === 'not_empty') return `(${col} IS NOT NULL AND ${col} <> '')`;
        if (typeof v !== 'string' || !v.trim()) throw bad('Enter the text to look for.');
        const t = v.trim();
        if (op.op === 'contains') return `${col} ILIKE ${arg(likeContains(t))}`;
        if (op.op === 'not_contains') return `(${col} IS NULL OR ${col} NOT ILIKE ${arg(likeContains(t))})`;
        if (op.op === 'starts_with') return `${col} ILIKE ${arg(`${escapeLike(t)}%`)}`;
        return `lower(${col}) = lower(${arg(t)})`;
      }
      case 'number': {
        const num = (x) => {
          const n = Number(x);
          if (x === '' || x === null || x === undefined || !Number.isFinite(n)) throw bad('Enter a number.');
          return n;
        };
        if (op.range) {
          if (!Array.isArray(v) || v.length !== 2) throw bad('Enter both ends of the range.');
          return `${col} BETWEEN ${arg(num(v[0]))} AND ${arg(num(v[1]))}`;
        }
        const sym = { eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op.op];
        return `${col} ${sym} ${arg(num(v))}`;
      }
      case 'date': {
        const date = (x) => {
          if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) throw bad('Enter a date.');
          return x;
        };
        if (op.days) {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1 || n > 3650) throw bad('Enter a number of days (1–3650).');
          return `${col} >= ${TODAY} - ${arg(n)}::int`;
        }
        if (op.range) {
          if (!Array.isArray(v) || v.length !== 2) throw bad('Enter both dates.');
          return `${col} BETWEEN ${arg(date(v[0]))}::date AND ${arg(date(v[1]))}::date`;
        }
        const sym = { on: '=', before: '<', after: '>' }[op.op];
        return `${col} ${sym} ${arg(date(v))}::date`;
      }
      case 'enum': {
        const list = (Array.isArray(v) ? v : [v]).filter((x) => x !== null && x !== undefined && x !== '').map(String);
        if (!list.length) throw bad('Choose at least one value.');
        const allowed = new Set(f.options ?? []);
        if (allowed.size && list.some((x) => !allowed.has(x))) throw bad('That value is not one of the choices.');
        return op.op === 'in' ? `${col} = ANY(${arg(list)})` : `(${col} IS NULL OR NOT (${col} = ANY(${arg(list)})))`;
      }
      case 'bool': {
        if (typeof v !== 'boolean') throw bad('Choose yes or no.');
        return `${col} = ${arg(v)}`;
      }
      default:
        throw bad('Unsupported field.');
    }
  });
  return `(${parts.join(spec.mode === 'any' ? ' OR ' : ' AND ')})`;
}

/**
 * Field definitions for `buildDynamicFilter`: the list's fields from @qmas/shared (types, enum
 * choices) joined with this repository's SQL expressions. Every listed field must have SQL.
 */
export function listFieldMap(fields, sql) {
  return Object.fromEntries(fields.map((f) => {
    const s = sql[f.key];
    if (!s) throw new Error(`No SQL for filter field ${f.key}`);
    const def = typeof s === 'string' ? { sql: s } : s;
    return [f.key, { ...def, type: f.type, options: f.options?.map((o) => o.value) }];
  }));
}
