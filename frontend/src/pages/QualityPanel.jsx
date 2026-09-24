import { useNavigate } from 'react-router-dom';
import { useGetDashboardQuery } from '../api/dnApi.js';
import { BarList, DailyColumns } from '../components/ui/Charts.jsx';

const link = (rules) => `/imirs?filter=${encodeURIComponent(JSON.stringify({ mode: 'all', rules }))}`;

/**
 * Quality in the user's plants: lots received per day with their result (click a day for its
 * lots), and the vendors with the highest Not-OK rate in 90 days (click for their Not-OK lots).
 */
export default function QualityPanel() {
  const { data: s } = useGetDashboardQuery(undefined, { pollingInterval: 120_000 });
  const navigate = useNavigate();
  if (!s?.trend) return null;
  const vendors = s.worstVendors.map((v) => ({
    key: v.vendorCode,
    label: v.name,
    value: v.nokPct,
    note: `${v.nok} of ${v.inspected} lots not OK`,
    tone: v.nokPct >= 20 ? 'rose' : 'amber',
    to: link([{ field: 'vendorCode', op: 'equals', value: v.vendorCode }, { field: 'result', op: 'in', value: ['NOK'] }]),
  }));
  return (
    <section className="card">
      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        <h2 className="text-base font-semibold text-slate-900">Incoming quality</h2>
      </div>
      <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div>
          <h3 className="text-sm font-medium text-slate-700 mb-2">Lots received, last 30 days</h3>
          <DailyColumns days={s.trend} onDayClick={(d) => d.received && navigate(link([{ field: 'receivedAt', op: 'on', value: d.day }]))} />
        </div>
        <div>
          <h3 className="text-sm font-medium text-slate-700 mb-2">Highest Not OK rate, 90 days</h3>
          <BarList rows={vendors} max={100} format={(v) => `${v.toFixed(1)} %`} empty="No vendor has a Not OK lot in 90 days." />
        </div>
      </div>
    </section>
  );
}
