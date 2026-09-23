import { PERMISSIONS } from '@qmas/shared';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useCreateMasterMutation, useGetLookupsQuery, useGetMasterListQuery, useUpdateMasterMutation } from '../../api/mastersApi.js';
import { ActiveBadge } from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable, { Pagination } from '../../components/ui/DataTable.jsx';
import { FormError, Select, TextInput, Toggle } from '../../components/ui/fields.jsx';
import Modal, { ModalFooter } from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { useListParams } from '../../hooks/useListParams.js';
import { useZodForm } from '../../hooks/useZodForm.js';
import { apiError } from '../../utils/apiError.js';
import { formatRelative } from '../../utils/format.js';
import { MASTER_CONFIGS } from './masterConfigs.js';

/** List + add/edit for any simple master described in masterConfigs.js. */
export default function MasterListPage({ resource }) {
  const cfg = MASTER_CONFIGS[resource];
  const { can } = useAccess();
  const canManage = can(PERMISSIONS.MASTERS_MANAGE);
  const list = useListParams({ sort: cfg.defaultSort });
  const { data, isFetching, error } = useGetMasterListQuery({ resource, ...list.params });
  const [editing, setEditing] = useState(null); // null | 'new' | row

  const columns = [
    ...cfg.fields.filter((f) => f.list).map((f) => ({
      key: f.sortKey ?? f.name,
      header: f.label,
      sortable: f.sortable || !!f.sortKey,
      className: f.mono ? 'font-mono text-xs font-semibold text-slate-800 whitespace-nowrap' : '',
      render: (row) => row[f.listKey ?? f.name] ?? <span className="text-slate-300">—</span>,
    })),
    ...(cfg.extraColumns ?? []),
    { key: 'isActive', header: 'Status', render: (row) => <ActiveBadge active={row.isActive} /> },
    { key: 'updatedAt', header: 'Updated', render: (row) => <span className="text-xs text-slate-400 whitespace-nowrap">{formatRelative(row.updatedAt)}</span> },
    ...(canManage
      ? [{
          key: 'actions',
          header: '',
          render: (row) => (
            <button type="button" aria-label={`Edit ${cfg.singular}`} title="Edit" onClick={() => setEditing(row)} className="p-2 rounded-lg text-blue-500 hover:bg-blue-50 cursor-pointer">
              <Pencil className="w-4 h-4" />
            </button>
          ),
        }]
      : []),
  ];

  return (
    <div>
      <PageHeader icon={cfg.icon} title={cfg.title} subtitle={cfg.subtitle} search={list.search} onSearch={list.setSearch} searchPlaceholder={cfg.searchPlaceholder}>
        {canManage && <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>Add {cfg.singular}</Button>}
      </PageHeader>
      <div className="p-5">
        <div className="flex gap-3 mb-3">
          <Select className="w-44" aria-label="Status" placeholder="All statuses" value={list.filters.isActive ?? ''} onChange={(v) => list.setFilter('isActive', v)}
            options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]} />
        </div>
        <DataTable columns={columns} rows={data?.rows} loading={isFetching} error={error} sort={list.sort} onSort={list.toggleSort} empty={`No ${cfg.title.toLowerCase()} found.`} />
        <Pagination meta={data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </div>
      {editing && <MasterFormModal cfg={cfg} resource={resource} row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
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
