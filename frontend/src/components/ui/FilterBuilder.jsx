import { FILTER_OPERATORS } from '@qmas/shared';
import { Bookmark, Filter, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { defaultRule, opOf, ruleComplete } from '../../utils/filters.js';
import { loadPref, savePref } from '../../utils/prefs.js';
import Button from './Button.jsx';

const ctl = 'px-2.5 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500';

function ValueInput({ rule, field, onChange }) {
  const o = opOf(field, rule.op);
  if (!o || o.noValue) return <span className="text-xs text-slate-400 px-1">no value needed</span>;
  const v = rule.value;
  if (field.type === 'enum') {
    const list = Array.isArray(v) ? v : [];
    return (
      <div className="flex flex-wrap gap-1.5">
        {field.options.map((opt) => {
          const on = list.includes(opt.value);
          return (
            <button key={opt.value} type="button" aria-pressed={on} onClick={() => onChange(on ? list.filter((x) => x !== opt.value) : [...list, opt.value])}
              className={`px-2.5 py-1 rounded-full text-xs border cursor-pointer transition-colors ${on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:border-blue-400'}`}>
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }
  if (field.type === 'bool') {
    return (
      <select className={ctl} value={String(v)} onChange={(e) => onChange(e.target.value === 'true')} aria-label="Value">
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  const type = o.days || field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
  if (o.range) {
    const [a, b] = Array.isArray(v) ? v : ['', ''];
    return (
      <div className="flex items-center gap-2">
        <input className={`${ctl} w-36`} type={type} value={a} aria-label="From" onChange={(e) => onChange([e.target.value, b])} />
        <span className="text-xs text-slate-500">and</span>
        <input className={`${ctl} w-36`} type={type} value={b} aria-label="To" onChange={(e) => onChange([a, e.target.value])} />
      </div>
    );
  }
  return (
    <input className={`${ctl} ${type === 'text' ? 'w-56' : 'w-36'}`} type={type} min={o.days ? 1 : undefined} value={v ?? ''} aria-label="Value"
      placeholder={type === 'text' ? 'Type a value' : o.days ? 'days' : ''} onChange={(e) => onChange(e.target.value)} />
  );
}

/**
 * "Filter" button with a panel for building conditions on any field of the list
 * (field, condition, value; match all or any), plus saved views kept on this device.
 * value / onChange: { mode, rules } — only complete rules are passed on.
 */
export default function FilterBuilder({ fields, value, onChange, storageKey }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? { mode: 'all', rules: [] });
  const [views, setViews] = useState(() => loadPref(`views:${storageKey}`, []));
  const [viewName, setViewName] = useState('');
  const ref = useRef(null);
  const active = value?.rules?.length ?? 0;
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const toggle = () => {
    if (!open) setDraft(value?.rules?.length ? value : { mode: 'all', rules: [defaultRule(fields[0])] });
    setOpen((o) => !o);
  };
  const setRule = (i, patch) => setDraft((d) => ({ ...d, rules: d.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const changeField = (i, key) => setRule(i, defaultRule(byKey[key]));
  const changeOp = (i, op) => {
    const r = draft.rules[i];
    const f = byKey[r.field];
    const o = FILTER_OPERATORS[f.type].find((x) => x.op === op);
    const prev = opOf(f, r.op);
    const keep = !!o.range === !!prev?.range && !!o.days === !!prev?.days;
    setRule(i, { op, value: keep ? r.value : o.range ? ['', ''] : '' });
  };
  const complete = draft.rules.filter((r) => ruleComplete(r, byKey[r.field]));
  const apply = () => {
    onChange(complete.length ? { mode: draft.mode, rules: complete } : null);
    setOpen(false);
  };
  const saveView = () => {
    const name = viewName.trim();
    if (!name || !complete.length) return;
    const next = [...views.filter((v) => v.name !== name), { name, spec: { mode: draft.mode, rules: complete } }];
    setViews(next);
    savePref(`views:${storageKey}`, next);
    setViewName('');
  };
  const removeView = (name) => {
    const next = views.filter((v) => v.name !== name);
    setViews(next);
    savePref(`views:${storageKey}`, next);
  };

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="dialog"
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border cursor-pointer transition-colors ${active ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
        <Filter className="w-3.5 h-3.5" />Filter{active ? ` (${active})` : ''}
      </button>
      {open && (
        <div role="dialog" aria-label="Filter" className="animate-fadeIn absolute right-0 mt-1 z-30 w-[min(40rem,calc(100vw-2rem))] card shadow-lift">
          <div className="flex items-center gap-2 px-4 pt-3.5 pb-2 text-sm text-slate-700">
            Show rows that match
            <select className={`${ctl} py-1`} value={draft.mode} onChange={(e) => setDraft((d) => ({ ...d, mode: e.target.value }))} aria-label="Match">
              <option value="all">all</option>
              <option value="any">any</option>
            </select>
            of these conditions
          </div>
          <div className="px-4 space-y-2 max-h-[45vh] overflow-auto">
            {draft.rules.map((r, i) => {
              const f = byKey[r.field];
              return (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2">
                  <select className={ctl} value={r.field} onChange={(e) => changeField(i, e.target.value)} aria-label="Field">
                    {fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                  </select>
                  <select className={ctl} value={r.op} onChange={(e) => changeOp(i, e.target.value)} aria-label="Condition">
                    {FILTER_OPERATORS[f.type].map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
                  </select>
                  <ValueInput rule={r} field={f} onChange={(val) => setRule(i, { value: val })} />
                  <button type="button" onClick={() => setDraft((d) => ({ ...d, rules: d.rules.filter((_, j) => j !== i) }))} aria-label="Remove condition"
                    className="ml-auto p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"><X className="w-4 h-4" /></button>
                </div>
              );
            })}
            {!draft.rules.length && <p className="text-sm text-slate-500 py-2">No conditions: every row is shown.</p>}
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => setDraft((d) => ({ ...d, rules: [...d.rules, defaultRule(fields[0])] }))}>Add condition</Button>
          </div>

          <div className="mt-2 px-4 py-3 border-t border-slate-100">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-2"><Bookmark className="w-3.5 h-3.5" />Saved views on this device</div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {views.map((v) => (
                <span key={v.name} className="inline-flex items-center rounded-full border border-slate-300 bg-white text-xs">
                  <button type="button" onClick={() => { onChange(v.spec); setOpen(false); }} className="pl-2.5 pr-1.5 py-1 hover:text-blue-700 cursor-pointer">{v.name}</button>
                  <button type="button" onClick={() => removeView(v.name)} aria-label={`Delete view ${v.name}`} className="pr-1.5 py-1 text-slate-400 hover:text-rose-600 cursor-pointer"><Trash2 className="w-3 h-3" /></button>
                </span>
              ))}
              {!views.length && <span className="text-xs text-slate-400">None yet. Build a filter, name it, and save it here.</span>}
            </div>
            <div className="flex items-center gap-2">
              <input className={`${ctl} flex-1 py-1.5`} value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="Name this filter, e.g. NOK lots from Acme" aria-label="View name"
                onKeyDown={(e) => e.key === 'Enter' && saveView()} />
              <Button size="sm" variant="secondary" disabled={!viewName.trim() || !complete.length} onClick={saveView}>Save view</Button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50 rounded-b-[10px]">
            <Button size="sm" variant="ghost" onClick={() => { onChange(null); setOpen(false); }}>Clear filter</Button>
            <div className="flex items-center gap-2">
              {complete.length > 0 && draft.rules.length > complete.length && <span className="text-xs text-amber-700">{draft.rules.length - complete.length} incomplete condition(s) will be skipped</span>}
              <Button size="sm" onClick={apply}>Apply</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
