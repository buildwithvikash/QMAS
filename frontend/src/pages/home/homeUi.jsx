import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

/** A dashboard card: icon, title (with an optional note), an action on the right, then the body. */
export function HomeCard({ icon: Icon, title, note, action, children, className = '', bodyClass = 'px-4 pb-4', label }) {
  return (
    <section className={`card flex flex-col ${className}`} aria-label={label ?? title}>
      <div className="flex flex-wrap items-center gap-2.5 px-4 pt-4 pb-3">
        {Icon && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700"><Icon className="h-4 w-4" /></span>}
        <h2 className="text-[15px] font-semibold text-slate-900">{title}{note && <span className="ml-1 font-normal text-slate-500">{note}</span>}</h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className={`min-w-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  );
}

/** Segmented choice (7D / 30D / 90D). options: [[value, label]]. */
export function Seg({ value, onChange, options }) {
  return (
    <div role="group" className="inline-flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1 text-xs font-semibold cursor-pointer ${value === v ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white'}`}>{l}</button>
      ))}
    </div>
  );
}

const TONES = {
  blue: 'bg-blue-100 text-blue-600',
  violet: 'bg-violet-100 text-violet-600',
  orange: 'bg-orange-100 text-orange-600',
  rose: 'bg-rose-100 text-rose-600',
  green: 'bg-emerald-100 text-emerald-600',
  amber: 'bg-amber-100 text-amber-600',
};

/** One figure at the top of Home: icon, label, value, a note (coloured when it needs attention). */
export function StatTile({ to, icon: Icon, tone, label, value, note, noteTone = 'text-slate-500', valueClass = 'text-2xl' }) {
  return (
    <Link to={to} className="card group flex items-center gap-3 px-4 py-4 transition-colors hover:border-blue-300">
      <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-xl ${TONES[tone]}`}><Icon className="h-7 w-7" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-slate-600">{label}</span>
        <span className={`block font-bold leading-tight tabular text-slate-900 ${valueClass}`}>{value}</span>
        {note && <span className={`block truncate text-[11px] ${noteTone}`}>{note}</span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/** "View all" link or button in a card header. */
export const ViewAll = ({ to, onClick, children = 'View all' }) => (to
  ? <Link to={to} className="text-xs font-semibold text-blue-700 hover:underline">{children}</Link>
  : <button type="button" onClick={onClick} className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer">{children}</button>);

/** Light illustration for the welcome banner: a plant with a warehouse, trees and a truck. */
export function PlantIllustration({ className = '' }) {
  return (
    <svg viewBox="0 0 520 120" className={className} aria-hidden="true">
      <g fill="#dbeafe">
        <rect x="20" y="40" width="40" height="60" rx="2" />
        <rect x="64" y="22" width="22" height="78" rx="2" />
        <rect x="92" y="52" width="30" height="48" rx="2" />
        <rect x="150" y="60" width="14" height="40" />
        <path d="M150 60 l10 -24 l10 24 z" />
      </g>
      <g stroke="#bfdbfe" strokeWidth="2" fill="none">
        <path d="M180 100 V58 H230 V100 M180 72 H230 M180 86 H230 M196 58 V100 M212 58 V100" />
      </g>
      {/* warehouse */}
      <path d="M300 100 V54 L360 30 L420 54 V100 Z" fill="#60a5fa" />
      <path d="M300 54 L360 30 L420 54" fill="none" stroke="#2563eb" strokeWidth="3" />
      <rect x="318" y="62" width="84" height="38" fill="#dbeafe" />
      {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={322 + i * 16} y="66" width="12" height="30" fill="#93c5fd" />)}
      <rect x="370" y="18" width="16" height="22" fill="#2563eb" />
      {/* trees */}
      {[[268, 78, 16, '#4ade80'], [286, 84, 11, '#22c55e'], [440, 80, 15, '#4ade80'], [462, 86, 10, '#22c55e'], [480, 82, 13, '#86efac']].map(([x, y, r, c]) => (
        <g key={x}><rect x={x - 1.5} y={y} width="3" height={100 - y} fill="#a3a3a3" /><circle cx={x} cy={y} r={r} fill={c} /></g>
      ))}
      {/* truck */}
      <g transform="translate(232 82)">
        <rect width="34" height="16" rx="2" fill="#93c5fd" />
        <rect x="34" y="5" width="12" height="11" rx="2" fill="#3b82f6" />
        <circle cx="9" cy="18" r="3.5" fill="#334155" /><circle cx="38" cy="18" r="3.5" fill="#334155" />
      </g>
      <rect x="0" y="100" width="520" height="3" rx="1.5" fill="#bfdbfe" />
    </svg>
  );
}
