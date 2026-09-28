import { ROLES } from '@qmas/shared';
import { ArrowUpDown, Check, ChevronDown, Crown, FileText, KeyRound, Minus, Save, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useSetRolePermissionsMutation } from '../../api/adminApi.js';
import Button from '../../components/ui/Button.jsx';
import { apiError } from '../../utils/apiError.js';
import { deptTone, MODULE_LOOK, PAGES_BY_PERMISSION } from './roleLook.js';

/**
 * Every permission against every role. The selected role's column is editable (tick boxes); a click
 * on another role's column selects that role. Modules group the rows and fold. `compare` limits the
 * columns to some roles, `onlyDiff` keeps the rows where they differ. Changes are saved together.
 */
export default function RoleMatrix({ roles, permissions, role, editable, onSelect, onDetails, onDirty, search = '', compare = null, onlyDiff = false }) {
  const isAdmin = (r) => r.code === ROLES.SYSTEM_ADMIN;
  const initial = useMemo(() => new Set(isAdmin(role) ? permissions.map((p) => p.key) : role.permissions), [role, permissions]);
  const [granted, setGranted] = useState(initial);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [sortAsc, setSortAsc] = useState(null); // null: catalogue order; true / false: by name
  const [save, { isLoading }] = useSetRolePermissionsMutation();
  const added = [...granted].filter((k) => !initial.has(k)).length;
  const removed = [...initial].filter((k) => !granted.has(k)).length;
  const dirty = added + removed > 0;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setGranted(initial);
  }

  const columns = compare?.length ? roles.filter((r) => compare.includes(r.code) || r.code === role.code) : roles;
  const has = (r, key) => (r.code === role.code ? granted.has(key) : isAdmin(r) || r.permissions.includes(key));
  const needle = search.trim().toLowerCase();
  const modules = useMemo(() => {
    const m = new Map();
    for (const p of permissions) {
      if (needle && !`${p.description} ${p.key} ${p.module}`.toLowerCase().includes(needle)) continue;
      m.set(p.module, [...(m.get(p.module) ?? []), p]);
    }
    return [...m.entries()].map(([mod, perms]) => [mod, sortAsc === null ? perms : [...perms].sort((a, b) => a.description.localeCompare(b.description) * (sortAsc ? 1 : -1))]);
  }, [permissions, needle, sortAsc]);
  const differs = (key) => new Set(columns.map((r) => has(r, key))).size > 1;
  const toggle = (key) => setGranted((g) => { const n = new Set(g); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const submit = async () => {
    try {
      await save({ code: role.code, permissions: [...granted] }).unwrap();
      toast.success(`${role.name} updated. Users with this role get the change on their next click.`);
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  const colCls = (r) => (r.code === role.code ? 'bg-blue-50/70 border-x-2 border-blue-400' : '');
  const rowCount = modules.reduce((n, [, perms]) => n + perms.filter((p) => !onlyDiff || differs(p.key)).length, 0);

  return (
    <section className="card min-w-0 flex flex-col">
      <div className="flex flex-wrap items-start gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-slate-900">Permissions <span className="font-medium text-slate-400">({permissions.length})</span></h2>
          <p className="text-xs text-slate-500">
            {editable ? `Click a cell in the ${role.name} column to grant or revoke; click another role's column to select it.` : `Click a role's column to select it.${isAdmin(role) ? ' System Admin always has every permission.' : ''}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5"><span className="w-5 h-5 rounded-md bg-emerald-50 text-emerald-600 flex items-center justify-center"><Check className="w-3.5 h-3.5" /></span>Allowed</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-5 h-5 rounded-md bg-slate-100 text-slate-400 flex items-center justify-center"><Minus className="w-3.5 h-3.5" /></span>Not allowed</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-5 h-5 rounded-md border-2 border-blue-400 bg-blue-50 text-blue-600 flex items-center justify-center"><Check className="w-3 h-3" /></span>Selected role</span>
          {onDetails && <Button size="sm" variant="secondary" icon={FileText} onClick={onDetails}>Role details</Button>}
        </div>
      </div>

      <div className="overflow-auto border-t border-slate-100 max-h-[calc(100dvh-var(--page-header-h,0px)-10rem)]">
        <table className="text-sm border-separate border-spacing-0 min-w-full">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 bg-white border-b border-slate-200 px-4 py-2 text-left align-bottom min-w-80">
                <button type="button" onClick={() => setSortAsc(sortAsc === null ? true : sortAsc ? false : null)} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 cursor-pointer">
                  Permission<ArrowUpDown className="w-3 h-3 text-slate-400" />
                </button>
              </th>
              {columns.map((r) => {
                const on = r.code === role.code;
                return (
                  <th key={r.code} className={`sticky top-0 z-20 border-b border-slate-200 px-1 py-2 align-bottom ${on ? 'bg-blue-50 border-x-2 border-t-2 border-blue-400 rounded-t-lg' : 'bg-white'}`}>
                    <button type="button" onClick={() => onSelect(r.code)} title={`${r.name}${r.isActive ? '' : ' (inactive)'} · ${r.permissions.length === 0 && !isAdmin(r) ? 'no' : isAdmin(r) ? 'all' : r.permissions.length} permissions`}
                      className="w-20 flex flex-col items-center gap-1 cursor-pointer">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${on ? 'bg-blue-600 text-white' : deptTone(r.department)}`}>{isAdmin(r) ? <Crown className="w-4 h-4" /> : <UserRound className="w-4 h-4" />}</span>
                      <span className={`text-[11px] leading-tight text-center font-medium ${on ? 'text-blue-800' : r.isActive ? 'text-slate-700' : 'text-slate-400 line-through'}`}>{r.name}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {modules.map(([module, perms]) => {
              const [Icon, tile, tint] = MODULE_LOOK[module] ?? [KeyRound, 'bg-slate-100 text-slate-700', 'bg-slate-50'];
              const rows = perms.filter((p) => !onlyDiff || differs(p.key));
              if (!rows.length) return null;
              const open = !collapsed.has(module);
              return [
                <tr key={`m-${module}`}>
                  <td colSpan={columns.length + 1} className={`sticky left-0 px-0 py-0 border-b border-slate-100 ${tint}`}>
                    <button type="button" onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(module)) n.delete(module); else n.add(module); return n; })} aria-expanded={open}
                      className="sticky left-0 flex items-center gap-2 px-4 py-2 text-left cursor-pointer">
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${tile}`}><Icon className="w-4 h-4" /></span>
                      <span className="text-sm font-bold text-slate-900">{module}</span>
                      <span className="text-xs text-slate-500">({perms.length})</span>
                      <span className="text-[11px] text-slate-500">· {role.name}: {perms.filter((p) => granted.has(p.key)).length}/{perms.length}</span>
                      <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? '' : '-rotate-90'}`} />
                    </button>
                  </td>
                </tr>,
                ...(open ? rows.map((p) => {
                  const opens = PAGES_BY_PERMISSION.get(p.key) ?? [];
                  const changed = granted.has(p.key) !== initial.has(p.key);
                  return (
                    <tr key={p.key} className="group">
                      <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 border-b border-slate-100 px-4 py-2 min-w-80 max-w-md" title={`${p.key}${opens.length ? ` · opens ${opens.map((o) => o.label).join(', ')}` : ''}`}>
                        <span className="text-slate-800">{p.description}</span>
                        {changed && <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800">{granted.has(p.key) ? 'ADDED' : 'REMOVED'}</span>}
                        {compare?.length > 0 && differs(p.key) && <span className="ml-1.5 rounded bg-violet-50 px-1 text-[10px] font-semibold text-violet-700">differs</span>}
                      </td>
                      {columns.map((r) => {
                        const on = r.code === role.code;
                        const yes = has(r, p.key);
                        return (
                          <td key={r.code} className={`border-b border-slate-100 text-center py-1.5 group-hover:bg-slate-50/80 ${colCls(r)}`}>
                            {on ? (
                              <input type="checkbox" checked={yes} disabled={!editable} onChange={() => toggle(p.key)} aria-label={`${role.name}: ${p.description}`}
                                className="w-4.5 h-4.5 accent-blue-600 cursor-pointer disabled:cursor-default" />
                            ) : (
                              <button type="button" onClick={() => onSelect(r.code)} aria-label={`${r.name}: ${yes ? 'allowed' : 'not allowed'} (select ${r.name})`}
                                className={`w-6 h-6 rounded-md inline-flex items-center justify-center cursor-pointer ${yes ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' : 'text-slate-300 hover:bg-slate-100'}`}>
                                {yes ? <Check className="w-4 h-4" /> : <Minus className="w-3.5 h-3.5" />}
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                }) : []),
              ];
            })}
            {!rowCount && <tr><td colSpan={columns.length + 1} className="px-4 py-10 text-center text-sm text-slate-500">{onlyDiff ? 'These roles have the same permissions.' : `No permission matches “${search}”.`}</td></tr>}
          </tbody>
        </table>
      </div>

      {editable && dirty && (
        <div className="fixed bottom-0 right-0 left-0 lg:left-auto z-30 flex justify-end px-5 py-3 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-slate-200 bg-white/95 backdrop-blur px-4 py-2.5 shadow-lg">
            <span className="text-xs font-medium text-amber-800">{role.name}: {added} added, {removed} removed</span>
            <Button variant="secondary" size="sm" icon={X} onClick={() => setGranted(initial)}>Cancel</Button>
            <Button size="sm" icon={Save} loading={isLoading} onClick={submit}>Save permissions</Button>
          </div>
        </div>
      )}
    </section>
  );
}
