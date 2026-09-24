import { deviationFormSchema, ESCALATION_RANKS } from '@qmas/shared';
import { ArrowLeft, CheckCircle2, CornerUpLeft, FileWarning, Gavel, Scale, Send, ShieldAlert, ThumbsDown, XCircle } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useParams } from 'react-router-dom';
import { useDeviationActionMutation, useGetDeviationQuery } from '../../api/workflowApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import { FormError, Select, TextArea, TextInput } from '../../components/ui/fields.jsx';
import Loader from '../../components/ui/Loader.jsx';
import Modal, { ModalFooter } from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useZodForm } from '../../hooks/useZodForm.js';
import { apiError } from '../../utils/apiError.js';
import { formatDate, formatDateTime, formatQty } from '../../utils/format.js';
import { ImirStatus } from '../imir/imirUi.jsx';
import LotJourney from '../imir/LotJourney.jsx';
import { ACTION_NAMES, DECISION_NAMES, ROLE_SHORT } from './workflowLabels.js';
import { DeviationStage, HistoryTimeline } from './workflowUi.jsx';

/** Buttons for the simple decisions: a remark and (for escalation) the authorities. */
const DECISIONS = {
  dept_approve: { label: 'Approve', icon: CheckCircle2, variant: 'success', help: 'Forward to the next approver, or to the IQC Head for the final decision.', remark: 'optional' },
  send_back: { label: 'Send back', icon: CornerUpLeft, variant: 'secondary', help: 'The initiator corrects the Deviation Form and submits it again.' },
  dept_reject: { label: 'Reject', icon: XCircle, variant: 'danger', help: 'The IQC Head then rejects the lot or escalates to senior authorities.' },
  final_approve: { label: 'Approve deviation', icon: CheckCircle2, variant: 'success', help: 'Use As Is closes the lot now. Segregation and Rework wait for the department to enter OK / Not-OK quantities (14 days).' },
  final_reject: { label: 'Reject lot', icon: XCircle, variant: 'danger', help: 'The lot is rejected and the IMIR closes.' },
  escalate: { label: 'Escalate to seniors', icon: ShieldAlert, variant: 'secondary', help: 'Selected authorities decide in parallel. The highest-ranked decision is final; the Central Operations Head has 24 hours, after which CQA decides.' },
  recommend_reject: { label: 'Recommend rejection', icon: ThumbsDown, variant: 'secondary', help: 'No Deviation Form: the IQC Head decides on your recommendation.' },
  verify_qty: { label: 'Verify quantities', icon: CheckCircle2, variant: 'success', help: 'The lot closes as accepted under deviation.', remark: 'optional' },
  return_qty: { label: 'Return quantities', icon: CornerUpLeft, variant: 'secondary', help: 'The department corrects the quantities.' },
  override: { label: 'Override', icon: Gavel, variant: 'danger', help: 'Your decision replaces the senior outcome (Rule 4). It is recorded with your reason.' },
};

export default function DeviationPage() {
  const { id } = useParams();
  const { data: d, isLoading, error } = useGetDeviationQuery(id);
  const [dialog, setDialog] = useState(null);
  if (isLoading) return <Loader />;
  if (error) return <p className="p-6 text-sm text-rose-600">{apiError(error).message}</p>;

  const can = (a) => d.allowedActions.includes(a);
  const buttons = d.allowedActions.filter((a) => DECISIONS[a] && a !== 'recommend_reject');

  return (
    <div className="pb-10">
      <PageHeader icon={FileWarning} title={d.deviationNo} copyTitle subtitle={`${d.itemCode} · ${d.itemDescription}`}>
        <Link to="/deviations" className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" />Deviations</Link>
        <DeviationStage stage={d.stage} outcome={d.outcome} />
      </PageHeader>

      <div className="p-5 grid gap-4 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-4 min-w-0">
          <LotJourney status={d.imirStatus} history={d.history} deviation={d} />
          <Facts d={d} />
          {buttons.length > 0 && (
            <section className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
              <h2 className="text-sm font-bold text-slate-800 mb-1">Your decision</h2>
              <StageHint d={d} />
              <div className="flex flex-wrap gap-2 mt-3">
                {buttons.map((a) => <Button key={a} variant={DECISIONS[a].variant} icon={DECISIONS[a].icon} onClick={() => setDialog(a)}>{DECISIONS[a].label}</Button>)}
              </div>
            </section>
          )}
          {can('submit_form') ? <DeviationForm d={d} onRecommendReject={() => setDialog('recommend_reject')} /> : <FormView d={d} />}
          {can('enter_qty') && <QuantityForm d={d} />}
          {d.rounds.length > 0 && <EscalationBoard d={d} />}
        </div>
        <aside className="space-y-4">
          <section className="card p-4">
            <h2 className="text-sm font-bold text-slate-800 mb-3">History</h2>
            <HistoryTimeline history={d.history} />
          </section>
        </aside>
      </div>
      {dialog && <DecisionDialog d={d} action={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

function fact(label, value) {
  return <div><dt className="text-[11px] font-medium text-slate-400">{label}</dt><dd className="text-sm text-slate-800">{value ?? '—'}</dd></div>;
}

function Facts({ d }) {
  return (
    <section className="card p-4 space-y-3">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        {fact('IMIR', <Link to={`/imirs/${d.imirId}`} className="font-mono text-blue-700 hover:underline">{d.imirNo}</Link>)}
        {fact('IMIR status', <ImirStatus status={d.imirStatus} />)}
        {fact('Vendor', `${d.vendorName} (${d.vendorCode})`)}
        {fact('GRN', `${d.grnNo} · ${formatDate(d.grnDate)}`)}
        {fact('Inward qty', formatQty(d.inwardQty, d.uom))}
        {fact('Plant', `${d.plantSapCode} · ${d.plantName}`)}
        {fact('Department', d.department)}
        {fact('Suggested', d.suggestedActions.map((a) => ACTION_NAMES[a]).join(', '))}
        {d.qtyDueAt && d.stage !== 'CLOSED' && fact('Quantities due', formatDateTime(d.qtyDueAt))}
        {d.okQty !== null && fact('OK / Not OK', `${formatQty(d.okQty, d.uom)} / ${formatQty(d.notOkQty, d.uom)}`)}
        {d.seniorEffective && fact('Senior decision', DECISION_NAMES[d.seniorEffective])}
        {d.deptOutcome && fact('Department', { APPROVED: 'Approved', REJECTED: 'Rejected', REJECT_RECOMMENDED: 'Rejection recommended' }[d.deptOutcome])}
      </dl>
      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900"><span className="font-semibold">IQC Head hold remark: </span>{d.holdRemark}</div>
    </section>
  );
}

function StageHint({ d }) {
  const hints = {
    SUB_HEAD: 'Review the Deviation Form below.',
    HEAD: 'Review the Deviation Form below.',
    FINAL: d.seniorEffective === 'APPROVE' ? 'Senior authorities approved: the deviation can only be approved.'
      : d.seniorEffective === 'REJECT' ? 'Senior authorities rejected: the lot can only be rejected.'
      : d.deptOutcome === 'APPROVED' ? 'The department approved the deviation.' : 'The department did not approve the deviation.',
    SENIOR: 'Senior escalation is open.',
    QTY_VERIFICATION: 'Check the OK / Not-OK quantities entered by the department.',
  };
  return <p className="text-xs text-slate-600">{hints[d.stage]}</p>;
}

const SEVERITY_OPTIONS = [{ value: 'MINOR', label: 'Minor' }, { value: 'MAJOR', label: 'Major' }, { value: 'CRITICAL', label: 'Critical' }];

/** The SCM / VD initiator's Deviation Form (review workbook fields). */
function DeviationForm({ d, onRecommendReject }) {
  const f = useZodForm(deviationFormSchema, {
    severity: d.severity ?? null,
    action: d.action ?? (d.suggestedActions.length === 1 ? d.suggestedActions[0] : null),
    deviationQty: d.deviationQty ?? d.inwardQty,
    specification: d.specification ?? '',
    iqcObservation: d.iqcObservation ?? '',
    correction: d.correction ?? '',
    correctiveAction: d.correctiveAction ?? '',
  });
  const [remark, setRemark] = useState('');
  const [formError, setFormError] = useState(null);
  const [run, { isLoading }] = useDeviationActionMutation();

  const submit = async () => {
    setFormError(null);
    const form = f.validate({ deviationQty: Number(f.values.deviationQty) });
    if (!form) return;
    try {
      await run({ id: d.id, action: 'submit_form', rowVersion: d.rowVersion, remark: remark.trim() || null, form }).unwrap();
      toast.success('Deviation Form submitted for approval');
    } catch (err) {
      const e = apiError(err);
      setFormError(e.message);
      f.setServerErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k.replace(/^form\./, ''), v])));
    }
  };

  return (
    <section className="card border-blue-200 p-4 space-y-4">
      <div>
        <h2 className="text-sm font-bold text-slate-800">Deviation Form</h2>
        <p className="text-xs text-slate-500">{d.seniorEffective === 'CHANGE_TYPE' ? 'Senior authorities asked for a different deviation type. Change the action and submit again.' : `Fill the form for ${d.department}; it goes to your approver, then to the IQC Head.`}</p>
      </div>
      <FormError message={formError} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Severity" required value={f.values.severity} onChange={(v) => f.set('severity', v)} options={SEVERITY_OPTIONS} error={f.error('severity')} />
        <Select label="Action" required value={f.values.action} onChange={(v) => f.set('action', v)} error={f.error('action')}
          options={Object.entries(ACTION_NAMES).map(([value, label]) => ({ value, label: d.suggestedActions.includes(value) ? `${label} (suggested)` : label }))} />
        <TextInput label={`Deviation qty (${d.uom ?? ''})`} required type="number" min="0" step="any" value={f.values.deviationQty} onChange={(e) => f.set('deviationQty', e.target.value)}
          error={f.error('deviationQty')} hint={`Inward ${formatQty(d.inwardQty, d.uom)}`} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextArea label="Specification" value={f.values.specification} onChange={(e) => f.set('specification', e.target.value)} error={f.error('specification')} maxLength={2000} />
        <TextArea label="IQC observation" value={f.values.iqcObservation} onChange={(e) => f.set('iqcObservation', e.target.value)} error={f.error('iqcObservation')} maxLength={2000} />
        <TextArea label="Correction" required value={f.values.correction} onChange={(e) => f.set('correction', e.target.value)} error={f.error('correction')} maxLength={2000} />
        <TextArea label="Corrective action" required value={f.values.correctiveAction} onChange={(e) => f.set('correctiveAction', e.target.value)} error={f.error('correctiveAction')} maxLength={2000} />
      </div>
      <TextInput label="Remark to approver" value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={1000} />
      <div className="flex flex-wrap gap-2 justify-end">
        <Button variant="secondary" icon={ThumbsDown} onClick={onRecommendReject}>Recommend rejection</Button>
        <Button icon={Send} loading={isLoading} onClick={submit}>Submit for approval</Button>
      </div>
    </section>
  );
}

function FormView({ d }) {
  if (!d.formSubmittedAt) return null;
  const row = (label, value) => (
    <div><dt className="text-[11px] font-medium text-slate-400">{label}</dt><dd className="text-sm text-slate-800 whitespace-pre-line">{value || '—'}</dd></div>
  );
  return (
    <section className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-slate-800">Deviation Form</h2>
        <Badge variant={d.severity === 'CRITICAL' ? 'danger' : d.severity === 'MAJOR' ? 'warning' : 'neutral'}>{d.severity?.toLowerCase()}</Badge>
        <span className="text-xs text-slate-500 ml-auto">{d.initiatorName} · {formatDateTime(d.formSubmittedAt)}{d.revisions.length > 1 ? ` · revision ${d.revisions.length}` : ''}</span>
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {row('Action', ACTION_NAMES[d.action])}
        {row('Deviation qty', formatQty(d.deviationQty, d.uom))}
        {row('Specification', d.specification)}
        {row('IQC observation', d.iqcObservation)}
        {row('Correction', d.correction)}
        {row('Corrective action', d.correctiveAction)}
      </dl>
    </section>
  );
}

function QuantityForm({ d }) {
  const [okQty, setOk] = useState(d.okQty ?? '');
  const [notOkQty, setNotOk] = useState(d.notOkQty ?? '');
  const [remark, setRemark] = useState('');
  const [error, setError] = useState(null);
  const [run, { isLoading }] = useDeviationActionMutation();
  const save = async () => {
    setError(null);
    if (okQty === '' || notOkQty === '') return setError('Enter both quantities.');
    try {
      await run({ id: d.id, action: 'enter_qty', rowVersion: d.rowVersion, okQty: Number(okQty), notOkQty: Number(notOkQty), remark: remark.trim() || null }).unwrap();
      toast.success('Quantities sent to the IQC Head');
    } catch (err) {
      setError(apiError(err).message);
    }
  };
  return (
    <section className="card border-blue-200 p-4 space-y-3">
      <div>
        <h2 className="text-sm font-bold text-slate-800">{ACTION_NAMES[d.action]} result</h2>
        <p className="text-xs text-slate-500">Enter the quantities after {ACTION_NAMES[d.action]?.toLowerCase()}, by {formatDateTime(d.qtyDueAt)}. Without them the deviation closes itself.</p>
      </div>
      <FormError message={error} />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextInput label={`OK qty (${d.uom ?? ''})`} required type="number" min="0" step="any" value={okQty} onChange={(e) => setOk(e.target.value)} />
        <TextInput label={`Not-OK qty (${d.uom ?? ''})`} required type="number" min="0" step="any" value={notOkQty} onChange={(e) => setNotOk(e.target.value)} />
        <TextInput label="Remark" value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={1000} />
      </div>
      <div className="flex justify-end"><Button icon={Send} loading={isLoading} onClick={save}>Send for verification</Button></div>
    </section>
  );
}

const STEP_BADGE = { PENDING: ['Pending', 'warning'], DECIDED: ['Decided', 'success'], TIMED_OUT: ['Timed out', 'danger'], NOT_REQUIRED: ['Not required', 'neutral'] };

/** Senior escalation rounds: who was asked, what each decided, and the effective result. */
function EscalationBoard({ d }) {
  const current = d.rounds.at(-1);
  return (
    <section className="card p-4 space-y-4">
      <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Scale className="w-4 h-4 text-slate-500" />Senior escalation</h2>
      {[...d.rounds].reverse().map((r) => (
        <div key={r.id} className="rounded-lg border border-slate-200 p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">Round {r.roundNo}</span>
            <span className="text-xs text-slate-500">{r.openedByName} · {formatDateTime(r.openedAt)}</span>
            <span className="ml-auto">
              {r.status === 'COMPLETE' ? <Badge variant={r.effectiveDecision === 'REJECT' ? 'danger' : r.effectiveDecision === 'APPROVE' ? 'success' : 'warning'}>{DECISION_NAMES[r.effectiveDecision]} · {ROLE_SHORT[r.decidedByRole] ?? r.decidedByRole}</Badge>
                : <Badge variant="info">Open{r.resolution.pendingPdc ? ' · waiting for PDC' : ''}</Badge>}
            </span>
          </div>
          {r.remark && <p className="text-sm text-slate-700 bg-slate-50 rounded px-3 py-1.5">{r.remark}</p>}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {r.steps.map((s) => {
              const latest = r.decisions.filter((x) => x.roleCode === s.roleCode && x.kind === 'NORMAL').at(-1);
              return (
                <div key={s.roleCode} className="rounded-lg border border-slate-200 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-800">{s.roleName}</span>
                    <Badge variant={STEP_BADGE[s.status][1]}>{STEP_BADGE[s.status][0]}</Badge>
                  </div>
                  {s.reason === 'AUTO_CQA' && <div className="text-[11px] text-slate-500">Added after the Operations Head timed out</div>}
                  {s.dueAt && s.status === 'PENDING' && <div className="text-[11px] text-amber-700">Due {formatDateTime(s.dueAt)}</div>}
                  {latest && <div className="mt-1 text-xs"><span className="font-semibold">{DECISION_NAMES[latest.decision]}</span> · {latest.decidedByName}<div className="text-slate-600">{latest.remark}</div></div>}
                </div>
              );
            })}
          </div>
          {r.decisions.filter((x) => x.kind === 'OVERRIDE').map((o) => (
            <div key={o.id} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm">
              <span className="font-semibold">Override: {DECISION_NAMES[o.decision]}</span> by {o.decidedByName} ({ROLE_SHORT[o.roleCode] ?? o.roleCode}) · {formatDateTime(o.decidedAt)}
              <div className="text-slate-700">{o.remark}</div>
            </div>
          ))}
        </div>
      ))}
      {d.allowedActions.includes('senior_decide') && current.status === 'OPEN' && <SeniorDecision d={d} />}
    </section>
  );
}

function SeniorDecision({ d }) {
  const [roleCode, setRoleCode] = useState(d.seniorRoles[0]);
  const [decision, setDecision] = useState(null);
  const [remark, setRemark] = useState('');
  const [error, setError] = useState(null);
  const [run, { isLoading }] = useDeviationActionMutation();
  const save = async () => {
    setError(null);
    if (!decision) return setError('Choose a decision.');
    if (!remark.trim()) return setError('Enter a remark.');
    try {
      await run({ id: d.id, action: 'senior_decide', roleCode, decision, remark: remark.trim() }).unwrap();
      toast.success('Decision recorded');
      setRemark('');
      setDecision(null);
    } catch (err) {
      setError(apiError(err).message);
    }
  };
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-3">
      <h3 className="text-sm font-bold text-slate-800">Your decision</h3>
      <FormError message={error} />
      {d.seniorRoles.length > 1 && (
        <Select label="Deciding as" value={roleCode} onChange={(v) => setRoleCode(v ?? d.seniorRoles[0])} options={d.seniorRoles.map((r) => ({ value: r, label: ROLE_SHORT[r] ?? r }))} />
      )}
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Decision">
        {Object.entries(DECISION_NAMES).map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={decision === v} onClick={() => setDecision(v)}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold cursor-pointer ${decision === v ? (v === 'REJECT' ? 'border-rose-400 bg-rose-50 text-rose-700' : v === 'APPROVE' ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-amber-400 bg-amber-50 text-amber-700') : 'border-slate-200 bg-white text-slate-600'}`}>
            {l}
          </button>
        ))}
      </div>
      <TextArea label="Remark" required value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={1000} />
      <p className="text-[11px] text-slate-500">Change type sends the deviation back to the department to choose another action. A higher authority&apos;s decision overrules yours.</p>
      <div className="flex justify-end"><Button loading={isLoading} onClick={save}>Record decision</Button></div>
    </div>
  );
}

function DecisionDialog({ d, action, onClose }) {
  const c = DECISIONS[action];
  const [remark, setRemark] = useState('');
  const [authorities, setAuthorities] = useState([]);
  const [decision, setDecision] = useState(null);
  const [error, setError] = useState(null);
  const [run, { isLoading }] = useDeviationActionMutation();

  const save = async () => {
    setError(null);
    if (c.remark !== 'optional' && !remark.trim()) return setError('Enter a remark.');
    if (action === 'escalate' && !authorities.length) return setError('Choose at least one authority.');
    if (action === 'override' && !decision) return setError('Choose approve or reject.');
    const body = { id: d.id, action, rowVersion: d.rowVersion, remark: remark.trim() || null };
    if (action === 'escalate') body.authorities = authorities;
    if (action === 'override') body.decision = decision;
    try {
      await run(body).unwrap();
      toast.success(`${d.deviationNo}: ${c.label.toLowerCase()} done`);
      onClose();
    } catch (err) {
      setError(apiError(err).message);
    }
  };

  return (
    <Modal title={c.label} subtitle={`${d.deviationNo} · ${d.itemCode}`} onClose={onClose}
      footer={<ModalFooter onCancel={onClose} onSave={save} saving={isLoading} saveLabel={c.label} saveVariant={c.variant === 'secondary' ? 'primary' : c.variant} />}>
      <FormError message={error} />
      <p className="text-sm text-slate-600 mb-4">{c.help}</p>
      <div className="space-y-4">
        {action === 'escalate' && (
          <fieldset>
            <legend className="block text-[11px] font-medium text-slate-500 mb-1">Authorities <span className="text-rose-500">*</span></legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {[...ESCALATION_RANKS].reverse().map(({ roleCode }) => (
                <label key={roleCode} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${authorities.includes(roleCode) ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-slate-200'}`}>
                  <input type="checkbox" className="mr-2" checked={authorities.includes(roleCode)} onChange={(e) => setAuthorities((a) => (e.target.checked ? [...a, roleCode] : a.filter((x) => x !== roleCode)))} />
                  {ROLE_SHORT[roleCode]}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {action === 'override' && (
          <div className="flex gap-2">
            {['APPROVE', 'REJECT'].map((v) => (
              <Button key={v} variant={decision === v ? (v === 'APPROVE' ? 'success' : 'danger') : 'secondary'} onClick={() => setDecision(v)}>{DECISION_NAMES[v]}</Button>
            ))}
          </div>
        )}
        <TextArea label="Remark" required={c.remark !== 'optional'} value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={1000} />
      </div>
    </Modal>
  );
}
