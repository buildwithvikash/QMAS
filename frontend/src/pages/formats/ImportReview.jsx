import { AlertTriangle, CheckCircle2, Eye, Info, Plus, RefreshCw, Table2, Trash2, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { askConfirm } from '../../app/confirm.js';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { FormatContent } from './formatUi.jsx';

const SECTIONS = ['Dimensional', 'Visual', 'Reliability'];
const ITEM_STATUS = { READY: ['Ready', 'success'], SKIP: ['Skipped', 'neutral'], ERROR: ['Needs fixing', 'danger'], IMPORTED: ['Imported', 'info'] };

// Editable columns of a checkpoint row (the item columns are edited once, above the grid).
const COLS = [
  { key: 'section', label: 'Section', w: 'w-32', type: 'section' },
  { key: 'checkpoint', label: 'Check point', w: 'min-w-40' },
  { key: 'specification', label: 'Specification', w: 'min-w-40' },
  { key: 'nominal', label: 'Nominal', w: 'w-20', num: true },
  { key: 'lsl', label: 'LSL', w: 'w-20', num: true },
  { key: 'usl', label: 'USL', w: 'w-20', num: true },
  { key: 'uom', label: 'UOM', w: 'w-20' },
  { key: 'instrument', label: 'Instrument / method', w: 'min-w-32' },
  { key: 'frequency', label: 'Frequency', w: 'w-32', hint: 'Reliability only: months, or text like "Once in six months"' },
];
const HEAD = [
  { key: 'itemCode', label: 'Item code' },
  { key: 'itemDescription', label: 'Item description', wide: true },
  { key: 'formatNo', label: 'Format no.' },
  { key: 'commonFormatNo', label: 'Common format no.' },
];

const show = (v) => (v === null || v === undefined ? '' : String(v));
const firstOf = (rows, key) => rows.find((r) => show(r[key]).trim())?.[key] ?? '';
const sectionLabel = (v) => {
  const s = show(v).trim().toUpperCase();
  return s.startsWith('DIM') ? 'Dimensional' : s.startsWith('VIS') ? 'Visual' : s.startsWith('REL') ? 'Reliability' : show(v);
};

let nextKey = 0;
const withKeys = (rows) => rows.map((r) => ({ ...r, _k: (nextKey += 1) }));

/**
 * Check and correct one item of an import before it is saved: every checkpoint row as it came from
 * the file (editable), the problems found in each row, and a preview of the format as it will be
 * created. "Apply & re-check" sends the corrected rows back for checking; nothing is saved until
 * Import on the page.
 */
export default function ImportReview({ item, onApply, onRemove, onClose, checking }) {
  const [rows, setRows] = useState(() => withKeys(item.rows));
  const [head, setHead] = useState(() => Object.fromEntries(HEAD.map((h) => [h.key, show(h.key === 'itemCode' ? item.itemCode ?? firstOf(item.rows, 'itemCode') : firstOf(item.rows, h.key))])));
  const [tab, setTab] = useState(item.status === 'ERROR' ? 'edit' : 'preview');
  const [dirty, setDirty] = useState(false);

  // Messages by row number; messages without a row are about the whole item.
  const byRow = useMemo(() => {
    const m = new Map();
    for (const x of item.messages) {
      const k = x.row ?? 'item';
      m.set(k, [...(m.get(k) ?? []), x]);
    }
    return m;
  }, [item.messages]);
  const itemMessages = byRow.get('item') ?? [];
  const rowErrors = [...byRow.entries()].filter(([k, list]) => k !== 'item' && list.some((x) => x.level === 'error')).length;

  const setCell = (k, key, value) => {
    setRows((rs) => rs.map((r) => (r._k === k ? { ...r, [key]: value === '' ? null : value } : r)));
    setDirty(true);
  };
  const setHeadField = (key, value) => {
    setHead((h) => ({ ...h, [key]: value }));
    setDirty(true);
  };
  const addRow = () => {
    const last = rows.at(-1);
    setRows((rs) => [...rs, ...withKeys([{ rowNo: null, section: last?.section ?? 'Dimensional', checkpoint: null, specification: null, nominal: null, lsl: null, usl: null, uom: last?.uom ?? null, instrument: last?.instrument ?? null, frequency: null }])]);
    setDirty(true);
  };
  const removeRow = (k) => {
    setRows((rs) => rs.filter((r) => r._k !== k));
    setDirty(true);
  };
  const reset = () => {
    setRows(withKeys(item.rows));
    setHead(Object.fromEntries(HEAD.map((h) => [h.key, show(h.key === 'itemCode' ? item.itemCode ?? firstOf(item.rows, 'itemCode') : firstOf(item.rows, h.key))])));
    setDirty(false);
  };
  // The item fields go on every row (the file has them per row).
  const apply = () => {
    const out = rows.map(({ _k, ...r }) => ({
      ...r,
      itemCode: head.itemCode.trim() || null,
      itemDescription: head.itemDescription.trim() || null,
      formatNo: head.formatNo.trim() || null,
      commonFormatNo: head.commonFormatNo.trim() || null,
    }));
    onApply(out);
    setDirty(false);
  };

  const [label, tone] = ITEM_STATUS[item.status] ?? ITEM_STATUS.ERROR;
  const cellCls = 'h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15';

  return (
    <Modal
      size="xl"
      title={`Review ${item.itemCode ?? 'item'}${item.description ? ` · ${item.description}` : ''}`}
      subtitle={item.firstRow ? `Rows ${item.firstRow}–${item.lastRow} of the file · nothing is saved until you import` : 'Rows added on screen · nothing is saved until you import'}
      onClose={async () => {
        if (!dirty || await askConfirm({ title: 'Close without applying?', message: 'The changes you made to these rows are not checked or kept.', confirmLabel: 'Close without applying' })) onClose();
      }}
      footer={(
        <div className="flex w-full flex-wrap items-center gap-2">
          <Button variant="ghost" icon={Trash2} className="text-rose-600!" onClick={onRemove}>Leave out of import</Button>
          <span className="ml-auto text-xs text-slate-500">{dirty ? 'Changes not checked yet' : 'Checked'}</span>
          {dirty && <Button variant="ghost" icon={Undo2} onClick={reset}>Undo changes</Button>}
          <Button variant="secondary" onClick={onClose} disabled={dirty}>Done</Button>
          <Button icon={RefreshCw} loading={checking} disabled={!dirty} onClick={apply}>Apply &amp; re-check</Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={tone}>{label}</Badge>
          <span className="text-sm text-slate-600">{item.checkpoints.length} checkpoint{item.checkpoints.length === 1 ? '' : 's'} will be created{rowErrors ? ` · ${rowErrors} row${rowErrors === 1 ? '' : 's'} with problems` : ''}</span>
          <div role="tablist" className="ml-auto flex rounded-lg bg-slate-100 p-0.5 text-sm">
            {[['edit', 'Edit rows', Table2], ['preview', 'Preview format', Eye]].map(([k, l, I]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-semibold cursor-pointer ${tab === k ? 'bg-white text-blue-700 ring-1 ring-slate-200' : 'text-slate-600'}`}>
                <I className="h-4 w-4" />{l}
              </button>
            ))}
          </div>
        </div>

        {itemMessages.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            {itemMessages.map((m, i) => (
              <li key={i} className={`flex items-start gap-2 ${m.level === 'error' ? 'text-rose-700' : 'text-slate-600'}`}>
                {m.level === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}{m.message}
              </li>
            ))}
          </ul>
        )}

        {tab === 'edit' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {HEAD.map((h) => (
                <label key={h.key} className={h.wide ? 'lg:col-span-2' : ''}>
                  <span className="mb-1 block text-[11px] font-semibold text-slate-600">{h.label}</span>
                  <input value={head[h.key]} onChange={(e) => setHeadField(h.key, h.key === 'itemCode' ? e.target.value.toUpperCase() : e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10" />
                </label>
              ))}
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] font-semibold text-slate-600">
                  <tr>
                    <th className="px-2 py-2 w-14">Row</th>
                    {COLS.map((c) => <th key={c.key} className={`px-1.5 py-2 ${c.w}`} title={c.hint}>{c.label}</th>)}
                    <th className="px-2 py-2 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const msgs = r.rowNo ? byRow.get(r.rowNo) ?? [] : [];
                    const bad = msgs.some((m) => m.level === 'error');
                    return [
                      <tr key={r._k} className={`border-t border-slate-100 align-top ${bad ? 'bg-rose-50/60' : ''}`}>
                        <td className="px-2 py-1.5">
                          <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-[11px] ${r.rowNo ? 'bg-slate-100 text-slate-600' : 'bg-blue-100 text-blue-700'}`}>{r.rowNo ?? 'new'}</span>
                        </td>
                        {COLS.map((c) => (
                          <td key={c.key} className="px-1 py-1.5">
                            {c.type === 'section' ? (
                              <select value={sectionLabel(r.section)} onChange={(e) => setCell(r._k, 'section', e.target.value)} aria-label={`Row ${r.rowNo ?? 'new'} section`} className={`${cellCls} cursor-pointer pr-6`}>
                                {!SECTIONS.includes(sectionLabel(r.section)) && <option value={show(r.section)}>{show(r.section) || 'Choose…'}</option>}
                                {SECTIONS.map((x) => <option key={x} value={x}>{x}</option>)}
                              </select>
                            ) : (
                              <input value={show(r[c.key])} inputMode={c.num ? 'decimal' : undefined} aria-label={`Row ${r.rowNo ?? 'new'} ${c.label}`}
                                disabled={c.num && sectionLabel(r.section) !== 'Dimensional'}
                                placeholder={c.key === 'frequency' && sectionLabel(r.section) === 'Reliability' ? 'every lot' : ''}
                                onChange={(e) => setCell(r._k, c.key, e.target.value)}
                                className={`${cellCls} ${c.num ? 'text-right tabular disabled:bg-slate-50 disabled:text-slate-300' : ''}`} />
                            )}
                          </td>
                        ))}
                        <td className="px-1 py-1.5 text-center">
                          <button type="button" onClick={() => removeRow(r._k)} aria-label={`Delete row ${r.rowNo ?? 'new'}`} title="Delete this row"
                            className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"><Trash2 className="h-4 w-4" /></button>
                        </td>
                      </tr>,
                      msgs.length > 0 && (
                        <tr key={`${r._k}-m`} className={bad ? 'bg-rose-50/60' : ''}>
                          <td />
                          <td colSpan={COLS.length + 1} className="px-1 pb-2">
                            <ul className="space-y-0.5 text-xs">
                              {msgs.map((m, i) => (
                                <li key={i} className={`flex items-start gap-1.5 ${m.level === 'error' ? 'text-rose-700' : 'text-slate-500'}`}>
                                  {m.level === 'error' ? <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" />}{m.message}
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                  {rows.length === 0 && <tr><td colSpan={COLS.length + 2} className="px-3 py-6 text-center text-sm text-slate-500">No rows. Add a checkpoint, or leave this item out of the import.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" variant="secondary" icon={Plus} onClick={addRow}>Add checkpoint</Button>
              <p className="text-xs text-slate-500">Dimensional: give LSL and USL, or a specification like <span className="font-mono">57 ± 0.3</span> and the limits are read from it. Edited rows are checked again when you apply.</p>
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-canvas/60 p-3">
            {item.checkpoints.length
              ? <FormatContent checkpoints={item.checkpoints} toolbar={false} />
              : <p className="py-8 text-center text-sm text-slate-500">Nothing to preview yet: fix the rows first.</p>}
            {dirty && <p className="mt-2 text-xs text-amber-700">The preview shows the last check. Apply &amp; re-check to see your changes here.</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
