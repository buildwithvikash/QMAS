import { PERMISSIONS } from '@qmas/shared';
import { AlertTriangle, ArrowRight, LayoutDashboard } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useGetNumberSeriesQuery, useGetSamplingPlansQuery } from '../api/mastersApi.js';
import { useGetMyRecentQuery, useGetMyTasksQuery } from '../api/workflowApi.js';
import PageHeader from '../components/ui/PageHeader.jsx';
import { useAccess } from '../hooks/useAccess.js';
import { formatRelative } from '../utils/format.js';
import { HISTORY_LABELS } from './deviation/historyFormat.js';
import { countsByKind, KINDS } from './home/taskUi.js';
import MyTasks from './MyTasks.jsx';
import PlantStatus from './PlantStatus.jsx';
import QualityPanel from './QualityPanel.jsx';

const P = PERMISSIONS;
// Which kinds of work a user can ever get, so their tiles show even at zero.
const KIND_PERMISSIONS = {
  inspect: [P.IMIR_INSPECT],
  review: [P.IMIR_REVIEW, P.IMIR_HEAD_DECIDE],
  deviation: [P.DEVIATION_INITIATE, P.DEVIATION_APPROVE, P.DEVIATION_FINAL_DECIDE, P.ESCALATION_DECIDE],
  capa: [P.DN_MANAGE, P.DN_APPROVE_CAPA],
  format: [P.FORMATS_CREATE, P.FORMATS_APPROVE],
};

/**
 * Home: what the user has to do, first. Tiles count each kind of work (urgent ones marked) and
 * narrow the queue below; beside it, the plant's open work and what the user did last. Incoming
 * quality follows. Configuration problems appear only when something is missing.
 */
export default function Home() {
  const { user, can } = useAccess();
  const [kind, setKind] = useState(null);
  const tasksQuery = useGetMyTasksQuery(undefined, { pollingInterval: 60_000, refetchOnFocus: true });
  const tasks = tasksQuery.data ?? [];
  const counts = countsByKind(tasks);
  const kinds = KINDS.filter((k) => counts[k.key].total > 0 || KIND_PERMISSIONS[k.key].some((p) => can(p)));
  const urgent = Object.values(counts).reduce((a, c) => a + c.urgent, 0);
  const today = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  return (
    <div>
      <PageHeader icon={LayoutDashboard} title={`Good ${partOfDay()}, ${user.fullName.split(' ')[0]}`} subtitle={today}>
        <div className="hidden md:flex flex-wrap justify-end gap-1 max-w-md">
          {user.roles.map((r) => (
            <span key={`${r.roleCode}-${r.plantSapCode ?? ''}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
              {r.roleName}{r.plantName ? ` · ${r.plantName}` : ''}
            </span>
          ))}
        </div>
      </PageHeader>

      <div className="p-4 sm:p-5 space-y-4">
        {can(P.MASTERS_VIEW) && <SetupWarning />}

        {kinds.length > 0 && (
          <section aria-label="Your work">
            <div className="flex items-baseline gap-2 mb-2">
              <h2 className="text-sm font-semibold text-slate-900">Your work</h2>
              <span className="text-xs text-slate-500">
                {tasksQuery.isLoading ? 'Loading…' : tasks.length ? `${tasks.length} waiting${urgent ? `, ${urgent} urgent` : ''}` : 'All clear'}
              </span>
            </div>
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
              {kinds.map((k) => (
                <KindTile key={k.key} k={k} c={counts[k.key]} active={kind === k.key} onClick={() => setKind(kind === k.key ? null : k.key)} />
              ))}
            </div>
          </section>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] items-start">
          <div className="min-w-0 space-y-4">
            {kinds.length > 0 && <MyTasks tasks={tasks} isLoading={tasksQuery.isLoading} error={tasksQuery.error} kind={kind} onClearKind={() => setKind(null)} />}
            <QualityPanel />
          </div>
          <aside className="space-y-4 min-w-0">
            <PlantStatus />
            <RecentlyDone />
          </aside>
        </div>
      </div>
    </div>
  );
}

/** One kind of work: how many wait, how many are urgent; click to show only these below. */
function KindTile({ k, c, active, onClick }) {
  const Icon = k.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-left rounded-xl border px-3 py-2.5 transition-colors cursor-pointer ${active ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/40'}`}
    >
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${active ? 'text-blue-100' : 'text-blue-700'}`} />
        <span className={`text-xs font-medium ${active ? 'text-blue-50' : 'text-slate-600'}`}>{k.label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`text-2xl font-semibold tabular leading-none ${active ? 'text-white' : c.total ? 'text-slate-900' : 'text-slate-300'}`}>{c.total}</span>
        {c.urgent > 0 && (
          <span className={`rounded-full px-1.5 py-px text-[11px] font-semibold ${active ? 'bg-white/20 text-white' : 'bg-rose-50 text-rose-700'}`}>{c.urgent} urgent</span>
        )}
      </div>
    </button>
  );
}

/** The user's own last steps, so they can pick up where they left off. */
function RecentlyDone() {
  const { data: recent } = useGetMyRecentQuery(undefined, { pollingInterval: 120_000 });
  if (!recent?.length) return null;
  return (
    <section className="card">
      <h2 className="section-title px-4 pt-3.5 pb-2">Recently done by you</h2>
      <ul className="border-t border-slate-100 divide-y divide-slate-100">
        {recent.map((r) => (
          <li key={r.id}>
            <Link to={r.link} className="group flex items-baseline gap-2 px-4 py-2 hover:bg-slate-50 transition-colors">
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-slate-800 truncate">{HISTORY_LABELS[r.action] ?? r.action}</span>
                <span className="block text-xs text-slate-500 truncate"><span className="font-mono">{r.docNo}</span> · {r.itemCode}</span>
              </span>
              <span className="text-[11px] text-slate-400 whitespace-nowrap">{formatRelative(r.at)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Shown only when something IMIRs depend on is missing (sampling table, numbering). */
function SetupWarning() {
  const { data: plans } = useGetSamplingPlansQuery();
  const { data: series } = useGetNumberSeriesQuery();
  if (!plans || !series) return null;
  const defaultPlan = plans.find((p) => p.isDefault);
  const activeTypes = new Set(series.filter((s) => s.isActive && !s.plantId).map((s) => s.docType));
  const problems = [
    !defaultPlan && { text: 'No default sampling plan is set', to: '/masters/sampling' },
    defaultPlan?.warnings.length > 0 && { text: `Sampling table: ${defaultPlan.warnings.join(' ')}`, to: '/masters/sampling' },
    ...['IMIR', 'DN', 'DEVIATION'].filter((t) => !activeTypes.has(t)).map((t) => ({ text: `No active ${t === 'DEVIATION' ? 'deviation' : t} number series`, to: '/masters/number-series' })),
  ].filter(Boolean);
  if (!problems.length) return null;
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
      <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
      <span className="text-sm font-medium text-amber-900">Setup needed before lots can be inspected:</span>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {problems.map((p) => (
          <li key={p.text}><Link to={p.to} className="inline-flex items-center gap-1 text-sm text-amber-900 underline decoration-amber-300 hover:decoration-amber-600">{p.text}<ArrowRight className="w-3 h-3" /></Link></li>
        ))}
      </ul>
    </div>
  );
}

function partOfDay() {
  const h = Number(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()));
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
