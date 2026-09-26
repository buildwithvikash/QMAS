import { AlertTriangle, Gauge, History, ShieldAlert, Target, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useImirSummaryMutation } from '../../api/aiApi.js';
import AiCard from '../../components/ui/AiCard.jsx';
import Badge from '../../components/ui/Badge.jsx';
import { apiError } from '../../utils/apiError.js';

const LEVEL = { LOW: ['Low risk', 'success'], MEDIUM: ['Medium risk', 'warning'], HIGH: ['High risk', 'danger'], NEW: ['New vendor', 'neutral'] };
const REC = { REDUCED: 'Reduced inspection', NORMAL: 'Normal inspection', TIGHTENED: 'Tightened inspection' };
const pct = (p) => `${Math.round(p * 100)} %`;

/**
 * What history says about this lot, for the inspector and the Incharge: where to look first,
 * defects this item or vendor had before, drifting values, the vendor's risk with the
 * recommended inspection level, and (Incharge and above) the chance this lot fails.
 */
export default function LotInsights({ insights }) {
  if (!insights) return null;
  const { supplier: s, prediction: p, alerts, focus, basis } = insights;
  const [label, tone] = LEVEL[s.level] ?? LEVEL.NEW;
  const watch = alerts.length > 0 || focus.length > 0;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <section className="card">
        <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
          <Target className="w-4 h-4 text-violet-600" />
          <h2 className="section-title">Before you inspect</h2>
          <span className="ml-auto text-[11px] text-slate-400">{basis.historyLots ? `From ${basis.historyLots} earlier lots of this item` : 'First lot of this item'}</span>
        </div>
        {!watch && <p className="px-4 pb-4 text-sm text-slate-500">{basis.historyLots ? 'No repeat defects or drifting values in this item\'s history. Inspect as usual.' : 'No history yet for this item; later lots will show repeat defects and drift here.'}</p>}
        {focus.length > 0 && (
          <div className="px-4 pb-3">
            <p className="text-xs font-medium text-slate-500 mb-1.5">Look here first</p>
            <ol className="space-y-1.5">
              {focus.map((f, i) => (
                <li key={f.uid} className="flex items-baseline gap-2 text-sm">
                  <span className="w-5 h-5 shrink-0 rounded-full bg-violet-100 text-violet-800 text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                  <span><span className="font-semibold text-slate-900">{f.name}</span> <span className="text-slate-500">— {f.reasons.join(', ')}</span></span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {alerts.length > 0 && (
          <ul className="border-t border-slate-100 divide-y divide-slate-100">
            {alerts.map((a) => {
              const Icon = a.kind === 'DRIFT' ? TrendingUp : a.level === 'HIGH' ? AlertTriangle : History;
              return (
                <li key={`${a.uid}-${a.kind ?? 'hist'}`} className="flex gap-2.5 px-4 py-2">
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${a.level === 'HIGH' ? 'text-rose-600' : 'text-amber-600'}`} />
                  <p className="text-sm text-slate-700"><span className="font-semibold text-slate-900">{a.checkpoint}</span>: {a.text}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
          <ShieldAlert className="w-4 h-4 text-blue-700" />
          <h2 className="section-title">Supplier risk</h2>
          <Badge variant={tone}>{label}</Badge>
        </div>
        <div className="px-4 pb-3 space-y-2">
          <p className="text-sm text-slate-800"><span className="font-semibold">{s.vendorName}</span> <span className="text-slate-500">({s.vendorCode}) · score {s.score}/100 over {basis.windowDays} days</span></p>
          <p className="text-sm"><span className="font-semibold text-slate-900">{REC[s.recommendation]}.</span> <span className="text-slate-600">{s.recommendationText.split(': ')[1] ?? ''}</span></p>
          {s.reasons.length > 0 && <ul className="text-xs text-slate-500 list-disc pl-4 space-y-0.5">{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        </div>
        {p && (
          <div className="border-t border-slate-100 px-4 py-3 flex items-center gap-3">
            <Gauge className={`w-8 h-8 shrink-0 ${p.level === 'HIGH' ? 'text-rose-600' : p.level === 'MEDIUM' ? 'text-amber-600' : 'text-emerald-600'}`} />
            <div>
              <p className="text-sm text-slate-800">Chance this lot fails: <span className={`font-bold ${p.level === 'HIGH' ? 'text-rose-700' : p.level === 'MEDIUM' ? 'text-amber-700' : 'text-emerald-700'}`}>{pct(p.probability)}</span></p>
              <p className="text-[11px] text-slate-500">From recent history: this vendor with this item {pct(p.basis.vendorItem)}, the vendor overall {pct(p.basis.vendor)}, the item overall {pct(p.basis.item)}; recent lots count more.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

const TONE = { bad: 'bg-rose-50 text-rose-800 ring-rose-200', warn: 'bg-amber-50 text-amber-900 ring-amber-200', good: 'bg-emerald-50 text-emerald-800 ring-emerald-200', info: 'bg-slate-50 text-slate-700 ring-slate-200' };

/** A short AI summary of the inspection, for the Incharge and above. */
export function AiSummary({ imirId }) {
  const [run, { isLoading }] = useImirSummaryMutation();
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const go = async (refresh) => {
    setError('');
    try {
      setResult(await run({ id: imirId, refresh }).unwrap());
    } catch (err) {
      setError(apiError(err).message);
      if (result) toast.error(apiError(err).message);
    }
  };
  return (
    <AiCard title="Inspection summary" intro="A 2 to 4 line summary of the results, failures and anything critical, for a quick review." runLabel="Summarise" result={result} loading={isLoading} error={error} onRun={go}>
      <p className="text-sm text-slate-800 leading-relaxed">{result?.summary}</p>
      {result?.highlights?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {result.highlights.map((h) => <span key={h.text} className={`rounded-md px-2 py-0.5 text-xs ring-1 ${TONE[h.tone] ?? TONE.info}`}>{h.text}</span>)}
        </div>
      )}
    </AiCard>
  );
}
