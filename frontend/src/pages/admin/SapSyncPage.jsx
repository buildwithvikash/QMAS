import { sapMockLotSchema } from '@qmas/shared';
import { DatabaseZap, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAddMockLotMutation, useGetSapStatusQuery, useRunSapSyncMutation } from '../../api/imirApi.js';
import { useGetLookupsQuery } from '../../api/mastersApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { FormError, Select, TextInput } from '../../components/ui/fields.jsx';
import Modal, { ModalFooter } from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useZodForm } from '../../hooks/useZodForm.js';
import { apiError } from '../../utils/apiError.js';
import { formatDateTime } from '../../utils/format.js';

const RUN = { OK: 'success', PARTIAL: 'warning', FAILED: 'danger', RUNNING: 'info' };

/** SAP QA32 pulls: history, errors, manual pull, and (mock mode) simulated inward lots for testing. */
export default function SapSyncPage() {
  const { data, isFetching, error } = useGetSapStatusQuery(undefined, { pollingInterval: 30_000 });
  const [run, { isLoading }] = useRunSapSyncMutation();
  const [simulating, setSimulating] = useState(false);
  const pull = async () => {
    try {
      const r = await run().unwrap();
      toast.success(`Pulled ${r.fetched} lot(s): ${r.createdLots} new, ${r.openedImirs} IMIR(s) opened${r.errors.length ? `, ${r.errors.length} failed` : ''}`);
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  const columns = [
    { key: 'startedAt', header: 'Started', render: (r) => <span className="whitespace-nowrap">{formatDateTime(r.startedAt)}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge variant={RUN[r.status]}>{r.status}</Badge> },
    { key: 'fetched', header: 'Lots read', align: 'right' },
    { key: 'createdLots', header: 'New', align: 'right' },
    { key: 'openedImirs', header: 'IMIRs opened', align: 'right' },
    { key: 'by', header: 'Started by', render: (r) => r.triggeredByName ?? 'Scheduler' },
    { key: 'errors', header: 'Problems', render: (r) => (r.errors?.length ? <ul className="text-xs text-rose-700">{r.errors.map((e, i) => <li key={i}>{e.sapLotNo ? `Lot ${e.sapLotNo}: ` : ''}{e.message}</li>)}</ul> : <span className="text-slate-300">—</span>) },
  ];
  return (
    <div>
      <PageHeader icon={DatabaseZap} title="SAP Sync" subtitle={data ? `Inward lots from QA32 · adapter: ${data.mode}${data.mode === 'mock' ? ' (SAP API not connected yet)' : ''}` : 'Inward lots from QA32'}>
        {data?.mode === 'mock' && <Button size="sm" variant="secondary" icon={Plus} onClick={() => setSimulating(true)}>Simulate inward lot</Button>}
        <Button size="sm" icon={RefreshCw} loading={isLoading} onClick={pull}>Pull now</Button>
      </PageHeader>
      <div className="p-5">
        <p className="text-xs text-slate-500 mb-3">The worker pulls automatically every few minutes. A lot that fails (for example an unknown plant) is retried on the next pull once the cause is fixed.</p>
        <DataTable columns={columns} rows={data?.runs} loading={isFetching} error={error} empty="No pulls yet." />
      </div>
      {simulating && <SimulateLot onClose={() => setSimulating(false)} />}
    </div>
  );
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

function SimulateLot({ onClose }) {
  const { data: lookups } = useGetLookupsQuery();
  const form = useZodForm(sapMockLotSchema, {
    plantSapCode: '1115', itemCode: '123456', itemDescription: 'Compressor mounting bracket', itemCategory: 'Sheet Metal', uom: 'NOS',
    vendorCode: 'V1001', vendorName: 'Acme Metals', grnNo: `GRN${Date.now().toString().slice(-6)}`, grnDate: today(), invoiceNo: `INV${Date.now().toString().slice(-5)}`, inwardQty: 500,
  });
  const [add, { isLoading, error }] = useAddMockLotMutation();
  const [run] = useRunSapSyncMutation();
  const save = async () => {
    const data = form.validate({ inwardQty: Number(form.values.inwardQty) });
    if (!data) return;
    try {
      const r = await add(data).unwrap();
      await run().unwrap();
      toast.success(`SAP lot ${r.sapLotNo} received`);
      onClose();
    } catch (err) {
      form.setServerErrors(apiError(err).fieldErrors);
    }
  };
  const f = (name, label, props = {}) => <TextInput label={label} value={form.values[name] ?? ''} onChange={(e) => form.set(name, e.target.value)} error={form.error(name)} {...props} />;
  return (
    <Modal title="Simulate an inward lot" subtitle="Test data as SAP QA32 would send it; only while SAP is not connected" onClose={onClose}
      footer={<ModalFooter onCancel={onClose} onSave={save} saving={isLoading} saveLabel="Receive lot" />}>
      <FormError message={error && !Object.keys(apiError(error).fieldErrors).length ? apiError(error).message : ''} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Plant" required value={form.values.plantSapCode} onChange={(v) => form.set('plantSapCode', v)} error={form.error('plantSapCode')}
          options={(lookups?.plants ?? []).map((p) => ({ value: p.sapCode, label: `${p.sapCode} · ${p.name}` }))} />
        {f('grnNo', 'GRN no.')}
        {f('grnDate', 'GRN date', { type: 'date' })}
        {f('invoiceNo', 'Invoice no.')}
        {f('itemCode', 'Item code')}
        {f('itemDescription', 'Item description')}
        {f('itemCategory', 'Item category')}
        {f('uom', 'UOM')}
        {f('vendorCode', 'Vendor code')}
        {f('vendorName', 'Vendor name')}
        {f('inwardQty', 'Inward quantity', { inputMode: 'decimal' })}
      </div>
    </Modal>
  );
}
