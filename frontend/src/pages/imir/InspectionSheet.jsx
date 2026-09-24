import { dimensionalDecision, MAX_SAMPLES, SECTION_LABELS } from '@qmas/shared';
import { Camera, Check, CheckCheck, Paperclip, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Badge from '../../components/ui/Badge.jsx';
import { formatDate } from '../../utils/format.js';
import { fmtNum } from '../formats/formatHelpers.js';

const SAMPLES = Array.from({ length: MAX_SAMPLES }, (_, i) => i + 1);
const cellKey = (uid, s) => `${uid}:${s}`;
const VALID_READING = /^-?\d*(\.\d{0,3})?$/;

const ResultPill = ({ result }) =>
  result === 'OK' ? <Badge variant="success">OK</Badge> : result === 'NOK' ? <Badge variant="danger">NOK</Badge> : <span className="text-xs text-slate-300">—</span>;

/**
 * The inspection grid, laid out like the JIR sheet. Samples 1..n are required (green), the rest
 * optional (grey). Every change is reported as a save patch through `onPatch`; the parent decides
 * whether it goes to the server (online) or the tablet's queue (offline).
 */
export default function InspectionSheet({ sheet, readOnly = false, onPatch, photosByCell = {}, onAddPhoto, onOpenPhotos }) {
  const n = sheet.sampleSize;
  const byCell = new Map(sheet.cells.map((c) => [cellKey(c.checkpointUid, c.sampleNo), c]));
  const results = sheet.evaluation?.checkpointResults ?? {};
  const dims = sheet.checkpoints.filter((c) => c.section === 'DIMENSIONAL');
  const vis = sheet.checkpoints.filter((c) => c.section === 'VISUAL');
  const rel = sheet.checkpoints.filter((c) => c.section === 'RELIABILITY');

  const header = (
    <tr className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
      <th className="px-2 py-2 text-left min-w-44">Check point</th>
      {SAMPLES.map((s) => (
        <th key={s} className={`px-1 py-2 text-center w-20 ${s <= n ? 'text-emerald-700' : 'text-slate-400'}`} title={s <= n ? 'Required sample' : 'Optional sample'}>
          S{s}
        </th>
      ))}
      <th className="px-2 py-2 text-center w-16">Result</th>
      <th className="px-2 py-2 text-left min-w-40">Remark</th>
    </tr>
  );

  return (
    <div className="space-y-5">
      {dims.length > 0 && (
        <Section title={SECTION_LABELS.DIMENSIONAL} note={`Enter measured values (up to 3 decimals). S1–S${n} are required.`}>
          <thead className="bg-slate-50">{header}</thead>
          <tbody className="divide-y divide-slate-100">
            {dims.map((cp) => (
              <tr key={cp.uid}>
                <td className="px-2 py-2 align-top">
                  <div className="font-semibold text-slate-800">{cp.checkpoint}</div>
                  <div className="text-xs text-slate-500 tabular">
                    {cp.lsl !== null ? fmtNum(cp.lsl) : '—'} … {cp.usl !== null ? fmtNum(cp.usl) : '—'} {cp.uom ?? ''}
                    {cp.instrument && <span className="text-slate-400"> · {cp.instrument}</span>}
                  </div>
                </td>
                {SAMPLES.map((s) => (
                  <td key={s} className={`px-1 py-1.5 ${s <= n ? 'bg-emerald-50/60' : 'bg-slate-50'}`}>
                    <DimCell cp={cp} sampleNo={s} value={byCell.get(cellKey(cp.uid, s))?.value ?? null} readOnly={readOnly}
                      onCommit={(value) => onPatch({ cells: [{ checkpointUid: cp.uid, sampleNo: s, value }] })} />
                  </td>
                ))}
                <td className="px-2 text-center"><ResultPill result={results[cp.uid]} /></td>
                <td className="px-2"><RemarkInput value={cp.inspectorRemark} incharge={cp.inchargeRemark} readOnly={readOnly} onCommit={(v) => onPatch({ entries: [{ checkpointUid: cp.uid, inspectorRemark: v }] })} /></td>
              </tr>
            ))}
          </tbody>
        </Section>
      )}

      {vis.length > 0 && (
        <Section title={SECTION_LABELS.VISUAL} note="Tap a box: ✓ OK, tap again: ✗ NOK, again: clear. Any NOK makes the check NOK.">
          <thead className="bg-slate-50">{header}</thead>
          <tbody className="divide-y divide-slate-100">
            {vis.map((cp) => {
              const emptyRequired = SAMPLES.filter((s) => s <= n && byCell.get(cellKey(cp.uid, s))?.ok == null);
              return (
                <tr key={cp.uid}>
                  <td className="px-2 py-2 align-top">
                    <div className="font-semibold text-slate-800">{cp.checkpoint}</div>
                    <div className="text-xs text-slate-500">{cp.specification}</div>
                    {!readOnly && (
                      <div className="mt-1 flex gap-1">
                        {emptyRequired.length > 0 && (
                          <button type="button" onClick={() => onPatch({ cells: emptyRequired.map((s) => ({ checkpointUid: cp.uid, sampleNo: s, ok: true })) })}
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 cursor-pointer">
                            <CheckCheck className="w-3.5 h-3.5" />All OK
                          </button>
                        )}
                        {onAddPhoto && (
                          <button type="button" onClick={() => onAddPhoto(cp)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 cursor-pointer">
                            <Camera className="w-3.5 h-3.5" />Photo
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  {SAMPLES.map((s) => {
                    const ok = byCell.get(cellKey(cp.uid, s))?.ok ?? null;
                    const photos = photosByCell[cellKey(cp.uid, s)] ?? 0;
                    return (
                      <td key={s} className={`px-1 py-1.5 text-center ${s <= n ? 'bg-emerald-50/60' : 'bg-slate-50'}`}>
                        <button
                          type="button"
                          disabled={readOnly}
                          aria-label={`${cp.checkpoint} sample ${s}: ${ok === true ? 'OK' : ok === false ? 'NOK' : 'empty'}`}
                          onClick={() => onPatch({ cells: [{ checkpointUid: cp.uid, sampleNo: s, ok: ok === null ? true : ok === true ? false : null }] })}
                          className={`w-full h-11 rounded-lg border-2 flex items-center justify-center transition-colors cursor-pointer disabled:cursor-default ${
                            ok === true ? 'border-emerald-400 bg-emerald-100 text-emerald-700' : ok === false ? 'border-rose-400 bg-rose-100 text-rose-700' : 'border-dashed border-slate-300 bg-white text-slate-300'
                          }`}
                        >
                          {ok === true ? <Check className="w-5 h-5" /> : ok === false ? <X className="w-5 h-5" /> : null}
                        </button>
                        {photos > 0 && (
                          <button type="button" onClick={() => onOpenPhotos?.(cp, s)} className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-600 cursor-pointer">
                            <Paperclip className="w-3 h-3" />{photos}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2 text-center"><ResultPill result={results[cp.uid]} /></td>
                  <td className="px-2"><RemarkInput value={cp.inspectorRemark} incharge={cp.inchargeRemark} readOnly={readOnly} onCommit={(v) => onPatch({ entries: [{ checkpointUid: cp.uid, inspectorRemark: v }] })} /></td>
                </tr>
              );
            })}
          </tbody>
        </Section>
      )}

      {rel.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <h3 className="px-4 py-2.5 text-sm font-bold text-slate-700 bg-slate-50 border-b border-slate-200">{SECTION_LABELS.RELIABILITY} test</h3>
          <div className="divide-y divide-slate-100">
            {rel.map((cp) => <ReliabilityRow key={cp.uid} cp={cp} readOnly={readOnly} onPatch={onPatch} />)}
          </div>
        </section>
      )}
    </div>
  );
}

const Section = ({ title, note, children }) => (
  <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
    <div className="flex flex-wrap items-baseline gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
      <h3 className="text-sm font-bold text-slate-700">{title} test</h3>
      <span className="text-xs text-slate-400">{note}</span>
    </div>
    <div className="overflow-x-auto"><table className="w-full text-sm">{children}</table></div>
  </section>
);

/** Numeric cell: keeps what is typed locally and commits a valid reading on blur / Enter. */
function DimCell({ cp, sampleNo, value, readOnly, onCommit }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value === null ? '' : String(value));
  }, [value]);

  const valid = text === '' || (VALID_READING.test(text) && text !== '-' && text !== '.');
  const decision = valid && text !== '' ? dimensionalDecision(Number(text), cp) : null;
  const commit = () => {
    focused.current = false;
    if (!valid) return;
    const next = text === '' ? null : Number(text);
    if (next !== value) onCommit(next);
  };
  if (readOnly) {
    return <div className={`h-11 flex items-center justify-center rounded-lg tabular text-sm font-semibold ${decision === 'NOK' ? 'bg-rose-100 text-rose-700' : 'text-slate-700'}`}>{text || '—'}</div>;
  }
  return (
    <input
      inputMode="decimal"
      aria-label={`${cp.checkpoint} sample ${sampleNo}`}
      aria-invalid={!valid || decision === 'NOK'}
      value={text}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => setText(e.target.value.replace(',', '.').replace(/[^\d.-]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className={`w-full h-11 rounded-lg border-2 px-1 text-center text-base tabular font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${
        !valid ? 'border-amber-400 bg-amber-50' : decision === 'NOK' ? 'border-rose-400 bg-rose-100 text-rose-700' : decision === 'OK' ? 'border-emerald-300 bg-white text-emerald-800' : 'border-slate-200 bg-white'
      }`}
    />
  );
}

/** Inspector's remark; the Incharge's remark (from a review) is shown under it. */
function RemarkInput({ value, incharge, readOnly, onCommit }) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  const note = incharge && <div className="mt-0.5 text-[11px] text-amber-700">Incharge: {incharge}</div>;
  if (readOnly) return <><span className="text-xs text-slate-500">{value ?? ''}</span>{note}</>;
  return (
    <>
      <input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => (text || null) !== (value ?? null) && onCommit(text || null)}
        placeholder="Optional" aria-label="Remark"
        className="w-full px-2 py-2 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
      {note}
    </>
  );
}

function ReliabilityRow({ cp, readOnly, onPatch }) {
  const [text, setText] = useState(cp.textObservation ?? '');
  useEffect(() => setText(cp.textObservation ?? ''), [cp.textObservation]);
  const due = cp.isRequired;
  return (
    <div className={`p-4 grid gap-3 lg:grid-cols-[1fr_1.4fr_auto] ${due ? '' : 'bg-slate-50'}`}>
      <div>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-800">{cp.checkpoint}</span>
          {due ? <Badge variant="warning">Due on this lot</Badge> : <Badge variant="neutral">Not due</Badge>}
        </div>
        <p className="text-xs text-slate-500 mt-1">{cp.specification}</p>
        <p className="text-xs text-slate-400 mt-1">
          {cp.frequencyMonths ? `Every ${cp.frequencyMonths} months` : 'Every lot'}
          {cp.lastTestedAt ? ` · last tested ${formatDate(cp.lastTestedAt)}` : ' · never tested for this vendor'}
          {!due && ' · optional now'}
        </p>
      </div>
      <textarea
        aria-label={`${cp.checkpoint} observation`}
        disabled={readOnly}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => (text || null) !== (cp.textObservation ?? null) && onPatch({ entries: [{ checkpointUid: cp.uid, textObservation: text || null }] })}
        placeholder={due ? 'What was observed (required)' : 'What was observed (if tested)'}
        className="min-h-20 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-transparent"
      />
      <div className="flex lg:flex-col gap-2" role="radiogroup" aria-label={`${cp.checkpoint} result`}>
        {['OK', 'NOK'].map((r) => (
          <button key={r} type="button" disabled={readOnly} role="radio" aria-checked={cp.manualResult === r}
            onClick={() => onPatch({ entries: [{ checkpointUid: cp.uid, manualResult: cp.manualResult === r ? null : r }] })}
            className={`h-11 min-w-20 rounded-lg border-2 font-bold cursor-pointer disabled:cursor-default ${
              cp.manualResult === r ? (r === 'OK' ? 'border-emerald-400 bg-emerald-100 text-emerald-700' : 'border-rose-400 bg-rose-100 text-rose-700') : 'border-slate-200 bg-white text-slate-400'
            }`}>
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
