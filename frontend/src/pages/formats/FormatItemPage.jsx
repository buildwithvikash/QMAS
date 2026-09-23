import { PERMISSIONS } from '@qmas/shared';
import { ArrowLeft, Copy, Database, FilePlus2, GitBranch, PencilLine } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCreateDraftMutation, useGetFormatLibraryQuery, useGetItemFormatQuery, useLazySanLookupQuery } from '../../api/formatsApi.js';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { FormError, Select, TextInput } from '../../components/ui/fields.jsx';
import Loader from '../../components/ui/Loader.jsx';
import Modal, { ModalFooter } from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { useDebounced } from '../../hooks/useDebounced.js';
import { apiError } from '../../utils/apiError.js';
import { formatDateTime } from '../../utils/format.js';
import { SOURCE } from './formatHelpers.js';
import { FormatContent, StatusBadge, VersionTag } from './formatUi.jsx';

export default function FormatItemPage() {
  const { itemId } = useParams();
  const { can } = useAccess();
  const { data, isLoading, error } = useGetItemFormatQuery(Number(itemId));
  const [starting, setStarting] = useState(false);
  const navigate = useNavigate();

  if (isLoading) return <Loader />;
  if (error) return <p className="p-6 text-sm text-rose-600">{apiError(error).message}</p>;
  const { item, current, versions } = data;
  const open = versions.filter((v) => ['DRAFT', 'REJECTED', 'PENDING_APPROVAL', 'CONFLICT'].includes(v.status));
  const history = versions.filter((v) => v.versionNo);

  const historyCols = [
    { key: 'versionNo', header: 'Version', render: (v) => <VersionTag no={v.versionNo} /> },
    { key: 'status', header: 'Status', render: (v) => <StatusBadge status={v.status} /> },
    { key: 'source', header: 'Source', render: (v) => SOURCE[v.source] },
    { key: 'createdByName', header: 'Prepared by' },
    { key: 'decided', header: 'Approved', render: (v) => <span className="whitespace-nowrap">{v.decidedByName ?? '—'} · {formatDateTime(v.decidedAt)}</span> },
    { key: 'mergeNote', header: 'Note', render: (v) => <span className="text-xs text-slate-500">{v.mergeNote ?? v.decisionRemark ?? ''}</span> },
  ];
  const openCols = [
    { key: 'status', header: 'Status', render: (v) => <StatusBadge status={v.status} /> },
    { key: 'createdByName', header: 'Started by' },
    { key: 'createdAt', header: 'Started', render: (v) => formatDateTime(v.createdAt) },
    { key: 'base', header: 'Based on', render: (v) => (v.baseVersionNo ? <VersionTag no={v.baseVersionNo} /> : 'nothing (first format)') },
    { key: 'submittedAt', header: 'Submitted', render: (v) => formatDateTime(v.submittedAt) },
  ];

  return (
    <div>
      <PageHeader icon={GitBranch} title={`${item.itemCode} · ${item.description}`} subtitle={`Drawing ${item.drawingNo ?? '—'}${item.drawingRev ? ` rev ${item.drawingRev}` : ''} · ${item.categoryName ?? 'no category'}`}>
        <Link to="/formats" className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" />Library</Link>
        {can(PERMISSIONS.FORMATS_CREATE) && <Button size="sm" icon={PencilLine} onClick={() => setStarting(true)}>{current ? 'Start a change' : 'Create format'}</Button>}
      </PageHeader>
      <div className="p-5 space-y-6">
        {open.length > 0 && (
          <section>
            <h2 className="text-sm font-bold text-slate-800 mb-2">Open drafts ({open.length})</h2>
            <DataTable columns={openCols} rows={open} onRowClick={(v) => navigate(`/formats/versions/${v.id}`)} />
          </section>
        )}
        <section>
          <div className="flex items-baseline gap-2 mb-2">
            <h2 className="text-sm font-bold text-slate-800">Approved format</h2>
            {current && (
              <span className="text-xs text-slate-500">
                <VersionTag no={current.versionNo} /> · format no. {current.formatNo ?? '—'} · common no. {current.commonFormatNo ?? '—'} · {current.refStandard ?? ''} · approved {formatDateTime(current.decidedAt)} by {current.decidedByName}
              </span>
            )}
          </div>
          {current ? <FormatContent checkpoints={current.checkpoints} /> : <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">No approved format yet. IMIRs for this item cannot be opened until one is approved.</p>}
        </section>
        {history.length > 0 && (
          <section>
            <h2 className="text-sm font-bold text-slate-800 mb-2">Version history</h2>
            <DataTable columns={historyCols} rows={history} onRowClick={(v) => navigate(`/formats/versions/${v.id}`)} />
          </section>
        )}
      </div>
      {starting && <StartDraftModal item={item} hasCurrent={!!current} onClose={() => setStarting(false)} />}
    </div>
  );
}

const SOURCES = [
  { value: 'CURRENT', label: 'Edit the current version', icon: PencilLine, help: 'Best for changes: your edits merge with any other approved change.' },
  { value: 'SAN', label: 'Fetch from SAN/SIR', icon: Database, help: 'Checkpoints from the SAN/SIR application for a vendor and this item.' },
  { value: 'CLONE', label: 'Copy another format', icon: Copy, help: 'Start from an approved format of a similar item.' },
  { value: 'BLANK', label: 'Blank format', icon: FilePlus2, help: 'Build the format from scratch.' },
];

function StartDraftModal({ item, hasCurrent, onClose }) {
  const [from, setFrom] = useState(hasCurrent ? 'CURRENT' : 'SAN');
  const [vendorCode, setVendorCode] = useState('');
  const [cloneVersionId, setCloneVersionId] = useState(null);
  const [error, setError] = useState(null);
  const [create, { isLoading }] = useCreateDraftMutation();
  const [sanLookup, san] = useLazySanLookupQuery();
  const navigate = useNavigate();
  const options = SOURCES.filter((s) => s.value !== 'CURRENT' || hasCurrent);

  const start = async () => {
    setError(null);
    try {
      const draft = await create({
        itemId: item.id,
        from,
        vendorCode: from === 'SAN' ? vendorCode.trim().toUpperCase() : undefined,
        cloneFromVersionId: from === 'CLONE' ? (cloneVersionId ?? undefined) : undefined,
      }).unwrap();
      toast.success('Draft started');
      navigate(`/formats/versions/${draft.id}/edit`);
    } catch (err) {
      setError(apiError(err));
    }
  };

  return (
    <Modal title={hasCurrent ? 'Start a change' : 'Create the format'} subtitle={`${item.itemCode} · ${item.description}`} onClose={onClose}
      footer={<ModalFooter onCancel={onClose} onSave={start} saving={isLoading} saveLabel="Start draft" />}>
      <FormError message={error && !Object.keys(error.fieldErrors).length ? error.message : ''} />
      <div role="radiogroup" className="grid gap-2">
        {options.map((o) => (
          <label key={o.value} className={`flex gap-3 rounded-xl border p-3 cursor-pointer ${from === o.value ? 'border-blue-300 bg-blue-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
            <input type="radio" name="from" className="mt-1 accent-blue-600" checked={from === o.value} onChange={() => setFrom(o.value)} />
            <o.icon className="w-5 h-5 mt-0.5 text-blue-600 shrink-0" />
            <span>
              <span className="block text-sm font-semibold text-slate-800">{o.label}</span>
              <span className="block text-xs text-slate-500">{o.help}</span>
            </span>
          </label>
        ))}
      </div>
      {from === 'SAN' && (
        <div className="mt-4 flex items-end gap-2">
          <TextInput className="flex-1" label="Vendor code" required value={vendorCode} onChange={(e) => setVendorCode(e.target.value.toUpperCase())} error={error?.fieldErrors?.vendorCode} />
          <Button variant="secondary" disabled={!vendorCode.trim()} loading={san.isFetching} onClick={() => sanLookup({ vendorCode: vendorCode.trim(), itemCode: item.itemCode })}>Check SAN/SIR</Button>
        </div>
      )}
      {from === 'SAN' && san.data && (
        <p className={`mt-2 text-sm ${san.data.found ? 'text-emerald-700' : 'text-amber-700'}`}>
          {san.data.found ? `Found ${san.data.checkpoints.length} checkpoints (${san.data.reference}).` : 'SAN/SIR has no record for this vendor and item. Choose another way to start.'}
        </p>
      )}
      {from === 'CLONE' && <CloneSource value={cloneVersionId} onChange={setCloneVersionId} error={error?.fieldErrors?.cloneFromVersionId} />}
      {hasCurrent && from !== 'CURRENT' && <p className="mt-4 text-xs text-amber-700">Starting from something other than the current version replaces its content; approval will show what changes.</p>}
    </Modal>
  );
}

/** Pick an item with an approved format; the value is that format's current version id. */
function CloneSource({ value, onChange, error }) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const { data } = useGetFormatLibraryQuery({ q: debounced || undefined, status: 'APPROVED', pageSize: 20 });
  return (
    <div className="mt-4 grid gap-2">
      <TextInput label="Find the item to copy" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Item code or description" />
      <Select label="Item with an approved format" value={value ?? ''} onChange={(v) => onChange(v)} error={error}
        options={(data?.rows ?? []).map((r) => ({ value: r.currentVersionId, label: `${r.itemCode} · ${r.description} (v${r.versionNo})` }))} placeholder="Choose…" />
    </div>
  );
}
