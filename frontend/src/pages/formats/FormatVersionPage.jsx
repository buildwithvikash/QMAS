import { SECTION_LABELS } from '@qmas/shared';
import {
  AlertTriangle, ArrowLeft, BookOpen, CheckCircle2, Clock, FileText, GitCompare, GitMerge, Hash, History, Info, Layers, MessageSquareText, PencilLine, Send, Trash2,
  Undo2, UserRound, XCircle,
} from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCompareVersionsQuery, useFormatActionMutation, useGetFormatVersionQuery, useGetMergePreviewQuery, useGetVersionHistoryQuery } from '../../api/formatsApi.js';
import Button from '../../components/ui/Button.jsx';
import { FormError, TextArea } from '../../components/ui/fields.jsx';
import Loader from '../../components/ui/Loader.jsx';
import Modal, { ConfirmDialog, ModalFooter } from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { apiError } from '../../utils/apiError.js';
import { formatDateTime } from '../../utils/format.js';
import { fieldLabel, fmtValue, groupCheckpoints, SOURCE } from './formatHelpers.js';
import FormatHistory from './FormatHistory.jsx';
import { DiffSummary, FormatContent, StatusBadge, VersionTag } from './formatUi.jsx';

function Banner({ tone = 'info', icon: Icon = Info, children }) {
  const tones = { info: 'border-sky-200 bg-sky-50 text-sky-800', warning: 'border-amber-200 bg-amber-50 text-amber-800', danger: 'border-rose-200 bg-rose-50 text-rose-800', success: 'border-emerald-200 bg-emerald-50 text-emerald-800' };
  return <div className={`flex gap-2 rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}><Icon className="w-4 h-4 mt-0.5 shrink-0" /><div>{children}</div></div>;
}

export default function FormatVersionPage() {
  const { id } = useParams();
  const { data: v, isLoading, error } = useGetFormatVersionQuery(id);
  const [tab, setTab] = useState(null);
  const [dialog, setDialog] = useState(null);
  const navigate = useNavigate();
  const compareWith = v?.baseVersionId;
  const { data: cmp } = useCompareVersionsQuery({ a: compareWith, b: id }, { skip: !compareWith });
  const { data: events, isFetching: loadingHistory } = useGetVersionHistoryQuery(id);

  if (isLoading) return <Loader />;
  if (error) return <p className="p-6 text-sm text-rose-600">{apiError(error).message}</p>;
  const can = (a) => v.allowedActions?.includes(a);
  const shown = tab ?? (compareWith ? 'changes' : 'content');
  const title = v.versionNo ? `v${v.versionNo}` : v.status === 'DISCARDED' ? 'Discarded draft' : 'Draft';

  return (
    <div>
      <PageHeader icon={GitMerge} title={`${v.itemCode} · ${title}`} subtitle={v.itemDescription}>
        <Link to={`/formats/items/${v.itemId}`} className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" />Item formats</Link>
        {can('discard') && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDialog('discard')}>Discard</Button>}
        {can('edit') && <Button size="sm" variant="secondary" icon={PencilLine} onClick={() => navigate(`/formats/versions/${id}/edit`)}>Edit</Button>}
        {can('submit') && <Button size="sm" icon={Send} onClick={() => setDialog('submit')}>Submit for approval</Button>}
        {can('resolve') && <Button size="sm" variant="danger" icon={GitMerge} onClick={() => navigate(`/formats/versions/${id}/conflicts`)}>Resolve conflicts</Button>}
        {can('reject') && <Button size="sm" variant="secondary" icon={Undo2} onClick={() => setDialog('reject')}>Return</Button>}
        {can('approve') && <Button size="sm" variant="success" icon={CheckCircle2} onClick={() => setDialog('approve')}>Approve</Button>}
      </PageHeader>

      <div className="p-5 space-y-4">
        <VersionSummary v={v} diff={compareWith ? cmp?.diff : null} />

        {v.status === 'REJECTED' && <Banner tone="warning" icon={Undo2}>Returned for rework: <b>{v.decisionRemark}</b>. Edit and submit again.</Banner>}
        {v.status === 'CONFLICT' && <Banner tone="danger" icon={AlertTriangle}>{v.conflicts.length} field{v.conflicts.length > 1 ? 's were' : ' was'} changed differently here and in the approved version. Resolve {v.conflicts.length > 1 ? 'them' : 'it'} before approval.</Banner>}
        {v.behindCurrent && v.baseVersionNo && v.status !== 'CONFLICT' && <Banner>This draft was started from v{v.baseVersionNo}; a newer version has been approved since. Approval will merge both sets of changes and flag any clashes.</Banner>}
        {v.otherOpenDrafts?.length > 0 && ['DRAFT', 'REJECTED', 'PENDING_APPROVAL'].includes(v.status) && (
          <Banner>Also being changed by {[...new Set(v.otherOpenDrafts.map((d) => d.createdByName))].join(', ')}. That is fine; changes are merged on approval.</Banner>
        )}
        {v.mergeNote && <Banner tone="success" icon={GitMerge}>{v.mergeNote}</Banner>}

        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" className="flex flex-wrap gap-2">
            {[
              ...(compareWith ? [['changes', `Changes from v${v.baseVersionNo}`, GitCompare, cmp ? cmp.diff.added.length + cmp.diff.changed.length + cmp.diff.removed.length + cmp.diff.header.length : null]] : []),
              ['content', 'Full format', FileText, v.checkpoints.length],
              ['history', 'History', History, events?.length ?? null],
            ].map(([k, label, Icon, n]) => (
              <button key={k} type="button" role="tab" aria-selected={shown === k} onClick={() => setTab(k)}
                className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border text-sm font-medium cursor-pointer ${shown === k ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                <Icon className="w-4 h-4" />{label}
                {n !== null && <span className={`rounded-full px-1.5 text-[11px] tabular ${shown === k ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}`}>{n}</span>}
              </button>
            ))}
          </div>
          {shown === 'changes' && cmp && (
            <span className="ml-auto flex flex-wrap gap-1.5 text-xs">
              {[['added', 'bg-emerald-50 text-emerald-700'], ['changed', 'bg-amber-50 text-amber-800'], ['removed', 'bg-rose-50 text-rose-700']].map(([k, tone]) => (
                <span key={k} className={`rounded-md px-2 py-0.5 font-medium ${tone}`}>{cmp.diff[k].length} {k}</span>
              ))}
            </span>
          )}
        </div>
        {shown === 'changes' && cmp?.diff.header.length > 0 && (
          <section className="card px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Header</p>
            <ul className="text-sm space-y-0.5">{cmp.diff.header.map((h) => <li key={h.field}>{fieldLabel(h.field)}: <s className="text-rose-500">{fmtValue(h.field, h.from)}</s> → <b>{fmtValue(h.field, h.to)}</b></li>)}</ul>
          </section>
        )}
        {shown !== 'history' && <FormatContent checkpoints={v.checkpoints} diff={shown === 'changes' ? cmp?.diff : undefined} />}
        {shown === 'history' && <FormatHistory events={events} loading={loadingHistory && !events} showVersion={false} />}
      </div>

      {dialog === 'approve' && <ApproveDialog v={v} onClose={() => setDialog(null)} />}
      {dialog === 'reject' && <RejectDialog v={v} onClose={() => setDialog(null)} />}
      {['submit', 'discard'].includes(dialog) && <SimpleAction v={v} action={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

const Fact = ({ icon: Icon, label, children }) => (
  <div className="min-w-0">
    <p className="flex items-center gap-1 text-[11px] text-slate-500">{Icon && <Icon className="w-3 h-3" />}{label}</p>
    <div className="mt-0.5 text-sm text-slate-800">{children}</div>
  </div>
);

/** The version at a glance: status and source, size and change against its base, who did what, header fields. */
function VersionSummary({ v, diff }) {
  const groups = groupCheckpoints(v.checkpoints);
  const byKind = Object.fromEntries(['RECORD', 'DIMENSIONAL', 'VISUAL', 'RELIABILITY'].map((k) => [k, v.checkpoints.filter((c) => c.section === k).length]));
  return (
    <section className="card">
      <div className="px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className="w-12 h-12 shrink-0 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center"><FileText className="w-6 h-6" /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900">{v.versionNo ? `Version ${v.versionNo}` : v.status === 'DISCARDED' ? 'Discarded draft' : 'Draft'}</h2>
              <StatusBadge status={v.status} />
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">{SOURCE[v.source]}</span>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {v.baseVersionNo ? <>Based on <VersionTag no={v.baseVersionNo} /></> : 'First format of this item'}
              {v.sourceRef?.reference ? ` · SAN/SIR ${v.sourceRef.reference}` : ''}{v.sourceRef?.itemCode ? ` · copied from ${v.sourceRef.itemCode} v${v.sourceRef.versionNo}` : ''}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-slate-900 tabular">{v.checkpoints.length}</p>
          <p className="text-[11px] text-slate-500">checks in {groups.length} section{groups.length === 1 ? '' : 's'}</p>
        </div>
        {diff && (
          <div className="border-l border-slate-200 pl-6">
            <p className="text-[11px] text-slate-500">Against v{v.baseVersionNo}</p>
            <p className="mt-0.5 text-sm tabular"><span className="font-semibold text-emerald-700">+{diff.added.length}</span> <span className="font-semibold text-amber-700">~{diff.changed.length}</span> <span className="font-semibold text-rose-700">−{diff.removed.length}</span></p>
          </div>
        )}
        <div className="border-l border-slate-200 pl-6">
          <p className="flex items-center gap-1 text-[11px] text-slate-500"><UserRound className="w-3 h-3" />Prepared</p>
          <p className="mt-0.5 text-sm font-semibold text-slate-800">{v.createdByName}</p>
          <p className="text-[11px] text-slate-500">{formatDateTime(v.createdAt)}</p>
        </div>
        {(v.decidedAt || v.submittedAt) && (
          <div className="border-l border-slate-200 pl-6">
            <p className="flex items-center gap-1 text-[11px] text-slate-500"><Clock className="w-3 h-3" />{v.decidedAt ? (v.status === 'REJECTED' ? 'Returned' : 'Approved') : 'Submitted'}</p>
            <p className="mt-0.5 text-sm font-semibold text-slate-800">{v.decidedAt ? v.decidedByName : 'Waiting for approval'}</p>
            <p className="text-[11px] text-slate-500">{formatDateTime(v.decidedAt ?? v.submittedAt)}</p>
          </div>
        )}
      </div>
      <div className="px-5 py-3 border-t border-slate-100 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Fact icon={Hash} label="Format no.">{v.formatNo ?? '—'}</Fact>
        <Fact icon={Hash} label="Common format no.">{v.commonFormatNo ?? '—'}</Fact>
        <Fact icon={BookOpen} label="Reference standard">{v.refStandard ?? '—'}</Fact>
        <Fact icon={Layers} label="By kind">
          <span className="flex flex-wrap gap-1">
            {Object.entries(byKind).filter(([, n]) => n).map(([k, n]) => <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">{SECTION_LABELS[k]} {n}</span>)}
          </span>
        </Fact>
        <Fact icon={MessageSquareText} label="Remarks for the approver">{v.remarks ?? '—'}</Fact>
      </div>
    </section>
  );
}

function SimpleAction({ v, action, onClose }) {
  const [run, { isLoading }] = useFormatActionMutation();
  const navigate = useNavigate();
  const confirm = async () => {
    try {
      await run({ id: v.id, action, rowVersion: v.rowVersion }).unwrap();
      toast.success(action === 'submit' ? 'Submitted for approval' : 'Draft discarded');
      onClose();
      if (action === 'discard') navigate(`/formats/items/${v.itemId}`);
    } catch (err) {
      toast.error(apiError(err).message);
      onClose();
    }
  };
  return action === 'submit' ? (
    <ConfirmDialog title="Submit for approval" message={`Send this format (${v.checkpoints.length} checkpoints) to the IQC Head for approval? You cannot edit it while it is waiting.`} confirmLabel="Submit" variant="primary" onConfirm={confirm} onCancel={onClose} busy={isLoading} />
  ) : (
    <ConfirmDialog title="Discard draft" message="The draft is closed and kept only in history. Start a new draft to make changes later." confirmLabel="Discard" onConfirm={confirm} onCancel={onClose} busy={isLoading} />
  );
}

function ApproveDialog({ v, onClose }) {
  const { data: preview, isLoading: loading } = useGetMergePreviewQuery(v.id, { refetchOnMountOrArgChange: true });
  const [run, { isLoading, error }] = useFormatActionMutation();
  const [remark, setRemark] = useState('');
  const navigate = useNavigate();

  const approve = async () => {
    try {
      const res = await run({ id: v.id, action: 'approve', remark: remark || undefined, mode: preview?.mode === 'UNRELATED' ? 'REPLACE' : undefined, rowVersion: v.rowVersion }).unwrap();
      if (res.outcome.result === 'CONFLICT') {
        toast.error(`Approval stopped: ${res.outcome.conflicts} conflict(s) with v${res.outcome.againstVersionNo}.`);
        onClose();
        navigate(`/formats/versions/${v.id}/conflicts`);
        return;
      }
      toast.success(`Approved as v${res.outcome.versionNo}${res.outcome.merged ? ' (merged)' : ''}`);
      onClose();
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };

  let explanation;
  if (preview?.mode === 'FAST_FORWARD') explanation = <p>{preview.againstVersionNo ? `Replaces v${preview.againstVersionNo} directly; nothing else changed since this draft was started.` : 'Becomes version 1 of this format.'}</p>;
  else if (preview?.mode === 'MERGE' && !preview.conflicts.length) explanation = <p>v{preview.againstVersionNo} was approved after this draft started from v{preview.baseVersionNo}. The changes merge cleanly: <DiffSummary diff={preview.changes} /> compared with v{preview.againstVersionNo}.</p>;
  else if (preview?.mode === 'MERGE') explanation = <p className="text-rose-700">{preview.conflicts.length} field(s) were changed both here and in v{preview.againstVersionNo}. Approving opens the conflict resolution; nothing is approved yet.</p>;
  else if (preview?.mode === 'UNRELATED') explanation = <p className="text-amber-700">This draft was started before v{preview.againstVersionNo} existed, so the two cannot be merged. Approving <b>replaces v{preview.againstVersionNo} entirely</b> with this draft ({preview.changes.added.length} checkpoints added, {preview.changes.removed.length} removed). Return it instead if v{preview.againstVersionNo} should stay.</p>;

  return (
    <Modal title="Approve format" subtitle={`${v.itemCode} · ${v.checkpoints.length} checkpoints`} onClose={onClose}
      footer={<ModalFooter onCancel={onClose} onSave={approve} saving={isLoading} saveVariant={preview?.mode === 'UNRELATED' ? 'danger' : 'success'}
        saveLabel={preview?.mode === 'UNRELATED' ? `Replace v${preview.againstVersionNo}` : preview?.conflicts?.length ? 'Check and resolve' : 'Approve'} />}>
      <FormError message={error ? apiError(error).message : ''} />
      <div className="text-sm text-slate-600 mb-4">{loading ? <Loader inline label="Checking against the approved version…" /> : explanation}</div>
      <TextArea label="Remark (optional)" value={remark} onChange={(e) => setRemark(e.target.value)} />
    </Modal>
  );
}

function RejectDialog({ v, onClose }) {
  const [run, { isLoading }] = useFormatActionMutation();
  const [remark, setRemark] = useState('');
  const [err, setErr] = useState('');
  const reject = async () => {
    if (!remark.trim()) return setErr('Say what needs to change.');
    try {
      await run({ id: v.id, action: 'reject', remark, rowVersion: v.rowVersion }).unwrap();
      toast.success('Returned to the preparer');
      onClose();
    } catch (e) {
      setErr(apiError(e).message);
    }
  };
  return (
    <Modal title="Return for rework" subtitle={`${v.itemCode} · prepared by ${v.createdByName}`} onClose={onClose} size="sm"
      footer={<ModalFooter onCancel={onClose} onSave={reject} saving={isLoading} saveLabel="Return" saveVariant="danger" />}>
      <TextArea label="What needs to change" required value={remark} onChange={(e) => { setRemark(e.target.value); setErr(''); }} error={err} />
      <p className="mt-2 flex items-center gap-1 text-xs text-slate-400"><XCircle className="w-3.5 h-3.5" />The preparer can edit and resubmit it.</p>
    </Modal>
  );
}
