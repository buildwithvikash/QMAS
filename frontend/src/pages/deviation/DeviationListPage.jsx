import { DEPARTMENTS as DEPTS, LIST_FIELDS } from '@qmas/shared';
import { CheckCircle2, ExternalLink, FileSpreadsheet, FileWarning, Gavel, Layers, PackageOpen, Printer, Scale, Siren, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGetDeviationCountsQuery, useGetDeviationsQuery } from '../../api/workflowApi.js';
import { useGetLookupsQuery } from '../../api/mastersApi.js';
import DataTable from '../../components/ui/DataTable.jsx';
import FilterChips from '../../components/ui/FilterChips.jsx';
import { DateRange, FilterSelect, SearchBox } from '../../components/ui/ListFilters.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import StatCards from '../../components/ui/StatCards.jsx';
import { useListParams } from '../../hooks/useListParams.js';
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
  const [preview, setPreview] = useState(null);

  const f = list.filters;
  const statusValue = f.stage ? `s:${f.stage}` : f.stageGroup ? `g:${f.stageGroup}` : f.open ? `o:${f.open}` : undefined;
  const setStatus = (v) => {
    list.setFilter('stage', v?.startsWith('s:') ? v.slice(2) : undefined);
    list.setFilter('stageGroup', v?.startsWith('g:') ? v.slice(2) : undefined);
    list.setFilter('open', v?.startsWith('o:') ? v.slice(2) : undefined);
  };
  const toggle = (v) => setStatus(statusValue === v ? undefined : v);
  const card = (key, label, value, icon, tone, v) => ({ key, label, value, icon, tone, active: statusValue === v, onClick: () => toggle(v) });

  const cards = [
    { key: 'total', label: 'Total deviations', value: counts?.total, icon: Layers, tone: 'blue', isTotal: true, active: !statusValue, onClick: () => setStatus(undefined),
      note: counts ? `${counts.total - counts.closed} open` : null },
    card('dept', 'With SCM / VD', counts?.withDepartment, Users, 'amber', 'g:DEPARTMENT'),
    card('final', 'IQC Head decision', counts?.finalDecision, Gavel, 'violet', 's:FINAL'),
    card('senior', 'Escalated', counts?.escalated, Siren, 'rose', 's:SENIOR'),
    card('qty', 'Awaiting quantities', counts?.quantities, Scale, 'sky', 'g:QUANTITIES'),
    card('closed', 'Closed', counts?.closed, CheckCircle2, 'green', 's:CLOSED'),
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
          <div className="text-[11px] text-slate-400">IMIR: {r.imirNo}</div>
        </div>
      ),
    },
    { key: 'itemCode', header: 'Item', sortable: true, text: (r) => `${r.itemCode} ${r.itemDescription ?? ''}`.trim(), render: (r) => <div><span className="font-mono text-xs font-semibold text-slate-800">{r.itemCode}</span><div className="text-xs text-slate-500 max-w-64 truncate">{r.itemDescription}</div></div> },
    { key: 'vendor', header: 'Vendor', text: (r) => r.vendorName, render: (r) => <div className="max-w-48"><div className="text-sm text-slate-800 truncate">{r.vendorName}</div>{r.vendorCode && <div className="text-[11px] text-slate-400">{r.vendorCode}</div>}</div> },
    { key: 'department', header: 'Dept', text: (r) => r.department, render: (r) => <span className="text-sm">{r.department}</span> },
    { key: 'action', header: 'Disposition', text: (r) => (r.action ? ACTION_NAMES[r.action] : ''), render: (r) => (r.action ? <span className="text-sm">{ACTION_NAMES[r.action]}</span> : <span className="text-xs text-slate-400">suggested {r.suggestedActions.map((a) => ACTION_NAMES[a]).join(' / ')}</span>) },
    { key: 'qty', header: 'Qty', align: 'right', text: (r) => formatQty(r.deviationQty ?? r.inwardQty, r.uom), render: (r) => <span className="whitespace-nowrap tabular">{formatQty(r.deviationQty ?? r.inwardQty, r.uom)}</span> },
    { key: 'plant', header: 'Plant', text: (r) => r.plantName ?? r.plantSapCode, render: (r) => <span className="text-sm">{r.plantName ?? r.plantSapCode}</span> },
    { key: 'stage', header: 'Stage', sortable: true, text: (r) => STAGES[r.stage]?.[0] ?? r.stage, render: (r) => <div className="space-y-1"><DeviationStage stage={r.stage} outcome={r.outcome} />{r.stage === 'UNDER_DEVIATION' && <div className="text-[11px] text-amber-700">due {formatDate(r.qtyDueAt)}</div>}</div> },
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
      <PageHeader icon={FileWarning} title="Deviations" subtitle="Held lots: department review, IQC Head decision, senior escalation and quantities" />
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
              <DateRange label="Raised" from={f.from} to={f.to} onChange={({ from, to }) => { list.setFilter('from', from); list.setFilter('to', to); }} />
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
          selectable
          exportName="deviations"
          pagination={{ meta: data?.meta, onPage: list.setPage, onPageSize: list.setPageSize }}
          empty={filtered ? 'No deviations match these filters.' : 'No deviations yet.'}
        />
      </div>
      {preview && <DeviationPreview key={preview} id={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
