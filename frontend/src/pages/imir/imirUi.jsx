import Badge from '../../components/ui/Badge.jsx';

const STATUS = {
  AWAITING_FORMAT: ['Waiting for format', 'neutral'],
  OPEN: ['To inspect', 'warning'],
  IN_INSPECTION: ['Inspecting', 'info'],
  SUBMITTED: ['In review', 'violet'],
  WITH_IQC_HEAD: ['With IQC Head', 'violet'],
  DEPT_REVIEW: ['With SCM / VD', 'violet'],
  IQC_HEAD_FINAL: ['IQC Head decision', 'violet'],
  SENIOR_ESCALATION: ['Escalated', 'danger'],
  UNDER_DEVIATION: ['Under deviation', 'warning'],
  QTY_VERIFICATION: ['Quantity check', 'warning'],
  CLOSED_ACCEPTED: ['Closed', 'success'],
  CLOSED_REJECTED: ['Rejected', 'danger'],
  CLOSED_UNDER_DEVIATION: ['Closed · deviation', 'success'],
  AUTO_CLOSED: ['Auto-closed', 'neutral'],
};

/** Plain words for each IMIR status (exports, filters). */
export const STATUS_LABEL = Object.fromEntries(Object.entries(STATUS).map(([k, [label]]) => [k, label]));

export const ImirStatus = ({ status }) => <Badge variant={STATUS[status]?.[1] ?? 'neutral'}>{STATUS[status]?.[0] ?? status}</Badge>;
export const ImirResult = ({ result }) => (result ? <Badge variant={result === 'OK' ? 'success' : 'danger'}>{result}</Badge> : <span className="text-slate-300">—</span>);
