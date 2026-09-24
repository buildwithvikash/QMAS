import { CheckCircle2, Circle, Clock, XCircle } from 'lucide-react';
import Badge from '../../components/ui/Badge.jsx';
import { formatDateTime } from '../../utils/format.js';
import { ACTION_NAMES, DECISION_NAMES, ROLE_SHORT, STAGES } from './workflowLabels.js';

const OUTCOMES = { ACCEPTED_UNDER_DEVIATION: ['Accepted under deviation', 'success'], REJECTED: ['Rejected', 'danger'], AUTO_CLOSED: ['Auto-closed', 'neutral'] };

const DN_STATUS = { OPEN: ['Open · CAPA awaited', 'warning'], CAPA_SUBMITTED: ['CAPA with IQC Head', 'primary'], CLOSED: ['Closed', 'success'] };
export function DnStatus({ status, overdue }) {
  const [label, variant] = DN_STATUS[status] ?? [status, 'neutral'];
  return <Badge variant={overdue ? 'danger' : variant}>{overdue ? 'CAPA overdue' : label}</Badge>;
}

export function DeviationStage({ stage, outcome }) {
  const [label, variant] = stage === 'CLOSED' && outcome ? OUTCOMES[outcome] : (STAGES[stage] ?? [stage, 'neutral']);
  return <Badge variant={variant}>{label}</Badge>;
}


const HISTORY_LABELS = {
  SUBMIT: 'Inspection submitted',
  APPROVE: 'Approved by Incharge',
  REVERT: 'Sent back to inspector',
  ESCALATE: 'Escalated',
  HEAD_APPROVE: 'Approved by IQC Head',
  HOLD: 'Put on hold',
  SUBMIT_FORM: 'Deviation Form submitted',
  RECOMMEND_REJECT: 'Rejection recommended',
  DEPT_APPROVE: 'Approved by department',
  SEND_BACK: 'Sent back to initiator',
  DEPT_REJECT: 'Rejected by department',
  FINAL_APPROVE: 'Deviation approved',
  FINAL_REJECT: 'Deviation rejected',
  SENIOR_DECISION: 'Senior decision',
  SENIOR_RESULT: 'Senior escalation decided',
  OVERRIDE: 'Decision overridden',
  OPS_TIMEOUT: 'Operations Head did not decide in 24 h',
  ENTER_QTY: 'Quantities entered',
  VERIFY_QTY: 'Quantities verified',
  RETURN_QTY: 'Quantities returned',
  AUTO_CLOSE: 'Closed: quantities not entered in 14 days',
  DN_RAISE: 'Defect notification raised',
  DN_SUBMIT_CAPA: 'CAPA submitted',
  DN_RESUBMIT: 'CAPA resubmission asked',
  DN_CLOSE: 'Defect notification closed',
  CAPA_REMINDER: 'CAPA overdue reminder',
};

function payloadText(h) {
  const p = h.payload ?? {};
  switch (h.action) {
    case 'SUBMIT': return `Result ${p.result}${p.defectiveSamples?.length ? `, NOK in sample ${p.defectiveSamples.join(', ')}` : ''}`;
    case 'HOLD': return `${p.deviationNo} → ${p.department}; suggested ${p.suggestedActions.map((a) => ACTION_NAMES[a]).join(', ')}`;
    case 'SUBMIT_FORM': return `Revision ${p.revision}: ${ACTION_NAMES[p.action]}, ${p.severity.toLowerCase()}, qty ${p.deviationQty}`;
    case 'ESCALATE': return p.authorities ? `Round ${p.round} to ${p.authorities.map((r) => ROLE_SHORT[r]).join(', ')}` : null;
    case 'SENIOR_DECISION': return `${DECISION_NAMES[p.decision]}${h.actingRole === 'SYSTEM_ADMIN' && p.forRole ? ` (on behalf of ${ROLE_SHORT[p.forRole]})` : ''}`;
    case 'OVERRIDE': return DECISION_NAMES[p.decision];
    case 'SENIOR_RESULT': return `${DECISION_NAMES[p.decision]} (${ROLE_SHORT[p.decidedBy] ?? p.decidedBy}${p.overridden ? ', override' : ''})`;
    case 'DN_RAISE': return p.dnNo;
    case 'DN_SUBMIT_CAPA': return p.capaApplicable === false ? 'CAPA not applicable' : `CAPA cycle ${p.cycle}`;
    case 'OPS_TIMEOUT': return p.added?.length ? 'CQA Head added to the round' : null;
    case 'ENTER_QTY': case 'VERIFY_QTY': return p.okQty !== undefined ? `OK ${p.okQty} · Not OK ${p.notOkQty}` : null;
    default: return null;
  }
}

const tone = (a) => (/REJECT|REVERT|SEND_BACK|RETURN|TIMEOUT|AUTO_CLOSE|RESUBMIT|REMINDER/.test(a) ? 'bad' : /APPROVE|VERIFY/.test(a) ? 'good' : 'neutral');

/** Who did what, when and why — every workflow step of the lot, oldest first. */
export function HistoryTimeline({ history }) {
  if (!history?.length) return <p className="text-sm text-slate-400">No workflow steps yet.</p>;
  return (
    <ol className="relative border-l border-slate-200 ml-2 space-y-4">
      {history.map((h) => {
        const t = tone(h.action);
        const Icon = t === 'good' ? CheckCircle2 : t === 'bad' ? XCircle : h.actorId ? Circle : Clock;
        const detail = payloadText(h);
        return (
          <li key={h.id} className="ml-4">
            <Icon className={`absolute -left-2 w-4 h-4 bg-white ${t === 'good' ? 'text-emerald-500' : t === 'bad' ? 'text-rose-500' : 'text-slate-400'}`} />
            <div className="text-sm font-semibold text-slate-800">{HISTORY_LABELS[h.action] ?? h.action}</div>
            <div className="text-xs text-slate-500">
              {h.actorName ? `${h.actorName}${h.actingRoleName ? ` · ${h.actingRoleName}` : ''}` : 'System'} · {formatDateTime(h.at)}
            </div>
            {detail && <div className="text-xs text-slate-600 mt-0.5">{detail}</div>}
            {h.remark && <div className="mt-1 text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-1.5 whitespace-pre-line">{h.remark}</div>}
          </li>
        );
      })}
    </ol>
  );
}
