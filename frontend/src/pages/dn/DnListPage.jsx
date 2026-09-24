import { LIST_FIELDS } from '@qmas/shared';
import { FileX2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetDnsQuery } from '../../api/dnApi.js';
import DataTable, { Pagination } from '../../components/ui/DataTable.jsx';
import FilterChips from '../../components/ui/FilterChips.jsx';
import PageHeader, { Tabs } from '../../components/ui/PageHeader.jsx';
import { useListParams } from '../../hooks/useListParams.js';
import { ruleChips } from '../../utils/filters.js';
import { formatDate, formatDateTime, formatQty } from '../../utils/format.js';
import { DnStatus } from '../deviation/workflowUi.jsx';

const TABS = [
  { key: 'OPEN', label: 'CAPA awaited' },
  { key: 'OVERDUE', label: 'CAPA overdue' },
  { key: 'CAPA_SUBMITTED', label: 'With IQC Head' },
  { key: 'CLOSED', label: 'Closed' },
  { key: 'ALL', label: 'All' },
];

/** DN register: supplier defect notifications and their CAPA status and ageing. */
export default function DnListPage() {
  const list = useListParams({ sort: 'dnDate', order: 'desc', filters: { tab: 'OPEN' }, storageKey: 'dns' });
  const { tab, ...rest } = list.params;
  const params = { ...rest, ...(tab === 'OVERDUE' ? { overdue: 'true' } : tab && tab !== 'ALL' ? { status: tab } : {}) };
  const { data, isFetching, error } = useGetDnsQuery(params, { pollingInterval: 60_000 });
  const navigate = useNavigate();
  const daysOpen = (r) => Math.floor(((r.closedAt ? new Date(r.closedAt) : new Date()) - new Date(r.dnDate)) / 86_400_000);

  const columns = [
    { key: 'dnNo', header: 'DN', sortable: true, render: (r) => <div><div className="font-mono text-xs font-semibold text-slate-800">{r.dnNo}</div><div className="text-[11px] text-slate-400">IMIR {r.imirNo}</div></div> },
    { key: 'dnDate', header: 'Date', sortable: true, render: (r) => <span className="whitespace-nowrap text-sm">{formatDate(r.dnDate)}</span> },
    { key: 'itemCode', header: 'Item', sortable: true, render: (r) => <div><span className="font-mono text-xs font-semibold">{r.itemCode}</span><div className="text-xs text-slate-500 max-w-64 truncate">{r.itemDescription}</div></div> },
    { key: 'vendor', header: 'Vendor', render: (r) => <div className="max-w-48"><div className="text-sm truncate">{r.vendorName}</div><div className="text-[11px] text-slate-400">{r.vendorCode}</div></div> },
    { key: 'defective', header: 'Defective', align: 'right', render: (r) => <span className="whitespace-nowrap">{r.defectiveQty === null ? '—' : formatQty(r.defectiveQty, r.uom)}</span> },
    { key: 'plant', header: 'Plant', render: (r) => r.plantSapCode },
    { key: 'status', header: 'Status', sortable: true, render: (r) => <DnStatus status={r.status} overdue={r.capaOverdue} /> },
    { key: 'capaDueAt', header: 'CAPA due', sortable: true, render: (r) => (r.capaApplicable ? <span className={`text-xs whitespace-nowrap ${r.capaOverdue ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>{formatDateTime(r.capaDueAt)}</span> : <span className="text-xs text-slate-400">Not applicable</span>) },
    { key: 'age', header: 'Days open', align: 'right', render: (r) => daysOpen(r) },
  ];

  return (
    <div>
      <PageHeader icon={FileX2} title="Defect Notifications" subtitle="Supplier DNs from escalated lots, with CAPA status and ageing" search={list.search} onSearch={list.setSearch} searchPlaceholder="DN, IMIR, item, vendor…" />
      <div className="p-5">
        <DataTable columns={columns} rows={data?.rows} loading={isFetching} error={error} sort={list.sort} onSort={list.toggleSort} tableId="dns"
          leading={<Tabs tabs={TABS} active={list.filters.tab ?? 'ALL'} onChange={(k) => list.setFilter('tab', k)} />}
          filter={{ fields: LIST_FIELDS.dns, value: list.filters.filter, onChange: (v) => list.setFilter('filter', v), storageKey: 'dns' }}
          toolbar={<FilterChips chips={[list.search && { key: 'q', label: 'Search', value: list.search, onRemove: () => list.setSearch('') }, ...ruleChips(list, LIST_FIELDS.dns)].filter(Boolean)} onClearAll={() => list.clearFilters({ tab: list.filters.tab })} />}
          onRowClick={(r) => navigate(`/dns/${r.id}`)} empty="No defect notifications in this list." />
        <Pagination meta={data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </div>
    </div>
  );
}
