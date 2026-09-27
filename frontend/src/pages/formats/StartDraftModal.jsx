import { Copy, Database, FilePlus2, Hammer, PencilLine, Search } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useCreateDraftMutation, useGetFormatLibraryQuery, useLazySanLookupQuery } from '../../api/formatsApi.js';
import Button from '../../components/ui/Button.jsx';
import { FormError, Select, TextInput } from '../../components/ui/fields.jsx';
import Modal, { ModalFooter } from '../../components/ui/Modal.jsx';
import { useDebounced } from '../../hooks/useDebounced.js';
import { apiError } from '../../utils/apiError.js';

const SOURCES = [
  { value: 'CUSTOM', label: 'Build a custom format', icon: Hammer, help: 'Design the report yourself in the builder: your own sections, lot details, choices and checks.' },
  { value: 'CURRENT', label: 'Edit the current version', icon: PencilLine, help: 'Best for changes: your edits merge with any other approved change.' },
  { value: 'SAN', label: 'Fetch from SAN/SIR', icon: Database, help: 'Checkpoints from the SAN/SIR application for a vendor and this item.' },
  { value: 'CLONE', label: 'Copy another format', icon: Copy, help: 'Start from an approved format of a similar item.' },
  { value: 'BLANK', label: 'Blank standard format', icon: FilePlus2, help: 'Empty dimensional / visual / reliability format.' },
];

/**
 * Starts a draft for an item: custom (builder), change of the current version, SAN/SIR, copy or
 * blank. Without `item`, asks for the item first (from the Format Library).
 */
export default function StartDraftModal({ item: fixedItem, hasCurrent: fixedHasCurrent, initialFrom, cloneFrom, onClose }) {
  const [picked, setPicked] = useState(null);
  const item = fixedItem ?? picked;
  const hasCurrent = fixedItem ? fixedHasCurrent : !!picked?.versionNo;
  const [from, setFrom] = useState(initialFrom ?? (fixedHasCurrent ? 'CURRENT' : 'CUSTOM'));
  const [vendorCode, setVendorCode] = useState('');
  // Duplicate: copy a given approved version onto the item picked next.
  const [cloneVersionId, setCloneVersionId] = useState(cloneFrom?.versionId ?? null);
  const [error, setError] = useState(null);
  const [create, { isLoading }] = useCreateDraftMutation();
  const [sanLookup, san] = useLazySanLookupQuery();
  const navigate = useNavigate();
  const options = SOURCES.filter((s) => s.value !== 'CURRENT' || hasCurrent);

  if (!item) {
    return (
      <ItemPicker title={cloneFrom ? `Duplicate ${cloneFrom.itemCode} v${cloneFrom.versionNo}` : undefined} exclude={cloneFrom?.itemId} onClose={onClose}
        onPick={(r) => { setPicked({ id: r.itemId, itemCode: r.itemCode, description: r.description, versionNo: r.versionNo }); if (r.versionNo && !initialFrom) setFrom('CURRENT'); }} />
    );
  }

  const start = async () => {
    setError(null);
    try {
      const draft = await create({
        itemId: item.id,
        from,
        vendorCode: from === 'SAN' ? vendorCode.trim().toUpperCase() : undefined,
        cloneFromVersionId: from === 'CLONE' ? (cloneVersionId ?? undefined) : undefined,
      }).unwrap();
      toast.success(from === 'CUSTOM' ? 'Custom format started: build it in the builder' : 'Draft started');
      navigate(`/formats/versions/${draft.id}/edit`);
    } catch (err) {
      setError(apiError(err));
    }
  };

  return (
    <Modal title={hasCurrent ? 'Start a change' : 'Create the format'} subtitle={`${item.itemCode} · ${item.description}`} onClose={onClose}
      footer={<ModalFooter onCancel={onClose} onSave={start} saving={isLoading} saveLabel={from === 'CUSTOM' ? 'Open the builder' : 'Start draft'} />}>
      <FormError message={error && !Object.keys(error.fieldErrors).length ? error.message : ''} />
      <div role="radiogroup" className="grid gap-2">
        {options.map((o) => (
          <label key={o.value} className={`flex gap-3 rounded-xl border p-3 cursor-pointer ${from === o.value ? 'border-blue-300 bg-blue-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
            <input type="radio" name="from" className="mt-1 accent-blue-600" checked={from === o.value} onChange={() => setFrom(o.value)} />
            <o.icon className="w-5 h-5 mt-0.5 text-blue-600 shrink-0" />
            <span>
              <span className="block text-sm font-semibold text-slate-800">{o.label}{o.value === 'CUSTOM' && <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-violet-700">Builder</span>}</span>
              <span className="block text-xs text-slate-500">{o.help}</span>
            </span>
          </label>
        ))}
      </div>
      {from === 'SAN' && (
        <div className="mt-4 flex items-end gap-2">
          <TextInput className="flex-1" label="Vendor code" required value={vendorCode} onChange={(e) => setVendorCode(e.target.value.toUpperCase())} error={error?.fieldErrors?.vendorCode} />
          <Button variant="secondary" disabled={!vendorCode.trim()} loading={san.isFetching} onClick={() => sanLookup({ vendorCode: vendorCode.trim(), itemCode: item.itemCode })}>Check SAN/SIR</Button>
        </div>
      )}
      {from === 'SAN' && san.data && (
        <p className={`mt-2 text-sm ${san.data.found ? 'text-emerald-700' : 'text-amber-700'}`}>
          {san.data.found ? `Found ${san.data.checkpoints.length} checkpoints (${san.data.reference}).` : 'SAN/SIR has no record for this vendor and item. Choose another way to start.'}
        </p>
      )}
      {from === 'CLONE' && cloneFrom && cloneVersionId === cloneFrom.versionId ? (
        <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">Copies the approved format of <b>{cloneFrom.itemCode}</b> (v{cloneFrom.versionNo}) as a draft for {item.itemCode}. Review it in the builder, then submit it for approval.</p>
      ) : from === 'CLONE' && <CloneSource value={cloneVersionId} onChange={setCloneVersionId} error={error?.fieldErrors?.cloneFromVersionId} />}
      {hasCurrent && !['CURRENT'].includes(from) && <p className="mt-4 text-xs text-amber-700">Starting from something other than the current version replaces its content; approval will show what changes.</p>}
    </Modal>
  );
}

/** Step one from the library: which item the format is for. Items without a format come first. */
function ItemPicker({ onPick, onClose, title = 'New format', exclude }) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const { data, isFetching } = useGetFormatLibraryQuery({ q: debounced || undefined, pageSize: 12, sort: 'lotsWaiting', order: 'desc' });
  return (
    <Modal title={title} subtitle="Choose the item the inspection format is for" onClose={onClose}>
      <label className="relative block">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Item code or description" aria-label="Find the item"
          className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500" />
      </label>
      <ul className="mt-3 max-h-80 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
        {(data?.rows ?? []).filter((r) => r.itemId !== exclude).map((r) => (
          <li key={r.itemId}>
            <button type="button" onClick={() => onPick(r)} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-blue-50 cursor-pointer">
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-xs font-semibold text-slate-800">{r.itemCode}</span>
                <span className="block text-xs text-slate-500 truncate">{r.description}</span>
              </span>
              {r.lotsWaiting > 0 && <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">{r.lotsWaiting} lot{r.lotsWaiting === 1 ? '' : 's'} waiting</span>}
              <span className="shrink-0 text-xs text-slate-500">{r.versionNo ? `has v${r.versionNo}` : 'no format'}</span>
            </button>
          </li>
        ))}
        {!isFetching && !data?.rows?.length && <li className="px-3 py-6 text-center text-sm text-slate-500">No item matches. Items come from SAP lots or Master Config.</li>}
      </ul>
    </Modal>
  );
}

/** Pick an item with an approved format; the value is that format's current version id. */
function CloneSource({ value, onChange, error }) {
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const { data } = useGetFormatLibraryQuery({ q: debounced || undefined, status: 'APPROVED', pageSize: 20 });
  return (
    <div className="mt-4 grid gap-2">
      <TextInput label="Find the item to copy" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Item code or description" />
      <Select label="Item with an approved format" value={value ?? ''} onChange={(v) => onChange(v)} error={error}
        options={(data?.rows ?? []).map((r) => ({ value: r.currentVersionId, label: `${r.itemCode} · ${r.description} (v${r.versionNo})` }))} placeholder="Choose…" />
    </div>
  );
}
