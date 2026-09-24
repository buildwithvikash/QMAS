import { PERMISSIONS } from '@qmas/shared';
import { AlertTriangle, CheckCircle2, LayoutDashboard } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useGetNumberSeriesQuery, useGetSamplingPlansQuery } from '../api/mastersApi.js';
import PageHeader from '../components/ui/PageHeader.jsx';
import { useAccess } from '../hooks/useAccess.js';
import PlantStatus from './PlantStatus.jsx';
import MyTasks from './MyTasks.jsx';

/**
 * Home: the user's work queue first, the plant's open work beside it, and — for people who
 * maintain masters — whether the configuration the inspection flow depends on is complete.
 * Pages are reached from the menu or Ctrl+K, so Home does not repeat them.
 */
export default function Home() {
  const { user, can } = useAccess();
  const canSeeSetup = can(PERMISSIONS.MASTERS_VIEW);
  const roles = user.roles.length
    ? user.roles.map((r) => `${r.roleName}${r.plantSapCode ? ` (${r.plantSapCode})` : ''}`).join(', ')
    : 'No role yet: ask the administrator to assign one';
  const today = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  return (
    <div>
      <PageHeader icon={LayoutDashboard} title={`Good ${partOfDay()}, ${user.fullName.split(' ')[0]}`} subtitle={`${today}. ${roles}`} />
      <div className="p-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] items-start">
        <MyTasks />
        <aside className="space-y-5">
          <PlantStatus />
          {canSeeSetup && <SetupStatus />}
        </aside>
      </div>
    </div>
  );
}

function SetupStatus() {
  const { data: plans } = useGetSamplingPlansQuery();
  const { data: series } = useGetNumberSeriesQuery();
  const defaultPlan = plans?.find((p) => p.isDefault);
  const activeTypes = new Set(series?.filter((s) => s.isActive && !s.plantId).map((s) => s.docType));

  const checks = [
    {
      ok: !!defaultPlan && defaultPlan.warnings.length === 0,
      label: 'Sampling table',
      detail: !defaultPlan ? 'No default plan is set.' : defaultPlan.warnings.join(' ') || `${defaultPlan.rows.length} lot ranges in "${defaultPlan.name}".`,
      to: '/masters/sampling',
    },
    ...['IMIR', 'DN', 'DEVIATION'].map((t) => ({
      ok: activeTypes.has(t),
      label: `${t === 'DEVIATION' ? 'Deviation' : t} numbering`,
      detail: activeTypes.has(t) ? series.find((s) => s.isActive && !s.plantId && s.docType === t).pattern : 'No active default series.',
      mono: activeTypes.has(t),
      to: '/masters/number-series',
    })),
  ];

  return (
    <aside className="card p-5 h-fit">
      <h2 className="text-sm font-bold text-slate-800">Configuration status</h2>
      <p className="text-xs text-slate-400 mb-3">Needed before IMIRs can be opened.</p>
      <ul className="space-y-3">
        {checks.map((c) => (
          <li key={c.label} className="flex gap-2.5">
            {c.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-500 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-500 shrink-0" />}
            <div className="min-w-0">
              <Link to={c.to} className="text-sm font-semibold text-slate-700 hover:text-blue-700">{c.label}</Link>
              <p className={`text-xs text-slate-500 break-words ${c.mono ? 'font-mono' : ''}`}>{c.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function partOfDay() {
  const h = Number(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()));
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
