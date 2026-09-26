import { LIST_FIELDS, PERMISSIONS as P } from '@qmas/shared';
import { CheckCircle2, ClipboardCheck, ExternalLink, FileSpreadsheet, FileWarning, FileX2, Hourglass, Layers, PackageOpen, Printer, RefreshCw, SearchCheck, Tablet } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGetImirCountsQuery, useGetImirsQuery } from '../../api/imirApi.js';
import { useGetLookupsQuery } from '../../api/mastersApi.js';
import DataTable from '../../components/ui/DataTable.jsx';
import FilterChips from '../../components/ui/FilterChips.jsx';
import { DateRange, FilterSelect, SearchBox } from '../../components/ui/ListFilters.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import StatCards from '../../components/ui/StatCards.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDate, formatQty, formatRelative } from '../../utils/format.js';
import { ruleChips } from '../../utils/filters.js';
import { monthTrend } from '../../utils/stats.js';
import ImirPreview from './ImirPreview.jsx';
import { ImirResult, ImirStatus, STATUS_LABEL } from './imirUi.jsx';

// One Status drop-down over single statuses and the review/closed groups: `s:` a status, `g:` a group.
const STATUS_OPTIONS = [
  { value: 's:OPEN', label: 'To inspect' },
  { value: 's:IN_INSPECTION', label: 'Inspecting' },
  { value: 'g:IN_REVIEW', label: 'In review' },
  { value: 'g:CLOSED', label: 'Closed' },
  { value: 's:CLOSED_REJECTED', label: 'Rejected' },
  { value: 'g:AWAITING_FORMAT', label: 'Waiting for format' },
];

/** Inward lots from SAP and their IMIRs. Inspectors and SCM/VD requestors see their own plant only. */
export default function ImirListPage() {
  const list = useListParams({ sort: 'createdAt', order: 'desc', storageKey: 'imirs-v2' });
  const { data, isFetching, error } = useGetImirsQuery(list.params, { pollingInterval: 60_000 });
  // The figures follow every filter except the status, so each card says how many it would show.
  const { status: _s, statusGroup: _g, page: _p, pageSize: _ps, sort: _so, order: _o, ...countParams } = list.params;
  const { data: counts } = useGetImirCountsQuery(countParams, { pollingInterval: 60_000 });
  const { data: lookups } = useGetLookupsQuery();
  const { can } = useAccess();
  const navigate = useNavigate();
  const [preview, setPreview] = useState(null);

  const f = list.filters;
  const statusValue = f.status ? `s:${f.status}` : f.statusGroup ? `g:${f.statusGroup}` : undefined;
  const setStatus = (v) => {
    list.setFilter('status', v?.startsWith('s:') ? v.slice(2) : undefined);
    list.setFilter('statusGroup', v?.startsWith('g:') ? v.slice(2) : undefined);
  };
  const toggle = (v) => setStatus(statusValue === v ? undefined : v);

  // Month-on-month change in lots received (none when last month had no lots).
  const trend = counts ? monthTrend(counts.thisMonth, counts.lastMonth) : null;
  const cards = [
    { key: 'total', label: 'Total lots', value: counts?.total, icon: Layers, tone: 'blue', isTotal: true, active: !statusValue, onClick: () => setStatus(undefined),
      trend, note: trend !== null ? 'vs last month' : counts ? `${counts.thisMonth} this month` : null },
    { key: 'open', label: 'To inspect', value: counts?.toInspect, icon: ClipboardCheck, tone: 'amber', active: statusValue === 's:OPEN', onClick: () => toggle('s:OPEN') },
    { key: 'insp', label: 'Inspecting', value: counts?.inspecting, icon: SearchCheck, tone: 'sky', active: statusValue === 's:IN_INSPECTION', onClick: () => toggle('s:IN_INSPECTION') },
    { key: 'review', label: 'In review', value: counts?.inReview, icon: Hourglass, tone: 'violet', active: statusValue === 'g:IN_REVIEW', onClick: () => toggle('g:IN_REVIEW') },
    { key: 'closed', label: 'Closed', value: counts?.closed, icon: CheckCircle2, tone: 'green', active: statusValue === 'g:CLOSED', onClick: () => toggle('g:CLOSED') },
    (counts?.awaitingFormat > 0 || statusValue === 'g:AWAITING_FORMAT') && {
      key: 'format', label: 'Waiting for format', value: counts?.awaitingFormat, icon: FileWarning, tone: 'rose', active: statusValue === 'g:AWAITING_FORMAT', onClick: () => toggle('g:AWAITING_FORMAT') },
  ].filter(Boolean);

  const columns = [
    {
      key: 'imirNo',
      header: 'IMIR No.',
      sortable: true,
      text: (r) => r.imirNo ?? '',
      render: (r) => (
        <div>
          {r.imirNo
            ? <Link to={`/imirs/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:decoration-blue-700">{r.imirNo}</Link>
            : <span className="text-xs text-slate-400">not opened</span>}
        </div>
      ),
    },
    { key: 'grnDate', header: 'GRN No.', sortable: true, text: (r) => `${r.grnNo} (${formatDate(r.grnDate)})`, render: (r) => <div className="whitespace-nowrap"><div className="text-sm text-slate-800">{r.grnNo}</div><div className="text-[11px] text-slate-400">{formatDate(r.grnDate)}</div></div> },
    { key: 'itemCode', header: 'Item', sortable: true, text: (r) => `${r.itemCode} ${r.itemDescription ?? ''}`.trim(), render: (r) => <div><span className="font-mono text-xs font-semibold text-slate-800">{r.itemCode}</span><div className="text-xs text-slate-500 max-w-64 truncate">{r.itemDescription}</div></div> },
    { key: 'vendor', header: 'Vendor', text: (r) => `${r.vendorName} (${r.vendorCode})`, render: (r) => <div className="max-w-48"><div className="text-sm text-slate-800 truncate">{r.vendorName}</div><div className="text-[11px] text-slate-400">{r.vendorCode}</div></div> },
    { key: 'qty', header: 'Inward Qty', align: 'right', text: (r) => formatQty(r.inwardQty, r.uom), render: (r) => <span className="whitespace-nowrap tabular">{formatQty(r.inwardQty, r.uom)}</span> },
    { key: 'sample', header: 'Sample', align: 'right', text: (r) => r.sampleSize ?? '', render: (r) => <span className="tabular">{r.sampleSize ?? '—'}</span> },
    { key: 'plant', header: 'Plant', text: (r) => r.plantName ?? r.plantSapCode, render: (r) => <span className="text-sm">{r.plantName ?? r.plantSapCode}</span> },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      text: (r) => STATUS_LABEL[r.status] ?? r.status,
      render: (r) => (
        <div className="space-y-1">
          <ImirStatus status={r.status} />
          {r.status === 'AWAITING_FORMAT' && <div className="text-[11px] text-amber-700 max-w-56">{r.awaitingReason}</div>}
          {r.checkoutDeviceCode && <div className="flex items-center gap-1 text-[11px] text-slate-500"><Tablet className="w-3 h-3" />{r.checkoutDeviceCode}</div>}
        </div>
      ),
    },
    { key: 'result', header: 'Result', text: (r) => r.result ?? '', render: (r) => <ImirResult result={r.result} /> },
    { key: 'createdAt', header: 'Received', sortable: true, text: (r) => formatDate(r.createdAt), render: (r) => <span className="text-xs text-slate-500 whitespace-nowrap" title={formatDate(r.createdAt)}>{formatRelative(r.createdAt)}</span> },
  ];

  const rowMenu = (r) => [
    { label: 'Open IMIR', icon: ExternalLink, onClick: () => navigate(`/imirs/${r.id}`) },
    ...(r.imirNo && r.status !== 'AWAITING_FORMAT' ? [
      { label: 'Print (PDF)', icon: Printer, onClick: () => window.open(`/api/v1/imirs/${r.id}/pdf`, '_blank', 'noopener') },
      { label: 'Download Excel', icon: FileSpreadsheet, onClick: () => { window.location.href = `/api/v1/imirs/${r.id}/xlsx`; } },
    ] : []),
    ...(r.deviationId || r.dnId ? ['sep'] : []),
    ...(r.deviationId ? [{ label: 'Open deviation', icon: FileWarning, onClick: () => navigate(`/deviations/${r.deviationId}`) }] : []),
    ...(r.dnId ? [{ label: 'Open DN', icon: FileX2, onClick: () => navigate(`/dns/${r.dnId}`) }] : []),
  ];

  const plants = (lookups?.plants ?? []).map((p) => ({ value: String(p.id), label: p.name }));
  const vendors = (lookups?.vendors ?? []).map((v) => ({ value: String(v.id), label: `${v.name} (${v.vendorCode})` }));
  const chips = ruleChips(list, LIST_FIELDS.imirs);
  const filtered = !!(list.search || f.plantId || f.vendorId || f.from || f.to || statusValue || chips.length);

  return (
    <div>
      <PageHeader icon={PackageOpen} title="Incoming Lots" subtitle="Inward lots from SAP (QA32) and their inspection reports">
        {can(P.INTEGRATION_MONITOR) && (
          <Link to="/admin/sap-sync" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700">
            <RefreshCw className="w-4 h-4" />SAP sync
          </Link>
        )}
      </PageHeader>
      <div className="p-5 space-y-4">
        <StatCards cards={cards} total={counts?.total} />
        <DataTable
          columns={columns}
          rows={data?.rows}
          loading={isFetching}
          error={error}
          sort={list.sort}
          onSort={list.toggleSort}
          tableId="imirs"
          leading={(
            <>
              <DateRange label="GRN date" from={f.from} to={f.to} onChange={({ from, to }) => { list.setFilter('from', from); list.setFilter('to', to); }} />
              {plants.length > 1 && <FilterSelect label="Plant" value={f.plantId ? String(f.plantId) : undefined} onChange={(v) => list.setFilter('plantId', v)} options={plants} placeholder="All plants" />}
              <FilterSelect label="Vendor" value={f.vendorId ? String(f.vendorId) : undefined} onChange={(v) => list.setFilter('vendorId', v)} options={vendors} placeholder="All vendors" width="w-48" />
              <FilterSelect label="Status" value={statusValue} onChange={setStatus} options={STATUS_OPTIONS} placeholder="All statuses" />
              <SearchBox value={list.search} onChange={list.setSearch} placeholder="IMIR, GRN, item, vendor…" />
            </>
          )}
          filter={{ fields: LIST_FIELDS.imirs, value: f.filter, onChange: (v) => list.setFilter('filter', v), storageKey: 'imirs' }}
          toolbar={chips.length > 0 && <FilterChips chips={chips} onClearAll={() => list.clearFilters()} />}
          onRowClick={(r) => navigate(`/imirs/${r.id}`)}
          onPreview={(r) => setPreview(r.id)}
          activeKey={preview}
          rowMenu={rowMenu}
          selectable
          exportName="incoming-lots"
          pagination={{ meta: data?.meta, onPage: list.setPage, onPageSize: list.setPageSize }}
          empty={filtered ? 'No lots match these filters.' : 'No lots yet. They arrive from SAP (QA32).'}
        />
      </div>
      {preview && <ImirPreview key={preview} id={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
