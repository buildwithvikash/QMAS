import { useState } from 'react';

/**
 * Report charts in the app's palette, plain SVG (no chart library):
 *   Donut    parts of a whole with a legend (value and share); the centre shows the total.
 *   Columns  stacked columns over categories or days, with a hover read-out.
 * Colours are hex so they work inside SVG; take them from utils/palette.js.
 */

const fmtN = (v) => Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 });

export function Donut({ segments, size = 148, thickness = 22, center, centerLabel = 'Total', empty = 'No data in this period.' }) {
  const [hover, setHover] = useState(null);
  const parts = segments.filter((s) => s.value > 0);
  const total = parts.reduce((a, s) => a + s.value, 0);
  if (!total) return <p className="py-8 text-center text-sm text-slate-400">{empty}</p>;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const shown = hover ? parts.find((p) => p.label === hover) : null;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="shrink-0" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={thickness} />
        {parts.map((p) => {
          const len = (p.value / total) * c;
          const el = (
            <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={hover === p.label ? thickness + 4 : thickness}
              strokeDasharray={`${Math.max(len - 1.5, 0.5)} ${c}`} strokeDashoffset={-offset} className="transition-all cursor-pointer"
              onMouseEnter={() => setHover(p.label)} onMouseLeave={() => setHover(null)} />
          );
          offset += len;
          return el;
        })}
        </g>
        <g>
          <text x="50%" y="46%" textAnchor="middle" className="fill-slate-900 text-[22px] font-bold">{shown ? fmtN(shown.value) : center ?? fmtN(total)}</text>
          <text x="50%" y="60%" textAnchor="middle" className="fill-slate-500 text-[10px]">{shown ? `${Math.round((shown.value / total) * 100)}%` : centerLabel}</text>
        </g>
      </svg>
      <ul className="min-w-48 flex-1 space-y-1.5 text-sm">
        {parts.map((p) => (
          <li key={p.label} onMouseEnter={() => setHover(p.label)} onMouseLeave={() => setHover(null)}
            className={`flex items-center gap-2 rounded-md px-1.5 py-0.5 ${hover === p.label ? 'bg-slate-50' : ''}`}>
            <span className="w-2.5 h-2.5 shrink-0 rounded-sm" style={{ background: p.color }} />
            <span className="min-w-0 flex-1 leading-tight text-slate-700">{p.label}</span>
            <span className="tabular font-semibold text-slate-900">{fmtN(p.value)}</span>
            <span className="w-10 text-right tabular text-xs text-slate-500">{Math.round((p.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** data: [{ key, label, values: { [seriesKey]: n } }], series: [{ key, label, color }]. */
export function Columns({ data, series, height = 170, format = fmtN, empty = 'No data in this period.' }) {
  const [hover, setHover] = useState(null);
  const totals = data.map((d) => series.reduce((a, s) => a + (d.values[s.key] ?? 0), 0));
  if (!totals.some(Boolean)) return <p className="py-8 text-center text-sm text-slate-400">{empty}</p>;
  // A round top for the y-axis (1, 2, 5 × 10ⁿ steps) and five gridlines.
  const raw = Math.max(1, ...totals);
  const step = [1, 2, 5, 10].map((m) => m * 10 ** Math.floor(Math.log10(raw / 5 || 1))).find((st) => st * 5 >= raw) ?? raw / 5;
  const top = Math.max(step * 5, 1);
  const ticks = [0, 1, 2, 3, 4, 5].map((i) => Math.round(i * step * 100) / 100);
  const shown = hover !== null ? data[hover] : null;
  const every = Math.ceil(data.length / 8);
  const w = 100 / data.length;
  const bw = Math.min(w * 0.64, 9); // columns stay slim when there are few of them
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2 text-xs text-slate-600 min-h-5">
        {shown ? (
          <>
            <span className="font-semibold text-slate-900">{shown.label}</span>
            {series.map((s) => <span key={s.key} className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} />{s.label} {format(shown.values[s.key] ?? 0)}</span>)}
          </>
        ) : series.map((s) => <span key={s.key} className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} />{s.label}</span>)}
      </div>
      <div className="flex gap-1.5">
        <div className="relative w-6 shrink-0 text-[10px] text-slate-400 tabular" style={{ height }}>
          {ticks.map((t) => <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - (t / top) * 100}%` }}>{format(t)}</span>)}
        </div>
        <div className="min-w-0 flex-1">
          <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full block" style={{ height }} onMouseLeave={() => setHover(null)} role="img" aria-label="Column chart">
            {ticks.map((t) => <line key={t} x1="0" x2="100" y1={height - (t / top) * height} y2={height - (t / top) * height} stroke={t ? '#f1f5f9' : '#cbd5e1'} strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
            {data.map((d, i) => {
              let y = height;
              return (
                <g key={d.key} onMouseEnter={() => setHover(i)}>
                  <rect x={i * w} y="0" width={w} height={height} fill={hover === i ? 'rgb(37 99 235 / 0.06)' : 'transparent'} />
                  {series.map((s) => {
                    const h = ((d.values[s.key] ?? 0) / top) * height;
                    y -= h;
                    return h > 0 ? <rect key={s.key} x={i * w + (w - bw) / 2} y={y} width={bw} height={h} fill={s.color} /> : null;
                  })}
                </g>
              );
            })}
          </svg>
          <div className="mt-1 flex text-[10px] text-slate-500">
            {data.map((d, i) => <span key={d.key} className="flex-1 text-center truncate">{i % every === 0 ? d.label : ''}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Ranked bars with the count and its share of the total ("Top vendors by lots"). rows: [{ key, label, value, to? }]. */
export function RankBars({ rows, total, color = '#3b82f6', empty = 'Nothing to show for this period.' }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-slate-400">{empty}</p>;
  const sum = total ?? rows.reduce((a, r) => a + r.value, 0);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_2rem_2.75rem] items-center gap-3 text-sm">
          <span className="truncate text-slate-700" title={r.label}>{r.label}</span>
          <span className="h-3 rounded-sm bg-slate-100 overflow-hidden"><span className="block h-full rounded-sm" style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? color }} /></span>
          <span className="text-right font-semibold text-slate-900 tabular">{r.value.toLocaleString('en-IN')}</span>
          <span className="text-right text-xs text-slate-500 tabular">{sum ? Math.round((r.value / sum) * 100) : 0}%</span>
        </li>
      ))}
    </ul>
  );
}
