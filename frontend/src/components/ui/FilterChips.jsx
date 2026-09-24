import { SlidersHorizontal, X } from 'lucide-react';

/**
 * The filters in force, as removable chips, with "Clear all".
 * chips: [{ key, label, value, onRemove }] — only active ones are passed.
 */
export default function FilterChips({ chips, onClearAll }) {
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
      {chips.map((c) => (
        <span key={c.key} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-blue-50 border border-blue-100 text-xs text-blue-800">
          <span className="text-blue-500">{c.label}:</span>
          <span className="font-medium max-w-48 truncate">{c.value}</span>
          <button type="button" onClick={c.onRemove} aria-label={`Remove filter ${c.label}`} className="p-0.5 rounded-full hover:bg-blue-100 cursor-pointer">
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      {chips.length > 1 && onClearAll && (
        <button type="button" onClick={onClearAll} className="text-xs font-semibold text-slate-500 hover:text-rose-600 px-1.5 cursor-pointer">Clear all</button>
      )}
    </div>
  );
}
