import { dimensionalDecision, MAX_SAMPLES, SECTION_LABELS } from '@qmas/shared';
import { ArrowDown, ArrowUp, Camera, Check, CheckCheck, Paperclip, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Badge from '../../components/ui/Badge.jsx';
import { formatDate } from '../../utils/format.js';
import { fmtNum } from '../formats/formatHelpers.js';
import { moveFocus } from './sheetNav.js';

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
  // Only the required samples by default; optional ones on request (or when some are filled).
  const usesOptional = sheet.cells.some((c) => c.sampleNo > n);
  const [optionalOpen, setOptionalOpen] = useState(false);
  const showOptional = optionalOpen || usesOptional;
  const shown = SAMPLES.filter((s) => s <= n || showOptional);
  const lastCol = shown.length;

  const filled = (list, has) => list.reduce((a, cp) => a + SAMPLES.filter((s) => s <= n && has(byCell.get(cellKey(cp.uid, s)))).length, 0);
  const dimDone = filled(dims, (c) => c?.value != null);
  const visDone = filled(vis, (c) => c?.ok != null);

  const header = (
    <tr className="text-xs font-semibold text-slate-600">
      <th className="px-3 py-2 text-left min-w-44">Check point</th>
      {shown.map((s) => (
        <th key={s} className={`px-1 py-2 text-center w-20 ${s <= n ? 'text-emerald-800' : 'text-slate-400'}`} title={s <= n ? 'Required sample' : 'Optional sample'}>
          S{s}
        </th>
      ))}
      {!showOptional && n < MAX_SAMPLES && !readOnly && (
        <th className="px-1 py-2 w-24">
          <button type="button" onClick={() => setOptionalOpen(true)} className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline cursor-pointer" title="Show optional samples">
            <Plus className="w-3 h-3" />S{n + 1}–S{MAX_SAMPLES}
          </button>
        </th>
      )}
      <th className="px-2 py-2 text-center w-16">Result</th>
      <th className="px-2 py-2 text-left min-w-40">Remark</th>
    </tr>
  );
  const spacer = !showOptional && n < MAX_SAMPLES && !readOnly ? <td /> : null;

  return (
    <div className="space-y-5">
      {dims.length > 0 && (
        <Section title={SECTION_LABELS.DIMENSIONAL} note="Type each reading; Enter moves to the next cell." done={dimDone} total={dims.length * n}>
          <thead className="bg-blue-50/70">{header}</thead>
          <tbody className="divide-y divide-slate-100">
            {dims.map((cp, ri) => (
              <tr key={cp.uid}>
                <td className="px-2 py-2 align-top">
                  <div className="font-semibold text-slate-800">{cp.checkpoint}</div>
                  <div className="text-xs text-slate-500 tabular">
                    {cp.lsl !== null ? fmtNum(cp.lsl) : '—'} … {cp.usl !== null ? fmtNum(cp.usl) : '—'} {cp.uom ?? ''}
                    {cp.instrument && <span className="text-slate-400"> · {cp.instrument}</span>}
                  </div>
                </td>
                {shown.map((s, ci) => (
                  <td key={s} className={`px-1 py-1.5 ${s <= n ? 'bg-emerald-50/60' : 'bg-slate-50'}`}>
                    <DimCell cp={cp} sampleNo={s} row={ri} col={ci + 1} lastCol={lastCol} value={byCell.get(cellKey(cp.uid, s))?.value ?? null} readOnly={readOnly}
                      onCommit={(value) => onPatch({ cells: [{ checkpointUid: cp.uid, sampleNo: s, value }] })} />
                  </td>
                ))}
                {spacer}
                <td className="px-2 text-center"><ResultPill result={results[cp.uid]} /></td>
                <td className="px-2"><RemarkInput value={cp.inspectorRemark} incharge={cp.inchargeRemark} readOnly={readOnly} onCommit={(v) => onPatch({ entries: [{ checkpointUid: cp.uid, inspectorRemark: v }] })} /></td>
              </tr>
            ))}
          </tbody>
        </Section>
      )}

      {vis.length > 0 && (
        <Section title={SECTION_LABELS.VISUAL} note="Tap once for OK, twice for NOK, three times to clear. Any NOK makes the check NOK." done={visDone} total={vis.length * n}>
          <thead className="bg-blue-50/70">{header}</thead>
          <tbody className="divide-y divide-slate-100">
            {vis.map((cp, ri) => {
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
                  {shown.map((s, ci) => {
                    const ok = byCell.get(cellKey(cp.uid, s))?.ok ?? null;
                    const photos = photosByCell[cellKey(cp.uid, s)] ?? 0;
                    return (
                      <td key={s} className={`px-1 py-1.5 text-center ${s <= n ? 'bg-emerald-50/60' : 'bg-slate-50'}`}>
                        <button
                          type="button"
                          disabled={readOnly}
                          data-nav="vis" data-row={ri} data-col={ci + 1} data-cp={cp.uid} data-sample={s}
                          onKeyDown={(e) => {
                            const step = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key];
                            if (step && moveFocus(e.currentTarget, step[0], step[1], lastCol)) e.preventDefault();
                          }}
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
                  {spacer}
                  <td className="px-2 text-center"><ResultPill result={results[cp.uid]} /></td>
                  <td className="px-2"><RemarkInput value={cp.inspectorRemark} incharge={cp.inchargeRemark} readOnly={readOnly} onCommit={(v) => onPatch({ entries: [{ checkpointUid: cp.uid, inspectorRemark: v }] })} /></td>
                </tr>
              );
            })}
          </tbody>
        </Section>
      )}

      {rel.length > 0 && (
        <section className="card overflow-hidden">
          <h3 className="px-4 py-2.5 text-sm font-bold text-slate-700 bg-slate-50 border-b border-slate-200">{SECTION_LABELS.RELIABILITY} test</h3>
          <div className="divide-y divide-slate-100">
            {rel.map((cp) => <ReliabilityRow key={cp.uid} cp={cp} readOnly={readOnly} onPatch={onPatch} />)}
          </div>
        </section>
      )}
    </div>
  );
}

const Section = ({ title, note, done, total, children }) => (
  <section className="card overflow-hidden">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 border-b border-slate-200">
      <h3 className="text-sm font-semibold text-slate-900">{title} test</h3>
      <span className="text-xs text-slate-500">{note}</span>
      {total > 0 && (
        <span className="ml-auto flex items-center gap-2 text-xs text-slate-600" aria-label={`${done} of ${total} required entries filled`}>
          <span className="w-24 h-1.5 rounded-full bg-slate-100 overflow-hidden"><span className={`block h-full rounded-full ${done === total ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${(done / total) * 100}%` }} /></span>
          <span className="tabular font-medium">{done}/{total}</span>
        </span>
      )}
    </div>
    <div className="overflow-x-auto"><table className="w-full text-sm">{children}</table></div>
  </section>
);

/** Numeric cell: keeps what is typed locally and commits a valid reading on blur / Enter. */
function DimCell({ cp, sampleNo, row, col, lastCol, value, readOnly, onCommit }) {
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
  // Which limit a NOK reading broke, so the inspector sees "too big" or "too small" at a glance.
  const high = decision === 'NOK' && cp.usl !== null && Number(text) > cp.usl;
  const hint = decision === 'NOK' ? (high ? `Above ${fmtNum(cp.usl)}` : `Below ${fmtNum(cp.lsl)}`) : undefined;
  const Dir = high ? ArrowUp : ArrowDown;
  if (readOnly) {
    return (
      <div title={hint} className={`h-11 flex items-center justify-center gap-0.5 rounded-lg tabular text-sm font-semibold ${decision === 'NOK' ? 'bg-rose-100 text-rose-700' : 'text-slate-800'}`}>
        {text || '—'}{decision === 'NOK' && <Dir className="w-3.5 h-3.5" aria-hidden="true" />}
      </div>
    );
  }
  const onKeyDown = (e) => {
    const el = e.currentTarget;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length;
    let moved = false;
    if (e.key === 'Enter') { commit(); moved = moveFocus(el, 0, 1, lastCol); if (!moved) el.blur(); }
    else if (e.key === 'ArrowDown') moved = moveFocus(el, 1, 0, lastCol);
    else if (e.key === 'ArrowUp') moved = moveFocus(el, -1, 0, lastCol);
    else if (e.key === 'ArrowRight' && atEnd) moved = moveFocus(el, 0, 1, lastCol);
    else if (e.key === 'ArrowLeft' && atStart) moved = moveFocus(el, 0, -1, lastCol);
    if (moved || e.key === 'Enter') e.preventDefault();
  };
  return (
    <div className="relative">
      <input
        inputMode="decimal"
        enterKeyHint="next"
        data-nav="dim" data-row={row} data-col={col} data-cp={cp.uid} data-sample={sampleNo}
        aria-label={`${cp.checkpoint} sample ${sampleNo}`}
        aria-invalid={!valid || decision === 'NOK'}
        aria-description={hint}
        title={hint}
        value={text}
        onFocus={(e) => { focused.current = true; e.currentTarget.select(); }}
        onChange={(e) => setText(e.target.value.replace(',', '.').replace(/[^\d.-]/g, ''))}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className={`w-full h-11 rounded-lg border-2 px-1 text-center text-base tabular font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${
          !valid ? 'border-amber-400 bg-amber-50' : decision === 'NOK' ? 'border-rose-500 bg-rose-100 text-rose-800' : decision === 'OK' ? 'border-emerald-400 bg-white text-emerald-800' : 'border-slate-300 bg-white'
        }`}
      />
      {decision === 'NOK' && <Dir className="absolute right-1 top-1 w-3 h-3 text-rose-600 pointer-events-none" aria-hidden="true" />}
    </div>
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
        data-cp={cp.uid} data-entry
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
