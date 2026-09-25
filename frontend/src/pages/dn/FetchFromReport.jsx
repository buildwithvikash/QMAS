import { useState } from 'react';
import { useGetDnSourceQuery } from '../../api/dnApi.js';
import Badge from '../../components/ui/Badge.jsx';
import Loader from '../../components/ui/Loader.jsx';
import Modal, { ModalFooter } from '../../components/ui/Modal.jsx';
import { apiError } from '../../utils/apiError.js';
import { formatQty } from '../../utils/format.js';

const SECTION = { DIMENSIONAL: 'Dimensional', VISUAL: 'Visual', RELIABILITY: 'Reliability' };

/**
 * "Fetch from inspection report": pick checkpoints of the lot's IMIR (failed ones ticked) to become
 * defect lines, and optionally refresh the model, quantities and defect text. Nothing is saved
 * until the DN is saved.
 */
export default function FetchFromReport({ dn, onApply, onClose }) {
  const { data: src, isLoading, error } = useGetDnSourceQuery(dn.id);
  const [picked, setPicked] = useState(null); // null until the report arrives: then failed ones
  const [mode, setMode] = useState('replace');
  const [header, setHeader] = useState(true);
  const [defect, setDefect] = useState(!dn.defect);

  const chosen = picked ?? new Set((src?.checkpoints ?? []).filter((c) => c.result === 'NOK').map((c) => c.uid));
  const toggle = (uid) => {
    const next = new Set(chosen);
    if (next.has(uid)) next.delete(uid);
    else next.add(uid);
    setPicked(next);
  };
  const apply = () => {
    const lines = src.checkpoints.filter((c) => chosen.has(c.uid)).map((c) => c.line);
    onApply({ lines, mode, header: header ? src.suggested : null, defect: defect ? src.suggested.defect : null });
    onClose();
  };

  return (
    <Modal title="Fetch from inspection report" subtitle={src ? `${src.imirNo}, result ${src.result === 'NOK' ? 'Not OK' : src.result ?? '—'}` : dn.imirNo} size="lg" onClose={onClose}
      footer={<ModalFooter onCancel={onClose} onSave={apply} saveLabel={`Use ${chosen.size} checkpoint${chosen.size === 1 ? '' : 's'}`} />}>
      {isLoading && <Loader inline label="Reading the inspection report…" />}
      {error && <p className="text-sm text-rose-700">{apiError(error).message}</p>}
      {src && (
        <div className="space-y-4">
          {!src.checkpoints.some((c) => c.result === 'NOK') && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This lot passed every check. Tick the checkpoints the defect relates to; their readings and remarks become the defect lines.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button type="button" onClick={() => setPicked(new Set(src.checkpoints.map((c) => c.uid)))} className="text-blue-700 hover:underline cursor-pointer">Select all</button>
            <span className="text-slate-300">|</span>
            <button type="button" onClick={() => setPicked(new Set(src.checkpoints.filter((c) => c.result === 'NOK').map((c) => c.uid)))} className="text-blue-700 hover:underline cursor-pointer">Only failed</button>
            <span className="text-slate-300">|</span>
            <button type="button" onClick={() => setPicked(new Set())} className="text-blue-700 hover:underline cursor-pointer">None</button>
          </div>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {src.checkpoints.map((c) => (
              <li key={c.uid}>
                <label className={`flex gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50 ${chosen.has(c.uid) ? 'bg-blue-50/50' : ''}`}>
                  <input type="checkbox" className="mt-1 accent-blue-600" checked={chosen.has(c.uid)} onChange={() => toggle(c.uid)} />
                  <span className="flex-1 min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{c.checkpoint}</span>
                      <span className="text-xs text-slate-500">{SECTION[c.section]}</span>
                      {c.result ? <Badge variant={c.result === 'NOK' ? 'danger' : 'success'}>{c.result}</Badge> : <Badge variant="neutral">{c.required ? 'Not recorded' : 'Not due'}</Badge>}
                    </span>
                    {c.specification && <span className="block text-xs text-slate-600">Spec: {c.specification}</span>}
                    {c.observation && <span className="block text-xs text-slate-700 mt-0.5">{c.observation}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <fieldset className="space-y-2 text-sm text-slate-800">
            <legend className="text-xs font-medium text-slate-600 mb-1">Defect table</legend>
            <label className="flex items-center gap-2"><input type="radio" name="fetch-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} className="accent-blue-600" />Replace the current lines</label>
            <label className="flex items-center gap-2"><input type="radio" name="fetch-mode" checked={mode === 'add'} onChange={() => setMode('add')} className="accent-blue-600" />Add to the current lines</label>
          </fieldset>
          <div className="space-y-2 text-sm text-slate-800">
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} className="mt-1 accent-blue-600" />
              <span>Also fill model and quantities from the report
                <span className="block text-xs text-slate-500">Model {src.suggested.model ?? '—'}, received {formatQty(src.suggested.receivedQty ?? 0, dn.uom)}, checked {src.suggested.checkedQty}, defective {src.suggested.defectiveQty}</span>
              </span>
            </label>
            {src.suggested.defect && (
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={defect} onChange={(e) => setDefect(e.target.checked)} className="mt-1 accent-blue-600" />
                <span>Use the escalation remark as the defect text<span className="block text-xs text-slate-500">“{src.suggested.defect}”</span></span>
              </label>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
