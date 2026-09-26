import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { formatDateTime } from '../../utils/format.js';

/**
 * Frame for AI output: marked as AI-generated with its model and time, a note that people decide,
 * and the button that asks for it (or asks again). `result.meta` comes from the server.
 */
export default function AiCard({ title, intro, result, loading, error, onRun, runLabel = 'Generate', children, className = '' }) {
  const meta = result?.meta;
  return (
    <section className={`card overflow-hidden border-violet-200 ${className}`}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-violet-50 to-white border-b border-violet-100">
        <Sparkles className="w-4 h-4 text-violet-600" />
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <span className="rounded bg-violet-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-violet-700">AI</span>
        <div className="ml-auto flex items-center gap-2">
          {meta && <span className="hidden sm:inline text-[11px] text-slate-400" title={meta.model}>{meta.cached ? 'Saved' : 'Made'} {formatDateTime(meta.at)}{meta.by ? ` · ${meta.by}` : ''}</span>}
          <button type="button" onClick={() => onRun(!!result)} disabled={loading}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-60 cursor-pointer">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : result ? <RefreshCw className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
            {loading ? 'Working…' : result ? 'Regenerate' : runLabel}
          </button>
        </div>
      </div>
      <div className="px-4 py-3">
        {error && <p className="text-sm text-rose-700">{error}</p>}
        {!result && !error && !loading && intro && <p className="text-sm text-slate-500">{intro}</p>}
        {loading && !result && <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="skeleton h-4" />)}</div>}
        {result && children}
        {result && <p className="mt-3 text-[11px] text-slate-400">AI-generated from QMAS data. Check it before acting; decisions stay with you.</p>}
      </div>
    </section>
  );
}
