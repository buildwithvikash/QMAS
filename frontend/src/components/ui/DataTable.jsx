import { ArrowDown, ArrowUp, ChevronsUpDown, ChevronLeft, ChevronRight, Inbox, Loader2 } from 'lucide-react';

/**
 * Server-driven table: sticky header, sortable columns, loading and empty states.
 * columns: [{ key, header, render?(row), sortable?, className?, align? }]
 * sort: { sort, order } and onSort(key) are optional.
 */
export default function DataTable({ columns, rows = [], loading, error, sort, onSort, rowKey = 'id', empty = 'No records found.', onRowClick }) {
  return (
    <div className="relative overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50">
          <tr>
            {columns.map((c) => {
              const active = sort?.sort === c.key;
              const Icon = active ? (sort.order === 'desc' ? ArrowDown : ArrowUp) : ChevronsUpDown;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort.order === 'desc' ? 'descending' : 'ascending') : undefined}
                  className={`px-3 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-widest border-b border-slate-200 whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.headerClassName ?? ''}`}
                >
                  {c.sortable && onSort ? (
                    <button type="button" onClick={() => onSort(c.key)} className="inline-flex items-center gap-1 uppercase tracking-widest hover:text-slate-800 cursor-pointer">
                      {c.header}
                      <Icon className={`w-3 h-3 ${active ? 'text-blue-600' : 'text-slate-300'}`} />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row[rowKey]} onClick={onRowClick ? () => onRowClick(row) : undefined} className={`hover:bg-blue-50/40 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}>
              {columns.map((c) => (
                <td key={c.key} className={`px-3 py-2.5 text-slate-700 align-middle ${c.align === 'right' ? 'text-right tabular' : ''} ${c.className ?? ''}`}>
                  {c.render ? c.render(row) : (row[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="py-14 text-center">
                <div className="flex flex-col items-center gap-2 text-slate-400">
                  <Inbox className="w-8 h-8 opacity-50" />
                  <p className="text-sm">{error ? (error.data?.message ?? 'Could not load the list. Check the connection and try again.') : empty}</p>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" aria-label="Loading" />
        </div>
      )}
    </div>
  );
}

/** "Showing 1–25 of 312" with page size and previous/next, WRL style but compact. */
export function Pagination({ meta, onPage, onPageSize, pageSizes = [10, 25, 50, 100] }) {
  if (!meta || meta.total === 0) return null;
  const from = (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.page * meta.pageSize, meta.total);
  const btn = 'p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mt-3 text-xs text-slate-500">
      <div className="flex items-center gap-3">
        <span className="tabular">
          Showing <b className="text-slate-700">{from}–{to}</b> of <b className="text-slate-700">{meta.total}</b>
        </span>
        {onPageSize && (
          <label className="flex items-center gap-1.5">
            Rows
            <select value={meta.pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="px-2 py-1 border border-slate-200 rounded-lg bg-white cursor-pointer">
              {pageSizes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" className={btn} disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></button>
        <span className="px-2 tabular">Page {meta.page} of {meta.totalPages}</span>
        <button type="button" className={btn} disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)} aria-label="Next page"><ChevronRight className="w-4 h-4" /></button>
      </div>
    </div>
  );
}
