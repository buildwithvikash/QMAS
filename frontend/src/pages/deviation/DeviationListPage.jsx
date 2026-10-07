import { DEPARTMENTS as DEPTS, LIST_FIELDS, PERMISSIONS as P } from '@qmas/shared';
import {
  CheckCircle2, ChevronDown, Clock, Download, ExternalLink, FileSpreadsheet, FileWarning, Gavel, Layers, Loader2, PackageOpen, Plus, Printer, Scale, Siren, Users, XCircle,
} from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate } from 'react-router-dom';
import { useGetDeviationCountsQuery, useGetDeviationsQuery } from '../../api/workflowApi.js';
import { useGetImirsQuery } from '../../api/imirApi.js';
import { useGetLookupsQuery } from '../../api/mastersApi.js';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PopMenu from '../../components/ui/PopMenu.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import FilterChips from '../../components/ui/FilterChips.jsx';
import { DateRange, FilterSelect, SearchBox } from '../../components/ui/ListFilters.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import StatCards from '../../components/ui/StatCards.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { useListParams } from '../../hooks/useListParams.js';
import { downloadCsv } from '../../utils/csv.js';
import { monthTrend } from '../../utils/stats.js';
import { ruleChips } from '../../utils/filters.js';
import { formatDate, formatQty, formatRelative } from '../../utils/format.js';
import DeviationPreview from './DeviationPreview.jsx';
import { ACTION_NAMES, STAGES } from './workflowLabels.js';
import { DeviationStage } from './workflowUi.jsx';

// Status drop-down: `s:` one stage, `g:` a group of stages, `o:` open / closed.
const STATUS_OPTIONS = [
  { value: 'o:true', label: 'All open' },
  { value: 'g:DEPARTMENT', label: 'With SCM / VD' },
  { value: 's:FINAL', label: 'IQC Head decision' },
  { value: 's:SENIOR', label: 'Escalated' },
  { value: 'g:QUANTITIES', label: 'Awaiting quantities' },
  { value: 's:CLOSED', label: 'Closed' },
];
const DEPARTMENTS = DEPTS.map((d) => ({ value: d, label: d }));

/** Deviations raised when the IQC Head holds a lot, across SCM / VD, IQC Head and senior stages. */
export default function DeviationListPage() {
  const list = useListParams({ sort: 'createdAt', order: 'desc', filters: { open: 'true' }, storageKey: 'deviations-v2' });
  const { data, isFetching, error } = useGetDeviationsQuery(list.params, { pollingInterval: 60_000 });
  const { stage: _s, stageGroup: _g, open: _o, page: _p, pageSize: _ps, sort: _so, order: _or, ...countParams } = list.params;
  const { data: counts } = useGetDeviationCountsQuery(countParams, { pollingInterval: 60_000 });
  const { data: lookups } = useGetLookupsQuery();
  const navigate = useNavigate();
  const { can } = useAccess();
  const [preview, setPreview] = useState(null);
  const [starting, setStarting] = useState(false);

  const f = list.filters;
  const statusValue = f.stage ? `s:${f.stage}` : f.stageGroup ? `g:${f.stageGroup}` : f.open ? `o:${f.open}` : undefined;
  const setStatus = (v) => {
    list.setFilter('stage', v?.startsWith('s:') ? v.slice(2) : undefined);
    list.setFilter('stageGroup', v?.startsWith('g:') ? v.slice(2) : undefined);
    list.setFilter('open', v?.startsWith('o:') ? v.slice(2) : undefined);
  };
  const toggle = (v) => setStatus(statusValue === v ? undefined : v);
  const card = (key, label, value, icon, tone, v) => ({ key, label, value, icon, tone, active: statusValue === v, onClick: () => toggle(v) });

  const trend = counts ? monthTrend(counts.thisMonth, counts.lastMonth) : null;
  const cards = [
    { key: 'total', label: 'Total deviations', value: counts?.total, icon: Layers, tone: 'blue', isTotal: true, active: !statusValue, onClick: () => setStatus(undefined),
      trend, note: counts ? `${counts.total - counts.closed} open${trend !== null ? ' · vs last month' : ''}` : null },
    card('dept', 'With SCM / VD', counts?.withDepartment, Users, 'amber', 'g:DEPARTMENT'),
    card('final', 'IQC Head decision', counts?.finalDecision, Gavel, 'violet', 's:FINAL'),
    card('senior', 'Escalated', counts?.escalated, Siren, 'rose', 's:SENIOR'),
    card('qty', 'Awaiting quantities', counts?.quantities, Scale, 'sky', 'g:QUANTITIES'),
    card('closed', 'Closed', counts?.closed, CheckCircle2, 'green', 's:CLOSED'),
  ];
  // The same stages as tabs above the table, with their counts.
  const tab = (key, label, count, v) => ({ key, label, count, active: (statusValue ?? null) === v, onClick: () => setStatus(v ?? undefined) });
  const tabs = [
    tab('open', 'All open', counts ? counts.total - counts.closed : null, 'o:true'),
    tab('final', 'IQC Head decision', counts?.finalDecision, 's:FINAL'),
    tab('dept', 'With SCM / VD', counts?.withDepartment, 'g:DEPARTMENT'),
    tab('senior', 'Escalated', counts?.escalated, 's:SENIOR'),
    tab('qty', 'Awaiting quantities', counts?.quantities, 'g:QUANTITIES'),
    tab('closed', 'Closed', counts?.closed, 's:CLOSED'),
    tab('all', 'All', counts?.total, null),
  ];

  const columns = [
    {
      key: 'deviationNo',
      header: 'Deviation No.',
      sortable: true,
      text: (r) => r.deviationNo,
      render: (r) => (
        <div>
          <Link to={`/deviations/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:decoration-blue-700">{r.deviationNo}</Link>
          <div className="text-[11px] text-slate-400">
            IMIR:{' '}
            <Link to={`/imirs/${r.imirId}`} onClick={(e) => e.stopPropagation()} title="Open the IMIR"
              className="font-mono text-blue-600 underline decoration-blue-200 underline-offset-2 hover:text-blue-800 hover:decoration-blue-600">{r.imirNo}</Link>
          </div>
        </div>
      ),
    },
    { key: 'itemCode', header: 'Item', sortable: true, text: (r) => `${r.itemCode} ${r.itemDescription ?? ''}`.trim(), render: (r) => <div><span className="font-mono text-xs font-semibold text-slate-800">{r.itemCode}</span><div className="text-xs text-slate-500 max-w-40 truncate" title={r.itemDescription}>{r.itemDescription}</div></div> },
    { key: 'vendor', header: 'Vendor', text: (r) => r.vendorName, render: (r) => <div className="max-w-32"><div className="text-sm text-slate-800 truncate" title={r.vendorName}>{r.vendorName}</div>{r.vendorCode && <div className="text-[11px] text-slate-400">{r.vendorCode}</div>}</div> },
    { key: 'department', header: 'Dept.', text: (r) => r.department ?? 'SCM / VD', render: (r) => <span className="text-sm">{r.department ?? <span className="text-slate-400">SCM / VD</span>}</span> },
    { key: 'action', header: 'Disposition', text: (r) => (r.action ? ACTION_NAMES[r.action] : ''), render: (r) => (r.action ? <span className="text-sm">{ACTION_NAMES[r.action]}</span> : <span className="text-xs text-slate-400">suggested<br />{r.suggestedActions.map((a) => ACTION_NAMES[a]).join(' / ')}</span>) },
    { key: 'qty', header: 'Qty', align: 'right', text: (r) => formatQty(r.deviationQty ?? r.inwardQty, r.uom), render: (r) => <span className="whitespace-nowrap tabular">{formatQty(r.deviationQty ?? r.inwardQty, r.uom)}</span> },
    { key: 'plant', header: 'Plant', text: (r) => r.plantName ?? r.plantSapCode, render: (r) => <span className="text-sm">{r.plantName ?? r.plantSapCode}</span> },
    { key: 'stage', header: 'Stage', sortable: true, text: (r) => STAGES[r.stage]?.[0] ?? r.stage, render: (r) => <div className="space-y-1"><DeviationStage stage={r.stage} outcome={r.outcome} />{r.stage === 'UNDER_DEVIATION' && <div className="text-[11px] text-amber-700">due {formatDate(r.qtyDueAt)}</div>}</div> },
    { key: 'status', header: 'Status', text: (r) => statusOf(r)[0], render: (r) => <StatusPill r={r} /> },
    { key: 'updatedAt', header: 'Updated', sortable: true, text: (r) => formatDate(r.updatedAt), render: (r) => <span className="text-xs text-slate-500 whitespace-nowrap">{formatRelative(r.updatedAt)}</span> },
  ];

  const rowMenu = (r) => [
    { label: 'Open deviation', icon: ExternalLink, onClick: () => navigate(`/deviations/${r.id}`) },
    { label: 'Print (PDF)', icon: Printer, onClick: () => window.open(`/api/v1/deviations/${r.id}/pdf`, '_blank', 'noopener') },
    { label: 'Download Excel', icon: FileSpreadsheet, onClick: () => { window.location.href = `/api/v1/deviations/${r.id}/xlsx`; } },
    'sep',
    { label: 'Open IMIR', icon: PackageOpen, onClick: () => navigate(`/imirs/${r.imirId}`) },
  ];

  const plants = (lookups?.plants ?? []).map((p) => ({ value: String(p.id), label: p.name }));
  const vendors = (lookups?.vendors ?? []).map((v) => ({ value: String(v.id), label: `${v.name} (${v.vendorCode})` }));
  const chips = ruleChips(list, LIST_FIELDS.deviations);
  const filtered = !!(list.search || f.plantId || f.vendorId || f.department || f.from || f.to || statusValue || chips.length);

  return (
    <div>
      <PageHeader icon={FileWarning} title="Deviations" subtitle="Track and manage material deviations from inspection to final decision">
        <ExportMenu params={list.params} columns={columns} />
        {can(P.IMIR_HEAD_DECIDE) && <Button icon={Plus} onClick={() => setStarting(true)}>New Deviation</Button>}
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
          tableId="deviations"
          leading={(
            <>
              <DateRange label="Date Range" from={f.from} to={f.to} onChange={({ from, to }) => { list.setFilter('from', from); list.setFilter('to', to); }} />
              {plants.length > 1 && <FilterSelect label="Plant" value={f.plantId ? String(f.plantId) : undefined} onChange={(v) => list.setFilter('plantId', v)} options={plants} placeholder="All plants" />}
              <FilterSelect label="Vendor" value={f.vendorId ? String(f.vendorId) : undefined} onChange={(v) => list.setFilter('vendorId', v)} options={vendors} placeholder="All vendors" width="w-48" />
              <FilterSelect label="Department" value={f.department} onChange={(v) => list.setFilter('department', v)} options={DEPARTMENTS} placeholder="All" width="w-28" />
              <FilterSelect label="Status" value={statusValue} onChange={setStatus} options={STATUS_OPTIONS} placeholder="All statuses" />
              <SearchBox value={list.search} onChange={list.setSearch} placeholder="Deviation, IMIR, item, vendor…" />
            </>
          )}
          filter={{ fields: LIST_FIELDS.deviations, value: f.filter, onChange: (v) => list.setFilter('filter', v), storageKey: 'deviations' }}
          toolbar={chips.length > 0 && <FilterChips chips={chips} onClearAll={() => list.clearFilters()} />}
          onRowClick={(r) => navigate(`/deviations/${r.id}`)}
          onPreview={(r) => setPreview(r.id)}
          activeKey={preview}
          rowMenu={rowMenu}
          tabs={tabs}
          selectable
          exportName="deviations"
          pagination={{ meta: data?.meta, onPage: list.setPage, onPageSize: list.setPageSize }}
          empty={filtered ? 'No deviations match these filters.' : 'No deviations yet.'}
        />
      </div>
      {preview && <DeviationPreview key={preview} id={preview} onClose={() => setPreview(null)} />}
      {starting && <NewDeviation onClose={() => setStarting(false)} />}
    </div>
  );
}

/** Where a deviation stands in a word: pending, approved, rejected or closed. */
function statusOf(r) {
  if (r.stage === 'CLOSED') {
    if (r.outcome === 'REJECTED') return ['Rejected', 'bg-rose-50 text-rose-700 ring-rose-200', XCircle];
    if (r.outcome === 'AUTO_CLOSED') return ['Auto-closed', 'bg-slate-100 text-slate-600 ring-slate-200', CheckCircle2];
    return ['Closed', 'bg-emerald-50 text-emerald-700 ring-emerald-200', CheckCircle2];
  }
  if (r.finalDecision === 'APPROVED') return ['Approved', 'bg-emerald-50 text-emerald-700 ring-emerald-200', CheckCircle2];
  return ['Pending', 'bg-amber-50 text-amber-800 ring-amber-200', Clock];
}

function StatusPill({ r }) {
  const [label, tone, Icon] = statusOf(r);
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${tone}`}><Icon className="h-3.5 w-3.5" />{label}</span>;
}

/** Export every deviation matching the current filters (all pages) to Excel (CSV). */
function ExportMenu({ params, columns }) {
  const [busy, setBusy] = useState(false);
  const exportAll = async () => {
    setBusy(true);
    try {
      const { page: _p, pageSize: _s, ...rest } = params;
      const rows = [];
      for (let page = 1; page <= 50; page += 1) {
        const q = new URLSearchParams(Object.entries({ ...rest, page, pageSize: 200 }).filter(([, v]) => v !== undefined && v !== null && v !== ''));
        const res = await fetch(`/api/v1/deviations?${q}`, { credentials: 'include' });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Export failed.');
        const body = await res.json();
        rows.push(...body.data);
        if (page >= (body.meta?.totalPages ?? 1)) break;
      }
      downloadCsv('deviations', columns, rows);
      toast.success(`${rows.length} deviation${rows.length === 1 ? '' : 's'} exported`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <PopMenu width="w-72" button={({ open, toggle }) => (
      <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu"
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50 cursor-pointer">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Export<ChevronDown className="h-4 w-4" />
      </button>
    )}>
      <button type="button" role="menuitem" data-close onClick={exportAll} className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
        <FileSpreadsheet className="mt-0.5 h-4 w-4 text-emerald-600" />
        <span><span className="block font-medium">Excel (CSV): all matching</span><span className="block text-xs text-slate-500">Every deviation with the current filters and tab</span></span>
      </button>
      <p className="px-2.5 py-2 text-xs text-slate-500">To export only some rows, tick them in the list and use <b>Export to Excel</b>. Each deviation's own form is under ⋮ → PDF or Excel.</p>
    </PopMenu>
  );
}

/**
 * A deviation starts when the IQC Head holds an escalated lot. Lists the lots waiting for that
 * decision; opening one leads to "Hold for deviation".
 */
function NewDeviation({ onClose }) {
  const { data, isFetching } = useGetImirsQuery({ status: 'WITH_IQC_HEAD', sort: 'createdAt', order: 'asc', page: 1, pageSize: 25 });
  const navigate = useNavigate();
  const lots = data?.rows ?? [];
  return (
    <Modal title="New deviation" subtitle="A deviation starts from an escalated lot" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">Choose a lot waiting for the IQC Head's decision. On its IMIR page use <b>Hold for deviation</b>: the deviation is numbered and sent to SCM and VD.</p>
      {isFetching && !lots.length && <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-12" />)}</div>}
      {!isFetching && !lots.length && <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No lot is waiting for the IQC Head's decision.</p>}
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {lots.map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => navigate(`/imirs/${m.id}`)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 cursor-pointer">
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-xs font-semibold text-blue-700">{m.imirNo}</span>
                <span className="block truncate text-sm text-slate-800">{m.itemCode} · {m.itemDescription}</span>
                <span className="block truncate text-xs text-slate-500">{m.vendorName} · {m.plantName}</span>
              </span>
              <span className="whitespace-nowrap text-xs text-slate-500">{formatQty(m.inwardQty, m.uom)}</span>
              <ExternalLink className="h-4 w-4 text-slate-400" />
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
