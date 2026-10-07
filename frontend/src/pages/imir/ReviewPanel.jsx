import { CheckCircle2, CornerUpLeft, FileX2, PauseCircle, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useCreateDnMutation } from '../../api/dnApi.js';
import { useImirActionMutation } from '../../api/workflowApi.js';
import Button from '../../components/ui/Button.jsx';
import { FormError, TextArea } from '../../components/ui/fields.jsx';
import Modal, { ModalFooter } from '../../components/ui/Modal.jsx';
import { apiError } from '../../utils/apiError.js';
import { done } from '../../utils/notify.jsx';
import { ACTION_NAMES } from '../deviation/workflowLabels.js';

const ACTIONS = {
  approve: { label: 'Approve', icon: CheckCircle2, variant: 'success', title: 'Approve IMIR', help: 'The lot is accepted and the IMIR closes.', remarkLabel: 'Final approval remark', remarkRequired: false },
  revert: { label: 'Send back', icon: CornerUpLeft, variant: 'secondary', title: 'Send back to inspector', help: 'The inspector can correct the observations and submit again.', remarkLabel: 'Reason for sending back' },
  escalate: { label: 'Escalate to IQC Head', icon: ShieldAlert, variant: 'danger', title: 'Escalate to IQC Head', help: 'Describe the non-conformance. The IQC Head approves the lot or holds it for a deviation.', remarkLabel: 'Non-conformance remark' },
  head_approve: { label: 'Approve', icon: CheckCircle2, variant: 'success', title: 'Approve escalated lot', help: 'The lot is accepted and the IMIR closes.', remarkLabel: 'Final approval remark' },
  hold: { label: 'Hold for deviation', icon: PauseCircle, variant: 'danger', title: 'Hold lot for deviation', help: 'A deviation is raised and sent to SCM and VD. Whichever department accepts it first becomes responsible and fills the Deviation Form.', remarkLabel: 'Hold remark' },
};

/** Incharge / IQC Head decisions on a submitted IMIR ("Your turn"), plus the link to its deviation. */
export default function ReviewPanel({ imir }) {
  const [open, setOpen] = useState(null);
  const [createDn, { isLoading: raising }] = useCreateDnMutation();
  const navigate = useNavigate();
  const actions = imir.allowedActions.filter((a) => ACTIONS[a]);
  const canRaiseDn = imir.allowedActions.includes('raise_dn');
  // The lot's DN is shown on the route bar; here only the deviation link and the decisions.
  // The lot's deviation and DN are under Linked records; here only what the user can do now.
  if (!actions.length && !canRaiseDn) return null;

  const raiseDn = async () => {
    try {
      const dn = await createDn({ imirId: imir.id }).unwrap();
      done(`DN ${dn.dnNo} raised. Add the photos and the vendor's CAPA here.`);
      navigate(`/dns/${dn.id}`);
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  const ask = imir.status === 'SUBMITTED' ? 'review this inspection' : imir.status === 'WITH_IQC_HEAD' ? 'decide on this escalated lot' : 'raise a DN to the vendor if the defect needs one';
  return (
    <section className="card p-4 space-y-3 border-blue-300 border-l-4 border-l-blue-600">
      <h2 className="text-sm font-semibold text-slate-900">Your turn: <span className="font-normal text-slate-700">{ask}</span></h2>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => {
          const c = ACTIONS[a];
          return <Button key={a} variant={c.variant} icon={c.icon} onClick={() => setOpen(a)}>{c.label}</Button>;
        })}
        {canRaiseDn && <Button variant="secondary" icon={FileX2} loading={raising} onClick={raiseDn}>Raise DN to vendor</Button>}
      </div>
      {imir.status === 'SUBMITTED' && imir.result === 'NOK' && actions.includes('approve') && <p className="text-xs text-slate-500">This lot failed inspection: approving it needs a final approval remark. You can also send it back or escalate it to the IQC Head.</p>}
      {open && <ActionDialog imir={imir} action={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function ActionDialog({ imir, action, onClose }) {
  const c = ACTIONS[action];
  const [remark, setRemark] = useState('');
  const [suggested, setSuggested] = useState([]);
  const [error, setError] = useState(null);
  const [run, { isLoading }] = useImirActionMutation();
  const navigate = useNavigate();
  // Accepting a failed lot needs the reason, like the IQC Head's approval.
  const remarkRequired = c.remarkRequired !== false || (action === 'approve' && imir.result !== 'OK');

  const save = async () => {
    setError(null);
    if (remarkRequired && !remark.trim()) return setError(`Enter the ${(c.remarkLabel ?? 'remark').toLowerCase()}.`);
    if (action === 'hold' && !suggested.length) return setError('Suggest at least one action.');
    const body = { id: imir.id, action, rowVersion: imir.rowVersion, remark: remark.trim() || null };
    if (action === 'hold') body.suggestedActions = suggested;
    try {
      const res = await run(body).unwrap();
      const said = {
        approve: `${imir.imirNo} accepted and closed.`,
        head_approve: `${imir.imirNo} accepted and closed.`,
        revert: `${imir.imirNo} sent back to the inspector.`,
        escalate: `${imir.imirNo} sent to the IQC Head.`,
        hold: `Deviation ${res.deviation?.deviationNo ?? ''} raised and sent to SCM and VD.`,
      }[action];
      done(said, action === 'hold' && res.deviation ? { label: 'Open deviation', go: () => navigate(`/deviations/${res.deviation.id}`) } : { label: 'My tasks', go: () => navigate('/') });
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
      </div>
    </Modal>
  );
}
