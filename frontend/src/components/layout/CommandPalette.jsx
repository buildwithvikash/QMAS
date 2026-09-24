import { ArrowRight, Clock, CornerDownLeft, FileText, FileWarning, FileX2, Loader2, Package, Search, Truck, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useSearchQuery } from '../../api/searchApi.js';
import { useAccess } from '../../hooks/useAccess.js';
import { useDebounced } from '../../hooks/useDebounced.js';
import { loadPref, savePref } from '../../utils/prefs.js';

const ICONS = { imir: FileText, deviation: FileWarning, dn: FileX2, item: Package, vendor: Truck, page: ArrowRight, recent: Clock };
const RECENT_KEY = 'recent-search';

/**
 * Search everything from anywhere: pages of the menu, recent records, and documents and masters
 * by number, code or name. Arrow keys move, Enter opens, Esc closes.
 */
export default function CommandPalette({ onClose }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef(null);
  const listRef = useRef(null);
  const navigate = useNavigate();
  const { menu } = useAccess();
  const term = useDebounced(q.trim(), 200);
  const { data: groups = [], isFetching } = useSearchQuery(term, { skip: term.length < 2 });
  const recent = useMemo(() => loadPref(RECENT_KEY, []), []);

  useEffect(() => input.current?.focus(), []);

  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pages = menu
      .flatMap((s) => s.items.map((i) => ({ id: i.path, title: i.label, subtitle: s.label, link: i.path })))
      .filter((p) => !needle || `${p.title} ${p.subtitle}`.toLowerCase().includes(needle))
      .slice(0, needle ? 5 : 8);
    const out = [];
    if (!needle && recent.length) out.push({ key: 'recent', label: 'Recent', items: recent });
    if (term.length >= 2) out.push(...groups);
    if (pages.length) out.push({ key: 'page', label: needle ? 'Pages' : 'Go to', items: pages });
    return out;
  }, [q, term, groups, menu, recent]);

  const flat = sections.flatMap((s) => s.items.map((it) => ({ ...it, group: s.key })));
  const current = Math.min(active, Math.max(flat.length - 1, 0));

  const open = (it) => {
    if (it.group !== 'page') {
      const entry = { id: it.id, title: it.title, subtitle: it.subtitle, link: it.link, kind: it.kind ?? it.group };
      savePref(RECENT_KEY, [entry, ...loadPref(RECENT_KEY, []).filter((r) => r.link !== it.link)].slice(0, 6));
    }
    onClose();
    navigate(it.link);
  };

  // Keys are handled for the whole document while the palette is open, so they work even if
  // focus left the input (a click on the list, a tablet keyboard closing).
  const keys = useRef(null);
  keys.current = (e) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && flat[current]) { e.preventDefault(); open(flat[current]); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && document.activeElement !== input.current) input.current?.focus();
  };
  useEffect(() => {
    const onKey = (e) => keys.current(e);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  let index = -1;
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-start justify-center p-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Search QMAS" className="animate-fadeIn w-full max-w-xl card shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 border-b border-slate-100">
          {isFetching ? <Loader2 className="w-4 h-4 text-blue-600 animate-spin" /> : <Search className="w-4 h-4 text-slate-400" />}
          <input
            ref={input}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            placeholder="Search IMIR, DN, deviation, GRN, item, vendor or a page…"
            aria-label="Search"
            aria-activedescendant={flat[current] ? `cp-${current}` : undefined}
            className="flex-1 py-4 text-[15px] bg-transparent outline-none focus-visible:outline-none placeholder-slate-400"
          />
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-md text-slate-400 hover:bg-slate-100 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <div ref={listRef} role="listbox" className="max-h-[55vh] overflow-auto p-2">
          {sections.map((s) => (
            <div key={s.key} className="mb-1">
              <div className="eyebrow px-2.5 pt-2 pb-1">{s.label}</div>
              {s.items.map((it) => {
                index += 1;
                const i = index;
                const Icon = ICONS[it.kind ?? s.key] ?? ArrowRight;
                const on = i === current;
                return (
                  <button
                    key={`${s.key}-${it.id}`}
                    id={`cp-${i}`}
                    type="button"
                    role="option"
                    aria-selected={on}
                    data-active={on}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => open({ ...it, group: s.key })}
                    className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left cursor-pointer ${on ? 'bg-blue-50' : ''}`}
                  >
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${on ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}><Icon className="w-4 h-4" /></span>
                    <span className="flex-1 min-w-0">
                      <span className={`block text-sm truncate ${on ? 'text-blue-800 font-semibold' : 'text-slate-800 font-medium'}`}>{it.title}</span>
                      {it.subtitle && <span className="block text-xs text-slate-500 truncate">{it.subtitle}</span>}
                    </span>
                    {it.meta && <span className="text-[11px] text-slate-400 shrink-0 first-letter:uppercase">{String(it.meta).replaceAll("_", " ").toLowerCase()}</span>}
                    {on && <CornerDownLeft className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
          {term.length >= 2 && !isFetching && !groups.length && (
            <p className="px-3 py-6 text-center text-sm text-slate-500">No records match “{term}”.</p>
          )}
        </div>
        <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-100 text-[11px] text-slate-400">
          <span><kbd className="font-sans px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50">↑</kbd> <kbd className="font-sans px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50">↓</kbd> move</span>
          <span><kbd className="font-sans px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50">Enter</kbd> open</span>
          <span><kbd className="font-sans px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50">Esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
