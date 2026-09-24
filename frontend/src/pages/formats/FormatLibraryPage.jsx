import { FileSpreadsheet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetFormatLibraryQuery } from '../../api/formatsApi.js';
import Badge from '../../components/ui/Badge.jsx';
import DataTable, { Pagination } from '../../components/ui/DataTable.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useListParams } from '../../hooks/useListParams.js';
import { formatRelative } from '../../utils/format.js';
import { VersionTag } from './formatUi.jsx';

const FILTERS = [
  [undefined, 'All items'],
  ['NONE', 'No format yet'],
  ['APPROVED', 'Has approved format'],
  ['PENDING_APPROVAL', 'Pending approval'],
  ['CONFLICT', 'Merge conflict'],
  ['DRAFT', 'Open drafts'],
];

/** Every item and the state of its inspection format — also the format coverage view. */
export default function FormatLibraryPage() {
  const list = useListParams({ sort: 'itemCode', storageKey: 'formats' });
  const { data, isFetching, error } = useGetFormatLibraryQuery(list.params);
  const navigate = useNavigate();

  const columns = [
    { key: 'itemCode', header: 'Item code', sortable: true, className: 'font-mono text-xs font-semibold text-slate-800 whitespace-nowrap' },
    { key: 'description', header: 'Description', sortable: true },
    { key: 'drawingNo', header: 'Drawing', render: (r) => <span className="font-mono text-xs">{r.drawingNo ?? '—'}{r.drawingRev ? ` · ${r.drawingRev}` : ''}</span> },
    { key: 'versionNo', header: 'Approved', sortable: true, render: (r) => (r.versionNo ? <VersionTag no={r.versionNo} /> : <Badge variant="warning">No format</Badge>) },
    {
      key: 'work',
      header: 'Open work',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.conflictCount > 0 && <Badge variant="danger">{r.conflictCount} conflict</Badge>}
          {r.pendingCount > 0 && <Badge variant="info">{r.pendingCount} pending</Badge>}
          {r.draftCount > 0 && <Badge variant="neutral">{r.draftCount} draft</Badge>}
        </div>
      ),
    },
    { key: 'updatedAt', header: 'Last activity', sortable: true, render: (r) => <span className="text-xs text-slate-400 whitespace-nowrap">{r.lastActivity ? formatRelative(r.lastActivity) : '—'}</span> },
  ];

  return (
    <div>
      <PageHeader icon={FileSpreadsheet} title="Format Library" subtitle="One inspection format per item code" search={list.search} onSearch={list.setSearch} searchPlaceholder="Search item code or description…" />
      <div className="p-5">
        <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Filter">
          {FILTERS.map(([value, label]) => (
            <button key={label} type="button" aria-pressed={list.filters.status === value}
              onClick={() => list.setFilter('status', value)}
              className={`px-3 py-1.5 rounded-full border text-xs font-medium cursor-pointer ${list.filters.status === value ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
        <DataTable tableId="formats" rowKey="itemId" columns={columns} rows={data?.rows} loading={isFetching} error={error} sort={list.sort} onSort={list.toggleSort}
          onRowClick={(r) => navigate(`/formats/items/${r.itemId}`)} empty="No items match. Add items in Master Config → Items or import formats." />
        <Pagination meta={data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </div>
    </div>
  );
}
