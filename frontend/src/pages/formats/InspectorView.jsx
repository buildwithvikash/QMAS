import { Eye, Search } from 'lucide-react';
import { useState } from 'react';
import { applyPatch } from '../../offline/sheetModel.js';
import { ImirResult } from '../imir/imirUi.jsx';
import InspectionSheet from '../imir/InspectionSheet.jsx';
import { sheetProgress } from '../imir/sheetNav.js';
import { previewSheet } from './inspectorPreview.js';

/**
 * The inspector's view of a format: the same inspection sheet the inspector fills on an IMIR
 * (lot details, dimensional, visual and reliability sections), live on sample data. Readings,
 * ticks and choices can be tried and give OK / NOK like on a real lot. Nothing here is saved.
 */
export default function InspectorView({ checkpoints, note = 'The inspection sheet as the inspector fills it on an IMIR. Try readings and ticks; nothing is saved.' }) {
  const [n, setN] = useState(3);
  const [sheet, setSheet] = useState(() => previewSheet(checkpoints, 3));
  const [find, setFind] = useState('');
  const resize = (size) => {
    setN(size);
    setSheet((sh) => previewSheet(checkpoints, size, sh.cells));
  };
  const reset = () => setSheet(previewSheet(checkpoints, n));
  const progress = sheetProgress(sheet);
  const ev = sheet.evaluation;
  const parts = [
    progress.lot.present && { key: 'lot', label: 'Lot details', ...progress.lot },
    progress.present.dim && { key: 'dim', label: 'Dimensional test', ...progress.dim },
    progress.present.visrel && { key: 'visrel', label: 'Visual & reliability tests', ...progress.visrel },
  ].filter(Boolean);
  const searchOn = parts.find((x) => x.key !== 'lot')?.key;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">
        <Eye className="w-4 h-4" />
        <span>{note}</span>
        <label className="ml-auto flex items-center gap-2 text-xs">Sample size
          <select value={n} onChange={(e) => resize(Number(e.target.value))} className="rounded-md border border-blue-200 bg-white px-2 py-1 cursor-pointer">
            {[1, 2, 3, 5, 8, 13].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <button type="button" onClick={reset} className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer">Clear entries</button>
      </div>
      {!parts.length && <p className="card p-8 text-center text-sm text-slate-500">Add fields to see the inspection sheet.</p>}
      {parts.map((sec) => (
        <section key={sec.key} className="card overflow-hidden" aria-label={sec.label}>
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-2.5">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              {sec.label}
              {sec.total > 0 && <span className={`text-sm font-medium tabular ${sec.done === sec.total ? 'text-emerald-700' : 'text-slate-500'}`}>({sec.done}/{sec.total})</span>}
              {sec.nok && <span className="w-2 h-2 rounded-full bg-rose-500" title="Has a NOK" />}
            </h2>
            {sec.key === searchOn && (
              <label className="relative ml-auto w-full sm:w-72">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search check point, specification…" aria-label="Search check points"
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
              </label>
            )}
          </div>
          <InspectionSheet flat sheet={sheet} tab={sec.key} onPatch={(patch) => setSheet((sh) => applyPatch(sh, patch))} filter={sec.key === 'lot' ? '' : find} />
        </section>
      ))}
      {parts.length > 0 && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white/95 px-4 py-2.5 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Progress</span>
            <span className="w-24 h-1.5 rounded-full bg-slate-200 overflow-hidden"><span className={`block h-full rounded-full ${progress.pct === 100 ? 'bg-emerald-500' : 'bg-blue-600'}`} style={{ width: `${progress.pct}%` }} /></span>
            <span className="text-xs font-semibold tabular text-slate-700">{progress.pct}%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Result so far</span>
            <ImirResult result={ev.result} />
            {ev.defectiveSamples.length > 0 && <span className="text-xs text-rose-700">NOK in X{ev.defectiveSamples.join(', X')}</span>}
          </div>
          <span className="ml-auto text-xs text-slate-400">{ev.missing.length ? `${ev.missing.length} entries still empty` : 'All entries filled'}</span>
        </div>
      )}
    </div>
  );
}
