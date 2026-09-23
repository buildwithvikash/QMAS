import { ChevronRight, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAccess } from '../../hooks/useAccess.js';

// Per-section colour palette, as in WRL Tool Report (full class names for Tailwind).
const PALETTE = [
  { iconBg: 'bg-blue-100', iconText: 'text-blue-600', activeIconBg: 'bg-blue-600', activeBg: 'bg-blue-50', activeText: 'text-blue-700', dot: 'bg-blue-500', border: 'border-l-blue-500', sub: 'text-blue-400' },
  { iconBg: 'bg-emerald-100', iconText: 'text-emerald-600', activeIconBg: 'bg-emerald-600', activeBg: 'bg-emerald-50', activeText: 'text-emerald-700', dot: 'bg-emerald-500', border: 'border-l-emerald-500', sub: 'text-emerald-400' },
  { iconBg: 'bg-violet-100', iconText: 'text-violet-600', activeIconBg: 'bg-violet-600', activeBg: 'bg-violet-50', activeText: 'text-violet-700', dot: 'bg-violet-500', border: 'border-l-violet-500', sub: 'text-violet-400' },
  { iconBg: 'bg-orange-100', iconText: 'text-orange-600', activeIconBg: 'bg-orange-600', activeBg: 'bg-orange-50', activeText: 'text-orange-700', dot: 'bg-orange-500', border: 'border-l-orange-500', sub: 'text-orange-400' },
  { iconBg: 'bg-rose-100', iconText: 'text-rose-600', activeIconBg: 'bg-rose-600', activeBg: 'bg-rose-50', activeText: 'text-rose-700', dot: 'bg-rose-500', border: 'border-l-rose-500', sub: 'text-rose-400' },
  { iconBg: 'bg-cyan-100', iconText: 'text-cyan-600', activeIconBg: 'bg-cyan-600', activeBg: 'bg-cyan-50', activeText: 'text-cyan-700', dot: 'bg-cyan-500', border: 'border-l-cyan-500', sub: 'text-cyan-400' },
];

function groupItems(section) {
  if (!section.subgroups?.length) return { ungrouped: section.items, subgroups: [] };
  return {
    ungrouped: section.items.filter((i) => !i.group),
    subgroups: section.subgroups.map((g) => ({ ...g, items: section.items.filter((i) => i.group === g.key) })).filter((g) => g.items.length),
  };
}

const NavItem = ({ item, active, color }) => (
  <Link
    to={item.path}
    aria-current={active ? 'page' : undefined}
    className={`flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[12.5px] font-medium transition-all group ${
      active ? `${color.activeBg} ${color.activeText} font-semibold` : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
    }`}
  >
    <span className={`w-1.5 h-1.5 rounded-full shrink-0 transition-all ${active ? `${color.dot} scale-125` : 'bg-slate-300 group-hover:bg-slate-400'}`} />
    <span className="truncate">{item.label}</span>
  </Link>
);

export default function Sidebar({ expanded, onToggle, isMobile }) {
  const { menu } = useAccess();
  const location = useLocation();
  const [open, setOpen] = useState({});
  const ref = useRef(null);
  const showLabels = expanded || isMobile;

  // Open the section that contains the current page.
  useEffect(() => {
    const active = menu.find((m) => m.items.some((i) => i.path === location.pathname) || (m.activePrefix && location.pathname.startsWith(m.activePrefix)));
    if (active) setOpen((o) => ({ ...o, [active.key]: true }));
  }, [location.pathname, menu]);

  // On phones/tablets in portrait the sidebar is a drawer: close it after navigating.
  useEffect(() => {
    if (isMobile && expanded) onToggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const toggleSection = (key) => {
    if (!showLabels) return onToggle();
    setOpen((o) => ({ ...o, [key]: !o[key] }));
  };

  return (
    <>
      {isMobile && expanded && <div className="fixed inset-0 top-16 bg-slate-900/40 z-30 backdrop-blur-sm" onClick={onToggle} />}
      {isMobile && !expanded && (
        <button
          type="button"
          onClick={onToggle}
          aria-label="Open menu"
          className="fixed top-[72px] left-3 z-30 w-10 h-10 flex items-center justify-center bg-white text-slate-600 rounded-xl shadow-md border border-slate-200"
        >
          <Menu className="w-4 h-4" />
        </button>
      )}

      <aside
        ref={ref}
        aria-label="Main navigation"
        className={`fixed top-16 left-0 h-[calc(100vh-64px)] z-40 flex flex-col bg-white border-r border-slate-100 shadow-sm transition-all duration-300 select-none ${
          isMobile ? (expanded ? 'w-72 translate-x-0 shadow-xl' : 'w-72 -translate-x-full') : expanded ? 'w-64' : 'w-[56px]'
        }`}
      >
        <div className={`flex items-center h-12 px-2.5 border-b border-slate-100 shrink-0 ${showLabels ? 'justify-between' : 'justify-center'}`}>
          {showLabels && <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 px-1">Navigation</span>}
          <button
            type="button"
            onClick={onToggle}
            aria-label={showLabels ? 'Collapse menu' : 'Expand menu'}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            {showLabels ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2 space-y-0.5">
          {menu.map((section, idx) => {
            const color = PALETTE[idx % PALETTE.length];
            const Icon = section.icon;
            const sectionActive = section.items.some((i) => i.path === location.pathname) || (!!section.activePrefix && location.pathname.startsWith(section.activePrefix));
            const isOpen = !!open[section.key];
            const { ungrouped, subgroups } = groupItems(section);
            return (
              <div key={section.key}>
                <button
                  type="button"
                  onClick={() => toggleSection(section.key)}
                  title={showLabels ? undefined : section.label}
                  aria-expanded={isOpen}
                  className={`relative w-full flex items-center gap-2.5 px-2 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer border-l-2 ${
                    sectionActive ? `${color.activeBg} ${color.activeText} ${color.border} font-semibold` : 'border-l-transparent text-slate-600 hover:text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${sectionActive ? `${color.activeIconBg} text-white shadow-sm` : `${color.iconBg} ${color.iconText}`}`}>
                    <Icon className="w-[15px] h-[15px]" />
                  </span>
                  {showLabels && (
                    <>
                      <span className="flex-1 text-left truncate text-[13px]">{section.label}</span>
                      <ChevronRight className={`w-3.5 h-3.5 text-slate-300 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                    </>
                  )}
                  {!showLabels && sectionActive && <span className={`absolute right-1 top-1 w-1.5 h-1.5 rounded-full ${color.dot}`} />}
                </button>

                {showLabels && isOpen && (
                  <div className="mt-0.5 ml-[14px] pl-3 border-l-2 border-slate-100 pb-1.5">
                    {ungrouped.map((item) => <NavItem key={item.path} item={item} active={item.path === location.pathname} color={color} />)}
                    {subgroups.map((g) => (
                      <div key={g.key}>
                        <div className="flex items-center gap-2 px-1 pt-3 pb-1">
                          <span className={`text-[9px] font-bold uppercase tracking-[0.18em] ${color.sub}`}>{g.label}</span>
                          <span className="flex-1 h-px bg-slate-100" />
                        </div>
                        {g.items.map((item) => <NavItem key={item.path} item={item} active={item.path === location.pathname} color={color} />)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {showLabels && <p className="shrink-0 border-t border-slate-100 px-3 py-2 text-[10px] text-slate-300 text-center">QMAS · Western Refrigeration</p>}
      </aside>
    </>
  );
}
