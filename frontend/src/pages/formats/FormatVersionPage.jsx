import { AlertTriangle, ArrowLeft, CheckCircle2, GitMerge, Info, PencilLine, Send, Trash2, Undo2, XCircle } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCompareVersionsQuery, useFormatActionMutation, useGetFormatVersionQuery, useGetMergePreviewQuery } from '../../api/formatsApi.js';
import Button from '../../components/ui/Button.jsx';
import { FormError, TextArea } from '../../components/ui/fields.jsx';
import Loader from '../../components/ui/Loader.jsx';
import Modal, { ConfirmDialog, ModalFooter } from '../../components/ui/Modal.jsx';
import PageHeader, { Tabs } from '../../components/ui/PageHeader.jsx';
import { apiError } from '../../utils/apiError.js';
import { formatDateTime } from '../../utils/format.js';
import { fieldLabel, fmtValue, SOURCE } from './formatHelpers.js';
import { DiffSummary, FormatContent, StatusBadge, VersionTag } from './formatUi.jsx';

function Banner({ tone = 'info', icon: Icon = Info, children }) {
  const tones = { info: 'border-sky-200 bg-sky-50 text-sky-800', warning: 'border-amber-200 bg-amber-50 text-amber-800', danger: 'border-rose-200 bg-rose-50 text-rose-800', success: 'border-emerald-200 bg-emerald-50 text-emerald-800' };
  return <div className={`flex gap-2 rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}><Icon className="w-4 h-4 mt-0.5 shrink-0" /><div>{children}</div></div>;
}

export default function FormatVersionPage() {
  const { id } = useParams();
  const { data: v, isLoading, error } = useGetFormatVersionQuery(id);
  const [tab, setTab] = useState('changes');
  const [dialog, setDialog] = useState(null);
  const navigate = useNavigate();
  const compareWith = v?.baseVersionId;
  const { data: cmp } = useCompareVersionsQuery({ a: compareWith, b: id }, { skip: !compareWith });

  if (isLoading) return <Loader />;
  if (error) return <p className="p-6 text-sm text-rose-600">{apiError(error).message}</p>;
  const can = (a) => v.allowedActions?.includes(a);
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
        <dl className="grid gap-x-6 gap-y-2 card p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Meta label="Status"><StatusBadge status={v.status} /></Meta>
          <Meta label="Source">{SOURCE[v.source]}{v.sourceRef?.reference ? ` · ${v.sourceRef.reference}` : ''}{v.sourceRef?.itemCode ? ` · ${v.sourceRef.itemCode} v${v.sourceRef.versionNo}` : ''}</Meta>
          <Meta label="Based on">{v.baseVersionNo ? <VersionTag no={v.baseVersionNo} /> : 'Nothing (first format)'}</Meta>
          <Meta label="Prepared by">{v.createdByName} · {formatDateTime(v.createdAt)}</Meta>
          <Meta label="Format no.">{v.formatNo ?? '—'}</Meta>
          <Meta label="Common format no.">{v.commonFormatNo ?? '—'}</Meta>
          <Meta label="Reference standard">{v.refStandard ?? '—'}</Meta>
          <Meta label="Submitted">{formatDateTime(v.submittedAt)}</Meta>
          {v.decidedAt && <Meta label={v.status === 'REJECTED' ? 'Returned by' : 'Approved by'}>{v.decidedByName} · {formatDateTime(v.decidedAt)}</Meta>}
          {v.remarks && <Meta label="Remarks" wide>{v.remarks}</Meta>}
        </dl>

        {v.status === 'REJECTED' && <Banner tone="warning" icon={Undo2}>Returned for rework: <b>{v.decisionRemark}</b>. Edit and submit again.</Banner>}
        {v.status === 'CONFLICT' && <Banner tone="danger" icon={AlertTriangle}>{v.conflicts.length} field{v.conflicts.length > 1 ? 's were' : ' was'} changed differently here and in the approved version. Resolve {v.conflicts.length > 1 ? 'them' : 'it'} before approval.</Banner>}
        {v.behindCurrent && v.baseVersionNo && v.status !== 'CONFLICT' && <Banner>This draft was started from v{v.baseVersionNo}; a newer version has been approved since. Approval will merge both sets of changes and flag any clashes.</Banner>}
        {v.otherOpenDrafts?.length > 0 && ['DRAFT', 'REJECTED', 'PENDING_APPROVAL'].includes(v.status) && (
          <Banner>Also being changed by {[...new Set(v.otherOpenDrafts.map((d) => d.createdByName))].join(', ')}. That is fine; changes are merged on approval.</Banner>
        )}
        {v.mergeNote && <Banner tone="success" icon={GitMerge}>{v.mergeNote}</Banner>}

        {compareWith ? (
          <>
            <Tabs tabs={[{ key: 'changes', label: `Changes from v${v.baseVersionNo}` }, { key: 'content', label: 'Full format' }]} active={tab} onChange={setTab} />
            {tab === 'changes' && <p className="text-sm text-slate-500"><DiffSummary diff={cmp?.diff} /></p>}
            {cmp?.diff.header.length > 0 && tab === 'changes' && (
              <ul className="text-sm">{cmp.diff.header.map((h) => <li key={h.field}>{fieldLabel(h.field)}: <s className="text-rose-500">{fmtValue(h.field, h.from)}</s> → <b>{fmtValue(h.field, h.to)}</b></li>)}</ul>
            )}
            <FormatContent checkpoints={v.checkpoints} diff={tab === 'changes' ? cmp?.diff : undefined} />
          </>
        ) : (
          <FormatContent checkpoints={v.checkpoints} />
        )}
      </div>

      {dialog === 'approve' && <ApproveDialog v={v} onClose={() => setDialog(null)} />}
      {dialog === 'reject' && <RejectDialog v={v} onClose={() => setDialog(null)} />}
      {['submit', 'discard'].includes(dialog) && <SimpleAction v={v} action={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

const Meta = ({ label, wide, children }) => (
  <div className={wide ? 'sm:col-span-2 lg:col-span-4' : ''}>
    <dt className="text-[11px] font-medium text-slate-400">{label}</dt>
    <dd className="text-slate-700">{children}</dd>
  </div>
);

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
