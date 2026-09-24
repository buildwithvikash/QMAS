import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { loadPref, savePref } from '../utils/prefs.js';
import { useDebounced } from './useDebounced.js';

/**
 * State for a server-paginated list: search (debounced), sort, page, page size and filters.
 * `params` is ready to pass to an RTK Query list endpoint; changing search/filters resets to page 1.
 * With `storageKey`, filters, sort and page size are remembered on this device. A `?q=` in the
 * address (e.g. from global search) starts the list with that search.
 */
export function useListParams({ sort: initialSort, order: initialOrder = 'asc', pageSize: initialPageSize = 25, filters: initialFilters = {}, storageKey } = {}) {
  const [urlParams] = useSearchParams();
  const saved = storageKey ? loadPref(`list:${storageKey}`, null) : null;
  const [search, setSearchRaw] = useState(() => urlParams.get('q') ?? '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(saved?.pageSize ?? initialPageSize);
  const [sort, setSortState] = useState(saved?.sort ?? { sort: initialSort, order: initialOrder });
  const [filters, setFiltersRaw] = useState(saved?.filters ?? initialFilters);
  const q = useDebounced(search.trim());

  // A new ?q= while the page is open (search again from the top bar) replaces the search.
  const urlQ = urlParams.get('q');
  useEffect(() => {
    if (urlQ !== null) {
      setSearchRaw(urlQ);
      setPage(1);
    }
  }, [urlQ]);

  useEffect(() => {
    if (storageKey) savePref(`list:${storageKey}`, { filters, sort, pageSize });
  }, [storageKey, filters, sort, pageSize]);

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
    /** Back to the page's defaults: filters and search (sort and page size stay). */
    clearFilters: (keep = {}) => { setFiltersRaw({ ...initialFilters, ...keep }); setSearchRaw(''); setPage(1); },
  };
}
