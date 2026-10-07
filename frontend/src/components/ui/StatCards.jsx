import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

const TONES = {
  blue: { tile: 'bg-blue-50 text-blue-600', bar: 'bg-blue-600', ring: 'ring-blue-500', card: 'bg-white' },
  amber: { tile: 'bg-amber-100 text-amber-600', bar: 'bg-amber-500', ring: 'ring-amber-500', card: 'bg-amber-50/40' },
  sky: { tile: 'bg-sky-100 text-sky-700', bar: 'bg-sky-600', ring: 'ring-sky-500', card: 'bg-sky-50/40' },
  violet: { tile: 'bg-violet-100 text-violet-600', bar: 'bg-violet-500', ring: 'ring-violet-500', card: 'bg-violet-50/40' },
  green: { tile: 'bg-emerald-100 text-emerald-600', bar: 'bg-emerald-500', ring: 'ring-emerald-500', card: 'bg-emerald-50/40' },
  rose: { tile: 'bg-rose-100 text-rose-600', bar: 'bg-rose-500', ring: 'ring-rose-500', card: 'bg-rose-50/40' },
  slate: { tile: 'bg-slate-100 text-slate-600', bar: 'bg-slate-500', ring: 'ring-slate-400', card: 'bg-white' },
};

/**
 * Figures above a list: each card has an icon, a count, its share of the total with a bar, and
 * filters the list when clicked. cards: [{ key, label, value, icon, tone, active, onClick, total?,
 * trend? (percent change, shown on the total card), note? }]
 */
export default function StatCards({ cards, total }) {
  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))]">
      {cards.map((c) => {
        const t = TONES[c.tone] ?? TONES.blue;
        const Icon = c.icon;
        const share = !c.isTotal && total ? Math.round(((c.value ?? 0) / total) * 100) : null;
        return (
          <button
            key={c.key}
            type="button"
            onClick={c.onClick}
            aria-pressed={!!c.active}
            className={`group text-left rounded-xl border px-4 py-3 transition-all cursor-pointer hover:shadow-md hover:-translate-y-px ${t.card} ${c.active ? `border-transparent ring-2 ${t.ring}` : 'border-slate-200'}`}
          >
            <div className="flex items-start gap-3">
              <span className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center ${t.tile}`}><Icon className="w-5 h-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-slate-600 truncate">{c.label}</p>
                <p className="text-2xl font-bold tabular text-slate-900 leading-tight">{c.value ?? '—'}</p>
              </div>
            </div>
            {c.isTotal ? (
              <p className="mt-2 text-[11px] text-slate-500 min-h-4">
                {c.trend !== null && c.trend !== undefined ? (
                  <span className={`inline-flex items-center gap-0.5 font-semibold ${c.trend >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {c.trend >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}{Math.abs(c.trend)} %
                  </span>
                ) : null}
                {c.note ? <span className={c.trend !== null && c.trend !== undefined ? ' ml-1' : ''}>{c.note}</span> : null}
              </p>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${t.bar}`} style={{ width: `${share ?? 0}%` }} /></div>
                <span className="text-[11px] tabular text-slate-500 w-8 text-right">{share ?? 0}%</span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
