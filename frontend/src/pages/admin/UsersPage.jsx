import { PASSWORD_RULES_TEXT, PERMISSIONS, resetPasswordSchema } from '@qmas/shared';
import { KeyRound, LockOpen, Pencil, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useGetUserQuery, useGetUsersQuery, useResetPasswordMutation, useUnlockUserMutation } from '../../api/adminApi.js';
import { useGetLookupsQuery } from '../../api/mastersApi.js';
import Badge, { ActiveBadge } from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable, { Pagination } from '../../components/ui/DataTable.jsx';
import { FormError, Select, TextInput } from '../../components/ui/fields.jsx';
import Loader from '../../components/ui/Loader.jsx';
import Modal, { ConfirmDialog, ModalFooter } from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { useListParams } from '../../hooks/useListParams.js';
import { useZodForm } from '../../hooks/useZodForm.js';
import { apiError } from '../../utils/apiError.js';
import { formatDateTime, formatRelative } from '../../utils/format.js';
import UserFormModal from './UserFormModal.jsx';

const isLocked = (u) => u.lockedUntil && new Date(u.lockedUntil) > new Date();

export default function UsersPage() {
  const { can } = useAccess();
  const canManage = can(PERMISSIONS.USERS_MANAGE);
  const list = useListParams({ sort: 'employeeCode' });
  const { data, isFetching, error } = useGetUsersQuery(list.params);
  const { data: lookups } = useGetLookupsQuery();
  const [modal, setModal] = useState(null); // { type: 'create' | 'edit' | 'reset' | 'unlock', user }
  const close = () => setModal(null);

  const columns = [
    { key: 'employeeCode', header: 'Employee code', sortable: true, className: 'font-semibold text-slate-800 whitespace-nowrap' },
    {
      key: 'fullName',
      header: 'Name',
      sortable: true,
      render: (u) => (
        <div>
          <div className="text-slate-800">{u.fullName}</div>
          {u.email && <div className="text-xs text-slate-400">{u.email}</div>}
        </div>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      render: (u) =>
        u.roles.length ? (
          <div className="flex flex-wrap gap-1">
            {u.roles.map((r) => (
              <Badge key={`${r.roleCode}-${r.plantId}`} variant="primary" dot={false}>
                {r.roleName}
                {r.plantSapCode ? ` · ${r.plantSapCode}` : ''}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-xs text-slate-400">No role</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (u) => (
        <div className="flex flex-wrap gap-1">
          <ActiveBadge active={u.isActive} />
          {isLocked(u) && <Badge variant="danger">Locked</Badge>}
          {u.mustChangePassword && <Badge variant="warning">Temporary password</Badge>}
        </div>
      ),
    },
    { key: 'lastLoginAt', header: 'Last sign-in', sortable: true, render: (u) => <span title={formatDateTime(u.lastLoginAt)}>{u.lastLoginAt ? formatRelative(u.lastLoginAt) : 'Never'}</span> },
    ...(canManage
      ? [{
          key: 'actions',
          header: '',
          render: (u) => (
            <div className="flex justify-end gap-1">
              {isLocked(u) && <IconButton label="Unlock" icon={LockOpen} tone="amber" onClick={() => setModal({ type: 'unlock', user: u })} />}
              <IconButton label="Reset password" icon={KeyRound} tone="slate" onClick={() => setModal({ type: 'reset', user: u })} />
              <IconButton label="Edit" icon={Pencil} tone="blue" onClick={() => setModal({ type: 'edit', user: u })} />
            </div>
          ),
        }]
      : []),
  ];

  const roleOptions = (lookups?.roles ?? []).map((r) => ({ value: r.code, label: r.name }));
  const plantOptions = (lookups?.plants ?? []).map((p) => ({ value: String(p.id), label: `${p.sapCode} · ${p.name}` }));

  return (
    <div>
      <PageHeader icon={Users} title="Users" subtitle="QMAS accounts, roles and plant assignments" search={list.search} onSearch={list.setSearch} searchPlaceholder="Search code, name, email…">
        {canManage && <Button size="sm" icon={Plus} onClick={() => setModal({ type: 'create' })}>Add user</Button>}
      </PageHeader>

      <div className="p-5">
        <div className="flex flex-wrap gap-3 mb-3">
          <Select className="w-44" aria-label="Status" placeholder="All statuses" value={list.filters.isActive ?? ''} onChange={(v) => list.setFilter('isActive', v)}
            options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]} />
          <Select className="w-56" aria-label="Role" placeholder="All roles" value={list.filters.roleCode ?? ''} onChange={(v) => list.setFilter('roleCode', v)} options={roleOptions} />
          <Select className="w-56" aria-label="Plant" placeholder="All plants" value={list.filters.plantId ?? ''} onChange={(v) => list.setFilter('plantId', v)} options={plantOptions} />
        </div>
        <DataTable columns={columns} rows={data?.rows} loading={isFetching} error={error} sort={list.sort} onSort={list.toggleSort} empty="No users match these filters." />
        <Pagination meta={data?.meta} onPage={list.setPage} onPageSize={list.setPageSize} />
      </div>

      {modal?.type === 'create' && <UserFormModal lookups={lookups} onClose={close} />}
      {modal?.type === 'edit' && <EditUser id={modal.user.id} lookups={lookups} onClose={close} />}
      {modal?.type === 'reset' && <ResetPasswordModal user={modal.user} onClose={close} />}
      {modal?.type === 'unlock' && <UnlockDialog user={modal.user} onClose={close} />}
    </div>
  );
}

function IconButton({ label, icon: Icon, tone, onClick }) {
  const tones = { blue: 'text-blue-500 hover:bg-blue-50', slate: 'text-slate-500 hover:bg-slate-100', amber: 'text-amber-600 hover:bg-amber-50' };
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className={`p-2 rounded-lg transition-colors cursor-pointer ${tones[tone]}`}>
      <Icon className="w-4 h-4" />
    </button>
  );
}

/** Loads the full user (roles with end dates, current rowVersion) before editing. */
function EditUser({ id, lookups, onClose }) {
  const { data, isFetching } = useGetUserQuery(id, { refetchOnMountOrArgChange: true });
  if (!data || isFetching) {
    return (
      <Modal title="Edit user" onClose={onClose} size="sm">
        <Loader />
      </Modal>
    );
  }
  return <UserFormModal user={data} lookups={lookups} onClose={onClose} />;
}

function generatePassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  const chars = [...bytes].map((b, i) => (i % 4 === 3 ? digits[b % digits.length] : letters[b % letters.length]));
  return chars.join('');
}

function ResetPasswordModal({ user, onClose }) {
  const form = useZodForm(resetPasswordSchema, { temporaryPassword: generatePassword() });
  const [reset, { isLoading, error }] = useResetPasswordMutation();
  const save = async () => {
    const data = form.validate();
    if (!data) return;
    try {
      await reset({ id: user.id, ...data }).unwrap();
      toast.success(`Password reset. ${user.fullName} must change it at next sign-in.`);
      onClose();
    } catch (err) {
      form.setServerErrors(apiError(err).fieldErrors);
    }
  };
  return (
    <Modal title={`Reset password for ${user.fullName}`} subtitle={user.employeeCode} onClose={onClose} size="sm"
      footer={<ModalFooter onCancel={onClose} onSave={save} saving={isLoading} saveLabel="Reset password" saveVariant="danger" />}>
      <FormError message={error && !Object.keys(apiError(error).fieldErrors).length ? apiError(error).message : ''} />
      <p className="text-sm text-slate-600 mb-4">The user is signed out everywhere and must choose a new password with this temporary one.</p>
      <TextInput label="Temporary password" value={form.values.temporaryPassword} onChange={(e) => form.set('temporaryPassword', e.target.value)} error={form.error('temporaryPassword')} hint={PASSWORD_RULES_TEXT} className="font-mono" />
      <button type="button" onClick={() => form.set('temporaryPassword', generatePassword())} className="mt-2 text-xs font-semibold text-blue-600 hover:underline cursor-pointer">Generate another</button>
    </Modal>
  );
}

function UnlockDialog({ user, onClose }) {
  const [unlock, { isLoading }] = useUnlockUserMutation();
  const confirm = async () => {
    try {
      await unlock(user.id).unwrap();
      toast.success(`${user.fullName} can sign in again`);
      onClose();
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  return (
    <ConfirmDialog
      title="Unlock account"
      message={`${user.fullName} was locked after too many failed sign-in attempts (until ${formatDateTime(user.lockedUntil)}). Unlock now?`}
      confirmLabel="Unlock"
      variant="primary"
      onConfirm={confirm}
      onCancel={onClose}
      busy={isLoading}
    />
  );
}
