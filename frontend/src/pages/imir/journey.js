/** The lot's route (stations and who holds the current one), shared by the route rail and History. */
const CLOSED = { CLOSED_ACCEPTED: 'Accepted', CLOSED_REJECTED: 'Rejected', CLOSED_UNDER_DEVIATION: 'Accepted under deviation', AUTO_CLOSED: 'Auto-closed' };
const DEPT_ROLE = { INITIATOR: 'initiator', SUB_HEAD: 'Sub-Head', HEAD: 'Head' };

/** The lot's path, in order. Optional steps appear only when this lot reached them. */
const STEPS = [
  { key: 'format', label: 'Format', statuses: ['AWAITING_FORMAT'], optional: true, holder: () => 'IQC Head (approve a format)' },
  { key: 'inspect', label: 'Inspection', statuses: ['OPEN', 'IN_INSPECTION'], holder: () => 'IQC Inspector' },
  { key: 'review', label: 'Incharge review', statuses: ['SUBMITTED'], holder: () => 'IQC Incharge' },
  { key: 'head', label: 'IQC Head', statuses: ['WITH_IQC_HEAD'], optional: true, holder: () => 'Plant IQC Head' },
  { key: 'dept', label: 'SCM / VD', statuses: ['DEPT_REVIEW'], optional: true, holder: (d) => (d ? `${d.department} ${DEPT_ROLE[d.stage] ?? ''}`.trim() : 'SCM / VD') },
  { key: 'final', label: 'Final decision', statuses: ['IQC_HEAD_FINAL'], optional: true, holder: () => 'Plant IQC Head' },
  { key: 'senior', label: 'Senior escalation', statuses: ['SENIOR_ESCALATION'], optional: true, holder: () => 'Senior authorities' },
  { key: 'qty', label: 'Quantities', statuses: ['UNDER_DEVIATION', 'QTY_VERIFICATION'], optional: true, holder: (d, s) => (s === 'QTY_VERIFICATION' ? 'Plant IQC Head (verify)' : `${d?.department ?? 'SCM / VD'} initiator (enter OK / Not OK)`) },
  { key: 'closed', label: 'Closed', statuses: Object.keys(CLOSED) },
];

/** Builds the steps for a lot from its status, workflow history and deviation. */
export function journeySteps({ status, history = [], deviation }) {
  const reached = new Set([status, ...history.map((h) => h.toStatus).filter(Boolean)]);
  const currentIdx = STEPS.findIndex((s) => s.statuses.includes(status));
  const closed = !!CLOSED[status];
  return STEPS.map((s, i) => ({ ...s, i }))
    .filter((s) => !s.optional || s.statuses.some((st) => reached.has(st)))
    .map((s) => {
      const state = closed ? 'done' : s.i < currentIdx ? 'done' : s.i === currentIdx ? 'current' : 'next';
      return {
        key: s.key,
        label: s.key === 'closed' && closed ? CLOSED[status] : s.label,
        state,
        holder: state === 'current' ? s.holder?.(deviation, status) : null,
        tone: s.key === 'closed' && closed ? (status === 'CLOSED_REJECTED' ? 'bad' : status === 'AUTO_CLOSED' ? 'neutral' : 'good') : null,
      };
    });
}

/** Where a record stands now, from its route steps: { label, holder, closed, tone }. */
export function currentStage(steps) {
  const last = steps.at(-1);
  if (last?.state === 'done') return { label: last.label, closed: true, tone: last.tone };
  const cur = steps.find((s) => s.state === 'current');
  return cur ? { label: cur.label, holder: cur.holder, closed: false } : null;
}

// Short outcome of each workflow step, for the Status column of the stage history.
const STEP_STATUS = {
  SUBMIT: ['Submitted', 'info'], APPROVE: ['Approved', 'good'], REVERT: ['Sent back', 'warn'], ESCALATE: ['Escalated', 'esc'],
  HEAD_APPROVE: ['Approved', 'good'], HOLD: ['On hold', 'esc'], SUBMIT_FORM: ['Form submitted', 'info'], RECOMMEND_REJECT: ['Reject recommended', 'bad'],
  DEPT_APPROVE: ['Approved', 'good'], SEND_BACK: ['Sent back', 'warn'], DEPT_REJECT: ['Rejected', 'bad'], FINAL_APPROVE: ['Approved', 'good'],
  FINAL_REJECT: ['Rejected', 'bad'], SENIOR_DECISION: ['Decided', 'esc'], SENIOR_RESULT: ['Decided', 'esc'], OVERRIDE: ['Overridden', 'esc'],
  OPS_TIMEOUT: ['Timed out', 'bad'], ENTER_QTY: ['Qty entered', 'info'], VERIFY_QTY: ['Verified', 'good'], RETURN_QTY: ['Returned', 'warn'],
  AUTO_CLOSE: ['Auto-closed', 'bad'], DN_RAISE: ['Raised', 'info'], DN_SUBMIT_CAPA: ['CAPA submitted', 'info'], DN_RESUBMIT: ['Resubmit asked', 'warn'],
  DN_CLOSE: ['Closed', 'good'], CAPA_REMINDER: ['Reminder sent', 'warn'],
};
const DN_STAGE = { OPEN: 'Vendor CAPA', CAPA_SUBMITTED: 'IQC Head review', CLOSED: 'Closed' };
const DECISION_WORD = { APPROVE: 'Approved', REJECT: 'Rejected', CHANGE_TYPE: 'Type changed' };

/** The stage a step was taken in (the status it left), in the words of the route rail. */
function stageOf(h) {
  if (h.action === 'DN_RAISE') return 'DN raised';
  if (h.dnId && DN_STAGE[h.fromStatus]) return DN_STAGE[h.fromStatus];
  if (h.fromStatus === 'DEPT_REVIEW') return 'SCM / VD approval';
  return STEPS.find((s) => s.statuses.includes(h.fromStatus))?.label ?? HISTORY_STAGE_FALLBACK[h.action] ?? '—';
}
const HISTORY_STAGE_FALLBACK = {
  SENIOR_DECISION: 'Senior escalation', SENIOR_RESULT: 'Senior escalation', OVERRIDE: 'Senior escalation', SUBMIT: 'Inspection', AUTO_CLOSE: 'Quantities', OPS_TIMEOUT: 'Senior escalation', CAPA_REMINDER: 'Vendor CAPA' };

/**
 * Rows of the stage history table: optionally the record's start (e.g. received from SAP), each
 * workflow step (stage, who, role, when, outcome) and, while open, the stage it waits in now.
 */
export function stageRows({ history = [], current, start }) {
  const rows = [];
  if (start?.at) rows.push({ key: 'start', stage: start.stage, user: start.user ?? 'System', role: start.role ?? null, at: start.at, status: start.status, tone: 'info' });
  for (const h of history) {
    const [word, tone] = STEP_STATUS[h.action] ?? [h.action, 'info'];
    const status = h.action === 'SENIOR_DECISION' || h.action === 'SENIOR_RESULT' || h.action === 'OVERRIDE' ? DECISION_WORD[h.payload?.decision] ?? word : word;
    rows.push({ key: h.id, stage: stageOf(h), user: h.actorName ?? 'System', role: h.actingRoleName ?? null, at: h.at, status, tone, remark: h.remark });
  }
  if (current && !current.closed) {
    rows.push({ key: 'now', stage: current.label, user: null, role: current.holder ?? null, at: history.at(-1)?.at ?? start?.at, status: 'Pending', tone: 'pending', pending: true });
  }
  return rows;
}
