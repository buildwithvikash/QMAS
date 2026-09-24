import { DOC_TYPES, numberSeriesCreateSchema, PERMISSIONS, RESET_SCOPES, validatePattern } from '@qmas/shared';
import { Hash, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useCreateNumberSeriesMutation, useGetLookupsQuery, useGetNumberSeriesQuery, usePreviewNumberMutation, useSetNumberSeriesStatusMutation } from '../../api/mastersApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { FormError, Select, TextInput } from '../../components/ui/fields.jsx';
import Modal, { ConfirmDialog, ModalFooter } from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { useDebounced } from '../../hooks/useDebounced.js';
import { useZodForm } from '../../hooks/useZodForm.js';
import { apiError } from '../../utils/apiError.js';
import { formatDateTime } from '../../utils/format.js';

const DOC_LABELS = { IMIR: 'IMIR', DN: 'Defect Notification', DEVIATION: 'Deviation' };
const RESET_LABELS = { DAY: 'Every day', MONTH: 'Every month', YEAR: 'Every year', NEVER: 'Never' };
const TOKENS = [
  ['{PLANT_SAP}', 'SAP plant code (1115)'],
  ['{PLANT_SHORT}', '2-digit plant code (03)'],
  ['{SRC}', 'DN source: IL / LN / RL / FD'],
  ['{YYYY}', 'Year (2026)'],
  ['{YY}', 'Year (26)'],
  ['{MM}', 'Month (07)'],
  ['{DD}', 'Day (01)'],
  ['{SEQ:3}', 'Running number, 3 digits'],
];

/**
 * Number series are append-only: to change how numbers look, add a new series (for all plants or
 * one plant, optionally from a future date) and deactivate the old one. Issued numbers never change.
 */
export default function NumberSeriesPage() {
  const { can } = useAccess();
  const canManage = can(PERMISSIONS.NUMBERING_MANAGE);
  const { data: series, isFetching, error } = useGetNumberSeriesQuery();
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState(null);

  const columns = [
    { key: 'docType', header: 'Document', render: (s) => <span className="font-semibold text-slate-800">{DOC_LABELS[s.docType]}</span> },
    { key: 'pattern', header: 'Pattern', render: (s) => <code className="text-xs bg-slate-100 rounded px-1.5 py-0.5">{s.pattern}</code> },
    { key: 'plant', header: 'Applies to', render: (s) => (s.plantId ? `${s.plantSapCode} · ${s.plantName}` : <span className="text-slate-500">All plants (default)</span>) },
    { key: 'resetScope', header: 'Counter resets', render: (s) => RESET_LABELS[s.resetScope] },
    { key: 'effectiveFrom', header: 'Effective from', render: (s) => <span className="whitespace-nowrap">{formatDateTime(s.effectiveFrom)}</span> },
    { key: 'issuedCount', header: 'Issued', align: 'right', render: (s) => s.issuedCount },
    { key: 'isActive', header: 'Status', render: (s) => <Badge variant={s.isActive ? 'success' : 'neutral'}>{s.isActive ? 'Active' : 'Inactive'}</Badge> },
    ...(canManage
      ? [{ key: 'actions', header: '', render: (s) => (
          <Button variant="ghost" size="sm" onClick={() => setToggling(s)}>{s.isActive ? 'Deactivate' : 'Activate'}</Button>
        ) }]
      : []),
    { key: 'remarks', header: 'Remarks', render: (s) => <span className="text-xs text-slate-500">{s.remarks ?? ''}</span> },
  ];

  return (
    <div>
      <PageHeader icon={Hash} title="Number Series" subtitle="How IMIR, DN and Deviation numbers are built. A plant-specific series overrides the default.">
        {canManage && <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>New series</Button>}
      </PageHeader>
      <div className="p-5">
        <DataTable columns={columns} rows={series} loading={isFetching} error={error} empty="No number series yet." />
      </div>
      {creating && <NewSeriesModal onClose={() => setCreating(false)} />}
      {toggling && <ToggleDialog series={toggling} onClose={() => setToggling(null)} />}
    </div>
  );
}

function ToggleDialog({ series, onClose }) {
  const [setStatus, { isLoading }] = useSetNumberSeriesStatusMutation();
  const activate = !series.isActive;
  const confirm = async () => {
    try {
      await setStatus({ id: series.id, isActive: activate, rowVersion: series.rowVersion }).unwrap();
      toast.success(`Series ${activate ? 'activated' : 'deactivated'}`);
      onClose();
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };
  return (
    <ConfirmDialog
      title={activate ? 'Activate series' : 'Deactivate series'}
      message={activate
        ? `New ${DOC_LABELS[series.docType]} numbers will follow ${series.pattern}${series.plantId ? ` at ${series.plantName}` : ''} if it is the most recent active series.`
        : `New ${DOC_LABELS[series.docType]} numbers will no longer use ${series.pattern}. Make sure another series is active, or new documents cannot be numbered.`}
      confirmLabel={activate ? 'Activate' : 'Deactivate'}
      variant={activate ? 'primary' : 'danger'}
      onConfirm={confirm}
      onCancel={onClose}
      busy={isLoading}
    />
  );
}

function NewSeriesModal({ onClose }) {
  const { data: lookups } = useGetLookupsQuery();
  const form = useZodForm(numberSeriesCreateSchema, { docType: 'IMIR', plantId: null, pattern: 'IMIR{PLANT_SAP}{YY}{MM}{DD}{SEQ:3}', resetScope: 'DAY', effectiveFrom: '', remarks: '' });
  const [create, { isLoading }] = useCreateNumberSeriesMutation();
  const [preview, previewState] = usePreviewNumberMutation();
  const [formError, setFormError] = useState('');
  const v = form.values;
  const plants = (lookups?.plants ?? []).filter((p) => p.isActive);
  const previewPlantId = v.plantId ?? plants[0]?.id;
  const problems = validatePattern(v.pattern.toUpperCase(), v.resetScope, v.docType);
  const debouncedPattern = useDebounced(v.pattern.toUpperCase(), 400);

  useEffect(() => {
    if (!previewPlantId || validatePattern(debouncedPattern, v.resetScope, v.docType).length) return;
    preview({ docType: v.docType, plantId: previewPlantId, pattern: debouncedPattern, resetScope: v.resetScope, src: 'IL' });
  }, [debouncedPattern, v.resetScope, v.docType, previewPlantId, preview]);

  const insertToken = (token) => form.set('pattern', `${v.pattern}${token}`);

  const save = async () => {
    setFormError('');
    const effectiveFrom = v.effectiveFrom ? new Date(v.effectiveFrom).toISOString() : undefined;
    const data = form.validate({ effectiveFrom, remarks: v.remarks || null });
    if (!data) return;
    try {
      await create(data).unwrap();
      toast.success('Number series added');
      onClose();
    } catch (err) {
      const { message, fieldErrors } = apiError(err);
      form.setServerErrors(fieldErrors);
      setFormError(message);
    }
  };

  return (
    <Modal title="New number series" subtitle="Takes effect for new documents only" onClose={onClose} size="lg"
      footer={<ModalFooter onCancel={onClose} onSave={save} saving={isLoading} saveLabel="Add series" />}>
      <FormError message={formError} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Document" required value={v.docType} onChange={(x) => form.set('docType', x ?? 'IMIR')} options={DOC_TYPES.map((d) => ({ value: d, label: DOC_LABELS[d] }))} error={form.error('docType')} />
        <Select label="Applies to" value={v.plantId ? String(v.plantId) : ''} placeholder="All plants (default)" onChange={(x) => form.set('plantId', x ? Number(x) : null)}
          options={plants.map((p) => ({ value: String(p.id), label: `${p.sapCode} · ${p.name}` }))} hint="A plant-specific series overrides the default for that plant." />
        <div className="sm:col-span-2">
          <TextInput label="Pattern" required className="font-mono" value={v.pattern} onChange={(e) => form.set('pattern', e.target.value.toUpperCase())} error={form.error('pattern') ?? (problems[0] && v.pattern ? problems[0] : undefined)} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TOKENS.map(([t, help]) => (
              <button key={t} type="button" title={help} onClick={() => insertToken(t)} className="px-2 py-1 rounded-md border border-slate-200 bg-slate-50 text-[11px] font-mono text-slate-600 hover:bg-blue-50 hover:border-blue-200 cursor-pointer">{t}</button>
            ))}
          </div>
        </div>
        <Select label="Counter resets" required value={v.resetScope} onChange={(x) => form.set('resetScope', x ?? 'DAY')} options={RESET_SCOPES.map((r) => ({ value: r, label: RESET_LABELS[r] }))} hint="Counters always run per plant." />
        <TextInput label="Effective from" type="datetime-local" value={v.effectiveFrom} onChange={(e) => form.set('effectiveFrom', e.target.value)} hint="Leave empty to start now." error={form.error('effectiveFrom')} />
        <TextInput label="Remarks" className="sm:col-span-2" value={v.remarks} onChange={(e) => form.set('remarks', e.target.value)} />
      </div>
      <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3">
        <div className="text-[10px] font-semibold text-blue-600 font-medium">Next number would be</div>
        <div className="mt-1 font-mono text-lg text-slate-800">{problems.length ? '—' : (previewState.data?.docNo ?? '…')}</div>
        <div className="text-xs text-slate-500">
          {plants.find((p) => p.id === previewPlantId)?.name ?? ''}{v.docType === 'DN' ? ' · source IL' : ''} · today
        </div>
      </div>
    </Modal>
  );
}
