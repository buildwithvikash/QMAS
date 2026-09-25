import Badge from '../../components/ui/Badge.jsx';
import { STAGES } from './workflowLabels.js';

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
