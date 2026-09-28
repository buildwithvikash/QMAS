import { PERMISSIONS } from '@qmas/shared';
import { CheckCircle2, Clock, Pause, Pencil, Plus, Power, Search } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useCreateMasterMutation, useGetLookupsQuery, useGetMasterListQuery, useUpdateMasterMutation } from '../../api/mastersApi.js';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { FormError, Select, TextInput, Toggle } from '../../components/ui/fields.jsx';
import Modal, { ConfirmDialog, ModalFooter } from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import PopMenu from '../../components/ui/PopMenu.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { useListParams } from '../../hooks/useListParams.js';
import { useZodForm } from '../../hooks/useZodForm.js';
import { apiError } from '../../utils/apiError.js';
import { formatRelative } from '../../utils/format.js';
import { MASTER_CONFIGS } from './masterConfigs.js';

// Row icon tiles cycle through a few soft colours, like the mockup's plant list.
const TILE = ['bg-blue-50 text-blue-600', 'bg-teal-50 text-teal-600', 'bg-violet-50 text-violet-600', 'bg-sky-50 text-sky-600'];

const StatusPill = ({ active }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
    <span className={`h-2 w-2 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-500'}`} />{active ? 'Active' : 'Inactive'}
  </span>
);

/** A count that also filters the list when clicked. */
function CountCard({ icon: Icon, tile, label, value, share, active, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`card flex items-center gap-4 px-5 py-4 text-left transition-shadow hover:shadow-md cursor-pointer ${active ? 'ring-2 ring-blue-500 border-transparent' : ''}`}>
      <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${tile}`}><Icon className="h-7 w-7" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-slate-600">{label}</span>
        <span className="block text-2xl font-bold leading-tight text-slate-900 tabular">{value ?? '—'}</span>
        {share !== undefined && (
          <span className="mt-1 flex items-center gap-2">
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-emerald-100"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${share}%` }} /></span>
            <span className="text-xs text-slate-500 tabular">{share}%</span>
          </span>
        )}
      </span>
    </button>
  );
}

/** List + add/edit for any simple master described in masterConfigs.js. */
export default function MasterListPage({ resource }) {
  const cfg = MASTER_CONFIGS[resource];
  const { can } = useAccess();
  const canManage = can(PERMISSIONS.MASTERS_MANAGE);
  const list = useListParams({ sort: cfg.defaultSort, storageKey: `masters-${resource}` });
  const { data, isFetching, error } = useGetMasterListQuery({ resource, ...list.params });
  // Counts for the cards (whatever the list shows).
  const { data: all } = useGetMasterListQuery({ resource, page: 1, pageSize: 1 });
  const { data: activeOnly } = useGetMasterListQuery({ resource, page: 1, pageSize: 1, isActive: true });
  const [editing, setEditing] = useState(null); // null | 'new' | row
  const [toggling, setToggling] = useState(null);
  const total = all?.meta?.total;
  const active = activeOnly?.meta?.total;
  const status = list.filters.isActive ?? '';
  const Icon = cfg.icon;
  const offset = ((data?.meta?.page ?? 1) - 1) * (data?.meta?.pageSize ?? 0);

  const columns = [
    { key: 'sr', header: '#', export: false, render: (row) => <span className="grid h-7 w-7 place-items-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">{offset + (data?.rows ?? []).indexOf(row) + 1}</span> },
    ...cfg.fields.filter((f) => f.list).map((f, i, listed) => ({
      key: f.sortKey ?? f.name,
      header: f.label,
      sortable: f.sortable || !!f.sortKey,
      text: (row) => row[f.listKey ?? f.name] ?? '',
      render: (row) => {
        const value = row[f.listKey ?? f.name];
        if (value === null || value === undefined || value === '') return <span className="text-slate-300">—</span>;
        // The first column is the key (bold); the name column gets the master's icon.
        if (i === 0) return <span className="font-semibold text-slate-900 tabular whitespace-nowrap">{value}</span>;
        if (i === listed.length - 1) {
          return (
            <span className="flex items-center gap-3">
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${TILE[(data?.rows ?? []).indexOf(row) % TILE.length]}`}><Icon className="h-4 w-4" /></span>
              <span className="text-slate-800">{value}</span>
            </span>
          );
        }
        return <span className="text-slate-700 tabular">{value}</span>;
      },
    })),
    ...(cfg.extraColumns ?? []),
    { key: 'isActive', header: 'Status', text: (row) => (row.isActive ? 'Active' : 'Inactive'), render: (row) => <StatusPill active={row.isActive} /> },
    { key: 'updatedAt', header: 'Updated', text: (row) => formatRelative(row.updatedAt), render: (row) => <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-500"><Clock className="h-3.5 w-3.5" />{formatRelative(row.updatedAt)}</span> },
    ...(canManage
      ? [{
          key: 'actions',
          header: 'Actions',
          export: false,
          align: 'center',
          render: (row) => (
            <span className="inline-flex items-center gap-1">
              <button type="button" aria-label={`Edit ${cfg.singular}`} title="Edit" onClick={() => setEditing(row)} className="p-2 rounded-lg text-blue-600 hover:bg-blue-50 cursor-pointer">
                <Pencil className="w-4 h-4" />
              </button>
              <PopMenu width="w-44" button={({ open, toggle }) => (
                <button type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={toggle} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer">
                  <span className="block h-4 w-4 text-center leading-4 font-bold">⋮</span>
                </button>
              )}>
                <button type="button" role="menuitem" data-close onClick={() => setEditing(row)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer"><Pencil className="h-4 w-4 text-slate-400" />Edit</button>
                <button type="button" role="menuitem" data-close onClick={() => setToggling(row)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm cursor-pointer ${row.isActive ? 'text-rose-600 hover:bg-rose-50' : 'text-emerald-700 hover:bg-emerald-50'}`}>
                  <Power className="h-4 w-4" />{row.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </PopMenu>
            </span>
          ),
        }]
      : []),
  ];

  const setStatus = (v) => list.setFilter('isActive', status === v ? undefined : v);

  return (
    <div>
      <PageHeader icon={cfg.icon} title={cfg.title} subtitle={cfg.subtitle} />
      <div className="p-5 space-y-4">
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.6fr)]">
          <CountCard icon={Icon} tile="bg-blue-50 text-blue-600" label={`Total ${cfg.title.toLowerCase()}`} value={total} active={status === ''} onClick={() => list.setFilter('isActive', undefined)} />
          <CountCard icon={CheckCircle2} tile="bg-emerald-50 text-emerald-600" label="Active" value={active} share={total ? Math.round(((active ?? 0) / total) * 100) : 0} active={status === 'true'} onClick={() => setStatus('true')} />
          <CountCard icon={Pause} tile="bg-rose-50 text-rose-600" label="Inactive" value={total !== undefined && active !== undefined ? total - active : undefined} active={status === 'false'} onClick={() => setStatus('false')} />
          <div className="card flex flex-wrap items-center gap-3 px-4 py-4 md:col-span-3 xl:col-span-1">
            <label className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={list.search} onChange={(e) => list.setSearch(e.target.value)} placeholder={cfg.searchPlaceholder ?? `Search ${cfg.title.toLowerCase()}…`} aria-label={`Search ${cfg.title.toLowerCase()}`}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
            </label>
            {canManage && <Button size="lg" icon={Plus} onClick={() => setEditing('new')}>Add {cfg.singular}</Button>}
          </div>
        </div>
        <DataTable tableId={`masters-${resource}`} columns={columns} rows={data?.rows} loading={isFetching} error={error} sort={list.sort} onSort={list.toggleSort}
          exportName={resource} empty={`No ${cfg.title.toLowerCase()} found.`}
          pagination={data?.meta && { meta: data.meta, onPage: list.setPage, onPageSize: list.setPageSize }} />
      </div>
      {editing && <MasterFormModal cfg={cfg} resource={resource} row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {toggling && <ToggleDialog cfg={cfg} resource={resource} row={toggling} onClose={() => setToggling(null)} />}
    </div>
  );
}

/** Activate / deactivate from the row menu (same save as the form, with only the status changed). */
function ToggleDialog({ cfg, resource, row, onClose }) {
  const [update, { isLoading }] = useUpdateMasterMutation();
  const activate = !row.isActive;
  const name = row.name ?? row.code ?? row.sapCode;
  const confirm = async () => {
    const parsed = cfg.updateSchema.safeParse({ ...Object.fromEntries(cfg.fields.map((f) => [f.name, row[f.name]])), isActive: activate, rowVersion: row.rowVersion });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'This entry needs editing first.');
      return;
    }
    try {
      await update({ resource, id: row.id, body: parsed.data }).unwrap();
      toast.success(`${name} ${activate ? 'activated' : 'deactivated'}`);
      onClose();
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  return (
    <ConfirmDialog
      title={`${activate ? 'Activate' : 'Deactivate'} ${cfg.singular}`}
      message={activate ? `${name} can be chosen for new records again.` : `${name} stays in history but cannot be chosen for new records.`}
      confirmLabel={activate ? 'Activate' : 'Deactivate'}
      variant={activate ? 'primary' : 'danger'}
      busy={isLoading}
      onConfirm={confirm}
      onCancel={onClose}
    />
  );
}

function MasterFormModal({ cfg, resource, row, onClose }) {
  const editing = !!row;
  const { data: lookups } = useGetLookupsQuery(undefined, { skip: !cfg.fields.some((f) => f.lookup) });
  const initial = Object.fromEntries(cfg.fields.map((f) => [f.name, row?.[f.name] ?? (f.type === 'select' ? null : '')]));
  const form = useZodForm(editing ? cfg.updateSchema : cfg.createSchema, { ...initial, isActive: row?.isActive ?? true });
  const [create, createState] = useCreateMasterMutation();
  const [update, updateState] = useUpdateMasterMutation();
  const [formError, setFormError] = useState('');

  const save = async () => {
    setFormError('');
    const body = form.validate(editing ? { rowVersion: row.rowVersion } : {});
    if (!body) return;
    try {
      if (editing) await update({ resource, id: row.id, body }).unwrap();
      else await create({ resource, body }).unwrap();
      toast.success(`${cfg.singular[0].toUpperCase()}${cfg.singular.slice(1)} ${editing ? 'saved' : 'added'}`);
      onClose();
    } catch (err) {
      const { message, fieldErrors } = apiError(err);
      form.setServerErrors(fieldErrors);
      setFormError(message);
    }
  };

  return (
    <Modal
      title={editing ? `Edit ${cfg.singular}` : `Add ${cfg.singular}`}
      onClose={onClose}
      footer={<ModalFooter onCancel={onClose} onSave={save} saving={createState.isLoading || updateState.isLoading} />}
    >
      <FormError message={formError} />
      <div className="grid gap-4 sm:grid-cols-2">
        {cfg.fields.map((f) =>
          f.type === 'select' ? (
            <Select
              key={f.name}
              label={f.label}
              required={f.required}
              value={form.values[f.name] ? String(form.values[f.name]) : ''}
              onChange={(v) => form.set(f.name, v ? Number(v) : null)}
              options={(lookups?.[f.lookup] ?? []).map((o) => ({ value: String(o.id), label: o.code ? `${o.code} · ${o.name}` : o.name }))}
              placeholder="None"
              error={form.error(f.name)}
              hint={f.hint}
            />
          ) : (
            <TextInput
              key={f.name}
              label={f.label}
              required={f.required}
              className={f.wide ? 'sm:col-span-2' : ''}
              disabled={editing && f.readOnlyOnEdit}
              inputMode={f.inputMode}
              autoCapitalize={f.type === 'code' ? 'characters' : undefined}
              value={form.values[f.name] ?? ''}
              onChange={(e) => form.set(f.name, f.type === 'code' ? e.target.value.toUpperCase() : e.target.value)}
              error={form.error(f.name)}
              hint={f.hint}
            />
          ),
        )}
        <div className="sm:col-span-2">
          <Toggle label="Active" description="Inactive entries stay in history but cannot be chosen for new records." checked={form.values.isActive} onChange={(v) => form.set('isActive', v)} />
        </div>
      </div>
    </Modal>
  );
}
