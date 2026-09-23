import { useMemo, useState } from 'react';
import { useDebounced } from './useDebounced.js';

/**
 * State for a server-paginated list: search (debounced), sort, page, page size and filters.
 * `params` is ready to pass to an RTK Query list endpoint; changing search/filters resets to page 1.
 */
export function useListParams({ sort: initialSort, order: initialOrder = 'asc', pageSize: initialPageSize = 25, filters: initialFilters = {} } = {}) {
  const [search, setSearchRaw] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(initialPageSize);
  const [sort, setSortState] = useState({ sort: initialSort, order: initialOrder });
  const [filters, setFiltersRaw] = useState(initialFilters);
  const q = useDebounced(search.trim());

  const params = useMemo(() => {
    const p = { page, pageSize, sort: sort.sort, order: sort.order, ...filters };
    if (q) p.q = q;
    return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  }, [page, pageSize, sort, filters, q]);

  return {
    params,
    search,
    setSearch: (v) => { setSearchRaw(v); setPage(1); },
    sort,
    toggleSort: (key) => setSortState((s) => ({ sort: key, order: s.sort === key && s.order === 'asc' ? 'desc' : 'asc' })),
    setPage,
    setPageSize: (n) => { setPageSizeRaw(n); setPage(1); },
    filters,
    setFilter: (key, value) => { setFiltersRaw((f) => ({ ...f, [key]: value })); setPage(1); },
  };
}
