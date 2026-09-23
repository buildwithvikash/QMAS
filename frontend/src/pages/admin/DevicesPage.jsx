import { deviceCreateSchema } from '@qmas/shared';
import { Plus, Tablet } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useCreateDeviceMutation, useGetDevicesQuery, useUpdateDeviceMutation } from '../../api/imirApi.js';
import { useGetLookupsQuery } from '../../api/mastersApi.js';
import { ActiveBadge } from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { FormError, Select, TextInput } from '../../components/ui/fields.jsx';
import Modal, { ConfirmDialog, ModalFooter } from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useZodForm } from '../../hooks/useZodForm.js';
import { apiError } from '../../utils/apiError.js';
import { formatRelative } from '../../utils/format.js';

/** Tablets used for inspection. Deactivating a lost tablet releases every lot it held. */
export default function DevicesPage() {
  const { data, isFetching, error } = useGetDevicesQuery();
  const [adding, setAdding] = useState(false);
  const [toggling, setToggling] = useState(null);
  const columns = [
    { key: 'deviceCode', header: 'Device code', className: 'font-mono text-xs font-semibold' },
    { key: 'name', header: 'Name' },
    { key: 'plant', header: 'Plant', render: (d) => `${d.plantSapCode} · ${d.plantName}` },
    { key: 'checkedOut', header: 'Lots on it', align: 'right' },
    { key: 'lastSeenAt', header: 'Last seen', render: (d) => (d.lastSeenAt ? `${formatRelative(d.lastSeenAt)}${d.lastUserName ? ` · ${d.lastUserName}` : ''}` : 'never') },
    { key: 'isActive', header: 'Status', render: (d) => <ActiveBadge active={d.isActive} /> },
    { key: 'actions', header: '', render: (d) => <Button size="sm" variant="ghost" onClick={() => setToggling(d)}>{d.isActive ? 'Deactivate' : 'Activate'}</Button> },
  ];
  return (
    <div>
      <PageHeader icon={Tablet} title="Tablets" subtitle="Registered inspection tablets. Inspectors enter the device code once on the tablet.">
        <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>Register tablet</Button>
      </PageHeader>
      <div className="p-5"><DataTable columns={columns} rows={data} loading={isFetching} error={error} empty="No tablets registered yet." /></div>
      {adding && <AddDevice onClose={() => setAdding(false)} />}
      {toggling && <ToggleDevice device={toggling} onClose={() => setToggling(null)} />}
    </div>
  );
}

function AddDevice({ onClose }) {
  const { data: lookups } = useGetLookupsQuery();
  const form = useZodForm(deviceCreateSchema, { deviceCode: '', name: '', plantId: null });
  const [create, { isLoading, error }] = useCreateDeviceMutation();
  const save = async () => {
    const data = form.validate();
    if (!data) return;
    try {
      const d = await create(data).unwrap();
      toast.success(`Registered ${d.deviceCode}. Enter this code on the tablet (This tablet → Set up).`);
      onClose();
    } catch (err) {
      form.setServerErrors(apiError(err).fieldErrors);
    }
  };
  return (
    <Modal title="Register tablet" onClose={onClose} size="sm" footer={<ModalFooter onCancel={onClose} onSave={save} saving={isLoading} saveLabel="Register" />}>
      <FormError message={error && !Object.keys(apiError(error).fieldErrors).length ? apiError(error).message : ''} />
      <div className="space-y-4">
        <TextInput label="Device code" required value={form.values.deviceCode} onChange={(e) => form.set('deviceCode', e.target.value.toUpperCase())} error={form.error('deviceCode')} hint="Write it on a label on the tablet, e.g. TAB-SJN-01" />
        <TextInput label="Name" required value={form.values.name} onChange={(e) => form.set('name', e.target.value)} error={form.error('name')} placeholder="Stores tablet 1" />
        <Select label="Plant" required value={form.values.plantId ? String(form.values.plantId) : ''} onChange={(v) => form.set('plantId', v ? Number(v) : null)} error={form.error('plantId')}
          options={(lookups?.plants ?? []).filter((p) => p.isActive).map((p) => ({ value: String(p.id), label: `${p.sapCode} · ${p.name}` }))} />
      </div>
    </Modal>
  );
}

function ToggleDevice({ device, onClose }) {
  const [update, { isLoading }] = useUpdateDeviceMutation();
  const confirm = async () => {
    try {
      await update({ id: device.id, isActive: !device.isActive, rowVersion: device.rowVersion }).unwrap();
      toast.success(device.isActive ? 'Tablet deactivated' : 'Tablet activated');
      onClose();
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  return (
    <ConfirmDialog title={device.isActive ? 'Deactivate tablet' : 'Activate tablet'} variant={device.isActive ? 'danger' : 'primary'} busy={isLoading}
      confirmLabel={device.isActive ? 'Deactivate' : 'Activate'} onConfirm={confirm} onCancel={onClose}
      message={device.isActive
        ? `${device.deviceCode} can no longer sync, and the ${device.checkedOut} lot(s) on it become free for another tablet or the web. Entries not yet sent from it are lost.`
        : `${device.deviceCode} can sync again.`} />
  );
}
