import { PERMISSIONS } from '@qmas/shared';
import { AlertTriangle, ArrowRight, CheckCircle2, LayoutDashboard } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useGetNumberSeriesQuery, useGetSamplingPlansQuery } from '../api/mastersApi.js';
import PageHeader from '../components/ui/PageHeader.jsx';
import { useAccess } from '../hooks/useAccess.js';
import MyTasks from './MyTasks.jsx';

/**
 * Dashboard: what is waiting for you, who you are, where you can go, and — for people who
 * maintain masters — whether the configuration the inspection flow depends on is complete.
 */
export default function Home() {
  const { user, can, menu } = useAccess();
  const canSeeSetup = can(PERMISSIONS.MASTERS_VIEW);

  return (
    <div>
      <PageHeader icon={LayoutDashboard} title={`Good ${partOfDay()}, ${user.fullName.split(' ')[0]}`} subtitle="QMAS · Incoming Material Inspection & Defect Notification" />
      <div className="p-5 grid gap-5 lg:grid-cols-3">
        <section className="lg:col-span-2 space-y-5">
          <MyTasks />
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-bold text-slate-800 mb-3">Your access</h2>
            {user.roles.length === 0 ? (
              <p className="text-sm text-slate-500">You have no role yet. Ask the administrator to assign one.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {user.roles.map((r) => (
                  <li key={`${r.roleCode}-${r.plantId}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm">
                    <span className="font-semibold text-slate-700">{r.roleName}</span>
                    <span className="text-slate-400"> · {r.plantName ? `${r.plantName} (${r.plantSapCode})` : 'All plants'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-bold text-slate-800 mb-3">Go to</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {menu.flatMap((s) => s.items).filter((i) => i.path !== '/').map((i) => (
                <Link key={i.path} to={i.path} className="group flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700 hover:border-blue-300 hover:bg-blue-50/50">
                  {i.label}
                  <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500" />
                </Link>
              ))}
            </div>
          </div>
        </section>

        {canSeeSetup && <SetupStatus />}
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
    <aside className="rounded-xl border border-slate-200 bg-white p-5 h-fit">
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
