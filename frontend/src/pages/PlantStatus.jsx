import { Link } from 'react-router-dom';
import { useGetDashboardQuery } from '../api/dnApi.js';

/**
 * Open work in the user's plants, as a short list: each line says what is waiting, how many, and
 * opens the list behind it. Lines that need attention are marked, not the whole panel.
 */
export default function PlantStatus() {
  const { data: s, isLoading } = useGetDashboardQuery(undefined, { pollingInterval: 120_000 });
  if (isLoading) return <section className="card p-4 space-y-3"><div className="skeleton h-4 w-1/2" />{[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-8" />)}</section>;
  if (!s) return null;
  const st = s.imirByStatus;
  const n = (...keys) => keys.reduce((a, k) => a + (st[k] ?? 0), 0);
  const l = s.lots30Days;
  const nokPct = l.ok + l.nok ? Math.round((1000 * l.nok) / (l.ok + l.nok)) / 10 : null;
  const lines = [
    { label: 'To inspect', value: n('OPEN', 'IN_INSPECTION'), note: st.AWAITING_FORMAT ? `${st.AWAITING_FORMAT} more waiting for a format` : null, warn: !!st.AWAITING_FORMAT, to: '/imirs' },
    { label: 'In review', value: n('SUBMITTED', 'WITH_IQC_HEAD'), note: `${st.SUBMITTED ?? 0} with Incharge, ${st.WITH_IQC_HEAD ?? 0} with IQC Head`, to: '/imirs' },
    { label: 'Open deviations', value: s.openDeviations, note: s.deviationsByStage.SENIOR ? `${s.deviationsByStage.SENIOR} with senior authorities` : null, to: '/deviations' },
    { label: 'Open DNs', value: s.dn.open + s.dn.capaSubmitted, note: s.dn.capaOverdue ? `${s.dn.capaOverdue} CAPA overdue` : s.dn.capaSubmitted ? `${s.dn.capaSubmitted} CAPA to review` : null, warn: s.dn.capaOverdue > 0, to: '/dns' },
  ];
  return (
    <section className="card">
      <h2 className="section-title px-4 pt-3.5 pb-2">Open work</h2>
      <ul className="divide-y divide-slate-100">
        {lines.map((x) => (
          <li key={x.label}>
            <Link to={x.to} className="flex items-baseline gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors">
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-slate-700">{x.label}</span>
                {x.note && <span className={`block text-xs ${x.warn ? 'text-amber-700' : 'text-slate-500'}`}>{x.note}</span>}
              </span>
              <span className={`text-xl font-semibold tabular ${x.value ? 'text-slate-900' : 'text-slate-300'}`}>{x.value.toLocaleString('en-IN')}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/reports" className="block border-t border-slate-100 px-4 py-3 hover:bg-slate-50 transition-colors">
        <span className="block text-xs text-slate-500">Last 30 days</span>
        <span className="text-sm text-slate-700">
          {l.received.toLocaleString('en-IN')} lots received{nokPct !== null && <>, <span className={nokPct > 0 ? 'font-semibold text-rose-700' : ''}>{nokPct} % not OK</span></>}{l.rejected ? `, ${l.rejected} rejected` : ''}
        </span>
      </Link>
    </section>
  );
}
