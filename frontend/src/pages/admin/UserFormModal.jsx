import { PASSWORD_RULES_TEXT, userCreateSchema, userUpdateSchema } from '@qmas/shared';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useCreateUserMutation, useSetUserRolesMutation, useUpdateUserMutation } from '../../api/adminApi.js';
import { FormError, TextInput, Toggle } from '../../components/ui/fields.jsx';
import Modal, { ModalFooter } from '../../components/ui/Modal.jsx';
import { useZodForm } from '../../hooks/useZodForm.js';
import { apiError } from '../../utils/apiError.js';
import RoleAssignmentsEditor from './RoleAssignmentsEditor.jsx';

const toAssignments = (roles = []) => roles.map((r) => ({ roleCode: r.roleCode, plantId: r.plantId, validTo: r.validTo ? String(r.validTo).slice(0, 10) : null }));
const sameAssignments = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Create a user (with temporary password) or edit profile, status and roles. */
export default function UserFormModal({ user, lookups, onClose }) {
  const editing = !!user;
  const form = useZodForm(editing ? userUpdateSchema : userCreateSchema, {
    employeeCode: user?.employeeCode ?? '',
    fullName: user?.fullName ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    temporaryPassword: '',
    isActive: user?.isActive ?? true,
  });
  const initialRoles = toAssignments(user?.roles);
  const [roles, setRoles] = useState(initialRoles);
  const [formError, setFormError] = useState('');
  const [createUser, createState] = useCreateUserMutation();
  const [updateUser, updateState] = useUpdateUserMutation();
  const [setUserRoles, rolesState] = useSetUserRolesMutation();

  const save = async () => {
    setFormError('');
    const data = form.validate(editing ? { rowVersion: user.rowVersion } : { roles });
    if (!data) return;
    try {
      if (!editing) {
        await createUser(data).unwrap();
        toast.success(`User ${data.employeeCode} created. Give them the temporary password; they must change it at first sign-in.`);
      } else {
        const { employeeCode: _code, temporaryPassword: _pw, ...profile } = data;
        const updated = await updateUser({ id: user.id, ...profile }).unwrap();
        if (!sameAssignments(roles, initialRoles)) {
          await setUserRoles({ id: user.id, roles, rowVersion: updated.rowVersion }).unwrap();
        }
        toast.success('User saved');
      }
      onClose();
    } catch (err) {
      const { message, fieldErrors } = apiError(err);
      form.setServerErrors(fieldErrors);
      setFormError(message);
    }
  };

  const roleErrors = Object.fromEntries(Object.entries(form.errors).filter(([k]) => k.startsWith('roles.')));
  const saving = createState.isLoading || updateState.isLoading || rolesState.isLoading;

  return (
    <Modal
      title={editing ? `Edit ${user.fullName}` : 'Add user'}
      subtitle={editing ? user.employeeCode : 'The user signs in with the temporary password and must change it.'}
      onClose={onClose}
      size="lg"
      footer={<ModalFooter onCancel={onClose} onSave={save} saving={saving} saveLabel={editing ? 'Save changes' : 'Create user'} />}
    >
      <FormError message={formError} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput
          label="Employee code"
          required
          disabled={editing}
          autoCapitalize="characters"
          value={form.values.employeeCode}
          onChange={(e) => form.set('employeeCode', e.target.value)}
          error={form.error('employeeCode')}
        />
        <TextInput label="Full name" required value={form.values.fullName} onChange={(e) => form.set('fullName', e.target.value)} error={form.error('fullName')} />
        <TextInput label="Email" type="email" value={form.values.email ?? ''} onChange={(e) => form.set('email', e.target.value)} error={form.error('email')} hint="Used for workflow notifications." />
        <TextInput label="Phone" type="tel" value={form.values.phone ?? ''} onChange={(e) => form.set('phone', e.target.value)} error={form.error('phone')} />
        {!editing && (
          <TextInput
            label="Temporary password"
            required
            type="text"
            autoComplete="off"
            value={form.values.temporaryPassword}
            onChange={(e) => form.set('temporaryPassword', e.target.value)}
            error={form.error('temporaryPassword')}
            hint={PASSWORD_RULES_TEXT}
          />
        )}
        {editing && (
          <div className="sm:col-span-2">
            <Toggle
              label="Active"
              description="Deactivating signs the user out everywhere at once. History stays."
              checked={form.values.isActive}
              onChange={(v) => form.set('isActive', v)}
            />
          </div>
        )}
      </div>

      <h3 className="mt-6 mb-2 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">Roles</h3>
      <RoleAssignmentsEditor value={roles} onChange={setRoles} roles={lookups?.roles} plants={lookups?.plants} errors={roleErrors} />
    </Modal>
  );
}
