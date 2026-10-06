import { PERMISSIONS } from '@qmas/shared';
import { AlertTriangle, ArrowRight, Building2, CalendarDays, ChevronRight, ClipboardCheck, FileWarning, FileX2, Globe, Package, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useGetDashboardQuery } from '../api/dnApi.js';
import { useGetNumberSeriesQuery, useGetSamplingPlansQuery } from '../api/mastersApi.js';
import { useGetNetworkStatusQuery } from '../api/networkApi.js';
import { useGetMyTasksQuery } from '../api/workflowApi.js';
import { useAccess } from '../hooks/useAccess.js';
import { PlantIllustration, StatTile } from './home/homeUi.jsx';
import LotsTabs from './home/LotsTabs.jsx';
import { PlantGlance, VendorNokRate } from './home/QualityCards.jsx';
import QualityTrend from './home/QualityTrend.jsx';
import { ActiveTasks, RecentlyDone } from './home/TaskCards.jsx';

const P = PERMISSIONS;

/**
 * Home: a welcome with today's date, the plant's open work as five figures (and where the user is
 * connecting from), incoming quality (trend, vendors, the period at a glance), the user's own
 * tasks and last steps, then the lots and records lists. Configuration problems show only when
 * something is missing.
 */
export default function Home() {
  const { user, can } = useAccess();
  const tasksQuery = useGetMyTasksQuery(undefined, { pollingInterval: 60_000, refetchOnFocus: true });
  const tasks = tasksQuery.data ?? [];
  const now = new Date();
  const weekday = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long' }).format(now);
  const date = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' }).format(now);

  return (
    <div className="p-4 sm:p-5 space-y-4">
      <section className="relative overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-sky-50 to-blue-100/70 px-5 py-5 sm:px-6" aria-label="Welcome">
        <PlantIllustration className="pointer-events-none absolute bottom-0 right-72 hidden h-28 opacity-90 lg:block" />
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-600 to-blue-800 text-white shadow-lg shadow-blue-600/20">
            <Building2 className="h-8 w-8" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-slate-900">Good {partOfDay()}, {user.fullName.split(' ')[0]} <span aria-hidden="true">👋</span></h1>
            <p className="mt-0.5 text-sm text-slate-600">Here&apos;s what&apos;s happening with incoming quality today.</p>
          </div>
          <Link to="/reports" className="group flex items-center gap-3 rounded-xl border border-white/80 bg-white/90 px-4 py-3 shadow-sm backdrop-blur hover:border-blue-200">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-blue-50 text-blue-700"><CalendarDays className="h-5 w-5" /></span>
            <span><span className="block text-xs text-slate-500">{weekday}</span><span className="block text-base font-bold text-slate-900">{date}</span></span>
            <ChevronRight className="ml-2 h-4 w-4 text-slate-400 group-hover:text-blue-700" />
          </Link>
        </div>
      </section>

      {can(P.MASTERS_VIEW) && <SetupWarning />}
      <Figures />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <QualityTrend />
        <VendorNokRate />
        <PlantGlance />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start">
        <ActiveTasks tasks={tasks} isLoading={tasksQuery.isLoading} error={tasksQuery.error} />
        <RecentlyDone />
      </div>

      <LotsTabs />
    </div>
  );
}

/** The plant's open work, and where the user is connecting from. */
function Figures() {
  const { can } = useAccess();
  const { data: s } = useGetDashboardQuery({}, { pollingInterval: 120_000 });
  const { data: net } = useGetNetworkStatusQuery(undefined, { pollingInterval: 5 * 60_000 });
  const st = s?.imirByStatus ?? {};
  const n = (...keys) => keys.reduce((a, k) => a + (st[k] ?? 0), 0);
  const external = net?.network === 'EXTERNAL';
  const until = net?.externalAccess && new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(net.externalAccess.endsAt));
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
      <StatTile to="/imirs" icon={Package} tone="blue" label="To Inspect" value={s ? n('OPEN', 'IN_INSPECTION') : '–'}
        note={st.AWAITING_FORMAT ? `${st.AWAITING_FORMAT} waiting for format` : 'Lots open or in inspection'} noteTone={st.AWAITING_FORMAT ? 'text-amber-700 font-medium' : undefined} />
      <StatTile to="/imirs" icon={ClipboardCheck} tone="violet" label="In Review" value={s ? n('SUBMITTED', 'WITH_IQC_HEAD') : '–'}
        note={`${st.SUBMITTED ?? 0} incharge / ${st.WITH_IQC_HEAD ?? 0} IQC Head`} />
      <StatTile to="/deviations" icon={FileWarning} tone="orange" label="Open Deviations" value={s ? s.openDeviations : '–'}
        note={s?.deviationsByStage.SENIOR ? `${s.deviationsByStage.SENIOR} with senior authorities` : 'Deviations in progress'} noteTone={s?.deviationsByStage.SENIOR ? 'text-orange-700 font-medium' : undefined} />
      <StatTile to="/dns" icon={FileX2} tone="rose" label="Open DNs" value={s ? s.dn.open + s.dn.capaSubmitted : '–'}
        note={s?.dn.capaOverdue ? `${s.dn.capaOverdue} CAPA overdue` : s?.dn.capaSubmitted ? `${s.dn.capaSubmitted} CAPA to review` : 'Defect notifications'} noteTone={s?.dn.capaOverdue ? 'text-rose-700 font-medium' : undefined} />
      <StatTile to={can(P.NETWORK_MANAGE) ? '/admin/network' : '/help'} icon={external ? Globe : ShieldCheck} tone={external ? 'rose' : 'green'}
        label={external ? 'External Access' : 'Network'} valueClass="text-sm"
        value={!net ? '–' : external ? <span className="text-rose-700">{until ? `Active – until ${until}` : 'Outside the company network'}</span> : <span className="text-emerald-700">Company network</span>}
        note={net?.ip ? `Your address ${net.ip}` : null} />
    </div>
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
