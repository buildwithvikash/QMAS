import { Search } from 'lucide-react';

/** Sticky page header from WRL Master Config: icon chip, title, subtitle, search, actions. */
export default function PageHeader({ icon: Icon, title, subtitle, search, onSearch, searchPlaceholder = 'Search…', children }) {
  return (
    <div className="sticky top-0 z-20 bg-white border-b border-slate-200 shadow-sm">
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {Icon && (
            <div className="p-2 rounded-lg bg-blue-50 shrink-0">
              <Icon className="w-4 h-4 text-blue-600" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-base font-bold text-slate-800 leading-tight">{title}</h1>
            {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {onSearch && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 w-56"
              />
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

/** Horizontal tabs under a page header. */
export function Tabs({ tabs, active, onChange }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-slate-200 mb-4">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          type="button"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px cursor-pointer transition-colors ${active === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
