import { useMemo, useState } from 'react';

const byKey = (r, k) => r[k];

/**
 * Sorting and paging for a list that is loaded in one go (approval queue, import results,
 * versions), with the same DataTable props as server-paged lists.
 *   const t = useClientTable(rows, { sort: 'submittedAt', order: 'asc', value: (row, key) => ... });
 *   <DataTable rows={t.rows} sort={t.sort} onSort={t.onSort} pagination={t.pagination} />
 * `value` picks the value a column sorts by (default row[key]).
 */
export function useClientTable(all, { sort: initialSort = null, order: initialOrder = 'asc', pageSize: initialPageSize = 25, value = byKey } = {}) {
  const [sort, setSort] = useState({ sort: initialSort, order: initialOrder });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const sorted = useMemo(() => {
    const list = all ?? [];
    if (!sort.sort) return list;
    const dir = sort.order === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => {
      const x = value(a, sort.sort);
      const y = value(b, sort.sort);
      if (x === y) return 0;
      if (x === null || x === undefined || x === '') return 1;
      if (y === null || y === undefined || y === '') return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true })) * dir;
    });
  }, [all, sort, value]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, totalPages);
  return {
    rows: all ? sorted.slice((current - 1) * pageSize, current * pageSize) : undefined,
    all: sorted,
    sort,
    onSort: (key) => setSort((s) => ({ sort: key, order: s.sort === key && s.order === 'asc' ? 'desc' : 'asc' })),
    pagination: {
      meta: { page: current, pageSize, total: sorted.length, totalPages },
      onPage: setPage,
      onPageSize: (n) => { setPageSize(n); setPage(1); },
    },
  };
}
