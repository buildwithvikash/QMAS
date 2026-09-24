import { Check, ChevronRight, Copy, Home, Search, X } from 'lucide-react';
import { useState } from 'react';
import { Link, matchPath, useLocation } from 'react-router-dom';
import { ROUTE_SECTIONS } from '../../config/routes.config.jsx';

/** Where the current page sits in the menu: section, list page (for detail pages) and page. */
function useCrumbs() {
  const { pathname } = useLocation();
  for (const section of ROUTE_SECTIONS) {
    const item = section.items.find((i) => matchPath({ path: i.path, end: true }, pathname));
    if (!item) continue;
    if (item.path === '/') return [];
    const crumbs = [{ label: section.label }];
    if (item.hidden) {
      // Detail page: link back to the list it belongs to (longest matching visible path).
      const parent = section.items
        .filter((i) => !i.hidden && pathname.startsWith(i.path) && i.path !== '/')
        .sort((a, b) => b.path.length - a.path.length)[0] ?? section.items.find((i) => !i.hidden);
      if (parent) crumbs.push({ label: parent.label, to: parent.path });
    } else if (item.path !== '/') {
      crumbs.push({ label: item.label });
    }
    return crumbs;
  }
  return [];
}

/** Copies a document number, showing a tick for a moment. */
export function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1400);
    } catch {
      /* clipboard not available (e.g. http on a tablet): nothing to do */
    }
  };
  return (
    <button type="button" onClick={copy} title={done ? 'Copied' : `${label} ${text}`} aria-label={`${label} ${text}`}
      className="p-1 rounded-md text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer">
      {done ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

/**
 * Page header: breadcrumb trail, icon chip, title (copyable for document numbers), subtitle,
 * optional search, and actions. Sticky, with a frosted background so content scrolls under it.
 */
export default function PageHeader({ icon: Icon, title, subtitle, search, onSearch, searchPlaceholder = 'Search…', copyTitle = false, children }) {
  const crumbs = useCrumbs();
  return (
    <div className="sticky top-0 z-20 bg-white/85 backdrop-blur-md border-b border-slate-200/80">
      <div className="px-5 pt-2.5 pb-3">
        {crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[11px] text-slate-400 mb-1.5 min-w-0">
            <Link to="/" className="hover:text-blue-600 shrink-0" aria-label="Home"><Home className="w-3 h-3" /></Link>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1 min-w-0">
                <ChevronRight className="w-3 h-3 shrink-0 text-slate-300" />
                {c.to ? <Link to={c.to} className="hover:text-blue-600 truncate">{c.label}</Link> : <span className="truncate">{c.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {Icon && (
              <div className="p-2 rounded-lg bg-blue-50 ring-1 ring-blue-100 shrink-0">
                <Icon className="w-4 h-4 text-blue-700" />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <h1 className="text-lg font-semibold text-slate-900 leading-tight truncate">{title}</h1>
                {copyTitle && typeof title === 'string' && <CopyButton text={title} />}
              </div>
              {subtitle && <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {onSearch && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => onSearch(e.target.value)}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  className="pl-8 pr-8 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 w-64 transition-all [&::-webkit-search-cancel-button]:hidden"
                />
                {search && (
                  <button type="button" onClick={() => onSearch('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-700 cursor-pointer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Segmented tabs under a page header; scrolls sideways when there are many.
 * tabs: [{ key, label, count? }]
 */
export function Tabs({ tabs, active, onChange, className = '' }) {
  return (
    <div role="tablist" className={`no-scrollbar flex gap-1 overflow-x-auto p-1 rounded-lg bg-slate-200/70 w-fit max-w-full ${className}`}>
      {tabs.map((t) => {
        const on = active === t.key;
        return (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={`shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium rounded-md cursor-pointer transition-colors whitespace-nowrap ${
              on ? 'bg-white text-blue-800 ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count !== null && (
              <span className={`min-w-5 px-1.5 rounded-full text-[10px] font-bold tabular ${on ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'}`}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
