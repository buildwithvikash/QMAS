import { Link } from 'react-router-dom';
import { formatDateTime } from '../utils/format.js';
import { useGetDashboardQuery } from '../api/dnApi.js';

/**
 * Open work in the user's plants as four figures (to inspect, in review, open deviations, open
 * DNs), each opening its list; then how long open lots have waited, CAPA falling due and 30 days' intake.
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
    { label: 'To inspect', value: n('OPEN', 'IN_INSPECTION'), note: st.AWAITING_FORMAT ? `+${st.AWAITING_FORMAT} waiting for a format` : null, warn: !!st.AWAITING_FORMAT, to: '/imirs' },
    { label: 'In review', value: n('SUBMITTED', 'WITH_IQC_HEAD'), note: `${st.SUBMITTED ?? 0} Incharge · ${st.WITH_IQC_HEAD ?? 0} IQC Head`, to: '/imirs' },
    { label: 'Open deviations', value: s.openDeviations, note: s.deviationsByStage.SENIOR ? `${s.deviationsByStage.SENIOR} with senior authorities` : null, to: '/deviations' },
    { label: 'Open DNs', value: s.dn.open + s.dn.capaSubmitted, note: s.dn.capaOverdue ? `${s.dn.capaOverdue} CAPA overdue` : s.dn.capaSubmitted ? `${s.dn.capaSubmitted} CAPA to review` : null, warn: s.dn.capaOverdue > 0, to: '/dns' },
  ];
  return (
    <section className="card">
      <h2 className="section-title px-4 pt-3.5 pb-2">Plant at a glance</h2>
      <div className="grid grid-cols-2 border-t border-slate-100">
        {lines.map((x, i) => (
          <Link key={x.label} to={x.to} className={`px-4 py-3 hover:bg-slate-50 transition-colors ${i % 2 ? 'border-l border-slate-100' : ''} ${i > 1 ? 'border-t border-slate-100' : ''}`}>
            <span className="block text-xs text-slate-500">{x.label}</span>
            <span className={`block text-2xl font-semibold tabular leading-tight ${x.value ? 'text-slate-900' : 'text-slate-300'}`}>{x.value.toLocaleString('en-IN')}</span>
            {x.note && <span className={`block text-[11px] leading-snug ${x.warn ? 'text-amber-700 font-medium' : 'text-slate-500'}`}>{x.note}</span>}
          </Link>
        ))}
      </div>
      <Ageing ageing={s.ageing} />
      {s.capaDue.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-3">
          <h3 className="text-xs text-slate-500 mb-1.5">CAPA falling due</h3>
          <ul className="space-y-1">
            {s.capaDue.map((d) => {
              const late = new Date(d.capaDueAt) < new Date();
              return (
                <li key={d.id}>
                  <Link to={`/dns/${d.id}`} className="flex items-baseline justify-between gap-2 text-sm hover:text-blue-700">
                    <span className="truncate text-slate-700">{d.vendorName}</span>
                    <span className={`text-xs whitespace-nowrap ${late ? 'text-rose-700 font-semibold' : 'text-slate-500'}`}>{late ? 'overdue' : formatDateTime(d.capaDueAt)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <Link to="/reports" className="block border-t border-slate-100 px-4 py-3 hover:bg-slate-50 transition-colors">
        <span className="block text-xs text-slate-500">Last 30 days</span>
        <span className="text-sm text-slate-700">
          {l.received.toLocaleString('en-IN')} lots received{nokPct !== null && <>, <span className={nokPct > 0 ? 'font-semibold text-rose-700' : ''}>{nokPct} % not OK</span></>}{l.rejected ? `, ${l.rejected} rejected` : ''}
        </span>
      </Link>
    </section>
  );
}

/** Open lots by days since their last step, as one stacked bar (fresh → stale). */
function Ageing({ ageing }) {
  const t = ageing.reduce((a, r) => ({ d0: a.d0 + r.d0, d1: a.d1 + r.d1, d3: a.d3 + r.d3, d7: a.d7 + r.d7 }), { d0: 0, d1: 0, d3: 0, d7: 0 });
  const total = t.d0 + t.d1 + t.d3 + t.d7;
  if (!total) return null;
  const parts = [
    ['d0', 'under a day', 'bg-blue-500'], ['d1', '1-3 days', 'bg-blue-300'], ['d3', '3-7 days', 'bg-amber-500'], ['d7', 'over a week', 'bg-rose-500'],
  ];
  return (
    <div className="border-t border-slate-100 px-4 py-3">
      <h3 className="text-xs text-slate-500 mb-2">Open lots by days since their last step</h3>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-100">
        {parts.map(([k, , c]) => t[k] > 0 && <span key={k} className={c} style={{ width: `${(t[k] / total) * 100}%` }} />)}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-slate-600">
        {parts.map(([k, label, c]) => (
          <li key={k} className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-sm ${c}`} />{label}<span className="ml-auto tabular font-semibold text-slate-800">{t[k]}</span></li>
        ))}
      </ul>
    </div>
  );
}
