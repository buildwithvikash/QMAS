import { useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Two small charts in the app's palette, drawn with plain HTML/SVG (no chart library):
 *   BarList      ranked horizontal bars (vendors by Not-OK %, stages by hours); rows can link.
 *   DailyColumns stacked OK / Not-OK columns per day, with a hover read-out; days can be clicked.
 */

export function BarList({ rows, max, format = (v) => v, tone = 'blue', empty = 'Nothing to show for this period.' }) {
  if (!rows.length) return <p className="text-sm text-slate-500 py-4">{empty}</p>;
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  const fill = { blue: 'bg-blue-500', rose: 'bg-rose-500', amber: 'bg-amber-500' }[tone];
  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-slate-800">{r.label}</span>
              <span className="tabular font-semibold text-slate-900 shrink-0">{format(r.value)}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className={`h-full rounded-full ${r.tone ? { rose: 'bg-rose-500', amber: 'bg-amber-500', blue: 'bg-blue-500' }[r.tone] : fill}`} style={{ width: `${Math.max(2, (r.value / top) * 100)}%` }} />
            </div>
            {r.note && <div className="mt-0.5 text-xs text-slate-500">{r.note}</div>}
          </>
        );
        return (
          <li key={r.key ?? r.label}>
            {r.to ? <Link to={r.to} className="block rounded-md -mx-1.5 px-1.5 py-1 hover:bg-slate-50">{body}</Link> : <div className="py-1">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

const dayLabel = (d) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

export function DailyColumns({ days, height = 120, onDayClick }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...days.map((d) => d.received));
  const w = 100 / days.length;
  const shown = hover ?? days.at(-1);
  return (
    <div>
      <div className="flex items-baseline gap-4 text-xs text-slate-600 mb-2 min-h-5">
        {shown && (
          <>
            <span className="font-semibold text-slate-900">{dayLabel(shown.day)}</span>
            <span>{shown.received} received</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500" />{shown.ok} OK</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-rose-500" />{shown.nok} Not OK</span>
          </>
        )}
      </div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label="Lots received per day, last 30 days" onMouseLeave={() => setHover(null)}>
        {days.map((d, i) => {
          const x = i * w + w * 0.15;
          const bw = w * 0.7;
          const total = (d.received / max) * (height - 4);
          const nokH = (d.nok / max) * (height - 4);
          const okH = (d.ok / max) * (height - 4);
          const restH = Math.max(0, total - nokH - okH);
          const on = hover?.day === d.day;
          const bar = (
            <g key={d.day} onMouseEnter={() => setHover(d)} onClick={onDayClick ? () => onDayClick(d) : undefined} className={onDayClick ? 'cursor-pointer' : ''}>
              <rect x={i * w} y={0} width={w} height={height} fill={on ? 'rgb(0 103 184 / 0.06)' : 'transparent'} />
              {restH > 0 && <rect x={x} y={height - total} width={bw} height={restH} rx={0.6} fill="#cbd5e1" />}
              {okH > 0 && <rect x={x} y={height - okH - nokH} width={bw} height={okH} rx={0.6} fill="#0f7bd1" />}
              {nokH > 0 && <rect x={x} y={height - nokH} width={bw} height={nokH} rx={0.6} fill="#e11d48" />}
              {d.received === 0 && <rect x={x} y={height - 1} width={bw} height={1} fill="#e2e8f0" />}
            </g>
          );
          return bar;
        })}
      </svg>
      <div className="flex justify-between text-[11px] text-slate-400 mt-1">
        <span>{days[0] && dayLabel(days[0].day)}</span>
        <span>Grey: not yet inspected</span>
        <span>{days.at(-1) && dayLabel(days.at(-1).day)}</span>
      </div>
    </div>
  );
}
