import { X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Preview panel on the right of a list: title with a status pill, a subtitle line, tabs, a
 * scrolling body and actions at the foot. Esc or the × closes it; the list stays usable beside it
 * on wide screens.
 */
export default function Drawer({ title, badge, subtitle, tabs, tab, onTab, footer, onClose, children, label = 'Preview' }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/20 xl:hidden" onClick={onClose} />
      <aside role="dialog" aria-label={label} className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[28rem] bg-white shadow-2xl border-l border-slate-200 flex flex-col animate-slideIn">
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900 truncate">{title}</h2>
                {badge}
              </div>
              {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"><X className="w-5 h-5" /></button>
          </div>
        </div>
        {tabs && (
          <div role="tablist" className="flex gap-1 px-5 border-b border-slate-200 overflow-x-auto no-scrollbar">
            {tabs.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => onTab(t.key)}
                className={`shrink-0 px-3 py-2.5 -mb-px border-b-2 text-sm cursor-pointer ${tab === t.key ? 'border-blue-600 text-blue-800 font-semibold' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-y-auto bg-slate-50/60 p-4 space-y-3">{children}</div>
        {footer && <div className="border-t border-slate-200 bg-white px-4 py-3 flex flex-wrap items-center gap-2">{footer}</div>}
      </aside>
    </>,
    document.body,
  );
}

/** A titled card of label / value rows inside a drawer. rows: [[label, value], …] (empty values show –). */
export function DrawerCard({ icon: Icon, title, action, rows, children }) {
  return (
    <section className="card">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
        {Icon && <span className="w-7 h-7 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center"><Icon className="w-4 h-4" /></span>}
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {rows && (
        <dl className="px-4 pb-3 space-y-1.5">
          {rows.filter(Boolean).map(([k, v]) => (
            <div key={k} className="grid grid-cols-[8.5rem_1fr] gap-2 text-sm">
              <dt className="text-slate-500">{k}</dt>
              <dd className="text-slate-900 min-w-0 break-words">{v === null || v === undefined || v === '' ? '–' : v}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </section>
  );
}
