import Badge from '../../components/ui/Badge.jsx';

const STATUS = {
  AWAITING_FORMAT: ['Waiting for format', 'warning'],
  OPEN: ['To inspect', 'info'],
  IN_INSPECTION: ['Inspecting', 'primary'],
  SUBMITTED: ['With Incharge', 'neutral'],
  WITH_IQC_HEAD: ['With IQC Head', 'neutral'],
  DEPT_REVIEW: ['With SCM / VD', 'neutral'],
  IQC_HEAD_FINAL: ['IQC Head decision', 'neutral'],
  SENIOR_ESCALATION: ['Escalated', 'danger'],
  UNDER_DEVIATION: ['Under deviation', 'warning'],
  QTY_VERIFICATION: ['Quantity check', 'warning'],
  CLOSED_ACCEPTED: ['Closed · accepted', 'success'],
  CLOSED_REJECTED: ['Closed · rejected', 'danger'],
  CLOSED_UNDER_DEVIATION: ['Closed · deviation', 'success'],
  AUTO_CLOSED: ['Auto-closed', 'neutral'],
};

export const ImirStatus = ({ status }) => <Badge variant={STATUS[status]?.[1] ?? 'neutral'}>{STATUS[status]?.[0] ?? status}</Badge>;
export const ImirResult = ({ result }) => (result ? <Badge variant={result === 'OK' ? 'success' : 'danger'}>{result}</Badge> : <span className="text-slate-300">—</span>);
