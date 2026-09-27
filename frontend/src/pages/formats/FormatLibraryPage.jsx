import { PERMISSIONS } from '@qmas/shared';
import {
  AlertTriangle, CheckCircle2, ExternalLink, FileSpreadsheet, FileX2, GitPullRequestDraft, Hammer, History, Info, Layers, ListChecks, PencilLine, Plus, Send,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGetFormatCountsQuery, useGetFormatLibraryQuery, useGetItemFormatHistoryQuery, useGetItemFormatQuery } from '../../api/formatsApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Drawer, { DrawerCard } from '../../components/ui/Drawer.jsx';
import { FilterSelect, SearchBox } from '../../components/ui/ListFilters.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import StatCards from '../../components/ui/StatCards.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { useListParams } from '../../hooks/useListParams.js';
import { formatDateTime, formatRelative } from '../../utils/format.js';
import FormatHistory from './FormatHistory.jsx';
import { groupCheckpoints, SOURCE } from './formatHelpers.js';
import { StatusBadge, VersionTag } from './formatUi.jsx';
import StartDraftModal from './StartDraftModal.jsx';

const STATUS_OPTIONS = [
  { value: 'NONE', label: 'No format yet' },
  { value: 'APPROVED', label: 'Has approved format' },
  { value: 'PENDING_APPROVAL', label: 'Pending approval' },
  { value: 'CONFLICT', label: 'Merge conflict' },
  { value: 'DRAFT', label: 'Open drafts' },
];

/** Every item and the state of its inspection format: coverage, open work, lots waiting, and the builder. */
export default function FormatLibraryPage() {
  const list = useListParams({ sort: 'itemCode', storageKey: 'formats-v2' });
  const { data, isFetching, error } = useGetFormatLibraryQuery(list.params);
  const { data: counts } = useGetFormatCountsQuery();
  const { can } = useAccess();
  const navigate = useNavigate();
  const [preview, setPreview] = useState(null);
  const [start, setStart] = useState(null); // { item?, hasCurrent?, from }
  const canCreate = can(PERMISSIONS.FORMATS_CREATE);
  const status = list.filters.status;
  const setStatus = (v) => list.setFilter('status', status === v ? undefined : v);

  const cards = [
    { key: 'all', label: 'Items', value: counts?.items, icon: Layers, tone: 'blue', isTotal: true, active: !status, onClick: () => list.setFilter('status', undefined),
      note: counts ? `${counts.approved30d} approved in 30 days` : null },
    { key: 'ok', label: 'With approved format', value: counts?.approved, icon: CheckCircle2, tone: 'green', active: status === 'APPROVED', onClick: () => setStatus('APPROVED') },
    { key: 'none', label: 'No format yet', value: counts?.missing, icon: FileX2, tone: 'rose', active: status === 'NONE', onClick: () => setStatus('NONE') },
    { key: 'pending', label: 'Pending approval', value: counts?.pending, icon: Send, tone: 'sky', active: status === 'PENDING_APPROVAL', onClick: () => setStatus('PENDING_APPROVAL') },
    { key: 'drafts', label: 'Open drafts', value: counts?.drafts, icon: GitPullRequestDraft, tone: 'amber', active: status === 'DRAFT', onClick: () => setStatus('DRAFT') },
    (counts?.conflict > 0 || status === 'CONFLICT') && { key: 'conflict', label: 'Merge conflicts', value: counts?.conflict, icon: AlertTriangle, tone: 'violet', active: status === 'CONFLICT', onClick: () => setStatus('CONFLICT') },
  ].filter(Boolean);

  const columns = [
    {
      key: 'itemCode', header: 'Item', sortable: true, text: (r) => `${r.itemCode} ${r.description}`,
      render: (r) => (
        <div className="min-w-0">
          <Link to={`/formats/items/${r.itemId}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2 hover:decoration-blue-700">{r.itemCode}</Link>
          <div className="text-xs text-slate-500 max-w-72 truncate">{r.description}</div>
        </div>
      ),
    },
    { key: 'categoryName', header: 'Category', text: (r) => r.categoryName ?? '', render: (r) => <span className="text-sm text-slate-700">{r.categoryName ?? '—'}</span> },
    { key: 'drawingNo', header: 'Drawing', text: (r) => r.drawingNo ?? '', render: (r) => <span className="font-mono text-xs">{r.drawingNo ?? '—'}{r.drawingRev ? ` · ${r.drawingRev}` : ''}</span> },
    {
      key: 'versionNo', header: 'Format', sortable: true, text: (r) => (r.versionNo ? `v${r.versionNo}` : 'No format'),
      render: (r) => (r.versionNo ? (
        <div>
          <div className="flex items-center gap-1.5"><VersionTag no={r.versionNo} />{r.currentSource === 'CUSTOM' && <span className="rounded bg-violet-100 px-1 text-[10px] font-bold uppercase text-violet-700">Custom</span>}</div>
          <div className="text-[11px] text-slate-400">{r.formatNo ?? 'no format no.'} · {r.checkpointCount} checks</div>
        </div>
      ) : <Badge variant="warning">No format</Badge>),
    },
    {
      key: 'work', header: 'Open work', text: (r) => [r.conflictCount && `${r.conflictCount} conflict`, r.pendingCount && `${r.pendingCount} pending`, r.draftCount && `${r.draftCount} draft`].filter(Boolean).join(', '),
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.conflictCount > 0 && <Badge variant="danger">{r.conflictCount} conflict</Badge>}
          {r.pendingCount > 0 && <Badge variant="info">{r.pendingCount} pending</Badge>}
          {r.draftCount > 0 && <Badge variant="neutral">{r.draftCount} draft</Badge>}
          {!r.conflictCount && !r.pendingCount && !r.draftCount && <span className="text-xs text-slate-300">—</span>}
        </div>
      ),
    },
    { key: 'lotsWaiting', header: 'Lots waiting', sortable: true, align: 'right', text: (r) => r.lotsWaiting, render: (r) => (r.lotsWaiting ? <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 tabular">{r.lotsWaiting}</span> : <span className="text-xs text-slate-300">0</span>) },
    { key: 'updatedAt', header: 'Last activity', sortable: true, text: (r) => (r.lastActivity ? formatDateTime(r.lastActivity) : ''), render: (r) => <span className="text-xs text-slate-500 whitespace-nowrap">{r.lastActivity ? formatRelative(r.lastActivity) : '—'}</span> },
  ];

  const itemOf = (r) => ({ id: r.itemId, itemCode: r.itemCode, description: r.description });
  const rowMenu = (r) => [
    { label: 'Open', icon: ExternalLink, onClick: () => navigate(`/formats/items/${r.itemId}`) },
    ...(canCreate ? [
      { label: r.versionNo ? 'Start a change' : 'Create format', icon: PencilLine, onClick: () => setStart({ item: itemOf(r), hasCurrent: !!r.versionNo, from: r.versionNo ? 'CURRENT' : 'CUSTOM' }) },
      { label: 'Build custom format', icon: Hammer, onClick: () => setStart({ item: itemOf(r), hasCurrent: !!r.versionNo, from: 'CUSTOM' }) },
    ] : []),
    'sep',
    { label: 'History', icon: History, onClick: () => setPreview({ id: r.itemId, tab: 'history' }) },
  ];

  return (
    <div>
      <PageHeader icon={FileSpreadsheet} title="Format Library" subtitle="One inspection format per item code: coverage, drafts in progress, and the format builder">
        {canCreate && <Button size="sm" icon={Plus} onClick={() => setStart({ from: 'CUSTOM' })}>New format</Button>}
      </PageHeader>
      <div className="p-5 space-y-4">
        <StatCards cards={cards} total={counts?.items} />
        {counts?.lotsWaiting > 0 && (
          <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
            <Info className="w-4 h-4 shrink-0" />{counts.lotsWaiting} inward lot{counts.lotsWaiting === 1 ? ' is' : 's are'} waiting for a format.
            <button type="button" onClick={() => list.setFilter('status', 'NONE')} className="font-semibold underline cursor-pointer">Show items without a format</button>
          </p>
        )}
        <DataTable
          tableId="formats"
          rowKey="itemId"
          columns={columns}
          rows={data?.rows}
          loading={isFetching}
          error={error}
          sort={list.sort}
          onSort={list.toggleSort}
          leading={(
            <>
              <FilterSelect label="Format status" value={status} onChange={(v) => list.setFilter('status', v)} options={STATUS_OPTIONS} placeholder="All items" width="w-48" />
              <SearchBox value={list.search} onChange={list.setSearch} placeholder="Item code or description…" />
            </>
          )}
          onRowClick={(r) => navigate(`/formats/items/${r.itemId}`)}
          onPreview={(r) => setPreview({ id: r.itemId, tab: 'details' })}
          activeKey={preview?.id}
          rowMenu={rowMenu}
          selectable
          exportName="format-library"
          pagination={{ meta: data?.meta, onPage: list.setPage, onPageSize: list.setPageSize }}
          empty={list.search || status ? 'No items match these filters.' : 'No items yet. Items come from SAP lots or Master Config.'}
        />
      </div>
      {preview && <FormatPreview key={preview.id} itemId={preview.id} initialTab={preview.tab} onClose={() => setPreview(null)} onStart={(s) => { setPreview(null); setStart(s); }} canCreate={canCreate} />}
      {start && <StartDraftModal item={start.item} hasCurrent={start.hasCurrent} initialFrom={start.from} onClose={() => setStart(null)} />}
    </div>
  );
}

const TABS = [{ key: 'details', label: 'Details' }, { key: 'history', label: 'History' }];

/** Quick look at an item's format from the library: current version, sections, open work, history. */
function FormatPreview({ itemId, initialTab, onClose, onStart, canCreate }) {
  const { data, isLoading } = useGetItemFormatQuery(itemId);
  const { data: events, isFetching } = useGetItemFormatHistoryQuery(itemId);
  const [tab, setTab] = useState(initialTab);
  const navigate = useNavigate();
  if (isLoading || !data) return <Drawer title="Loading…" onClose={onClose}><div className="space-y-3">{[1, 2].map((i) => <div key={i} className="skeleton h-28" />)}</div></Drawer>;
  const { item, current, versions, stats } = data;
  const open = versions.filter((v) => ['DRAFT', 'REJECTED', 'PENDING_APPROVAL', 'CONFLICT'].includes(v.status));
  const groups = current ? groupCheckpoints(current.checkpoints) : [];
  const it = { id: item.id, itemCode: item.itemCode, description: item.description };

  return (
    <Drawer
      title={item.itemCode}
      badge={current ? <Badge variant="success">v{current.versionNo}</Badge> : <Badge variant="warning">No format</Badge>}
      subtitle={item.description}
      tabs={TABS}
      tab={tab}
      onTab={setTab}
      onClose={onClose}
      footer={(
        <>
          <Button icon={ExternalLink} onClick={() => navigate(`/formats/items/${itemId}`)}>Open</Button>
          {canCreate && <Button variant="secondary" icon={PencilLine} onClick={() => onStart({ item: it, hasCurrent: !!current, from: current ? 'CURRENT' : 'CUSTOM' })}>{current ? 'Change' : 'Create'}</Button>}
          {canCreate && <Button variant="secondary" icon={Hammer} onClick={() => onStart({ item: it, hasCurrent: !!current, from: 'CUSTOM' })}>Custom</Button>}
        </>
      )}
    >
      {tab === 'details' ? (
        <>
          <DrawerCard icon={Info} title="Item" rows={[
            ['Item code', item.itemCode], ['Description', item.description], ['Category', item.categoryName], ['Drawing', item.drawingNo ? `${item.drawingNo}${item.drawingRev ? ` rev ${item.drawingRev}` : ''}` : null],
            ['Lots received', stats?.lotsTotal ?? 0], ['Waiting for format', stats?.lotsWaiting ?? 0],
          ]} />
          <DrawerCard icon={ListChecks} title="Approved format" rows={current ? [
            ['Version', `v${current.versionNo}`], ['Format no.', current.formatNo], ['Standard', current.refStandard], ['Source', SOURCE[current.source]],
            ['Approved', `${formatDateTime(current.decidedAt)} · ${current.decidedByName ?? ''}`], ['Checkpoints', current.checkpoints.length],
          ] : [['Status', 'No format approved yet']]}>
            {groups.length > 0 && (
              <ul className="px-4 pb-3 flex flex-wrap gap-1.5">
                {groups.map((g) => <li key={g.key} className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">{g.label} · {g.items.length}</li>)}
              </ul>
            )}
          </DrawerCard>
          {open.length > 0 && (
            <DrawerCard icon={GitPullRequestDraft} title={`Open drafts (${open.length})`}>
              <ul className="px-4 pb-3 divide-y divide-slate-100">
                {open.map((v) => (
                  <li key={v.id} className="py-2 flex items-center gap-2 text-sm">
                    <StatusBadge status={v.status} />
                    <Link to={`/formats/versions/${v.id}`} className="text-blue-700 hover:underline">{v.createdByName}</Link>
                    <span className="ml-auto text-xs text-slate-400">{formatRelative(v.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </DrawerCard>
          )}
        </>
      ) : <FormatHistory events={events} loading={isFetching && !events} />}
    </Drawer>
  );
}
