import { LIST_FIELDS } from '@qmas/shared';
import { AlarmClock, CheckCircle2, ClipboardList, ExternalLink, FileSpreadsheet, FileX2, Layers, PackageOpen, Printer, UserCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGetDnCountsQuery, useGetDnsQuery } from '../../api/dnApi.js';
import { useGetLookupsQuery } from '../../api/mastersApi.js';
import DataTable from '../../components/ui/DataTable.jsx';
import FilterChips from '../../components/ui/FilterChips.jsx';
import { DateRange, FilterSelect, SearchBox } from '../../components/ui/ListFilters.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import StatCards from '../../components/ui/StatCards.jsx';
import { useListParams } from '../../hooks/useListParams.js';
import { ruleChips } from '../../utils/filters.js';
import { formatDate, formatDateTime, formatQty } from '../../utils/format.js';
import { DnStatus } from '../deviation/workflowUi.jsx';
import DnPreview from './DnPreview.jsx';

const STATUS_OPTIONS = [
  { value: 'OPEN', label: 'CAPA awaited' },
  { value: 'OVERDUE', label: 'CAPA overdue' },
  { value: 'CAPA_SUBMITTED', label: 'With IQC Head' },
  { value: 'CLOSED', label: 'Closed' },
];
const STATUS_WORD = { OPEN: 'CAPA awaited', CAPA_SUBMITTED: 'With IQC Head', CLOSED: 'Closed' };

/** DN register: supplier defect notifications and their CAPA status and ageing. */
export default function DnListPage() {
  const list = useListParams({ sort: 'dnDate', order: 'desc', storageKey: 'dns-v2' });
  // The Status drop-down is one value; "overdue" is its own query flag.
  const { view, ...rest } = list.params;
  const params = { ...rest, ...(view === 'OVERDUE' ? { overdue: 'true' } : view ? { status: view } : {}) };
  const { data, isFetching, error } = useGetDnsQuery(params, { pollingInterval: 60_000 });
  const { page: _p, pageSize: _ps, sort: _so, order: _o, ...countParams } = rest;
  const { data: counts } = useGetDnCountsQuery(countParams, { pollingInterval: 60_000 });
  const { data: lookups } = useGetLookupsQuery();
  const navigate = useNavigate();
  const [preview, setPreview] = useState(null);
  const daysOpen = (r) => Math.floor(((r.closedAt ? new Date(r.closedAt) : new Date()) - new Date(r.dnDate)) / 86_400_000);

  const f = list.filters;
  const setView = (v) => list.setFilter('view', v);
  const card = (key, label, value, icon, tone, v) => ({ key, label, value, icon, tone, active: f.view === v, onClick: () => setView(f.view === v ? undefined : v) });
  const cards = [
    { key: 'total', label: 'Total DNs', value: counts?.total, icon: Layers, tone: 'blue', isTotal: true, active: !f.view, onClick: () => setView(undefined),
      note: counts ? `${counts.total - counts.closed} open` : null },
    card('open', 'CAPA awaited', counts?.capaAwaited, ClipboardList, 'amber', 'OPEN'),
    card('overdue', 'CAPA overdue', counts?.overdue, AlarmClock, 'rose', 'OVERDUE'),
    card('head', 'With IQC Head', counts?.withHead, UserCheck, 'violet', 'CAPA_SUBMITTED'),
    card('closed', 'Closed', counts?.closed, CheckCircle2, 'green', 'CLOSED'),
  ];

  const columns = [
    {
      key: 'dnNo',
      header: 'DN No.',
      sortable: true,
      text: (r) => r.dnNo,
      render: (r) => (
        <div>
          <Link to={`/dns/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:decoration-blue-700">{r.dnNo}</Link>
          <div className="text-[11px] text-slate-400">IMIR: {r.imirNo}</div>
        </div>
      ),
    },
    { key: 'dnDate', header: 'Date', sortable: true, text: (r) => formatDate(r.dnDate), render: (r) => <span className="whitespace-nowrap text-sm">{formatDate(r.dnDate)}</span> },
    { key: 'itemCode', header: 'Item', sortable: true, text: (r) => `${r.itemCode} ${r.itemDescription ?? ''}`.trim(), render: (r) => <div><span className="font-mono text-xs font-semibold text-slate-800">{r.itemCode}</span><div className="text-xs text-slate-500 max-w-64 truncate">{r.itemDescription}</div></div> },
    { key: 'vendor', header: 'Vendor', text: (r) => `${r.vendorName} (${r.vendorCode})`, render: (r) => <div className="max-w-48"><div className="text-sm text-slate-800 truncate">{r.vendorName}</div><div className="text-[11px] text-slate-400">{r.vendorCode}</div></div> },
    { key: 'defective', header: 'Defective', align: 'right', text: (r) => (r.defectiveQty === null ? '' : formatQty(r.defectiveQty, r.uom)), render: (r) => <span className="whitespace-nowrap tabular">{r.defectiveQty === null ? '—' : formatQty(r.defectiveQty, r.uom)}</span> },
    { key: 'plant', header: 'Plant', text: (r) => r.plantName ?? r.plantSapCode, render: (r) => <span className="text-sm">{r.plantName ?? r.plantSapCode}</span> },
    { key: 'status', header: 'Status', sortable: true, text: (r) => (r.capaOverdue ? 'CAPA overdue' : STATUS_WORD[r.status] ?? r.status), render: (r) => <DnStatus status={r.status} overdue={r.capaOverdue} /> },
    { key: 'capaDueAt', header: 'CAPA due', sortable: true, text: (r) => (r.capaApplicable ? formatDateTime(r.capaDueAt) : 'Not applicable'), render: (r) => (r.capaApplicable ? <span className={`text-xs whitespace-nowrap ${r.capaOverdue ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>{formatDateTime(r.capaDueAt)}</span> : <span className="text-xs text-slate-400">Not applicable</span>) },
    { key: 'age', header: 'Days open', align: 'right', text: (r) => daysOpen(r), render: (r) => <span className="tabular">{daysOpen(r)}</span> },
  ];

  const rowMenu = (r) => [
    { label: 'Open DN', icon: ExternalLink, onClick: () => navigate(`/dns/${r.id}`) },
    { label: 'Print (PDF)', icon: Printer, onClick: () => window.open(`/api/v1/dns/${r.id}/pdf`, '_blank', 'noopener') },
    { label: 'Download Excel', icon: FileSpreadsheet, onClick: () => { window.location.href = `/api/v1/dns/${r.id}/xlsx`; } },
    'sep',
    { label: 'Open IMIR', icon: PackageOpen, onClick: () => navigate(`/imirs/${r.imirId}`) },
  ];

  const plants = (lookups?.plants ?? []).map((p) => ({ value: String(p.id), label: p.name }));
  const vendors = (lookups?.vendors ?? []).map((v) => ({ value: String(v.id), label: `${v.name} (${v.vendorCode})` }));
  const chips = ruleChips(list, LIST_FIELDS.dns);
  const filtered = !!(list.search || f.plantId || f.vendorId || f.from || f.to || f.view || chips.length);

  return (
    <div>
      <PageHeader icon={FileX2} title="Defect Notifications" subtitle="Supplier DNs from escalated lots, with CAPA status and ageing" />
      <div className="p-5 space-y-4">
        <StatCards cards={cards} total={counts?.total} />
        <DataTable
          columns={columns}
          rows={data?.rows}
          loading={isFetching}
          error={error}
          sort={list.sort}
          onSort={list.toggleSort}
          tableId="dns"
          leading={(
            <>
              <DateRange label="DN date" from={f.from} to={f.to} onChange={({ from, to }) => { list.setFilter('from', from); list.setFilter('to', to); }} />
              {plants.length > 1 && <FilterSelect label="Plant" value={f.plantId ? String(f.plantId) : undefined} onChange={(v) => list.setFilter('plantId', v)} options={plants} placeholder="All plants" />}
              <FilterSelect label="Vendor" value={f.vendorId ? String(f.vendorId) : undefined} onChange={(v) => list.setFilter('vendorId', v)} options={vendors} placeholder="All vendors" width="w-48" />
              <FilterSelect label="Status" value={f.view} onChange={setView} options={STATUS_OPTIONS} placeholder="All statuses" />
              <SearchBox value={list.search} onChange={list.setSearch} placeholder="DN, IMIR, item, vendor…" />
            </>
          )}
          filter={{ fields: LIST_FIELDS.dns, value: f.filter, onChange: (v) => list.setFilter('filter', v), storageKey: 'dns' }}
          toolbar={chips.length > 0 && <FilterChips chips={chips} onClearAll={() => list.clearFilters()} />}
          onRowClick={(r) => navigate(`/dns/${r.id}`)}
          onPreview={(r) => setPreview(r.id)}
          activeKey={preview}
          rowMenu={rowMenu}
          selectable
          exportName="defect-notifications"
          pagination={{ meta: data?.meta, onPage: list.setPage, onPageSize: list.setPageSize }}
          empty={filtered ? 'No DNs match these filters.' : 'No defect notifications yet.'}
        />
      </div>
      {preview && <DnPreview key={preview} id={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
