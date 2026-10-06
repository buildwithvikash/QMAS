import { PERMISSIONS } from '@qmas/shared';
import { BarChart3, ClipboardCheck, FileText, FileWarning, FileX2, Home, LifeBuoy, Settings, SlidersHorizontal, Sparkles } from 'lucide-react';
import { ROUTE_SECTIONS } from '../../config/routes.config.jsx';

/** Look of the Roles & Permissions page, used by the role details. */

// The menu pages each permission opens, straight from the menu configuration (so this stays true).
export const PAGES_BY_PERMISSION = new Map();
for (const section of ROUTE_SECTIONS) {
  for (const item of section.items) {
    if (item.hidden || !item.permission) continue;
    PAGES_BY_PERMISSION.set(item.permission, [...(PAGES_BY_PERMISSION.get(item.permission) ?? []), { path: item.path, label: item.label, section: section.label }]);
  }
}

// Views inside a page that need their own permission (not separate menu entries).
export const EXTRA_PAGES = [
  { permission: PERMISSIONS.SUPPORT_MANAGE, path: '/help/tickets?scope=all', label: 'Support Desk (all tickets)', section: 'Help & Support', note: 'Tabs on My Tickets: all tickets, assigned to me; reply, assign, set status' },
  // AI features inside other pages.
];
for (const x of EXTRA_PAGES) PAGES_BY_PERMISSION.set(x.permission, [...(PAGES_BY_PERMISSION.get(x.permission) ?? []), x]);

// Module: icon, icon tile, and a soft tint of the module colour.
export const MODULE_LOOK = {
  Home: [Home, 'bg-blue-100 text-blue-700', 'bg-blue-50/70'],
  Administration: [Settings, 'bg-emerald-100 text-emerald-700', 'bg-emerald-50/70'],
  'Master Config': [SlidersHorizontal, 'bg-orange-100 text-orange-700', 'bg-orange-50/70'],
  'Inspection Formats': [FileText, 'bg-violet-100 text-violet-700', 'bg-violet-50/70'],
  'Incoming Inspection': [ClipboardCheck, 'bg-sky-100 text-sky-700', 'bg-sky-50/70'],
  Deviation: [FileWarning, 'bg-amber-100 text-amber-700', 'bg-amber-50/70'],
  'Defect Notification': [FileX2, 'bg-rose-100 text-rose-700', 'bg-rose-50/70'],
  Reports: [BarChart3, 'bg-indigo-100 text-indigo-700', 'bg-indigo-50/70'],
  'AI Assistant': [Sparkles, 'bg-fuchsia-100 text-fuchsia-700', 'bg-fuchsia-50/70'],
  'Help & Support': [LifeBuoy, 'bg-cyan-100 text-cyan-700', 'bg-cyan-50/70'],
};

const DEPT_TONE = {
  IT: 'bg-blue-100 text-blue-700',
  IQC: 'bg-emerald-100 text-emerald-700',
  Quality: 'bg-violet-100 text-violet-700',
  'Centralized Quality': 'bg-sky-100 text-sky-700',
  SCM: 'bg-amber-100 text-amber-700',
  VD: 'bg-orange-100 text-orange-700',
  Plant: 'bg-rose-100 text-rose-700',
  PDC: 'bg-indigo-100 text-indigo-700',
  Operations: 'bg-teal-100 text-teal-700',
  Management: 'bg-slate-100 text-slate-700',
};
export const deptTone = (d) => DEPT_TONE[d] ?? 'bg-blue-100 text-blue-700';
