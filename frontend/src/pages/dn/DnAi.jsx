import { Check, CircleAlert, CircleDashed, Repeat } from 'lucide-react';
import { useState } from 'react';
import { useCapaAssessmentMutation, useRootCauseMutation } from '../../api/aiApi.js';
import AiCard from '../../components/ui/AiCard.jsx';
import Badge from '../../components/ui/Badge.jsx';
import { apiError } from '../../utils/apiError.js';

function useAi(mutation, args) {
  const [run, { isLoading }] = mutation();
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const go = async (refresh) => {
    setError('');
    try {
      setResult(await run({ ...args, refresh }).unwrap());
    } catch (err) {
      setError(apiError(err).message);
    }
  };
  return { result, error, loading: isLoading, go };
}

const ELEMENT = {
  ROOT_CAUSE: 'Root cause', CONTAINMENT: 'Containment', CORRECTIVE_ACTION: 'Corrective action',
  PREVENTIVE_ACTION: 'Preventive action', EFFECTIVENESS_EVIDENCE: 'Effectiveness evidence',
};
const RATING = {
  GOOD: [Check, 'text-emerald-600', 'Good'],
  WEAK: [CircleAlert, 'text-amber-600', 'Weak'],
  MISSING: [CircleDashed, 'text-rose-600', 'Missing'],
};
const OVERALL = { ADEQUATE: ['Adequate', 'success'], NEEDS_WORK: ['Needs work', 'warning'], INADEQUATE: ['Inadequate', 'danger'] };

/** AI check of the latest CAPA: the five elements, repetition of earlier CAPAs, what to ask the vendor. */
export function CapaAssessment({ dn }) {
  const latest = dn.capas.at(-1);
  const { result, error, loading, go } = useAi(useCapaAssessmentMutation, { id: dn.id });
  const [label, tone] = OVERALL[result?.overall] ?? [];
  return (
    <AiCard title={`CAPA assessment${latest ? ` · cycle ${latest.cycleNo}` : ''}`} runLabel="Assess CAPA" result={result} loading={loading} error={error} onRun={go}
      intro="Checks the vendor's CAPA for root cause, containment, corrective and preventive action and evidence of effectiveness, and flags answers repeated from this vendor's earlier CAPAs.">
      {result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={tone}>{label}</Badge>
            {result.repetitive?.isRepetitive && <Badge variant="warning"><Repeat className="w-3 h-3 inline mr-0.5" />Repeats earlier CAPA</Badge>}
            <p className="text-sm text-slate-800 basis-full">{result.summary}</p>
          </div>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {result.elements.map((e) => {
              const [Icon, color, word] = RATING[e.rating] ?? RATING.MISSING;
              return (
                <li key={e.element} className="flex gap-2.5 px-3 py-2">
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} />
                  <div className="min-w-0">
                    <p className="text-sm"><span className="font-semibold text-slate-900">{ELEMENT[e.element]}</span> <span className={`text-xs ${color}`}>{word}</span></p>
                    <p className="text-xs text-slate-600">{e.finding}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          {result.repetitive?.isRepetitive && (
            <p className="text-xs text-amber-900 bg-amber-50 rounded-md px-3 py-2">
              {result.repetitive.note}{result.repetitive.similarTo?.length ? ` Similar to ${result.repetitive.similarTo.join(', ')}.` : ''}
            </p>
          )}
          {result.askVendor?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1">Ask the vendor for</p>
              <ul className="list-disc pl-5 text-sm text-slate-700 space-y-0.5">{result.askVendor.map((q) => <li key={q}>{q}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </AiCard>
  );
}

const LIKELY = { HIGH: 'bg-rose-100 text-rose-800', MEDIUM: 'bg-amber-100 text-amber-900', LOW: 'bg-slate-100 text-slate-700' };
const TYPE = { CONTAINMENT: 'Containment', CORRECTIVE: 'Corrective', PREVENTIVE: 'Preventive' };

/** The past cases a suggestion rests on (DN or deviation numbers; Ctrl+K finds them). */
function Refs({ refs }) {
  if (!refs?.length) return null;
  return <span className="text-[11px] text-slate-400 font-mono"> · {refs.join(', ')}</span>;
}

/** AI suggestions of probable causes and actions, from this defect and similar past cases. */
export function RootCauseSuggestions({ dn }) {
  const { result, error, loading, go } = useAi(useRootCauseMutation, { id: dn.id });
  return (
    <AiCard title="Probable causes and actions" runLabel="Suggest" result={result} loading={loading} error={error} onRun={go}
      intro="Suggests likely root causes and corrective actions from this defect and similar DNs and deviations for the same item or vendor, to discuss with the vendor.">
      {result && (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-slate-500 mb-1.5">Probable causes</p>
            <ol className="space-y-2">
              {result.causes.map((c) => (
                <li key={c.cause} className="text-sm">
                  <span className={`mr-1.5 rounded px-1.5 py-px text-[10px] font-semibold ${LIKELY[c.likelihood]}`}>{c.likelihood.toLowerCase()}</span>
                  <span className="font-semibold text-slate-900">{c.cause}</span>
                  <p className="text-xs text-slate-600">{c.reasoning}<Refs refs={c.basedOn} /></p>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 mb-1.5">Suggested actions</p>
            <ul className="space-y-2">
              {result.actions.map((a) => (
                <li key={a.action} className="text-sm">
                  <span className="mr-1.5 rounded bg-blue-50 px-1.5 py-px text-[10px] font-semibold text-blue-800">{TYPE[a.type]}</span>
                  <span className="text-slate-800">{a.action}</span><Refs refs={a.basedOn} />
                </li>
              ))}
            </ul>
          </div>
          {result.caution && <p className="md:col-span-2 text-xs text-slate-500 italic">{result.caution}</p>}
        </div>
      )}
    </AiCard>
  );
}
