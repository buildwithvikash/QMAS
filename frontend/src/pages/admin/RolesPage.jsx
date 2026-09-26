import { PERMISSIONS, ROLES } from '@qmas/shared';
import {
  ArrowLeft, BarChart3, Check, CheckSquare, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ClipboardCheck, Clock, Copy, ExternalLink,
  FileText, FileWarning, FileX2, Grid3x3, Home, Info, KeyRound, Minus, MoreVertical, Pencil, Plus, Power, Save, Search, Settings, ShieldCheck,
  SlidersHorizontal, Sparkles, Trash2, UserRound, Users, X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import {
  useDeleteRoleMutation, useGetPermissionsQuery, useGetRolesQuery, useGetUsersQuery, useSetRolePermissionsMutation, useUpdateRoleMutation,
} from '../../api/adminApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Loader from '../../components/ui/Loader.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { ROUTE_SECTIONS } from '../../config/routes.config.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { apiError } from '../../utils/apiError.js';
import { formatDate, formatRelative } from '../../utils/format.js';
import RoleDialog from './RoleDialog.jsx';

// The menu pages each permission opens, straight from the menu configuration (so this stays true).
const PAGES_BY_PERMISSION = new Map();
for (const section of ROUTE_SECTIONS) {
  for (const item of section.items) {
    if (item.hidden || !item.permission) continue;
    PAGES_BY_PERMISSION.set(item.permission, [...(PAGES_BY_PERMISSION.get(item.permission) ?? []), { path: item.path, label: item.label, section: section.label }]);
  }
}

const MODULE_LOOK = {
  Home: [Home, 'bg-blue-100 text-blue-700'],
  Administration: [Settings, 'bg-emerald-100 text-emerald-700'],
  'Master Config': [SlidersHorizontal, 'bg-violet-100 text-violet-700'],
  'Inspection Formats': [FileText, 'bg-sky-100 text-sky-700'],
  'Incoming Inspection': [ClipboardCheck, 'bg-emerald-100 text-emerald-700'],
  Deviation: [FileWarning, 'bg-orange-100 text-orange-700'],
  'Defect Notification': [FileX2, 'bg-rose-100 text-rose-700'],
  Reports: [BarChart3, 'bg-indigo-100 text-indigo-700'],
  'AI Assistant': [Sparkles, 'bg-fuchsia-100 text-fuchsia-700'],
};
const DEPT_TONE = {
  IT: 'bg-slate-100 text-slate-700', IQC: 'bg-emerald-100 text-emerald-700', Quality: 'bg-violet-100 text-violet-700',
  'Centralized Quality': 'bg-sky-100 text-sky-700', SCM: 'bg-amber-100 text-amber-700', VD: 'bg-orange-100 text-orange-700',
  Plant: 'bg-rose-100 text-rose-700', PDC: 'bg-indigo-100 text-indigo-700', Operations: 'bg-teal-100 text-teal-700', Management: 'bg-slate-100 text-slate-700',
};
const deptTone = (d) => DEPT_TONE[d] ?? 'bg-blue-100 text-blue-700';

/**
 * Roles & Permissions: the roles on the left; the chosen role's permissions by module, its users and
 * its details on the right. Built-in roles drive the workflow (only description and permissions
 * change); custom roles can be added, copied, edited, deactivated and deleted.
 */
export default function RolesPage() {
  const { can } = useAccess();
  const manage = can(PERMISSIONS.ROLES_MANAGE);
  const { data: roles, isLoading } = useGetRolesQuery();
  const { data: permissions } = useGetPermissionsQuery();
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState('role');
  const [dialog, setDialog] = useState(null); // { mode: 'add' | 'duplicate' | 'edit' }
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [updateRole] = useUpdateRoleMutation();
  const [deleteRole, { isLoading: deleting }] = useDeleteRoleMutation();

  if (isLoading || !roles || !permissions) return <Loader />;
  const role = roles.find((r) => r.code === selected) ?? roles.find((r) => r.code !== ROLES.SYSTEM_ADMIN) ?? roles[0];
  const departments = [...new Set(roles.map((r) => r.department))].sort();
  const pick = (code) => {
    if (code === role.code) return;
    if (dirty && !window.confirm('Discard the unsaved permission changes?')) return;
    setDirty(false);
    setSelected(code);
  };
  const toggleActive = async () => {
    try {
      const r = await updateRole({ code: role.code, isActive: !role.isActive }).unwrap();
      toast.success(r.isActive ? `${r.name} is active again.` : `${r.name} is inactive: its users lose its permissions.`);
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  const remove = async () => {
    try {
      await deleteRole(role.code).unwrap();
      toast.success(`${role.name} deleted.`);
      setConfirmDelete(false);
      setSelected(null);
    } catch (err) {
      toast.error(apiError(err).message);
      setConfirmDelete(false);
    }
  };

  const menu = [
    { label: view === 'matrix' ? 'Back to one role' : 'Compare all roles', icon: view === 'matrix' ? ArrowLeft : Grid3x3, onClick: () => setView(view === 'matrix' ? 'role' : 'matrix') },
    ...(manage && !role.isSystem ? [
      'sep',
      { label: role.isActive ? 'Make inactive' : 'Make active', icon: Power, onClick: toggleActive },
      { label: 'Delete role', icon: Trash2, danger: true, onClick: () => setConfirmDelete(true) },
    ] : []),
  ];

  return (
    <div className="pb-20">
      <PageHeader icon={ShieldCheck} title="Roles & Permissions" subtitle="Manage user roles and what they can see and do. Select a role to view and edit its permissions.">
        {manage && view === 'role' && role.code !== ROLES.SYSTEM_ADMIN && (
          <Button variant="secondary" size="sm" icon={Copy} onClick={() => setDialog({ mode: 'duplicate' })} className="text-blue-700!">Duplicate role</Button>
        )}
        {manage && view === 'role' && role.code !== ROLES.SYSTEM_ADMIN && <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setDialog({ mode: 'edit' })}>Edit role details</Button>}
        <Kebab items={menu} />
      </PageHeader>

      {view === 'matrix' ? <Matrix roles={roles} permissions={permissions} onPick={(code) => { pick(code); setView('role'); }} /> : (
        <div className="p-4 sm:p-5 grid gap-4 lg:grid-cols-[340px_1fr] items-start">
          <RoleList roles={roles} total={permissions.length} active={role.code} onPick={pick} onAdd={manage ? () => setDialog({ mode: 'add' }) : null} />
          <RoleDetail key={role.code} role={role} permissions={permissions} editable={manage && role.code !== ROLES.SYSTEM_ADMIN} onDirty={setDirty} />
        </div>
      )}

      {dialog && (
        <RoleDialog mode={dialog.mode} source={dialog.mode === 'add' ? null : role} departments={departments} onClose={() => setDialog(null)}
          onSaved={(r) => { setDialog(null); setDirty(false); setSelected(r.code); }} />
      )}
      {confirmDelete && (
        <ConfirmDialog title={`Delete ${role.name}?`} confirmLabel="Delete role" busy={deleting} onCancel={() => setConfirmDelete(false)} onConfirm={remove}
          message={role.userCount > 0 ? `${role.userCount} user${role.userCount === 1 ? ' holds' : 's hold'} this role, so it cannot be deleted. Remove it from them first, or make the role inactive.` : 'The role and its permissions are removed. This cannot be undone.'} />
      )}
    </div>
  );
}

/** ⋮ menu of page actions. items: [{ label, icon, onClick, danger } | 'sep']. */
function Kebab({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 cursor-pointer">
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 z-30 w-52 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {items.map((it, i) => (it === 'sep' ? <div key={`s${i}`} className="my-1 border-t border-slate-100" /> : (
            <button key={it.label} type="button" role="menuitem" onClick={() => { setOpen(false); it.onClick(); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left cursor-pointer ${it.danger ? 'text-rose-700 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-50'}`}>
              <it.icon className="w-4 h-4" />{it.label}
            </button>
          )))}
        </div>
      )}
    </div>
  );
}

function RoleList({ roles, total, active, onPick, onAdd }) {
  const [q, setQ] = useState('');
  const listRef = useRef(null);
  // Keep the chosen role in view (e.g. a role just added lands at the end of the list).
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? roles.filter((r) => [r.name, r.description, r.department].some((v) => v?.toLowerCase().includes(needle))) : roles;
  return (
    <section className="card lg:sticky lg:top-24 flex flex-col lg:max-h-[calc(100dvh-8rem)]" aria-label="Roles">
      <div className="flex items-center gap-2 px-4 pt-4">
        <h2 className="text-base font-bold text-slate-900">Roles</h2>
        <span className="text-xs text-slate-400 tabular">{roles.length}</span>
        {onAdd && <Button variant="secondary" size="sm" icon={Plus} onClick={onAdd} className="ml-auto text-blue-700! border-blue-300!">Add role</Button>}
      </div>
      <div className="px-4 pt-3 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search role…" aria-label="Search roles"
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500" />
        </div>
      </div>
      <ul ref={listRef} className="px-3 pb-3 space-y-1.5 overflow-y-auto">
        {shown.map((r) => {
          const on = r.code === active;
          const count = r.code === ROLES.SYSTEM_ADMIN ? total : r.permissions.length;
          return (
            <li key={r.code}>
              <button type="button" onClick={() => onPick(r.code)} aria-current={on}
                className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left cursor-pointer transition-colors ${on ? 'border-emerald-400 bg-emerald-50/70 ring-1 ring-emerald-400' : 'border-transparent hover:bg-slate-50 hover:border-slate-200'}`}>
                <span className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${deptTone(r.department)}`}><UserRound className="w-4.5 h-4.5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={`text-sm font-semibold truncate ${r.isActive ? 'text-slate-900' : 'text-slate-400 line-through'}`}>{r.name}</span>
                    {!r.isSystem && <span className="shrink-0 rounded px-1 text-[10px] font-semibold bg-blue-50 text-blue-700">Custom</span>}
                  </span>
                  <span className="block text-xs text-slate-500 truncate">{r.description ?? r.department}</span>
                </span>
                <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 tabular">{count}/{total}</span>
                <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-2 py-6 text-center text-sm text-slate-500">No role matches “{q}”.</li>}
      </ul>
    </section>
  );
}

/** Progress ring for "permissions assigned". */
function Ring({ value }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative w-12 h-12 shrink-0" aria-hidden="true">
      <svg viewBox="0 0 44 44" className="w-12 h-12 -rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" className="stroke-slate-100" />
        <circle cx="22" cy="22" r={r} fill="none" strokeWidth="4" strokeLinecap="round" className="stroke-blue-600 transition-all" strokeDasharray={c} strokeDashoffset={c * (1 - value)} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-700 tabular">{Math.round(value * 100)}%</span>
    </span>
  );
}

function RoleDetail({ role, permissions, editable, onDirty }) {
  const isAdmin = role.code === ROLES.SYSTEM_ADMIN;
  const initial = useMemo(() => new Set(isAdmin ? permissions.map((p) => p.key) : role.permissions), [isAdmin, permissions, role.permissions]);
  const [granted, setGranted] = useState(initial);
  const [tab, setTab] = useState('permissions');
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [save, { isLoading }] = useSetRolePermissionsMutation();
  const added = [...granted].filter((k) => !initial.has(k)).length;
  const removed = [...initial].filter((k) => !granted.has(k)).length;
  const dirty = added + removed > 0;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  // A saved change comes back as a new role.permissions: start from it.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setGranted(initial);
  }

  const needle = q.trim().toLowerCase();
  const modules = useMemo(() => {
    const m = new Map();
    for (const p of permissions) {
      if (needle && !`${p.description} ${p.key} ${p.module}`.toLowerCase().includes(needle)) continue;
      m.set(p.module, [...(m.get(p.module) ?? []), p]);
    }
    return [...m.entries()];
  }, [permissions, needle]);
  const visibleKeys = modules.flatMap(([, perms]) => perms.map((p) => p.key));
  const allVisible = visibleKeys.length > 0 && visibleKeys.every((k) => granted.has(k));

  const set = (keys, on) => setGranted((g) => {
    const next = new Set(g);
    for (const k of keys) (on ? next.add(k) : next.delete(k));
    return next;
  });
  const submit = async () => {
    try {
      await save({ code: role.code, permissions: [...granted] }).unwrap();
      toast.success(`${role.name} updated. Users with this role get the change on their next click.`);
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  const share = granted.size / permissions.length;

  return (
    <div className="space-y-4 min-w-0">
      <section className="card px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className={`w-12 h-12 shrink-0 rounded-xl flex items-center justify-center ${deptTone(role.department)}`}><UserRound className="w-6 h-6" /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900">{role.name}</h2>
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">{role.isSystem ? 'Built-in role' : 'Custom role'}</span>
              <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500">{role.department}</span>
            </div>
            <p className="mt-1 text-sm text-slate-500">{role.description ?? 'No description yet.'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 pr-2">
          <div className="text-right">
            <p className="text-xl font-bold text-slate-900 tabular">{granted.size} <span className="text-slate-400 font-medium">/ {permissions.length}</span></p>
            <p className="text-[11px] text-slate-500">Permissions assigned</p>
          </div>
          <Ring value={share} />
        </div>
        <div className="border-l border-slate-200 pl-6">
          <p className="flex items-center gap-1 text-[11px] text-slate-500"><Power className="w-3 h-3" />Status</p>
          <span className={`mt-1 inline-block rounded-md px-2.5 py-1 text-xs font-semibold ${role.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{role.isActive ? 'Active' : 'Inactive'}</span>
        </div>
        <div className="border-l border-slate-200 pl-6">
          <p className="flex items-center gap-1 text-[11px] text-slate-500"><Clock className="w-3 h-3" />Last updated</p>
          <p className="mt-0.5 text-sm font-semibold text-slate-800" title={formatRelative(role.updatedAt)}>{formatDate(role.updatedAt)}</p>
          <p className="text-[11px] text-slate-500">by {role.updatedByName ?? 'System (setup)'}</p>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex gap-2">
          {[['permissions', 'Permissions', KeyRound], ['users', `Users (${role.userCount})`, Users], ['info', 'Role info', Info]].map(([k, label, Icon]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border text-sm font-medium cursor-pointer ${tab === k ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              <Icon className="w-4 h-4" />{label}
            </button>
          ))}
        </div>
        {tab === 'permissions' && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search permissions…" aria-label="Search permissions"
                className="h-9 w-52 pl-8 pr-7 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500" />
              {q && <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"><X className="w-3.5 h-3.5" /></button>}
            </div>
            <Button variant="secondary" size="sm" icon={ChevronsUpDown} onClick={() => setCollapsed(new Set())}>Expand all</Button>
            <Button variant="secondary" size="sm" icon={ChevronsDownUp} onClick={() => setCollapsed(new Set(modules.map(([m]) => m)))}>Collapse all</Button>
            {editable && <Button size="sm" icon={CheckSquare} onClick={() => set(visibleKeys, !allVisible)}>{allVisible ? 'Clear all' : 'Select all'}</Button>}
          </div>
        )}
      </div>

      {tab === 'permissions' && (
        <>
          {isAdmin && <p className="rounded-lg bg-blue-50 px-4 py-2.5 text-sm text-blue-900">System Admin always holds every permission and can act for any role.</p>}
          {!role.isActive && <p className="rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-900">This role is inactive: its users get none of these permissions until it is made active again.</p>}
          {modules.length === 0 ? <p className="card p-8 text-center text-sm text-slate-500">No permission matches “{q}”.</p> : (
            <div className="grid gap-4 xl:grid-cols-2 items-start">
              {modules.map(([module, perms]) => (
                <ModuleCard key={module} module={module} perms={perms} granted={granted} editable={editable} onSet={set}
                  open={needle !== '' || !collapsed.has(module)}
                  onToggle={() => setCollapsed((c) => { const n = new Set(c); if (n.has(module)) n.delete(module); else n.add(module); return n; })} />
              ))}
            </div>
          )}
        </>
      )}
      {tab === 'users' && <RoleUsers role={role} />}
      {tab === 'info' && <RoleInfo role={role} granted={granted} />}

      {editable && tab === 'permissions' && (
        <div className="fixed bottom-0 right-0 left-0 lg:left-auto z-20 flex items-center justify-end gap-3 px-5 py-3 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-slate-200 bg-white/95 backdrop-blur px-4 py-2.5 shadow-lg">
            <span className={`text-xs ${dirty ? 'text-amber-800 font-medium' : 'text-slate-400'}`}>{dirty ? `Unsaved: ${added} added, ${removed} removed` : 'No changes'}</span>
            <Button variant="secondary" size="sm" icon={X} disabled={!dirty} onClick={() => setGranted(initial)}>Cancel</Button>
            <Button size="sm" icon={Save} disabled={!dirty} loading={isLoading} onClick={submit}>Save permissions</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ModuleCard({ module, perms, granted, editable, onSet, open, onToggle }) {
  const [Icon, tone] = MODULE_LOOK[module] ?? [KeyRound, 'bg-slate-100 text-slate-700'];
  const count = perms.filter((p) => granted.has(p.key)).length;
  const all = count === perms.length;
  const some = count > 0 && !all;
  return (
    <section className="card">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${tone}`}><Icon className="w-4.5 h-4.5" /></span>
        <h3 className="text-sm font-bold text-slate-900">{module}</h3>
        <span className="text-xs text-slate-500 tabular">{count}/{perms.length}</span>
        <div className="ml-auto flex items-center gap-1">
          {editable && (
            <label className="inline-flex items-center gap-2 px-2 py-1 rounded-md text-xs font-medium text-blue-700 hover:bg-blue-50 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-blue-600 cursor-pointer" checked={all} ref={(el) => { if (el) el.indeterminate = some; }}
                onChange={() => onSet(perms.map((p) => p.key), !all)} />
              Select all
            </label>
          )}
          <button type="button" onClick={onToggle} aria-expanded={open} aria-label={open ? `Collapse ${module}` : `Expand ${module}`} className="p-1 rounded-md text-slate-500 hover:bg-slate-100 cursor-pointer">
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>
      {open && (
        <ul className="px-4 pb-3 space-y-0.5 border-t border-slate-100 pt-2">
          {perms.map((p) => {
            const opens = PAGES_BY_PERMISSION.get(p.key) ?? [];
            const on = granted.has(p.key);
            return (
              <li key={p.key}>
                <label className={`flex items-start gap-3 rounded-lg px-2 py-1.5 ${editable ? 'cursor-pointer hover:bg-slate-50' : ''}`}>
                  <input type="checkbox" className="mt-0.5 w-4 h-4 shrink-0 accent-blue-600" checked={on} disabled={!editable} onChange={(e) => onSet([p.key], e.target.checked)} />
                  <span className="min-w-0">
                    <span className={`block text-sm ${on ? 'text-slate-900' : 'text-slate-600'}`}>{p.description}</span>
                    <span className="block text-[11px] text-slate-400">
                      <span className="font-mono">{p.key}</span>
                      {opens.length > 0 && <> · opens {opens.map((o) => o.label).join(', ')}</>}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function RoleUsers({ role }) {
  const { data, isFetching } = useGetUsersQuery({ roleCode: role.code, pageSize: 100, sort: 'fullName' });
  const users = data?.rows ?? [];
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-900">Users with {role.name}</h3>
        <Link to={`/admin/users?roleCode=${role.code}`} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline">Manage in User Management<ExternalLink className="w-3 h-3" /></Link>
      </div>
      {isFetching && !users.length ? <div className="p-6"><div className="skeleton h-20" /></div>
        : users.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No user has this role yet. Give it to someone from User Management.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>{['User', 'Plant', 'Status', 'Last seen'].map((h) => <th key={h} scope="col" className="px-4 py-2 text-left font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5"><div className="font-medium text-slate-900">{u.fullName}</div><div className="text-xs text-slate-400 font-mono">{u.employeeCode}</div></td>
                  <td className="px-4 py-2.5 text-slate-700">{u.roles.filter((r) => r.roleCode === role.code).map((r) => r.plantName ?? 'All plants').join(', ')}</td>
                  <td className="px-4 py-2.5">
                    {!u.isActive ? <Badge variant="neutral">Deactivated</Badge> : u.isLocked ? <Badge variant="danger">Locked</Badge> : u.online ? <Badge variant="success" dot>Online</Badge> : <Badge variant="info">Active</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{u.lastSeenAt ? formatRelative(u.lastSeenAt) : u.lastLoginAt ? formatRelative(u.lastLoginAt) : 'Never'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </section>
  );
}

function RoleInfo({ role, granted }) {
  const pagesBySection = new Map();
  for (const p of [...granted].flatMap((k) => PAGES_BY_PERMISSION.get(k) ?? [])) {
    const list = pagesBySection.get(p.section) ?? [];
    if (!list.some((x) => x.path === p.path)) pagesBySection.set(p.section, [...list, p]);
  }
  const rows = [
    ['Role code', <span key="c" className="font-mono">{role.code}</span>],
    ['Type', role.isSystem ? 'Built-in: part of the inspection, deviation and DN workflow' : 'Custom: grants permissions only, no workflow step'],
    ['Department', role.department],
    ['Can see lots of', role.viewScope === 'ALL_PLANTS' ? 'All plants' : 'Own plant only'],
    ['Can act on lots of', role.actionScope === 'ALL' ? 'Any plant' : 'Assigned plant only'],
    ['Plant required', role.requiresPlant ? 'Yes: each user gets it for a plant' : 'No'],
    ['Status', role.isActive ? 'Active' : 'Inactive'],
    ['Users', role.userCount],
    ['Created', formatDate(role.createdAt)],
    ['Last updated', `${formatDate(role.updatedAt)} by ${role.updatedByName ?? 'System (setup)'}`],
  ];
  return (
    <div className="grid gap-4 xl:grid-cols-2 items-start">
      <section className="card">
        <h3 className="px-4 pt-3.5 pb-2 text-sm font-bold text-slate-900">Role details</h3>
        <dl className="px-4 pb-4 space-y-2">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[9rem_1fr] gap-2 text-sm"><dt className="text-slate-500">{k}</dt><dd className="text-slate-900">{v}</dd></div>
          ))}
        </dl>
      </section>
      <section className="card">
        <h3 className="px-4 pt-3.5 pb-2 text-sm font-bold text-slate-900">Menu this role sees</h3>
        {pagesBySection.size === 0 ? <p className="px-4 pb-4 text-sm text-slate-500">No pages: this role cannot open anything.</p> : (
          <div className="px-4 pb-4 grid gap-3 sm:grid-cols-2">
            {[...pagesBySection.entries()].map(([section, list]) => (
              <div key={section}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{section}</p>
                <ul className="mt-1 space-y-0.5">
                  {list.map((p) => <li key={p.path}><Link to={p.path} className="inline-flex items-center gap-1 text-sm text-slate-700 hover:text-blue-700">{p.label}<ExternalLink className="w-3 h-3 text-slate-300" /></Link></li>)}
                </ul>
              </div>
            ))}
          </div>
        )}
        <p className="px-4 pb-4 text-xs text-slate-500">Actions inside pages (approve, hold, decide…) follow the permissions and the plant of the user's role.</p>
      </section>
    </div>
  );
}

/** Every role against every permission, read-only; click a role to open it. */
function Matrix({ roles, permissions, onPick }) {
  const modules = [...new Set(permissions.map((p) => p.module))];
  return (
    <div className="p-4 sm:p-5">
      <div className="card overflow-auto max-h-[calc(100dvh-11rem)]">
        <table className="text-xs border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-600 border-b border-r border-slate-200 min-w-72">Permission</th>
              {roles.map((r) => (
                <th key={r.code} className="sticky top-0 z-10 bg-slate-50 px-1 py-2 border-b border-slate-200 align-bottom">
                  <button type="button" onClick={() => onPick(r.code)} title={`${r.name}: open`} className={`h-32 w-8 cursor-pointer hover:text-blue-700 [writing-mode:vertical-rl] rotate-180 text-left font-medium whitespace-nowrap ${r.isActive ? 'text-slate-700' : 'text-slate-400 line-through'}`}>
                    {r.name}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => <MatrixRows key={m} module={m} perms={permissions.filter((p) => p.module === m)} roles={roles} />)}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">Changes are made on a role's own page (click its name). System Admin always has everything.</p>
    </div>
  );
}

function MatrixRows({ module, perms, roles }) {
  return (
    <>
      <tr>
        <td colSpan={roles.length + 1} className="sticky left-0 bg-white px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{module}</td>
      </tr>
      {perms.map((p) => (
        <tr key={p.key} className="hover:bg-blue-50/40">
          <td className="sticky left-0 z-10 bg-white px-3 py-1.5 border-r border-slate-100 text-slate-700" title={p.key}>{p.description}</td>
          {roles.map((r) => {
            const has = r.code === ROLES.SYSTEM_ADMIN || r.permissions.includes(p.key);
            return (
              <td key={r.code} className="text-center border-b border-slate-50">
                {has ? <Check className="w-3.5 h-3.5 mx-auto text-emerald-600" aria-label="yes" /> : <Minus className="w-3 h-3 mx-auto text-slate-200" aria-label="no" />}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
