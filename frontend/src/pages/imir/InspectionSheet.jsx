import { dimensionalDecision, MAX_SAMPLES, readingFlag, recordDecision, toleranceUse } from '@qmas/shared';
import { ArrowDown, ArrowUp, Camera, Check, CheckCheck, MessageSquareText, Paperclip, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Badge from '../../components/ui/Badge.jsx';
import PopMenu from '../../components/ui/PopMenu.jsx';
import VoiceButton from '../../components/ui/VoiceButton.jsx';
import { formatDate } from '../../utils/format.js';
import { fmtNum } from '../formats/formatHelpers.js';
import InsightChip from './InsightChip.jsx';
import { groupsOf, moveFocus } from './sheetNav.js';

const SAMPLES = Array.from({ length: MAX_SAMPLES }, (_, i) => i + 1);
const cellKey = (uid, s) => `${uid}:${s}`;
const VALID_READING = /^-?\d*(\.\d{0,3})?$/;

/**
 * The reading that decides a dimensional check: the one furthest out of spec, else the one using
 * most of the tolerance. Shown in the Result column (red: out of spec, amber: close to a limit).
 */
function worstReading(cp, readings, stats) {
  let best = null;
  for (const v of readings) {
    const nok = dimensionalDecision(v, cp) === 'NOK';
    const use = toleranceUse(v, cp, stats?.mean ?? null) ?? 0;
    const score = (nok ? 10 : 0) + use;
    if (!best || score > best.score) best = { value: v, score, nok, flag: nok ? null : readingFlag(v, cp, stats) };
  }
  return best;
}

const ReadingResult = ({ worst }) =>
  worst ? (
    <span className={`inline-flex min-w-14 justify-center rounded-md px-2 py-1 text-sm font-bold tabular ${worst.nok ? 'bg-rose-100 text-rose-700' : worst.flag ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>
      {fmtNum(worst.value)}
    </span>
  ) : <span className="text-xs text-slate-300">—</span>;

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
export default function InspectionSheet({ sheet, tab, readOnly = false, onPatch, photosByCell = {}, onAddPhoto, onOpenPhotos, insights = null, filter = '', flat = false }) {
  const insOf = (uid) => insights?.checkpoints?.[uid];
  const focusOf = (uid) => insights?.focus?.find((f) => f.uid === uid);
  const n = sheet.sampleSize;
  const byCell = new Map(sheet.cells.map((c) => [cellKey(c.checkpointUid, c.sampleNo), c]));
  const results = sheet.evaluation?.checkpointResults ?? {};
  // The page's search box: check point, specification, instrument or help text.
  const q = filter.trim().toLowerCase();
  const matches = (c) => !q || [c.checkpoint, c.specification, c.instrument, c.helpText, c.groupLabel].some((v) => v && String(v).toLowerCase().includes(q));
  const dims = sheet.checkpoints.filter((c) => c.section === 'DIMENSIONAL' && matches(c));
  const vis = sheet.checkpoints.filter((c) => c.section === 'VISUAL' && matches(c));
  const rel = sheet.checkpoints.filter((c) => c.section === 'RELIABILITY' && matches(c));
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
        <th key={s} className={`${th} text-center w-18 ${s <= n ? 'text-emerald-800 bg-emerald-50/70' : 'text-slate-400'}`} title={s <= n ? 'Required sample' : 'Optional sample'}>X{s}</th>
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
      <th className={`${th} text-center w-16`}>Status</th>
      <th className={`${th} text-left w-48`}>Remark</th>
    </>
  );
  const spacer = canAddOptional ? <td /> : null;
  // Remarks: the inspector's is editable from the note button; the Incharge's, set during review, is
  // shown below it. The tables give them their own column; lot details keep them under the field.
  const remarkNote = (cp) => (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <RemarkButton who="Inspector" value={cp.inspectorRemark} readOnly={readOnly} context={{ checkpoint: cp.checkpoint, specification: cp.specification ?? undefined, unit: cp.uom ?? undefined }}
        onCommit={(v) => onPatch({ entries: [{ checkpointUid: cp.uid, inspectorRemark: v }] })} />
      {cp.inchargeRemark && <span className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Incharge: {cp.inchargeRemark}</span>}
    </div>
  );
  const remarkCell = (cp, top = false) => (
    <td className={`px-2 py-1.5 w-48 min-w-36 max-w-48 ${top ? 'align-top pt-2.5' : ''}`}>
      {!readOnly || cp.inspectorRemark || cp.inchargeRemark ? (
        <div className="flex flex-col items-start gap-1">
          <RemarkInput checkpoint={cp.checkpoint} value={cp.inspectorRemark} readOnly={readOnly}
            onCommit={(v) => onPatch({ entries: [{ checkpointUid: cp.uid, inspectorRemark: v }] })} />
          {cp.inchargeRemark && <span title={cp.inchargeRemark} className="max-w-full line-clamp-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Incharge: {cp.inchargeRemark}</span>}
        </div>
      ) : <span className="text-slate-300">—</span>}
    </td>
  );

  if (tab === 'lot') {
    const recs = sheet.checkpoints.filter((c) => c.section === 'RECORD');
    if (!recs.length) return <EmptyTab text="This format has no lot details." />;
    return (
      <div className={flat ? '' : 'space-y-4'}>
        {groupsOf(recs, 'Lot details').map((g) => (
          <section key={g.label} className={flat ? 'border-b border-slate-200 last:border-b-0' : 'card'}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">{g.label}</h3>
              <span className="text-xs text-slate-500">Recorded once for the whole lot. Fields marked * are required.</span>
            </div>
            <div className="p-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
              {g.items.map((cp) => <RecordField key={cp.uid} cp={cp} result={results[cp.uid]} readOnly={readOnly} onPatch={onPatch} remarks={(!readOnly || cp.inspectorRemark || cp.inchargeRemark) && remarkNote(cp)} />)}
            </div>
          </section>
        ))}
      </div>
    );
  }

  if (tab === 'dim') {
    if (!dims.length) return <EmptyTab text={q ? `No dimensional check matches “${filter.trim()}”.` : 'This format has no dimensional checks.'} />;
    // Rows are numbered across the section's tables so Enter / arrows run through all of them.
    const dimGroups = groupsOf(dims, 'Dimensional test');
    const rowIndex = new Map(dims.map((cp, i) => [cp.uid, i]));
    return (
      <div className="space-y-4">
      {dimGroups.map((g) => (
      <Table flat={flat} key={g.label} title={dimGroups.length > 1 || g.custom ? g.label : undefined} note="Type each reading; Enter moves to the next cell. Out-of-limit readings turn red with an arrow.">
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
            <th className={`${th} text-center w-20`}>Result</th>
            {tail}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {g.items.map((cp, gi) => { const ri = rowIndex.get(cp.uid); return (
            <tr key={cp.uid} className={results[cp.uid] === 'NOK' ? 'bg-rose-50/30' : ''}>
              <td className="px-2 py-1.5 text-slate-500 tabular">{gi + 1}</td>
              <td className="px-2 py-1.5">
                <div className="font-semibold text-slate-900">{cp.checkpoint}</div>
                {cp.helpText && <div className="text-[11px] text-slate-400">{cp.helpText}</div>}
                <InsightChip ins={insOf(cp.uid)} focus={focusOf(cp.uid)} />
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
              <td className="px-2 text-center"><ReadingResult worst={worstReading(cp, shown.map((x) => byCell.get(cellKey(cp.uid, x))?.value).filter((v) => v !== null && v !== undefined), insOf(cp.uid)?.stats)} /></td>
              <td className="px-2 text-center"><ResultPill result={results[cp.uid]} /></td>
              {remarkCell(cp)}
            </tr>
          ); })}
        </tbody>
      </Table>
      ))}
      </div>
    );
  }

  if (tab === 'visrel') {
    if (!vis.length && !rel.length) return <EmptyTab text={q ? `No visual or reliability check matches “${filter.trim()}”.` : 'This format has no visual or reliability checks.'} />;
    return (
      <div className="space-y-4">
        {groupsOf(vis, 'Visual test').map((g) => (
          <Table flat={flat} key={g.label} title={g.label} note={g.items.some((c) => c.inputType === 'CHOICE') ? 'Pick an option per sample, or tap once for OK, twice for NOK. A failing option or a NOK makes the check NOK.' : 'Tap once for OK, twice for NOK, three times to clear. Any NOK makes the check NOK.'}>
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
              {g.items.map((cp) => {
                const ri = vis.indexOf(cp);
                const choice = cp.inputType === 'CHOICE';
                const firstPass = (cp.options ?? []).findIndex((o) => o.pass !== false);
                const emptyRequired = SAMPLES.filter((s) => s <= n && (choice ? byCell.get(cellKey(cp.uid, s))?.value == null : byCell.get(cellKey(cp.uid, s))?.ok == null));
                return (
                  <tr key={cp.uid} className={results[cp.uid] === 'NOK' ? 'bg-rose-50/30' : ''}>
                    <td className="px-2 py-1.5 text-slate-500 tabular align-top pt-3">{g.items.indexOf(cp) + 1}</td>
                    <td className="px-2 py-1.5 align-top pt-2.5">
                      <div className="font-semibold text-slate-900">{cp.checkpoint}</div>
                      {cp.helpText && <div className="text-[11px] text-slate-400">{cp.helpText}</div>}
                      <InsightChip ins={insOf(cp.uid)} focus={focusOf(cp.uid)} />
                      {!readOnly && (
                        <div className="mt-1 flex gap-1">
                          {emptyRequired.length > 0 && (
                            <button type="button" onClick={() => onPatch({ cells: emptyRequired.map((s) => (choice ? { checkpointUid: cp.uid, sampleNo: s, value: firstPass } : { checkpointUid: cp.uid, sampleNo: s, ok: true })) })}
                              title={choice ? `Set the empty samples to "${cp.options?.[firstPass]?.label}"` : 'Set the empty samples to OK'}
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800 cursor-pointer hover:bg-emerald-100">
                              <CheckCheck className="w-3.5 h-3.5" />{choice ? `All ${cp.options?.[firstPass]?.label ?? 'pass'}` : 'All OK'}
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
                    <td className="px-2 py-1.5 text-xs text-slate-600 align-top pt-3">
                      {cp.specification}
                      {choice && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {(cp.options ?? []).map((o) => <span key={o.label} className={`rounded px-1 text-[10px] font-medium ${o.pass === false ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{o.label}</span>)}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs text-slate-600 align-top pt-3">{cp.instrument ?? 'Visual'}</td>
                    {shown.map((s, ci) => {
                      const ok = byCell.get(cellKey(cp.uid, s))?.ok ?? null;
                      const photos = photosByCell[cellKey(cp.uid, s)] ?? 0;
                      if (choice) {
                        const value = byCell.get(cellKey(cp.uid, s))?.value ?? null;
                        const opt = value === null ? null : cp.options?.[value];
                        return (
                          <td key={s} className={`px-1 py-1.5 text-center ${s <= n ? 'bg-emerald-50/40' : ''}`}>
                            <select value={value ?? ''} disabled={readOnly} data-cp={cp.uid} data-sample={s} aria-label={`${cp.checkpoint} X${s}`}
                              onChange={(e) => onPatch({ cells: [{ checkpointUid: cp.uid, sampleNo: s, value: e.target.value === '' ? null : Number(e.target.value) }] })}
                              className={`w-full h-10 rounded-lg border-2 px-1 text-xs font-semibold cursor-pointer disabled:cursor-default ${opt ? (opt.pass === false ? 'border-rose-500 bg-rose-100 text-rose-800' : 'border-emerald-400 bg-emerald-100 text-emerald-800') : 'border-dashed border-slate-300 bg-white text-slate-400'}`}>
                              <option value="">–</option>
                              {(cp.options ?? []).map((o, i) => <option key={o.label} value={i}>{o.label}</option>)}
                            </select>
                            {photos > 0 && (
                              <button type="button" onClick={() => onOpenPhotos?.(cp, s)} className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-700 cursor-pointer">
                                <Paperclip className="w-3 h-3" />{photos}
                              </button>
                            )}
                          </td>
                        );
                      }
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
                    {remarkCell(cp, true)}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ))}

        {groupsOf(rel, 'Reliability test').map((g) => (
          <Table flat={flat} key={g.label} title={g.label} note="Tests are due by frequency for this item and vendor; a test that is not due can be skipped.">
            <thead className="bg-slate-50">
              <tr>
                <th className={`${th} text-left w-12`}>SR</th>
                <th className={`${th} text-left min-w-36`}>Check point</th>
                <th className={`${th} text-left min-w-40`}>Specification</th>
                <th className={`${th} text-left`}>Frequency</th>
                <th className={`${th} text-left min-w-64`}>Observation</th>
                <th className={`${th} text-center w-32`}>Status</th>
                <th className={`${th} text-left w-48`}>Remark</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {g.items.map((cp, ri) => <ReliabilityRow key={cp.uid} sr={ri + 1} cp={cp} readOnly={readOnly} onPatch={onPatch} remarks={remarkCell(cp, true)} chip={<InsightChip ins={insOf(cp.uid)} focus={focusOf(cp.uid)} />} />)}
            </tbody>
          </Table>
        ))}
      </div>
    );
  }
  return null;
}

/**
 * One lot detail (format builder): text, number, date, yes / no or a choice, saved as the entry's
 * observation. Text and numbers save when the field is left; choices at once. Shows OK / NOK when
 * the field has a pass rule.
 */
function RecordField({ cp, result, readOnly, onPatch, remarks }) {
  const [text, setText] = useState(cp.textObservation ?? '');
  const [prev, setPrev] = useState(cp.textObservation);
  if (cp.textObservation !== prev) {
    setPrev(cp.textObservation);
    setText(cp.textObservation ?? '');
  }
  const commit = (v) => {
    const value = v.trim() === '' ? null : v.trim();
    if (value !== (cp.textObservation ?? null)) onPatch({ entries: [{ checkpointUid: cp.uid, textObservation: value }] });
  };
  const decides = cp.inputType === 'NUMBER' ? cp.lsl !== null || cp.usl !== null : (cp.options ?? []).some((o) => o.pass === false);
  // Live OK / NOK while typing a number, before it is saved.
  const live = cp.inputType === 'NUMBER' && text !== '' ? recordDecision(cp, text) : result;
  const required = cp.isRequired !== false;
  const empty = required && !cp.textObservation;
  const cls = `w-full h-10 rounded-lg border px-3 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 disabled:bg-slate-50 ${
    live === 'NOK' ? 'border-rose-400 bg-rose-50 text-rose-800 font-semibold' : live === 'OK' ? 'border-emerald-300 bg-emerald-50/40' : empty ? 'border-amber-300 bg-amber-50/40' : 'border-slate-300 bg-white'}`;
  const limits = cp.inputType === 'NUMBER' && decides ? `${cp.lsl ?? '–'} to ${cp.usl ?? '–'}${cp.uom ? ` ${cp.uom}` : ''}` : null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <label htmlFor={`rec-${cp.uid}`} className="text-sm font-medium text-slate-800">{cp.checkpoint}{required && <span className="text-rose-500"> *</span>}</label>
        {decides && <span className="ml-auto"><ResultPill result={live} /></span>}
      </div>
      {cp.inputType === 'YES_NO' || cp.inputType === 'CHOICE' ? (
        cp.inputType === 'YES_NO' ? (
          <div className="flex gap-2" data-cp={cp.uid} data-entry tabIndex={-1}>
            {(cp.options ?? []).map((o) => {
              const on = (cp.textObservation ?? '').toLowerCase() === o.label.toLowerCase();
              return (
                <button key={o.label} type="button" disabled={readOnly} aria-pressed={on} onClick={() => onPatch({ entries: [{ checkpointUid: cp.uid, textObservation: on ? null : o.label }] })}
                  className={`flex-1 h-10 rounded-lg border-2 text-sm font-semibold cursor-pointer disabled:cursor-default ${on ? (o.pass === false && decides ? 'border-rose-500 bg-rose-100 text-rose-800' : 'border-emerald-400 bg-emerald-100 text-emerald-800') : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                  {o.label}
                </button>
              );
            })}
          </div>
        ) : (
          <select id={`rec-${cp.uid}`} data-cp={cp.uid} data-entry value={cp.textObservation ?? ''} disabled={readOnly}
            onChange={(e) => onPatch({ entries: [{ checkpointUid: cp.uid, textObservation: e.target.value || null }] })} className={`${cls} cursor-pointer`}>
            <option value="">Choose…</option>
            {(cp.options ?? []).map((o) => <option key={o.label} value={o.label}>{o.label}</option>)}
          </select>
        )
      ) : (
        <input id={`rec-${cp.uid}`} data-cp={cp.uid} data-entry disabled={readOnly} value={text}
          type={cp.inputType === 'DATE' ? 'date' : 'text'} inputMode={cp.inputType === 'NUMBER' ? 'decimal' : undefined}
          placeholder={cp.inputType === 'NUMBER' ? (limits ?? cp.uom ?? 'Number') : cp.specification ?? ''}
          onChange={(e) => {
            const v = cp.inputType === 'NUMBER' ? e.target.value.replace(/[^\d.-]/g, '') : e.target.value;
            setText(v);
            if (cp.inputType === 'DATE') commit(v);
          }}
          onBlur={(e) => cp.inputType !== 'DATE' && commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className={cls} />
      )}
      <div className="mt-1 text-[11px] text-slate-500">
        {limits && <span>Limits {limits}. </span>}
        {cp.inputType === 'NUMBER' && !limits && cp.uom && <span>In {cp.uom}. </span>}
        {cp.helpText}
      </div>
      {remarks}
    </div>
  );
}

const EmptyTab = ({ text }) => <div className="p-8 text-center text-sm text-slate-500">{text}</div>;

const Table = ({ title, note, flat, children }) => (
  <section className={flat ? 'border-b border-slate-200 last:border-b-0' : 'card overflow-hidden'}>
    {(title || note) && (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 border-b border-slate-200">
        {title && <h3 className="text-sm font-semibold text-slate-900">{title}</h3>}
        {note && <span className="text-xs text-slate-500">{note}</span>}
      </div>
    )}
    <div className="overflow-x-auto"><table className="w-full text-sm">{children}</table></div>
  </section>
);

/** Remark text box in the table: saves when you leave it or press Enter; Esc undoes the edit. */
function RemarkInput({ checkpoint, value, readOnly, onCommit }) {
  const [text, setText] = useState(value ?? '');
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setText(value ?? '');
  }
  if (readOnly) return <p className="text-xs text-slate-700 whitespace-pre-line wrap-break-word">{value}</p>;
  const commit = () => {
    const next = text.trim() || null;
    if (next !== (value ?? null)) onCommit(next);
  };
  return (
    <input value={text} maxLength={500} placeholder="Remark" aria-label={`${checkpoint} remark`} title={text || undefined}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setText(value ?? ''); e.currentTarget.blur(); }
      }}
      className={`h-9 w-full rounded-lg border px-2.5 text-xs outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 ${text ? 'border-blue-200 bg-blue-50/40 text-slate-800' : 'border-slate-200 bg-white'}`} />
  );
}

/**
 * Remark button: shows the remark (or "Add remark"); opens a small editor (inspector) or reader
 * (Incharge, whose remarks come from the review). The editor opens above the page, so the table's
 * scroll box never cuts it off.
 */
function RemarkButton({ who, value, readOnly, onCommit, context, block = false }) {
  const [text, setText] = useState(value ?? '');
  if (readOnly && !value) return null;
  const save = (close) => {
    if ((text.trim() || null) !== (value ?? null)) onCommit?.(text.trim() || null);
    close();
  };
  const tone = value ? 'text-blue-800 bg-blue-50 border-blue-200' : 'text-slate-500 border-slate-200 hover:border-slate-400';
  return (
    <PopMenu align="left" width="w-72" role="dialog" className="p-3 text-left" button={({ toggle }) => (
      <button type="button" onClick={() => { setText(value ?? ''); toggle(); }} title={value ?? 'Add a remark'} aria-label={`${who} remark${value ? `: ${value}` : ''}`}
        className={`${block ? 'w-full max-w-44' : 'max-w-48'} min-h-7 px-1.5 py-1 rounded-md border inline-flex items-start gap-1 text-left text-[11px] cursor-pointer ${tone}`}>
        <MessageSquareText className="w-3.5 h-3.5 shrink-0 mt-px" />
        <span className={value ? (block ? 'line-clamp-2 wrap-break-word' : 'truncate') : 'whitespace-nowrap'}>{value ?? 'Add remark'}</span>
      </button>
    )}>
      {({ close }) => (
        <>
          <p className="text-xs font-medium text-slate-600 mb-1.5">{who} remark</p>
          {readOnly ? (
            <p className="text-sm text-slate-800 whitespace-pre-line">{value}</p>
          ) : (
            <>
              <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={3}
                onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && save(close)}
                className="w-full px-2.5 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500" />
              <VoiceButton className="mt-1.5" context={context} onText={(t) => setText((cur) => (cur.trim() ? `${cur.trim()} ${t}` : t).slice(0, 500))} />
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={close} className="px-2.5 py-1 text-xs rounded-md text-slate-600 hover:bg-slate-100 cursor-pointer">Cancel</button>
                <button type="button" onClick={() => save(close)} className="px-2.5 py-1 text-xs rounded-md bg-blue-600 text-white font-semibold hover:bg-blue-700 cursor-pointer">Save remark</button>
              </div>
            </>
          )}
        </>
      )}
    </PopMenu>
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
      {remarks}
    </tr>
  );
}
