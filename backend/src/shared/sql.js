const toCamel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/** snake_case row → camelCase object (shallow; jsonb values are left as they are). */
export function camelRow(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out;
}

export const camelRows = (rows) => rows.map(camelRow);

/** Escapes LIKE wildcards in user input and wraps it for a "contains" match. */
export const likeContains = (q) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/**
 * ORDER BY from a whitelist: `sortable` maps API field names to SQL expressions.
 * Unknown fields fall back to the default; user input never reaches the SQL text.
 */
export function orderBy(sortable, sort, order, fallback) {
  const expr = sortable[sort] ?? sortable[fallback];
  const dir = order === 'desc' ? 'DESC' : 'ASC';
  return `ORDER BY ${expr} ${dir} NULLS LAST`;
}

export function pageMeta({ page, pageSize }, total) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export const offsetOf = ({ page, pageSize }) => (page - 1) * pageSize;
