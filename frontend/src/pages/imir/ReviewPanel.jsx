import { CheckCircle2, CornerUpLeft, FileWarning, FileX2, PauseCircle, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate } from 'react-router-dom';
import { useCreateDnMutation } from '../../api/dnApi.js';
import { useImirActionMutation } from '../../api/workflowApi.js';
import Button from '../../components/ui/Button.jsx';
import { FormError, TextArea } from '../../components/ui/fields.jsx';
import Modal, { ModalFooter } from '../../components/ui/Modal.jsx';
import { apiError } from '../../utils/apiError.js';
import { ACTION_NAMES } from '../deviation/workflowLabels.js';
import { DeviationStage, DnStatus } from '../deviation/workflowUi.jsx';

const ACTIONS = {
  approve: { label: 'Approve', icon: CheckCircle2, variant: 'success', title: 'Approve IMIR', help: 'The lot is accepted and the IMIR closes.', remarkRequired: false },
  revert: { label: 'Send back', icon: CornerUpLeft, variant: 'secondary', title: 'Send back to inspector', help: 'The inspector can correct the observations and submit again.', remarkLabel: 'Reason for sending back', checkpoints: true },
  escalate: { label: 'Escalate to IQC Head', icon: ShieldAlert, variant: 'danger', title: 'Escalate to IQC Head', help: 'Describe the non-conformance. The IQC Head approves the lot or holds it for a deviation.', remarkLabel: 'Non-conformance remark', checkpoints: true },
  head_approve: { label: 'Approve', icon: CheckCircle2, variant: 'success', title: 'Approve escalated lot', help: 'The lot is accepted and the IMIR closes.' },
  hold: { label: 'Hold for deviation', icon: PauseCircle, variant: 'danger', title: 'Hold lot for deviation', help: 'A deviation is raised and sent to the chosen department, whose initiator fills the Deviation Form.', remarkLabel: 'Hold remark' },
};

/** Incharge / IQC Head decisions on a submitted IMIR, plus links to its deviation and DN. */
export default function ReviewPanel({ imir }) {
  const [open, setOpen] = useState(null);
  const [createDn, { isLoading: raising }] = useCreateDnMutation();
  const navigate = useNavigate();
  const actions = imir.allowedActions.filter((a) => ACTIONS[a]);
  const canRaiseDn = imir.allowedActions.includes('raise_dn');
  if (!actions.length && !imir.deviation && !imir.dn && !canRaiseDn) return null;

  const raiseDn = async () => {
    try {
      const dn = await createDn({ imirId: imir.id }).unwrap();
      toast.success(`DN ${dn.dnNo} raised`);
      navigate(`/dns/${dn.id}`);
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  return (
    <section className="card p-4 space-y-3">
      <h2 className="text-sm font-bold text-slate-800">Review</h2>
      {imir.deviation && (
        <Link to={`/deviations/${imir.deviation.id}`} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm hover:bg-amber-100">
          <FileWarning className="w-4 h-4 text-amber-600" />
          <span className="font-mono font-semibold">{imir.deviation.deviationNo}</span>
          <span className="text-slate-500">· {imir.deviation.department}</span>
          <span className="ml-auto"><DeviationStage stage={imir.deviation.stage} outcome={imir.deviation.outcome} /></span>
        </Link>
      )}
      {imir.dn && (
        <Link to={`/dns/${imir.dn.id}`} className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm hover:bg-rose-100">
          <FileX2 className="w-4 h-4 text-rose-600" />
          <span className="font-mono font-semibold">{imir.dn.dnNo}</span>
          <span className="text-slate-500">· Defect notification</span>
          <span className="ml-auto"><DnStatus status={imir.dn.status} /></span>
        </Link>
      )}
      {(actions.length > 0 || canRaiseDn) && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => {
            const c = ACTIONS[a];
            return <Button key={a} variant={c.variant} icon={c.icon} onClick={() => setOpen(a)}>{c.label}</Button>;
          })}
          {canRaiseDn && <Button variant="secondary" icon={FileX2} loading={raising} onClick={raiseDn}>Raise DN to vendor</Button>}
        </div>
      )}
      {imir.status === 'SUBMITTED' && imir.result === 'NOK' && actions.includes('escalate') && <p className="text-xs text-slate-500">A failed lot cannot be approved by the Incharge: send it back or escalate it.</p>}
      {open && <ActionDialog imir={imir} action={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function ActionDialog({ imir, action, onClose }) {
  const c = ACTIONS[action];
  const [remark, setRemark] = useState('');
  const [cpRemarks, setCpRemarks] = useState(() => Object.fromEntries(imir.checkpoints.map((cp) => [cp.uid, cp.inchargeRemark ?? ''])));
  const [department, setDepartment] = useState('SCM');
  const [suggested, setSuggested] = useState([]);
  const [error, setError] = useState(null);
  const [run, { isLoading }] = useImirActionMutation();
  const failed = imir.checkpoints.filter((cp) => imir.evaluation?.checkpointResults?.[cp.uid] === 'NOK' || cp.result === 'NOK');
  const remarkRequired = c.remarkRequired !== false;

  const save = async () => {
    setError(null);
    if (remarkRequired && !remark.trim()) return setError(`Enter the ${(c.remarkLabel ?? 'remark').toLowerCase()}.`);
    if (action === 'hold' && !suggested.length) return setError('Suggest at least one action.');
    const body = { id: imir.id, action, rowVersion: imir.rowVersion, remark: remark.trim() || null };
    if (c.checkpoints) body.checkpointRemarks = failed.map((cp) => ({ checkpointUid: cp.uid, remark: cpRemarks[cp.uid]?.trim() || null }));
    if (action === 'hold') Object.assign(body, { department, suggestedActions: suggested });
    try {
      await run(body).unwrap();
      toast.success(`${imir.imirNo}: ${c.title.toLowerCase()} done`);
      onClose();
    } catch (err) {
      setError(apiError(err).message);
    }
  };

  return (
    <Modal title={c.title} subtitle={`${imir.imirNo} · ${imir.itemCode}`} onClose={onClose}
      footer={<ModalFooter onCancel={onClose} onSave={save} saving={isLoading} saveLabel={c.label} saveVariant={c.variant === 'secondary' ? 'primary' : c.variant} />}>
      <FormError message={error} />
      <p className="text-sm text-slate-600 mb-4">{c.help}</p>
      <div className="space-y-4">
        {action === 'hold' && (
          <>
            <fieldset>
              <legend className="block text-[11px] font-medium text-slate-500 mb-1">Department <span className="text-rose-500">*</span></legend>
              <div className="flex gap-2">
                {[['SCM', 'Supply Chain (SCM)'], ['VD', 'Vendor Development (VD)']].map(([v, l]) => (
                  <label key={v} className={`flex-1 cursor-pointer rounded-lg border px-3 py-2 text-sm ${department === v ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-slate-200'}`}>
                    <input type="radio" name="dept" value={v} checked={department === v} onChange={() => setDepartment(v)} className="mr-2" />{l}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="block text-[11px] font-medium text-slate-500 mb-1">Suggested action <span className="text-rose-500">*</span></legend>
              <div className="flex flex-wrap gap-2">
                {Object.entries(ACTION_NAMES).map(([v, l]) => (
                  <label key={v} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${suggested.includes(v) ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-slate-200'}`}>
                    <input type="checkbox" checked={suggested.includes(v)} onChange={(e) => setSuggested((s) => (e.target.checked ? [...s, v] : s.filter((x) => x !== v)))} className="mr-2" />{l}
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        )}
        <TextArea label={c.remarkLabel ?? 'Remark'} required={remarkRequired} value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={1000} />
        {c.checkpoints && failed.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-medium text-slate-500">Remarks on failed checkpoints</p>
            {failed.map((cp) => (
              <TextArea key={cp.uid} label={`${cp.checkpoint} · ${cp.specification}`} value={cpRemarks[cp.uid]} maxLength={500}
                onChange={(e) => setCpRemarks((r) => ({ ...r, [cp.uid]: e.target.value }))} className="[&_textarea]:min-h-12" />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
