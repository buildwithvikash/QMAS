import { PERMISSIONS as P } from '@qmas/shared';
import { Filter, MoreHorizontal, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGetDnsQuery } from '../../api/dnApi.js';
import { useGetImirsQuery } from '../../api/imirApi.js';
import { useGetDeviationsQuery } from '../../api/workflowApi.js';
import { useAccess } from '../../hooks/useAccess.js';
import { useDebounced } from '../../hooks/useDebounced.js';
import { formatDate, formatQty } from '../../utils/format.js';
import { DeviationStage, DnStatus } from '../deviation/workflowUi.jsx';
import { ImirStatus } from '../imir/imirUi.jsx';

const ROWS = 8;

const lotCols = [
  ['GRN No.', (r) => r.grnNo],
  ['Item Code', (r) => <span className="font-mono text-xs">{r.itemCode}</span>],
  ['Item Description', (r) => <span className="block max-w-64 truncate">{r.itemDescription}</span>],
  ['Vendor', (r) => <span className="block max-w-56 truncate">{r.vendorName}</span>],
  ['Lot Received', (r) => formatDate(r.createdAt)],
  ['Inward Qty', (r) => <span className="tabular">{formatQty(r.inwardQty, r.uom)}</span>],
  ['Status', (r) => <ImirStatus status={r.status} />],
];

const TABS = [
  {
    key: 'due', label: 'Due Inspections', permission: P.IMIR_VIEW, more: '/imirs',
    cols: lotCols, link: (r) => `/imirs/${r.id}`, empty: 'No lots are waiting for inspection.',
  },
  {
    key: 'dev', label: 'Open Deviations', permission: P.DEVIATION_VIEW, more: '/deviations',
    cols: [
      ['Deviation No.', (r) => <span className="font-mono text-xs">{r.deviationNo}</span>],
      ['IMIR No.', (r) => <span className="font-mono text-xs">{r.imirNo}</span>],
      ['Item', (r) => <span className="block max-w-64 truncate">{r.itemCode} · {r.itemDescription}</span>],
      ['Vendor', (r) => <span className="block max-w-56 truncate">{r.vendorName}</span>],
      ['Department', (r) => r.department ?? 'SCM / VD'],
      ['Raised', (r) => formatDate(r.createdAt)],
      ['Stage', (r) => <DeviationStage stage={r.stage} outcome={r.outcome} />],
    ],
    link: (r) => `/deviations/${r.id}`, empty: 'No open deviations.',
  },
  {
    key: 'dn', label: 'Open DNs', permission: P.DN_VIEW, more: '/dns',
    filter: (rows) => rows.filter((r) => r.status !== 'CLOSED').slice(0, ROWS),
    cols: [
      ['DN No.', (r) => <span className="font-mono text-xs">{r.dnNo}</span>],
      ['Item', (r) => <span className="block max-w-64 truncate">{r.itemCode} · {r.itemDescription}</span>],
      ['Vendor', (r) => <span className="block max-w-56 truncate">{r.vendorName}</span>],
      ['DN Date', (r) => formatDate(r.dnDate)],
      ['CAPA Due', (r) => (r.capaApplicable ? formatDate(r.capaDueAt) : 'Not applicable')],
      ['Status', (r) => <DnStatus status={r.status} overdue={r.capaOverdue} />],
    ],
    link: (r) => `/dns/${r.id}`, empty: 'No open defect notifications.',
  },
  {
    key: 'recent', label: 'Recently Received Lots', permission: P.IMIR_VIEW, more: '/imirs',
    cols: lotCols, link: (r) => `/imirs/${r.id}`, empty: 'No lots received yet.',
  },
];

/** Lists at the bottom of Home: lots to inspect, open deviations, open DNs, latest lots. */
export default function LotsTabs() {
  const { can } = useAccess();
  const tabs = TABS.filter((t) => can(t.permission));
  const [active, setActive] = useState(tabs[0]?.key);
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  const navigate = useNavigate();
  // One query per tab; only the shown tab fetches.
  const page = { page: 1, pageSize: ROWS, ...(search && { q: search }) };
  const poll = { pollingInterval: 120_000 };
  const results = {
    due: useGetImirsQuery({ ...page, statusGroup: 'TO_INSPECT', sort: 'createdAt', order: 'asc' }, { ...poll, skip: active !== 'due' }),
    dev: useGetDeviationsQuery({ ...page, open: 'true', sort: 'createdAt', order: 'desc' }, { ...poll, skip: active !== 'dev' }),
    dn: useGetDnsQuery({ ...page, pageSize: 40, sort: 'createdAt', order: 'desc' }, { ...poll, skip: active !== 'dn' }),
    recent: useGetImirsQuery({ ...page, sort: 'createdAt', order: 'desc' }, { ...poll, skip: active !== 'recent' }),
  };
  if (!tabs.length) return null;
  const tab = TABS.find((t) => t.key === active);
  const r = results[active];
  const rows = tab.filter ? tab.filter(r.data?.rows ?? []) : (r.data?.rows ?? []);
  return (
    <section className="card overflow-hidden" aria-label="Lots and records">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4">
        <div role="tablist" className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={t.key === active} onClick={() => setActive(t.key)}
              className={`border-b-2 px-3 py-3 text-sm font-medium cursor-pointer ${t.key === active ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 py-2">
          <label className="relative w-56 sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by GRN, item, vendor…" aria-label="Search this list"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
          </label>
          <Link to={tab.more} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Filter className="h-4 w-4" />Filter
          </Link>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              {tab.cols.map(([h]) => <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium">{h}</th>)}
              <th scope="col" className="px-3 py-2 text-left font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {r.isFetching && !rows.length && [1, 2, 3].map((i) => <tr key={i}><td colSpan={tab.cols.length + 1} className="px-3 py-2"><div className="skeleton h-6" /></td></tr>)}
            {!r.isFetching && !rows.length && <tr><td colSpan={tab.cols.length + 1} className="px-3 py-6 text-center text-slate-500">{search ? 'Nothing matches.' : tab.empty}</td></tr>}
            {rows.map((row) => (
              <tr key={row.id} onClick={() => navigate(tab.link(row))} className="cursor-pointer hover:bg-slate-50/70">
                {tab.cols.map(([h, cell]) => <td key={h} className="whitespace-nowrap px-3 py-2 text-slate-700">{cell(row)}</td>)}
                <td className="px-3 py-2">
                  <Link to={tab.link(row)} onClick={(e) => e.stopPropagation()} aria-label="Open"
                    className="grid h-7 w-7 place-items-center rounded-md border border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-700">
                    <MoreHorizontal className="h-4 w-4" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-slate-100 px-4 py-2 text-right">
        <Link to={tab.more} className="text-xs font-semibold text-blue-700 hover:underline">Open the full list</Link>
      </div>
    </section>
  );
}
