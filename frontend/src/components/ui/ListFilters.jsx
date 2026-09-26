import { CalendarDays, Search, X } from 'lucide-react';
import { useState } from 'react';

const box = 'h-9 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus-within:ring-4 focus-within:ring-blue-500/10 focus-within:border-blue-500';

/** From / to dates in one box, as in the list filter bar. */
export function DateRange({ from, to, onChange, label = 'Dates' }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-slate-500">{label}</span>
      <div className={`${box} flex items-center gap-1.5 px-2.5`}>
        <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
        <input type="date" aria-label={`${label} from`} value={from ?? ''} max={to || undefined} onChange={(e) => onChange({ from: e.target.value || undefined, to })}
          className="w-[7.4rem] bg-transparent text-sm focus:outline-none cursor-pointer" />
        <span className="text-slate-400">–</span>
        <input type="date" aria-label={`${label} to`} value={to ?? ''} min={from || undefined} onChange={(e) => onChange({ from, to: e.target.value || undefined })}
          className="w-[7.4rem] bg-transparent text-sm focus:outline-none cursor-pointer" />
        {(from || to) && (
          <button type="button" onClick={() => onChange({ from: undefined, to: undefined })} aria-label="Clear dates" className="p-0.5 rounded text-slate-400 hover:text-slate-700 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
        )}
      </div>
    </div>
  );
}

/** A labelled drop-down of the filter bar. options: [{ value, label }]. */
export function FilterSelect({ label, value, onChange, options, placeholder = 'All', width = 'w-40' }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-slate-500">{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} className={`${box} ${width} pl-2.5 pr-8 cursor-pointer`}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** Search with a button; the list also searches as you type (after a short pause). */
export function SearchBox({ value, onChange, placeholder = 'Search…' }) {
  const [text, setText] = useState(value ?? '');
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setText(value ?? '');
  }
  return (
    <form className="flex flex-col gap-1" onSubmit={(e) => { e.preventDefault(); onChange(text); }}>
      <span className="text-[11px] font-medium text-transparent select-none" aria-hidden="true">Search</span>
      <div className={`${box} flex items-center overflow-hidden`}>
        <Search className="w-4 h-4 text-slate-400 ml-2.5 shrink-0" />
        <input value={text} onChange={(e) => { setText(e.target.value); onChange(e.target.value); }} placeholder={placeholder} aria-label="Search"
          className="w-56 lg:w-64 h-full px-2 bg-transparent text-sm focus:outline-none" />
        <button type="submit" className="h-full px-3.5 inline-flex items-center gap-1.5 bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 cursor-pointer">
          <Search className="w-4 h-4" />Search
        </button>
      </div>
    </form>
  );
}
