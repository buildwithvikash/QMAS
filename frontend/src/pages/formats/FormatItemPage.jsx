import { PERMISSIONS, SECTION_LABELS } from '@qmas/shared';
import { ArrowLeft, Boxes, ClipboardCheck, Copy, ExternalLink, FileCheck2, GitBranch, GitCompare, Hammer, History, Hourglass, Layers, Pencil, PencilLine, Plus } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCreateDraftMutation, useGetItemFormatHistoryQuery, useGetItemFormatQuery } from '../../api/formatsApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Loader from '../../components/ui/Loader.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { useClientTable } from '../../hooks/useClientTable.js';
import { apiError } from '../../utils/apiError.js';
import { formatDateTime, formatRelative } from '../../utils/format.js';
import FormatHistory from './FormatHistory.jsx';
import { groupCheckpoints, SOURCE } from './formatHelpers.js';
import { FormatContent, StatusBadge, VersionTag } from './formatUi.jsx';
import InspectorView from './InspectorView.jsx';
import StartDraftModal from './StartDraftModal.jsx';

const TABS = [['current', 'Current Format', FileCheck2], ['inspector', 'Inspector view', ClipboardCheck], ['versions', 'Drafts & Versions', GitBranch], ['history', 'History', History]];
const PILL = {
  DIMENSIONAL: 'border-blue-200 bg-blue-50 text-blue-800',
  VISUAL: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  RELIABILITY: 'border-amber-200 bg-amber-50 text-amber-800',
  RECORD: 'border-slate-200 bg-slate-50 text-slate-700',
};
const TILE = {
  green: ['border-emerald-100 bg-emerald-50/50', 'bg-emerald-100 text-emerald-600'],
  blue: ['border-blue-100 bg-blue-50/40', 'bg-blue-100 text-blue-600'],
  amber: ['border-amber-100 bg-amber-50/50', 'bg-amber-100 text-amber-600'],
  violet: ['border-violet-100 bg-violet-50/50', 'bg-violet-100 text-violet-600'],
  sky: ['border-sky-100 bg-sky-50/40', 'bg-sky-100 text-sky-600'],
};

function Tile({ icon: Icon, tone, value, label, note, onClick }) {
  const [card, tile] = TILE[tone];
  return (
    <button type="button" onClick={onClick} className={`flex items-center gap-4 text-left rounded-xl border px-4 py-3.5 transition-all hover:shadow-md hover:-translate-y-px cursor-pointer ${card}`}>
      <span className={`w-12 h-12 shrink-0 rounded-xl flex items-center justify-center ${tile}`}><Icon className="w-6 h-6" /></span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-700">{label}</span>
        <span className="block text-2xl font-bold text-slate-900 tabular leading-tight">{value}</span>
        <span className="block text-xs text-slate-500 truncate">{note}</span>
      </span>
    </button>
  );
}

/** A boxed fact of the format header (Format No., Standard, …). */
const Fact = ({ label, sub, children }) => (
  <div className="min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-3">
    <p className="text-xs text-slate-500">{label}</p>
    <div className="mt-1 text-base font-bold text-slate-900 truncate">{children}</div>
    {sub && <p className="text-[11px] text-slate-500 truncate">{sub}</p>}
  </div>
);

/** One item's inspection format: details and figures, the approved format by section, drafts and versions, and history. */
export default function FormatItemPage() {
  const { itemId } = useParams();
  const { user, can } = useAccess();
  const { data, isLoading, error } = useGetItemFormatQuery(Number(itemId));
  const { data: events, isFetching: loadingHistory } = useGetItemFormatHistoryQuery(Number(itemId));
  const [createDraft, { isLoading: opening }] = useCreateDraftMutation();
  const [modal, setModal] = useState(null); // { from, cloneFrom? }
  const [removing, setRemoving] = useState(null);
  const [tab, setTab] = useState('current');
  const navigate = useNavigate();
  const versions = data?.versions ?? [];
  const tables = {
    open: useClientTable(versions.filter((v) => ['DRAFT', 'REJECTED', 'PENDING_APPROVAL', 'CONFLICT'].includes(v.status)), { sort: 'createdAt', order: 'desc', pageSize: 10 }),
    approved: useClientTable(versions.filter((v) => v.versionNo), { sort: 'versionNo', order: 'desc', pageSize: 10 }),
  };

  if (isLoading) return <Loader />;
  if (error) return <p className="p-6 text-sm text-rose-600">{apiError(error).message}</p>;
  const { item, current, stats } = data;
  const canCreate = can(PERMISSIONS.FORMATS_CREATE);
  const open = versions.filter((v) => ['DRAFT', 'REJECTED', 'PENDING_APPROVAL', 'CONFLICT'].includes(v.status));
  const approvedVersions = versions.filter((v) => v.versionNo);
  const groups = current ? groupCheckpoints(current.checkpoints) : [];
  const kinds = ['DIMENSIONAL', 'VISUAL', 'RELIABILITY', 'RECORD'].map((k) => [k, current?.checkpoints.filter((c) => c.section === k).length ?? 0]).filter(([, n]) => n);
  // The user's own open draft is continued only if it holds the approved format (or has work in it);
  // an empty draft started before the current version was approved would open as an empty format.
  const ownDraft = open.find((v) => ['DRAFT', 'REJECTED'].includes(v.status) && v.createdBy === user?.id
    && (!current || v.baseVersionNo === current.versionNo || v.checkpointCount > 0));
  const itemRef = { id: item.id, itemCode: item.itemCode, description: item.description };

  /** Changes to an approved format go into a draft: the user's own open one, or a new one from the current version. */
  const openDraft = async (query = '') => {
    try {
      let id = ownDraft?.id;
      if (!id) {
        id = (await createDraft({ itemId: item.id, from: current ? 'CURRENT' : 'CUSTOM' }).unwrap()).id;
        toast.success(current ? `Draft started from v${current.versionNo}` : 'Draft started');
      }
      navigate(`/formats/versions/${id}/edit${query}`);
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  const scrollTo = (key) => document.getElementById(`fmt-${encodeURIComponent(key)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const openCols = [
    { key: 'status', header: 'Status', sortable: true, text: (v) => v.status, render: (v) => <StatusBadge status={v.status} /> },
    { key: 'createdByName', header: 'Started by', sortable: true, render: (v) => <span className="font-medium text-slate-800">{v.createdByName}{v.createdBy === user?.id && <span className="ml-1 text-[10px] text-blue-700">(you)</span>}</span> },
    { key: 'source', header: 'Source', text: (v) => SOURCE[v.source], render: (v) => SOURCE[v.source] },
    { key: 'baseVersionNo', header: 'Based on', sortable: true, text: (v) => (v.baseVersionNo ? `v${v.baseVersionNo}` : 'first format'), render: (v) => (v.baseVersionNo ? <VersionTag no={v.baseVersionNo} /> : <span className="text-xs text-slate-400">first format</span>) },
    { key: 'checkpointCount', header: 'Checks', sortable: true, align: 'right' },
    { key: 'createdAt', header: 'Started', sortable: true, text: (v) => formatDateTime(v.createdAt), render: (v) => <span className="text-xs text-slate-600 whitespace-nowrap" title={formatDateTime(v.createdAt)}>{formatRelative(v.createdAt)}</span> },
    { key: 'submittedAt', header: 'Submitted', sortable: true, text: (v) => formatDateTime(v.submittedAt), render: (v) => <span className="text-xs text-slate-600 whitespace-nowrap">{v.submittedAt ? formatRelative(v.submittedAt) : '—'}</span> },
  ];
  const approvedCols = [
    { key: 'versionNo', header: 'Version', sortable: true, text: (v) => `v${v.versionNo}`, render: (v) => <Link to={`/formats/versions/${v.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs font-semibold text-blue-700 underline decoration-blue-300 underline-offset-2">v{v.versionNo}</Link> },
    { key: 'status', header: 'Status', text: (v) => v.status, render: (v) => (v.status === 'APPROVED' ? <Badge variant="success">Current</Badge> : <StatusBadge status={v.status} />) },
    { key: 'source', header: 'Source', text: (v) => SOURCE[v.source], render: (v) => SOURCE[v.source] },
    { key: 'checkpointCount', header: 'Checks', sortable: true, align: 'right' },
    { key: 'createdByName', header: 'Prepared by', sortable: true },
    { key: 'decidedByName', header: 'Approved by', sortable: true },
    { key: 'decidedAt', header: 'Approved on', sortable: true, text: (v) => formatDateTime(v.decidedAt), render: (v) => <span className="text-xs text-slate-600 whitespace-nowrap">{formatDateTime(v.decidedAt)}</span> },
    { key: 'mergeNote', header: 'Note', render: (v) => <span className="text-xs text-slate-500">{v.mergeNote ?? v.decisionRemark ?? ''}</span> },
  ];
  const versionMenu = (v) => [
    { label: 'Open', icon: ExternalLink, onClick: () => navigate(`/formats/versions/${v.id}`) },
    ...(current && v.id !== current.id && v.versionNo ? [{ label: `Compare with v${current.versionNo}`, icon: GitCompare, onClick: () => navigate(`/formats/versions/${v.id}`) }] : []),
    ...(canCreate && v.versionNo ? [{ label: 'Duplicate to another item', icon: Copy, onClick: () => setModal({ from: 'CLONE', cloneFrom: { versionId: v.id, itemCode: item.itemCode, versionNo: v.versionNo, itemId: item.id } }) }] : []),
  ];

  return (
    <div>
      <PageHeader icon={GitBranch} title={<span className="inline-flex items-center gap-2">{item.itemCode} - {item.description}<Badge variant={item.isActive ? 'success' : 'neutral'}>{item.isActive ? 'Active' : 'Inactive'}</Badge></span>}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2">Drawing {item.drawingNo ?? '—'}{item.drawingRev ? ` rev ${item.drawingRev}` : ''}{item.categoryName && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">Item Category : {item.categoryName}</span>}</span>}>
        <Link to="/formats" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"><ArrowLeft className="w-3.5 h-3.5" />Back to Library</Link>
        {canCreate && current && <Button size="sm" variant="secondary" icon={Pencil} loading={opening} onClick={() => openDraft()} className="text-blue-700! border-blue-300!">{ownDraft ? 'Continue editing' : 'Edit Format'}</Button>}
        {canCreate && current && <Button size="sm" variant="secondary" icon={Copy} onClick={() => setModal({ from: 'CLONE', cloneFrom: { versionId: current.id, itemCode: item.itemCode, versionNo: current.versionNo, itemId: item.id } })} className="text-blue-700! border-blue-300!">Duplicate</Button>}
        {canCreate && <Button size="sm" icon={current ? PencilLine : Hammer} onClick={() => setModal({ from: current ? 'CURRENT' : 'CUSTOM' })}>{current ? 'Start a change' : 'Create format'}<Plus className="w-4 h-4" /></Button>}
      </PageHeader>

      <div className="p-5 space-y-4">
        {current ? (
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,1.4fr)]">
            <Fact label="Format No.">{current.formatNo ?? '—'}</Fact>
            <Fact label="Common Format No.">{current.commonFormatNo ?? '—'}</Fact>
            <Fact label="Standard">{current.refStandard ?? '—'}</Fact>
            <Fact label="Current Version">
              {approvedVersions.length > 1 ? (
                <select value={current.id} onChange={(e) => e.target.value !== current.id && navigate(`/formats/versions/${e.target.value}`)} aria-label="Open a version"
                  className="-ml-1 rounded-md border border-transparent bg-transparent px-1 font-bold hover:border-slate-200 cursor-pointer">
                  {approvedVersions.map((v) => <option key={v.id} value={v.id}>v{v.versionNo}{v.id === current.id ? ' (current)' : ''}</option>)}
                </select>
              ) : `v${current.versionNo}`}
            </Fact>
            <Fact label="Source">{SOURCE[current.source]}</Fact>
            <Fact label="Approved On" sub={current.decidedByName ? `By ${current.decidedByName}` : null}>{formatDateTime(current.decidedAt)}</Fact>
          </div>
        ) : (
          <section className="card p-5 flex flex-wrap items-center gap-3">
            <p className="text-sm text-slate-600 flex-1">No approved format yet. Lots of this item cannot be inspected until one is approved{stats?.lotsWaiting ? ` (${stats.lotsWaiting} waiting)` : ''}.</p>
            {canCreate && <Button icon={Hammer} onClick={() => setModal({ from: 'CUSTOM' })}>Build the format</Button>}
          </section>
        )}

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Tile icon={FileCheck2} tone="green" value={current ? `v${current.versionNo}` : '—'} label="Approved version" note={current ? `approved ${formatRelative(current.decidedAt)}` : 'no format yet'} onClick={() => setTab('current')} />
          <Tile icon={Layers} tone="blue" value={current?.checkpoints.length ?? 0} label="Total Checkpoints" note={`${groups.length} section${groups.length === 1 ? '' : 's'}${kinds.length ? ` · ${kinds.map(([k, n]) => `${SECTION_LABELS[k]} ${n}`).join(', ')}` : ''}`} onClick={() => setTab('current')} />
          <Tile icon={GitBranch} tone="amber" value={open.length} label="Open drafts" note={open.some((v) => v.status === 'PENDING_APPROVAL') ? 'awaiting approval' : open.length ? 'in progress' : 'none'} onClick={() => setTab('versions')} />
          <Tile icon={Hourglass} tone="violet" value={stats?.lotsWaiting ?? 0} label="Lots waiting for format" note={stats?.lotsWaiting ? 'open once approved' : 'none'} onClick={() => navigate(`/imirs?q=${encodeURIComponent(item.itemCode)}`)} />
          <Tile icon={Boxes} tone="sky" value={stats?.lotsTotal ?? 0} label="Lots received" note={stats?.lotsOnCurrent ? `${stats.lotsOnCurrent} on the current version` : stats?.lastLotAt ? `last ${formatRelative(stats.lastLotAt)}` : 'none yet'} onClick={() => navigate(`/imirs?q=${encodeURIComponent(item.itemCode)}`)} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" className="flex flex-wrap gap-2">
            {TABS.map(([k, label, Icon]) => {
              const n = k === 'versions' ? open.length : k === 'history' ? events?.length ?? 0 : null;
              return (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl border text-sm font-semibold cursor-pointer ${tab === k ? 'border-emerald-400 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-400' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
                  <Icon className="w-4 h-4" />{label}
                  {n ? <span className={`rounded-full px-1.5 text-[11px] tabular ${k === 'versions' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{n}</span> : null}
                </button>
              );
            })}
          </div>
          {tab === 'current' && groups.length > 0 && (
            <div className="ml-auto flex flex-wrap gap-2">
              {groups.map((g) => (
                <button key={g.key} type="button" onClick={() => scrollTo(g.key)} className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-sm font-semibold cursor-pointer ${PILL[g.section]}`}>
                  {g.label}<span className="rounded-full bg-white/80 px-1.5 text-[11px] tabular">{g.items.length}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {tab === 'current' && current && (
          <FormatContent checkpoints={current.checkpoints} toolbar={false}
            onAdd={canCreate ? (g) => openDraft(`?add=${g.section}&group=${encodeURIComponent(g.custom ? g.label : '')}`) : undefined}
            onEdit={canCreate ? (c) => openDraft(`?focus=${c.uid}`) : undefined}
            onRemove={canCreate ? (c) => setRemoving(c) : undefined} />
        )}
        {(tab === 'current' || tab === 'inspector') && !current && <p className="card p-8 text-center text-sm text-slate-500">Nothing to show until a format is approved.</p>}
        {tab === 'inspector' && current && <InspectorView key={current.id} checkpoints={current.checkpoints} note={`Approved v${current.versionNo} as the inspector fills it on an IMIR. Try readings and ticks; nothing is saved.`} />}

        {tab === 'versions' && (
          <div className="space-y-5">
            <section>
              <h2 className="text-sm font-bold text-slate-800 mb-2">Open drafts ({open.length})</h2>
              <DataTable tableId="format-drafts" columns={openCols} rows={tables.open.rows} sort={tables.open.sort} onSort={tables.open.onSort} pagination={tables.open.pagination}
                onRowClick={(v) => navigate(`/formats/versions/${v.id}`)} rowMenu={versionMenu} empty="No draft in progress." />
            </section>
            <section>
              <h2 className="text-sm font-bold text-slate-800 mb-2">Approved versions ({approvedVersions.length})</h2>
              <DataTable tableId="format-versions" columns={approvedCols} rows={tables.approved.rows} sort={tables.approved.sort} onSort={tables.approved.onSort} pagination={tables.approved.pagination}
                onRowClick={(v) => navigate(`/formats/versions/${v.id}`)} rowMenu={versionMenu} selectable exportName={`${item.itemCode}-versions`} empty="No version approved yet." />
            </section>
          </div>
        )}

        {tab === 'history' && <FormatHistory events={events} loading={loadingHistory} empty={`No history yet for ${item.itemCode}.`} />}
      </div>

      {modal && <StartDraftModal item={modal.cloneFrom ? undefined : itemRef} hasCurrent={!!current} initialFrom={modal.from} cloneFrom={modal.cloneFrom} onClose={() => setModal(null)} />}
      {removing && (
        <ConfirmDialog title={`Remove ${removing.checkpoint}?`} confirmLabel="Open draft" variant="danger" busy={opening}
          message={`${ownDraft ? 'Your open draft' : `A new draft from v${current.versionNo}`} opens in the builder without ${removing.checkpoint}. Save and submit it; the check point is removed once the draft is approved.`}
          onCancel={() => setRemoving(null)} onConfirm={() => { const c = removing; setRemoving(null); openDraft(`?remove=${c.uid}`); }} />
      )}
    </div>
  );
}
