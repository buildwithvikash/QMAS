import { FileWarning } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetDeviationsQuery } from '../../api/workflowApi.js';
import DataTable, { Pagination } from '../../components/ui/DataTable.jsx';
import { Select } from '../../components/ui/fields.jsx';
import PageHeader, { Tabs } from '../../components/ui/PageHeader.jsx';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDate, formatQty, formatRelative } from '../../utils/format.js';
import { ACTION_NAMES, STAGES } from './workflowLabels.js';
import { DeviationStage } from './workflowUi.jsx';

const TABS = [
  { key: 'OPEN', label: 'Open' },
  { key: 'SENIOR', label: 'Escalated' },
  { key: 'UNDER_DEVIATION', label: 'Awaiting quantities' },
  { key: 'CLOSED', label: 'Closed' },
  { key: 'ALL', label: 'All' },
];

/** Deviations raised when the IQC Head holds a lot, across SCM / VD, IQC Head and senior stages. */
export default function DeviationListPage() {
  const list = useListParams({ sort: 'createdAt', order: 'desc', filters: { tab: 'OPEN' } });
  const { tab, ...rest } = list.params;
  const params = { ...rest, ...tabFilter(tab) };
  const filters = list.filters;
  const { data, isFetching, error } = useGetDeviationsQuery(params, { pollingInterval: 60_000 });
  const navigate = useNavigate();

  const columns = [
    { key: 'deviationNo', header: 'Deviation', sortable: true, render: (r) => <div><div className="font-mono text-xs font-semibold text-slate-800">{r.deviationNo}</div><div className="text-[11px] text-slate-400">IMIR {r.imirNo}</div></div> },
    { key: 'itemCode', header: 'Item', sortable: true, render: (r) => <div><span className="font-mono text-xs font-semibold">{r.itemCode}</span><div className="text-xs text-slate-500 max-w-64 truncate">{r.itemDescription}</div></div> },
    { key: 'vendor', header: 'Vendor', render: (r) => <div className="text-sm max-w-48 truncate">{r.vendorName}</div> },
    { key: 'department', header: 'Dept', render: (r) => r.department },
    { key: 'action', header: 'Action', render: (r) => (r.action ? ACTION_NAMES[r.action] : <span className="text-xs text-slate-400">suggested {r.suggestedActions.map((a) => ACTION_NAMES[a]).join(' / ')}</span>) },
    { key: 'qty', header: 'Qty', align: 'right', render: (r) => <span className="whitespace-nowrap">{formatQty(r.deviationQty ?? r.inwardQty, r.uom)}</span> },
    { key: 'plant', header: 'Plant', render: (r) => r.plantSapCode },
    { key: 'stage', header: 'Stage', sortable: true, render: (r) => <div className="space-y-1"><DeviationStage stage={r.stage} outcome={r.outcome} />{r.stage === 'UNDER_DEVIATION' && <div className="text-[11px] text-amber-700">due {formatDate(r.qtyDueAt)}</div>}</div> },
    { key: 'updatedAt', header: 'Updated', sortable: true, render: (r) => <span className="text-xs text-slate-400 whitespace-nowrap">{formatRelative(r.updatedAt)}</span> },
  ];

  return (
    <div>
      <PageHeader icon={FileWarning} title="Deviations" subtitle="Held lots: department review, IQC Head decision, senior escalation and quantities" search={list.search} onSearch={list.setSearch} searchPlaceholder="Deviation, IMIR, item, vendor…" />
      <div className="p-5">
        <Tabs tabs={TABS} active={filters.tab ?? 'ALL'} onChange={(k) => list.setFilter('tab', k)} />
        <div className="flex flex-wrap gap-3 mb-3 items-end">
          <Select className="w-44" label="Department" placeholder="SCM and VD" value={filters.department ?? ''} onChange={(v) => list.setFilter('department', v ?? undefined)}
            options={[{ value: 'SCM', label: 'SCM' }, { value: 'VD', label: 'VD' }]} />
        </div>
        <DataTable columns={columns} rows={data?.rows} loading={isFetching} error={error} sort={list.sort} onSort={list.toggleSort}
          onRowClick={(r) => navigate(`/deviations/${r.id}`)} empty="No deviations in this list." />
        <Pagination meta={data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </div>
    </div>
  );
}

function tabFilter(tab) {
  if (tab === 'OPEN') return { open: 'true' };
  if (tab === 'CLOSED') return { open: 'false' };
  if (tab && STAGES[tab]) return { stage: tab };
  return {};
}
