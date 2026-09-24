import { Check, FileX2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDateTime, formatRelative } from '../../utils/format.js';
import { DnStatus } from '../deviation/workflowUi.jsx';

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
function journeySteps({ status, history = [], deviation }) {
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

/**
 * The lot's route, drawn like a factory routing ticket: a rail of stations, filled up to the
 * current one. Done stations are ticked, the current one is marked with who holds it and since
 * when, later ones are hollow. `extra` shows alongside (e.g. the lot's DN).
 */
export function Stepper({ steps, since, extra, title = 'Route' }) {
  const currentIdx = steps.findIndex((s) => s.state === 'current');
  const current = steps[currentIdx];
  const closed = steps.at(-1)?.state === 'done';
  const reach = closed ? steps.length - 1 : Math.max(currentIdx, 0);
  const pct = steps.length > 1 ? (reach / (steps.length - 1)) * 100 : 0;
  const endTone = steps.at(-1)?.tone;
  const fill = closed ? (endTone === 'bad' ? 'bg-rose-500' : endTone === 'neutral' ? 'bg-slate-400' : 'bg-emerald-500') : 'bg-blue-600';
  return (
    <section className="card px-5 pt-3.5 pb-4" aria-label={title}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-4">
        <h2 className="section-title">{title}</h2>
        {current?.holder && (
          <p className="text-xs text-slate-500">
            Now with <span className="font-semibold text-slate-800">{current.holder}</span>
            {since && <> for <span title={formatDateTime(since)}>{formatRelative(since).replace(' ago', '')}</span></>}
          </p>
        )}
        {closed && <p className="text-xs text-slate-500">Closed: <span className="font-semibold text-slate-800">{steps.at(-1).label}</span></p>}
        {extra && <div className="ml-auto">{extra}</div>}
      </div>
      <div className="no-scrollbar overflow-x-auto">
        <ol className="relative flex justify-between min-w-[34rem] px-1">
          {/* Rail runs between the first and last station centres (stations are 6rem wide, list has 0.25rem padding). */}
          <span className="absolute top-[9px] h-[3px] rounded-full bg-slate-200" style={{ left: '3.25rem', right: '3.25rem' }} aria-hidden="true" />
          <span className={`absolute top-[9px] h-[3px] rounded-full ${fill} transition-[width] duration-500`} style={{ left: '3.25rem', width: `calc((100% - 6.5rem) * ${pct / 100})` }} aria-hidden="true" />
          {steps.map((s) => {
            const on = s.state === 'current';
            const done = s.state === 'done';
            const marker = on
              ? 'w-[21px] h-[21px] -mt-0.5 bg-white border-[5px] border-blue-600'
              : done
                ? `w-[18px] h-[18px] text-white ${s.tone === 'bad' ? 'bg-rose-500' : s.tone === 'neutral' ? 'bg-slate-400' : closed ? 'bg-emerald-500' : 'bg-blue-600'}`
                : 'w-[18px] h-[18px] bg-white border-2 border-slate-300';
            return (
              <li key={s.key} className="relative z-10 flex flex-col items-center gap-2 w-24 shrink-0" aria-current={on ? 'step' : undefined}>
                <span className={`rounded-full flex items-center justify-center ${marker}`}>{done && <Check className="w-3 h-3" strokeWidth={3.5} />}</span>
                <span className={`text-xs text-center leading-tight ${on ? 'font-semibold text-blue-800' : done ? 'text-slate-700' : 'text-slate-400'}`}>{s.label}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/** Progress of a lot, used on the IMIR and deviation pages. */
export default function LotJourney({ status, history, deviation, dn }) {
  const steps = journeySteps({ status, history, deviation });
  const since = history?.length ? history[history.length - 1].at : null;
  const extra = dn && (
    <Link to={`/dns/${dn.id}`} className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs hover:border-rose-300 transition-colors">
      <FileX2 className="w-3.5 h-3.5 text-rose-600" /><span className="font-mono font-semibold">{dn.dnNo}</span><DnStatus status={dn.status} />
    </Link>
  );
  return <Stepper steps={steps} since={since} extra={extra} />;
}
