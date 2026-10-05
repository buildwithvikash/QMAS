import { History, Undo2 } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { useGetRecordReversalQuery, useRequestReversalMutation, useWithdrawReversalMutation } from '../../api/reversalApi.js';
import Button from '../../components/ui/Button.jsx';
import { FormError, TextArea } from '../../components/ui/fields.jsx';
import Modal, { ModalFooter } from '../../components/ui/Modal.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { apiError } from '../../utils/apiError.js';
import { formatDateTime } from '../../utils/format.js';
import { done } from '../../utils/notify.jsx';
import { HISTORY_LABELS } from './historyFormat.js';

const NAMES = { IMIR: 'IMIR', DEVIATION: 'deviation', DN: 'DN' };

/**
 * Reversal on a record page (IMIR, deviation, DN): the person responsible for the current step
 * (or who took the last one) asks an admin to set the record back to an earlier step, with a
 * reason. Shows a waiting request to everyone, and nothing when there is nothing to show.
 */
export default function ReversalPanel({ entityType, entityId, recordNo }) {
  const { user } = useAccess();
  const { data } = useGetRecordReversalQuery({ entityType, entityId });
  const [open, setOpen] = useState(false);
  const [withdraw, withdrawing] = useWithdrawReversalMutation();
  // Steps recorded before reversal existed kept no earlier state, so they cannot be reversed.
  if (!data || (!data.pending && (!data.canRequest || !data.steps.length))) return null;
  const p = data.pending;

  if (p) {
    return (
      <section className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" aria-label="Reversal request">
        <History className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Reversal requested, waiting for an admin</p>
          <p className="mt-0.5 text-amber-800">
            {p.requestedByName} · {formatDateTime(p.requestedAt)}{p.requestedStepAction ? ` · undo "${HISTORY_LABELS[p.requestedStepAction] ?? p.requestedStepAction}"` : ''}
          </p>
          <p className="mt-1 whitespace-pre-line">{p.reason}</p>
        </div>
        <div className="flex gap-2">
          {data.canReview && <Link to={`/admin/reversals?open=${p.id}`} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">Review</Link>}
          {p.requestedBy === user?.id && (
            <Button size="sm" variant="secondary" loading={withdrawing.isLoading} onClick={() => withdraw(p.id).unwrap().then(() => done('Reversal request withdrawn.'), (err) => toast.error(apiError(err).message))}>Withdraw</Button>
          )}
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm" aria-label="Reversal">
        <Undo2 className="h-4 w-4 shrink-0 text-slate-400" />
        <p className="min-w-0 flex-1 text-slate-600">A step on this {NAMES[entityType]} was wrong? Ask an admin to set it back to an earlier step.</p>
        <Button size="sm" variant="secondary" icon={Undo2} onClick={() => setOpen(true)}>Request reversal</Button>
      </section>
      {open && <RequestDialog data={data} entityType={entityType} entityId={entityId} recordNo={recordNo} onClose={() => setOpen(false)} />}
    </>
  );
}

function RequestDialog({ data, entityType, entityId, recordNo, onClose }) {
  const [stepId, setStepId] = useState(data.steps[0]?.id ?? null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [send, { isLoading }] = useRequestReversalMutation();
  const save = async () => {
    setError(null);
    if (!reason.trim()) return setError('Enter the reason for the reversal.');
    try {
      await send({ entityType, entityId, stepId, reason: reason.trim() }).unwrap();
      done('Reversal requested. An admin has been notified.');
      onClose();
    } catch (err) {
      setError(apiError(err).message);
    }
  };
  return (
    <Modal title="Request reversal" subtitle={`${recordNo} · now at "${data.statusLabel}"`} onClose={onClose}
      footer={<ModalFooter onCancel={onClose} onSave={save} saving={isLoading} saveLabel="Send to admin" />}>
      <FormError message={error} />
      <p className="mb-4 text-sm text-slate-600">Choose the step that should be undone. The record goes back to where it was just before that step; later steps are undone too. An admin reviews the request and decides.</p>
      <fieldset className="mb-4 space-y-2">
        <legend className="mb-1 block text-[11px] font-medium text-slate-500">Undo this step</legend>
        {data.steps.map((s) => (
          <label key={s.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm ${stepId === s.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}>
            <input type="radio" name="step" className="mt-1" checked={stepId === s.id} onChange={() => setStepId(s.id)} />
            <span className="min-w-0">
              <span className="font-semibold text-slate-900">{HISTORY_LABELS[s.action] ?? s.action}</span>
              <span className="text-slate-500"> · {s.actorName ?? 'System'} · {formatDateTime(s.at)}</span>
              <span className="block text-xs text-slate-600">Back to: <span className="font-medium">{s.beforeLabel}</span></span>
            </span>
          </label>
        ))}
      </fieldset>
      <TextArea label="Reason for the reversal" required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
    </Modal>
  );
}
