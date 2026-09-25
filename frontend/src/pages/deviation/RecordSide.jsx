import { ChevronRight, ClipboardCheck, FileSpreadsheet, FileWarning, FileX2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDateTime, formatRelative } from '../../utils/format.js';

const ICONS = { imir: ClipboardCheck, deviation: FileWarning, dn: FileX2, format: FileSpreadsheet };

/**
 * Activity area at the foot of a record: History in one column; beside it rounds, linked records
 * and key information. Stacks on narrow screens (history first).
 */
export function ActivityLayout({ history, children }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] items-start">
      <div className="min-w-0">{history}</div>
      <div className="min-w-0 space-y-4">{children}</div>
    </div>
  );
}

/**
 * The records connected to this one (the lot's IMIR, deviation, DN, inspection format), each
 * with its current state. items: [{ kind, label, sub, to, badge (a status badge element) }]
 */
export function LinkedRecords({ items }) {
  const list = items.filter(Boolean);
  return (
    <section className="card">
      <h2 className="section-title px-4 pt-3.5 pb-2">Linked records</h2>
      {list.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-slate-500">No other records yet. A deviation or DN appears here once raised.</p>
      ) : (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {list.map((it) => {
            const Icon = ICONS[it.kind] ?? ClipboardCheck;
            return (
              <li key={`${it.kind}-${it.label}`}>
                <Link to={it.to} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors">
                  <span className="w-8 h-8 rounded-lg bg-slate-100 group-hover:bg-blue-100 flex items-center justify-center shrink-0"><Icon className="w-4 h-4 text-slate-600 group-hover:text-blue-700" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-900 truncate">{it.label}</span>
                    {it.sub && <span className="block text-xs text-slate-500 truncate">{it.sub}</span>}
                  </span>
                  {it.badge}
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Key dates and facts as a compact list. rows: [{ label, value, at (timestamp, shown with
 * "x ago"), tone: 'warn' | 'bad' }] — rows without a value or time are left out.
 */
export function KeyFacts({ title = 'Key information', rows }) {
  const list = rows.filter((r) => r && (r.value || r.at));
  if (!list.length) return null;
  return (
    <section className="card">
      <h2 className="section-title px-4 pt-3.5 pb-2">{title}</h2>
      <dl className="border-t border-slate-100 divide-y divide-slate-100">
        {list.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3 px-4 py-2">
            <dt className="text-xs text-slate-500 shrink-0">{r.label}</dt>
            <dd className={`text-sm text-right ${r.tone === 'bad' ? 'text-rose-700 font-semibold' : r.tone === 'warn' ? 'text-amber-800 font-medium' : 'text-slate-900'}`}>
              {r.value ?? formatDateTime(r.at)}
              {r.at && !r.value && <span className="block text-[11px] text-slate-400">{formatRelative(r.at)}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const STATUS_TONE = {
  good: 'bg-emerald-50 text-emerald-700 ring-emerald-200', bad: 'bg-rose-50 text-rose-700 ring-rose-200', warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  esc: 'bg-orange-50 text-orange-800 ring-orange-200', info: 'bg-blue-50 text-blue-700 ring-blue-200', pending: 'bg-white text-blue-700 ring-blue-300 border-dashed',
};

/**
 * Stage history as a table: stage, user, user role, date and time, status — oldest first, with
 * the stage the record waits in now as the last (pending) row. rows from stageRows().
 */
export function StageHistory({ rows, title = 'Stage history' }) {
  if (!rows.length) return null;
  return (
    <section className="card overflow-hidden">
      <h2 className="section-title px-4 pt-3.5 pb-2">{title}</h2>
      <div className="overflow-x-auto border-t border-slate-100">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[11px] text-slate-500">
            <tr>
              {['Stage', 'User', 'Role', 'Date & time', 'Status'].map((h) => <th key={h} scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.key} className={r.pending ? 'bg-blue-50/50' : 'hover:bg-slate-50'} title={r.remark ?? undefined}>
                <td className="px-3 py-2 font-medium text-slate-900">{r.stage}</td>
                <td className="px-3 py-2 text-slate-800">{r.user ?? <span className="text-slate-400">—</span>}</td>
                <td className="px-3 py-2 text-slate-600">{r.role ?? '—'}</td>
                <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                  {formatDateTime(r.at)}
                  {r.pending && r.at && <span className="block text-[11px] text-slate-400">for {formatRelative(r.at).replace(' ago', '')}</span>}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${STATUS_TONE[r.tone] ?? STATUS_TONE.info}`}>{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
