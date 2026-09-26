import { dimensionalDecision, MAX_SAMPLES, readingFlag, toleranceUse } from '@qmas/shared';
import { ArrowDown, ArrowUp, Camera, Check, CheckCheck, MessageSquareText, Paperclip, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Badge from '../../components/ui/Badge.jsx';
import VoiceButton from '../../components/ui/VoiceButton.jsx';
import { formatDate } from '../../utils/format.js';
import { fmtNum } from '../formats/formatHelpers.js';
import InsightChip from './InsightChip.jsx';
import { moveFocus } from './sheetNav.js';

const SAMPLES = Array.from({ length: MAX_SAMPLES }, (_, i) => i + 1);
const cellKey = (uid, s) => `${uid}:${s}`;
const VALID_READING = /^-?\d*(\.\d{0,3})?$/;

const ResultPill = ({ result }) =>
  result === 'OK' ? <Badge variant="success">OK</Badge> : result === 'NOK' ? <Badge variant="danger">NOK</Badge> : <span className="text-xs text-slate-300">—</span>;

/**
 * The inspection report grid, laid out like the JIR sheet and split into tabs by the page
 * (`tab`: 'dim' or 'visrel'; the sign-off tab is the page's own). X1…Xn are the required samples
 * (green); optional ones appear on request. Every change goes out as a save patch through
 * `onPatch`; the parent decides whether it goes to the server or the tablet's queue.
 * `insights` (optional) adds each checkpoint's history, drift and focus, and warns on readings
 * close to a limit or far from the usual values as they are typed.
 */
export default function InspectionSheet({ sheet, tab, readOnly = false, onPatch, photosByCell = {}, onAddPhoto, onOpenPhotos, insights = null }) {
  const insOf = (uid) => insights?.checkpoints?.[uid];
  const focusOf = (uid) => insights?.focus?.find((f) => f.uid === uid);
  const n = sheet.sampleSize;
  const byCell = new Map(sheet.cells.map((c) => [cellKey(c.checkpointUid, c.sampleNo), c]));
  const results = sheet.evaluation?.checkpointResults ?? {};
  const dims = sheet.checkpoints.filter((c) => c.section === 'DIMENSIONAL');
  const vis = sheet.checkpoints.filter((c) => c.section === 'VISUAL');
  const rel = sheet.checkpoints.filter((c) => c.section === 'RELIABILITY');
  const usesOptional = sheet.cells.some((c) => c.sampleNo > n);
  const [optionalOpen, setOptionalOpen] = useState(false);
  const showOptional = optionalOpen || usesOptional;
  const shown = SAMPLES.filter((s) => s <= n || showOptional);
  const lastCol = shown.length;
  const canAddOptional = !showOptional && n < MAX_SAMPLES && !readOnly;

  const th = 'px-2 py-2 text-xs font-semibold text-slate-600 whitespace-nowrap border-b border-slate-200';
  const sampleHeads = (
    <>
      {shown.map((s) => (
        <th key={s} className={`${th} text-center w-[4.5rem] ${s <= n ? 'text-emerald-800 bg-emerald-50/70' : 'text-slate-400'}`} title={s <= n ? 'Required sample' : 'Optional sample'}>X{s}</th>
      ))}
      {canAddOptional && (
        <th className={`${th} w-16`}>
          <button type="button" onClick={() => setOptionalOpen(true)} className="inline-flex items-center gap-0.5 text-[11px] font-medium text-blue-700 hover:underline cursor-pointer" title="Add optional samples">
            <Plus className="w-3 h-3" />X{n + 1}+
          </button>
        </th>
      )}
    </>
  );
  const tail = (
    <>
      <th className={`${th} text-center w-16`}>OK / NOK</th>
    </>
  );
  const spacer = canAddOptional ? <td /> : null;
  // Remarks live with the check point (no separate columns): the inspector's is editable from the
  // small note button; the Incharge's, set during review, is shown under the name.
  const remarkNote = (cp) => (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <RemarkButton who="Inspector" value={cp.inspectorRemark} readOnly={readOnly} context={{ checkpoint: cp.checkpoint, specification: cp.specification ?? undefined, unit: cp.uom ?? undefined }}
        onCommit={(v) => onPatch({ entries: [{ checkpointUid: cp.uid, inspectorRemark: v }] })} />
      {cp.inchargeRemark && <span className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Incharge: {cp.inchargeRemark}</span>}
    </div>
  );

  if (tab === 'dim') {
    if (!dims.length) return <EmptyTab text="This format has no dimensional checks." />;
    return (
      <Table note="Type each reading; Enter moves to the next cell. Out-of-limit readings turn red with an arrow.">
        <thead className="bg-slate-50">
          <tr>
            <th className={`${th} text-left w-12`}>SR</th>
            <th className={`${th} text-left min-w-36`}>Check point</th>
            <th className={`${th} text-right`}>LSL</th>
            <th className={`${th} text-right`}>USL</th>
            <th className={`${th} text-left min-w-32`}>Specification</th>
            <th className={`${th} text-left`}>UOM</th>
            <th className={`${th} text-left`}>Instrument</th>
            {sampleHeads}
            {tail}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {dims.map((cp, ri) => (
            <tr key={cp.uid} className={results[cp.uid] === 'NOK' ? 'bg-rose-50/30' : ''}>
              <td className="px-2 py-1.5 text-slate-500 tabular">{ri + 1}</td>
              <td className="px-2 py-1.5">
                <div className="font-semibold text-slate-900">{cp.checkpoint}</div>
                <InsightChip ins={insOf(cp.uid)} focus={focusOf(cp.uid)} />
                {(!readOnly || cp.inspectorRemark || cp.inchargeRemark) && remarkNote(cp)}
              </td>
              <td className="px-2 py-1.5 text-right tabular text-slate-700">{cp.lsl !== null ? fmtNum(cp.lsl) : '—'}</td>
              <td className="px-2 py-1.5 text-right tabular text-slate-700">{cp.usl !== null ? fmtNum(cp.usl) : '—'}</td>
              <td className="px-2 py-1.5 text-xs text-slate-600">{cp.specification}</td>
              <td className="px-2 py-1.5 text-xs text-slate-600">{cp.uom ?? '—'}</td>
              <td className="px-2 py-1.5 text-xs text-slate-600">{cp.instrument ?? '—'}</td>
              {shown.map((s, ci) => (
                <td key={s} className={`px-1 py-1.5 ${s <= n ? 'bg-emerald-50/40' : ''}`}>
                  <DimCell cp={cp} sampleNo={s} row={ri} col={ci + 1} lastCol={lastCol} value={byCell.get(cellKey(cp.uid, s))?.value ?? null} readOnly={readOnly} stats={insOf(cp.uid)?.stats}
                    onCommit={(value) => onPatch({ cells: [{ checkpointUid: cp.uid, sampleNo: s, value }] })} />
                </td>
              ))}
              {spacer}
              <td className="px-2 text-center"><ResultPill result={results[cp.uid]} /></td>
            </tr>
          ))}
        </tbody>
      </Table>
    );
  }

  if (tab === 'visrel') {
    if (!vis.length && !rel.length) return <EmptyTab text="This format has no visual or reliability checks." />;
    return (
      <div className="space-y-4">
        {vis.length > 0 && (
          <Table title="Visual test" note="Tap once for OK, twice for NOK, three times to clear. Any NOK makes the check NOK.">
            <thead className="bg-slate-50">
              <tr>
                <th className={`${th} text-left w-12`}>SR</th>
                <th className={`${th} text-left min-w-36`}>Check point</th>
                <th className={`${th} text-left min-w-40`}>Specification</th>
                <th className={`${th} text-left`}>Instrument / method</th>
                {sampleHeads}
                {tail}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vis.map((cp, ri) => {
                const emptyRequired = SAMPLES.filter((s) => s <= n && byCell.get(cellKey(cp.uid, s))?.ok == null);
                return (
                  <tr key={cp.uid} className={results[cp.uid] === 'NOK' ? 'bg-rose-50/30' : ''}>
                    <td className="px-2 py-1.5 text-slate-500 tabular align-top pt-3">{ri + 1}</td>
                    <td className="px-2 py-1.5 align-top pt-2.5">
                      <div className="font-semibold text-slate-900">{cp.checkpoint}</div>
                      <InsightChip ins={insOf(cp.uid)} focus={focusOf(cp.uid)} />
                      {(!readOnly || cp.inspectorRemark || cp.inchargeRemark) && remarkNote(cp)}
                      {!readOnly && (
                        <div className="mt-1 flex gap-1">
                          {emptyRequired.length > 0 && (
                            <button type="button" onClick={() => onPatch({ cells: emptyRequired.map((s) => ({ checkpointUid: cp.uid, sampleNo: s, ok: true })) })}
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800 cursor-pointer hover:bg-emerald-100">
                              <CheckCheck className="w-3.5 h-3.5" />All OK
                            </button>
                          )}
                          {onAddPhoto && (
                            <button type="button" onClick={() => onAddPhoto(cp)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 cursor-pointer hover:bg-slate-50">
                              <Camera className="w-3.5 h-3.5" />Photo
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs text-slate-600 align-top pt-3">{cp.specification}</td>
                    <td className="px-2 py-1.5 text-xs text-slate-600 align-top pt-3">{cp.instrument ?? 'Visual'}</td>
                    {shown.map((s, ci) => {
                      const ok = byCell.get(cellKey(cp.uid, s))?.ok ?? null;
                      const photos = photosByCell[cellKey(cp.uid, s)] ?? 0;
                      return (
                        <td key={s} className={`px-1 py-1.5 text-center ${s <= n ? 'bg-emerald-50/40' : ''}`}>
                          <button
                            type="button"
                            disabled={readOnly}
                            data-nav="vis" data-row={ri} data-col={ci + 1} data-cp={cp.uid} data-sample={s}
                            onKeyDown={(e) => {
                              const step = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key];
                              if (step && moveFocus(e.currentTarget, step[0], step[1], lastCol)) e.preventDefault();
                            }}
                            aria-label={`${cp.checkpoint} X${s}: ${ok === true ? 'OK' : ok === false ? 'NOK' : 'empty'}`}
                            onClick={() => onPatch({ cells: [{ checkpointUid: cp.uid, sampleNo: s, ok: ok === null ? true : ok === true ? false : null }] })}
                            className={`w-full h-10 rounded-lg border-2 flex items-center justify-center transition-colors cursor-pointer disabled:cursor-default ${
                              ok === true ? 'border-emerald-400 bg-emerald-100 text-emerald-800' : ok === false ? 'border-rose-500 bg-rose-100 text-rose-800' : 'border-dashed border-slate-300 bg-white text-slate-300'
                            }`}
                          >
                            {ok === true ? <Check className="w-5 h-5" /> : ok === false ? <X className="w-5 h-5" /> : null}
                          </button>
                          {photos > 0 && (
                            <button type="button" onClick={() => onOpenPhotos?.(cp, s)} className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-700 cursor-pointer">
                              <Paperclip className="w-3 h-3" />{photos}
                            </button>
                          )}
                        </td>
                      );
                    })}
                    {spacer}
                    <td className="px-2 text-center"><ResultPill result={results[cp.uid]} /></td>
                        </tr>
                );
              })}
            </tbody>
          </Table>
        )}

        {rel.length > 0 && (
          <Table title="Reliability test" note="Tests are due by frequency for this item and vendor; a test that is not due can be skipped.">
            <thead className="bg-slate-50">
              <tr>
                <th className={`${th} text-left w-12`}>SR</th>
                <th className={`${th} text-left min-w-36`}>Check point</th>
                <th className={`${th} text-left min-w-40`}>Specification</th>
                <th className={`${th} text-left`}>Frequency</th>
                <th className={`${th} text-left min-w-64`}>Observation</th>
                <th className={`${th} text-center w-32`}>OK / NOK</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rel.map((cp, ri) => <ReliabilityRow key={cp.uid} sr={ri + 1} cp={cp} readOnly={readOnly} onPatch={onPatch} remarks={remarkNote(cp)} chip={<InsightChip ins={insOf(cp.uid)} focus={focusOf(cp.uid)} />} />)}
            </tbody>
          </Table>
        )}
      </div>
    );
  }
  return null;
}

const EmptyTab = ({ text }) => <div className="card p-8 text-center text-sm text-slate-500">{text}</div>;

const Table = ({ title, note, children }) => (
  <section className="card overflow-hidden">
    {(title || note) && (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 border-b border-slate-200">
        {title && <h3 className="text-sm font-semibold text-slate-900">{title}</h3>}
        {note && <span className="text-xs text-slate-500">{note}</span>}
      </div>
    )}
    <div className="overflow-x-auto"><table className="w-full text-sm">{children}</table></div>
  </section>
);

/**
 * Remark column: an icon that shows whether there is a remark; opens a small editor (inspector) or
 * reader (Incharge, whose remarks come from the review).
 */
function RemarkButton({ who, value, readOnly, onCommit, context }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ?? '');
  const ref = useRef(null);
  useEffect(() => setText(value ?? ''), [value]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const save = () => {
    if ((text.trim() || null) !== (value ?? null)) onCommit?.(text.trim() || null);
    setOpen(false);
  };
  if (readOnly && !value) return null;
  const tone = value ? 'text-blue-800 bg-blue-50 border-blue-200' : 'text-slate-500 border-slate-200 hover:border-slate-400';
  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" onClick={() => setOpen((o) => !o)} title={value ?? 'Add a remark'} aria-label={`${who} remark${value ? `: ${value}` : ''}`}
        className={`max-w-48 h-7 px-1.5 rounded-md border inline-flex items-center gap-1 text-[11px] cursor-pointer ${tone}`}>
        <MessageSquareText className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{value ?? 'Remark'}</span>
      </button>
      {open && (
        <div className="animate-fadeIn absolute left-0 top-8 z-30 w-64 card shadow-lift p-3 text-left">
          <p className="text-xs font-medium text-slate-600 mb-1.5">{who} remark</p>
          {readOnly ? (
            <p className="text-sm text-slate-800 whitespace-pre-line">{value}</p>
          ) : (
            <>
              <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={3}
                className="w-full px-2.5 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500" />
              <VoiceButton className="mt-1.5" context={context} onText={(t) => setText((cur) => (cur.trim() ? `${cur.trim()} ${t}` : t).slice(0, 500))} />
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="px-2.5 py-1 text-xs rounded-md text-slate-600 hover:bg-slate-100 cursor-pointer">Cancel</button>
                <button type="button" onClick={save} className="px-2.5 py-1 text-xs rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 cursor-pointer">Save remark</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Numeric cell: keeps what is typed locally and commits a valid reading on blur / Enter. */
function DimCell({ cp, sampleNo, row, col, lastCol, value, readOnly, onCommit, stats }) {
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
  // In spec but worth a second look: close to a limit, or far from this item's usual values.
  const flag = decision === 'OK' ? readingFlag(Number(text), cp, stats) : null;
  const hint = decision === 'NOK' ? (high ? `Above ${fmtNum(cp.usl)}` : `Below ${fmtNum(cp.lsl)}`)
    : flag === 'NEAR_LIMIT' ? `In spec, but uses ${Math.round(toleranceUse(Number(text), cp, stats?.mean ?? null) * 100)} % of the tolerance`
      : flag === 'UNUSUAL' ? `In spec, but unusual: this item's readings are usually around ${fmtNum(stats.mean)}` : undefined;
  const Dir = high ? ArrowUp : ArrowDown;
  if (readOnly) {
    return (
      <div title={hint} className={`h-10 flex items-center justify-center gap-0.5 rounded-lg tabular text-sm font-semibold ${decision === 'NOK' ? 'bg-rose-100 text-rose-800' : flag ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-300' : 'text-slate-800'}`}>
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
        aria-label={`${cp.checkpoint} X${sampleNo}`}
        aria-invalid={!valid || decision === 'NOK'}
        aria-description={hint}
        title={hint}
        placeholder={`X${sampleNo}`}
        value={text}
        onFocus={(e) => { focused.current = true; e.currentTarget.select(); }}
        onChange={(e) => setText(e.target.value.replace(',', '.').replace(/[^\d.-]/g, ''))}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className={`w-full h-10 rounded-lg border-2 px-1 text-center text-[15px] tabular font-semibold placeholder:font-normal placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${
          !valid ? 'border-amber-400 bg-amber-50' : decision === 'NOK' ? 'border-rose-500 bg-rose-100 text-rose-800' : flag ? 'border-amber-400 bg-amber-50 text-amber-900' : decision === 'OK' ? 'border-emerald-400 bg-white text-emerald-800' : 'border-slate-300 bg-white'
        }`}
      />
      {decision === 'NOK' && <Dir className="absolute right-1 top-1 w-3 h-3 text-rose-600 pointer-events-none" aria-hidden="true" />}
      {flag && <span className="absolute right-1 top-1 w-1.5 h-1.5 rounded-full bg-amber-500 pointer-events-none" aria-hidden="true" />}
    </div>
  );
}

function ReliabilityRow({ sr, cp, readOnly, onPatch, remarks, chip }) {
  const [text, setText] = useState(cp.textObservation ?? '');
  useEffect(() => setText(cp.textObservation ?? ''), [cp.textObservation]);
  const due = cp.isRequired;
  return (
    <tr className={due ? '' : 'bg-slate-50/70'}>
      <td className="px-2 py-2 text-slate-500 tabular align-top pt-3">{sr}</td>
      <td className="px-2 py-2 align-top">
        <div className="font-semibold text-slate-900">{cp.checkpoint}</div>
        <div className="mt-1">{due ? <Badge variant="warning">Due on this lot</Badge> : <Badge variant="neutral">Not due</Badge>}</div>
        {chip}
        {(!readOnly || cp.inspectorRemark || cp.inchargeRemark) && remarks}
      </td>
      <td className="px-2 py-2 text-xs text-slate-600 align-top pt-3">{cp.specification}</td>
      <td className="px-2 py-2 text-xs text-slate-600 align-top pt-3 whitespace-nowrap">
        {cp.frequencyMonths ? `Every ${cp.frequencyMonths} months` : 'Every lot'}
        <div className="text-slate-400">{cp.lastTestedAt ? `last ${formatDate(cp.lastTestedAt)}` : 'never tested'}</div>
      </td>
      <td className="px-2 py-2 align-top">
        <textarea
          data-cp={cp.uid} data-entry
          aria-label={`${cp.checkpoint} observation`}
          disabled={readOnly}
          value={text}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => (text || null) !== (cp.textObservation ?? null) && onPatch({ entries: [{ checkpointUid: cp.uid, textObservation: text || null }] })}
          placeholder={due ? 'What was observed (required)' : 'What was observed (if tested)'}
          className="w-full px-2.5 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 disabled:bg-transparent disabled:border-transparent"
        />
        {!readOnly && (
          <VoiceButton className="mt-1" context={{ checkpoint: cp.checkpoint, specification: cp.specification ?? undefined }}
            onText={(t) => {
              const next = text.trim() ? `${text.trim()} ${t}` : t;
              setText(next);
              onPatch({ entries: [{ checkpointUid: cp.uid, textObservation: next }] });
            }} />
        )}
      </td>
      <td className="px-2 py-2 align-top">
        <div className="flex rounded-lg border border-slate-300 overflow-hidden" role="radiogroup" aria-label={`${cp.checkpoint} result`}>
          {['OK', 'NOK'].map((r) => (
            <button key={r} type="button" disabled={readOnly} role="radio" aria-checked={cp.manualResult === r}
              onClick={() => onPatch({ entries: [{ checkpointUid: cp.uid, manualResult: cp.manualResult === r ? null : r }] })}
              className={`flex-1 h-10 text-sm font-bold cursor-pointer disabled:cursor-default transition-colors ${
                cp.manualResult === r ? (r === 'OK' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white') : 'bg-white text-slate-400 hover:bg-slate-50'
              }`}>
              {r}
            </button>
          ))}
        </div>
      </td>
    </tr>
  );
}
