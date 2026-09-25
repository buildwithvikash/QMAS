import { formatDate, formatDateTime } from '../../utils/format.js';
import { ACTION_NAMES, DECISION_NAMES, ROLE_SHORT } from './workflowLabels.js';

/** Readable names for changed fields in the History panel (database column → label). */
export const FIELD_LABELS = {
  status: 'Status', result: 'Result', model: 'Model', inspector_remark: 'Inspector remark', incharge_remark: 'Incharge remark',
  defective_samples: 'NOK samples', imir_no: 'IMIR no.', submitted_at: 'Submitted', closed_at: 'Closed',
  value_num: 'Reading', value_ok: 'Visual check', decision: 'Decision', text_observation: 'Observation', manual_result: 'Test result',
  is_required: 'Test due', file_name: 'File', deleted_at: 'Removed',
  stage: 'Stage', department: 'Department', suggested_actions: 'Suggested actions', hold_remark: 'Hold remark', dept_outcome: 'Department decision',
  severity: 'Severity', action: 'Action', deviation_qty: 'Deviation qty', specification: 'Specification', iqc_observation: 'IQC observation',
  correction: 'Correction', corrective_action: 'Corrective action', form_submitted_at: 'Form submitted', senior_effective: 'Senior decision',
  final_decision: 'Final decision', final_decision_at: 'Final decision on', qty_due_at: 'Quantities due', ok_qty: 'OK qty', not_ok_qty: 'Not-OK qty',
  qty_entered_at: 'Quantities entered', qty_verified_at: 'Quantities verified', outcome: 'Outcome',
  dn_no: 'DN no.', dn_date: 'DN date', received_qty: 'Received qty', checked_qty: 'Checked qty', defective_qty: 'Defective qty',
  capa_applicable: 'CAPA applicable', defect: 'Defect', capa_due_at: 'CAPA due', last_reminder_at: 'Last reminder',
  root_cause: 'Root cause', target_date: 'Target date', closing_date: 'Closing date', responsibility: 'Responsibility', remark: 'Remark',
  review_decision: 'Review', review_remark: 'Review remark', reviewed_at: 'Reviewed', submitted_at_capa: 'Submitted', cycle_no: 'Cycle',
};

export const fieldLabel = (k) => FIELD_LABELS[k] ?? k.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());

/** A stored value as people read it: dates in IST, yes/no, codes in words, units on readings. */
export function formatValue(key, v, unit) {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return null;
  if (key === 'value_ok') return v ? 'OK' : 'NOK';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.map((x) => formatValue(key, x)).join(', ');
  if (typeof v === 'number') return `${v.toLocaleString('en-IN', { maximumFractionDigits: 3 })}${key === 'value_num' && unit ? ` ${unit}` : ''}`;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return formatDateTime(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return formatDate(s);
  if (/^[A-Z][A-Z_]+$/.test(s) && s !== 'OK' && s !== 'NOK' && s !== 'UAI' && s !== 'SCM' && s !== 'VD') return s.replaceAll('_', ' ').toLowerCase();
  return s;
}

/** Names of workflow steps in the History panel. */
export const HISTORY_LABELS = {
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

/** The one-line detail of a step (result, deviation number, decision…), or null. */
export function stepDetail(h) {
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

// Fields the workflow sets by itself (the step in the History already says so), never shown as key changes.
const ROUTINE_FIELDS = new Set([
  'status', 'stage', 'result', 'imir_no', 'dn_no', 'dn_date', 'cycle_no', 'is_required', 'senior_effective', 'current_level',
  'submitted_at', 'submitted_at_capa', 'closed_at', 'form_submitted_at', 'final_decision_at', 'qty_due_at', 'qty_entered_at',
  'qty_verified_at', 'reviewed_at', 'capa_due_at', 'last_reminder_at', 'updated_at', 'updated_by', 'recorded_at', 'recorded_by',
  'client_time', 'device_id', 'deleted_at', 'file_name', 'defective_samples',
]);
// Decisions and quantities: important even when filled in for the first time.
const DECISION_FIELDS = new Set([
  'final_decision', 'outcome', 'dept_outcome', 'review_decision', 'severity', 'action', 'deviation_qty', 'ok_qty', 'not_ok_qty',
  'defective_qty', 'capa_applicable', 'manual_result',
]);
// Decisions the workflow clears itself when a form or CAPA goes round again.
const RESET_BY_WORKFLOW = new Set(['dept_outcome', 'outcome', 'final_decision', 'review_decision', 'review_remark']);
const TEXT_FIELD = /remark|observation|correction|corrective_action|root_cause|defect|suggested_actions/;
const READING_VALUES = new Set(['value_num', 'value_ok', 'text_observation', 'manual_result']);
const isSet = (v) => v !== null && v !== undefined && v !== '';

/**
 * The fields of one change worth showing by default: corrections of a value already recorded,
 * NOK findings, decisions and quantities, remarks, and removed files. First entries of readings and
 * fields the workflow fills in itself are routine; the full list stays one click away.
 * Returns { fields, important, kind } where kind groups routine changes for the summary line.
 */
export function classifyChange(c) {
  if (c.entity === 'FILE') return { fields: [], important: c.op === 'D', kind: c.op === 'D' ? null : 'photo' };
  if (c.op === 'D') return { fields: c.fields, important: true, kind: null };
  if (c.entity === 'READING') {
    const corrected = c.fields.some((f) => READING_VALUES.has(f.key) && isSet(f.old));
    const becameNok = c.fields.some((f) => f.key === 'decision' && f.new === 'NOK' && f.old !== 'NOK');
    return corrected || becameNok ? { fields: c.fields, important: true, kind: null } : { fields: [], important: false, kind: 'reading' };
  }
  const keep = c.entity === 'CHECKPOINT'
    // A checkpoint: remarks, corrections and NOK results; a first observation is routine entry.
    ? (f) => isSet(f.old) || /remark/.test(f.key) || (f.key === 'manual_result' && f.new === 'NOK')
    : (f) => isSet(f.old) || DECISION_FIELDS.has(f.key) || TEXT_FIELD.test(f.key);
  const fields = c.fields.filter((f) => !ROUTINE_FIELDS.has(f.key) && !(RESET_BY_WORKFLOW.has(f.key) && !isSet(f.new)) && keep(f));
  if (fields.length) return { fields, important: true, kind: null };
  return { fields: [], important: false, kind: c.entity === 'CHECKPOINT' ? 'reading' : 'update' };
}

/** "24 readings entered · 2 photos added" for the routine changes left out of a History entry. */
export function routineSummary(changes, { withUpdates = true } = {}) {
  const n = { reading: 0, photo: 0, update: 0 };
  for (const c of changes) {
    const k = classifyChange(c);
    if (!k.important && k.kind) n[k.kind] += 1;
  }
  const parts = [];
  if (n.reading) parts.push(`${n.reading} reading${n.reading === 1 ? '' : 's'} entered`);
  if (n.photo) parts.push(`${n.photo} photo${n.photo === 1 ? '' : 's'} added`);
  if (withUpdates && n.update) parts.push(`${n.update} routine update${n.update === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
