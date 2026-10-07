import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGetDashboardQuery } from '../../api/dnApi.js';
import { HomeCard, Seg } from './homeUi.jsx';
import { TrendingUp } from 'lucide-react';

const SERIES = [
  ['received', 'Received', 'var(--color-slate-300)'],
  ['ok', 'OK', '#0f7bd1'],
  ['nok', 'Not OK', '#e11d48'],
  ['pending', 'Not yet inspected', 'var(--color-slate-200)'],
];
const short = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const label = (day) => short.format(new Date(`${day}T00:00:00`));
const link = (rules) => `/imirs?filter=${encodeURIComponent(JSON.stringify({ mode: 'all', rules }))}`;

/** 90 days read better as weeks; 7 and 30 days stay daily. */
function buckets(days, size) {
  if (size === 1) return days.map((d) => ({ ...d, pending: Math.max(0, d.received - d.ok - d.nok), from: d.day, to: d.day }));
  const out = [];
  for (let i = 0; i < days.length; i += size) {
    const part = days.slice(i, i + size);
    const sum = (k) => part.reduce((a, d) => a + d[k], 0);
    out.push({ day: part[0].day, from: part[0].day, to: part.at(-1).day, received: sum('received'), ok: sum('ok'), nok: sum('nok'), pending: Math.max(0, sum('received') - sum('ok') - sum('nok')) });
  }
  return out;
}

/** Lots received per day (week, over 90 days) with OK, Not OK and not yet inspected; click a bar for its lots. */
export default function QualityTrend() {
  const [range, setRange] = useState(30);
  const { data: s } = useGetDashboardQuery({ trendDays: range }, { pollingInterval: 120_000 });
  const navigate = useNavigate();
  const [hover, setHover] = useState(null);
  const bars = s?.trend ? buckets(s.trend, range === 90 ? 7 : 1) : [];
  const max = Math.max(3, ...bars.map((b) => b.received));
  const top = Math.ceil(max / 3) * 3; // three even steps
  const H = 110;
  const n = bars.length || 1;
  const every = Math.ceil(n / 8);
  const shown = hover ?? bars.at(-1);
  return (
    <HomeCard icon={TrendingUp} title="Incoming Quality Trend" action={<Seg value={range} onChange={setRange} options={[[7, '7D'], [30, '30D'], [90, '90D']]} />}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        {SERIES.map(([k, l, c]) => <span key={k} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />{l}</span>)}
      </div>
      {shown && (
        <p className="mt-2 text-xs text-slate-500 min-h-4">
          <span className="font-semibold text-slate-800">{shown.from === shown.to ? label(shown.from) : `${label(shown.from)} – ${label(shown.to)}`}</span>
          {' · '}{shown.received} received · {shown.ok} OK · <span className={shown.nok ? 'text-rose-700 font-semibold' : ''}>{shown.nok} Not OK</span> · {shown.pending} not yet inspected
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <div className="flex flex-col justify-between text-right text-[10px] tabular text-slate-400" style={{ height: H }}>
          {[top, (top * 2) / 3, top / 3, 0].map((v) => <span key={v}>{v}</span>)}
        </div>
        <div className="relative min-w-0 flex-1">
          {[0, 1, 2, 3].map((i) => <div key={i} className="absolute inset-x-0 border-t border-dashed border-slate-100" style={{ top: (i * H) / 3 }} />)}
          <svg viewBox={`0 0 ${n * 10} ${H}`} preserveAspectRatio="none" className="relative w-full" style={{ height: H }} role="img"
            aria-label={`Lots received, last ${range} days`} onMouseLeave={() => setHover(null)}>
            {bars.map((b, i) => {
              const x = i * 10;
              const bw = range === 7 ? 2 : 2.8;
              const h = (v) => (v / top) * (H - 2);
              const cols = [b.received, b.ok, b.nok];
              const on = hover?.day === b.day;
              return (
                <g key={b.day} onMouseEnter={() => setHover(b)} className="cursor-pointer"
                  onClick={() => b.received && navigate(link(b.from === b.to ? [{ field: 'receivedAt', op: 'on', value: b.from }] : [{ field: 'receivedAt', op: 'between', value: [b.from, b.to] }]))}>
                  <rect x={x} y={0} width={10} height={H} fill={on ? 'rgb(0 103 184 / 0.06)' : 'transparent'} />
                  {cols.map((v, k) => v > 0 && (
                    <rect key={k} x={x + 5 - (bw * 3) / 2 + k * bw} y={H - h(v)} width={bw * 0.9} height={h(v)} rx={0.4} style={{ fill: SERIES[k][2] }} />
                  ))}
                  {b.received === 0 && <rect x={x + 3} y={H - 1} width={4} height={1} style={{ fill: 'var(--color-slate-200)' }} />}
                </g>
              );
            })}
          </svg>
          <div className="mt-1 flex text-[10px] text-slate-400">
            {bars.map((b, i) => <span key={b.day} className="flex-1 text-center">{i % every === 0 ? label(b.day) : ''}</span>)}
          </div>
        </div>
      </div>
    </HomeCard>
  );
}
