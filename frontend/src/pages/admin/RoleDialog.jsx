import { useId, useState } from 'react';
import toast from 'react-hot-toast';
import { useCreateRoleMutation, useUpdateRoleMutation } from '../../api/adminApi.js';
import Modal, { ModalFooter } from '../../components/ui/Modal.jsx';
import { FormError, Select, TextArea, TextInput, Toggle } from '../../components/ui/fields.jsx';
import { apiError } from '../../utils/apiError.js';

const VIEW = [{ value: 'OWN_PLANT', label: 'Own plant only' }, { value: 'ALL_PLANTS', label: 'All plants' }];
const ACT = [{ value: 'PLANT', label: 'Assigned plant only' }, { value: 'ALL', label: 'Any plant' }];

/**
 * Add, duplicate or edit a role. mode: 'add' | 'duplicate' (source = role to copy) | 'edit' (source =
 * the role). Built-in roles can only change their description: the rest drives the workflow.
 */
export default function RoleDialog({ mode, source, departments, onClose, onSaved }) {
  const builtIn = mode === 'edit' && source.isSystem;
  const [form, setForm] = useState(() => {
    if (mode === 'add') return { name: '', description: '', department: '', viewScope: 'OWN_PLANT', actionScope: 'PLANT', requiresPlant: true, isActive: true };
    return {
      name: mode === 'duplicate' ? `${source.name} (copy)` : source.name,
      description: source.description ?? '',
      department: source.department,
      viewScope: source.viewScope,
      actionScope: source.actionScope,
      requiresPlant: source.requiresPlant,
      isActive: source.isActive,
    };
  });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState('');
  const [create, { isLoading: creating }] = useCreateRoleMutation();
  const [update, { isLoading: updating }] = useUpdateRoleMutation();
  const listId = useId();
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));

  const save = async () => {
    setErrors({});
    setMessage('');
    try {
      let role;
      if (mode === 'edit') {
        const body = builtIn ? { description: form.description } : form;
        role = await update({ code: source.code, ...body }).unwrap();
        toast.success(`${role.name} saved.`);
      } else {
        const { isActive: _a, ...details } = form;
        role = await create({ ...details, ...(mode === 'duplicate' ? { copyFrom: source.code } : {}) }).unwrap();
        toast.success(mode === 'duplicate' ? `${role.name} added with the permissions of ${source.name}.` : `${role.name} added. Now choose its permissions.`);
      }
      onSaved(role);
    } catch (err) {
      const e = apiError(err);
      setErrors(e.fieldErrors);
      setMessage(e.message);
    }
  };

  const title = { add: 'Add role', duplicate: `Duplicate ${source?.name}`, edit: `Edit ${source?.name}` }[mode];
  const subtitle = builtIn
    ? 'Built-in role: its name, scope and workflow steps come from the application. You can change its description and permissions.'
    : mode === 'edit' ? 'Custom role: grants the permissions you choose, with no workflow step of its own.'
      : 'Custom roles grant the permissions you choose. Review, approval and escalation steps stay with the built-in roles.';

  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose}
      footer={<ModalFooter onCancel={onClose} onSave={save} saving={creating || updating} saveLabel={mode === 'edit' ? 'Save' : 'Add role'} />}>
      <div className="space-y-4">
        <FormError message={Object.keys(errors).length ? '' : message} />
        <TextInput label="Role name" required value={form.name} onChange={set('name')} error={errors.name} disabled={builtIn} maxLength={60} />
        <TextArea label="Description" value={form.description} onChange={set('description')} error={errors.description} rows={2} maxLength={200} placeholder="What people with this role do" />
        <TextInput label="Department" required value={form.department} onChange={set('department')} error={errors.department} disabled={builtIn} list={listId} maxLength={40} />
        <datalist id={listId}>{departments.map((d) => <option key={d} value={d} />)}</datalist>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Can see lots of" value={form.viewScope} onChange={set('viewScope')} options={VIEW} placeholder="Choose…" disabled={builtIn} error={errors.viewScope} />
          <Select label="Can act on lots of" value={form.actionScope} onChange={set('actionScope')} options={ACT} placeholder="Choose…" disabled={builtIn} error={errors.actionScope} />
        </div>
        {!builtIn && (
          <div className="space-y-3">
            <Toggle label="Plant required" description="Each user gets this role for a particular plant." checked={form.requiresPlant} onChange={set('requiresPlant')} />
            {mode === 'edit' && <Toggle label="Active" description="An inactive role gives its users nothing until it is active again." checked={form.isActive} onChange={set('isActive')} />}
          </div>
        )}
      </div>
    </Modal>
  );
}
