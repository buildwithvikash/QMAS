import { DOC_TYPES, numberSeriesCreateSchema, PERMISSIONS, RESET_SCOPES, validatePattern } from '@qmas/shared';
import { Building2, CheckCircle2, Clock3, FileText, Hash, Play, Plus, Power, RotateCcw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useCreateNumberSeriesMutation, useGetLookupsQuery, useGetNumberSeriesQuery, usePreviewNumberMutation, useSetNumberSeriesStatusMutation } from '../../api/mastersApi.js';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { FormError, Select, TextInput } from '../../components/ui/fields.jsx';
import Modal, { ConfirmDialog, ModalFooter } from '../../components/ui/Modal.jsx';
import PageHeader, { CopyButton } from '../../components/ui/PageHeader.jsx';
import { useAccess } from '../../hooks/useAccess.js';
import { useClientTable } from '../../hooks/useClientTable.js';
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
const SUMMARY_TONE = {
  blue: 'bg-blue-50 text-blue-600',
  green: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-500',
  violet: 'bg-violet-50 text-violet-600',
};

function SummaryCard({ icon: Icon, tone, label, value, note }) {
  return (
    <div className="card flex items-center gap-4 px-5 py-4">
      <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${SUMMARY_TONE[tone]}`}><Icon className="h-7 w-7" /></span>
      <div className="min-w-0">
        <p className="text-sm text-slate-600">{label}</p>
        <p className={`font-bold leading-tight text-slate-900 ${typeof value === 'number' ? 'text-2xl' : 'text-lg'}`}>{value}</p>
        <p className="truncate text-xs text-slate-500">{note}</p>
      </div>
    </div>
  );
}

const StatusPill = ({ active }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
    <span className={`h-2 w-2 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-500'}`} />{active ? 'Active' : 'Inactive'}
  </span>
);

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
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  const all = useMemo(() => series ?? [], [series]);
  const rows = useMemo(() => {
    const words = q.trim().toLowerCase();
    return all.filter((x) => (status === '' || String(x.isActive) === status)
      && (!words || [DOC_LABELS[x.docType], x.pattern, x.remarks, x.plantName].some((v) => v && v.toLowerCase().includes(words))));
  }, [all, q, status]);
  const table = useClientTable(rows, { pageSize: 10 });
  const active = all.filter((x) => x.isActive).length;
  const plantSpecific = [...new Set(all.filter((x) => x.plantId).map((x) => x.plantName))];

  const columns = [
    { key: 'sr', header: '#', export: false, render: (x) => <span className="grid h-7 w-7 place-items-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">{rows.indexOf(x) + 1}</span> },
    { key: 'docType', header: 'Document', text: (x) => DOC_LABELS[x.docType], render: (x) => <span className="font-semibold text-slate-900">{DOC_LABELS[x.docType]}</span> },
    {
      key: 'pattern', header: 'Pattern', hint: 'How each number is built. Tokens in braces are filled in when a number is issued.', text: (x) => x.pattern,
      render: (x) => (
        <span className="inline-flex max-w-64 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 py-1 pl-2.5 pr-1" title={x.pattern}>
          <code className="truncate text-xs text-slate-700">{x.pattern}</code>
          <CopyButton text={x.pattern} label="Copy pattern" />
        </span>
      ),
    },
    { key: 'plant', header: 'Applies to', text: (x) => x.plantName ?? 'All plants (default)', render: (x) => (x.plantId ? <span className="whitespace-nowrap text-slate-800">{x.plantName}</span> : <span className="whitespace-nowrap text-slate-500">All plants (default)</span>) },
    { key: 'resetScope', header: 'Counter resets', text: (x) => RESET_LABELS[x.resetScope], render: (x) => RESET_LABELS[x.resetScope] },
    { key: 'effectiveFrom', header: 'Effective from', text: (x) => formatDateTime(x.effectiveFrom), render: (x) => <span className="whitespace-nowrap">{formatDateTime(x.effectiveFrom)}</span> },
    { key: 'issuedCount', header: 'Issued', hint: 'Numbers issued with this series so far.', align: 'center', render: (x) => <span className="tabular">{x.issuedCount}</span> },
    { key: 'isActive', header: 'Status', text: (x) => (x.isActive ? 'Active' : 'Inactive'), render: (x) => <StatusPill active={x.isActive} /> },
    ...(canManage
      ? [{
          key: 'actions', header: 'Action', export: false, hint: 'The newest active series is used for new numbers; deactivate a series to stop using it.',
          render: (x) => (x.isActive ? (
            <button type="button" onClick={() => setToggling(x)} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 cursor-pointer">
              <Power className="h-3.5 w-3.5" />Deactivate
            </button>
          ) : (
            <button type="button" onClick={() => setToggling(x)} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 cursor-pointer">
              <Play className="h-3.5 w-3.5" />Activate
            </button>
          )),
        }]
      : []),
    { key: 'remarks', header: 'Remarks', text: (x) => x.remarks ?? '', render: (x) => <span className="text-sm text-slate-600">{x.remarks ?? ''}</span> },
  ];

  return (
    <div>
      <PageHeader icon={Hash} title="Number Series" subtitle="Configure how IMIR, DN and Deviation numbers are generated. A plant-specific series overrides the default.">
        {canManage && <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>New series</Button>}
      </PageHeader>
      <div className="p-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard icon={FileText} tone="blue" label="Total series" value={all.length} note="Configured number series" />
          <SummaryCard icon={CheckCircle2} tone="green" label="Active" value={active} note="Currently in use" />
          <SummaryCard icon={Clock3} tone="amber" label="Inactive" value={all.length - active} note="Disabled series" />
          <SummaryCard icon={Building2} tone="violet" label="Applies to"
            value={plantSpecific.length ? `${plantSpecific.length} plant${plantSpecific.length === 1 ? '' : 's'} + default` : 'All plants (default)'}
            note={plantSpecific.length ? plantSpecific.join(', ') : 'Configured for all plants'} />
        </div>
        <DataTable
          columns={columns}
          rows={table.rows}
          loading={isFetching}
          error={error}
          pagination={table.pagination}
          exportName="number-series"
          empty={q || status ? 'No series match the search.' : 'No number series yet.'}
          leading={(
            <>
              <label className="relative w-full sm:w-96">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search document, pattern, remarks…" aria-label="Search number series"
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              </label>
              <div className="ml-auto flex items-center gap-2">
                <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"
                  className="h-10 rounded-lg border border-slate-200 bg-white pl-3 pr-8 text-sm text-slate-700 outline-none focus:border-blue-500 cursor-pointer">
                  <option value="">All status</option>
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
                <button type="button" onClick={() => { setQ(''); setStatus(''); }}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
                  <RotateCcw className="h-4 w-4" />Reset
                </button>
              </div>
            </>
          )}
        />
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
          options={plants.map((p) => ({ value: String(p.id), label: `${p.name} (${p.sapCode})` }))} hint="A plant-specific series overrides the default for that plant." />
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
