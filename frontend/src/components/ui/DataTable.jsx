import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Columns3, Inbox } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { loadPref, savePref } from '../../utils/prefs.js';
import FilterBuilder from './FilterBuilder.jsx';

/** Columns the viewer has hidden for a table, remembered on this device. */
function useHiddenColumns(tableId) {
  const [hidden, setHidden] = useState(() => new Set(tableId ? loadPref(`cols:${tableId}`, []) : []));
  const toggle = (key) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (tableId) savePref(`cols:${tableId}`, [...next]);
      return next;
    });
  return [hidden, toggle];
}

function ColumnPicker({ columns, hidden, onToggle }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const choosable = columns.slice(1).filter((c) => c.header && c.hideable !== false);
  if (!choosable.length) return null;
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu"
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer">
        <Columns3 className="w-3.5 h-3.5" />Columns{hidden.size ? ` (${choosable.length - [...hidden].filter((k) => choosable.some((c) => c.key === k)).length}/${choosable.length})` : ''}
      </button>
      {open && (
        <div role="menu" className="animate-fadeIn absolute right-0 mt-1 z-30 w-56 card shadow-lift p-1.5 max-h-80 overflow-auto">
          {choosable.map((c) => (
            <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
              <input type="checkbox" className="accent-blue-600" checked={!hidden.has(c.key)} onChange={() => onToggle(c.key)} />
              {c.header}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Server-driven table: sticky header, sortable columns, skeleton loading, empty state, optional
 * column chooser (pass `tableId` to remember choices) and, on narrow screens, a card per row.
 * columns: [{ key, header, render?(row), sortable?, className?, align?, hideable? }]
 * One control row above the table: `leading` (tabs, pills), `toolbar` (filter chips), then the
 * Filter builder (pass `filter` = { fields, value, onChange, storageKey }) and the column chooser.
 */
export default function DataTable({ columns, rows = [], loading, error, sort, onSort, rowKey = 'id', empty = 'No records found.', emptyAction, onRowClick, tableId, toolbar, leading, filter }) {
  const [hidden, toggle] = useHiddenColumns(tableId);
  const cols = columns.filter((c, i) => i === 0 || !hidden.has(c.key));
  const firstLoad = loading && rows.length === 0;
  const showToolbar = leading || toolbar || tableId || filter;

  return (
    <div>
      {showToolbar && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
          {leading}
          <div className="flex-1 min-w-0">{toolbar}</div>
          <div className="flex items-center gap-2">
            {filter && <FilterBuilder {...filter} />}
            {tableId && <ColumnPicker columns={columns} hidden={hidden} onToggle={toggle} />}
          </div>
        </div>
      )}

      {/* Table: tablets in landscape and desktops */}
      <div className={`relative overflow-x-auto card ${loading && !firstLoad ? 'opacity-70' : ''} transition-opacity hidden md:block`}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-blue-50/70">
            <tr>
              {cols.map((c) => {
                const active = sort?.sort === c.key;
                const Icon = active ? (sort.order === 'desc' ? ArrowDown : ArrowUp) : ChevronsUpDown;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort.order === 'desc' ? 'descending' : 'ascending') : undefined}
                    className={`px-3.5 py-2 text-xs font-semibold text-slate-600 border-b border-slate-200 whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.headerClassName ?? ''}`}
                  >
                    {c.sortable && onSort ? (
                      <button type="button" onClick={() => onSort(c.key)} className={`inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer ${active ? 'text-blue-700' : ''}`}>
                        {c.header}
                        <Icon className={`w-3 h-3 ${active ? 'text-blue-600' : 'text-slate-300'}`} />
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
              {onRowClick && <th aria-hidden="true" className="w-8 border-b border-slate-200" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {firstLoad && Array.from({ length: 6 }, (_, i) => (
              <tr key={`sk${i}`}>
                {cols.map((c, j) => <td key={c.key} className="px-3.5 py-3.5"><div className="skeleton h-3.5" style={{ width: `${45 + ((i * 7 + j * 13) % 45)}%` }} /></td>)}
                {onRowClick && <td />}
              </tr>
            ))}
            {rows.map((row) => (
              <tr
                key={row[rowKey]}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={`group transition-colors ${onRowClick ? 'cursor-pointer hover:bg-blue-50 focus:bg-blue-50 focus:outline-none' : 'hover:bg-slate-50/60'}`}
              >
                {cols.map((c, i) => (
                  <td key={c.key} className={`px-3.5 py-2.5 text-slate-800 align-middle ${i === 0 && onRowClick ? 'relative' : ''} ${c.align === 'right' ? 'text-right tabular' : ''} ${c.className ?? ''}`}>
                    {i === 0 && onRowClick && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-blue-500 opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity" />}
                    {c.render ? c.render(row) : (row[c.key] ?? '—')}
                  </td>
                ))}
                {onRowClick && (
                  <td className="pr-3 text-right">
                    <ChevronRight className="w-4 h-4 text-slate-300 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 group-focus:opacity-100 transition-all" />
                  </td>
                )}
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={cols.length + (onRowClick ? 1 : 0)}>
                  <EmptyState error={error} empty={empty} action={emptyAction} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Cards: phones and tablets in portrait */}
      <div className="md:hidden space-y-2">
        {firstLoad && Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card p-4 space-y-2"><div className="skeleton h-4 w-1/2" /><div className="skeleton h-3 w-3/4" /><div className="skeleton h-3 w-2/3" /></div>
        ))}
        {rows.map((row) => {
          const [head, ...rest] = cols;
          return (
            <div
              key={row[rowKey]}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`card p-4 ${onRowClick ? 'card-hover cursor-pointer' : ''}`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">{head.render ? head.render(row) : row[head.key]}</div>
                {onRowClick && <ChevronRight className="w-4 h-4 text-slate-300 mt-0.5" />}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                {rest.map((c) => (
                  <div key={c.key} className={`min-w-0 ${c.header ? '' : 'col-span-2'}`}>
                    {c.header && <dt className="eyebrow">{c.header}</dt>}
                    <dd className="text-sm text-slate-700 min-w-0">{c.render ? c.render(row) : (row[c.key] ?? '—')}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
        {!loading && rows.length === 0 && <div className="card"><EmptyState error={error} empty={empty} action={emptyAction} /></div>}
      </div>
    </div>
  );
}

function EmptyState({ error, empty, action }) {
  return (
    <div className="flex flex-col items-center gap-2 py-14 px-4 text-center">
      <span className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center"><Inbox className="w-6 h-6 text-slate-400" /></span>
      <p className="text-sm font-medium text-slate-600">{error ? 'Could not load the list' : empty}</p>
      {error && <p className="text-xs text-slate-400">{error.data?.message ?? 'Check the connection and try again.'}</p>}
      {!error && action}
    </div>
  );
}

/** "Showing 1–25 of 312" with page size and previous/next. */
export function Pagination({ meta, onPage, onPageSize, pageSizes = [10, 25, 50, 100] }) {
  if (!meta || meta.total === 0) return null;
  const from = (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.page * meta.pageSize, meta.total);
  const btn = 'p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mt-3 text-xs text-slate-500">
      <div className="flex items-center gap-3">
        <span className="tabular">
          Showing <b className="text-slate-700">{from}–{to}</b> of <b className="text-slate-700">{meta.total.toLocaleString('en-IN')}</b>
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
