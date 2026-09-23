import { PERMISSIONS, ROLES } from '@qmas/shared';
import { ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useGetPermissionsQuery, useGetRolesQuery, useSetRolePermissionsMutation } from '../../api/adminApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Loader from '../../components/ui/Loader.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { apiError } from '../../utils/apiError.js';

/** Roles on the left; the selected role's permissions, grouped by module, on the right. */
export default function RolesPage() {
  const { can } = useAccess();
  const { data: roles, isLoading } = useGetRolesQuery();
  const { data: permissions } = useGetPermissionsQuery();
  const [selected, setSelected] = useState(null);

  if (isLoading || !roles || !permissions) return <Loader />;
  const role = roles.find((r) => r.code === (selected ?? roles[1]?.code ?? roles[0].code));

  return (
    <div>
      <PageHeader icon={ShieldCheck} title="Roles & Permissions" subtitle="What each role can see and do. Plant limits come from each user's role assignment." />
      <div className="p-5 grid gap-5 lg:grid-cols-[320px_1fr]">
        <ul className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 h-fit" aria-label="Roles">
          {roles.map((r) => (
            <li key={r.code}>
              <button
                type="button"
                onClick={() => setSelected(r.code)}
                aria-current={r.code === role.code}
                className={`w-full text-left px-4 py-3 cursor-pointer transition-colors ${r.code === role.code ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm font-semibold ${r.code === role.code ? 'text-blue-700' : 'text-slate-700'}`}>{r.name}</span>
                  <span className="text-xs text-slate-400 tabular">{r.userCount} user{r.userCount === 1 ? '' : 's'}</span>
                </div>
                <div className="text-xs text-slate-400">{r.department} · {r.permissions.length} permissions</div>
              </button>
            </li>
          ))}
        </ul>
        <RolePermissions key={role.code} role={role} permissions={permissions} editable={can(PERMISSIONS.ROLES_MANAGE) && role.code !== ROLES.SYSTEM_ADMIN} />
      </div>
    </div>
  );
}

function RolePermissions({ role, permissions, editable }) {
  const [granted, setGranted] = useState(() => new Set(role.permissions));
  const [save, { isLoading }] = useSetRolePermissionsMutation();
  const dirty = granted.size !== role.permissions.length || role.permissions.some((p) => !granted.has(p));
  const modules = useMemo(() => {
    const m = new Map();
    for (const p of permissions) m.set(p.module, [...(m.get(p.module) ?? []), p]);
    return [...m.entries()];
  }, [permissions]);

  const toggle = (key) =>
    setGranted((g) => {
      const next = new Set(g);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const submit = async () => {
    try {
      await save({ code: role.code, permissions: [...granted] }).unwrap();
      toast.success(`${role.name} updated. Users with this role get the change on their next action.`);
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-slate-100">
        <div>
          <h2 className="text-base font-bold text-slate-800">{role.name}</h2>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge variant="info" dot={false}>Sees: {role.viewScope === 'ALL_PLANTS' ? 'all plants' : 'own plant only'}</Badge>
            <Badge variant="info" dot={false}>Acts on: {role.actionScope === 'ALL' ? 'any plant' : 'assigned plant'}</Badge>
            {role.requiresPlant && <Badge variant="neutral" dot={false}>Plant required</Badge>}
          </div>
        </div>
        {editable && (
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => setGranted(new Set(role.permissions))}>Undo changes</Button>
            <Button size="sm" disabled={!dirty} loading={isLoading} onClick={submit}>Save</Button>
          </div>
        )}
      </div>
      {!editable && role.code === ROLES.SYSTEM_ADMIN && <p className="px-5 pt-4 text-sm text-slate-500">System Admin always holds every permission.</p>}
      <div className="p-5 grid gap-5 md:grid-cols-2">
        {modules.map(([module, perms]) => (
          <fieldset key={module}>
            <legend className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">{module}</legend>
            <ul className="space-y-1.5">
              {perms.map((p) => (
                <li key={p.key}>
                  <label className={`flex items-start gap-2.5 text-sm ${editable ? 'cursor-pointer' : ''}`}>
                    <input type="checkbox" className="mt-1 accent-blue-600 w-4 h-4" checked={granted.has(p.key)} disabled={!editable} onChange={() => toggle(p.key)} />
                    <span>
                      <span className="text-slate-700">{p.description}</span>
                      <span className="block text-[11px] text-slate-400 font-mono">{p.key}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
      </div>
    </section>
  );
}
