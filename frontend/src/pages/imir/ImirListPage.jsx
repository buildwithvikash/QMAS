import { PackageOpen, Tablet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetImirsQuery } from '../../api/imirApi.js';
import { useGetLookupsQuery } from '../../api/mastersApi.js';
import DataTable, { Pagination } from '../../components/ui/DataTable.jsx';
import FilterChips from '../../components/ui/FilterChips.jsx';
import { Select, TextInput } from '../../components/ui/fields.jsx';
import PageHeader, { Tabs } from '../../components/ui/PageHeader.jsx';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDate, formatQty, formatRelative } from '../../utils/format.js';
import { ImirResult, ImirStatus } from './imirUi.jsx';

const GROUPS = [
  { key: 'TO_INSPECT', label: 'To inspect' },
  { key: 'AWAITING_FORMAT', label: 'Waiting for format' },
  { key: 'IN_REVIEW', label: 'In review' },
  { key: 'CLOSED', label: 'Closed' },
  { key: 'ALL', label: 'All' },
];

/** Inward lots from SAP and their IMIRs. Inspectors and SCM/VD requestors see their own plant only. */
export default function ImirListPage() {
  const list = useListParams({ sort: 'createdAt', order: 'desc', filters: { statusGroup: 'TO_INSPECT' }, storageKey: 'imirs' });
  const { data, isFetching, error } = useGetImirsQuery(list.params, { pollingInterval: 60_000 });
  const { data: lookups } = useGetLookupsQuery();
  const navigate = useNavigate();

  const columns = [
    {
      key: 'imirNo',
      header: 'IMIR',
      sortable: true,
      render: (r) => (
        <div>
          <div className="font-mono text-xs font-semibold text-slate-800">{r.imirNo ?? <span className="text-slate-400 font-sans font-normal">not opened</span>}</div>
          <div className="text-[11px] text-slate-400">SAP lot {r.sapLotNo}</div>
        </div>
      ),
    },
    { key: 'grnDate', header: 'GRN', sortable: true, render: (r) => <div className="whitespace-nowrap"><div className="text-sm">{r.grnNo}</div><div className="text-[11px] text-slate-400">{formatDate(r.grnDate)}</div></div> },
    { key: 'itemCode', header: 'Item', sortable: true, render: (r) => <div><span className="font-mono text-xs font-semibold">{r.itemCode}</span><div className="text-xs text-slate-500 max-w-64 truncate">{r.itemDescription}</div></div> },
    { key: 'vendor', header: 'Vendor', render: (r) => <div className="max-w-48"><div className="text-sm truncate">{r.vendorName}</div><div className="text-[11px] text-slate-400">{r.vendorCode}</div></div> },
    { key: 'qty', header: 'Inward qty', align: 'right', render: (r) => <span className="whitespace-nowrap">{formatQty(r.inwardQty, r.uom)}</span> },
    { key: 'sample', header: 'Sample', align: 'right', render: (r) => r.sampleSize ?? '—' },
    { key: 'plant', header: 'Plant', render: (r) => r.plantSapCode },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => (
        <div className="space-y-1">
          <ImirStatus status={r.status} />
          {r.status === 'AWAITING_FORMAT' && <div className="text-[11px] text-amber-700 max-w-56">{r.awaitingReason}</div>}
          {r.checkoutDeviceCode && <div className="flex items-center gap-1 text-[11px] text-slate-500"><Tablet className="w-3 h-3" />{r.checkoutDeviceCode}</div>}
        </div>
      ),
    },
    { key: 'result', header: 'Result', render: (r) => <ImirResult result={r.result} /> },
    { key: 'createdAt', header: 'Received', sortable: true, render: (r) => <span className="text-xs text-slate-400 whitespace-nowrap">{formatRelative(r.createdAt)}</span> },
  ];

  const plant = (lookups?.plants ?? []).find((p) => String(p.id) === String(list.filters.plantId));
  const chips = [
    list.search && { key: 'q', label: 'Search', value: list.search, onRemove: () => list.setSearch('') },
    list.filters.plantId && { key: 'plant', label: 'Plant', value: plant ? `${plant.sapCode} · ${plant.name}` : list.filters.plantId, onRemove: () => list.setFilter('plantId', undefined) },
    list.filters.from && { key: 'from', label: 'GRN from', value: formatDate(list.filters.from), onRemove: () => list.setFilter('from', undefined) },
    list.filters.to && { key: 'to', label: 'GRN to', value: formatDate(list.filters.to), onRemove: () => list.setFilter('to', undefined) },
  ].filter(Boolean);

  return (
    <div>
      <PageHeader icon={PackageOpen} title="Incoming Lots" subtitle="Inward lots from SAP (QA32) and their inspection reports" search={list.search} onSearch={list.setSearch} searchPlaceholder="IMIR, GRN, item, vendor, SAP lot…" />
      <div className="p-5">
        <Tabs tabs={GROUPS} active={list.filters.statusGroup ?? 'ALL'} onChange={(k) => list.setFilter('statusGroup', k === 'ALL' ? undefined : k)} />
        <div className="flex flex-wrap gap-3 mb-3 items-end">
          <Select className="w-52" label="Plant" placeholder="All my plants" value={list.filters.plantId ?? ''} onChange={(v) => list.setFilter('plantId', v)}
            options={(lookups?.plants ?? []).map((p) => ({ value: String(p.id), label: `${p.sapCode} · ${p.name}` }))} />
          <TextInput className="w-40" label="GRN from" type="date" value={list.filters.from ?? ''} onChange={(e) => list.setFilter('from', e.target.value || undefined)} />
          <TextInput className="w-40" label="GRN to" type="date" value={list.filters.to ?? ''} onChange={(e) => list.setFilter('to', e.target.value || undefined)} />
        </div>
        <DataTable columns={columns} rows={data?.rows} loading={isFetching} error={error} sort={list.sort} onSort={list.toggleSort} tableId="imirs"
          toolbar={<FilterChips chips={chips} onClearAll={() => list.clearFilters({ statusGroup: list.filters.statusGroup })} />}
          onRowClick={(r) => navigate(`/imirs/${r.id}`)} empty={chips.length ? 'No lots match these filters.' : 'No lots in this list.'} />
        <Pagination meta={data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </div>
    </div>
  );
}
