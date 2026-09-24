import { Link } from 'react-router-dom';
import { useGetDashboardQuery } from '../api/dnApi.js';

/** KPI tiles for Home: open work by stage and the last 30 days' lot outcomes, within the user's plants. */
export default function DashboardTiles() {
  const { data: s } = useGetDashboardQuery(undefined, { pollingInterval: 120_000 });
  if (!s) return null;
  const st = s.imirByStatus;
  const n = (...keys) => keys.reduce((a, k) => a + (st[k] ?? 0), 0);
  const l = s.lots30Days;
  const nokPct = l.ok + l.nok ? Math.round((1000 * l.nok) / (l.ok + l.nok)) / 10 : null;
  const tiles = [
    { label: 'To inspect', value: n('OPEN', 'IN_INSPECTION'), sub: `${st.AWAITING_FORMAT ?? 0} waiting for a format`, to: '/imirs', tone: 'blue' },
    { label: 'In review', value: n('SUBMITTED', 'WITH_IQC_HEAD'), sub: `${st.SUBMITTED ?? 0} with Incharge · ${st.WITH_IQC_HEAD ?? 0} with IQC Head`, to: '/imirs', tone: 'slate' },
    { label: 'Open deviations', value: s.openDeviations, sub: `${s.deviationsByStage.SENIOR ?? 0} escalated · ${(s.deviationsByStage.UNDER_DEVIATION ?? 0) + (s.deviationsByStage.QTY_VERIFICATION ?? 0)} on quantities`, to: '/deviations', tone: 'amber' },
    { label: 'Open DNs', value: s.dn.open + s.dn.capaSubmitted, sub: `${s.dn.capaOverdue} CAPA overdue · ${s.dn.capaSubmitted} to review`, to: '/dns', tone: s.dn.capaOverdue ? 'rose' : 'slate' },
    { label: 'Lots · 30 days', value: l.received, sub: nokPct === null ? 'none inspected yet' : `${nokPct} % not OK · ${l.rejected} rejected`, to: '/reports', tone: 'emerald' },
  ];
  const tones = { blue: 'text-blue-700', slate: 'text-slate-800', amber: 'text-amber-700', rose: 'text-rose-700', emerald: 'text-emerald-700' };
  return (
    <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
      {tiles.map((t) => (
        <Link key={t.label} to={t.to} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm transition">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">{t.label}</div>
          <div className={`text-2xl font-bold mt-1 ${tones[t.tone]}`}>{t.value.toLocaleString('en-IN')}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{t.sub}</div>
        </Link>
      ))}
    </div>
  );
}
