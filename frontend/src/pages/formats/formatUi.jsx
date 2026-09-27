import { INPUT_TYPE_LABELS, SECTION_LABELS } from '@qmas/shared';
import { CheckSquare, ChevronDown, ChevronsDownUp, ChevronsUpDown, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import Badge from '../../components/ui/Badge.jsx';
import { fieldLabel, fmtNum, fmtValue, groupCheckpoints, ruleText, sectionColumns, STATUS } from './formatHelpers.js';
import { SECTION_LOOK, TYPE_LOOK } from './formatLook.js';

export const StatusBadge = ({ status }) => <Badge variant={STATUS[status]?.[1] ?? 'neutral'}>{STATUS[status]?.[0] ?? status}</Badge>;
export const VersionTag = ({ no }) => (no ? <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-700">v{no}</span> : <span className="text-xs text-slate-400">—</span>);

export function TypeChip({ type }) {
  const [Icon, tone] = TYPE_LOOK[type] ?? [CheckSquare, 'bg-slate-100 text-slate-600'];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${tone}`}>
      <Icon className="w-3 h-3" />{INPUT_TYPE_LABELS[type] ?? type}
    </span>
  );
}

const has = (v) => v !== null && v !== undefined && v !== '';
const HEADERS = { checkpoint: 'Check point', specification: 'Specification', tolerance: 'Tolerance', rule: 'Accepts', inputType: 'Type', isRequired: 'Required', helpText: 'Help for the inspector', instrument: 'Instrument / method', uom: 'Unit', frequencyMonths: 'Frequency', nominal: 'Nominal', lsl: 'LSL', usl: 'USL' };
const CENTERED = new Set(['nominal', 'lsl', 'usl', 'uom']);
/** Section card look (numbered badge, tinted header, add button) per kind, as on the format page. */
const KIND_STYLE = {
  DIMENSIONAL: { head: 'bg-blue-50/70', ring: 'border-blue-200', badge: 'bg-blue-600', add: 'bg-blue-600 hover:bg-blue-700', about: 'Critical dimensions as per drawing and specification' },
  VISUAL: { head: 'bg-emerald-50/70', ring: 'border-emerald-200', badge: 'bg-emerald-600', add: 'bg-emerald-600 hover:bg-emerald-700', about: 'Appearance and surface finish requirements' },
  RELIABILITY: { head: 'bg-amber-50/70', ring: 'border-amber-200', badge: 'bg-amber-500', add: 'bg-amber-500 hover:bg-amber-600', about: 'Functional and performance requirements' },
  RECORD: { head: 'bg-slate-50', ring: 'border-slate-200', badge: 'bg-slate-600', add: 'bg-slate-700 hover:bg-slate-800', about: 'Details recorded once for the whole lot' },
};
const SECTION_TITLE = { DIMENSIONAL: 'Dimensional Check', VISUAL: 'Visual Check', RELIABILITY: 'Reliability Test', RECORD: 'Lot Details' };
// A display column and the stored fields it shows (for change highlighting).
const FIELDS_OF = { tolerance: ['nominal', 'lsl', 'usl', 'uom'], rule: ['lsl', 'usl', 'uom', 'options', 'specification'], inputType: ['inputType'], specification: ['specification', 'options'], checkpoint: ['checkpoint', 'helpText'] };
const WIDTH = { checkpoint: 'min-w-44', specification: 'min-w-56', tolerance: 'min-w-52', instrument: 'min-w-32', helpText: 'min-w-48' };

/** LSL … USL with the nominal marked on a small band, e.g. "7.8 → 8.2 mm". */
function Tolerance({ c }) {
  const lo = has(c.lsl) ? Number(c.lsl) : null;
  const hi = has(c.usl) ? Number(c.usl) : null;
  const nom = has(c.nominal) ? Number(c.nominal) : null;
  const pos = lo !== null && hi !== null && nom !== null && hi > lo ? Math.min(100, Math.max(0, ((nom - lo) / (hi - lo)) * 100)) : null;
  return (
    <div className="min-w-44">
      <div className="flex items-baseline gap-1.5 tabular text-sm">
        <span className={lo === null ? 'text-slate-300' : 'text-slate-800'}>{lo === null ? 'no min' : fmtNum(lo)}</span>
        <span className="text-slate-300">→</span>
        <span className={hi === null ? 'text-slate-300' : 'text-slate-800'}>{hi === null ? 'no max' : fmtNum(hi)}</span>
        {c.uom && <span className="text-xs text-slate-500">{c.uom}</span>}
      </div>
      <div className="relative mt-1 h-1.5 w-full max-w-40 rounded-full bg-blue-100">
        <div className={`absolute inset-y-0 rounded-full bg-blue-500/70 ${lo === null ? 'left-0 rounded-l-none' : 'left-2'} ${hi === null ? 'right-0 rounded-r-none' : 'right-2'}`} />
        {pos !== null && <span className="absolute -top-0.5 w-0.5 h-2.5 bg-slate-900 rounded" style={{ left: `calc(0.5rem + (100% - 1rem) * ${pos / 100})` }} title={`Nominal ${fmtNum(nom)}`} />}
      </div>
      {nom !== null && <div className="mt-0.5 text-[11px] text-slate-400">nominal {fmtNum(nom)}</div>}
    </div>
  );
}

function cellValue(c, f, section) {
  if (f === 'tolerance') return <Tolerance c={c} />;
  if (f === 'inputType') return <TypeChip type={c.inputType} />;
  if (f === 'rule') return <span className="text-sm text-slate-700">{ruleText(c)}</span>;
  if (f === 'isRequired') return c.isRequired === false ? <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">Optional</span> : <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">Required</span>;
  if (f === 'frequencyMonths') return <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 whitespace-nowrap">{c[f] ? `every ${c[f]} month${Number(c[f]) === 1 ? '' : 's'}` : 'every lot'}</span>;
  if (f === 'nominal' || f === 'lsl' || f === 'usl') return <span className="tabular text-slate-800">{has(c[f]) ? fmtNum(c[f]) : '–'}</span>;
  if (f === 'uom') return <span className="text-slate-700">{c.uom || '–'}</span>;
  if (f === 'checkpoint') {
    return (
      <>
        <span className="font-medium text-slate-900">{c.checkpoint}</span>
        {c.helpText && section !== 'RECORD' && <span className="block text-[11px] text-slate-400">{c.helpText}</span>}
      </>
    );
  }
  if (f === 'specification') {
    return (
      <>
        <span className="text-slate-700">{c.specification}</span>
        {c.inputType === 'CHOICE' && (
          <span className="mt-1 flex flex-wrap gap-1">
            {(c.options ?? []).map((o) => (
              <span key={o.label} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${o.pass === false ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{o.label}</span>
            ))}
          </span>
        )}
      </>
    );
  }
  return <span className="text-slate-700">{c[f] ?? ''}</span>;
}
const plainValue = (c, f) => (f === 'tolerance' ? `${has(c.lsl) ? fmtNum(c.lsl) : '–'} → ${has(c.usl) ? fmtNum(c.usl) : '–'} ${c.uom ?? ''}` : f === 'rule' ? ruleText(c) : f === 'inputType' || f === 'isRequired' || f === 'frequencyMonths' ? fmtValue(f, c[f]) : (c[f] ?? ''));

/**
 * The content of a format, laid out like the inspection sheet: an overview of the sections, then
 * one card per section heading. Search narrows the rows; sections collapse.
 * With `diff` (from diffVersions) added rows are green, changed cells show old → new, removed
 * rows are struck through, and "Only changes" hides everything else.
 */
export function FormatContent({ checkpoints, diff, toolbar = true, onAdd, onEdit, onRemove }) {
  const [q, setQ] = useState('');
  const [sectionQ, setSectionQ] = useState({});
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [onlyChanges, setOnlyChanges] = useState(false);
  const added = useMemo(() => new Set(diff?.added.map((c) => c.uid)), [diff]);
  const changed = useMemo(() => new Map(diff?.changed.map((c) => [c.uid, new Map(c.fields.map((f) => [f.field, f.from]))])), [diff]);
  const removed = diff?.removed ?? [];
  const groups = groupCheckpoints([...checkpoints, ...removed.map((c) => ({ ...c, _removed: true }))]);
  const needle = q.trim().toLowerCase();
  const matches = (c) => (!needle || [c.checkpoint, c.specification, c.instrument, c.helpText].some((v) => v?.toLowerCase().includes(needle)))
    && (!onlyChanges || c._removed || added.has(c.uid) || changed.has(c.uid));
  const touchedCount = added.size + changed.size + removed.length;
  const toggle = (key) => setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const actions = !!(onEdit || onRemove);
  // Standard sections are numbered and titled like the report ("1 Dimensional Check (7)").
  const titleOf = (g) => (g.custom ? g.label : SECTION_TITLE[g.section]);

  if (!checkpoints.length && !removed.length) return <p className="card p-8 text-center text-sm text-slate-400">No checkpoints yet.</p>;

  return (
    <div className="space-y-3">
      {toolbar && <div className="card px-3 py-2.5 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5 min-w-0">
          {groups.map((g) => {
            const [Icon, tone] = SECTION_LOOK[g.section];
            return (
              <a key={g.key} href={`#fmt-${encodeURIComponent(g.key)}`} onClick={(e) => { e.preventDefault(); document.getElementById(`fmt-${encodeURIComponent(g.key)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white pl-1 pr-2 py-1 text-xs text-slate-700 hover:border-blue-300 hover:bg-blue-50/50">
                <span className={`w-5 h-5 rounded flex items-center justify-center ${tone}`}><Icon className="w-3 h-3" /></span>
                <span className="font-medium">{g.label}</span>
                <span className="tabular text-slate-400">{g.items.filter((c) => !c._removed).length}</span>
              </a>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {diff && (
            <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />
              Only changes <span className="tabular text-slate-400">({touchedCount})</span>
            </label>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a check point…" aria-label="Find a check point"
              className="h-8 w-48 pl-8 pr-7 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500" />
            {q && <button type="button" onClick={() => setQ('')} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"><X className="w-3.5 h-3.5" /></button>}
          </div>
          <button type="button" title={collapsed.size ? 'Expand all' : 'Collapse all'} onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(groups.map((g) => g.key)))}
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 cursor-pointer">
            {collapsed.size ? <ChevronsUpDown className="w-4 h-4" /> : <ChevronsDownUp className="w-4 h-4" />}
          </button>
        </div>
      </div>}

      {diff && touchedCount > 0 && (
        <div className="flex flex-wrap gap-3 px-1 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-100 ring-1 ring-emerald-300" />Added</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-100 ring-1 ring-amber-300" />Changed (old value struck through)</span>
          <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-rose-100 ring-1 ring-rose-300" />Removed</span>
        </div>
      )}

      {groups.map((g, gi) => {
        const cols = sectionColumns(g.section);
        const local = (sectionQ[g.key] ?? '').trim().toLowerCase();
        const rows = g.items.filter(matches).filter((c) => !local || [c.checkpoint, c.specification, c.instrument].some((v) => v?.toLowerCase().includes(local)));
        const live = g.items.filter((c) => !c._removed);
        const open = !collapsed.has(g.key);
        const k = KIND_STYLE[g.section];
        if (!g.items.some(matches) && (needle || onlyChanges)) return null;
        return (
          <section key={g.key} id={`fmt-${encodeURIComponent(g.key)}`} className={`rounded-xl border bg-white overflow-hidden scroll-mt-28 ${k.ring}`}>
            <div className={`flex flex-wrap items-center gap-3 px-4 py-3 ${k.head}`}>
              <span className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-sm font-bold text-white ${k.badge}`}>{gi + 1}</span>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-slate-900">{titleOf(g)} <span className="font-semibold text-blue-600">({live.length})</span></h3>
                <p className="text-xs text-slate-500">{g.custom ? `${SECTION_LABELS[g.section]} · ` : ''}{k.about}{g.section === 'RECORD' ? ` · ${live.filter((c) => c.isRequired !== false).length} required` : ''}</p>
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input value={sectionQ[g.key] ?? ''} onChange={(e) => setSectionQ((x) => ({ ...x, [g.key]: e.target.value }))} placeholder="Search check points…" aria-label={`Search ${titleOf(g)}`}
                  className="h-9 w-52 pl-8 pr-3 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500" />
              </div>
              {onAdd && (
                <button type="button" onClick={() => onAdd(g)} className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-sm font-semibold text-white cursor-pointer ${k.add}`}>
                  <Plus className="w-4 h-4" />Add {g.section === 'RECORD' ? 'Detail' : 'Checkpoint'}
                </button>
              )}
              <button type="button" onClick={() => toggle(g.key)} aria-expanded={open} aria-label={open ? 'Collapse section' : 'Expand section'} className="p-1.5 rounded-md text-slate-500 hover:bg-white/80 cursor-pointer">
                <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
            </div>
            {open && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/80 border-y border-slate-100">
                    <tr className="text-xs font-semibold text-slate-600">
                      <th className="px-4 py-2 text-left w-12">#</th>
                      {cols.map((c) => <th key={c} className={`px-3 py-2 whitespace-nowrap ${CENTERED.has(c) ? 'text-center' : 'text-left'}`}>{HEADERS[c] ?? fieldLabel(c)}</th>)}
                      {actions && <th className="px-3 py-2 text-center w-24">Action</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((c) => {
                      if (c._removed) {
                        return (
                          <tr key={`x-${c.uid}`} className="bg-rose-50/60 text-rose-600">
                            <td className="px-4 py-2 text-[10px] font-bold uppercase">removed</td>
                            {cols.map((f) => <td key={f} className={`px-3 py-2 line-through ${CENTERED.has(f) ? 'text-center' : ''}`}>{plainValue(c, f)}</td>)}
                            {actions && <td />}
                          </tr>
                        );
                      }
                      const ch = changed.get(c.uid);
                      const isNew = added.has(c.uid);
                      return (
                        <tr key={c.uid} className={`align-top ${isNew ? 'bg-emerald-50/70' : ch ? 'bg-amber-50/50' : 'hover:bg-slate-50/60'}`}>
                          <td className="px-4 py-2.5 text-slate-500 tabular">
                            {c.seq}
                            {isNew && <span className="block text-[10px] font-bold text-emerald-600">NEW</span>}
                            {ch && <span className="block text-[10px] font-bold text-amber-600">EDITED</span>}
                          </td>
                          {cols.map((f) => {
                            const touched = (FIELDS_OF[f] ?? [f]).filter((x) => ch?.has(x));
                            return (
                              <td key={f} className={`px-3 py-2.5 ${WIDTH[f] ?? ''} ${CENTERED.has(f) ? 'text-center' : ''}`}>
                                {touched.map((x) => <span key={x} className="block text-xs text-rose-500 line-through">{touched.length > 1 || x !== f ? `${fieldLabel(x)}: ` : ''}{fmtValue(x, ch.get(x))}</span>)}
                                <div className={touched.length ? 'rounded ring-1 ring-amber-300 bg-amber-50 px-1 -mx-1' : ''}>{cellValue(c, f, g.section)}</div>
                              </td>
                            );
                          })}
                          {actions && (
                            <td className="px-3 py-2 text-center whitespace-nowrap">
                              {onEdit && <button type="button" onClick={() => onEdit(c)} title="Edit in a draft" aria-label={`Edit ${c.checkpoint}`} className="p-1.5 rounded-md text-blue-600 hover:bg-blue-50 cursor-pointer"><Pencil className="w-4 h-4" /></button>}
                              {onRemove && <button type="button" onClick={() => onRemove(c)} title="Remove in a draft" aria-label={`Remove ${c.checkpoint}`} className="ml-1 p-1.5 rounded-md bg-rose-50 text-rose-600 hover:bg-rose-100 cursor-pointer"><Trash2 className="w-4 h-4" /></button>}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {!rows.length && <tr><td colSpan={cols.length + (actions ? 2 : 1)} className="px-4 py-4 text-center text-sm text-slate-400">No check point matches.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
      {(needle || onlyChanges) && groups.every((g) => !g.items.some(matches)) && <p className="card p-6 text-center text-sm text-slate-500">Nothing matches{needle ? ` “${q}”` : ''}.</p>}
    </div>
  );
}

export function DiffSummary({ diff }) {
  if (!diff) return null;
  const parts = [
    diff.added.length && `${diff.added.length} added`,
    diff.changed.length && `${diff.changed.length} changed`,
    diff.removed.length && `${diff.removed.length} removed`,
    diff.header.length && `${diff.header.length} header field${diff.header.length > 1 ? 's' : ''} changed`,
  ].filter(Boolean);
  return <span>{parts.length ? parts.join(' · ') : 'No content changes'}</span>;
}
